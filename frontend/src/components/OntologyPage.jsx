import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import axios from 'axios'
import { Network, RefreshCw, Sparkles, X, ChevronRight, Zap, BarChart2 } from 'lucide-react'

// ── Domain colours ────────────────────────────────────────────────────────
const DOMAIN_COLOR = {
  growth:        '#00AEEF',
  retention:     '#10b981',
  profitability: '#f59e0b',
  efficiency:    '#8b5cf6',
  cashflow:      '#ef4444',
  revenue:       '#06b6d4',
  risk:          '#f97316',
  other:         '#94a3b8',
}

const RELATION_COLOR = {
  CAUSES:          '#f59e0b',
  INFLUENCES:      '#8b5cf6',
  CORRELATES_WITH: '#00AEEF',
  ANTI_CORRELATES: '#ef4444',
}

// Title-case a relation key: CORRELATES_WITH → Correlates With
const fmtRelation = r => r.split('_').map(w => w[0] + w.slice(1).toLowerCase()).join(' ')
// Title-case a domain: growth → Growth
const fmtDomain   = d => d ? d[0].toUpperCase() + d.slice(1) : d

// ── Zoom + pan hook (shared by ForceGraph & ClusterGraph) ─────────────────
function useZoomPan(svgRef, W, H) {
  const [vp, setVp] = useState({ scale: 1, tx: 0, ty: 0 })
  const vpRef    = useRef(vp)
  const dragging = useRef(false)
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 })

  useEffect(() => { vpRef.current = vp }, [vp])

  // Wheel zoom — must be non-passive to preventDefault
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      const factor = e.deltaY > 0 ? 0.88 : 1.14
      const { scale, tx, ty } = vpRef.current
      const rect = el.getBoundingClientRect()
      const mx = (e.clientX - rect.left) / rect.width  * W
      const my = (e.clientY - rect.top)  / rect.height * H
      const newScale = Math.max(0.15, Math.min(10, scale * factor))
      setVp({
        scale: newScale,
        tx: mx - (mx - tx) * (newScale / scale),
        ty: my - (my - ty) * (newScale / scale),
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [svgRef, W, H])

  const handlers = {
    onMouseDown(e) {
      if (e.target.closest('[data-node]')) return   // don't pan when clicking a node
      dragging.current = true
      dragStart.current = { x: e.clientX, y: e.clientY, tx: vpRef.current.tx, ty: vpRef.current.ty }
      e.currentTarget.style.cursor = 'grabbing'
      e.preventDefault()
    },
    onMouseMove(e) {
      if (!dragging.current) return
      const rect = svgRef.current.getBoundingClientRect()
      setVp(v => ({
        ...v,
        tx: dragStart.current.tx + (e.clientX - dragStart.current.x) * W / rect.width,
        ty: dragStart.current.ty + (e.clientY - dragStart.current.y) * H / rect.height,
      }))
    },
    onMouseUp(e)    { dragging.current = false; e.currentTarget.style.cursor = 'grab' },
    onMouseLeave(e) { dragging.current = false; e.currentTarget.style.cursor = 'grab' },
  }

  function zoomBy(factor) {
    setVp(({ scale, tx, ty }) => {
      const newScale = Math.max(0.15, Math.min(10, scale * factor))
      const cx = W / 2, cy = H / 2
      return { scale: newScale, tx: cx - (cx - tx) * (newScale / scale), ty: cy - (cy - ty) * (newScale / scale) }
    })
  }

  return { vp, handlers, zoomBy, reset: () => setVp({ scale: 1, tx: 0, ty: 0 }) }
}

// ── Zoom controls overlay ─────────────────────────────────────────────────
function ZoomControls({ scale, zoomBy, reset }) {
  const btn = (label, onClick) => (
    <button key={label} onClick={onClick}
      title={label === '+' ? 'Zoom in' : label === '−' ? 'Zoom out' : 'Reset view'}
      style={{ width: 28, height: 28, background: '#1e293b', border: '1px solid #475569',
        borderRadius: 6, color: '#e2e8f0', fontSize: label === 'Reset' ? 9 : 18,
        cursor: 'pointer', display: 'flex', alignItems: 'center',
        justifyContent: 'center', fontWeight: 700, lineHeight: 1 }}>
      {label}
    </button>
  )
  return (
    <div style={{ position: 'absolute', bottom: 14, right: 14,
      display: 'flex', flexDirection: 'column', gap: 4, zIndex: 10 }}>
      {btn('+', () => zoomBy(1.3))}
      {btn('−', () => zoomBy(1 / 1.3))}
      {btn('Reset', reset)}
      <div style={{ textAlign: 'center', color: '#e2e8f0', fontSize: 9, fontWeight: 600, marginTop: 2 }}>
        {Math.round(scale * 100)}%
      </div>
    </div>
  )
}

