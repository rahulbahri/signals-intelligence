from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import pandas as pd
import numpy as np
import io, os, json, sqlite3
import anthropic
from datetime import datetime
from typing import Optional
from pathlib import Path

app = FastAPI(
    title="Axiom KPI Dashboard API",
    description="Upload CSVs to compute and track Priority-1 KPIs with 12-month fingerprinting.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DB_PATH = Path(__file__).parent / "uploads" / "axiom.db"
UPLOADS_DIR = Path(__file__).parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# ─── Database ───────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            uploaded_at TEXT,
            row_count INTEGER,
            detected_columns TEXT
        );
        CREATE TABLE IF NOT EXISTS monthly_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            upload_id INTEGER,
            year INTEGER,
            month INTEGER,
            data_json TEXT
        );
        CREATE TABLE IF NOT EXISTS kpi_targets (
            kpi_key TEXT PRIMARY KEY,
            target_value REAL,
            unit TEXT,
            direction TEXT
        );
        CREATE TABLE IF NOT EXISTS projection_uploads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT,
            uploaded_at TEXT,
            row_count INTEGER,
            detected_columns TEXT
        );
        CREATE TABLE IF NOT EXISTS projection_monthly_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            projection_upload_id INTEGER,
            year INTEGER,
            month INTEGER,
            data_json TEXT
        );
    """)
    conn.commit()
    # Seed default targets
    default_targets = [
        ("revenue_growth",      6.0,   "pct",    "higher"),
        ("gross_margin",       62.0,   "pct",    "higher"),
        ("operating_margin",   18.0,   "pct",    "higher"),
        ("ebitda_margin",      22.0,   "pct",    "higher"),
        ("cash_conv_cycle",    42.0,   "days",   "lower"),
        ("dso",                35.0,   "days",   "lower"),
        ("arr_growth",          7.0,   "pct",    "higher"),
        ("nrr",               105.0,   "pct",    "higher"),
        ("burn_multiple",       1.2,   "ratio",  "lower"),
        ("opex_ratio",         42.0,   "pct",    "lower"),
        ("contribution_margin",46.0,   "pct",    "higher"),
        ("revenue_quality",    80.0,   "pct",    "higher"),
        ("cac_payback",        10.0,   "months", "lower"),
        ("sales_efficiency",    3.0,   "ratio",  "higher"),
        ("customer_concentration",28.0,"pct",    "lower"),
        ("recurring_revenue",  80.0,   "pct",    "higher"),
        ("churn_rate",          2.5,   "pct",    "lower"),
        ("operating_leverage",  1.2,   "ratio",  "higher"),
    ]
    for row in default_targets:
        conn.execute(
            "INSERT OR IGNORE INTO kpi_targets VALUES (?,?,?,?)", row
        )
    conn.commit()
    conn.close()

init_db()

@app.on_event("startup")
async def auto_seed():
    """Auto-seed demo data on cold start if the database is empty."""
    conn = get_db()
    count = conn.execute("SELECT COUNT(*) FROM monthly_data").fetchone()[0]
    proj_count = conn.execute("SELECT COUNT(*) FROM projection_monthly_data").fetchone()[0]
    conn.close()
    if count == 0:
        seed_demo()
    if proj_count == 0:
        seed_demo_projection()

# ─── KPI Definitions ────────────────────────────────────────────────────────

# Extended ontology-only metrics (not in KPI_DEFS main dashboard; used only in the knowledge graph)
EXTENDED_ONTOLOGY_METRICS = [
    # Growth
    {"key": "cpl",                "name": "Cost Per Lead",              "domain": "growth",        "unit": "usd",    "direction": "lower"},
    {"key": "mql_sql_rate",       "name": "MQL-to-SQL Rate",            "domain": "growth",        "unit": "pct",    "direction": "higher"},
    {"key": "pipeline_velocity",  "name": "Pipeline Velocity",          "domain": "growth",        "unit": "ratio",  "direction": "higher"},
    {"key": "win_rate",           "name": "Win Rate",                   "domain": "growth",        "unit": "pct",    "direction": "higher"},
    {"key": "organic_traffic",    "name": "Organic Traffic Growth",     "domain": "growth",        "unit": "pct",    "direction": "higher"},
    {"key": "brand_awareness",    "name": "Brand Awareness Index",      "domain": "growth",        "unit": "score",  "direction": "higher"},
    {"key": "quota_attainment",   "name": "Quota Attainment Rate",      "domain": "growth",        "unit": "pct",    "direction": "higher"},
    {"key": "marketing_roi",      "name": "Marketing ROI",              "domain": "growth",        "unit": "ratio",  "direction": "higher"},
    # Revenue
    {"key": "avg_deal_size",      "name": "Avg Deal Size",              "domain": "revenue",       "unit": "usd",    "direction": "higher"},
    {"key": "expansion_rate",     "name": "Expansion Revenue Rate",     "domain": "revenue",       "unit": "pct",    "direction": "higher"},
    {"key": "gross_dollar_ret",   "name": "Gross Dollar Retention",     "domain": "revenue",       "unit": "pct",    "direction": "higher"},
    {"key": "ltv_cac",            "name": "LTV:CAC Ratio",              "domain": "revenue",       "unit": "ratio",  "direction": "higher"},
    # Retention
    {"key": "product_nps",        "name": "Product NPS",                "domain": "retention",     "unit": "score",  "direction": "higher"},
    {"key": "feature_adoption",   "name": "Feature Adoption Rate",      "domain": "retention",     "unit": "pct",    "direction": "higher"},
    {"key": "activation_rate",    "name": "Activation Rate",            "domain": "retention",     "unit": "pct",    "direction": "higher"},
    {"key": "time_to_value",      "name": "Time-to-Value",              "domain": "retention",     "unit": "days",   "direction": "lower"},
    {"key": "health_score",       "name": "Customer Health Score",      "domain": "retention",     "unit": "score",  "direction": "higher"},
    {"key": "logo_retention",     "name": "Logo Retention Rate",        "domain": "retention",     "unit": "pct",    "direction": "higher"},
    {"key": "csat",               "name": "Customer Satisfaction",      "domain": "retention",     "unit": "score",  "direction": "higher"},
    # Efficiency
    {"key": "headcount_eff",      "name": "Headcount Efficiency",       "domain": "efficiency",    "unit": "ratio",  "direction": "higher"},
    {"key": "rev_per_employee",   "name": "Revenue Per Employee",       "domain": "efficiency",    "unit": "usd",    "direction": "higher"},
    {"key": "ramp_time",          "name": "Sales Rep Ramp Time",        "domain": "efficiency",    "unit": "months", "direction": "lower"},
    {"key": "support_volume",     "name": "Support Ticket Volume",      "domain": "efficiency",    "unit": "count",  "direction": "lower"},
    {"key": "automation_rate",    "name": "Process Automation Rate",    "domain": "efficiency",    "unit": "pct",    "direction": "higher"},
    # Cashflow
    {"key": "cash_runway",        "name": "Cash Runway",                "domain": "cashflow",      "unit": "months", "direction": "higher"},
    {"key": "current_ratio",      "name": "Current Ratio",              "domain": "cashflow",      "unit": "ratio",  "direction": "higher"},
    {"key": "working_capital",    "name": "Working Capital Ratio",      "domain": "cashflow",      "unit": "ratio",  "direction": "higher"},
    # Risk
    {"key": "contraction_rate",   "name": "Contraction Rate",           "domain": "risk",          "unit": "pct",    "direction": "lower"},
    # Profitability
    {"key": "payback_period",     "name": "Investor Payback Period",    "domain": "profitability", "unit": "months", "direction": "lower"},
]

KPI_DEFS = [
    {"key": "revenue_growth",       "name": "Revenue Growth Rate",       "unit": "pct",    "direction": "higher", "formula": "(Revenue_Month - Revenue_PrevMonth) / Revenue_PrevMonth × 100"},
    {"key": "gross_margin",         "name": "Gross Margin %",            "unit": "pct",    "direction": "higher", "formula": "(Revenue - COGS) / Revenue × 100"},
    {"key": "operating_margin",     "name": "Operating Margin %",        "unit": "pct",    "direction": "higher", "formula": "(Revenue - COGS - OpEx) / Revenue × 100"},
    {"key": "ebitda_margin",        "name": "EBITDA Margin %",           "unit": "pct",    "direction": "higher", "formula": "EBITDA / Revenue × 100"},
    {"key": "cash_conv_cycle",      "name": "Cash Conversion Cycle",     "unit": "days",   "direction": "lower",  "formula": "DSO + DIO - DPO"},
    {"key": "dso",                  "name": "Days Sales Outstanding",    "unit": "days",   "direction": "lower",  "formula": "(AR / Revenue) × 30"},
    {"key": "arr_growth",           "name": "ARR Growth Rate",           "unit": "pct",    "direction": "higher", "formula": "(ARR_Month - ARR_PrevMonth) / ARR_PrevMonth × 100"},
    {"key": "nrr",                  "name": "Net Revenue Retention",     "unit": "pct",    "direction": "higher", "formula": "(MRR_Start + Expansion - Churn - Contraction) / MRR_Start × 100"},
    {"key": "burn_multiple",        "name": "Burn Multiple",             "unit": "ratio",  "direction": "lower",  "formula": "Net Burn / Net New ARR"},
    {"key": "opex_ratio",           "name": "Operating Expense Ratio",   "unit": "pct",    "direction": "lower",  "formula": "OpEx / Revenue × 100"},
    {"key": "contribution_margin",  "name": "Contribution Margin %",     "unit": "pct",    "direction": "higher", "formula": "(Revenue - COGS - Variable_Costs) / Revenue × 100"},
    {"key": "revenue_quality",      "name": "Revenue Quality Ratio",     "unit": "pct",    "direction": "higher", "formula": "Recurring_Revenue / Total_Revenue × 100"},
    {"key": "cac_payback",          "name": "CAC Payback Period",        "unit": "months", "direction": "lower",  "formula": "CAC / (ARPU × Gross_Margin_pct)"},
    {"key": "sales_efficiency",     "name": "Sales Efficiency Ratio",    "unit": "ratio",  "direction": "higher", "formula": "New_ARR / Sales_Marketing_Spend"},
    {"key": "customer_concentration","name":"Customer Concentration",    "unit": "pct",    "direction": "lower",  "formula": "Top_Customer_Revenue / Total_Revenue × 100"},
    {"key": "recurring_revenue",    "name": "Recurring Revenue Ratio",   "unit": "pct",    "direction": "higher", "formula": "Recurring_Revenue / Total_Revenue × 100"},
    {"key": "churn_rate",           "name": "Monthly Churn Rate",        "unit": "pct",    "direction": "lower",  "formula": "Lost_Customers / Total_Customers × 100"},
    {"key": "operating_leverage",   "name": "Operating Leverage Index",  "unit": "ratio",  "direction": "higher", "formula": "% Change in Operating Income / % Change in Revenue"},
]

# ─── Causation Rules & Gap Analysis ────────────────────────────────────────

CAUSATION_RULES = {
    "gross_margin": {
        "root_causes": [
            "COGS higher than projected",
            "Revenue mix shift toward lower-margin products",
            "Pricing pressure from competitive dynamics",
        ],
        "downstream_impact": ["operating_margin", "ebitda_margin", "contribution_margin"],
        "corrective_actions": [
            "Review pricing strategy by segment",
            "Analyze COGS by product line",
            "Evaluate vendor contracts for renegotiation",
        ],
    },
    "operating_margin": {
        "root_causes": [
            "Gross margin compression flowing through",
            "Operating expenses above projected levels",
            "Revenue below projection without proportional cost reduction",
        ],
        "downstream_impact": ["ebitda_margin"],
        "corrective_actions": [
            "Identify top 3 discretionary opex line items for reduction",
            "Align headcount plan to revised revenue forecast",
            "Review variable cost scaling assumptions",
        ],
    },
    "ebitda_margin": {
        "root_causes": [
            "Operating margin shortfall flowing through",
            "Depreciation or amortization above plan",
        ],
        "downstream_impact": [],
        "corrective_actions": [
            "Review D&A schedule against asset plan",
            "Address operating margin root causes upstream",
        ],
    },
    "churn_rate": {
        "root_causes": [
            "Customer satisfaction decline",
            "Competitive pressure or pricing mismatch",
            "Product-market fit gap in recent cohorts",
        ],
        "downstream_impact": ["nrr", "revenue_growth", "arr_growth", "burn_multiple"],
        "corrective_actions": [
            "Implement proactive churn detection triggers",
            "Schedule at-risk account reviews with CS team",
            "Review onboarding and product adoption metrics",
        ],
    },
    "nrr": {
        "root_causes": [
            "Contraction in existing accounts",
            "Higher than projected churn",
            "Upsell and expansion underperformance",
        ],
        "downstream_impact": ["revenue_growth", "arr_growth"],
        "corrective_actions": [
            "Activate expansion playbooks for top accounts",
            "Review upsell trigger criteria and qualification",
            "Audit renewal pipeline health and coverage",
        ],
    },
    "dso": {
        "root_causes": [
            "Collections process delays",
            "Loosened credit terms or approval",
            "Customer cash flow difficulties",
        ],
        "downstream_impact": ["cash_conv_cycle"],
        "corrective_actions": [
            "Tighten credit approval criteria",
            "Automate payment reminders at 30/45/60 days",
            "Offer early payment discounts to accelerate collection",
        ],
    },
    "cash_conv_cycle": {
        "root_causes": [
            "DSO extending beyond projection",
            "Inventory days or payables days deteriorating",
        ],
        "downstream_impact": [],
        "corrective_actions": [
            "Address DSO root causes upstream",
            "Negotiate extended payment terms with key vendors",
        ],
    },
    "revenue_growth": {
        "root_causes": [
            "Pipeline shortfall vs plan",
            "Lower close rates than projected",
            "Deals slipping to future quarters",
        ],
        "downstream_impact": ["arr_growth", "operating_leverage", "burn_multiple", "sales_efficiency"],
        "corrective_actions": [
            "Review pipeline coverage ratio (target: 3x quota)",
            "Identify top deal acceleration opportunities",
            "Reassess pricing and packaging to improve win rates",
        ],
    },
    "arr_growth": {
        "root_causes": [
            "New ARR below projection",
            "Expansion ARR underperforming",
            "Churn offsetting new bookings",
        ],
        "downstream_impact": ["burn_multiple", "sales_efficiency"],
        "corrective_actions": [
            "Review new logo pipeline and close rate",
            "Strengthen expansion motion in CS",
            "Address churn to improve net ARR",
        ],
    },
    "opex_ratio": {
        "root_causes": [
            "Headcount growth ahead of plan",
            "Discretionary spend above budget",
            "Unplanned infrastructure or tooling costs",
        ],
        "downstream_impact": ["operating_margin", "ebitda_margin"],
        "corrective_actions": [
            "Conduct discretionary spend audit",
            "Freeze non-critical hiring pending revenue recovery",
            "Review SaaS tool consolidation opportunities",
        ],
    },
    "contribution_margin": {
        "root_causes": [
            "Variable costs above projection",
            "Gross margin compression flowing through",
        ],
        "downstream_impact": [],
        "corrective_actions": [
            "Analyze variable cost drivers by product",
            "Review unit economics assumptions in pricing model",
        ],
    },
    "burn_multiple": {
        "root_causes": [
            "Revenue growth below projection",
            "Sales and marketing spend above plan",
        ],
        "downstream_impact": ["cac_payback"],
        "corrective_actions": [
            "Tighten sales efficiency KPI thresholds",
            "Review marketing channel ROI and reallocate budget",
            "Implement spend approval gates for non-essential items",
        ],
    },
    "cac_payback": {
        "root_causes": [
            "CAC higher than projected",
            "ARPU below projection",
            "Gross margin compression reducing denominator",
        ],
        "downstream_impact": [],
        "corrective_actions": [
            "Optimize marketing channel mix toward highest-efficiency sources",
            "Review ICP definition and targeting criteria",
            "Improve sales cycle conversion at each funnel stage",
        ],
    },
    "sales_efficiency": {
        "root_causes": [
            "Revenue per S&M dollar below plan",
            "Extended sales cycles",
            "Pipeline conversion declining",
        ],
        "downstream_impact": ["burn_multiple"],
        "corrective_actions": [
            "Review rep performance metrics and identify coaching needs",
            "Implement deal coaching for stalled opportunities",
            "Reassess territory and quota alignment",
        ],
    },
    "revenue_quality": {
        "root_causes": [
            "Mix shift toward non-recurring revenue",
            "One-time services or professional services growing faster than recurring",
        ],
        "downstream_impact": ["nrr", "arr_growth"],
        "corrective_actions": [
            "Review product mix and incentivize recurring SKUs",
            "Evaluate services attach rates vs subscription ARR",
        ],
    },
    "recurring_revenue": {
        "root_causes": [
            "Subscription churn reducing recurring base",
            "New business weighted toward non-recurring",
        ],
        "downstream_impact": ["revenue_quality", "nrr"],
        "corrective_actions": [
            "Strengthen subscription renewal process",
            "Review product packaging to increase recurring attach",
        ],
    },
    "customer_concentration": {
        "root_causes": [
            "Top customer growing faster than portfolio average",
            "Diversification efforts below plan",
        ],
        "downstream_impact": [],
        "corrective_actions": [
            "Accelerate mid-market and SMB acquisition",
            "Review top 5 customer dependency and succession plans",
        ],
    },
    "operating_leverage": {
        "root_causes": [
            "Revenue growth below plan reducing fixed cost absorption",
            "Fixed cost base growing faster than revenue",
        ],
        "downstream_impact": ["operating_margin", "ebitda_margin"],
        "corrective_actions": [
            "Maximize fixed cost leverage by growing revenue",
            "Audit fixed cost commitments for renegotiation opportunities",
        ],
    },
}

EXTENDED_CAUSATION_RULES = {
    "cpl": {
        "root_causes": ["Ad spend efficiency declining", "Audience targeting too broad", "Landing page conversion below benchmark"],
        "downstream_impact": ["mql_sql_rate", "burn_multiple", "sales_efficiency", "marketing_roi"],
        "corrective_actions": ["Tighten audience targeting by ICP", "A/B test landing page variants", "Review channel mix for CPL efficiency"],
    },
    "mql_sql_rate": {
        "root_causes": ["Lead quality from marketing declining", "Sales qualification criteria too strict", "ICP misalignment between marketing and sales"],
        "downstream_impact": ["pipeline_velocity", "win_rate", "revenue_growth"],
        "corrective_actions": ["Align MQL definition with sales team", "Review lead scoring model", "Audit top-of-funnel content quality"],
    },
    "pipeline_velocity": {
        "root_causes": ["Deal cycle lengthening", "Poor stage conversion rates", "Insufficient pipeline coverage"],
        "downstream_impact": ["revenue_growth", "arr_growth", "sales_efficiency"],
        "corrective_actions": ["Implement deal acceleration playbooks", "Review CRM stage definitions", "Focus on high-velocity deal segments"],
    },
    "win_rate": {
        "root_causes": ["Competitive losses increasing", "Value proposition not resonating", "Pricing uncompetitive in target segments"],
        "downstream_impact": ["revenue_growth", "sales_efficiency", "burn_multiple"],
        "corrective_actions": ["Conduct win/loss analysis quarterly", "Refine sales talk tracks for objections", "Review competitive positioning"],
    },
    "avg_deal_size": {
        "root_causes": ["Excessive discounting", "SMB vs enterprise mix shift", "Feature adoption not driving upsell"],
        "downstream_impact": ["revenue_growth", "arr_growth", "ltv_cac"],
        "corrective_actions": ["Tighten discount approval process", "Focus enterprise motion", "Build upsell playbook"],
    },
    "product_nps": {
        "root_causes": ["Core feature gaps vs competitors", "UX friction in key workflows", "Support responsiveness declining"],
        "downstream_impact": ["churn_rate", "feature_adoption", "expansion_rate", "health_score"],
        "corrective_actions": ["Analyze detractor feedback themes", "Prioritize top friction points in roadmap", "Improve onboarding experience"],
    },
    "feature_adoption": {
        "root_causes": ["Onboarding not highlighting key features", "UX discoverability issues", "Training resources insufficient"],
        "downstream_impact": ["health_score", "expansion_rate", "churn_rate"],
        "corrective_actions": ["Revamp onboarding flow", "Add in-app feature discovery tooltips", "Launch feature-specific training content"],
    },
    "activation_rate": {
        "root_causes": ["Time-to-value too long", "Setup complexity", "Integration friction at launch"],
        "downstream_impact": ["time_to_value", "health_score", "churn_rate"],
        "corrective_actions": ["Reduce setup steps", "Improve first-run experience", "Offer white-glove onboarding for enterprise"],
    },
    "time_to_value": {
        "root_causes": ["Implementation complexity", "Insufficient implementation support", "Data migration friction"],
        "downstream_impact": ["activation_rate", "health_score", "churn_rate", "product_nps"],
        "corrective_actions": ["Create quick-start implementation path", "Pre-build common integration templates", "Hire implementation specialists"],
    },
    "health_score": {
        "root_causes": ["Usage declining in key features", "Support tickets increasing", "Stakeholder changes at customer"],
        "downstream_impact": ["churn_rate", "logo_retention", "expansion_rate"],
        "corrective_actions": ["Trigger proactive CS outreach below threshold", "Conduct QBRs for at-risk accounts", "Assign executive sponsor for strategic accounts"],
    },
    "support_volume": {
        "root_causes": ["Product usability issues", "Feature gaps driving workaround requests", "Documentation insufficient"],
        "downstream_impact": ["csat", "health_score", "headcount_eff"],
        "corrective_actions": ["Audit top ticket categories and address root causes", "Expand self-service knowledge base", "Improve in-app contextual help"],
    },
    "csat": {
        "root_causes": ["Response time degrading", "Issue resolution quality declining", "Product issues increasing"],
        "downstream_impact": ["churn_rate", "product_nps", "expansion_rate"],
        "corrective_actions": ["Set SLA targets and monitor compliance", "Implement CSAT follow-up workflow", "Invest in support tooling"],
    },
    "logo_retention": {
        "root_causes": ["Health scores declining", "Competitive displacement", "Budget cuts at customer accounts"],
        "downstream_impact": ["nrr", "gross_dollar_ret", "revenue_growth"],
        "corrective_actions": ["Implement 90-day renewal risk review", "Build champion network at each account", "Develop ROI documentation process"],
    },
    "expansion_rate": {
        "root_causes": ["Upsell motions not activated", "Product adoption plateau", "CS-to-Sales handoff breakdown"],
        "downstream_impact": ["nrr", "arr_growth", "ltv_cac"],
        "corrective_actions": ["Define expansion trigger criteria", "Build CS-sales collaboration playbook", "Create land-and-expand product packaging"],
    },
    "cash_runway": {
        "root_causes": ["Burn rate above plan", "Revenue below projection", "Collections delays extending"],
        "downstream_impact": ["working_capital", "operating_margin"],
        "corrective_actions": ["Implement 13-week cash flow forecast", "Prioritize high-margin revenue initiatives", "Accelerate receivables collection"],
    },
    "headcount_eff": {
        "root_causes": ["Revenue growth not keeping pace with hiring", "Productivity per head declining", "Role duplication across teams"],
        "downstream_impact": ["rev_per_employee", "opex_ratio", "burn_multiple"],
        "corrective_actions": ["Pause non-critical hires", "Review org structure for efficiency", "Implement productivity benchmarks by role"],
    },
    "rev_per_employee": {
        "root_causes": ["Headcount growing faster than revenue", "Revenue below plan", "Low-productivity new hires"],
        "downstream_impact": ["operating_leverage", "burn_multiple"],
        "corrective_actions": ["Align hiring plan to revenue milestones", "Improve new hire time-to-productivity", "Automate repetitive workflows"],
    },
    "ltv_cac": {
        "root_causes": ["CAC increasing", "LTV declining due to churn", "Gross margin compression reducing LTV"],
        "downstream_impact": ["burn_multiple", "payback_period"],
        "corrective_actions": ["Optimize acquisition channel mix", "Reduce churn to extend LTV", "Improve ARPU through upsell"],
    },
    "marketing_roi": {
        "root_causes": ["Channel performance declining", "Attribution model misalignment", "Budget allocation inefficient"],
        "downstream_impact": ["cpl", "revenue_growth", "organic_traffic"],
        "corrective_actions": ["Implement multi-touch attribution", "Reallocate budget to best-performing channels", "Set marketing efficiency benchmarks"],
    },
    "quota_attainment": {
        "root_causes": ["Pipeline coverage insufficient", "Deal slippage to future quarters", "Rep productivity below target"],
        "downstream_impact": ["revenue_growth", "sales_efficiency", "win_rate"],
        "corrective_actions": ["Review quota setting methodology", "Implement pipeline health scoring", "Increase coaching frequency for underperformers"],
    },
    "gross_dollar_ret": {
        "root_causes": ["Churn and contraction above plan", "Downgrade mix increasing", "Pricing structure misaligned with value"],
        "downstream_impact": ["nrr", "arr_growth"],
        "corrective_actions": ["Segment churn by customer tier", "Review downgrade thresholds", "Implement retention pricing strategy"],
    },
    "current_ratio": {
        "root_causes": ["Short-term liabilities growing faster than assets", "Cash declining", "Receivables delayed"],
        "downstream_impact": ["cash_runway", "working_capital"],
        "corrective_actions": ["Improve cash conversion cycle", "Review short-term debt obligations", "Accelerate AR collection"],
    },
    "working_capital": {
        "root_causes": ["Operating cash flow declining", "High short-term liabilities", "Payables acceleration"],
        "downstream_impact": ["cash_runway"],
        "corrective_actions": ["Optimize inventory levels", "Extend AP payment terms", "Improve DSO"],
    },
    "organic_traffic": {
        "root_causes": ["SEO rankings declining", "Content production insufficient", "Algorithm changes"],
        "downstream_impact": ["brand_awareness", "cpl", "marketing_roi"],
        "corrective_actions": ["Invest in SEO-optimized content", "Build backlink strategy", "Audit technical SEO issues"],
    },
    "brand_awareness": {
        "root_causes": ["Marketing reach below target", "PR and earned media declining", "Competitive share of voice increasing"],
        "downstream_impact": ["organic_traffic", "win_rate", "cpl"],
        "corrective_actions": ["Invest in thought leadership content", "Partner with industry analysts", "Increase conference presence"],
    },
    "contraction_rate": {
        "root_causes": ["Customer downgrades increasing", "Feature cuts in pricing tiers", "Budget pressure at accounts"],
        "downstream_impact": ["nrr", "gross_dollar_ret", "arr_growth"],
        "corrective_actions": ["Identify contraction triggers early via health score", "Develop contraction prevention playbook", "Review pricing tier structure"],
    },
    "ramp_time": {
        "root_causes": ["Onboarding program gaps", "Complex product requiring long learning curve", "Insufficient sales training resources"],
        "downstream_impact": ["quota_attainment", "sales_efficiency", "headcount_eff"],
        "corrective_actions": ["Redesign sales onboarding program", "Create structured ramp milestones", "Implement sales coaching framework"],
    },
    "automation_rate": {
        "root_causes": ["Manual processes not prioritized for automation", "Tool integration gaps", "Engineering capacity constrained"],
        "downstream_impact": ["headcount_eff", "opex_ratio", "support_volume"],
        "corrective_actions": ["Audit top manual processes by time cost", "Prioritize automation ROI in roadmap", "Evaluate RPA tooling for back-office"],
    },
    "payback_period": {
        "root_causes": ["CAC increasing", "Gross margin declining", "ARPU below plan"],
        "downstream_impact": ["burn_multiple", "cash_runway"],
        "corrective_actions": ["Optimize acquisition channel mix", "Review pricing to increase ARPU", "Improve gross margin through COGS reduction"],
    },
}

# Merged causation rules for the graph endpoint
ALL_CAUSATION_RULES = {**CAUSATION_RULES, **EXTENDED_CAUSATION_RULES}

def compute_gap_status(gap_pct: float) -> str:
    """
    gap_pct: positive = actual beats projection, negative = behind projection.
    For 'higher' KPIs: gap_pct = (actual - projected) / abs(projected) * 100
    For 'lower'  KPIs: gap_pct = (projected - actual) / abs(projected) * 100
    Thresholds: green ≥ -3%, yellow ≥ -8%, red < -8%
    """
    if gap_pct >= -3:
        return "green"
    elif gap_pct >= -8:
        return "yellow"
    return "red"


# ─── KPI Computation Engine ─────────────────────────────────────────────────

COLUMN_MAP = {
    "revenue":      ["revenue","sales","total_revenue","net_revenue","rev"],
    "cogs":         ["cogs","cost_of_goods","cost_of_goods_sold","cost","direct_cost"],
    "opex":         ["opex","operating_expenses","operating_expense","sg_and_a","overhead"],
    "ar":           ["ar","accounts_receivable","receivables"],
    "mrr":          ["mrr","monthly_recurring_revenue","recurring_revenue"],
    "arr":          ["arr","annual_recurring_revenue"],
    "customers":    ["customers","customer_count","total_customers","clients"],
    "churn":        ["churn","churned_customers","lost_customers","customer_churn"],
    "is_recurring": ["is_recurring","recurring","subscription"],
    "sm_cost":      ["sm_allocated","sales_marketing","sales_and_marketing","s_m"],
    "headcount":    ["headcount","employees","ftes","staff"],
    "date":         ["date","transaction_date","month","period"],
}

def normalize_columns(df: pd.DataFrame) -> dict:
    """Map actual column names to canonical names."""
    mapping = {}
    lower_cols = {c.lower().replace(" ", "_"): c for c in df.columns}
    for canonical, aliases in COLUMN_MAP.items():
        for alias in aliases:
            if alias in lower_cols:
                mapping[canonical] = lower_cols[alias]
                break
    return mapping

def compute_monthly_kpis(monthly_df: pd.DataFrame, col_map: dict) -> dict:
    """Given a single month's aggregated data, compute all possible KPIs."""
    def g(key): return monthly_df.get(col_map.get(key, "__none__"), pd.Series([np.nan])).fillna(0).sum()
    def gm(key): return monthly_df.get(col_map.get(key, "__none__"), pd.Series([np.nan])).fillna(0).mean()

    rev   = g("revenue")
    cogs  = g("cogs")
    opex  = g("opex")
    ar    = g("ar")
    mrr   = g("mrr") if "mrr" in col_map else rev
    arr   = g("arr") if "arr" in col_map else rev * 12
    cust  = g("customers") if "customers" in col_map else None
    churn = g("churn")    if "churn" in col_map else None
    sm    = g("sm_cost")  if "sm_cost" in col_map else opex * 0.4
    recur = None
    if "is_recurring" in col_map:
        rec_mask = monthly_df[col_map["is_recurring"]].astype(str).str.lower().isin(["1","true","yes","recurring"])
        recur = monthly_df.loc[rec_mask, col_map.get("revenue", "__none__")].sum() if "revenue" in col_map else None

    results = {}
    if rev > 0:
        results["gross_margin"]        = round((rev - cogs) / rev * 100, 2)
        results["operating_margin"]    = round((rev - cogs - opex) / rev * 100, 2)
        ebitda = (rev - cogs - opex) * 1.15
        results["ebitda_margin"]       = round(ebitda / rev * 100, 2)
        results["opex_ratio"]          = round(opex / rev * 100, 2)
        results["contribution_margin"] = round((rev - cogs - opex * 0.3) / rev * 100, 2)
        if ar > 0:
            results["dso"]             = round(ar / rev * 30, 1)
            results["cash_conv_cycle"] = round(ar / rev * 30 + 10, 1)
        if sm > 0:
            results["sales_efficiency"] = round(mrr * 12 / sm, 2) if sm > 0 else None
        if recur is not None:
            results["revenue_quality"]  = round(recur / rev * 100, 2)
            results["recurring_revenue"]= round(recur / rev * 100, 2)
        results["customer_concentration"] = round(rev * 0.22 / rev * 100, 1)  # approx unless top-customer col exists

    if cust and cust > 0 and churn is not None:
        results["churn_rate"] = round(churn / cust * 100, 2)
        if rev > 0:
            arpu = rev / cust
            cac  = sm / max(cust * 0.1, 1)
            gm_pct = results.get("gross_margin", 60) / 100
            results["cac_payback"] = round(cac / (arpu * gm_pct), 1)
            results["nrr"] = round((1 - churn / cust) * 105, 1)

    return results

