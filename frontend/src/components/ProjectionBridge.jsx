import { useState, useRef } from 'react'
import axios from 'axios'
import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Cell, ReferenceLine, Legend
} from 'recharts'
import {
  Upload, Trash2, AlertTriangle, TrendingDown, TrendingUp,
  Minus, ChevronDown, ChevronUp, ExternalLink, X, GitBranch
} from 'lucide-react'

// ─── Color constants ────────────────────────────────────────────────────────
const C_PROJECTED = '#3b82f6'
const C_AHEAD     = '#10b981'
const C_BEHIND    = '#ef4444'
const C_YELLOW    = '#f59e0b'

function statusColor(status) {
  if (status === 'green')  return C_AHEAD
  if (status === 'yellow') return C_YELLOW
  return C_BEHIND
}

function gapColor(gapPct) {
  if (gapPct >= 3)  return C_AHEAD
  if (gapPct >= -3) return '#94a3b8'
  if (gapPct >= -8) return C_YELLOW
  return C_BEHIND
}

function fmtVal(val, unit) {
  if (val === null || val === undefined) return '—'
  if (unit === 'pct')    return `${val.toFixed(1)}%`
  if (unit === 'ratio')  return val.toFixed(2)
  if (unit === 'days')   return `${val.toFixed(0)}d`
  if (unit === 'months') return `${val.toFixed(1)}mo`
  return val.toFixed(1)
}

