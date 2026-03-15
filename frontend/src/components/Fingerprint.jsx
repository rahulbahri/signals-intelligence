import { useState } from 'react'
import {
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
  ResponsiveContainer, Tooltip, Legend
} from 'recharts'
import { ChevronRight, FileDown, GitCompare } from 'lucide-react'

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
  if (direction === 'higher') return Math.min(pct, 135)
  return Math.max(200 - pct, 30)
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

function redStreak(kpi) {
  const byMonth = {}
  kpi.monthly.forEach(m => { byMonth[parseInt(m.period.split('-')[1], 10)] = m.value })
  let streak = 0
  for (let mo = 12; mo >= 1; mo--) {
    if (cellStatus(byMonth[mo], kpi.target, kpi.direction) === 'red') streak++
    else break
  }
  return streak
}

function halfAvg(kpi, half) {
  if (!kpi.monthly?.length) return kpi.avg
  const [from, to] = half === 'H1' ? [1, 6] : [7, 12]
  const months = kpi.monthly.filter(m => {
    const mo = parseInt(m.period.split('-')[1], 10)
    return mo >= from && mo <= to && m.value != null
  })
  if (!months.length) return kpi.avg
  return months.reduce((s, m) => s + m.value, 0) / months.length
}

// ── Board pack ─────────────────────────────────────────────────────────────
function generateBoardPack(fingerprint) {
  const now    = new Date()
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const green  = fingerprint.filter(k => k.fy_status === 'green').length
  const yellow = fingerprint.filter(k => k.fy_status === 'yellow').length
  const red    = fingerprint.filter(k => k.fy_status === 'red').length
  const bhi    = Math.round((green * 100 + yellow * 60) / Math.max(green + yellow + red, 1))

  const rows = fingerprint.map(k => {
    const byMonth = {}
    k.monthly?.forEach(m => { byMonth[parseInt(m.period.split('-')[1], 10)] = m.value })
    const lastMo  = [12,11,10,9].find(n => byMonth[n] != null)
    const prevMo  = lastMo ? [lastMo - 1, lastMo - 2].find(n => byMonth[n] != null) : null
    const lastVal = lastMo ? byMonth[lastMo] : null
    const prevVal = prevMo ? byMonth[prevMo] : null
    const trend   = lastVal != null && prevVal != null
      ? (lastVal > prevVal ? '▲' : lastVal < prevVal ? '▼' : '→') : '—'
    const trendGood = trend === '▲'
      ? k.direction === 'higher'
      : trend === '▼' ? k.direction !== 'higher' : null
    const trendColor = trendGood === true ? '#16a34a' : trendGood === false ? '#dc2626' : '#94a3b8'
    const stColor = { green: '#16a34a', yellow: '#d97706', red: '#dc2626' }[k.fy_status] || '#94a3b8'
    return `<tr>
      <td>${k.name}</td>
      <td style="text-align:right">${fmt(k.target, k.unit)}</td>
      <td style="text-align:right">${fmt(k.avg, k.unit)}</td>
      <td style="text-align:right">${fmt(lastVal, k.unit)}</td>
      <td style="color:${stColor};font-weight:700;text-align:center">${k.fy_status?.toUpperCase() || '—'}</td>
      <td style="color:${trendColor};font-weight:700;text-align:center">${trend}</td>
    </tr>`
  }).join('')

  const bhiColor = bhi >= 70 ? '#16a34a' : bhi >= 50 ? '#d97706' : '#dc2626'

  const html = `<!DOCTYPE html>
<html><head><title>Board Performance Pack — FY 2025</title>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Helvetica Neue, Arial, sans-serif; color: #1e293b; padding: 48px; max-width: 860px; margin: 0 auto; font-size: 13px; }
  h1  { font-size: 20px; font-weight: 800; color: #0055A4; margin: 0 0 4px; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 28px; }
  .summary { display: flex; gap: 0; margin-bottom: 28px; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  .s-item { flex: 1; padding: 16px 20px; text-align: center; border-right: 1px solid #e2e8f0; }
  .s-item:last-child { border-right: none; }
  .s-num  { font-size: 30px; font-weight: 900; line-height: 1; }
  .s-lbl  { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  thead th { background: #f1f5f9; padding: 8px 12px; color: #64748b; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: 1px solid #e2e8f0; }
  thead th:first-child { text-align: left; }
  tbody td { padding: 8px 12px; border-bottom: 1px solid #f8fafc; }
  tbody tr:last-child td { border-bottom: none; }
  .footer { margin-top: 28px; color: #94a3b8; font-size: 10px; border-top: 1px solid #e2e8f0; padding-top: 14px; }
  @media print { body { padding: 24px; } .no-print { display: none; } }
</style>
</head><body>
<h1>FY 2025 — Board Performance Pack</h1>
<div class="sub">Signals Intelligence · Prepared ${dateStr}</div>
<div class="summary">
  <div class="s-item"><div class="s-num" style="color:${bhiColor}">${bhi}</div><div class="s-lbl">Business Health Index</div></div>
  <div class="s-item"><div class="s-num" style="color:#16a34a">${green}</div><div class="s-lbl">On Target</div></div>
  <div class="s-item"><div class="s-num" style="color:#d97706">${yellow}</div><div class="s-lbl">Needs Attention</div></div>
  <div class="s-item"><div class="s-num" style="color:#dc2626">${red}</div><div class="s-lbl">Critical</div></div>
  <div class="s-item"><div class="s-num" style="color:#475569">${fingerprint.length}</div><div class="s-lbl">Total KPIs</div></div>
</div>
<table>
  <thead><tr>
    <th>KPI</th>
    <th style="text-align:right">Target</th>
    <th style="text-align:right">FY Average</th>
    <th style="text-align:right">Latest</th>
    <th style="text-align:center">Status</th>
    <th style="text-align:center">Trend</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<div class="footer">Confidential — For board distribution only &nbsp;·&nbsp; Signals Intelligence Platform &nbsp;·&nbsp; ${dateStr}</div>
<div class="no-print" style="margin-top:24px;text-align:center">
  <button onclick="window.print()" style="padding:8px 24px;background:#0055A4;color:#fff;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">
    Print / Save as PDF
  </button>
</div>
</body></html>`

  const w = window.open('', '_blank')
  w.document.write(html)
  w.document.close()
  setTimeout(() => w.focus(), 300)
}