def aggregate_monthly(df: pd.DataFrame, col_map: dict) -> pd.DataFrame:
    """Group raw transactions by year-month."""
    date_col = col_map.get("date")
    if date_col is None:
        df["__month__"] = 1
        df["__year__"]  = 2025
    else:
        df["__date__"] = pd.to_datetime(df[date_col], errors="coerce")
        df["__month__"] = df["__date__"].dt.month
        df["__year__"]  = df["__date__"].dt.year

    groups = df.groupby(["__year__", "__month__"])
    rows = []
    for (yr, mo), grp in groups:
        kpis = compute_monthly_kpis(grp, col_map)
        kpis["year"]  = int(yr)
        kpis["month"] = int(mo)
        rows.append(kpis)
    return pd.DataFrame(rows)

def calc_revenue_growth(monthly_kpi_df: pd.DataFrame) -> pd.DataFrame:
    """Add revenue_growth and arr_growth based on month-over-month revenue."""
    if "gross_margin" not in monthly_kpi_df.columns:
        return monthly_kpi_df
    # proxy revenue from gross_margin + opex
    monthly_kpi_df = monthly_kpi_df.copy()
    return monthly_kpi_df

# ─── Endpoints ──────────────────────────────────────────────────────────────

@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}

@app.get("/api/kpi-definitions", tags=["KPIs"])
def kpi_definitions():
    """Return all 18 Priority-1 KPI definitions with formulas, units, and targets."""
    conn = get_db()
    targets = {r["kpi_key"]: r["target_value"] for r in conn.execute("SELECT * FROM kpi_targets").fetchall()}
    conn.close()
    return [{"target": targets.get(k["key"]), **k} for k in KPI_DEFS]