// ── Force-directed layout ─────────────────────────────────────────────────
function useForceLayout(nodes, edges, width, height) {
  const posRef   = useRef({})
  const velRef   = useRef({})
  const frameRef = useRef(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!nodes.length) return

    // Always reset when canvas size changes so nodes re-spread on the new canvas
    posRef.current = {}
    velRef.current = {}

    const domains = [...new Set(nodes.map(n => n.domain))]
    nodes.forEach((n, i) => {
      const di = domains.indexOf(n.domain)
      const angle = (di / domains.length) * Math.PI * 2 + (i * 0.3)
      const r = Math.min(width, height) * 0.38          // wider initial spread
      posRef.current[n.key] = {
        x: width  / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 100,
        y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 100,
      }
      velRef.current[n.key] = { x: 0, y: 0 }
    })

    const adj = {}
    edges.forEach(e => {
      adj[e.source] = adj[e.source] || new Set()
      adj[e.target] = adj[e.target] || new Set()
      adj[e.source].add(e.target)
      adj[e.target].add(e.source)
    })

    let t = 0
    const REPULSION = 14000   // was 4500 — much stronger push between nodes
    const SPRING    = 0.03
    const DAMPING   = 0.70    // was 0.75
    const REST      = 260     // was 100 — longer spring rest length

    function step() {
      const pos = posRef.current
      const vel = velRef.current
      const keys = nodes.map(n => n.key).filter(k => pos[k])

      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const a = keys[i], b = keys[j]
          const dx = pos[a].x - pos[b].x
          const dy = pos[a].y - pos[b].y
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
          const force = REPULSION / (dist * dist)
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          vel[a].x += fx; vel[a].y += fy
          vel[b].x -= fx; vel[b].y -= fy
        }
      }

      edges.forEach(e => {
        const pa = pos[e.source], pb = pos[e.target]
        if (!pa || !pb) return
        const dx = pb.x - pa.x
        const dy = pb.y - pa.y
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
        const force = SPRING * (dist - REST) * (e.strength || 0.5)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        vel[e.source].x += fx; vel[e.source].y += fy
        vel[e.target].x -= fx; vel[e.target].y -= fy
      })

      // Weaker centre gravity so nodes spread more freely
      keys.forEach(k => {
        vel[k].x += (width  / 2 - pos[k].x) * 0.0006
        vel[k].y += (height / 2 - pos[k].y) * 0.0006
      })

      keys.forEach(k => {
        vel[k].x *= DAMPING; vel[k].y *= DAMPING
        pos[k].x += vel[k].x; pos[k].y += vel[k].y
        pos[k].x = Math.max(40, Math.min(width - 40, pos[k].x))
        pos[k].y = Math.max(40, Math.min(height - 40, pos[k].y))
      })

      t++
      if (t % 6 === 0) setTick(t)
      if (t < 600) frameRef.current = requestAnimationFrame(step)
    }

    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [nodes.length, edges.length, width, height])

  return posRef.current
}

