import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar, ResponsiveContainer,
  LineChart, Line
} from 'recharts'
import {
  ChevronRight, Printer, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle2, Activity
} from 'lucide-react'

// ── Helpers ────────────────────────────────────────────────────────────────
const MONTHS    = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const MONTH_NUMS = [1,2,3,4,5,6,7,8,9,10,11,12]

const UNIT_FMT = {
  pct:    v => `${v?.toFixed(1)}%`,
  days:   v => `${v?.toFixed(1)}d`,
  months: v => `${v?.toFixed(1)}mo`,
  ratio:  v => `${v?.toFixed(2)}x`,
}
function fmt(val, unit) {
  if (val == null) return '—'
  return (UNIT_FMT[unit] || (v => v?.toFixed(2)))(val)
}
function vsTarget(val, target, direction) {
  if (!target) return 100
  const pct = (val / target) * 100
  if (direction === 'higher') return Math.min(pct, 135)
  return Math.max(200 - pct, 30)
}
function cellStatus(val, target, direction) {
  if (val == null || !target) return 'grey'
  const pct = val / target
  if (direction === 'higher') return pct >= 0.98 ? 'green' : pct >= 0.90 ? 'yellow' : 'red'
  return pct <= 1.02 ? 'green' : pct <= 1.10 ? 'yellow' : 'red'
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

// ── Source tab definitions ─────────────────────────────────────────────────
const SOURCE = {
  dashboard:   { label: 'Command Center',  color: '#0055A4', bgCls: 'bg-blue-50',    borderCls: 'border-blue-200',    textCls: 'text-blue-700'    },
  fingerprint: { label: 'Org Fingerprint', color: '#7c3aed', bgCls: 'bg-violet-50',  borderCls: 'border-violet-200',  textCls: 'text-violet-700'  },
  trends:      { label: 'Monthly Trends',  color: '#059669', bgCls: 'bg-emerald-50', borderCls: 'border-emerald-200', textCls: 'text-emerald-700' },
  projection:  { label: 'Bridge Analysis', color: '#d97706', bgCls: 'bg-amber-50',   borderCls: 'border-amber-200',   textCls: 'text-amber-700'   },
}

const STATUS_COLOR = { green: '#059669', yellow: '#d97706', red: '#dc2626', grey: '#94a3b8' }

const STATUS_PILL = {
  green:  'bg-emerald-50 border-emerald-200 text-emerald-700',
  yellow: 'bg-amber-50  border-amber-200  text-amber-700',
  red:    'bg-red-50    border-red-200    text-red-700',
  grey:   'bg-slate-50  border-slate-200  text-slate-500',
}

// ── Auto-narrative ─────────────────────────────────────────────────────────
function buildNarrative(fingerprint, bhi, bridgeData) {
  if (!fingerprint?.length) return 'No data available.'
  const red    = fingerprint.filter(k => k.fy_status === 'red')
  const yellow = fingerprint.filter(k => k.fy_status === 'yellow')
  const green  = fingerprint.filter(k => k.fy_status === 'green')

  const verdict = bhi >= 80
    ? 'operating in a healthy range'
    : bhi >= 60
    ? 'showing some signs of strain'
    : 'under significant pressure'

  const worstKpi = [...red, ...yellow].sort((a, b) => {
    const gA = a.target ? Math.abs(a.avg / a.target - 1) : 0
    const gB = b.target ? Math.abs(b.avg / b.target - 1) : 0
    return gB - gA
  })[0]

  const bestKpi = [...green].sort((a, b) => {
    const gA = a.target ? (a.direction === 'higher' ? a.avg / a.target - 1 : 1 - a.avg / a.target) : 0
    const gB = b.target ? (b.direction === 'higher' ? b.avg / b.target - 1 : 1 - b.avg / b.target) : 0
    return gB - gA
  })[0]

  const parts = [`With a Business Health Index of ${bhi}/100, the organisation is ${verdict}.`]

  if (red.length > 0) {
    let s = `${red.length} KPI${red.length > 1 ? 's are' : ' is'} critical`
    if (worstKpi?.target) {
      const gap = ((worstKpi.avg / worstKpi.target - 1) * 100).toFixed(0)
      s += `, with ${worstKpi.name} most pressing at ${gap > 0 ? '+' : ''}${gap}% vs target`
    }
    parts.push(s + '.')
  } else if (yellow.length > 0) {
    parts.push(`${yellow.length} metric${yellow.length > 1 ? 's require' : ' requires'} monitoring.`)
  } else {
    parts.push('All tracked metrics are on or above target.')
  }

  if (bestKpi && green.length > 0) {
    const highlight = green.length > 1
      ? `${bestKpi.name} leads ${green.length} on-target KPIs`
      : `${bestKpi.name} is tracking on target`
    parts.push(`Bright spot: ${highlight}.`)
  }

  if (bridgeData?.has_projection && bridgeData?.summary?.behind > 0) {
    const { behind } = bridgeData.summary
    parts.push(`${behind} KPI${behind > 1 ? 's are' : ' is'} behind projection — forecasts warrant review.`)
  }

  return parts.join(' ')
}

// ── Section Card — clickable portal to a source tab ───────────────────────
function SectionCard({ title, subtitle, tabId, onNavigate, children }) {
  const src = SOURCE[tabId] || {}
  return (
    <div
      className="rounded-2xl border border-slate-200 overflow-hidden cursor-pointer group hover:shadow-lg hover:border-slate-300 transition-all duration-200"
      onClick={() => onNavigate(tabId)}>
      {/* Coloured top stripe */}
      <div style={{ height: 3, background: src.color || '#94a3b8' }}/>
      <div className="p-5">
        {/* Card header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
          </div>
          <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border flex-shrink-0 ml-3 ${src.bgCls} ${src.textCls} ${src.borderCls}`}>
            {src.label}
          </span>
        </div>

        {children}

        {/* Footer nav hint */}
        <div className={`mt-4 pt-3 border-t border-slate-100 flex items-center gap-1 text-xs font-semibold ${src.textCls} group-hover:gap-2 transition-all`}>
          View in {src.label}
          <ChevronRight size={12} className="group-hover:translate-x-0.5 transition-transform"/>
        </div>
      </div>
    </div>
  )
}

// ── Board KPIs for sparkline row ───────────────────────────────────────────
const BOARD_KPI_KEYS = ['revenue_growth', 'arr_growth', 'gross_margin', 'burn_multiple', 'nrr']

// ── Main component ─────────────────────────────────────────────────────────
export default function BoardReady({ fingerprint, bridgeData, onNavigate }) {
  const now     = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  if (!fingerprint?.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <Activity size={32} className="text-slate-300"/>
        <p className="text-slate-400 text-sm">No data yet — load demo data or upload a CSV to generate your board brief.</p>
      </div>
    )
  }

  // ── Derived values ─────────────────────────────────────────────────────
  const greenCount  = fingerprint.filter(k => k.fy_status === 'green').length
  const yellowCount = fingerprint.filter(k => k.fy_status === 'yellow').length
  const redCount    = fingerprint.filter(k => k.fy_status === 'red').length
  const total       = greenCount + yellowCount + redCount
  const bhi         = total > 0 ? Math.round((greenCount * 100 + yellowCount * 60) / total) : null
  const bhiColor    = bhi == null ? '#94a3b8' : bhi >= 80 ? '#059669' : bhi >= 60 ? '#d97706' : '#dc2626'
  const bhiLabel    = bhi == null ? 'No data' : bhi >= 80 ? 'Healthy' : bhi >= 60 ? 'Caution' : 'At Risk'
  const bhiTrack    = bhi == null ? 'rgba(255,255,255,0.15)' : bhi >= 80 ? '#bbf7d0' : bhi >= 60 ? '#fde68a' : '#fca5a5'

  const narrative = buildNarrative(fingerprint, bhi, bridgeData)

  // Priority attention KPIs — red first, then yellow, sorted by abs gap
  const atRisk = fingerprint
    .filter(k => k.fy_status === 'red' || k.fy_status === 'yellow')
    .sort((a, b) => {
      const pA = a.fy_status === 'red' ? 0 : 1
      const pB = b.fy_status === 'red' ? 0 : 1
      if (pA !== pB) return pA - pB
      const gA = a.target ? Math.abs(a.avg / a.target - 1) : 0
      const gB = b.target ? Math.abs(b.avg / b.target - 1) : 0
      return gB - gA
    })

  // Radar data
  const radarData = fingerprint
    .filter(k => k.avg != null && k.target != null)
    .slice(0, 10)
    .map(k => ({
      kpi:    k.name.length > 16 ? k.name.slice(0, 14) + '…' : k.name,
      actual: Math.min(vsTarget(k.avg, k.target, k.direction), 135),
      target: 100,
    }))

  // Streak alerts (trailing red months)
  const streakAlerts = fingerprint
    .filter(k => k.monthly?.length && redStreak(k) >= 2)
    .map(k => ({ ...k, streak: redStreak(k) }))
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 5)

  // Sparkline KPIs — prefer the standard board keys, fill remaining from fingerprint
  const boardKpis = [
    ...BOARD_KPI_KEYS.map(key => fingerprint.find(k => k.key === key)).filter(Boolean),
    ...fingerprint.filter(k => !BOARD_KPI_KEYS.includes(k.key)),
  ].slice(0, 5)

  function sparkData(kpi) {
    return MONTH_NUMS.map((mo, idx) => {
      const m = kpi.monthly?.find(d => parseInt(d.period.split('-')[1], 10) === mo)
      return { month: MONTHS[idx], value: m?.value ?? null }
    })
  }

  // Bridge risks
  const bridgeRisks = bridgeData?.kpis
    ? Object.values(bridgeData.kpis)
        .filter(k => k.avg_gap_pct != null && k.overall_status !== 'green')
        .sort((a, b) => a.avg_gap_pct - b.avg_gap_pct)
        .slice(0, 5)
    : []

  // Strong performers
  const strongKpis = fingerprint.filter(k => k.fy_status === 'green')

  return (
    <div className="space-y-5 max-w-screen-xl">

      {/* ── Hero Banner ─────────────────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden border border-slate-200 print:break-after-page"
        style={{ background: 'linear-gradient(135deg, #0a2d6e 0%, #0055A4 60%, #0077cc 100%)' }}>
        <div className="p-6 md:p-7">
          <div className="flex items-start gap-5 md:gap-7">

            {/* BHI Ring */}
            <div className="flex-shrink-0 flex flex-col items-center gap-2">
              <div className="relative">
                <svg width="80" height="80" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="33" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="7"/>
                  <circle cx="40" cy="40" r="33" fill="none" stroke={bhiColor} strokeWidth="7"
                    strokeDasharray={`${((bhi ?? 0) / 100) * 207.3} 207.3`}
                    strokeLinecap="round" transform="rotate(-90 40 40)"/>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-white leading-none">{bhi ?? '—'}</span>
                  <span className="text-[9px] font-bold text-white/50 uppercase tracking-wider">BHI</span>
                </div>
              </div>
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white"
                style={{ background: bhiColor + '45' }}>
                {bhiLabel}
              </span>
            </div>

            {/* Headline + Narrative */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-xl font-black text-white tracking-tight">Board Brief — FY 2025</h1>
                <span className="text-xs text-white/50 font-medium hidden md:block">{dateStr}</span>
              </div>
              <p className="text-sm text-white/85 leading-relaxed max-w-2xl">{narrative}</p>
              <div className="flex flex-wrap items-center gap-2 mt-3.5">
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-red-500/20 border border-red-400/25 text-red-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"/>
                  {redCount} Critical
                </span>
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-amber-500/20 border border-amber-400/25 text-amber-200">
                  {yellowCount} Watch
                </span>
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500/20 border border-emerald-400/25 text-emerald-200">
                  {greenCount} On Target
                </span>
                <span className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white/10 border border-white/15 text-white/50">
                  {fingerprint.length} KPIs total
                </span>
              </div>
            </div>

            {/* Print button */}
            <button
              onClick={(e) => { e.stopPropagation(); window.print() }}
              className="hidden md:flex flex-shrink-0 items-center gap-1.5 px-3.5 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl text-xs text-white font-semibold transition-all">
              <Printer size={13}/> Print Brief
            </button>
          </div>
        </div>
      </div>

      {/* ── Main 2-col grid ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-5">

        {/* Requires Attention — left 7 cols */}
        <div className="col-span-12 lg:col-span-7">
          <SectionCard
            title="Requires Immediate Attention"
            subtitle={`${atRisk.length} KPI${atRisk.length !== 1 ? 's' : ''} needing action — ranked by severity and gap`}
            tabId="dashboard"
            onNavigate={onNavigate}>
            {atRisk.length === 0 ? (
              <div className="flex items-center gap-2.5 py-4 px-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <CheckCircle2 size={18} className="text-emerald-500 flex-shrink-0"/>
                <p className="text-sm font-semibold text-emerald-700">All KPIs are on target — no issues to flag.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {atRisk.slice(0, 7).map((kpi, i) => {
                  const gap = kpi.target ? (kpi.avg / kpi.target - 1) * 100 : null
                  // For lower-is-better KPIs, flip the gap sign for display
                  const displayGap = gap != null
                    ? (kpi.direction !== 'higher' ? -gap : gap)
                    : null
                  const gapGood = displayGap != null && displayGap >= 0
                  const streak  = kpi.monthly?.length ? redStreak(kpi) : 0
                  return (
                    <div key={kpi.key}
                      className="flex items-center gap-3 py-2.5 px-3 rounded-xl bg-slate-50 hover:bg-white hover:shadow-sm border border-transparent hover:border-slate-200 transition-all">
                      <span className="text-slate-300 font-mono text-xs w-4 text-center flex-shrink-0">{i + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800">{kpi.name}</span>
                          <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-black border ${STATUS_PILL[kpi.fy_status]}`}>
                            {kpi.fy_status?.toUpperCase()}
                          </span>
                          {streak >= 2 && (
                            <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                              {streak >= 3 && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0"/>}
                              {streak}mo streak
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-[11px] text-slate-500">
                            Avg <span className="font-mono font-medium text-slate-700">{fmt(kpi.avg, kpi.unit)}</span>
                          </span>
                          {kpi.target && (
                            <span className="text-[11px] text-slate-400">
                              vs Target <span className="font-mono">{fmt(kpi.target, kpi.unit)}</span>
                            </span>
                          )}
                        </div>
                      </div>
                      {displayGap != null && (
                        <span className={`text-sm font-bold flex-shrink-0 ${gapGood ? 'text-emerald-600' : 'text-red-500'}`}>
                          {displayGap > 0 ? '+' : ''}{displayGap.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Performance Radar + Streaks — right 5 cols */}
        <div className="col-span-12 lg:col-span-5 space-y-5">

          <SectionCard
            title="Performance Radar"
            subtitle="All KPIs normalised to % of target"
            tabId="fingerprint"
            onNavigate={onNavigate}>
            <ResponsiveContainer width="100%" height={190}>
              <RadarChart data={radarData} margin={{ top: 5, right: 20, bottom: 5, left: 20 }}>
                <PolarGrid stroke="#e2e8f0"/>
                <PolarAngleAxis dataKey="kpi" tick={{ fill: '#94a3b8', fontSize: 9 }}/>
                <Radar name="Target" dataKey="target"
                  stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" fill="none"/>
                <Radar name="Actual" dataKey="actual"
                  stroke="#0055A4" fill="#0055A4" fillOpacity={0.2} strokeWidth={2}
                  dot={{ fill: '#0055A4', r: 2, strokeWidth: 0 }}/>
              </RadarChart>
            </ResponsiveContainer>

            {streakAlerts.length > 0 && (
              <div className="mt-1 pt-3 border-t border-slate-100">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <AlertTriangle size={10} className="text-red-400"/>
                  Consecutive Red Months
                </p>
                <div className="space-y-1.5">
                  {streakAlerts.map(k => (
                    <div key={k.key} className="flex items-center justify-between">
                      <span className="text-xs text-slate-700 font-medium">{k.name}</span>
                      <span className="flex items-center gap-1 text-[11px] text-red-500 font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0"/>
                        {k.streak} months
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

        </div>
      </div>

      {/* ── Monthly Momentum sparklines ──────────────────────────────────── */}
      <SectionCard
        title="Monthly Momentum — Key KPIs"
        subtitle="Full-year trend · dot = current average vs target"
        tabId="trends"
        onNavigate={onNavigate}>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
          {boardKpis.map(kpi => {
            const data  = sparkData(kpi)
            const vals  = data.filter(d => d.value != null).map(d => d.value)
            const first = vals[0]
            const last  = vals[vals.length - 1]
            const trendDir = last != null && first != null
              ? (last > first ? 'up' : last < first ? 'down' : 'flat')
              : 'flat'
            const isGood   = trendDir === 'up'
              ? kpi.direction === 'higher'
              : trendDir === 'down'
              ? kpi.direction !== 'higher'
              : null
            const lineColor = isGood === true ? '#059669' : isGood === false ? '#dc2626' : '#94a3b8'
            const st = kpi.fy_status || 'grey'
            return (
              <div key={kpi.key} className="text-center">
                <p className="text-[11px] font-semibold text-slate-500 truncate mb-1">{kpi.name}</p>
                <p className="text-xl font-black mb-0.5" style={{ color: STATUS_COLOR[st] }}>
                  {fmt(kpi.avg, kpi.unit)}
                </p>
                <ResponsiveContainer width="100%" height={44}>
                  <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                    <Line type="monotone" dataKey="value" stroke={lineColor} strokeWidth={2}
                      dot={false} connectNulls/>
                  </LineChart>
                </ResponsiveContainer>
                <div className="flex items-center justify-center gap-1 mt-1">
                  {trendDir === 'up'   && <TrendingUp   size={10} className={isGood ? 'text-emerald-500' : 'text-red-400'}/>}
                  {trendDir === 'down' && <TrendingDown  size={10} className={isGood ? 'text-emerald-500' : 'text-red-400'}/>}
                  {trendDir === 'flat' && <Minus         size={10} className="text-slate-300"/>}
                  <span className={`text-[10px] font-semibold ${
                    isGood === true ? 'text-emerald-500' : isGood === false ? 'text-red-400' : 'text-slate-400'
                  }`}>
                    {kpi.target ? `tgt ${fmt(kpi.target, kpi.unit)}` : 'no target'}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>

      {/* ── Bridge Analysis ──────────────────────────────────────────────── */}
      {bridgeData?.has_projection && bridgeData?.has_overlap ? (
        <SectionCard
          title="Forecast vs Actuals — Projection Bridge"
          subtitle="How actuals are tracking against the uploaded projection plan"
          tabId="projection"
          onNavigate={onNavigate}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {[
              { label: 'On Track',         value: bridgeData.summary?.on_track,              color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
              { label: 'Behind Plan',      value: bridgeData.summary?.behind,                color: 'text-red-600     bg-red-50    border-red-200'     },
              { label: 'Ahead of Plan',    value: bridgeData.summary?.ahead,                 color: 'text-blue-600    bg-blue-50   border-blue-200'    },
              { label: 'Months Compared',  value: bridgeData.summary?.total_months_compared, color: 'text-slate-600   bg-slate-50  border-slate-200'   },
            ].map(t => (
              <div key={t.label} className={`rounded-xl p-3 text-center border ${t.color}`}>
                <div className="text-2xl font-black">{t.value ?? '—'}</div>
                <div className="text-[10px] font-semibold uppercase tracking-wide mt-0.5 opacity-70">{t.label}</div>
              </div>
            ))}
          </div>

          {bridgeRisks.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Top Gaps vs Projection</p>
              <div className="space-y-1.5">
                {bridgeRisks.map(k => (
                  <div key={k.name}
                    className="flex items-center justify-between text-xs py-2 px-3 rounded-xl bg-amber-50 border border-amber-100">
                    <span className="font-semibold text-slate-700">{k.name}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-slate-500 font-mono text-[11px]">
                        Actual: {k.avg_actual != null ? k.avg_actual.toFixed(1) : '—'}
                      </span>
                      <span className={`font-bold ${k.avg_gap_pct < -3 ? 'text-red-600' : 'text-amber-600'}`}>
                        {k.avg_gap_pct != null
                          ? `${k.avg_gap_pct > 0 ? '+' : ''}${k.avg_gap_pct.toFixed(1)}% vs plan`
                          : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      ) : (
        <div
          className="rounded-2xl border border-dashed border-amber-200 bg-amber-50/40 p-6 text-center cursor-pointer hover:bg-amber-50/70 transition-colors"
          onClick={() => onNavigate('projection')}>
          <p className="text-sm font-semibold text-amber-700">No projection data uploaded yet</p>
          <p className="text-xs text-amber-500 mt-1">
            Upload a projection CSV to see forecast vs actuals here
            <ChevronRight size={12} className="inline ml-0.5"/>
          </p>
        </div>
      )}

      {/* ── Strong Performers ────────────────────────────────────────────── */}
      {strongKpis.length > 0 && (
        <SectionCard
          title="Strong Performers — On or Above Target"
          subtitle={`${strongKpis.length} of ${fingerprint.length} KPIs meeting or beating their targets`}
          tabId="dashboard"
          onNavigate={onNavigate}>
          <div className="flex flex-wrap gap-2">
            {strongKpis.map(kpi => {
              const gap = kpi.target
                ? (kpi.direction === 'higher'
                    ? (kpi.avg / kpi.target - 1) * 100
                    : (1 - kpi.avg / kpi.target) * 100)
                : null
              return (
                <div key={kpi.key}
                  className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-xl text-xs">
                  <span className="font-semibold text-slate-700">{kpi.name}</span>
                  <span className="font-mono font-bold text-emerald-700">{fmt(kpi.avg, kpi.unit)}</span>
                  {gap != null && (
                    <span className="font-bold text-emerald-600">
                      +{gap.toFixed(1)}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </SectionCard>
      )}

    </div>
  )
}