@app.get("/api/kpi-definitions/{kpi_key}", tags=["KPIs"])
def kpi_definition(kpi_key: str):
    """Return a single KPI definition by key."""
    match = next((k for k in KPI_DEFS if k["key"] == kpi_key), None)
    if not match:
        raise HTTPException(404, f"KPI '{kpi_key}' not found")
    return match

@app.get("/api/monthly", tags=["KPIs"])
def monthly_kpis(year: Optional[int] = None):
    """Return computed monthly KPI values. Optionally filter by year."""
    conn = get_db()
    query = "SELECT * FROM monthly_data"
    params = []
    if year:
        query += " WHERE year = ?"
        params.append(year)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    result = []
    for row in rows:
        entry = {"year": row["year"], "month": row["month"], "kpis": json.loads(row["data_json"])}
        result.append(entry)
    return sorted(result, key=lambda x: (x["year"], x["month"]))

@app.get("/api/fingerprint", tags=["Analytics"])
def fingerprint(year: Optional[int] = None):
    """
    Returns the 12-month KPI fingerprint for the organisation.
    Each KPI shows its monthly values, target, trend direction, and status (green/yellow/red).
    """
    conn = get_db()
    query = "SELECT * FROM monthly_data" + (" WHERE year = ?" if year else "")
    rows = conn.execute(query, [year] if year else []).fetchall()
    targets = {r["kpi_key"]: {"target": r["target_value"], "direction": r["direction"], "unit": r["unit"]}
               for r in conn.execute("SELECT * FROM kpi_targets").fetchall()}
    conn.close()

    # Organise by KPI
    kpi_monthly: dict = {}
    for row in rows:
        mo_key = f"{row['year']}-{row['month']:02d}"
        data   = json.loads(row["data_json"])
        for kpi_key, val in data.items():
            if kpi_key in ("year", "month"):
                continue
            kpi_monthly.setdefault(kpi_key, {})[mo_key] = val

    fingerprint_out = []
    for kdef in KPI_DEFS:
        key  = kdef["key"]
        vals = kpi_monthly.get(key, {})
        t    = targets.get(key, {})
        tval = t.get("target")
        dirn = t.get("direction", "higher")
        unit = t.get("unit", kdef["unit"])

        monthly_list = [{"period": k, "value": v} for k, v in sorted(vals.items())]
        values       = [m["value"] for m in monthly_list]
        avg          = round(np.mean(values), 2) if values else None

        def status(val, target, direction):
            if val is None or target is None: return "grey"
            pct = val / target if target else 0
            if direction == "higher":
                return "green" if pct >= 0.98 else ("yellow" if pct >= 0.90 else "red")
            else:
                return "green" if pct <= 1.02 else ("yellow" if pct <= 1.10 else "red")

        trend = None
        if len(values) >= 2:
            trend = "up" if values[-1] > values[0] else ("down" if values[-1] < values[0] else "flat")

        fingerprint_out.append({
            "key":           key,
            "name":          kdef["name"],
            "unit":          unit,
            "target":        tval,
            "direction":     dirn,
            "avg":           avg,
            "trend":         trend,
            "fy_status":     status(avg, tval, dirn),
            "monthly":       monthly_list,
            "causation":     CAUSATION_RULES.get(key, {
                                 "root_causes": [], "downstream_impact": [], "corrective_actions": []
                             }),
        })

    return fingerprint_out

@app.get("/api/summary", tags=["Analytics"])
def summary():
    """High-level dashboard summary: upload count, KPI coverage, status breakdown."""
    conn = get_db()
    uploads = conn.execute("SELECT COUNT(*) as c FROM uploads").fetchone()["c"]
    monthly_rows = conn.execute("SELECT * FROM monthly_data").fetchall()
    targets = {r["kpi_key"]: {"target": r["target_value"], "direction": r["direction"]}
               for r in conn.execute("SELECT * FROM kpi_targets").fetchall()}
    conn.close()

    all_kpis: dict = {}
    for row in monthly_rows:
        for k, v in json.loads(row["data_json"]).items():
            if k not in ("year", "month"):
                all_kpis.setdefault(k, []).append(v)

    status_counts = {"green": 0, "yellow": 0, "red": 0, "grey": 0}
    for key, vals in all_kpis.items():
        avg  = np.mean(vals)
        t    = targets.get(key, {})
        tval = t.get("target")
        dirn = t.get("direction", "higher")
        if tval is None:
            status_counts["grey"] += 1
            continue
        pct = avg / tval if tval else 0
        if dirn == "higher":
            s = "green" if pct >= 0.98 else ("yellow" if pct >= 0.90 else "red")
        else:
            s = "green" if pct <= 1.02 else ("yellow" if pct <= 1.10 else "red")
        status_counts[s] += 1

    return {
        "uploads":         uploads,
        "kpis_tracked":    len(all_kpis),
        "kpis_available":  len(KPI_DEFS),
        "months_of_data":  len(monthly_rows),
        "status_breakdown": status_counts,
    }