// ── Force graph SVG ───────────────────────────────────────────────────────
function ForceGraph({ nodes, edges, selected, onSelect }) {
  const W = 1800, H = 1400      // large virtual canvas so nodes have room to breathe
  const pos = useForceLayout(nodes, edges, W, H)

  const svgRef = useRef(null)
  const { vp, handlers, zoomBy, reset } = useZoomPan(svgRef, W, H)
  const { scale, tx, ty } = vp

  const neighborSet = useMemo(() => {
    if (!selected) return null
    const s = new Set([selected])
    edges.forEach(e => {
      if (e.source === selected) s.add(e.target)
      if (e.target === selected) s.add(e.source)
    })
    return s
  }, [selected, edges])

  if (!nodes.length) return null

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width="100%" height="750" viewBox={`0 0 ${W} ${H}`}
        style={{ background: '#0f172a', borderRadius: 8, display: 'block', cursor: 'grab' }}
        {...handlers}>
        {/* Arrow marker defs stay outside the transform group */}
        <defs>
          {Object.entries(RELATION_COLOR).map(([rel, col]) => (
            <marker key={rel} id={`arr-${rel}`} markerWidth="6" markerHeight="6"
              refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={col} opacity="0.7"/>
            </marker>
          ))}
        </defs>

        {/* All content inside the zoomable/pannable group */}
        <g transform={`translate(${tx},${ty}) scale(${scale})`}>
          {edges.map((e, i) => {
            const pa = pos[e.source], pb = pos[e.target]
            if (!pa || !pb) return null
            const dimmed = neighborSet && !neighborSet.has(e.source) && !neighborSet.has(e.target)
            const col = RELATION_COLOR[e.relation] || '#64748b'
            return (
              <line key={i}
                x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke={col}
                strokeWidth={Math.max(0.5, (e.strength || 0.4) * 2)}
                opacity={dimmed ? 0.05 : 0.40}
                markerEnd={`url(#arr-${e.relation})`}
              />
            )
          })}

          {nodes.map(n => {
            const p = pos[n.key]
            if (!p) return null
            const dimmed = neighborSet && !neighborSet.has(n.key)
            const r = 6 + (n.centrality || 0) * 18
            const col = DOMAIN_COLOR[n.domain] || '#94a3b8'
            const isSelected = selected === n.key
            return (
              <g key={n.key} data-node="true"
                onClick={() => onSelect(isSelected ? null : n.key)}
                style={{ cursor: 'pointer' }} opacity={dimmed ? 0.12 : 1}>
                {isSelected && (
                  <circle cx={p.x} cy={p.y} r={r + 8} fill="none" stroke={col} strokeWidth={2} opacity={0.5}/>
                )}
                <circle cx={p.x} cy={p.y} r={r} fill={col} opacity={0.85}/>
                <text x={p.x} y={p.y + r + 12} textAnchor="middle"
                  fontSize="11" fill="#f1f5f9" style={{ pointerEvents: 'none' }}>
                  {n.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <ZoomControls scale={scale} zoomBy={zoomBy} reset={reset}/>
      <div style={{ position: 'absolute', bottom: 14, left: 14, background: '#0f172acc',
        borderRadius: 5, padding: '3px 8px', color: '#e2e8f0', fontSize: 10, pointerEvents: 'none' }}>
        Scroll to zoom · Drag to pan
      </div>
    </div>
  )
}

// ── Cluster View ─────────────────────────────────────────────────────────
function ClusterGraph({ nodes, edges, selected, onSelect }) {
  const W = 1600, H = 1200

  const svgRef = useRef(null)
  const { vp, handlers, zoomBy, reset } = useZoomPan(svgRef, W, H)
  const { scale, tx, ty } = vp

  // Group nodes by domain
  const byDomain = useMemo(() => {
    const map = {}
    nodes.forEach(n => {
      const d = n.domain || 'other'
      if (!map[d]) map[d] = []
      map[d].push(n)
    })
    return map
  }, [nodes])

  // Lay out domain cluster centres — wider grid on larger canvas
  const clusterPos = useMemo(() => {
    const domains = Object.keys(byDomain)
    const COLS = 3
    const xStep = W / COLS
    const yStart = 160
    const yStep = 320
    const pos = {}
    domains.forEach((d, i) => {
      pos[d] = {
        x: (i % COLS + 0.5) * xStep,
        y: yStart + Math.floor(i / COLS) * yStep,
      }
    })
    return pos
  }, [byDomain])

  // Compute per-node positions — circle around cluster centre with more radius
  const nodePos = useMemo(() => {
    const pos = {}
    Object.entries(byDomain).forEach(([d, dnodes]) => {
      const centre = clusterPos[d]
      if (!centre) return
      const R = Math.min(110, 44 + dnodes.length * 10)
      dnodes.forEach((n, i) => {
        const angle = (i / Math.max(dnodes.length, 1)) * Math.PI * 2 - Math.PI / 2
        pos[n.key] = {
          x: centre.x + R * Math.cos(angle),
          y: centre.y + R * Math.sin(angle),
        }
      })
    })
    return pos
  }, [byDomain, clusterPos])

  const neighborSet = useMemo(() => {
    if (!selected) return null
    const s = new Set([selected])
    edges.forEach(e => {
      if (e.source === selected) s.add(e.target)
      if (e.target === selected) s.add(e.source)
    })
    return s
  }, [selected, edges])

  return (
    <div style={{ position: 'relative' }}>
      <svg ref={svgRef} width="100%" height="750" viewBox={`0 0 ${W} ${H}`}
        style={{ background: '#0f172a', borderRadius: 8, display: 'block', cursor: 'grab' }}
        {...handlers}>
        <defs>
          {Object.entries(RELATION_COLOR).map(([rel, col]) => (
            <marker key={rel} id={`cl-arr-${rel}`} markerWidth="6" markerHeight="6"
              refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={col} opacity="0.7"/>
            </marker>
          ))}
        </defs>

        <g transform={`translate(${tx},${ty}) scale(${scale})`}>
          {/* Domain bubble backgrounds */}
          {Object.entries(clusterPos).map(([d, pos]) => {
            const dnodes = byDomain[d] || []
            const R = Math.min(130, 60 + dnodes.length * 11)
            const col = DOMAIN_COLOR[d] || '#94a3b8'
            return (
              <g key={d}>
                <circle cx={pos.x} cy={pos.y} r={R + 28}
                  fill={col} fillOpacity={0.05}
                  stroke={col} strokeOpacity={0.20} strokeWidth={1.5} strokeDasharray="6 5"/>
                <text x={pos.x} y={pos.y - R - 14}
                  textAnchor="middle" fontSize="14" fontWeight="700"
                  fill={col} opacity={0.9}
                  style={{ letterSpacing: '0.07em', textTransform: 'uppercase', pointerEvents: 'none' }}>
                  {fmtDomain(d)}
                </text>
              </g>
            )
          })}

          {/* Edges */}
          {edges.map((e, i) => {
            const pa = nodePos[e.source], pb = nodePos[e.target]
            if (!pa || !pb) return null
            const dimmed = neighborSet && !neighborSet.has(e.source) && !neighborSet.has(e.target)
            const col = RELATION_COLOR[e.relation] || '#64748b'
            return (
              <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke={col} strokeWidth={1}
                opacity={dimmed ? 0.04 : 0.28}
                markerEnd={`url(#cl-arr-${e.relation})`}/>
            )
          })}

          {/* Nodes */}
          {nodes.map(n => {
            const p = nodePos[n.key]
            if (!p) return null
            const dimmed = neighborSet && !neighborSet.has(n.key)
            const r = 5 + (n.centrality || 0) * 16
            const col = DOMAIN_COLOR[n.domain] || '#94a3b8'
            const isSel = selected === n.key
            return (
              <g key={n.key} data-node="true"
                onClick={() => onSelect(isSel ? null : n.key)}
                style={{ cursor: 'pointer' }} opacity={dimmed ? 0.12 : 1}>
                {isSel && (
                  <circle cx={p.x} cy={p.y} r={r + 7} fill="none" stroke={col} strokeWidth={2} opacity={0.5}/>
                )}
                <circle cx={p.x} cy={p.y} r={r} fill={col} opacity={0.88}/>
                <text x={p.x} y={p.y + r + 12} textAnchor="middle"
                  fontSize="11" fill="#f1f5f9" style={{ pointerEvents: 'none' }}>
                  {n.name}
                </text>
              </g>
            )
          })}
        </g>
      </svg>
      <ZoomControls scale={scale} zoomBy={zoomBy} reset={reset}/>
      <div style={{ position: 'absolute', bottom: 14, left: 14, background: '#0f172acc',
        borderRadius: 5, padding: '3px 8px', color: '#e2e8f0', fontSize: 10, pointerEvents: 'none' }}>
        Scroll to zoom · Drag to pan
      </div>
    </div>
  )
}

// ── Node inspector ────────────────────────────────────────────────────────
function NodeInspector({ nodeKey, nodes, edges, onClose }) {
  const node = nodes.find(n => n.key === nodeKey)
  if (!node) return null
  const outgoing = edges.filter(e => e.source === nodeKey)
  const incoming = edges.filter(e => e.target === nodeKey)
  const col      = DOMAIN_COLOR[node.domain] || '#94a3b8'
  const centrality = node.centrality || 0
  const totalConn  = outgoing.length + incoming.length

  // Plain-English influence level
  const influence = centrality >= 0.60
    ? { label: 'High-leverage',    desc: 'Changes here cascade widely across multiple KPIs', color: '#ef4444' }
    : centrality >= 0.35
    ? { label: 'Moderate influence', desc: 'Key driver within its domain cluster',              color: '#f59e0b' }
    : { label: 'Focused metric',   desc: 'Targeted, more contained impact',                   color: '#10b981' }

  return (
    <div style={{ background: '#1e293b', borderRadius: 8, border: '1px solid #334155',
      padding: 16, width: 260, flexShrink: 0 }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, color: col, fontSize: 14, lineHeight: 1.2 }}>{node.name}</div>
          <div style={{ color: '#e2e8f0', fontSize: 11, marginTop: 2 }}>{fmtDomain(node.domain)} domain</div>
        </div>
        <button onClick={onClose} style={{ color: '#e2e8f0', background: 'none', border: 'none', cursor: 'pointer', padding: 2, marginLeft: 8, flexShrink: 0 }}>
          <X size={14}/>
        </button>
      </div>

      {/* Influence banner */}
      <div style={{ background: influence.color + '18', border: `1px solid ${influence.color}44`,
        borderRadius: 6, padding: '7px 10px', marginBottom: 12 }}>
        <div style={{ color: influence.color, fontSize: 11, fontWeight: 700 }}>{influence.label}</div>
        <div style={{ color: '#e2e8f0', fontSize: 10, marginTop: 2, lineHeight: 1.4 }}>{influence.desc}</div>
      </div>

      {/* Key stats — 3 meaningful metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, marginBottom: 14 }}>
        {[
          { label: 'Connections',   val: totalConn,                              tip: 'Total direct links' },
          { label: 'Drives',        val: outgoing.length,                        tip: 'KPIs this affects' },
          { label: 'Driven by',     val: incoming.length,                        tip: 'KPIs that affect this' },
        ].map(({ label, val, tip }) => (
          <div key={label} style={{ background: '#0f172a', borderRadius: 6, padding: '7px 8px', textAlign: 'center' }}
            title={tip}>
            <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 18, lineHeight: 1 }}>{val}</div>
            <div style={{ color: '#e2e8f0', fontSize: 9, marginTop: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Outgoing — "This KPI drives…" */}
      {outgoing.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 700, marginBottom: 5,
            textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            ▶ This KPI drives
          </div>
          {outgoing.slice(0, 6).map((e, i) => {
            const tn = nodes.find(n => n.key === e.target)
            const rc = RELATION_COLOR[e.relation] || '#94a3b8'
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 0', borderBottom: '1px solid #0f172a' }}>
                <span style={{ color: '#e2e8f0', fontSize: 11 }}>{tn?.name || e.target}</span>
                <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999,
                  background: rc + '28', color: rc, whiteSpace: 'nowrap', marginLeft: 6 }}>
                  {fmtRelation(e.relation)}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Incoming — "Influenced by…" */}
      {incoming.length > 0 && (
        <div>
          <div style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 700, marginBottom: 5,
            textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            ◀ Influenced by
          </div>
          {incoming.slice(0, 6).map((e, i) => {
            const sn = nodes.find(n => n.key === e.source)
            const rc = RELATION_COLOR[e.relation] || '#94a3b8'
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 0', borderBottom: '1px solid #0f172a' }}>
                <span style={{ color: '#e2e8f0', fontSize: 11 }}>{sn?.name || e.source}</span>
                <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 999,
                  background: rc + '28', color: rc, whiteSpace: 'nowrap', marginLeft: 6 }}>
                  {fmtRelation(e.relation)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Recommendation filter definitions ─────────────────────────────────────
const REC_FILTERS = [
  { id: 'all',              label: 'All types' },
  { id: 'predictive_chain', label: 'Predictive chains' },
  { id: 'untested_link',    label: 'Untested links' },
  { id: 'bridge_node',      label: 'Bridge nodes' },
  { id: 'cluster',          label: 'Metric clusters' },
]

const REC_TYPE_COLOR = {
  untested_link:    '#00AEEF',
  bridge_node:      '#8b5cf6',
  cluster:          '#10b981',
  predictive_chain: '#f59e0b',
}

// ── Recommendation card ────────────────────────────────────────────────────
function RecCard({ rec, nodes, onDismiss }) {
  const [expanded, setExpanded] = useState(false)
  const typeColor = REC_TYPE_COLOR[rec.rec_type] || '#94a3b8'

  const pathNames = (rec.path || []).map(k => {
    const n = nodes.find(nd => nd.key === k)
    return { key: k, name: n?.name || k.replace(/_/g, ' '), node: n }
  })

  const lastNode  = pathNames[pathNames.length - 1]?.node
  const actions   = lastNode?.corrective_actions || []
  const firstNode = pathNames[0]?.node
  const impacts   = (firstNode?.downstream_impact || [])
    .map(k => nodes.find(n => n.key === k)).filter(Boolean)

  return (
    <div style={{ background: '#1e293b', borderRadius: 10,
      border: '1px solid #3b5070', padding: '16px 18px', position: 'relative',
      display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Dismiss */}
      <button onClick={() => onDismiss(rec.id)}
        style={{ position: 'absolute', top: 12, right: 12, background: 'none',
          border: 'none', color: '#e2e8f0', cursor: 'pointer', padding: 2,
          display: 'flex', alignItems: 'center' }}>
        <X size={14}/>
      </button>

      {/* Icon + Title */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', paddingRight: 24 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8,
          background: typeColor + '22', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0 }}>
          <BarChart2 size={18} style={{ color: typeColor }}/>
        </div>
        <div style={{ color: '#f1f5f9', fontSize: 14, fontWeight: 600, lineHeight: 1.35 }}>
          {rec.title}
        </div>
      </div>

      {/* Path chain pills */}
      {pathNames.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
          {pathNames.map((item, i) => (
            <span key={item.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11, padding: '3px 9px', borderRadius: 4,
                background: '#0f172a', color: '#e2e8f0', border: '1px solid #475569',
                whiteSpace: 'nowrap' }}>
                {item.name.toLowerCase()}
              </span>
              {i < pathNames.length - 1 && (
                <span style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1 }}>→</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Confidence / Novelty / Impact */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#e2e8f0' }}>
          Confidence{' '}
          <span style={{ color: '#00AEEF', fontWeight: 700 }}>
            {Math.round((rec.confidence || 0) * 100)}%
          </span>
        </span>
        <span style={{ fontSize: 12, color: '#e2e8f0' }}>
          Novelty{' '}
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>
            {Math.round((rec.novelty || 0) * 100)}%
          </span>
        </span>
        <span style={{ fontSize: 12, color: '#e2e8f0' }}>
          Impact{' '}
          <span style={{ color: '#10b981', fontWeight: 700 }}>
            {Math.round((rec.impact || 0) * 100)}%
          </span>
        </span>
      </div>

      {/* Expandable toggle */}
      <button onClick={() => setExpanded(e => !e)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', color: '#e2e8f0',
          cursor: 'pointer', fontSize: 12, padding: 0, alignSelf: 'flex-start' }}>
        <ChevronRight size={13} style={{
          transform: expanded ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s' }}/>
        {expanded ? 'Hide hypothesis & steps' : 'Show hypothesis & steps'}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14,
          paddingTop: 12, borderTop: '1px solid #0f172a' }}>

          {rec.hypothesis && (
            <div>
              <div style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                Hypothesis
              </div>
              <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px',
                borderLeft: `3px solid ${typeColor}` }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Sparkles size={13} style={{ color: typeColor, flexShrink: 0, marginTop: 1 }}/>
                  <span style={{ color: '#e2e8f0', fontSize: 12, lineHeight: 1.5 }}>
                    {rec.hypothesis}
                  </span>
                </div>
              </div>
            </div>
          )}

          {actions.length > 0 && (
            <div>
              <div style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                Steps
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {actions.slice(0, 3).map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 18, height: 18, borderRadius: '50%',
                      background: '#0055A4', color: '#fff', fontSize: 10, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0 }}>{i + 1}</div>
                    <span style={{ color: '#e2e8f0', fontSize: 12, lineHeight: 1.4 }}>{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {impacts.length > 0 && (
            <div>
              <div style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                Downstream Impact
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {impacts.map(n => (
                  <span key={n.key} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 999,
                    background: (DOMAIN_COLOR[n.domain] || '#94a3b8') + '22',
                    color: DOMAIN_COLOR[n.domain] || '#94a3b8',
                    border: `1px solid ${(DOMAIN_COLOR[n.domain] || '#94a3b8')}44` }}>
                    {n.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function OntologyPage() {
  const [graph, setGraph]       = useState({ nodes: [], edges: [] })
  const [stats, setStats]       = useState(null)
  const [recs, setRecs]         = useState([])
  const [tab, setTab]           = useState('graph')
  const [domain, setDomain]     = useState('all')
  const [selected, setSelected] = useState(null)
  const [discovering, setDisc]  = useState(false)
  const [loading, setLoading]   = useState(true)
  const [recFilter, setRecFilter] = useState('all')
  const [clusterView, setClusterView] = useState(false)

  const loadData = useCallback(async (dom = domain) => {
    setLoading(true)
    try {
      const [gRes, sRes, rRes] = await Promise.all([
        axios.get(`/api/ontology/graph${dom !== 'all' ? `?domain=${dom}` : ''}`),
        axios.get('/api/ontology/stats'),
        axios.get('/api/ontology/recommendations'),
      ])
      setGraph(gRes.data)
      setStats(sRes.data)
      setRecs(rRes.data)
    } catch (e) { console.error(e) }
    setLoading(false)
  }, [domain])

  useEffect(() => { loadData(domain) }, [domain])

  async function discover() {
    setDisc(true)
    await axios.post('/api/ontology/discover')
    setTimeout(() => { loadData(domain); setDisc(false) }, 8000)
  }

  async function dismiss(id) {
    await axios.post(`/api/ontology/recommendations/${id}/dismiss`)
    setRecs(r => r.filter(rec => rec.id !== id))
  }

  const filteredRecs = recFilter === 'all'
    ? recs
    : recs.filter(r => r.rec_type === recFilter)

  const noData = !loading && graph.nodes.length === 0
  const DOMAINS = ['all', ...Object.keys(DOMAIN_COLOR).filter(d => d !== 'other')]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>

      {/* Stat cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Knowledge Nodes', value: stats.total_nodes,             sub: 'KPI metrics' },
            { label: 'Relationships',   value: stats.total_edges,             sub: 'typed edges' },
            { label: 'Recommendations', value: stats.active_recommendations,  sub: 'signal ideas' },
            { label: 'Domains',         value: Object.keys(stats.domain_distribution || {}).length,
              sub: Object.entries(stats.domain_distribution || {}).map(([d,c]) => `${fmtDomain(d)}:${c}`).join(' · ') },
          ].map(({ label, value, sub }) => (
            <div key={label} className="card" style={{ padding: 16 }}>
              <div style={{ color: '#e2e8f0', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{label}</div>
              <div style={{ color: '#0055A4', fontSize: 28, fontWeight: 700 }}>{value}</div>
              <div style={{ color: '#e2e8f0', fontSize: 11 }}>{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Top 3 Leverage Points */}
      {graph.nodes.length > 0 && (() => {
        const top3 = [...graph.nodes]
          .filter(n => n.degree_centrality != null)
          .sort((a, b) => (b.degree_centrality ?? 0) - (a.degree_centrality ?? 0))
          .slice(0, 3)
        if (!top3.length) return null
        const ACTIONS = {
          revenue_growth: 'Accelerate pipeline conversion and reduce churn to compound revenue momentum',
          arr_growth: 'Focus expansion ARR via upsell programmes in top-tier accounts',
          gross_margin: 'Renegotiate COGS with key vendors; optimise product tier mix',
          burn_multiple: 'Review headcount efficiency; defer non-critical spend',
          nrr: 'Deploy retention and expansion playbooks for at-risk cohorts',
          churn_rate: 'Prioritise at-risk accounts; improve onboarding and QBR cadence',
          operating_margin: 'Identify opex above budget across G&A and R&D',
          sales_efficiency: 'Increase AE productivity; focus on highest-yield segments',
          cac_payback: 'Optimise marketing channel mix for lower-CAC acquisition',
          dso: 'Tighten collection cycles; review payment terms with top accounts',
        }
        return (
          <div className="card p-4 border-l-4 border-l-[#0055A4]">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-[#0055A4]"/>
              <span className="text-sm font-bold text-slate-800">Top 3 Leverage Points</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100 font-medium">
                Highest-impact nodes this period
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {top3.map((node, i) => (
                <div key={node.key} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">#{i+1} Leverage</span>
                    <span className="text-[10px] font-mono text-[#0055A4]">
                      {((node.degree_centrality ?? 0) * 100).toFixed(0)}% centrality
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-800 mb-1">{node.name}</p>
                  <p className="text-[10px] text-slate-500 leading-snug">
                    {ACTIONS[node.key] ?? 'Review this KPI and identify downstream improvement levers'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Tabs + Run Discovery */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['graph', 'Knowledge Graph'], ['recs', `Signal Recommendations${recs.length ? ` (${recs.length})` : ''}`]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding: '6px 16px', borderRadius: 6, fontSize: 13, display: 'inline-flex',
                border: 'none', cursor: 'pointer', fontWeight: 600,
                background: tab === id ? '#0055A4' : '#2d3f55',
                color: tab === id ? '#fff' : '#e2e8f0',
                boxShadow: tab === id ? '0 0 0 1px #0066cc' : 'none' }}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={discover} disabled={discovering}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
            borderRadius: 8, background: '#0055A4', color: '#fff', border: 'none',
            cursor: discovering ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600,
            opacity: discovering ? 0.7 : 1 }}>
          <RefreshCw size={14} style={{ animation: discovering ? 'spin 1s linear infinite' : 'none' }}/>
          {discovering ? 'Running…' : 'Run Discovery'}
        </button>
      </div>

      {/* Knowledge Graph tab */}
      {tab === 'graph' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {DOMAINS.map(d => (
                <button key={d} onClick={() => setDomain(d)}
                  style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, border: 'none',
                    cursor: 'pointer', fontWeight: 500,
                    background: domain === d ? (DOMAIN_COLOR[d] || '#0055A4') : '#334155',
                    color: domain === d ? '#fff' : '#e2e8f0' }}>
                  {d === 'all' ? 'All Domains' : fmtDomain(d)}
                </button>
              ))}
            </div>
            {/* Cluster View toggle */}
            <div style={{ display: 'flex', alignItems: 'center', background: '#1e293b',
              borderRadius: 8, padding: 3, gap: 2, border: '1px solid #334155', flexShrink: 0 }}>
              <button onClick={() => setClusterView(false)}
                style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, border: 'none',
                  cursor: 'pointer', fontWeight: 600,
                  background: !clusterView ? '#0055A4' : 'transparent',
                  color: !clusterView ? '#fff' : '#94a3b8' }}>
                Force Layout
              </button>
              <button onClick={() => setClusterView(true)}
                style={{ padding: '4px 12px', borderRadius: 6, fontSize: 11, border: 'none',
                  cursor: 'pointer', fontWeight: 600,
                  background: clusterView ? '#0055A4' : 'transparent',
                  color: clusterView ? '#fff' : '#94a3b8' }}>
                Cluster View
              </button>
            </div>
          </div>

          {noData ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: '#f8fafc', borderRadius: 8, padding: 40 }}>
              <Network size={48} color="#94a3b8"/>
              <p style={{ color: '#e2e8f0', fontSize: 15 }}>No ontology data yet</p>
              <button onClick={discover} style={{ padding: '8px 20px', background: '#0055A4',
                color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                Run Discovery
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>

                {/* ── Map Key — compact bar, always above the canvas ── */}
                <div style={{ marginBottom: 8, background: '#0f172a', borderRadius: 8,
                  border: '1px solid #1e293b', padding: '8px 14px',
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                  columnGap: 20, rowGap: 6 }}>

                  {/* Relationship types */}
                  <span style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>
                    Links
                  </span>
                  {Object.entries(RELATION_COLOR).map(([rel, col]) => (
                    <div key={rel} style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <svg width="20" height="8" style={{ flexShrink: 0 }}>
                        <line x1="0" y1="4" x2="14" y2="4" stroke={col} strokeWidth="2"
                          strokeDasharray={rel === 'ANTI_CORRELATES' ? '3 2' : 'none'}/>
                        <polygon points="14,1 20,4 14,7" fill={col} opacity="0.9"/>
                      </svg>
                      <span style={{ color: '#e2e8f0', fontSize: 11 }}>{fmtRelation(rel)}</span>
                    </div>
                  ))}

                  {/* Divider */}
                  <span style={{ width: 1, height: 14, background: '#334155', flexShrink: 0 }}/>

                  {/* Domains */}
                  <span style={{ color: '#e2e8f0', fontSize: 10, fontWeight: 700,
                    textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>
                    Domains
                  </span>
                  {Object.entries(DOMAIN_COLOR).filter(([d]) => d !== 'other').map(([d, c]) => (
                    <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: c,
                        display: 'inline-block', flexShrink: 0 }}/>
                      <span style={{ color: '#e2e8f0', fontSize: 11 }}>{fmtDomain(d)}</span>
                    </div>
                  ))}

                  {/* Divider */}
                  <span style={{ width: 1, height: 14, background: '#334155', flexShrink: 0 }}/>

                  {/* Reading hints */}
                  <span style={{ color: '#e2e8f0', fontSize: 11, flexShrink: 0 }}>
                    ⬤ size = influence &nbsp;·&nbsp; click node to inspect &nbsp;·&nbsp; scroll to zoom
                  </span>
                </div>

                {clusterView ? (
                  <ClusterGraph
                    nodes={graph.nodes}
                    edges={graph.edges}
                    selected={selected}
                    onSelect={setSelected}
                  />
                ) : (
                  <ForceGraph
                    nodes={graph.nodes}
                    edges={graph.edges}
                    selected={selected}
                    onSelect={setSelected}
                  />
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 260, flexShrink: 0 }}>
                {selected ? (
                  <NodeInspector
                    nodeKey={selected}
                    nodes={graph.nodes}
                    edges={graph.edges}
                    onClose={() => setSelected(null)}
                  />
                ) : stats?.top_nodes_by_pagerank?.length > 0 && (
                  <div style={{ background: '#1e293b', borderRadius: 8, border: '1px solid #334155', padding: 14 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 700 }}>
                        Most Influential KPIs
                      </div>
                      <div style={{ color: '#e2e8f0', fontSize: 10, marginTop: 2 }}>
                        KPIs other metrics depend on most — click to inspect
                      </div>
                    </div>
                    {stats.top_nodes_by_pagerank.map((n, i) => (
                      <div key={n.key} onClick={() => setSelected(n.key)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 6px', borderRadius: 6, cursor: 'pointer',
                          borderBottom: '1px solid #0f172a',
                          transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#0f172a'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <span style={{ color: '#334155', fontSize: 11, width: 16, textAlign: 'center',
                          fontWeight: 700 }}>{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ color: '#f1f5f9', fontSize: 12, fontWeight: 600 }}>{n.name}</div>
                          <div style={{ color: DOMAIN_COLOR[n.domain] || '#94a3b8', fontSize: 10 }}>{fmtDomain(n.domain)}</div>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0 }}>
                          <div style={{ color: '#00AEEF', fontWeight: 700, fontSize: 13 }}>
                            {Math.round((n.pagerank || 0) * 100)}%
                          </div>
                          <div style={{ color: '#e2e8f0', fontSize: 9 }}>influence</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {stats?.edge_type_distribution && (
                  <div style={{ background: '#1e293b', borderRadius: 8, border: '1px solid #334155', padding: 14 }}>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 700 }}>Relationship Breakdown</div>
                      <div style={{ color: '#e2e8f0', fontSize: 10, marginTop: 2 }}>How KPIs are connected</div>
                    </div>
                    {Object.entries(stats.edge_type_distribution).map(([rel, cnt]) => {
                      const rc = RELATION_COLOR[rel] || '#94a3b8'
                      const total = Object.values(stats.edge_type_distribution).reduce((s, v) => s + v, 0)
                      const pct = total ? Math.round(cnt / total * 100) : 0
                      return (
                        <div key={rel} style={{ marginBottom: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                            <span style={{ fontSize: 12, color: rc, fontWeight: 600 }}>{fmtRelation(rel)}</span>
                            <span style={{ color: '#e2e8f0', fontSize: 11 }}>{cnt} links</span>
                          </div>
                          <div style={{ height: 3, background: '#0f172a', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: rc, borderRadius: 2, opacity: 0.7 }}/>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* Recommendations tab */}
      {tab === 'recs' && (
        <div>
          {/* Filter pills */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            {REC_FILTERS.map(f => {
              const active = recFilter === f.id
              const cnt = f.id === 'all'
                ? recs.length
                : recs.filter(r => r.rec_type === f.id).length
              return (
                <button key={f.id} onClick={() => setRecFilter(f.id)}
                  style={{ padding: '5px 14px', borderRadius: 999, fontSize: 12,
                    border: 'none', cursor: 'pointer', fontWeight: 500,
                    background: active ? '#0055A4' : '#334155',
                    color:      active ? '#fff'    : '#e2e8f0' }}>
                  {f.label}{cnt > 0 && f.id !== 'all' ? ` (${cnt})` : ''}
                </button>
              )
            })}
          </div>

          {filteredRecs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: 40, background: '#1e293b', borderRadius: 8, gap: 12 }}>
              <Sparkles size={40} color="#94a3b8"/>
              <p style={{ color: '#e2e8f0' }}>
                {recs.length === 0
                  ? 'No recommendations yet — run Discovery first.'
                  : 'No recommendations of this type.'}
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {filteredRecs.map(rec => (
                <RecCard key={rec.id} rec={rec}
                  nodes={graph.nodes}
                  onDismiss={dismiss}/>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
