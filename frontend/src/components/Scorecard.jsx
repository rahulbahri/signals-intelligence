import { TrendingUp, TrendingDown, Minus, AlertTriangle, Eye, CheckCircle2, ChevronRight } from 'lucide-react'

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

function TrendIcon({ trend, direction }) {
  const goodUp   = direction !== 'lower'
  const isGoodTrend = (trend === 'up' && goodUp) || (trend === 'down' && !goodUp)
  if (trend === 'up')   return <TrendingUp  size={13} className={isGoodTrend ? 'text-emerald-500' : 'text-red-500'}/>
  if (trend === 'down') return <TrendingDown size={13} className={isGoodTrend ? 'text-emerald-500' : 'text-red-500'}/>
  return <Minus size={13} className="text-slate-400"/>
}

function vsTarget(val, target, direction) {
  if (!target || !val) return null
  const pct = ((val / target) * 100).toFixed(0)
  const good = direction === 'higher' ? val >= target : val <= target
  return { pct, good }
}

function SparkBar({ data, target, direction }) {
  const values = data.map(d => d.value).filter(v => v != null)
  if (!values.length) return null
  const min = Math.min(...values); const max = Math.max(...values); const range = max - min || 1
  return (
    <div className="flex items-end gap-0.5 h-5 mt-1">
      {values.map((v, i) => {
        const h = Math.max(3, ((v - min) / range) * 100)
        const ok = target == null ? true : direction === 'higher' ? v >= target * 0.92 : v <= target * 1.08
        return (
          <div key={i} style={{ height: `${h}%` }}
            className={`flex-1 rounded-sm ${ok ? 'bg-emerald-400/70' : 'bg-red-400/60'}`}/>
        )
      })}
    </div>
  )
}

function KPICard({ kpi, onKpiClick }) {
  const borderCls = {
    green:  'kpi-card-green',
    yellow: 'kpi-card-yellow',
    red:    'kpi-card-red',
    grey:   'kpi-card-grey',
  }[kpi.fy_status] || 'kpi-card-grey'

  const vs = vsTarget(kpi.avg, kpi.target, kpi.direction)

  const best  = kpi.monthly?.length ? (kpi.direction === 'higher'
    ? Math.max(...kpi.monthly.map(m => m.value)) : Math.min(...kpi.monthly.map(m => m.value))) : null
  const worst = kpi.monthly?.length ? (kpi.direction === 'higher'
    ? Math.min(...kpi.monthly.map(m => m.value)) : Math.max(...kpi.monthly.map(m => m.value))) : null

  return (
    <div className={`card ${borderCls} p-4 flex flex-col gap-2 cursor-pointer
                     hover:shadow-md hover:scale-[1.01] hover:border-[#0055A4]/30 transition-all group`}
         onClick={() => onKpiClick?.(kpi.key)}>
      {/* Name + trend + drill icon */}
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-600 leading-snug">{kpi.name}</p>
        <div className="flex items-center gap-1 flex-shrink-0">
          <TrendIcon trend={kpi.trend} direction={kpi.direction}/>
          <ChevronRight size={11} className="text-slate-300 group-hover:text-[#0055A4] transition-colors"/>
        </div>
      </div>

      {/* Value */}
      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-bold text-slate-900 leading-none">{fmt(kpi.avg, kpi.unit)}</span>
        <span className="text-xs text-slate-400">FY avg</span>
      </div>

      {/* Target row */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400">Target: <span className="text-slate-600 font-medium">{fmt(kpi.target, kpi.unit)}</span></span>
        {vs && (
          <span className={`font-semibold ${vs.good ? 'text-emerald-600' : 'text-red-600'}`}>
            {vs.good ? '+' : ''}{(kpi.avg - kpi.target).toFixed(1)}{kpi.unit === 'pct' ? 'pp' : ''}
          </span>
        )}
      </div>

      {/* Sparkbar */}
      {kpi.monthly?.length > 1 && (
        <SparkBar data={kpi.monthly} target={kpi.target} direction={kpi.direction}/>
      )}

      {/* Best / Worst */}
      <div className="flex justify-between text-[10px] text-slate-400 pt-0.5">
        <span>Best <span className="text-slate-600">{fmt(best, kpi.unit)}</span></span>
        <span>Worst <span className="text-slate-600">{fmt(worst, kpi.unit)}</span></span>
      </div>
    </div>
  )
}

const SECTION_CONFIG = {
  red: {
    label:       'Critical — Immediate Action Required',
    sublabel:    'These KPIs are significantly off target and need urgent attention.',
    Icon:        AlertTriangle,
    headerColor: 'border-red-500',
    iconColor:   'text-red-500',
    titleColor:  'text-red-700',
    badgeCls:    'bg-red-100 text-red-700',
    bg:          'bg-red-50/60',
  },
  yellow: {
    label:       'Needs Attention — Monitor Closely',
    sublabel:    'These KPIs are trending below target and require proactive management.',
    Icon:        Eye,
    headerColor: 'border-amber-400',
    iconColor:   'text-amber-500',
    titleColor:  'text-amber-700',
    badgeCls:    'bg-amber-100 text-amber-700',
    bg:          'bg-amber-50/50',
  },
  green: {
    label:       'On Target — Performing Well',
    sublabel:    'These KPIs are at or above target. Continue monitoring for sustainability.',
    Icon:        CheckCircle2,
    headerColor: 'border-emerald-500',
    iconColor:   'text-emerald-500',
    titleColor:  'text-emerald-700',
    badgeCls:    'bg-emerald-100 text-emerald-700',
    bg:          'bg-emerald-50/30',
  },
  grey: {
    label:       'No Target Set',
    sublabel:    '',
    Icon:        Minus,
    headerColor: 'border-slate-300',
    iconColor:   'text-slate-400',
    titleColor:  'text-slate-500',
    badgeCls:    'bg-slate-100 text-slate-500',
    bg:          '',
  },
}

function Section({ status, kpis, onKpiClick }) {
  if (!kpis.length) return null
  const { label, sublabel, Icon, headerColor, iconColor, titleColor, badgeCls, bg } = SECTION_CONFIG[status]

  return (
    <div className={`rounded-2xl border border-slate-200 overflow-hidden mb-6 ${bg}`}>
      {/* Section header */}
      <div className={`flex items-center gap-3 px-5 py-4 border-b-2 ${headerColor} bg-white/70`}>
        <Icon size={18} className={iconColor}/>
        <div className="flex-1 min-w-0">
          <h2 className={`text-sm font-bold ${titleColor}`}>{label}</h2>
          {sublabel && <p className="text-xs text-slate-500 mt-0.5">{sublabel}</p>}
        </div>
        <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${badgeCls}`}>
          {kpis.length} KPI{kpis.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* KPI grid */}
      <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {kpis.map(kpi => <KPICard key={kpi.key} kpi={kpi} onKpiClick={onKpiClick}/>)}
      </div>
    </div>
  )
}

export default function Scorecard({ fingerprint, onKpiClick }) {
  if (!fingerprint?.length) return null

  const groups = { red: [], yellow: [], green: [], grey: [] }
  fingerprint.forEach(kpi => groups[kpi.fy_status || 'grey'].push(kpi))

  return (
    <div>
      <Section status="red"    kpis={groups.red}    onKpiClick={onKpiClick}/>
      <Section status="yellow" kpis={groups.yellow} onKpiClick={onKpiClick}/>
      <Section status="green"  kpis={groups.green}  onKpiClick={onKpiClick}/>
      <Section status="grey"   kpis={groups.grey}   onKpiClick={onKpiClick}/>
    </div>
  )
}