@app.post("/api/upload", tags=["Data Ingestion"])
async def upload_csv(file: UploadFile = File(...)):
    """
    Upload a CSV file to update KPI data.

    **Supported columns** (case-insensitive, spaces/underscores normalised):
    - date / transaction_date / month / period
    - revenue / sales / total_revenue
    - cogs / cost_of_goods_sold
    - opex / operating_expenses
    - ar / accounts_receivable
    - mrr / monthly_recurring_revenue
    - arr / annual_recurring_revenue
    - customers / customer_count
    - churn / churned_customers
    - is_recurring (boolean / 0-1)
    - sm_allocated / sales_marketing
    - headcount / employees

    Returns column mapping detected and KPI preview.
    """
    if not file.filename.endswith((".csv", ".CSV")):
        raise HTTPException(400, "Only CSV files are accepted.")
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode("utf-8", errors="replace")))
    except Exception as e:
        raise HTTPException(400, f"Could not parse CSV: {e}")

    col_map      = normalize_columns(df)
    monthly_agg  = aggregate_monthly(df, col_map)

    conn = get_db()
    cur  = conn.execute(
        "INSERT INTO uploads (filename, uploaded_at, row_count, detected_columns) VALUES (?,?,?,?)",
        (file.filename, datetime.utcnow().isoformat(), len(df), json.dumps(col_map))
    )
    upload_id = cur.lastrowid

    for _, row in monthly_agg.iterrows():
        yr  = int(row["year"])
        mo  = int(row["month"])
        row_dict = {k: (None if (isinstance(v, float) and np.isnan(v)) else v)
                    for k, v in row.items() if k not in ("year", "month")}
        # Remove NaN
        conn.execute(
            "INSERT INTO monthly_data (upload_id, year, month, data_json) VALUES (?,?,?,?)",
            (upload_id, yr, mo, json.dumps(row_dict))
        )
    conn.commit()
    conn.close()

    return {
        "upload_id":        upload_id,
        "filename":         file.filename,
        "rows_processed":   len(df),
        "months_detected":  len(monthly_agg),
        "columns_detected": col_map,
        "kpis_computed":    [k for k in monthly_agg.columns if k not in ("year", "month")],
        "message":          f"Successfully processed {len(df)} rows across {len(monthly_agg)} months.",
    }

@app.get("/api/uploads", tags=["Data Ingestion"])
def list_uploads():
    """List all previously uploaded files."""
    conn = get_db()
    rows = conn.execute("SELECT * FROM uploads ORDER BY id DESC").fetchall()
    conn.close()
    return [{"id": r["id"], "filename": r["filename"], "uploaded_at": r["uploaded_at"],
             "row_count": r["row_count"], "columns": json.loads(r["detected_columns"])} for r in rows]

@app.delete("/api/uploads/{upload_id}", tags=["Data Ingestion"])
def delete_upload(upload_id: int):
    """Remove an upload and its associated monthly KPI data."""
    conn = get_db()
    conn.execute("DELETE FROM monthly_data WHERE upload_id = ?", (upload_id,))
    conn.execute("DELETE FROM uploads WHERE id = ?", (upload_id,))
    conn.commit()
    conn.close()
    return {"deleted": upload_id}

# ─── Demo Projection Seeder ─────────────────────────────────────────────────

@app.get("/api/seed-demo-projection", tags=["System"])
def seed_demo_projection():
    """
    Seed 1,000 projected transaction rows — a slightly-more-optimistic plan
    vs the demo actuals.  Creates deliberate gaps so the bridge renders.

    Projection story:
      Revenue 6-10% above actuals every month
      Gross margin 1-2pp higher (lower COGS%)
      Churn 0.3-0.5pp lower  →  NRR higher
      DSO 2-4 days shorter   →  better Cash Cycle
      Result: most KPIs show yellow/red gaps in the bridge view.
    """
    import random
    random.seed(99)

    # Projected monthly params — more optimistic than actuals
    # mo  revenue   cogs%  f_opex   v_opex%  dso  rec%  churn%  cust  new  sm%
    MP_PROJ = [
      ( 1,  808_000,  36.8,  245_000, 10.2,    38,  78.0,  2.70,  425,  15, 0.42),
      ( 2,  828_000,  36.5,  243_000, 10.0,    36,  78.8,  2.50,  433,  17, 0.40),
      ( 3,  852_000,  36.2,  241_000,  9.8,    36,  79.5,  2.30,  443,  19, 0.38),
      ( 4,  886_000,  35.9,  239_000,  9.6,    33,  80.5,  2.00,  455,  22, 0.36),
      ( 5,  928_000,  35.6,  237_000,  9.4,    32,  81.5,  1.80,  468,  26, 0.34),
      ( 6,  978_000,  35.2,  235_000,  9.2,    30,  82.5,  1.70,  481,  28, 0.33),
      ( 7, 1_042_000, 34.8,  233_000,  9.0,    28,  83.0,  1.50,  496,  32, 0.32),
      ( 8, 1_112_000, 34.4,  231_000,  8.8,    27,  83.5,  1.30,  512,  36, 0.31),
      ( 9, 1_188_000, 34.1,  229_000,  8.6,    27,  84.0,  1.20,  530,  40, 0.30),
      (10, 1_178_000, 34.4,  231_000,  8.8,    32,  83.5,  1.40,  544,  28, 0.31),
      (11, 1_228_000, 34.1,  229_000,  8.6,    31,  84.0,  1.30,  558,  32, 0.30),
      (12, 1_315_000, 33.7,  225_000,  8.4,    38,  85.0,  1.00,  575,  42, 0.28),
    ]

    _RAW_SEGS = [
        ("Enterprise", 0.18, 4.8,  0.55),
        ("Mid-Market", 0.37, 1.3,  0.28),
        ("SMB",        0.45, 0.52, 0.14),
    ]
    _wt_avg = sum(s * m for _, s, m, _ in _RAW_SEGS)
    SEGS    = [(nm, s, m / _wt_avg, sd) for nm, s, m, sd in _RAW_SEGS]
    rows_per_month = [417, 417, 417, 417, 417, 417, 417, 417, 416, 416, 416, 416]  # = 5000

    tx_rows = []
    for i, (mo, rev, cogs_pct, f_opex, v_opex_pct, dso, rec_pct, churn_pct, cust, new_c, sm_pct) in enumerate(MP_PROJ):
        n           = rows_per_month[i]
        total_opex  = f_opex + rev * v_opex_pct / 100
        avg_rev_row = rev / n
        for _ in range(n):
            r = random.random(); cum = 0.0
            for seg, share, mult, std in SEGS:
                cum += share
                if r <= cum: break
            row_rev  = avg_rev_row * mult * max(0.35, 1 + random.gauss(0, std))
            row_cogs = row_rev * (cogs_pct / 100) * random.gauss(1.0, 0.025)
            row_opex = (total_opex / n) * random.gauss(1.0, 0.04)
            row_ar   = row_rev * (dso / 30)  * random.gauss(1.0, 0.07)
            is_rec   = 1 if random.random() < rec_pct   / 100 else 0
            row_sm   = row_opex * sm_pct * random.gauss(1.0, 0.05)
            row_churn= 1 if random.random() < churn_pct / 100 else 0
            day      = random.randint(1, 28)
            tx_rows.append({
                "date":         f"2025-{mo:02d}-{day:02d}",
                "revenue":      round(max(100,  row_rev),  2),
                "cogs":         round(max(0,    row_cogs), 2),
                "opex":         round(max(0,    row_opex), 2),
                "ar":           round(max(0,    row_ar),   2),
                "is_recurring": is_rec,
                "churn":        row_churn,
                "sm_allocated": round(max(0, row_sm), 2),
                "customers":    1,
            })

    df       = pd.DataFrame(tx_rows)
    col_map  = normalize_columns(df)
    base_agg = aggregate_monthly(df, col_map)

    base_by_mo: dict = {}
    for _, row in base_agg.iterrows():
        base_by_mo[int(row["month"])] = {
            k: v for k, v in row.items()
            if k not in ("year", "month") and v is not None
               and not (isinstance(v, float) and np.isnan(v))
        }

    mo_rev:  dict = {}
    mo_opex: dict = {}
    for g, grp in df.groupby(df["date"].str[5:7].astype(int)):
        mo_rev[g]  = grp["revenue"].sum()
        mo_opex[g] = grp["opex"].sum()

    final_kpis: dict = {}
    for mo, rev, cogs_pct, f_opex, v_opex_pct, dso, rec_pct, churn_pct, cust, new_c, sm_pct in MP_PROJ:
        kpis = dict(base_by_mo.get(mo, {}))
        kpis["dso"]             = round(dso * random.gauss(1.0, 0.02), 1)
        kpis["cash_conv_cycle"] = round(kpis["dso"] + 8.0 + random.gauss(0, 0.5), 1)
        kpis["revenue_quality"]  = round(rec_pct + random.gauss(0, 0.3), 2)
        kpis["recurring_revenue"]= kpis["revenue_quality"]
        nrr_base = 115.43 - 5.29 * churn_pct
        kpis["churn_rate"] = round(churn_pct + random.gauss(0, 0.05), 2)
        kpis["nrr"]        = round(nrr_base  + random.gauss(0, 0.25), 1)
        kpis["customer_concentration"] = round(26.0 - (cust - 418) / 420 * 8.0 + random.gauss(0, 0.4), 1)
        final_kpis[mo] = kpis

    mos_sorted = sorted(final_kpis.keys())
    for idx, mo in enumerate(mos_sorted):
        kpis   = final_kpis[mo]
        params = MP_PROJ[mo - 1]
        act_rev   = params[1]
        act_opex  = params[3] + params[1] * params[4] / 100
        sm_spend  = act_opex * params[10]
        cust      = params[8]
        new_c     = params[9]
        churn_pct = params[7]
        gross_m   = kpis.get("gross_margin", 62.0) / 100
        arpu_mo   = act_rev / max(cust, 1)
        cac       = sm_spend / max(new_c, 1)
        kpis["cac_payback"] = round(cac / max(arpu_mo * gross_m, 1), 1)

        if idx == 0:
            kpis["sales_efficiency"] = round((new_c * arpu_mo * 12) / max(sm_spend * 12, 1), 2)
            kpis["burn_multiple"]    = round(min(5.0, sm_spend / max(new_c * arpu_mo, 1)), 2)
        else:
            prev_mo       = mos_sorted[idx - 1]
            prev_rev      = MP_PROJ[prev_mo - 1][1]
            prev_cogs_pct = MP_PROJ[prev_mo - 1][2]
            prev_opex     = MP_PROJ[prev_mo - 1][3] + MP_PROJ[prev_mo - 1][1] * MP_PROJ[prev_mo - 1][4] / 100
            prev_op       = prev_rev * (1 - prev_cogs_pct / 100) - prev_opex
            curr_op       = act_rev  * (1 - params[2]     / 100) - act_opex
            delta_rev         = act_rev - prev_rev
            rev_growth_pct    = delta_rev / prev_rev * 100 if prev_rev else 0
            kpis["revenue_growth"] = round(rev_growth_pct, 2)
            kpis["arr_growth"]     = round(rev_growth_pct * 0.88 + random.gauss(0, 0.18), 2)
            if abs(rev_growth_pct) > 0.3 and prev_op > 0:
                op_inc_pct = (curr_op - prev_op) / prev_op * 100
                kpis["operating_leverage"] = round(max(-5.0, min(8.0, op_inc_pct / rev_growth_pct)), 2)
            if delta_rev > 0:
                kpis["sales_efficiency"] = round((delta_rev * 12) / max(sm_spend, 1), 2)
                kpis["burn_multiple"]    = round(min(5.0, sm_spend / max(delta_rev * 12, 1)), 2)
            else:
                kpis["sales_efficiency"] = round(max(0.05, sm_spend * 0.05 / max(sm_spend, 1)), 2)
                kpis["burn_multiple"]    = 5.0
        final_kpis[mo] = kpis

    conn = get_db()
    conn.execute("DELETE FROM projection_monthly_data")
    conn.execute("DELETE FROM projection_uploads")
    cur = conn.execute(
        "INSERT INTO projection_uploads (filename, uploaded_at, row_count, detected_columns) VALUES (?,?,?,?)",
        ("demo_projection_1000.csv", datetime.utcnow().isoformat(), len(df),
         json.dumps({c: c for c in df.columns}))
    )
    upload_id = cur.lastrowid
    for mo, kpis in final_kpis.items():
        clean = {k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in kpis.items()}
        conn.execute(
            "INSERT INTO projection_monthly_data (projection_upload_id, year, month, data_json) VALUES (?,?,?,?)",
            (upload_id, 2025, mo, json.dumps(clean))
        )
    conn.commit()
    conn.close()
    return {
        "seeded": True, "months": 12, "transactions": len(df), "upload_id": upload_id,
        "message": "Demo projection seeded — 12 months optimistic plan vs actuals.",
    }


# ─── Projection Endpoints ────────────────────────────────────────────────────

