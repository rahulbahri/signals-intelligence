import { useState, useEffect } from 'react'
import axios from 'axios'
import {
  LayoutDashboard, Fingerprint, TrendingUp,
  Upload, Code2, RefreshCw, ChevronRight,
  Activity
} from 'lucide-react'
import Scorecard from './components/Scorecard.jsx'
import Fingerprint2 from './components/Fingerprint.jsx'
import MonthlyTrend from './components/MonthlyTrend.jsx'
import CSVUpload from './components/CSVUpload.jsx'
import APIReference from './components/APIReference.jsx'
import SummaryBar from './components/SummaryBar.jsx'
import KpiDetailPanel from './components/KpiDetailPanel.jsx'
import AiQueryPanel from './components/AiQueryPanel.jsx'

const TABS = [
  { id: 'dashboard',   label: 'Command Center',    Icon: LayoutDashboard },
  { id: 'fingerprint', label: 'Org Fingerprint',   Icon: Fingerprint     },
  { id: 'trends',      label: 'Monthly Trends',    Icon: TrendingUp      },
  { id: 'upload',      label: 'Data Upload',        Icon: Upload          },
  { id: 'api',         label: 'API Reference',      Icon: Code2           },
]

const PAGE_TITLES = {
  dashboard:   'Actionable Intelligence Command Center',
  fingerprint: 'Organisational Fingerprint',
  trends:      'Monthly KPI Trends',
  upload:      'Data Upload',
  api:         'API Reference',
}