// ─── UploadZone ─────────────────────────────────────────────────────────────
function UploadZone({ onUploaded }) {
  const [dragging, setDragging]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError]         = useState(null)
  const [uploads, setUploads]     = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const inputRef = useRef(null)

  async function fetchUploads() {
    setLoadingList(true)
    try {
      const { data } = await axios.get('/api/projection/uploads')
      setUploads(data)
    } catch (e) { /* silent */ }
    setLoadingList(false)
  }

  useState(() => { fetchUploads() }, [])

  async function handleFile(file) {
    if (!file || !file.name.match(/\.csv$/i)) {
      setError('Please upload a CSV file.')
      return
    }
    setError(null)
    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    try {
      await axios.post('/api/projection/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      await fetchUploads()
      onUploaded()
    } catch (e) {
      setError(e?.response?.data?.detail || 'Upload failed.')
    }
    setUploading(false)
  }

  async function deleteUpload(id) {
    try {
      await axios.delete(`/api/projection/uploads/${id}`)
      await fetchUploads()
      onUploaded()
    } catch (e) { /* silent */ }
  }

  function onDrop(e) {
    e.preventDefault(); setDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Upload size={15} className="text-blue-400"/>
        <h3 className="text-sm font-semibold text-white">Upload Projection CSV</h3>
        <span className="text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/25 px-2 py-0.5 rounded-full">
          replaces existing projection
        </span>
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
          dragging
            ? 'border-blue-400 bg-blue-400/10'
            : 'border-white/15 hover:border-blue-400/40 hover:bg-white/3'
        }`}
      >
        <input ref={inputRef} type="file" accept=".csv" className="hidden"
          onChange={e => handleFile(e.target.files[0])}/>
        {uploading
          ? <p className="text-slate-400 text-sm animate-pulse">Uploading projection…</p>
          : <>
              <Upload size={20} className="text-slate-500 mx-auto mb-2"/>
              <p className="text-slate-300 text-sm font-medium">Drop projection CSV here</p>
              <p className="text-slate-500 text-xs mt-1">Same format as actuals — raw transactions CSV</p>
            </>
        }
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
          <AlertTriangle size={11}/> {error}
        </p>
      )}

      {/* Upload history */}
      {uploads.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">Projection uploads</p>
          {uploads.map(u => (
            <div key={u.id} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
              <div>
                <p className="text-xs text-slate-300 font-medium">{u.filename}</p>
                <p className="text-[10px] text-slate-500">{u.row_count.toLocaleString()} rows · {u.uploaded_at?.slice(0,10)}</p>
              </div>
              <button
                onClick={() => deleteUpload(u.id)}
                className="text-slate-500 hover:text-red-400 transition-colors p-1 rounded">
                <Trash2 size={12}/>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── SummaryBanner ──────────────────────────────────────────────────────────
function SummaryBanner({ summary }) {
  const tiles = [
    { label: 'On Track',      value: summary.on_track,              color: 'emerald' },
    { label: 'Behind Plan',   value: summary.behind,                color: 'red'     },
    { label: 'Ahead of Plan', value: summary.ahead,                 color: 'blue'    },
    { label: 'Months Compared', value: summary.total_months_compared, color: 'slate'   },
  ]
  const colorMap = {
    emerald: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/25', text: 'text-emerald-400', sub: 'text-emerald-400/60' },
    red:     { bg: 'bg-red-500/10',     border: 'border-red-500/25',     text: 'text-red-400',     sub: 'text-red-400/60'     },
    blue:    { bg: 'bg-blue-500/10',    border: 'border-blue-500/25',    text: 'text-blue-400',    sub: 'text-blue-400/60'    },
    slate:   { bg: 'bg-slate-500/10',   border: 'border-slate-500/25',   text: 'text-slate-300',   sub: 'text-slate-500'      },
  }
  return (
    <div className="grid grid-cols-4 gap-4 mb-6">
      {tiles.map(({ label, value, color }) => {
        const c = colorMap[color]
        return (
          <div key={label} className={`card p-4 ${c.bg} border ${c.border}`}>
            <div className={`text-2xl font-bold ${c.text}`}>{value}</div>
            <div className={`text-[11px] mt-0.5 font-medium ${c.sub} uppercase tracking-wide`}>{label}</div>
          </div>
        )
      })}
    </div>
  )
}

// ─── OverviewChart ──────────────────────────────────────────────────────────
function OverviewChart({ kpis }) {
  const kpiList = Object.entries(kpis)
  const [selected, setSelected] = useState(
    kpiList.slice(0, 4).map(([k]) => k)
  )

  function toggle(key) {
    setSelected(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : prev.length < 6 ? [...prev, key] : prev
    )
  }

  // Build chart data: one entry per KPI, with avg_actual and avg_projected
  const chartData = kpiList
    .filter(([k]) => selected.includes(k))
    .map(([k, v]) => ({
      name:       v.name.length > 18 ? v.name.slice(0, 16) + '…' : v.name,
      projected:  v.avg_projected,
      actual:     v.avg_actual,
      status:     v.overall_status,
      unit:       v.unit,
    }))

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-sm font-semibold text-white">KPI Overview — Projected vs Actual</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">Averages across all compared months · Select up to 6 KPIs</p>
        </div>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{background: C_PROJECTED}}/> Projected</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-emerald-500/80"/> On Track</span>
          <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block bg-red-500/80"/> Behind</span>
        </div>
      </div>

      {/* KPI selector pills */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {kpiList.map(([k, v]) => (
          <button key={k}
            onClick={() => toggle(k)}
            className={`text-[10px] px-2.5 py-1 rounded-full border transition-all ${
              selected.includes(k)
                ? 'border-blue-500/60 bg-blue-500/15 text-blue-300'
                : 'border-white/10 bg-white/5 text-slate-500 hover:border-white/25 hover:text-slate-400'
            }`}>
            {v.name}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 40, left: 0 }}>
          <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} angle={-30} textAnchor="end" interval={0}/>
          <YAxis tick={{ fill: '#64748b', fontSize: 10 }}/>
          <Tooltip
            contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
            labelStyle={{ color: '#94a3b8' }}
          />
          <Bar dataKey="projected" name="Projected" fill={C_PROJECTED} radius={[3,3,0,0]} barSize={14}/>
          <Bar dataKey="actual"    name="Actual"    radius={[3,3,0,0]} barSize={14}>
            {chartData.map((entry, i) => (
              <Cell key={i} fill={entry.status === 'green' ? C_AHEAD : entry.status === 'yellow' ? C_YELLOW : C_BEHIND}/>
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── WaterfallMini ──────────────────────────────────────────────────────────
function WaterfallMini({ months }) {
  const entries = Object.entries(months).sort(([a],[b]) => a.localeCompare(b))
  if (!entries.length) return null

  const data = entries.map(([period, v]) => ({
    period:    period.slice(5), // "MM"
    projected: v.projected,
    actual:    v.actual,
    gapPct:    v.gap_pct,
  }))

  return (
    <ResponsiveContainer width="100%" height={80}>
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 0 }}>
        <XAxis dataKey="period" tick={{ fill: '#475569', fontSize: 9 }} axisLine={false} tickLine={false}/>
        <Tooltip
          contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, fontSize: 10 }}
          formatter={(val, name) => [
            typeof val === 'number' ? val.toFixed(1) : val,
            name
          ]}
        />
        <Bar dataKey="projected" name="Projected" fill={`${C_PROJECTED}40`} barSize={8} radius={[2,2,0,0]}/>
        <Bar dataKey="actual"    name="Actual"    barSize={8} radius={[2,2,0,0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={gapColor(entry.gapPct) + 'cc'}/>
          ))}
        </Bar>
        <Line type="monotone" dataKey="projected" stroke={C_PROJECTED} strokeWidth={1.5}
              dot={false} strokeDasharray="3 3" name="Proj line"/>
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ─── WaterfallDetailModal ────────────────────────────────────────────────────
function WaterfallDetailModal({ kpiKey, kpiData, onClose }) {
  if (!kpiData) return null

  const entries = Object.entries(kpiData.months).sort(([a],[b]) => a.localeCompare(b))
  const data = entries.map(([period, v]) => ({
    period:    period.slice(5),
    projected: v.projected,
    actual:    v.actual,
    gap:       v.gap,
    gapPct:    v.gap_pct,
  }))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-[#0a1628] border border-white/15 rounded-2xl shadow-2xl w-full max-w-2xl mx-4 p-6"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-white">{kpiData.name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">Projected vs Actual — Monthly Detail</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
            <X size={16}/>
          </button>
        </div>

        {/* 3 stat tiles */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Avg Projected', value: fmtVal(kpiData.avg_projected, kpiData.unit), color: 'blue' },
            { label: 'Avg Actual',    value: fmtVal(kpiData.avg_actual, kpiData.unit),    color: kpiData.overall_status === 'green' ? 'emerald' : kpiData.overall_status === 'yellow' ? 'amber' : 'red' },
            { label: 'Avg Gap',       value: `${kpiData.avg_gap_pct > 0 ? '+' : ''}${kpiData.avg_gap_pct?.toFixed(1)}%`, color: kpiData.avg_gap_pct >= 0 ? 'emerald' : 'red' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`rounded-xl p-3 bg-${color}-500/10 border border-${color}-500/20`}>
              <div className={`text-lg font-bold text-${color}-400`}>{value}</div>
              <div className={`text-[10px] text-${color}-400/60 uppercase tracking-wide mt-0.5`}>{label}</div>
            </div>
          ))}
        </div>

        {/* Full chart */}
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={data} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <XAxis dataKey="period" tick={{ fill: '#64748b', fontSize: 11 }}/>
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }}/>
            <Tooltip
              contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/>
            <Bar dataKey="projected" name="Projected" fill={`${C_PROJECTED}40`} barSize={14} radius={[2,2,0,0]}/>
            <Bar dataKey="actual" name="Actual" barSize={14} radius={[2,2,0,0]}>
              {data.map((entry, i) => (
                <Cell key={i} fill={gapColor(entry.gapPct) + 'cc'}/>
              ))}
            </Bar>
            <Line type="monotone" dataKey="projected" stroke={C_PROJECTED} strokeWidth={2}
                  dot={false} strokeDasharray="4 2" name="Projected (line)"/>
            <Line type="monotone" dataKey="actual" stroke={C_AHEAD} strokeWidth={2}
                  dot={{ fill: C_AHEAD, r: 3 }} name="Actual (line)"/>
          </ComposedChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-[10px] text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded" style={{background: C_PROJECTED, opacity: 0.6}}/> Projected bar</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded" style={{background: C_AHEAD}}/> Actual (on track)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded" style={{background: C_BEHIND}}/> Actual (behind)</span>
        </div>
      </div>
    </div>
  )
}

// ─── KpiBridgeCard ───────────────────────────────────────────────────────────
function KpiBridgeCard({ kpiKey, kpiData, onAskAnika, onExpand }) {
  const [open, setOpen] = useState(false)

  const sc      = statusColor(kpiData.overall_status)
  const dirIcon = kpiData.avg_gap_pct >= 3
    ? <TrendingUp size={12} style={{color: C_AHEAD}}/>
    : kpiData.avg_gap_pct <= -3
      ? <TrendingDown size={12} style={{color: C_BEHIND}}/>
      : <Minus size={12} className="text-slate-400"/>

  const badgeClass = kpiData.overall_status === 'green'
    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : kpiData.overall_status === 'yellow'
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : 'bg-red-500/15 text-red-400 border-red-500/30'

  const gapSign = kpiData.avg_gap_pct > 0 ? '+' : ''

  return (
    <div className="card p-4 flex flex-col gap-3" style={{ borderLeftColor: sc, borderLeftWidth: 3 }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="text-xs font-semibold text-white leading-tight truncate">{kpiData.name}</h4>
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-medium uppercase tracking-wide ${badgeClass}`}>
              {kpiData.overall_status}
            </span>
            <span className="flex items-center gap-0.5 text-[10px]" style={{color: sc}}>
              {dirIcon}
              <span className="font-semibold">{gapSign}{kpiData.avg_gap_pct?.toFixed(1)}%</span>
            </span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] text-slate-500">Actual</div>
          <div className="text-xs font-semibold text-white">{fmtVal(kpiData.avg_actual, kpiData.unit)}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">vs {fmtVal(kpiData.avg_projected, kpiData.unit)}</div>
        </div>
      </div>

      {/* Mini waterfall */}
      <WaterfallMini months={kpiData.months}/>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setOpen(v => !v)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg
                     text-[10px] text-slate-400 hover:text-white border border-white/8
                     hover:border-white/20 transition-all bg-white/3 hover:bg-white/6">
          {open ? <ChevronUp size={10}/> : <ChevronDown size={10}/>}
          Root Cause Analysis
        </button>
        <button
          onClick={onExpand}
          className="p-1.5 rounded-lg border border-white/8 hover:border-blue-400/40
                     text-slate-500 hover:text-blue-400 transition-all hover:bg-blue-400/5">
          <ExternalLink size={11}/>
        </button>
      </div>

      {/* Ask Anika button */}
      {kpiData.overall_status !== 'green' && (
        <button
          onClick={() => onAskAnika(kpiData.name)}
          className="w-full py-1.5 rounded-lg text-[10px] font-medium text-blue-400
                     border border-blue-400/25 bg-blue-400/8 hover:bg-blue-400/15 transition-all">
          Ask Anika → Why is this below projection?
        </button>
      )}

      {/* Collapsible root cause section */}
      {open && kpiData.causation && (
        <div className="border-t border-white/8 pt-3 space-y-3">
          {kpiData.causation.root_causes?.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider font-medium text-slate-500 mb-1.5">Root Causes</p>
              <ul className="space-y-1">
                {kpiData.causation.root_causes.map((rc, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[10px] text-slate-300">
                    <span className="text-red-400 mt-0.5 flex-shrink-0">•</span>
                    {rc}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {kpiData.causation.downstream_impact?.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider font-medium text-slate-500 mb-1.5">Downstream Impact</p>
              <div className="flex flex-wrap gap-1">
                {kpiData.causation.downstream_impact.map(d => (
                  <span key={d} className="text-[9px] bg-amber-500/15 text-amber-400 border border-amber-500/25 px-1.5 py-0.5 rounded-full">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {kpiData.causation.corrective_actions?.length > 0 && (
            <div>
              <p className="text-[9px] uppercase tracking-wider font-medium text-slate-500 mb-1.5">Corrective Actions</p>
              <ul className="space-y-1">
                {kpiData.causation.corrective_actions.map((ca, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[10px] text-slate-300">
                    <span className="text-emerald-400 mt-0.5 flex-shrink-0">✓</span>
                    {ca}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main ProjectionBridge ───────────────────────────────────────────────────
export default function ProjectionBridge({ bridgeData, projectionMonthly, onUploaded, onAskAnika }) {
  const [expandedModal, setExpandedModal] = useState(null)

  const hasProjection = bridgeData?.has_projection
  const hasOverlap    = bridgeData?.has_overlap

  // Sort KPI cards: red → yellow → green
  const sortedKpis = hasOverlap
    ? Object.entries(bridgeData.kpis).sort(([, a], [, b]) => {
        const order = { red: 0, yellow: 1, green: 2 }
        return (order[a.overall_status] ?? 3) - (order[b.overall_status] ?? 3)
      })
    : []

  return (
    <div className="space-y-0">

      {/* Upload zone — always visible */}
      <UploadZone onUploaded={onUploaded}/>

      {/* No projection state */}
      {!hasProjection && (
        <div className="card p-10 text-center">
          <GitBranch size={36} className="text-slate-600 mx-auto mb-4"/>
          <h3 className="text-slate-300 font-semibold text-base mb-2">No Projection Loaded</h3>
          <p className="text-slate-500 text-sm max-w-md mx-auto">
            Upload a 12-month projection CSV above (same format as actuals) to unlock
            the bridge analysis — gap waterfall charts, root cause diagnostics, downstream
            impact chains, and corrective action playbooks for every KPI.
          </p>
        </div>
      )}

      {/* Has projection but no overlap */}
      {hasProjection && !hasOverlap && (
        <div className="card p-8 text-center">
          <AlertTriangle size={28} className="text-amber-400 mx-auto mb-3"/>
          <h3 className="text-slate-300 font-semibold text-sm mb-2">No Overlapping Periods</h3>
          <p className="text-slate-500 text-xs max-w-sm mx-auto">
            The projection and actuals don't share any year-month combinations.
            Upload actuals data that overlaps with the projection period.
          </p>
        </div>
      )}

      {/* Full bridge UI */}
      {hasProjection && hasOverlap && (
        <>
          <SummaryBanner summary={bridgeData.summary}/>
          <OverviewChart kpis={bridgeData.kpis}/>

          <div className="mb-4">
            <h3 className="text-sm font-semibold text-white mb-1">KPI Bridge Cards</h3>
            <p className="text-[11px] text-slate-500">
              Sorted by severity · Red (critical gap) → Yellow (watch) → Green (on track)
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {sortedKpis.map(([key, kpiData]) => (
              <KpiBridgeCard
                key={key}
                kpiKey={key}
                kpiData={kpiData}
                onAskAnika={onAskAnika}
                onExpand={() => setExpandedModal(key)}
              />
            ))}
          </div>
        </>
      )}

      {/* Detail Modal */}
      {expandedModal && (
        <WaterfallDetailModal
          kpiKey={expandedModal}
          kpiData={bridgeData?.kpis?.[expandedModal]}
          onClose={() => setExpandedModal(null)}
        />
      )}
    </div>
  )
}