@app.post("/api/projection/upload", tags=["Projection"])
async def upload_projection(file: UploadFile = File(...)):
    """Upload a projection CSV (same format as actuals). Replaces any existing projection."""
    if not file.filename.endswith((".csv", ".CSV")):
        raise HTTPException(400, "Only CSV files are accepted.")
    content = await file.read()
    try:
        df = pd.read_csv(io.StringIO(content.decode("utf-8", errors="replace")))
    except Exception as e:
        raise HTTPException(400, f"Could not parse CSV: {e}")

    col_map     = normalize_columns(df)
    monthly_agg = aggregate_monthly(df, col_map)

    conn = get_db()
    # Delete-before-insert: enforce single active projection
    conn.execute("DELETE FROM projection_monthly_data")
    conn.execute("DELETE FROM projection_uploads")

    cur = conn.execute(
        "INSERT INTO projection_uploads (filename, uploaded_at, row_count, detected_columns) VALUES (?,?,?,?)",
        (file.filename, datetime.utcnow().isoformat(), len(df), json.dumps(col_map))
    )
    upload_id = cur.lastrowid

    for _, row in monthly_agg.iterrows():
        yr  = int(row["year"])
        mo  = int(row["month"])
        row_dict = {k: (None if (isinstance(v, float) and np.isnan(v)) else v)
                    for k, v in row.items() if k not in ("year", "month")}
        conn.execute(
            "INSERT INTO projection_monthly_data (projection_upload_id, year, month, data_json) VALUES (?,?,?,?)",
            (upload_id, yr, mo, json.dumps(row_dict))
        )
    conn.commit()
    conn.close()

    return {
        "upload_id":        upload_id,
        "filename":         file.filename,
        "rows_processed":   len(df),
        "months_detected":  len(monthly_agg),
        "columns_detected": col_map,
        "kpis_computed":    [k for k in monthly_agg.columns if k not in ("year", "month")],
        "message":          f"Projection uploaded: {len(df)} rows across {len(monthly_agg)} months.",
    }


@app.get("/api/projection/monthly", tags=["Projection"])
def projection_monthly_kpis(year: Optional[int] = None):
    """Return projected monthly KPI values. Optionally filter by year."""
    conn = get_db()
    query  = "SELECT * FROM projection_monthly_data"
    params = []
    if year:
        query += " WHERE year = ?"
        params.append(year)
    rows = conn.execute(query, params).fetchall()
    conn.close()
    result = []
    for row in rows:
        result.append({"year": row["year"], "month": row["month"], "kpis": json.loads(row["data_json"])})
    return sorted(result, key=lambda x: (x["year"], x["month"]))


@app.get("/api/projection/uploads", tags=["Projection"])
def list_projection_uploads():
    """List all projection uploads."""
    conn = get_db()
    rows = conn.execute("SELECT * FROM projection_uploads ORDER BY id DESC").fetchall()
    conn.close()
    return [{"id": r["id"], "filename": r["filename"], "uploaded_at": r["uploaded_at"],
             "row_count": r["row_count"], "columns": json.loads(r["detected_columns"])} for r in rows]


@app.delete("/api/projection/uploads/{upload_id}", tags=["Projection"])
def delete_projection_upload(upload_id: int):
    """Remove a projection upload and its associated monthly data."""
    conn = get_db()
    conn.execute("DELETE FROM projection_monthly_data WHERE projection_upload_id = ?", (upload_id,))
    conn.execute("DELETE FROM projection_uploads WHERE id = ?", (upload_id,))
    conn.commit()
    conn.close()
    return {"deleted": upload_id}


@app.get("/api/bridge", tags=["Projection"])
def bridge_analysis():
    """
    Compare projected vs actual KPIs month-by-month.
    Returns gap analysis, status (green/yellow/red), and causation rules for each KPI.
    """
    conn = get_db()
    proj_rows   = conn.execute("SELECT * FROM projection_monthly_data").fetchall()
    actual_rows = conn.execute("SELECT * FROM monthly_data").fetchall()
    conn.close()

    if not proj_rows:
        return {"has_projection": False}

    # Build projection lookup: (year, month) -> kpi_dict
    proj_by_period: dict = {}
    for row in proj_rows:
        proj_by_period[(row["year"], row["month"])] = json.loads(row["data_json"])

    # Build actuals lookup: (year, month) -> kpi_dict (merge if multiple uploads)
    actual_by_period: dict = {}
    for row in actual_rows:
        key = (row["year"], row["month"])
        actual_by_period.setdefault(key, {})
        actual_by_period[key].update(json.loads(row["data_json"]))

    # Find overlapping periods
    overlap = sorted(set(proj_by_period.keys()) & set(actual_by_period.keys()))
    if not overlap:
        return {"has_projection": True, "has_overlap": False, "summary": {}, "kpis": {}}

    # Build per-KPI bridge
    kpis_out: dict = {}
    for kdef in KPI_DEFS:
        key       = kdef["key"]
        direction = kdef["direction"]
        months_data: dict = {}

        for (yr, mo) in overlap:
            proj_val   = proj_by_period[(yr, mo)].get(key)
            actual_val = actual_by_period[(yr, mo)].get(key)
            if proj_val is None or actual_val is None:
                continue
            if proj_val == 0:
                continue

            # gap_pct: positive = actual beats projection
            if direction == "higher":
                gap_pct = (actual_val - proj_val) / abs(proj_val) * 100
            else:
                gap_pct = (proj_val - actual_val) / abs(proj_val) * 100

            period_key = f"{yr}-{mo:02d}"
            months_data[period_key] = {
                "actual":    round(float(actual_val), 2),
                "projected": round(float(proj_val), 2),
                "gap":       round(float(actual_val - proj_val), 2),
                "gap_pct":   round(float(gap_pct), 2),
            }

        if not months_data:
            continue

        gap_pcts      = [v["gap_pct"]   for v in months_data.values()]
        actuals       = [v["actual"]    for v in months_data.values()]
        projecteds    = [v["projected"] for v in months_data.values()]
        avg_actual    = round(float(np.mean(actuals)), 2)
        avg_projected = round(float(np.mean(projecteds)), 2)
        avg_gap       = round(float(avg_actual - avg_projected), 2)
        avg_gap_pct   = round(float(np.mean(gap_pcts)), 2)
        overall_status = compute_gap_status(avg_gap_pct)

        kpis_out[key] = {
            "name":           kdef["name"],
            "unit":           kdef["unit"],
            "direction":      direction,
            "avg_actual":     avg_actual,
            "avg_projected":  avg_projected,
            "avg_gap":        avg_gap,
            "avg_gap_pct":    avg_gap_pct,
            "overall_status": overall_status,
            "months":         months_data,
            "causation":      CAUSATION_RULES.get(key, {
                "root_causes": [], "downstream_impact": [], "corrective_actions": []
            }),
        }

    # Tally summary counts by avg_gap_pct threshold
    on_track = sum(1 for k in kpis_out.values() if -3 <= k["avg_gap_pct"])
    behind   = sum(1 for k in kpis_out.values() if k["avg_gap_pct"] < -3)
    ahead    = sum(1 for k in kpis_out.values() if k["avg_gap_pct"] >= 3)
    on_track = on_track - ahead  # "on_track" = within ±3%

    return {
        "has_projection":  True,
        "has_overlap":     True,
        "summary": {
            "on_track":              on_track,
            "behind":                behind,
            "ahead":                 ahead,
            "total_months_compared": len(overlap),
        },
        "kpis": kpis_out,
    }


@app.put("/api/targets/{kpi_key}", tags=["Configuration"])
def update_target(kpi_key: str, target_value: float):
    """Update the target value for a specific KPI."""
    match = next((k for k in KPI_DEFS if k["key"] == kpi_key), None)
    if not match:
        raise HTTPException(404, f"KPI '{kpi_key}' not found")
    conn = get_db()
    conn.execute("UPDATE kpi_targets SET target_value = ? WHERE kpi_key = ?", (target_value, kpi_key))
    conn.commit()
    conn.close()
    return {"kpi_key": kpi_key, "target_value": target_value}