export default function App() {
  const [tab, setTab]                 = useState('dashboard')
  const [summary, setSummary]         = useState(null)
  const [kpiDefs, setKpiDefs]         = useState([])
  const [monthly, setMonthly]         = useState([])
  const [fingerprint, setFingerprint] = useState([])
  const [loading, setLoading]         = useState(true)
  const [selectedKpi, setSelectedKpi] = useState(null)

  async function loadAll() {
    setLoading(true)
    try {
      const [s, k, m, f] = await Promise.all([
        axios.get('/api/summary'),
        axios.get('/api/kpi-definitions'),
        axios.get('/api/monthly'),
        axios.get('/api/fingerprint'),
      ])
      setSummary(s.data); setKpiDefs(k.data)
      setMonthly(m.data); setFingerprint(f.data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function seedDemo() {
    await axios.get('/api/seed-demo')
    loadAll()
  }

  function openKpi(kpiKey) {
    const kpi = fingerprint.find(k => k.key === kpiKey)
    const def = kpiDefs.find(k => k.key === kpiKey)
    setSelectedKpi(kpi ? { ...kpi, formula: def?.formula ?? null } : null)
  }

  const closeKpi = () => setSelectedKpi(null)

  useEffect(() => { loadAll() }, [])

  const noData   = !loading && summary?.months_of_data === 0
  const sb        = summary?.status_breakdown || {}
  const critical  = sb.red    || 0
  const attention = sb.yellow || 0
  const onTarget  = sb.green  || 0

  return (
    <div className="flex h-screen overflow-hidden">

      {/* ── Left Sidebar ──────────────────────────────────── */}
      <aside className="sidebar w-56 flex-shrink-0 flex flex-col h-full overflow-hidden">

        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#00AEEF]/20 border border-[#00AEEF]/40
                            flex items-center justify-center pulse-accent flex-shrink-0">
              <span className="text-[#00AEEF] font-bold text-xs">SI</span>
            </div>
            <div className="min-w-0">
              <p className="text-white font-bold text-sm leading-none">Signals</p>
              <p className="text-[#00AEEF] text-[10px] mt-0.5 tracking-widest uppercase truncate">
                Intelligence
              </p>
            </div>
          </div>
        </div>

        {/* Status mini-summary */}
        {!loading && summary && (
          <div className="px-4 py-3 border-b border-white/10">
            <p className="text-slate-400 text-[10px] uppercase tracking-wider mb-2 font-medium">
              FY 2025 Status
            </p>
            <div className="flex gap-2">
              <div className="flex-1 rounded-lg bg-red-500/15 border border-red-500/25 px-2 py-1.5 text-center">
                <div className="text-red-400 font-bold text-base leading-none">{critical}</div>
                <div className="text-red-400/70 text-[9px] mt-0.5 uppercase tracking-wide">Critical</div>
              </div>
              <div className="flex-1 rounded-lg bg-amber-500/15 border border-amber-500/25 px-2 py-1.5 text-center">
                <div className="text-amber-400 font-bold text-base leading-none">{attention}</div>
                <div className="text-amber-400/70 text-[9px] mt-0.5 uppercase tracking-wide">Watch</div>
              </div>
              <div className="flex-1 rounded-lg bg-emerald-500/15 border border-emerald-500/25 px-2 py-1.5 text-center">
                <div className="text-emerald-400 font-bold text-base leading-none">{onTarget}</div>
                <div className="text-emerald-400/70 text-[9px] mt-0.5 uppercase tracking-wide">Good</div>
              </div>
            </div>
          </div>
        )}

        {/* Navigation + AI Panel — share the flex-1 space so AI can expand */}
        <div className="flex-1 flex flex-col min-h-0">
          <nav className="flex-1 min-h-0 py-4 space-y-0.5 overflow-y-auto">
            <p className="text-slate-500 text-[10px] uppercase tracking-wider font-medium px-6 mb-2">
              Navigation
            </p>
            {TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`sidebar-link w-full text-left ${tab === id ? 'active' : ''}`}
              >
                <Icon size={15} className="flex-shrink-0" />
                <span className="flex-1">{label}</span>
                {tab === id && <ChevronRight size={12} className="text-[#00AEEF]" />}
              </button>
            ))}
          </nav>

          {/* AI Query Panel */}
          <AiQueryPanel />
        </div>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-white/10 space-y-2">
          <button onClick={loadAll}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                       text-xs text-slate-400 hover:text-white border border-white/10
                       hover:border-white/25 transition-all">
            <RefreshCw size={11}/> Refresh
          </button>
          <button onClick={seedDemo}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                       text-xs bg-[#0055A4]/50 border border-[#00AEEF]/30 text-[#00AEEF]
                       hover:bg-[#0055A4] transition-all">
            <Activity size={11}/> Load Demo
          </button>
          <a href="/api/docs" target="_blank"
             className="w-full flex items-center justify-center gap-2 py-2 rounded-lg
                        text-xs text-slate-500 hover:text-slate-300 transition-all">
            <Code2 size={11}/> API Docs ↗
          </a>
        </div>
      </aside>

      {/* ── Main Content ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Topbar */}
        <header className="topbar flex-shrink-0 px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="page-title">{PAGE_TITLES[tab]}</h1>
            {summary && (
              <span className="text-xs text-slate-400 hidden md:block">
                {summary.months_of_data} months · {summary.kpis_tracked}/{summary.kpis_available} KPIs
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="hidden lg:block">FY 2025 · Priority-1 KPIs</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse hidden lg:block"/>
            <span className="hidden lg:block text-emerald-600 font-medium">Live</span>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto px-6 py-5">

          {loading && (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin w-8 h-8 rounded-full border-4 border-[#0055A4] border-t-transparent"/>
            </div>
          )}

          {!loading && noData && (
            <div className="flex flex-col items-center justify-center h-64 gap-4">
              <p className="text-slate-500 text-base">No data yet — load demo data or upload a CSV.</p>
              <div className="flex gap-3">
                <button onClick={seedDemo}
                  className="px-5 py-2 rounded-lg bg-[#0055A4] hover:bg-[#003d80] text-white text-sm font-medium transition-colors">
                  Load Demo Data (12 months)
                </button>
                <button onClick={() => setTab('upload')}
                  className="px-5 py-2 rounded-lg border border-slate-300 hover:border-slate-400 text-slate-600 text-sm font-medium transition-colors">
                  Upload CSV
                </button>
              </div>
            </div>
          )}

          {!loading && !noData && (
            <>
              {tab === 'dashboard'   && <><SummaryBar summary={summary} onRefresh={loadAll} onSeed={seedDemo}/><Scorecard fingerprint={fingerprint} kpiDefs={kpiDefs} onKpiClick={openKpi}/></>}
              {tab === 'fingerprint' && <Fingerprint2 fingerprint={fingerprint} onKpiClick={openKpi}/>}
              {tab === 'trends'      && <MonthlyTrend fingerprint={fingerprint} monthly={monthly} onKpiClick={openKpi}/>}
              {tab === 'upload'      && <CSVUpload onUploaded={loadAll}/>}
              {tab === 'api'         && <APIReference kpiDefs={kpiDefs}/>}
            </>
          )}

          {!loading && noData && tab === 'upload' && <CSVUpload onUploaded={loadAll}/>}
          {!loading && noData && tab === 'api'    && <APIReference kpiDefs={kpiDefs}/>}
        </main>
      </div>

      {/* ── KPI Detail Panel (global, fixed overlay) ──────── */}
      <KpiDetailPanel kpi={selectedKpi} onClose={closeKpi}/>
    </div>
  )
}
