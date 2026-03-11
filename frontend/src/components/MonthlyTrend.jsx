import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Legend
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

  const toggle = key => setSelected(s => s.includes(key) ? s.filter(x => x !== key) : [...s, key])

  if (!fingerprint?.length) return null

  const chartData = Array.from({ length: 12 }, (_, i) => {
    const mo    = i + 1
    const entry = { month: MONTHS[i] }
    fingerprint.forEach(kpi => {
      const m = kpi.monthly?.find(d => parseInt(d.period.split('-')[1], 10) === mo)
      entry[kpi.key] = m?.value ?? null
    })
    return entry
  })

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
                  : 'border-slate-200 text-slate-500 hover:border-slate-300 bg-white'
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
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Overlaid KPI Trends — FY 2025</h3>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9"/>
              <XAxis dataKey="month" tick={{ fill: '#94a3b8', fontSize: 11 }}/>
              <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }}/>
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11, color: '#0f172a', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}
                formatter={(v, name) => {
                  const kpi = fingerprint.find(k => k.key === name)
                  return [fmt(v, kpi?.unit), kpi?.name]
                }}/>
              <Legend formatter={name => fingerprint.find(k => k.key === name)?.name || name}
                wrapperStyle={{ fontSize: 11, color: '#64748b' }}/>
              {active.map((kpi, i) => (
                <Line key={kpi.key} type="monotone" dataKey={kpi.key}
                  stroke={COLORS[fingerprint.indexOf(kpi) % COLORS.length]}
                  strokeWidth={2} dot={{ r: 3, strokeWidth: 0 }} connectNulls/>
              ))}
              {active.map((kpi, i) => kpi.target != null && (
                <ReferenceLine key={`t-${kpi.key}`} y={kpi.target}
                  stroke={COLORS[fingerprint.indexOf(kpi) % COLORS.length]}
                  strokeDasharray="4 4" strokeOpacity={0.4}/>
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
                  <p className="text-xs text-slate-400 mt-0.5">
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
                  <Line type="monotone" dataKey="value" stroke={clr} strokeWidth={2} dot={false} connectNulls/>
                  {kpi.target && <ReferenceLine y={kpi.target} stroke="#cbd5e1" strokeDasharray="3 3"/>}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )
        })}
      </div>
    </div>
  )
}