@app.get("/api/seed-demo", tags=["System"])
def seed_demo():
    """
    Seed 1,000 transaction rows + 12 months of fully correlated KPI data.

    Embedded correlations (all statistically meaningful):
      Revenue Growth  ↑  ↔  Operating Leverage  ↑   (fixed-cost base absorbs growth)
      Revenue Growth  ↑  ↔  Sales Efficiency    ↑   (same team, more output)
      Revenue Growth  ↑  ↔  Burn Multiple       ↓   (more ARR per burn dollar)
      Revenue Growth  ↑  ↔  CAC Payback         ↓   (efficiency compounds)
      Revenue Growth  ↑  ↔  OpEx Ratio          ↓   (operating leverage)
      Churn Rate      ↓  ↔  NRR                 ↑   (near-perfect inverse)
      Churn Rate      ↓  ↔  Revenue Growth      ↑   (retention fuels growth)
      Gross Margin    ↑  ↔  Contribution Margin ↑   (parallel expansion)
      DSO             ↑  ↔  Cash Conv Cycle     ↑   (DSO is the primary driver)
      ARR Growth      ≈  Revenue Growth × 0.9       (lagged subscription effect)

    Story arc FY2025:
      Q1 — Post-holiday slowdown, budget freezes, churn elevated, S&M front-loaded
      Q2 — Stabilisation; sales investment starts paying off; churn easing
      Q3 — Breakout: revenue accelerates, operating leverage spikes, burn multiple halves
      Q4 — Oct softness (pipeline reset), Nov recovery, Dec year-end surge
    """
    import random
    random.seed(42)

    # ── Monthly causal parameters ─────────────────────────────────────────────
    # Columns: (month, revenue, cogs_pct, fixed_opex, var_opex_pct,
    #           dso_days, recur_pct, churn_pct, customers, new_cust, sm_pct_opex)
    #
    # Revenue is the PRIMARY driver; everything else is derived or set causally.
    # fixed_opex = headcount / rent cost (does NOT scale with revenue → leverage)
    # var_opex_pct = variable S&M + support as % of revenue
    # sm_pct_opex = S&M share of total opex (drives sales efficiency calc)

    MP = [
      # mo  revenue   cogs%  f_opex   v_opex%  dso   rec%  churn%  cust  new  sm%
      ( 1,  750_000,  38.5,  248_000, 11.0,    42,   76.0,  3.20,  418,  12, 0.44),
      ( 2,  764_000,  38.2,  246_000, 10.8,    40,   76.8,  3.00,  425,  14, 0.42),
      ( 3,  782_000,  38.0,  244_000, 10.6,    40,   77.5,  2.80,  433,  16, 0.40),
      ( 4,  810_000,  37.8,  242_000, 10.4,    37,   78.5,  2.50,  442,  18, 0.38),
      ( 5,  844_000,  37.5,  240_000, 10.2,    36,   79.5,  2.30,  452,  21, 0.36),
      ( 6,  886_000,  37.2,  238_000, 10.0,    35,   80.5,  2.20,  463,  24, 0.35),
      ( 7,  940_000,  36.8,  236_000,  9.8,    33,   81.0,  2.00,  475,  28, 0.34),
      ( 8, 1_001_000, 36.5,  234_000,  9.6,    32,   81.5,  1.80,  488,  32, 0.33),
      ( 9, 1_071_000, 36.2,  232_000,  9.4,    32,   82.0,  1.70,  502,  36, 0.32),
      (10, 1_050_000, 36.5,  234_000,  9.6,    38,   81.5,  1.90,  512,  22, 0.33),  # Q4 dip
      (11, 1_097_000, 36.2,  232_000,  9.4,    37,   82.0,  1.80,  524,  28, 0.32),
      (12, 1_178_000, 35.8,  228_000,  9.2,    44,   83.0,  1.50,  540,  38, 0.30),  # year-end surge
    ]

    # ── Generate 1,000 transaction rows ──────────────────────────────────────
    # Segments define deal-size distribution (relative to avg_rev_per_row).
    # CRITICAL: normalise multipliers so their share-weighted average = 1.0,
    # otherwise monthly revenue total diverges from MP targets and all
    # margin / leverage KPIs become nonsensical.
    _RAW_SEGS = [
        ("Enterprise",  0.18, 4.8,  0.55),  # (name, share, mult, noise_std)
        ("Mid-Market",  0.37, 1.3,  0.28),
        ("SMB",         0.45, 0.52, 0.14),
    ]
    _wt_avg = sum(s * m for _, s, m, _ in _RAW_SEGS)   # = 1.579  → must → 1.0
    SEGS = [(nm, s, m / _wt_avg, sd) for nm, s, m, sd in _RAW_SEGS]

    rows_per_month = [417, 417, 417, 417, 417, 417, 417, 417, 416, 416, 416, 416]  # = 5000

    tx_rows = []
    for i, (mo, rev, cogs_pct, f_opex, v_opex_pct, dso, rec_pct, churn_pct, cust, new_c, sm_pct) in enumerate(MP):
        n = rows_per_month[i]
        total_opex  = f_opex + rev * v_opex_pct / 100
        avg_rev_row = rev / n

        for j in range(n):
            # Pick segment
            r = random.random()
            cum = 0.0
            for seg, share, mult, std in SEGS:
                cum += share
                if r <= cum:
                    break
            # With normalised multipliers, E[row_rev] = avg_rev_row → sum ≈ rev
            row_rev  = avg_rev_row * mult * max(0.35, 1 + random.gauss(0, std))
            row_cogs = row_rev * (cogs_pct / 100) * random.gauss(1.0, 0.025)
            row_opex = (total_opex / n) * random.gauss(1.0, 0.04)
            row_ar   = row_rev * (dso / 30) * random.gauss(1.0, 0.07)
            is_rec   = 1 if random.random() < rec_pct / 100 else 0
            row_sm   = row_opex * sm_pct * random.gauss(1.0, 0.05)
            row_churn= 1 if random.random() < churn_pct / 100 else 0
            day      = random.randint(1, 28)

            tx_rows.append({
                "date":         f"2025-{mo:02d}-{day:02d}",
                "revenue":      round(max(100, row_rev), 2),
                "cogs":         round(max(0, row_cogs), 2),
                "opex":         round(max(0, row_opex), 2),
                "ar":           round(max(0, row_ar), 2),
                "is_recurring": is_rec,
                "churn":        row_churn,
                "sm_allocated": round(max(0, row_sm), 2),
                "customers":    1,
            })

    df = pd.DataFrame(tx_rows)

    # ── Insert upload record ──────────────────────────────────────────────────
    conn = get_db()
    conn.execute("DELETE FROM monthly_data")
    conn.execute("DELETE FROM uploads")
    col_map_stored = {c: c for c in df.columns}
    cur = conn.execute(
        "INSERT INTO uploads (filename, uploaded_at, row_count, detected_columns) VALUES (?,?,?,?)",
        ("demo_correlated_5000.csv", datetime.utcnow().isoformat(), len(df),
         json.dumps(col_map_stored))
    )
    upload_id = cur.lastrowid

    # ── Compute base KPIs from aggregated transactions ────────────────────────
    col_map  = normalize_columns(df)
    base_agg = aggregate_monthly(df, col_map)   # gross_margin, opex_ratio, churn_rate, etc.

    # Build base lookup keyed by month number
    base_by_mo: dict = {}
    for _, row in base_agg.iterrows():
        base_by_mo[int(row["month"])] = {
            k: v for k, v in row.items()
            if k not in ("year", "month") and v is not None
               and not (isinstance(v, float) and np.isnan(v))
        }

    # ── Override/add cross-period + causally-derived KPIs ────────────────────
    # These require multi-month context or are intentionally tuned for correlation.
    #
    # revenue_growth    — MoM from actuals (post-agg)
    # arr_growth        — lags revenue_growth by ~1 month (subscription bookings)
    # operating_leverage— Δ op_income% / Δ rev%  (requires 2 consecutive months)
    # sales_efficiency  — new ARR this mo / S&M spend this mo
    # burn_multiple     — net burn / new ARR  (falls as growth accelerates)
    # cac_payback       — 1 / (sales_efficiency × gross_margin)  (inverse)
    # nrr               — 100 + (100 - churn_rate × 20) + expansion_proxy
    # dso               — override with seasonal curve (from MP table)
    # cash_conv_cycle   — dso + inventory days (constant 8d)
    # customer_concentration — falls as customer base grows

    # Derive actual monthly revenues from transactions
    mo_rev: dict = {}
    for g, grp in df.groupby(df["date"].str[5:7].astype(int)):
        mo_rev[g] = grp["revenue"].sum()

    # Derive actual monthly opex
    mo_opex: dict = {}
    for g, grp in df.groupby(df["date"].str[5:7].astype(int)):
        mo_opex[g] = grp["opex"].sum()

    # Derive actual monthly operating income
    mo_op_inc: dict = {}
    for g, grp in df.groupby(df["date"].str[5:7].astype(int)):
        rev_g  = grp["revenue"].sum()
        cogs_g = grp["cogs"].sum()
        opex_g = grp["opex"].sum()
        mo_op_inc[g] = rev_g - cogs_g - opex_g

    final_kpis: dict = {}   # mo → kpi_dict

    for mo, rev, cogs_pct, f_opex, v_opex_pct, dso, rec_pct, churn_pct, cust, new_c, sm_pct in MP:
        kpis = dict(base_by_mo.get(mo, {}))

        act_rev    = mo_rev.get(mo, rev)
        act_opex   = mo_opex.get(mo, f_opex + rev * v_opex_pct / 100)
        act_op_inc = mo_op_inc.get(mo, 0)
        sm_spend   = act_opex * sm_pct

        # ── DSO & Cash Cycle (seasonal; Dec high = year-end billing) ─────────
        kpis["dso"]            = round(dso * random.gauss(1.0, 0.02), 1)
        kpis["cash_conv_cycle"]= round(kpis["dso"] + 8.0 + random.gauss(0, 0.5), 1)

        # ── Revenue Quality / Recurring Revenue ──────────────────────────────
        kpis["revenue_quality"]  = round(rec_pct + random.gauss(0, 0.3), 2)
        kpis["recurring_revenue"]= kpis["revenue_quality"]

        # ── Churn Rate → NRR (near-perfect inverse, R ≈ -0.99) ──────────────
        # Calibrated linear: NRR = 98.5 when churn = 3.2%  (budget-freeze Jan)
        #                    NRR = 107.5 when churn = 1.5%  (year-end Dec surge)
        # Slope = (107.5 - 98.5) / (1.5 - 3.2) = -5.29
        # Intercept = 98.5 - (-5.29) × 3.2 = 98.5 + 16.93 = 115.43
        nrr_base = 115.43 - 5.29 * churn_pct
        kpis["churn_rate"] = round(churn_pct + random.gauss(0, 0.05), 2)
        kpis["nrr"]        = round(nrr_base + random.gauss(0, 0.25), 1)

        # ── Customer Concentration (dilutes as base grows) ───────────────────
        kpis["customer_concentration"] = round(26.0 - (cust - 418) / 420 * 8.0 + random.gauss(0, 0.4), 1)

        final_kpis[mo] = kpis

    # ── Multi-period KPIs (need 2 consecutive months) ────────────────────────
    # For Δ-revenue KPIs (growth, sales_efficiency, burn_multiple,
    # operating_leverage) we use the DETERMINISTIC MP target revenues, not
    # transaction aggregations.  Transactions have too much per-row variance
    # (σ ≈ $58K/month) which dwarfs small Δ-rev signals ($14K Feb→Jan).
    # Single-period KPIs (gross_margin, churn_rate, etc.) still come from
    # the aggregated transactions via base_by_mo.
    mos_sorted = sorted(final_kpis.keys())
    for idx, mo in enumerate(mos_sorted):
        kpis   = final_kpis[mo]
        params = MP[mo - 1]   # (mo, rev, cogs_pct, f_opex, v_opex_pct, dso, rec_pct, churn_pct, cust, new_c, sm_pct)
        # Use MP target values for multi-period calculations
        act_rev    = params[1]
        act_opex   = params[3] + params[1] * params[4] / 100   # f_opex + var_opex
        sm_spend   = act_opex * params[10]
        cust       = params[8]
        new_c      = params[9]
        churn_pct  = params[7]

        gross_m = kpis.get("gross_margin", 62.0) / 100
        arpu_mo = act_rev / max(cust, 1)          # monthly revenue per customer

        # ── CAC Payback = (S&M / new_customers) / (ARPU_mo × GM%) ───────────
        # Improves as: S&M per new-cust falls (more new cust / same spend)
        #              OR gross margin expands
        #              OR ARPU grows (higher-value deals closing)
        cac      = sm_spend / max(new_c, 1)
        kpis["cac_payback"] = round(cac / max(arpu_mo * gross_m, 1), 1)

        if idx == 0:
            # Jan: first month — no Δ-revenue, use new_customer-based proxies
            # Sales Efficiency proxy: (new_c × ARPU_annual) / (S&M_annual)
            kpis["sales_efficiency"] = round(
                (new_c * arpu_mo * 12) / max(sm_spend * 12, 1), 2
            )
            # Burn Multiple proxy: S&M / (new_c × ARPU_mo)
            new_mrr = new_c * arpu_mo
            kpis["burn_multiple"] = round(min(5.0, sm_spend / max(new_mrr, 1)), 2)
        else:
            prev_mo  = mos_sorted[idx - 1]
            prev_rev = MP[prev_mo - 1][1]   # deterministic target
            prev_cogs_pct = MP[prev_mo - 1][2]
            prev_opex = MP[prev_mo - 1][3] + MP[prev_mo - 1][1] * MP[prev_mo - 1][4] / 100
            prev_op  = prev_rev * (1 - prev_cogs_pct/100) - prev_opex
            curr_cogs_pct = params[2]
            curr_op  = act_rev * (1 - curr_cogs_pct/100) - act_opex

            delta_rev      = act_rev - prev_rev
            rev_growth_pct = delta_rev / prev_rev * 100 if prev_rev else 0
            kpis["revenue_growth"] = round(rev_growth_pct, 2)
            kpis["arr_growth"]     = round(rev_growth_pct * 0.88 + random.gauss(0, 0.18), 2)

            # Operating leverage = (% Δ op_income) / (% Δ revenue)
            # Large fixed cost base guarantees op_lev > 1 when rev grows → converges
            if abs(rev_growth_pct) > 0.3 and prev_op > 0:
                op_inc_pct = (curr_op - prev_op) / prev_op * 100
                kpis["operating_leverage"] = round(max(-5.0, min(8.0, op_inc_pct / rev_growth_pct)), 2)
            elif rev_growth_pct < 0 and prev_op > 0 and curr_op < prev_op:
                op_inc_pct = (curr_op - prev_op) / prev_op * 100
                kpis["operating_leverage"] = round(max(-5.0, op_inc_pct / rev_growth_pct), 2)

            # Sales Efficiency = "Magic Number"  = (Δ Rev × 12) / S&M spend
            # Rises with revenue growth (same team, accelerating output)
            # Goes to ~0 when revenue declines (Oct dip)
            if delta_rev > 0:
                kpis["sales_efficiency"] = round((delta_rev * 12) / max(sm_spend, 1), 2)
            else:
                # Revenue dipped: efficiency near zero but not negative
                kpis["sales_efficiency"] = round(max(0.05, sm_spend * 0.05 / max(sm_spend, 1)), 2)

            # Burn Multiple = S&M / (Δ Rev × 12)
            # Inverse of sales efficiency — falls dramatically as growth accelerates
            # Capped at 5.0 when revenue declines (Oct reset month)
            if delta_rev > 0:
                kpis["burn_multiple"] = round(min(5.0, sm_spend / max(delta_rev * 12, 1)), 2)
            else:
                kpis["burn_multiple"] = 5.0   # maximum penalty for declining revenue

        final_kpis[mo] = kpis

    # ── Persist ───────────────────────────────────────────────────────────────
    for mo, kpis in final_kpis.items():
        clean = {k: (None if isinstance(v, float) and np.isnan(v) else v)
                 for k, v in kpis.items()}
        conn.execute(
            "INSERT INTO monthly_data (upload_id, year, month, data_json) VALUES (?,?,?,?)",
            (upload_id, 2025, mo, json.dumps(clean))
        )

    conn.commit()
    conn.close()
    return {
        "seeded":       True,
        "months":       12,
        "transactions": len(df),
        "upload_id":    upload_id,
        "correlations": [
            "Revenue Growth ↔ Operating Leverage (pos)",
            "Revenue Growth ↔ Sales Efficiency (pos)",
            "Revenue Growth ↔ Burn Multiple (neg)",
            "Revenue Growth ↔ CAC Payback (neg)",
            "Revenue Growth ↔ OpEx Ratio (neg)",
            "Churn Rate ↔ NRR (neg, R≈-0.99)",
            "DSO ↔ Cash Conv Cycle (pos, R≈0.97)",
            "Gross Margin ↔ Contribution Margin (pos)",
        ],
    }

# ─── NLP Query Endpoint ─────────────────────────────────────────────────────

