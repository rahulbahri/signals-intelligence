import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, Tooltip, Legend
} from 'recharts'
import { ChevronRight } from 'lucide-react'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

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
  return direction === 'higher' ? Math.min(pct, 135) : Math.max(200 - pct, 0)
}

function cellBg(s) {
  return { green: 'hm-green', yellow: 'hm-yellow', red: 'hm-red', grey: 'hm-grey' }[s] || 'hm-grey'
}

function badgeCls(s) {
  return {
    green:  'badge-green',
    yellow: 'badge-yellow',
    red:    'badge-red',
    grey:   'badge-grey',
  }[s] || 'badge-grey'
}

function cellStatus(val, target, direction) {
  if (val == null || !target) return 'grey'
  const pct = val / target
  if (direction === 'higher') return pct >= 0.98 ? 'green' : pct >= 0.90 ? 'yellow' : 'red'
  return pct <= 1.02 ? 'green' : pct <= 1.10 ? 'yellow' : 'red'
}

export default function Fingerprint({ fingerprint, onKpiClick }) {
  if (!fingerprint?.length) return null

  const radarData = fingerprint
    .filter(k => k.avg != null && k.target != null)
    .slice(0, 12)
    .map(k => ({
      kpi:    k.name.length > 20 ? k.name.slice(0, 18) + '…' : k.name,
      actual: Math.min(vsTarget(k.avg, k.target, k.direction), 135),
      target: 100,
    }))

  const heat = fingerprint.filter(k => k.monthly?.length)

  return (
    <div className="space-y-6">
      {/* Radar */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Performance Radar — % of Target</h3>
        <p className="text-xs text-slate-400 mb-4">100 = on target. Outward bulge = outperforming. Inward = gap.</p>
        <ResponsiveContainer width="100%" height={380}>
          <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
            <PolarGrid stroke="#e2e8f0"/>
            <PolarAngleAxis dataKey="kpi" tick={{ fill: '#64748b', fontSize: 10 }}/>
            <Radar name="Target (100%)" dataKey="target"
              stroke="#cbd5e1" fill="#f1f5f9" fillOpacity={0.8}/>
            <Radar name="Actual" dataKey="actual"
              stroke="#0055A4" fill="#0055A4" fillOpacity={0.18}
              strokeWidth={2} dot={{ fill: '#0055A4', r: 3 }}/>
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11, color: '#0f172a' }}
              formatter={(v, n) => [`${v?.toFixed(1)}%`, n]}/>
            <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }}/>
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Heat map */}
      <div className="card p-6 overflow-x-auto">
        <h3 className="text-sm font-semibold text-slate-700 mb-1">12-Month KPI Heat Map</h3>
        <p className="text-xs text-slate-400 mb-4">Cell colour = performance vs target. Click any row for a deep-dive panel.</p>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50">
              <th className="text-left text-slate-500 font-semibold py-2.5 pr-4 pl-2 whitespace-nowrap rounded-tl-lg">KPI</th>
              <th className="text-right text-slate-500 font-semibold py-2.5 px-3">Target</th>
              {MONTHS.map(m => (
                <th key={m} className="text-center text-slate-500 font-semibold py-2.5 px-1 min-w-[52px]">{m}</th>
              ))}
              <th className="text-center text-slate-500 font-semibold py-2.5 px-2 bg-slate-100 rounded-tr-sm">FY Avg</th>
              <th className="text-center text-slate-500 font-semibold py-2.5 px-2">Status</th>
              <th className="py-2.5 px-2"/>
            </tr>
          </thead>
          <tbody>
            {heat.map((kpi, ri) => {
              const byMonth = {}
              kpi.monthly.forEach(m => { byMonth[parseInt(m.period.split('-')[1], 10)] = m.value })
              return (
                <tr key={kpi.key}
                  onClick={() => onKpiClick?.(kpi.key)}
                  className={`border-t border-slate-100 cursor-pointer hover:bg-blue-50/40 transition-colors group ${ri % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                  <td className="py-2 pr-2 pl-2 text-slate-700 font-medium whitespace-nowrap">
                    <span className="flex items-center gap-1">
                      {kpi.name}
                      <ChevronRight size={11} className="text-slate-300 group-hover:text-[#0055A4] transition-colors flex-shrink-0"/>
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right text-slate-500 font-mono">{fmt(kpi.target, kpi.unit)}</td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(mo => {
                    const val = byMonth[mo]
                    const st  = cellStatus(val, kpi.target, kpi.direction)
                    return (
                      <td key={mo} className="py-1.5 px-0.5">
                        <div className={`rounded px-1 py-1.5 text-center font-mono text-[11px] font-medium ${cellBg(st)}`}>
                          {val != null ? fmt(val, kpi.unit) : <span className="text-slate-300">—</span>}
                        </div>
                      </td>
                    )
                  })}
                  <td className="py-1.5 px-1">
                    <div className={`rounded px-1 py-1.5 text-center font-mono text-[11px] font-bold ${cellBg(kpi.fy_status)} bg-opacity-80`}>
                      {fmt(kpi.avg, kpi.unit)}
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeCls(kpi.fy_status)}`}>
                      {kpi.fy_status?.toUpperCase()}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-center">
                    <ChevronRight size={13} className="text-slate-200 group-hover:text-[#0055A4] transition-colors"/>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
