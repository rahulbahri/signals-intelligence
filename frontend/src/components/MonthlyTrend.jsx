import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Legend
} from 'recharts'
import { ChevronRight } from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const COLORS  = ['#0055A4','#059669','#d97706','#dc2626','#7c3aed','#ea580c','#0891b2','#db2777']

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

function badgeCls(s) {
  return { green:'badge-green', yellow:'badge-yellow', red:'badge-red', grey:'badge-grey' }[s] || 'badge-grey'
}

export default function MonthlyTrend({ fingerprint, onKpiClick }) {
  const [selected, setSelected] = useState(fingerprint?.slice(0, 4).map(k => k.key) || [])
  const [normMode, setNormMode] = useState(false)

  const toggle = key => setSelected(s => s.includes(key) ? s.filter(x => x !== key) : [...s, key])

  if (!fingerprint?.length) return null

  // Raw chart data (one entry per month, one key per KPI)
  const rawChartData = Array.from({ length: 12 }, (_, i) => {
    const mo    = i + 1
    const entry = { month: MONTHS[i] }
    fingerprint.forEach(kpi => {
      const m = kpi.monthly?.find(d => parseInt(d.period.split('-')[1], 10) === mo)
      entry[kpi.key] = m?.value ?? null
    })
    return entry
  })

  // Normalised chart data — each value becomes (value / target) * 100
  const normChartData = Array.from({ length: 12 }, (_, i) => {
    const mo    = i + 1
    const entry = { month: MONTHS[i] }
    fingerprint.forEach(kpi => {
      const m = kpi.monthly?.find(d => parseInt(d.period.split('-')[1], 10) === mo)
      entry[kpi.key] = (m?.value != null && kpi.target)
        ? (m.value / kpi.target) * 100
        : null
    })
    return entry
  })

  const chartData = normMode ? normChartData : rawChartData
  const active = fingerprint.filter(k => selected.includes(k.key))

  return (
    <div className="space-y-5">
      {/* KPI selector */}
      <div className="card p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Select KPIs to overlay</p>
        <div className="flex flex-wrap gap-2">
          {fingerprint.map((kpi, i) => (
            <button key={kpi.key} onClick={() => toggle(kpi.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                selected.includes(kpi.key)
                  ? 'text-white border-transparent'
                  : 'border-slate-200 text-slate-500 bg-slate-50 hover:border-slate-300 hover:bg-white'
              }`}
              style={selected.includes(kpi.key)
                ? { background: COLORS[i % COLORS.length], borderColor: COLORS[i % COLORS.length] }
                : {}}>
              {kpi.name}
            </button>
          ))}
        </div>
      </div>

      {/* Combined chart */}
      {active.length > 0 && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-700">Overlaid KPI Trends — FY 2025</h3>
              {normMode && (
                <p className="text-xs text-slate-400 mt-0.5">All KPIs normalised to % of target · 100 = on target</p>
              )}
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button
                onClick={() => setNormMode(false)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  !normMode ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                Raw Values
              </button>
              <button
                onClick={() => setNormMode(true)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  normMode ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}>
                % of Target
              </button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="month" tick={{ fill: '#64748b', fontSize: 11 }}/>
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                domain={normMode ? [50, 135] : undefined}
                tickFormatter={normMode ? v => `${v}%` : undefined}
              />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11, color: '#0f172a', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                formatter={(v, name) => {
                  const kpi = fingerprint.find(k => k.key === name)
                  if (normMode) return [`${v?.toFixed(1)}% of target`, kpi?.name]
                  return [fmt(v, kpi?.unit), kpi?.name]
                }}/>
              <Legend formatter={name => fingerprint.find(k => k.key === name)?.name || name}
                wrapperStyle={{ fontSize: 11, color: '#64748b' }}/>
              {normMode && (
                <>
                  <ReferenceLine y={100} stroke="#64748b" strokeWidth={1.5} strokeDasharray="5 3"
                    label={{ value: 'Target', position: 'right', fontSize: 10, fill: '#64748b' }}/>
                  <ReferenceArea y1={95} y2={105} fill="#f1f5f9" fillOpacity={0.6}/>
                </>
              )}
              {active.map((kpi) => (
                <Line key={kpi.key} type="monotone" dataKey={kpi.key}
                  stroke={COLORS[fingerprint.indexOf(kpi) % COLORS.length]}
                  strokeWidth={2} dot={{ r: 3, strokeWidth: 0 }} connectNulls/>
              ))}
              {!normMode && active.map((kpi) => kpi.target != null && (
                <ReferenceLine key={`t-${kpi.key}`} y={kpi.target}
                  stroke={COLORS[fingerprint.indexOf(kpi) % COLORS.length]}
                  strokeDasharray="4 4" strokeOpacity={0.8} strokeWidth={1.5}/>
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Individual sparkline grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {fingerprint.filter(kpi => kpi.monthly?.length).map((kpi, i) => {
          const data = MONTHS.map((m, idx) => {
            const mo    = idx + 1
            const match = kpi.monthly?.find(d => parseInt(d.period.split('-')[1], 10) === mo)
            return { month: m, value: match?.value ?? null }
          })
          const clr = COLORS[i % COLORS.length]
          const targetBand = kpi.target ? { y1: kpi.target * 0.95, y2: kpi.target * 1.05 } : null
          return (
            <div key={kpi.key}
              className="card p-4 cursor-pointer hover:shadow-md hover:scale-[1.01] hover:border-[#0055A4]/30 transition-all group"
              onClick={() => onKpiClick?.(kpi.key)}>
              <div className="flex justify-between items-start mb-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-700 flex items-center gap-1">
                    {kpi.name}
                    <ChevronRight size={12} className="text-slate-300 group-hover:text-[#0055A4] transition-colors flex-shrink-0"/>
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Avg: <span className="text-slate-600 font-medium">{fmt(kpi.avg, kpi.unit)}</span>
                    {kpi.target && <> · Target: <span className="text-slate-500">{fmt(kpi.target, kpi.unit)}</span></>}
                  </p>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold flex-shrink-0 ${badgeCls(kpi.fy_status)}`}>
                  {kpi.fy_status?.toUpperCase()}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={70}>
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="2 2" stroke="#f1f5f9"/>
                  {targetBand && (
                    <ReferenceArea y1={targetBand.y1} y2={targetBand.y2} fill="#f59e0b" fillOpacity={0.1}/>
                  )}
                  <Line type="monotone" dataKey="value" stroke={clr} strokeWidth={2} dot={false} connectNulls/>
                  {kpi.target && <ReferenceLine y={kpi.target} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1.5}/>}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}