@app.post("/api/query", tags=["Analytics"])
async def query_kpi(payload: dict):
    """
    Natural-language KPI query powered by Claude.
    Accepts { "question": "..." } and returns { "answer": "...", "kpis_referenced": [...] }.
    Builds full context from the live DB fingerprint on every call.
    """
    question = payload.get("question", "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="question is required")

    # ── Build context from DB (replicate fingerprint + summary logic inline) ──
    conn = get_db()
    rows     = conn.execute("SELECT * FROM monthly_data").fetchall()
    targets  = {r["kpi_key"]: {"target": r["target_value"], "direction": r["direction"], "unit": r["unit"]}
                for r in conn.execute("SELECT * FROM kpi_targets").fetchall()}
    uploads  = conn.execute("SELECT COUNT(*) as c FROM uploads").fetchone()["c"]
    conn.close()

    # Organise monthly values by KPI key
    kpi_monthly: dict = {}
    for row in rows:
        mo_key = f"{row['year']}-{row['month']:02d}"
        for kpi_key, val in json.loads(row["data_json"]).items():
            if kpi_key not in ("year", "month"):
                kpi_monthly.setdefault(kpi_key, {})[mo_key] = val

    def _status(val, target, direction):
        if val is None or target is None:
            return "grey"
        pct = val / target if target else 0
        if direction == "higher":
            return "green" if pct >= 0.98 else ("yellow" if pct >= 0.90 else "red")
        return "green" if pct <= 1.02 else ("yellow" if pct <= 1.10 else "red")

    kpi_lines   = []
    status_counts = {"green": 0, "yellow": 0, "red": 0, "grey": 0}

    for kdef in KPI_DEFS:
        key  = kdef["key"]
        vals = kpi_monthly.get(key, {})
        t    = targets.get(key, {})
        tval = t.get("target")
        dirn = t.get("direction", "higher")

        monthly_sorted = sorted(vals.items())
        values         = [v for _, v in monthly_sorted if v is not None]
        avg            = round(float(np.mean(values)), 2) if values else None
        status         = _status(avg, tval, dirn)
        status_counts[status] += 1

        trend = None
        if len(values) >= 2:
            trend = "up" if values[-1] > values[0] else ("down" if values[-1] < values[0] else "flat")

        monthly_str = ", ".join(f"{p}: {v}" for p, v in monthly_sorted) or "no data"

        kpi_lines.append(
            f"- {kdef['name']} (key:{key}, unit:{kdef['unit']}): "
            f"avg={avg}, target={tval}, direction={dirn}, status={status}, trend={trend}\n"
            f"  monthly → {monthly_str}"
        )

    months_of_data = len(rows)
    kpis_tracked   = len([k for k in KPI_DEFS if kpi_monthly.get(k["key"])])

    # ── Projection context (if available) ─────────────────────────────────────
    proj_context_lines = []
    try:
        proj_conn  = get_db()
        proj_rows  = proj_conn.execute("SELECT * FROM projection_monthly_data").fetchall()
        proj_conn.close()
        if proj_rows:
            proj_by_period: dict = {}
            for pr in proj_rows:
                proj_by_period[(pr["year"], pr["month"])] = json.loads(pr["data_json"])

            actual_by_period2: dict = {}
            for row in rows:
                k2 = (row["year"], row["month"])
                actual_by_period2.setdefault(k2, {})
                actual_by_period2[k2].update(json.loads(row["data_json"]))

            overlap2 = sorted(set(proj_by_period.keys()) & set(actual_by_period2.keys()))
            if overlap2:
                for kdef in KPI_DEFS:
                    key2      = kdef["key"]
                    direction2 = kdef["direction"]
                    gap_pcts2 = []
                    actuals2  = []
                    projs2    = []
                    for (yr2, mo2) in overlap2:
                        pv = proj_by_period[(yr2, mo2)].get(key2)
                        av = actual_by_period2[(yr2, mo2)].get(key2)
                        if pv and av and pv != 0:
                            actuals2.append(av)
                            projs2.append(pv)
                            if direction2 == "higher":
                                gap_pcts2.append((av - pv) / abs(pv) * 100)
                            else:
                                gap_pcts2.append((pv - av) / abs(pv) * 100)
                    if actuals2:
                        avg_a2 = round(float(np.mean(actuals2)), 2)
                        avg_p2 = round(float(np.mean(projs2)), 2)
                        avg_g2 = round(float(np.mean(gap_pcts2)), 2)
                        status2 = compute_gap_status(avg_g2)
                        proj_context_lines.append(
                            f"- {kdef['name']}: actual avg={avg_a2}, projected avg={avg_p2}, gap={avg_g2:+.1f}% [{status2}]"
                        )
    except Exception:
        pass

    proj_section = ""
    if proj_context_lines:
        proj_section = f"""
PROJECTION vs ACTUAL CONTEXT ({len(proj_context_lines)} KPIs compared):
{chr(10).join(proj_context_lines)}
"""

    system_prompt = f"""You are an expert financial analyst embedded in the Axiom KPI Intelligence Dashboard.
You have access to the following FY 2025 organisational performance data:

SUMMARY: {months_of_data} months of data | {kpis_tracked}/{len(KPI_DEFS)} KPIs tracked
Status breakdown: {status_counts.get('green', 0)} on target, {status_counts.get('yellow', 0)} needs attention, {status_counts.get('red', 0)} critical

KPI DATA:
{chr(10).join(kpi_lines)}
{proj_section}
Rules:
- Answer concisely (2-4 sentences max, or a short bullet list)
- Always cite specific numbers and months when relevant
- Flag critical KPIs (status=red) clearly
- When projection data is available, reference the gap percentages and status in your analysis
- Do NOT make up data beyond what is provided above
- Respond in plain text — no markdown headers, no asterisks, no bold"""

    try:
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        msg = client.messages.create(
            model="claude-3-5-haiku-20241022",
            max_tokens=400,
            system=system_prompt,
            messages=[{"role": "user", "content": question}],
        )
        answer = msg.content[0].text
        kpis_referenced = [k["key"] for k in KPI_DEFS if k["name"].lower() in answer.lower()]
        return {"answer": answer, "kpis_referenced": kpis_referenced}
    except Exception as e:
        return {"answer": f"Query unavailable: {str(e)}", "kpis_referenced": []}


# ─── Data Ontology ──────────────────────────────────────────────────────────
#
# Builds a knowledge graph from the 18 KPIs:
#   Nodes  → each KPI
#   Edges  → CAUSES / INFLUENCES (from CAUSATION_RULES) +
#             CORRELATES_WITH / ANTI_CORRELATES (from monthly time-series)
#   Scores → degree centrality + iterative PageRank
#   Recs   → novel signal hypotheses from untested links & multi-hop paths

import threading, math

ONTOLOGY_DOMAIN = {
    "revenue_growth":        "growth",
    "arr_growth":            "growth",
    "nrr":                   "retention",
    "churn_rate":            "retention",
    "gross_margin":          "profitability",
    "operating_margin":      "profitability",
    "ebitda_margin":         "profitability",
    "contribution_margin":   "profitability",
    "operating_leverage":    "profitability",
    "opex_ratio":            "efficiency",
    "burn_multiple":         "efficiency",
    "cac_payback":           "efficiency",
    "sales_efficiency":      "efficiency",
    "cash_conv_cycle":       "cashflow",
    "dso":                   "cashflow",
    "revenue_quality":       "revenue",
    "recurring_revenue":     "revenue",
    "customer_concentration":"risk",
}

# Base signal weights for synthetic time-series generation.
# 8 signals (A-H) with different frequencies; each metric is a weighted combo + noise.
# Shared signal weights create realistic correlations between related metrics.
_SYN_WEIGHTS = {
    # key: [A, B, C, D, E, F, G, H, trend_per_month, base_value]
    "cpl":              [ 1.0,  0.5, -0.3,  0.0,  0.2,  0.0,  0.0,  0.0, -0.05,  80.0],
    "mql_sql_rate":     [-0.6, -0.3,  0.5,  0.3,  0.0,  0.2,  0.0,  0.0,  0.02,  22.0],
    "pipeline_velocity":[-0.5, -0.4,  0.6,  0.4,  0.0,  0.1,  0.0,  0.0,  0.03,  1.2],
    "win_rate":         [-0.4, -0.2,  0.5,  0.4,  0.0,  0.2,  0.0,  0.0,  0.01,  28.0],
    "organic_traffic":  [ 0.2,  0.0,  0.3,  0.0,  0.7,  0.3,  0.0,  0.0,  0.10,  12.0],
    "brand_awareness":  [ 0.1,  0.0,  0.2,  0.0,  0.6,  0.4,  0.0,  0.0,  0.08,  55.0],
    "quota_attainment": [-0.5, -0.4,  0.5,  0.3,  0.0,  0.0,  0.0,  0.0,  0.00,  82.0],
    "marketing_roi":    [-0.7,  0.0,  0.4,  0.2,  0.5,  0.0,  0.0,  0.0,  0.02,  3.2],
    "avg_deal_size":    [-0.3,  0.0,  0.3,  0.5,  0.0,  0.0,  0.4,  0.0,  0.05, 48000.0],
    "expansion_rate":   [-0.5, -0.6,  0.3,  0.0,  0.0,  0.0,  0.5,  0.0,  0.02,  18.0],
    "gross_dollar_ret": [-0.6, -0.5,  0.4,  0.0,  0.0,  0.0,  0.4,  0.0,  0.01,  91.0],
    "ltv_cac":          [-0.4, -0.3,  0.4,  0.3,  0.0,  0.0,  0.3,  0.0,  0.02,  4.5],
    "product_nps":      [ 0.0, -0.4, -0.3,  0.6,  0.0,  0.0,  0.3,  0.2,  0.03,  42.0],
    "feature_adoption": [ 0.0, -0.3, -0.2,  0.5,  0.0,  0.0,  0.4,  0.2,  0.04,  38.0],
    "activation_rate":  [ 0.0, -0.3, -0.2,  0.5,  0.0,  0.0,  0.3,  0.3,  0.03,  64.0],
    "time_to_value":    [ 0.0,  0.4,  0.2, -0.5,  0.0,  0.0, -0.3, -0.2, -0.04,  21.0],
    "health_score":     [ 0.0, -0.5, -0.3,  0.5,  0.0,  0.0,  0.4,  0.2,  0.02,  72.0],
    "logo_retention":   [-0.3, -0.5, -0.2,  0.4,  0.0,  0.0,  0.4,  0.1,  0.01,  94.0],
    "csat":             [ 0.0, -0.4, -0.2,  0.5,  0.0,  0.0,  0.3,  0.3,  0.02,  4.1],
    "headcount_eff":    [-0.3, -0.2,  0.3,  0.0,  0.0,  0.5,  0.2,  0.0,  0.01,  0.85],
    "rev_per_employee": [-0.4, -0.2,  0.4,  0.0,  0.0,  0.5,  0.2,  0.0,  0.02, 185000.0],
    "ramp_time":        [ 0.3,  0.2, -0.3,  0.0,  0.0, -0.4, -0.2,  0.0, -0.02,  5.5],
    "support_volume":   [ 0.2,  0.5,  0.2, -0.4,  0.0,  0.0, -0.2, -0.3, -0.01, 320.0],
    "automation_rate":  [-0.2, -0.1,  0.2,  0.0,  0.0,  0.6,  0.0,  0.0,  0.05,  34.0],
    "cash_runway":      [-0.3, -0.4,  0.2,  0.0,  0.0,  0.3,  0.0,  0.5,  0.00,  18.0],
    "current_ratio":    [-0.2, -0.3,  0.2,  0.0,  0.0,  0.2,  0.0,  0.5,  0.00,  2.1],
    "working_capital":  [-0.2, -0.3,  0.2,  0.0,  0.0,  0.2,  0.0,  0.5, -0.01,  1.8],
    "contraction_rate": [ 0.4,  0.5,  0.2, -0.4,  0.0,  0.0, -0.3, -0.1,  0.01,  3.5],
    "payback_period":   [ 0.5,  0.4, -0.3,  0.0,  0.0, -0.2, -0.2,  0.0, -0.02, 22.0],
}

def _init_ontology_tables(conn):
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS ontology_nodes (
            key TEXT PRIMARY KEY,
            name TEXT,
            domain TEXT,
            unit TEXT,
            direction TEXT,
            centrality REAL DEFAULT 0,
            pagerank REAL DEFAULT 0,
            updated_at TEXT
        );
        CREATE TABLE IF NOT EXISTS ontology_edges (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source TEXT,
            target TEXT,
            relation TEXT,
            strength REAL,
            evidence TEXT,
            UNIQUE(source, target, relation)
        );
        CREATE TABLE IF NOT EXISTS ontology_recommendations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            description TEXT,
            rec_type TEXT,
            path TEXT,
            confidence REAL,
            novelty REAL,
            impact REAL,
            hypothesis TEXT,
            status TEXT DEFAULT 'active',
            created_at TEXT
        );
    """)
    conn.commit()


def _run_ontology_discovery():
    conn = get_db()
    _init_ontology_tables(conn)

    now = datetime.utcnow().isoformat()

    # ── 1. Upsert nodes from KPI_DEFS ─────────────────────────────────────
    for kdef in KPI_DEFS:
        key = kdef["key"]
        conn.execute("""
            INSERT INTO ontology_nodes(key, name, domain, unit, direction, updated_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET
              name=excluded.name, domain=excluded.domain,
              unit=excluded.unit, direction=excluded.direction,
              updated_at=excluded.updated_at
        """, (key, kdef["name"], ONTOLOGY_DOMAIN.get(key,"other"),
              kdef["unit"], kdef["direction"], now))

    # Upsert extended ontology-only nodes
    for em in EXTENDED_ONTOLOGY_METRICS:
        conn.execute("""
            INSERT INTO ontology_nodes(key, name, domain, unit, direction, updated_at)
            VALUES (?,?,?,?,?,?)
            ON CONFLICT(key) DO UPDATE SET
              name=excluded.name, domain=excluded.domain,
              unit=excluded.unit, direction=excluded.direction,
              updated_at=excluded.updated_at
        """, (em["key"], em["name"], em["domain"], em["unit"], em["direction"], now))
    conn.commit()

    # ── 2. Edges from CAUSATION_RULES + EXTENDED_CAUSATION_RULES ──────────
    edge_count = 0
    for source_key, rules in ALL_CAUSATION_RULES.items():
        for target_key in rules.get("downstream_impact", []):
            conn.execute("""
                INSERT OR IGNORE INTO ontology_edges(source, target, relation, strength, evidence)
                VALUES (?,?,'CAUSES',0.75,'domain_knowledge')
            """, (source_key, target_key))
            edge_count += 1
    conn.commit()

    # ── 3. Synthetic + real time-series for correlation ────────────────────
    # Load real KPI monthly data
    rows = conn.execute("SELECT data_json FROM monthly_data ORDER BY year, month").fetchall()
    series: dict = {}
    for row in rows:
        d = json.loads(row["data_json"])
        for k, v in d.items():
            if v is not None:
                series.setdefault(k, []).append(float(v))

    # Generate 60-month synthetic series for extended metrics using base signals.
    # 8 sinusoidal base signals (A-H) with different periods/phases.
    N = 60
    import random as _rnd
    _rnd.seed(42)
    base_signals = [
        [math.sin(2 * math.pi * t / p + ph) for t in range(N)]
        for p, ph in [(12, 0), (6, 1.0), (24, 2.1), (18, 0.5),
                      (36, 1.2), (9, 3.1), (15, 0.8), (48, 1.7)]
    ]
    for em in EXTENDED_ONTOLOGY_METRICS:
        key = em["key"]
        if key not in _SYN_WEIGHTS:
            continue
        w = _SYN_WEIGHTS[key]
        weights, trend, base = w[:8], w[8], w[9]
        ts = []
        for t in range(N):
            val = base + trend * t
            for j, sig in enumerate(base_signals):
                val += weights[j] * sig[t] * base * 0.08
            val += _rnd.gauss(0, abs(base) * 0.02)
            ts.append(val)
        series[key] = ts

    # Correlation loop across ALL nodes (KPI_DEFS + extended)
    all_keys = [kd["key"] for kd in KPI_DEFS] + [em["key"] for em in EXTENDED_ONTOLOGY_METRICS]
    for i, ka in enumerate(all_keys):
        for kb in all_keys[i+1:]:
            va = series.get(ka, [])
            vb = series.get(kb, [])
            n = min(len(va), len(vb))
            if n < 3:
                continue
            va, vb = va[:n], vb[:n]
            # Pearson r
            mean_a = sum(va)/n
            mean_b = sum(vb)/n
            num = sum((a-mean_a)*(b-mean_b) for a,b in zip(va,vb))
            den = math.sqrt(sum((a-mean_a)**2 for a in va)*sum((b-mean_b)**2 for b in vb))
            if den == 0:
                continue
            r = num/den
            if abs(r) < 0.45:
                continue
            rel = "CORRELATES_WITH" if r > 0 else "ANTI_CORRELATES"
            strength = round(abs(r), 4)
            conn.execute("""
                INSERT INTO ontology_edges(source, target, relation, strength, evidence)
                VALUES (?,?,?,?,'monthly_correlation')
                ON CONFLICT(source, target, relation) DO UPDATE SET
                  strength=MAX(strength, excluded.strength)
            """, (ka, kb, rel, strength))
            edge_count += 1
    conn.commit()

    # ── 4. Compute degree centrality + PageRank ────────────────────────────
    edges_all = conn.execute("SELECT source, target, strength, relation FROM ontology_edges").fetchall()
    node_keys = [r["key"] for r in conn.execute("SELECT key FROM ontology_nodes").fetchall()]

    degree: dict = {k: 0 for k in node_keys}
    for e in edges_all:
        degree[e["source"]] = degree.get(e["source"], 0) + 1
        degree[e["target"]] = degree.get(e["target"], 0) + 1
    max_deg = max(degree.values()) if degree else 1

    # Build adjacency for PageRank
    out_links: dict = {k: [] for k in node_keys}
    for e in edges_all:
        out_links.setdefault(e["source"], []).append(e["target"])

    pr = {k: 1.0 for k in node_keys}
    d = 0.85
    for _ in range(15):
        new_pr: dict = {}
        for k in node_keys:
            incoming = [s for s, targets in out_links.items() if k in targets]
            rank = (1 - d)
            for s in incoming:
                rank += d * pr[s] / max(len(out_links[s]), 1)
            new_pr[k] = rank
        pr = new_pr
    max_pr = max(pr.values()) if pr else 1

    for k in node_keys:
        cent = round(degree.get(k, 0) / max_deg, 4)
        pg   = round(pr.get(k, 0) / max_pr, 4)
        conn.execute("UPDATE ontology_nodes SET centrality=?, pagerank=? WHERE key=?", (cent, pg, k))
    conn.commit()

    # ── 5. Generate signal recommendations ────────────────────────────────
    conn.execute("DELETE FROM ontology_recommendations WHERE 1")

    # Build quick lookup
    node_map = {r["key"]: dict(r) for r in conn.execute("SELECT * FROM ontology_nodes").fetchall()}
    edges_set = {(e["source"], e["target"], e["relation"]) for e in edges_all}
    causes_map: dict = {}   # source → [targets] for CAUSES edges
    for e in edges_all:
        if e["relation"] == "CAUSES":
            causes_map.setdefault(e["source"], []).append(e["target"])

    rec_count = 0

    # (a) Untested link: A -CAUSES-> B -CAUSES-> C but no direct A→C edge
    for a, b_list in causes_map.items():
        for b in b_list:
            for c in causes_map.get(b, []):
                if a == c:
                    continue
                if (a, c, "CAUSES") not in edges_set and (a, c, "CORRELATES_WITH") not in edges_set:
                    na = node_map.get(a, {}); nc = node_map.get(c, {})
                    conn.execute("""
                        INSERT INTO ontology_recommendations
                          (title, description, rec_type, path, confidence, novelty, impact, hypothesis, status, created_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?)
                    """, (
                        f"Untested link: {na.get('name',a)} → {nc.get('name',c)}",
                        f"{na.get('name',a)} causes {node_map.get(b,{}).get('name',b)} which causes "
                        f"{nc.get('name',c)}, but the direct relationship is unmeasured.",
                        "untested_link",
                        json.dumps([a, b, c]),
                        0.70, 0.85, pr.get(c, 0) / max_pr,
                        f"Measure whether changes in {na.get('name',a)} predict {nc.get('name',c)} "
                        f"with a lag, bypassing {node_map.get(b,{}).get('name',b)}.",
                        "active", now
                    ))
                    rec_count += 1
                    if rec_count >= 40:
                        break
            if rec_count >= 40:
                break
        if rec_count >= 40:
            break

    # (b) Cross-domain bridge: high-centrality node linking 2+ domains
    domain_nodes: dict = {}
    for k, n in node_map.items():
        domain_nodes.setdefault(n.get("domain", "other"), []).append(k)

    bridges = [k for k in node_keys if degree.get(k, 0) >= 4]
    bridges.sort(key=lambda k: -pr.get(k, 0))
    for bridge in bridges[:5]:
        neighbors = set()
        for e in edges_all:
            if e["source"] == bridge:
                neighbors.add(e["target"])
            if e["target"] == bridge:
                neighbors.add(e["source"])
        neighbor_domains = {node_map.get(n, {}).get("domain") for n in neighbors} - {None}
        if len(neighbor_domains) >= 2:
            nb = node_map.get(bridge, {})
            conn.execute("""
                INSERT INTO ontology_recommendations
                  (title, description, rec_type, path, confidence, novelty, impact, hypothesis, status, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            """, (
                f"Bridge metric: {nb.get('name', bridge)}",
                f"{nb.get('name', bridge)} connects {len(neighbor_domains)} domains "
                f"({', '.join(sorted(neighbor_domains))}). Monitoring it provides early warning across multiple KPI clusters.",
                "bridge_node",
                json.dumps([bridge]),
                0.80, 0.75, pr.get(bridge, 0) / max_pr,
                f"Set alerts on {nb.get('name', bridge)} — it influences KPIs across "
                f"{', '.join(sorted(neighbor_domains))} domains simultaneously.",
                "active", now
            ))
            rec_count += 1

    # (c) Strongly-correlated cluster recommendations
    corr_edges = [(e["source"], e["target"], e["strength"]) for e in edges_all
                  if e["relation"] == "CORRELATES_WITH" and e["strength"] > 0.75]
    if len(corr_edges) >= 2:
        top_corr = sorted(corr_edges, key=lambda x: -x[2])[:3]
        for src, tgt, str_ in top_corr:
            ns = node_map.get(src, {}); nt = node_map.get(tgt, {})
            conn.execute("""
                INSERT INTO ontology_recommendations
                  (title, description, rec_type, path, confidence, novelty, impact, hypothesis, status, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
            """, (
                f"Strong co-movement: {ns.get('name',src)} ↔ {nt.get('name',tgt)}",
                f"Pearson r = {str_:.2f}. These KPIs move together strongly — "
                f"a combined leading indicator may have more predictive power than either alone.",
                "cluster",
                json.dumps([src, tgt]),
                round(str_, 2), 0.65, round((pr.get(src,0)+pr.get(tgt,0))/(2*max_pr), 4),
                f"Build a composite signal from {ns.get('name',src)} and {nt.get('name',tgt)} "
                f"to create a single early-warning index.",
                "active", now
            ))
            rec_count += 1

    conn.commit()
    conn.close()
    return {"nodes": len(node_keys), "edges": edge_count, "recommendations": rec_count}


# ── Ontology endpoints ────────────────────────────────────────────────────

@app.post("/api/ontology/discover")
def ontology_discover():
    """Trigger background knowledge-graph discovery."""
    def _bg():
        try:
            _run_ontology_discovery()
        except Exception as exc:
            print(f"Ontology discovery error: {exc}")
    threading.Thread(target=_bg, daemon=True).start()
    return {"status": "running", "message": "Ontology discovery started — refresh in ~5 seconds"}


@app.get("/api/ontology/graph")
def ontology_graph(domain: Optional[str] = None):
    conn = get_db()
    _init_ontology_tables(conn)
    q = "SELECT * FROM ontology_nodes"
    params = ()
    if domain and domain != "all":
        q += " WHERE domain=?"
        params = (domain,)
    nodes = []
    for r in conn.execute(q, params).fetchall():
        n = dict(r)
        rules = ALL_CAUSATION_RULES.get(n["key"], {})
        n["root_causes"]       = rules.get("root_causes", [])
        n["corrective_actions"]= rules.get("corrective_actions", [])
        n["downstream_impact"] = rules.get("downstream_impact", [])
        nodes.append(n)
    node_keys = {n["key"] for n in nodes}
    edges = [dict(e) for e in conn.execute("SELECT * FROM ontology_edges").fetchall()
             if e["source"] in node_keys and e["target"] in node_keys]
    conn.close()
    return {"nodes": nodes, "edges": edges}


@app.get("/api/ontology/stats")
def ontology_stats():
    conn = get_db()
    _init_ontology_tables(conn)
    total_nodes = conn.execute("SELECT COUNT(*) FROM ontology_nodes").fetchone()[0]
    total_edges = conn.execute("SELECT COUNT(*) FROM ontology_edges").fetchone()[0]
    active_recs  = conn.execute("SELECT COUNT(*) FROM ontology_recommendations WHERE status='active'").fetchone()[0]
    domain_rows  = conn.execute("SELECT domain, COUNT(*) as cnt FROM ontology_nodes GROUP BY domain").fetchall()
    edge_rows    = conn.execute("SELECT relation, COUNT(*) as cnt FROM ontology_edges GROUP BY relation").fetchall()
    top_nodes    = conn.execute(
        "SELECT key, name, pagerank, domain FROM ontology_nodes ORDER BY pagerank DESC LIMIT 5"
    ).fetchall()
    conn.close()
    return {
        "total_nodes": total_nodes,
        "total_edges": total_edges,
        "active_recommendations": active_recs,
        "domain_distribution": {r["domain"]: r["cnt"] for r in domain_rows},
        "edge_type_distribution": {r["relation"]: r["cnt"] for r in edge_rows},
        "top_nodes_by_pagerank": [dict(r) for r in top_nodes],
    }


@app.get("/api/ontology/recommendations")
def ontology_recommendations(rec_type: Optional[str] = None, status: Optional[str] = "active"):
    conn = get_db()
    _init_ontology_tables(conn)
    q = "SELECT * FROM ontology_recommendations WHERE status=?"
    params: list = [status or "active"]
    if rec_type:
        q += " AND rec_type=?"
        params.append(rec_type)
    q += " ORDER BY impact DESC, confidence DESC"
    rows = [dict(r) for r in conn.execute(q, params).fetchall()]
    for r in rows:
        r["path"] = json.loads(r["path"]) if r.get("path") else []
    conn.close()
    return rows


@app.post("/api/ontology/recommendations/{rec_id}/dismiss")
def dismiss_recommendation(rec_id: int):
    conn = get_db()
    conn.execute("UPDATE ontology_recommendations SET status='dismissed' WHERE id=?", (rec_id,))
    conn.commit()
    conn.close()
    return {"status": "dismissed"}


# ─── Serve React Frontend ───────────────────────────────────────────────────

STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        index = STATIC_DIR / "index.html"
        return FileResponse(index)
