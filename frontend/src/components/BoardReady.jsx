import { useMemo } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  LineChart, Line, AreaChart, Area,
} from 'recharts'
import {
  ChevronRight, Printer, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, Activity, Zap, Eye, Shield,
  Target, AlertCircle, BarChart3, Layers, ArrowUpRight,
  ArrowDownRight, Info,
} from 'lucide-react'

// ── Constants ───────────────────────────────────────────────────────────────
const MONTHS     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_NUMS = [1,2,3,4,5,6,7,8,9,10,11,12]

const SOURCE = {
  dashboard:   { label: 'Command Center',  color: '#0055A4', text: 'text-blue-700',    bg: 'bg-blue-50',    border: 'border-blue-200'    },
  fingerprint: { label: 'Org Fingerprint', color: '#7c3aed', text: 'text-violet-700',  bg: 'bg-violet-50',  border: 'border-violet-200'  },
  trends:      { label: 'Monthly Trends',  color: '#059669', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  projection:  { label: 'Bridge Analysis', color: '#d97706', text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200'   },
}

// ── Domain keyword grouping ─────────────────────────────────────────────────
const DOMAIN_MAP = {
  growth:      ['revenue', 'arr', 'mrr', 'growth', 'cac', 'ltv', 'pipeline', 'deal', 'win_rate', 'new_'],
  retention:   ['nrr', 'churn', 'retention', 'activation', 'nps', 'satisfaction', 'health', 'adoption', 'time_to_value', 'ttv'],
  efficiency:  ['margin', 'burn', 'sales_cycle', 'payback', 'magic_number', 'rule_of_40', 'opex', 'cogs'],
  cashflow:    ['cash', 'runway', 'fcf', 'free_cash', 'operating_cash'],
}
const DOMAIN_META = {
  growth:     { label: 'Growth Engine',         color: '#0055A4', bg: '#eff6ff', Icon: TrendingUp   },
  retention:  { label: 'Retention Health',       color: '#059669', bg: '#f0fdf4', Icon: Shield       },
  efficiency: { label: 'Operating Efficiency',   color: '#7c3aed', bg: '#f5f3ff', Icon: Zap          },
  cashflow:   { label: 'Cash & Runway',          color: '#d97706', bg: '#fffbeb', Icon: BarChart3    },
  other:      { label: 'Other Metrics',          color: '#64748b', bg: '#f8fafc', Icon: Activity     },
}

function getDomain(kpi) {
  const k = ((kpi.key || '') + ' ' + (kpi.name || '')).toLowerCase()
  for (const [domain, keywords] of Object.entries(DOMAIN_MAP)) {
    if (keywords.some(w => k.includes(w))) return domain
  }
  return 'other'
}

// ── Formatters ──────────────────────────────────────────────────────────────
const UNIT_FMT = {
  pct:    v => `${v?.toFixed(1)}%`,
  days:   v => `${v?.toFixed(1)}d`,
  months: v => `${v?.toFixed(1)}mo`,
  ratio:  v => `${v?.toFixed(2)}x`,
  '$':    v => `$${v?.toFixed(1)}`,
}
function fmt(val, unit) {
  if (val == null) return '—'
  return (UNIT_FMT[unit] || (v => v?.toFixed(2)))(val)
}
function gapPct(kpi) {
  if (kpi.avg == null || !kpi.target) return null
  const raw = (kpi.avg / kpi.target - 1) * 100
  return kpi.direction !== 'higher' ? -raw : raw
}

// ── Streak calculator ────────────────────────────────────────────────────────
function cellStatus(val, target, direction) {
  if (val == null || !target) return 'grey'
  const r = direction === 'higher' ? val / target : target / val
  return r >= 0.98 ? 'green' : r >= 0.90 ? 'yellow' : 'red'
}
function redStreak(kpi) {
  const byMonth = {}
  kpi.monthly?.forEach(m => { byMonth[parseInt(m.period.split('-')[1], 10)] = m.value })
  let streak = 0
  for (let mo = 12; mo >= 1; mo--) {
    if (cellStatus(byMonth[mo], kpi.target, kpi.direction) === 'red') streak++
    else break
  }
  return streak
}
function greenStreak(kpi) {
  const byMonth = {}
  kpi.monthly?.forEach(m => { byMonth[parseInt(m.period.split('-')[1], 10)] = m.value })
  let streak = 0
  for (let mo = 12; mo >= 1; mo--) {
    if (cellStatus(byMonth[mo], kpi.target, kpi.direction) === 'green') streak++
    else break
  }
  return streak
}

// ── Sparkline data ───────────────────────────────────────────────────────────
function sparkData(kpi) {
  return MONTH_NUMS.map((mo, idx) => {
    const m = kpi.monthly?.find(d => parseInt(d.period.split('-')[1], 10) === mo)
    return { month: MONTHS[idx], value: m?.value ?? null }
  })
}

// ── "So What" contextualiser ────────────────────────────────────────────────
function soWhat(kpi) {
  const key  = (kpi.key || '').toLowerCase()
  const gap  = gapPct(kpi)
  const gStr = gap != null ? Math.abs(gap).toFixed(0) : null

  if (key.includes('nrr') || key.includes('net_revenue_retention')) {
    if (kpi.avg != null && kpi.avg < 100)
      return 'Below 100% means the customer base is contracting without new sales.'
    if (kpi.avg != null && kpi.avg >= 110)
      return 'Above 110% indicates strong expansion — existing customers are funding growth.'
    return 'NRR at 100–110%: stable but growth requires continuous new sales effort.'
  }
  if (key.includes('churn')) {
    const annual = kpi.avg ? (kpi.avg * 12).toFixed(0) : null
    return annual ? `At this rate, ~${annual}% of the customer base churns annually.` : 'Churn rate impacts long-term revenue compounding.'
  }
  if (key.includes('burn_multiple') || key.includes('burn multiple')) {
    return kpi.avg ? `Every $${kpi.avg.toFixed(1)} spent generates $1 of new ARR.` : 'Burn multiple measures capital efficiency of growth.'
  }
  if (key.includes('gross_margin') || key.includes('gross margin')) {
    return kpi.avg ? `Each revenue dollar generates ${kpi.avg.toFixed(0)}¢ of gross profit.` : 'Gross margin determines the ceiling on long-term profitability.'
  }
  if (key.includes('cac') && !key.includes('payback')) {
    return gStr ? `Acquiring each customer costs ${gStr}% ${gap < 0 ? 'more' : 'less'} than target.` : 'CAC drives the efficiency of the growth engine.'
  }
  if (key.includes('runway')) {
    return kpi.avg ? `At current burn, ${kpi.avg.toFixed(0)} months of runway remaining.` : 'Runway determines strategic optionality.'
  }
  if (key.includes('ltv') && !key.includes('cac')) {
    return 'LTV decline compresses the ROI ceiling on acquisition spend.'
  }
  if (gap != null) {
    return gap < 0
      ? `${Math.abs(gap).toFixed(1)}% below target — gap is ${Math.abs(gap) > 15 ? 'structurally significant' : 'manageable with targeted intervention'}.`
      : `${gap.toFixed(1)}% above target — a signal worth protecting.`
  }
  return null
}

// ── Thesis sentence ──────────────────────────────────────────────────────────
function buildThesis(fingerprint, bhi) {
  if (!fingerprint?.length) return 'No data available.'
  const red    = fingerprint.filter(k => k.fy_status === 'red')
  const yellow = fingerprint.filter(k => k.fy_status === 'yellow')
  const green  = fingerprint.filter(k => k.fy_status === 'green')

  const hasRetentionRisk = fingerprint.some(k => {
    const key = (k.key || '').toLowerCase()
    return (key.includes('nrr') || key.includes('churn') || key.includes('retention')) && k.fy_status !== 'green'
  })
  const hasGrowthStrength = fingerprint.some(k => {
    const key = (k.key || '').toLowerCase()
    return (key.includes('revenue') || key.includes('arr')) && k.fy_status === 'green'
  })
  const worstStreak = fingerprint.map(k => redStreak(k)).reduce((a,b) => Math.max(a,b), 0)

  if (bhi >= 80) {
    if (hasRetentionRisk)
      return `The business is performing strongly (BHI ${bhi}/100) but retention signals suggest the growth engine is not yet self-sustaining — a structural risk that will compound if not addressed.`
    return `The business is in strong health with a BHI of ${bhi}/100, demonstrating broad-based performance across growth, retention, and efficiency — the fundamentals are sound.`
  }
  if (bhi >= 60) {
    if (hasGrowthStrength && hasRetentionRisk)
      return `Top-line momentum looks healthy, but the real story lies beneath: retention KPIs are flashing warnings that will constrain revenue within 2–3 quarters if not addressed — the P&L does not yet reflect this risk.`
    if (red.length > 0 && worstStreak >= 3)
      return `The business is at a critical inflection point — ${red.length} KPI${red.length > 1 ? 's are' : ' is'} in sustained decline (${worstStreak}+ consecutive months), suggesting structural rather than cyclical issues.`
    return `Performance is mixed with a BHI of ${bhi}/100 — ${green.length} KPIs on target, but ${red.length + yellow.length} require focused intervention to prevent a broader deterioration.`
  }
  return `The business is under significant pressure (BHI ${bhi}/100) — ${red.length} critical KPI${red.length > 1 ? 's' : ''} and ${yellow.length} in the watch zone indicate systemic strain that demands board-level prioritisation.`
}

// ── Hidden signal detector ───────────────────────────────────────────────────
function detectSignals(fingerprint) {
  const signals = []

  // 1. Consecutive red streak (structural)
  const streakers = fingerprint
    .map(k => ({ ...k, _streak: redStreak(k) }))
    .filter(k => k._streak >= 3)
    .sort((a, b) => b._streak - a._streak)
  if (streakers.length) {
    const k = streakers[0]
    signals.push({
      sev: 'critical',
      icon: AlertCircle,
      title: `${k.name} has missed target ${k._streak} consecutive months`,
      body:  `A streak of ${k._streak} months indicates a structural failure, not a one-off miss. Sustained red streaks compound — each additional month makes recovery significantly harder. Escalate before this reaches a step-change inflection.`,
      tab: 'fingerprint',
    })
  }

  // 2. Momentum trap — green status, falling trajectory
  const traps = fingerprint.filter(k => {
    if (k.fy_status !== 'green') return false
    const vals = (k.monthly || []).map(m => m.value).filter(v => v != null)
    if (vals.length < 3) return false
    const last3 = vals.slice(-3)
    return k.direction === 'higher' ? last3[2] < last3[0] : last3[2] > last3[0]
  })
  if (traps.length) {
    const k = traps[0]
    signals.push({
      sev: 'warning',
      icon: Eye,
      title: `${k.name} is green on paper but the trend is deteriorating`,
      body:  `The current average meets target, but the last 3 months show a consistent adverse trajectory. This is a leading indicator: if the trend continues unchecked, this KPI will breach the warning threshold within 1–2 quarters — the financials won't reflect this yet.`,
      tab: 'trends',
    })
  }

  // 3. Early recovery signal — underperforming but improving
  const recovering = fingerprint.filter(k => {
    if (k.fy_status === 'green') return false
    const vals = (k.monthly || []).map(m => m.value).filter(v => v != null)
    if (vals.length < 3) return false
    const last3 = vals.slice(-3)
    return k.direction === 'higher' ? last3[2] > last3[0] * 1.02 : last3[2] < last3[0] * 0.98
  })
  if (recovering.length) {
    const k = recovering[0]
    signals.push({
      sev: 'positive',
      icon: TrendingUp,
      title: `${k.name} is below target but showing genuine momentum`,
      body:  `Despite missing its target, ${k.name} has improved consistently over the last 3 months. Early recovery signals in KPIs that have historically been leading indicators are worth monitoring — if sustained, this could represent a turning point.`,
      tab: 'trends',
    })
  }

  // 4. Growth-Retention mismatch (the hidden compounding risk)
  const retentionKpis = fingerprint.filter(k => {
    const key = (k.key || '').toLowerCase()
    return key.includes('nrr') || key.includes('churn') || key.includes('retention') || key.includes('logo')
  })
  const growthKpis = fingerprint.filter(k => {
    const key = (k.key || '').toLowerCase()
    return key.includes('revenue') || key.includes('arr') || key.includes('mrr')
  })
  const retentionStressed = retentionKpis.some(k => k.fy_status !== 'green')
  const growthHealthy = growthKpis.some(k => k.fy_status === 'green')
  if (retentionStressed && growthHealthy && retentionKpis.length > 0) {
    signals.push({
      sev: 'warning',
      icon: AlertTriangle,
      title: 'Growth is masking a retention problem — the P&L hides this',
      body:  'Top-line revenue looks healthy, but retention metrics are under stress. This divergence is a classic early warning: retention problems typically surface in the revenue line 2–3 quarters later, after churn compounds. Boards reviewing only the income statement will miss this signal entirely.',
      tab: 'dashboard',
    })
  }

  // 5. Burn vs growth efficiency mismatch
  const burnKpi = fingerprint.find(k => (k.key || '').toLowerCase().includes('burn'))
  const revKpi  = fingerprint.find(k => {
    const key = (k.key || '').toLowerCase()
    return (key.includes('revenue_growth') || key.includes('arr_growth')) && !key.includes('cac')
  })
  if (burnKpi && revKpi) {
    const burnBad = burnKpi.fy_status !== 'green'
    const revGood = revKpi.fy_status === 'green'
    if (burnBad && revGood) {
      signals.push({
        sev: 'warning',
        icon: Zap,
        title: 'Revenue growth is being bought, not earned — watch the efficiency ratio',
        body:  `Growth looks strong but Burn Multiple signals the current gains are capital-intensive. This is sustainable short-term but will face investor scrutiny at the next fundraise. The question is whether the growth will become self-funding before capital runs short.`,
        tab: 'projection',
      })
    }
  }

  // 6. Clustered yellow warnings in one domain (systemic risk)
  const byDomain = {}
  fingerprint.forEach(k => {
    const d = getDomain(k)
    byDomain[d] = byDomain[d] || []
    byDomain[d].push(k)
  })
  for (const [domain, kpis] of Object.entries(byDomain)) {
    const yellows = kpis.filter(k => k.fy_status === 'yellow')
    if (yellows.length >= 2 && domain !== 'other') {
      const meta = DOMAIN_META[domain]
      signals.push({
        sev: 'warning',
        icon: Info,
        title: `${yellows.length} ${meta?.label || domain} metrics simultaneously in the warning zone`,
        body:  `Clustered warnings within a single domain suggest a systemic constraint rather than isolated underperformance. When multiple KPIs in the same area miss together, the root cause is usually structural — a process, team, or market factor that individual KPI owners cannot solve in isolation.`,
        tab: 'fingerprint',
      })
      break
    }
  }

  return signals.slice(0, 5)
}

// ── Domain story builder ─────────────────────────────────────────────────────
function buildDomainStory(domain, kpis) {
  if (!kpis.length) return null
  const red    = kpis.filter(k => k.fy_status === 'red')
  const yellow = kpis.filter(k => k.fy_status === 'yellow')
  const green  = kpis.filter(k => k.fy_status === 'green')

  const stories = {
    growth: () => {
      if (green.length === kpis.length)
        return `Growth metrics are firing on all cylinders — ${kpis.length}/${kpis.length} KPIs on target. Top-line momentum is genuine and broad-based, not concentrated in a single metric. The pipeline and conversion economics support continued expansion.`
      if (red.length >= kpis.length / 2)
        return `Growth is under significant strain — ${red.length} of ${kpis.length} KPIs are critical. The growth engine is constrained; without intervention, the gap between current trajectory and targets will widen. Diagnose whether this is a pipeline, conversion, or retention issue.`
      return `Growth presents a mixed picture: ${green.length} KPIs on track, but ${red.length + yellow.length} are dragging the aggregate. The growth engine has the right components but isn't firing consistently — focus effort on the highest-leverage bottleneck, not the longest list of issues.`
    },
    retention: () => {
      if (red.length === 0 && yellow.length === 0)
        return `Retention health is genuinely strong — the customer base is stable and expanding. Strong NRR dynamics mean existing customers are funding a portion of growth, reducing reliance on new sales and compressing the effective CAC.`
      if (red.length > 0)
        return `Retention is the most consequential risk in this dataset. ${red.length} KPI${red.length > 1 ? 's are' : ' is'} critical, and churn dynamics at this level will compound against revenue within 2–3 quarters. A 1% improvement in monthly churn has a larger NPV impact than most growth initiatives.`
      return `Retention is in the watch zone — no critical failures yet, but ${yellow.length} metric${yellow.length > 1 ? 's are' : ' is'} trending adversely. Proactive intervention at the watch stage costs a fraction of what remediation costs once customers begin churning. The window to act is now.`
    },
    efficiency: () => {
      if (green.length === kpis.length)
        return `Operational efficiency is a demonstrable strength. The business generates output at or above target relative to its cost structure — this creates operating leverage that becomes increasingly valuable as scale increases.`
      if (red.length > 0)
        return `Efficiency metrics signal that costs are growing faster than the value they generate. ${red.length} KPI${red.length > 1 ? 's need' : ' needs'} structural intervention — incremental optimisation will not close the gap. Review the cost architecture at the program level, not the line item level.`
      return `Efficiency is in transition. The operating model has the right structure but margins and burn aren't improving at the rate expected at this growth stage. The operating leverage story needs to be built deliberately — it typically doesn't emerge without intentional choices.`
    },
    cashflow: () => {
      if (green.length === kpis.length)
        return `Cash position is healthy and the trajectory is positive. Strong runway and cash generation give the business the strategic flexibility to pursue growth without short-term capital pressure — a significant strategic advantage.`
      if (red.length > 0)
        return `Cash dynamics are a board-level concern requiring direct attention. ${red.length} KPI${red.length > 1 ? 's require' : ' requires'} immediate review — runway and free cash generation should be stress-tested against multiple scenarios at the next board session.`
      return `Cash generation is adequate but the trajectory warrants monitoring. Key metrics are in the yellow zone — not critical, but the margin of safety is narrowing. Revisit budget assumptions and ensure contingency plans are current.`
    },
    other: () => `${kpis.length} additional KPIs tracked: ${green.length} on target, ${yellow.length} watch, ${red.length} critical.`,
  }

  const story = (stories[domain] || stories.other)()
  return { story, red, yellow, green }
}

// ── Outlook generator ────────────────────────────────────────────────────────
function buildOutlook(fingerprint, bridgeData) {
  const bullets = []
  const streakers = fingerprint.filter(k => redStreak(k) >= 3).sort((a,b) => redStreak(b)-redStreak(a))
  if (streakers.length)
    bullets.push(`Monitor ${streakers[0].name} closely — a ${redStreak(streakers[0])}-month red streak is the highest-priority operational risk.`)

  const traps = fingerprint.filter(k => {
    if (k.fy_status !== 'green') return false
    const vals = (k.monthly || []).map(m => m.value).filter(v => v != null)
    if (vals.length < 3) return false
    const last3 = vals.slice(-3)
    return k.direction === 'higher' ? last3[2] < last3[0] : last3[2] > last3[0]
  })
  if (traps.length)
    bullets.push(`${traps[0].name} will likely move from green to amber within 60–90 days if the current declining trajectory is not reversed.`)

  const redKpis = fingerprint.filter(k => k.fy_status === 'red')
  if (redKpis.length >= 3)
    bullets.push(`With ${redKpis.length} critical KPIs, the board should request a corrective action plan with accountable owners and measurable 30-day milestones — not just an update.`)

  if (bridgeData?.summary?.behind > 0)
    bullets.push(`${bridgeData.summary.behind} KPI${bridgeData.summary.behind > 1 ? 's are' : ' is'} behind projection — if not addressed, the annual plan may need to be re-baselined before Q3.`)

  const greenKpis = fingerprint.filter(k => k.fy_status === 'green')
  if (greenKpis.length > 0 && redKpis.length > 0)
    bullets.push(`Protect the ${greenKpis.length} on-target KPIs from resource diversion toward problem areas — over-correction is a common board intervention failure mode.`)

  if (!bullets.length)
    bullets.push('Continue monitoring the current KPI set — no acute risks detected at this time.')

  return bullets.slice(0, 4)
}

// ── VS-Target helper ─────────────────────────────────────────────────────────
function vsTarget(kpi) {
  if (!kpi.target) return 100
  const r = kpi.direction === 'higher' ? kpi.avg / kpi.target : kpi.target / kpi.avg
  return Math.min(Math.round(r * 100), 140)
}

// ── Sub-components ───────────────────────────────────────────────────────────

function NavPill({ tabId, onNavigate }) {
  const src = SOURCE[tabId]
  if (!src) return null
  return (
    <button
      onClick={e => { e.stopPropagation(); onNavigate(tabId) }}
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${src.bg} ${src.border} ${src.text} hover:opacity-80 transition-opacity`}>
      {src.label} <ChevronRight size={10}/>
    </button>
  )
}

// Signal card severity styles
const SEV = {
  critical: { bg: 'bg-red-50',     border: 'border-red-200',   icon: 'text-red-500',   bar: '#ef4444', badge: 'bg-red-100 text-red-700 border-red-200',    label: 'CRITICAL' },
  warning:  { bg: 'bg-amber-50',   border: 'border-amber-200', icon: 'text-amber-500', bar: '#f59e0b', badge: 'bg-amber-100 text-amber-700 border-amber-200', label: 'WATCH'    },
  positive: { bg: 'bg-emerald-50', border: 'border-emerald-200', icon: 'text-emerald-500', bar: '#10b981', badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'SIGNAL' },
}

function HiddenSignalCard({ signal, onNavigate }) {
  const s = SEV[signal.sev] || SEV.warning
  const Icon = signal.icon
  return (
    <div className={`rounded-2xl border ${s.border} ${s.bg} overflow-hidden flex flex-col`}>
      <div style={{ height: 3, background: s.bar }}/>
      <div className="p-4 flex-1 flex flex-col gap-2.5">
        <div className="flex items-start gap-2.5">
          <Icon size={16} className={`${s.icon} flex-shrink-0 mt-0.5`}/>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded border ${s.badge}`}>{s.label}</span>
            </div>
            <p className="text-[13px] font-bold text-slate-800 leading-snug">{signal.title}</p>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed flex-1">{signal.body}</p>
        <div className="pt-1">
          <NavPill tabId={signal.tab} onNavigate={onNavigate}/>
        </div>
      </div>
    </div>
  )
}

function KpiStatusRow({ kpi, rank, onNavigate }) {
  const st     = kpi.fy_status || 'grey'
  const gap    = gapPct(kpi)
  const streak = redStreak(kpi)
  const sw     = soWhat(kpi)
  const vals   = (kpi.monthly || []).map(m => m.value).filter(v => v != null)
  const trendDir = vals.length >= 2
    ? (vals.at(-1) > vals[0] ? 'up' : vals.at(-1) < vals[0] ? 'down' : 'flat')
    : 'flat'
  const isGoodTrend = trendDir === 'up'
    ? kpi.direction === 'higher'
    : trendDir === 'down'
    ? kpi.direction !== 'higher'
    : null
  const data = sparkData(kpi)

  return (
    <div className="rounded-xl border border-slate-100 bg-white hover:shadow-sm hover:border-slate-200 transition-all p-3.5 flex flex-col gap-2">
      {/* Row 1: number + name + badges */}
      <div className="flex items-start gap-2.5">
        <span className="text-slate-300 font-mono text-[11px] w-4 text-center flex-shrink-0 mt-0.5">{rank}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[13px] font-bold text-slate-800 leading-snug">{kpi.name}</span>
            {streak >= 2 && (
              <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                {streak >= 3 && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0"/>}
                {streak}mo
              </span>
            )}
          </div>
          {/* Row 2: value + target + gap */}
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-[12px] font-mono font-bold text-slate-700">{fmt(kpi.avg, kpi.unit)}</span>
            {kpi.target && (
              <span className="text-[11px] text-slate-400">tgt {fmt(kpi.target, kpi.unit)}</span>
            )}
            {gap != null && (
              <span className={`text-[11px] font-bold ${gap >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {gap > 0 ? '+' : ''}{gap.toFixed(1)}%
              </span>
            )}
            {trendDir === 'up'   && <TrendingUp   size={11} className={isGoodTrend ? 'text-emerald-500' : 'text-red-400'}/>}
            {trendDir === 'down' && <TrendingDown  size={11} className={isGoodTrend ? 'text-emerald-500' : 'text-red-400'}/>}
            {trendDir === 'flat' && <Minus         size={11} className="text-slate-300"/>}
          </div>
        </div>
        {/* Mini sparkline */}
        <div className="flex-shrink-0 w-16 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
              <Line type="monotone" dataKey="value"
                stroke={st === 'red' ? '#ef4444' : st === 'yellow' ? '#f59e0b' : '#10b981'}
                strokeWidth={1.5} dot={false} connectNulls/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      {/* "So what" */}
      {sw && (
        <p className="text-[11px] text-slate-500 leading-snug border-t border-slate-50 pt-1.5 italic">
          {sw}
        </p>
      )}
    </div>
  )
}

function DomainStoryCard({ domain, kpis, onNavigate }) {
  const meta   = DOMAIN_META[domain] || DOMAIN_META.other
  const result = buildDomainStory(domain, kpis)
  if (!result) return null
  const { story, red, yellow, green } = result
  const Icon = meta.Icon
  const total = kpis.length
  const healthPct = total ? Math.round((green.length * 100 + yellow.length * 55) / total) : 0

  // Top 2 KPIs for sparklines (worst first)
  const spotlightKpis = [...red, ...yellow, ...green].slice(0, 2)

  return (
    <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white hover:shadow-md transition-all flex flex-col cursor-pointer"
      onClick={() => onNavigate('trends')}>
      {/* top stripe */}
      <div style={{ height: 3, background: meta.color }}/>
      <div className="p-5 flex flex-col gap-3 flex-1">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: meta.bg }}>
              <Icon size={14} style={{ color: meta.color }}/>
            </div>
            <span className="text-[12px] font-black text-slate-700 uppercase tracking-wide">{meta.label}</span>
          </div>
          <div className="flex items-center gap-1.5">
            {red.length > 0    && <span className="text-[9px] font-bold bg-red-50 border border-red-200 text-red-600 px-1.5 py-0.5 rounded-full">{red.length} critical</span>}
            {yellow.length > 0 && <span className="text-[9px] font-bold bg-amber-50 border border-amber-200 text-amber-600 px-1.5 py-0.5 rounded-full">{yellow.length} watch</span>}
            {red.length === 0 && yellow.length === 0 && <span className="text-[9px] font-bold bg-emerald-50 border border-emerald-200 text-emerald-600 px-1.5 py-0.5 rounded-full">all on target</span>}
          </div>
        </div>

        {/* Health bar */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-400 font-medium">Domain health</span>
            <span className="text-[10px] font-bold" style={{ color: meta.color }}>{healthPct}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${healthPct}%`, background: meta.color }}/>
          </div>
        </div>

        {/* Narrative */}
        <p className="text-[12px] text-slate-600 leading-relaxed flex-1">{story}</p>

        {/* Sparklines for spotlight KPIs */}
        {spotlightKpis.length > 0 && (
          <div className="flex gap-3 pt-1 border-t border-slate-50">
            {spotlightKpis.map(kpi => {
              const data   = sparkData(kpi)
              const st     = kpi.fy_status || 'grey'
              const lcolor = st === 'red' ? '#ef4444' : st === 'yellow' ? '#f59e0b' : '#10b981'
              return (
                <div key={kpi.key} className="flex-1 min-w-0">
                  <div className="text-[10px] text-slate-400 font-medium truncate">{kpi.name}</div>
                  <div className="text-[11px] font-bold" style={{ color: lcolor }}>{fmt(kpi.avg, kpi.unit)}</div>
                  <ResponsiveContainer width="100%" height={28}>
                    <AreaChart data={data} margin={{ top: 2, right: 1, bottom: 2, left: 1 }}>
                      <defs>
                        <linearGradient id={`g-${kpi.key}`} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%"   stopColor={lcolor} stopOpacity={0.25}/>
                          <stop offset="100%" stopColor={lcolor} stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="value" stroke={lcolor} strokeWidth={1.5}
                        fill={`url(#g-${kpi.key})`} dot={false} connectNulls/>
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )
            })}
          </div>
        )}

        <div className="flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
          Deep dive <ChevronRight size={10}/>
        </div>
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────
export default function BoardReady({ fingerprint, bridgeData, onNavigate }) {
  const dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  if (!fingerprint?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-3">
        <Layers size={36} className="text-slate-300"/>
        <p className="text-slate-400 text-sm text-center max-w-xs">
          No data yet. Load demo data or upload a CSV to generate your board intelligence brief.
        </p>
      </div>
    )
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const greenKpis  = fingerprint.filter(k => k.fy_status === 'green')
  const yellowKpis = fingerprint.filter(k => k.fy_status === 'yellow')
  const redKpis    = fingerprint.filter(k => k.fy_status === 'red')
  const total      = fingerprint.length
  const bhi        = total > 0 ? Math.round((greenKpis.length * 100 + yellowKpis.length * 60) / total) : null
  const bhiColor   = bhi == null ? '#94a3b8' : bhi >= 80 ? '#059669' : bhi >= 60 ? '#d97706' : '#dc2626'
  const bhiLabel   = bhi == null ? 'No data' : bhi >= 80 ? 'Healthy' : bhi >= 60 ? 'Caution' : 'At Risk'

  const thesis  = buildThesis(fingerprint, bhi)
  const signals = useMemo(() => detectSignals(fingerprint), [fingerprint])
  const outlook = useMemo(() => buildOutlook(fingerprint, bridgeData), [fingerprint, bridgeData])

  // Domain groups (excluding 'other' from stories if too small)
  const domainGroups = useMemo(() => {
    const groups = {}
    fingerprint.forEach(k => {
      const d = getDomain(k)
      groups[d] = groups[d] || []
      groups[d].push(k)
    })
    return groups
  }, [fingerprint])

  const storyDomains = ['growth', 'retention', 'efficiency', 'cashflow']
    .filter(d => (domainGroups[d]?.length || 0) >= 1)

  // Sorted risk list
  const atRisk = [...redKpis, ...yellowKpis].sort((a, b) => {
    if ((a.fy_status === 'red') !== (b.fy_status === 'red')) return a.fy_status === 'red' ? -1 : 1
    return Math.abs(gapPct(b) || 0) - Math.abs(gapPct(a) || 0)
  })

  // Radar data
  const radarData = fingerprint
    .filter(k => k.avg != null && k.target != null)
    .slice(0, 10)
    .map(k => ({
      kpi:    k.name.length > 15 ? k.name.slice(0, 13) + '…' : k.name,
      actual: Math.min(vsTarget(k), 135),
      target: 100,
    }))

  // Bridge risks
  const bridgeRisks = bridgeData?.kpis
    ? Object.values(bridgeData.kpis)
        .filter(k => k.avg_gap_pct != null && k.overall_status !== 'green')
        .sort((a, b) => a.avg_gap_pct - b.avg_gap_pct)
        .slice(0, 4)
    : []

  // Streak alerts
  const streakAlerts = fingerprint
    .filter(k => k.monthly?.length && redStreak(k) >= 2)
    .map(k => ({ ...k, streak: redStreak(k) }))
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 4)

  // Strong performers sorted by gap
  const strongSorted = [...greenKpis].sort((a, b) => (gapPct(b) || 0) - (gapPct(a) || 0))

  return (
    <div className="space-y-6 max-w-screen-xl">

      {/* ── 1. HERO ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden border border-slate-200"
        style={{ background: 'linear-gradient(135deg, #071e45 0%, #0a2d6e 45%, #0d3d8e 100%)' }}>
        <div className="p-7">
          <div className="flex items-start gap-6">

            {/* BHI Ring */}
            <div className="flex-shrink-0 flex flex-col items-center gap-2">
              <div className="relative">
                <svg width="90" height="90" viewBox="0 0 90 90">
                  <circle cx="45" cy="45" r="38" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8"/>
                  <circle cx="45" cy="45" r="38" fill="none" stroke={bhiColor} strokeWidth="8"
                    strokeDasharray={`${((bhi ?? 0) / 100) * 238.8} 238.8`}
                    strokeLinecap="round" transform="rotate(-90 45 45)"/>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-black text-white leading-none">{bhi ?? '—'}</span>
                  <span className="text-[9px] font-bold text-white/40 uppercase tracking-wider">BHI</span>
                </div>
              </div>
              <span className="text-[11px] font-bold px-2.5 py-1 rounded-full text-white"
                style={{ background: bhiColor + '40', border: `1px solid ${bhiColor}60` }}>
                {bhiLabel}
              </span>
            </div>

            {/* Thesis + Meta */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-1">
                <div className="flex items-center gap-1.5">
                  <Layers size={12} className="text-white/40"/>
                  <span className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Board Intelligence Brief</span>
                </div>
                <span className="text-[11px] text-white/30">{dateStr}</span>
              </div>

              {/* Thesis — the one sentence that matters */}
              <p className="text-[17px] font-bold text-white leading-snug mb-3 max-w-2xl">{thesis}</p>

              {/* Status pills */}
              <div className="flex flex-wrap items-center gap-2 mb-4">
                {redKpis.length > 0 && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-red-500/20 border border-red-400/25 text-red-200 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"/>
                    {redKpis.length} Critical
                  </span>
                )}
                {yellowKpis.length > 0 && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/20 border border-amber-400/25 text-amber-200">
                    {yellowKpis.length} Watch
                  </span>
                )}
                {greenKpis.length > 0 && (
                  <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/20 border border-emerald-400/25 text-emerald-200">
                    {greenKpis.length} On Target
                  </span>
                )}
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/8 border border-white/12 text-white/40">
                  {fingerprint.length} KPIs
                </span>
              </div>

              {/* BHI bar */}
              <div className="max-w-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-white/40 font-medium">Business Health Index</span>
                  <span className="text-[10px] text-white/40">{bhi}/100</span>
                </div>
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${bhi}%`, background: bhiColor }}/>
                </div>
              </div>
            </div>

            {/* Print */}
            <button onClick={e => { e.stopPropagation(); window.print() }}
              className="hidden md:flex flex-shrink-0 items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/18 border border-white/18 rounded-xl text-xs text-white font-semibold transition-all">
              <Printer size={13}/> Print
            </button>
          </div>
        </div>
      </div>

      {/* ── 2. SIGNAL GRID — Critical | Watch | Strong ────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Critical */}
        <div className="rounded-2xl border border-red-200 overflow-hidden bg-white">
          <div style={{ height: 3, background: '#ef4444' }}/>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertCircle size={14} className="text-red-500"/>
                <span className="text-[11px] font-black text-red-700 uppercase tracking-wider">Critical</span>
                <span className="text-[11px] font-bold text-red-500 bg-red-50 border border-red-200 rounded-full px-1.5">{redKpis.length}</span>
              </div>
              <NavPill tabId="dashboard" onNavigate={onNavigate}/>
            </div>
            {redKpis.length === 0 ? (
              <div className="py-6 text-center">
                <CheckCircle2 size={22} className="text-emerald-400 mx-auto mb-1.5"/>
                <p className="text-[12px] text-slate-400">No critical KPIs</p>
              </div>
            ) : (
              <div className="space-y-2">
                {atRisk.filter(k => k.fy_status === 'red').slice(0, 6).map((kpi, i) => (
                  <KpiStatusRow key={kpi.key} kpi={kpi} rank={i+1} onNavigate={onNavigate}/>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Watch */}
        <div className="rounded-2xl border border-amber-200 overflow-hidden bg-white">
          <div style={{ height: 3, background: '#f59e0b' }}/>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-amber-500"/>
                <span className="text-[11px] font-black text-amber-700 uppercase tracking-wider">Watch</span>
                <span className="text-[11px] font-bold text-amber-500 bg-amber-50 border border-amber-200 rounded-full px-1.5">{yellowKpis.length}</span>
              </div>
              <NavPill tabId="dashboard" onNavigate={onNavigate}/>
            </div>
            {yellowKpis.length === 0 ? (
              <div className="py-6 text-center">
                <CheckCircle2 size={22} className="text-emerald-400 mx-auto mb-1.5"/>
                <p className="text-[12px] text-slate-400">Nothing in the watch zone</p>
              </div>
            ) : (
              <div className="space-y-2">
                {atRisk.filter(k => k.fy_status === 'yellow').slice(0, 6).map((kpi, i) => (
                  <KpiStatusRow key={kpi.key} kpi={kpi} rank={i+1} onNavigate={onNavigate}/>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Strong */}
        <div className="rounded-2xl border border-emerald-200 overflow-hidden bg-white">
          <div style={{ height: 3, background: '#059669' }}/>
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={14} className="text-emerald-500"/>
                <span className="text-[11px] font-black text-emerald-700 uppercase tracking-wider">Strong</span>
                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-1.5">{greenKpis.length}</span>
              </div>
              <NavPill tabId="fingerprint" onNavigate={onNavigate}/>
            </div>
            {greenKpis.length === 0 ? (
              <div className="py-6 text-center">
                <p className="text-[12px] text-slate-400">No on-target KPIs yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {strongSorted.slice(0, 8).map(kpi => {
                  const gap   = gapPct(kpi)
                  const gStr  = greenStreak(kpi)
                  return (
                    <div key={kpi.key} className="flex items-center justify-between py-2 px-3 rounded-xl bg-emerald-50 border border-emerald-100">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[12px] font-semibold text-slate-700 truncate">{kpi.name}</span>
                        {gStr >= 3 && (
                          <span className="text-[9px] font-bold text-emerald-600 bg-emerald-100 border border-emerald-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            {gStr}mo ✓
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="font-mono text-[11px] font-bold text-slate-600">{fmt(kpi.avg, kpi.unit)}</span>
                        {gap != null && (
                          <span className="text-[11px] font-bold text-emerald-600">+{gap.toFixed(1)}%</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 3. HIDDEN SIGNALS ─────────────────────────────────────────────── */}
      {signals.length > 0 && (
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex items-center gap-1.5">
              <Zap size={14} className="text-slate-500"/>
              <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">Hidden Signals</span>
            </div>
            <div className="flex-1 h-px bg-slate-100"/>
            <span className="text-[10px] text-slate-400">Signals not visible in the financials</span>
          </div>
          <div className={`grid gap-4 ${
            signals.length >= 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' :
            signals.length === 3 ? 'grid-cols-1 sm:grid-cols-3' :
            signals.length === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'
          }`}>
            {signals.map((sig, i) => (
              <HiddenSignalCard key={i} signal={sig} onNavigate={onNavigate}/>
            ))}
          </div>
        </div>
      )}

      {/* ── 4. DOMAIN STORIES ─────────────────────────────────────────────── */}
      {storyDomains.length > 0 && (
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="flex items-center gap-1.5">
              <BarChart3 size={14} className="text-slate-500"/>
              <span className="text-[11px] font-black text-slate-600 uppercase tracking-widest">The Story by Domain</span>
            </div>
            <div className="flex-1 h-px bg-slate-100"/>
            <span className="text-[10px] text-slate-400">What the numbers actually mean</span>
          </div>
          <div className={`grid gap-4 ${storyDomains.length >= 4 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4' : `grid-cols-1 sm:grid-cols-${storyDomains.length}`}`}>
            {storyDomains.map(domain => (
              <DomainStoryCard
                key={domain}
                domain={domain}
                kpis={domainGroups[domain] || []}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── 5. PERFORMANCE SNAPSHOT — Radar + Streaks + Bridge ────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Radar */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden lg:col-span-1 cursor-pointer hover:shadow-md transition-all"
          onClick={() => onNavigate('fingerprint')}>
          <div style={{ height: 3, background: SOURCE.fingerprint.color }}/>
          <div className="p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-black text-slate-700">Performance Radar</span>
              <NavPill tabId="fingerprint" onNavigate={onNavigate}/>
            </div>
            <p className="text-[10px] text-slate-400 mb-2">All KPIs normalised to % of target (100 = on target)</p>
            <ResponsiveContainer width="100%" height={200}>
              <RadarChart data={radarData} margin={{ top: 8, right: 20, bottom: 8, left: 20 }}>
                <PolarGrid stroke="#f1f5f9"/>
                <PolarAngleAxis dataKey="kpi" tick={{ fill: '#94a3b8', fontSize: 8 }}/>
                <Radar name="Target" dataKey="target"
                  stroke="#e2e8f0" strokeWidth={1} strokeDasharray="4 3" fill="none"/>
                <Radar name="Actual" dataKey="actual"
                  stroke="#0055A4" fill="#0055A4" fillOpacity={0.18} strokeWidth={2}
                  dot={{ fill: '#0055A4', r: 2, strokeWidth: 0 }}/>
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Streak Alerts */}
        <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden cursor-pointer hover:shadow-md transition-all"
          onClick={() => onNavigate('fingerprint')}>
          <div style={{ height: 3, background: '#ef4444' }}/>
          <div className="p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-black text-slate-700">Consecutive Misses</span>
              <NavPill tabId="fingerprint" onNavigate={onNavigate}/>
            </div>
            <p className="text-[10px] text-slate-400 mb-4">KPIs with 2+ consecutive red months — the longer the streak, the more structural the problem</p>
            {streakAlerts.length === 0 ? (
              <div className="py-8 text-center">
                <CheckCircle2 size={24} className="text-emerald-400 mx-auto mb-2"/>
                <p className="text-[12px] text-slate-400">No consecutive misses detected</p>
              </div>
            ) : (
              <div className="space-y-3">
                {streakAlerts.map(k => {
                  const width = Math.min((k.streak / 12) * 100, 100)
                  return (
                    <div key={k.key}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[12px] font-semibold text-slate-700">{k.name}</span>
                        <span className="flex items-center gap-1 text-[11px] text-red-500 font-bold">
                          {k.streak >= 4 && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"/>}
                          {k.streak} months
                        </span>
                      </div>
                      <div className="h-1.5 bg-red-50 rounded-full overflow-hidden border border-red-100">
                        <div className="h-full bg-red-400 rounded-full transition-all" style={{ width: `${width}%` }}/>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Bridge summary or placeholder */}
        <div className="rounded-2xl border overflow-hidden cursor-pointer hover:shadow-md transition-all bg-white"
          style={{ borderColor: bridgeData?.has_overlap ? '#fde68a' : '#e2e8f0' }}
          onClick={() => onNavigate('projection')}>
          <div style={{ height: 3, background: SOURCE.projection.color }}/>
          <div className="p-5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-black text-slate-700">Forecast vs Actuals</span>
              <NavPill tabId="projection" onNavigate={onNavigate}/>
            </div>
            {bridgeData?.has_projection && bridgeData?.has_overlap ? (
              <>
                <p className="text-[10px] text-slate-400 mb-4">How actuals are tracking against the projection plan</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {[
                    { label: 'On Track',    value: bridgeData.summary?.on_track, color: '#059669', bg: '#f0fdf4' },
                    { label: 'Behind Plan', value: bridgeData.summary?.behind,   color: '#dc2626', bg: '#fef2f2' },
                    { label: 'Ahead',       value: bridgeData.summary?.ahead,    color: '#0055A4', bg: '#eff6ff' },
                    { label: 'Months',      value: bridgeData.summary?.total_months_compared, color: '#64748b', bg: '#f8fafc' },
                  ].map(t => (
                    <div key={t.label} className="rounded-xl p-2.5 text-center border border-slate-100"
                      style={{ background: t.bg }}>
                      <div className="text-xl font-black" style={{ color: t.color }}>{t.value ?? '—'}</div>
                      <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide mt-0.5">{t.label}</div>
                    </div>
                  ))}
                </div>
                {bridgeRisks.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Top Gaps</p>
                    {bridgeRisks.slice(0,3).map(k => (
                      <div key={k.name} className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-amber-50 border border-amber-100">
                        <span className="font-medium text-slate-700 truncate max-w-[120px]">{k.name}</span>
                        <span className={`font-bold flex-shrink-0 ml-2 ${k.avg_gap_pct < -3 ? 'text-red-500' : 'text-amber-600'}`}>
                          {k.avg_gap_pct != null ? `${k.avg_gap_pct > 0 ? '+' : ''}${k.avg_gap_pct.toFixed(1)}%` : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="py-8 text-center">
                <Target size={24} className="text-amber-300 mx-auto mb-2"/>
                <p className="text-[12px] font-semibold text-amber-600 mb-1">No projection data</p>
                <p className="text-[11px] text-slate-400">Upload a projection CSV to see<br/>forecast vs actuals comparison</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 6. OUTLOOK ────────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden border border-slate-200"
        style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}>
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Target size={14} className="text-white/50"/>
            <span className="text-[11px] font-black text-white/50 uppercase tracking-widest">30–90 Day Outlook</span>
            <div className="flex-1 h-px bg-white/8"/>
            <span className="text-[10px] text-white/30">Derived from current signal patterns</span>
          </div>
          <div className="space-y-3">
            {outlook.map((bullet, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5"
                  style={{ background: i === 0 && redKpis.length > 0 ? '#ef444425' : '#ffffff10',
                           border: `1px solid ${i === 0 && redKpis.length > 0 ? '#ef444450' : '#ffffff15'}` }}>
                  <span className="text-[9px] font-black"
                    style={{ color: i === 0 && redKpis.length > 0 ? '#fca5a5' : 'rgba(255,255,255,0.4)' }}>
                    {i + 1}
                  </span>
                </div>
                <p className="text-[12px] text-white/70 leading-relaxed">{bullet}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  )
}