// ── Main component ─────────────────────────────────────────────────────────
export default function Fingerprint({ fingerprint, onKpiClick }) {
  const [showPrior, setShowPrior] = useState(false)
  const [showDelta, setShowDelta] = useState(false)

  if (!fingerprint?.length) return null

  // Radar data — optionally split into H2 (current) vs H1 (prior period)
  const radarData = fingerprint
    .filter(k => k.avg != null && k.target != null)
    .slice(0, 12)
    .map(k => {
      const h2 = halfAvg(k, 'H2')
      const h1 = halfAvg(k, 'H1')
      return {
        kpi:    k.name.length > 20 ? k.name.slice(0, 18) + '…' : k.name,
        actual: Math.min(vsTarget(showPrior ? h2 : k.avg, k.target, k.direction), 135),
        target: 100,
        prior:  showPrior ? Math.min(vsTarget(h1, k.target, k.direction), 135) : undefined,
      }
    })

  const heat = fingerprint.filter(k => k.monthly?.length)

  return (
    <div className="space-y-6">

      {/* ── Radar ──────────────────────────────────────────────────────── */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">Performance Radar — % of Target</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              100 = on target · Outward = outperforming · Inward = gap
              {showPrior && <span className="ml-2 text-amber-600 font-medium">· Comparing H2 (current) vs H1 (prior)</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowPrior(p => !p)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                showPrior
                  ? 'bg-amber-50 text-amber-700 border-amber-300'
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
              }`}>
              <GitCompare size={12}/>
              {showPrior ? 'H1 vs H2' : 'Compare Periods'}
            </button>
          </div>
        </div>

        <ResponsiveContainer width="100%" height={380}>
          <RadarChart data={radarData} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
            <PolarGrid stroke="#e2e8f0"/>
            <PolarAngleAxis dataKey="kpi" tick={{ fill: '#64748b', fontSize: 10 }}/>
            {/* Target ring — darker stroke, no fill so it doesn't obscure the chart */}
            <Radar name="Target (100%)" dataKey="target"
              stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 3"
              fill="none"/>
            {/* Prior period (H1) — amber dashed, rendered first so actual sits on top */}
            {showPrior && (
              <Radar name="H1 2025 (Prior)" dataKey="prior"
                stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.08}
                strokeWidth={1.5} strokeDasharray="6 4"/>
            )}
            {/* Actual / H2 current */}
            <Radar name={showPrior ? 'H2 2025 (Current)' : 'Actual'} dataKey="actual"
              stroke="#0055A4" fill="#0055A4" fillOpacity={0.18}
              strokeWidth={2} dot={{ fill: '#0055A4', r: 3 }}/>
            <Tooltip
              contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 11, color: '#0f172a' }}
              formatter={(v, n) => [`${v?.toFixed(1)}%`, n]}/>
            <Legend wrapperStyle={{ fontSize: 11, color: '#64748b' }}/>
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Heat map ───────────────────────────────────────────────────── */}
      <div className="card p-6 overflow-x-auto">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h3 className="text-sm font-semibold text-slate-700">12-Month KPI Heat Map</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Cell colour = performance vs target · Click any row for deep-dive
              {showDelta && <span className="ml-2 text-blue-600 font-medium">· Showing Δ vs prior month</span>}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setShowDelta(d => !d)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                showDelta
                  ? 'bg-blue-50 text-blue-700 border-blue-300'
                  : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-slate-300'
              }`}>
              <GitCompare size={12}/>
              Δ Prior Month
            </button>
            <button
              onClick={() => generateBoardPack(fingerprint)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#0055A4] text-white border border-[#0055A4] hover:bg-[#0044a0] transition-all">
              <FileDown size={12}/>
              Board Pack
            </button>
          </div>
        </div>

        <table className="w-full text-xs border-collapse mt-4">
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
              const streak = redStreak(kpi)
              return (
                <tr key={kpi.key}
                  onClick={() => onKpiClick?.(kpi.key)}
                  className={`border-t border-slate-100 cursor-pointer hover:bg-blue-50/40 transition-colors group ${ri % 2 === 0 ? '' : 'bg-slate-50/40'}`}>
                  <td className="py-2 pr-2 pl-2 text-slate-700 font-medium whitespace-nowrap">
                    <span className="flex items-center gap-1.5">
                      {kpi.name}
                      {streak >= 2 && (
                        <span className="flex items-center gap-0.5 text-[9px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full flex-shrink-0">
                          {streak >= 3 && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse flex-shrink-0"/>}
                          {streak}mo
                        </span>
                      )}
                      <ChevronRight size={11} className="text-slate-300 group-hover:text-[#0055A4] transition-colors flex-shrink-0"/>
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right text-slate-500 font-mono">{fmt(kpi.target, kpi.unit)}</td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(mo => {
                    const val  = byMonth[mo]
                    const prev = byMonth[mo - 1]
                    const st   = cellStatus(val, kpi.target, kpi.direction)
                    // MoM delta: positive = value went up
                    const delta = (showDelta && val != null && prev != null) ? val - prev : null
                    // For "lower is better", a decrease is good (green arrow)
                    const deltaGood = delta != null
                      ? (kpi.direction === 'higher' ? delta > 0 : delta < 0)
                      : null
                    return (
                      <td key={mo} className="py-1.5 px-0.5">
                        <div className={`rounded px-1 py-1 text-center font-mono text-[11px] font-medium ${cellBg(st)}`}>
                          {val != null ? fmt(val, kpi.unit) : <span className="text-slate-300">—</span>}
                          {delta != null && (
                            <div className={`text-[8px] font-bold leading-tight mt-0.5 ${
                              deltaGood ? 'text-emerald-700' : 'text-red-500'
                            }`}>
                              {delta > 0 ? '▲' : '▼'}{Math.abs(delta).toFixed(1)}
                            </div>
                          )}
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
