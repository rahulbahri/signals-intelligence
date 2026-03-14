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

// ── Force-directed layout ─────────────────────────────────────────────────
function useForceLayout(nodes, edges, width, height) {
  const posRef   = useRef({})
  const velRef   = useRef({})
  const frameRef = useRef(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!nodes.length) return

    const domains = [...new Set(nodes.map(n => n.domain))]
    nodes.forEach((n, i) => {
      if (posRef.current[n.key]) return
      const di = domains.indexOf(n.domain)
      const angle = (di / domains.length) * Math.PI * 2 + (i * 0.3)
      const r = Math.min(width, height) * 0.30
      posRef.current[n.key] = {
        x: width  / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 40,
        y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 40,
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
    const REPULSION = 4500
    const SPRING    = 0.04
    const DAMPING   = 0.75
    const REST      = 100

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

      keys.forEach(k => {
        vel[k].x += (width  / 2 - pos[k].x) * 0.002
        vel[k].y += (height / 2 - pos[k].y) * 0.002
      })

      keys.forEach(k => {
        vel[k].x *= DAMPING; vel[k].y *= DAMPING
        pos[k].x += vel[k].x; pos[k].y += vel[k].y
        pos[k].x = Math.max(20, Math.min(width - 20, pos[k].x))
        pos[k].y = Math.max(20, Math.min(height - 20, pos[k].y))
      })

      t++
      if (t % 6 === 0) setTick(t)
      if (t < 400) frameRef.current = requestAnimationFrame(step)
    }

    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [nodes.length, edges.length, width, height])

  return posRef.current
}

// ── Force graph SVG ───────────────────────────────────────────────────────
function ForceGraph({ nodes, edges, selected, onSelect }) {
  const W = 900, H = 750
  const pos = useForceLayout(nodes, edges, W, H)

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
    <svg width="100%" height="750" viewBox={`0 0 ${W} ${H}`}
      style={{ background: '#0f172a', borderRadius: 8, display: 'block' }}>
      <defs>
        {Object.entries(RELATION_COLOR).map(([rel, col]) => (
          <marker key={rel} id={`arr-${rel}`} markerWidth="6" markerHeight="6"
            refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill={col} opacity="0.7"/>
          </marker>
        ))}
      </defs>

      {edges.map((e, i) => {
        const pa = pos[e.source], pb = pos[e.target]
        if (!pa || !pb) return null
        const dimmed = neighborSet && !neighborSet.has(e.source) && !neighborSet.has(e.target)
        const col = RELATION_COLOR[e.relation] || '#64748b'
        return (
          <line key={i}
            x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
            stroke={col}
            strokeWidth={Math.max(0.5, (e.strength || 0.4) * 2.5)}
            opacity={dimmed ? 0.06 : 0.45}
            markerEnd={`url(#arr-${e.relation})`}
          />
        )
      })}

      {nodes.map(n => {
        const p = pos[n.key]
        if (!p) return null
        const dimmed = neighborSet && !neighborSet.has(n.key)
        const r = 5 + (n.centrality || 0) * 16
        const col = DOMAIN_COLOR[n.domain] || '#94a3b8'
        const isSelected = selected === n.key
        return (
          <g key={n.key} onClick={() => onSelect(isSelected ? null : n.key)}
            style={{ cursor: 'pointer' }} opacity={dimmed ? 0.15 : 1}>
            {isSelected && (
              <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke={col} strokeWidth={2} opacity={0.5}/>
            )}
            <circle cx={p.x} cy={p.y} r={r} fill={col} opacity={0.85}/>
            {(r > 8 || isSelected) && (
              <text x={p.x} y={p.y + r + 10} textAnchor="middle"
                fontSize="8" fill="#cbd5e1" style={{ pointerEvents: 'none' }}>
                {n.name}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── Node inspector ────────────────────────────────────────────────────────
function NodeInspector({ nodeKey, nodes, edges, onClose }) {
  const node = nodes.find(n => n.key === nodeKey)
  if (!node) return null
  const outgoing = edges.filter(e => e.source === nodeKey)
  const incoming = edges.filter(e => e.target === nodeKey)
  const col = DOMAIN_COLOR[node.domain] || '#94a3b8'

  return (
    <div style={{ background: '#1e293b', borderRadius: 8, border: '1px solid #334155',
      padding: 16, width: 260, flexShrink: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 600, color: col, fontSize: 13 }}>{node.name}</span>
        <button onClick={onClose} style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>
          <X size={14}/>
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        {[
          ['Domain',      fmtDomain(node.domain)],
          ['Centrality',  (node.centrality * 100).toFixed(0) + '%'],
          ['PageRank',    (node.pagerank   * 100).toFixed(0) + '%'],
          ['Degree',      outgoing.length + incoming.length],
        ].map(([label, val]) => (
          <div key={label} style={{ background: '#0f172a', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ color: '#94a3b8', fontSize: 10 }}>{label}</div>
            <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>{val}</div>
          </div>
        ))}
      </div>
      {outgoing.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 4 }}>OUTGOING ({outgoing.length})</div>
          {outgoing.slice(0, 5).map((e, i) => {
            const tn = nodes.find(n => n.key === e.target)
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                padding: '3px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: '#e2e8f0', fontSize: 11 }}>{tn?.name || e.target}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999,
                  background: (RELATION_COLOR[e.relation] || '#94a3b8') + '33',
                  color: RELATION_COLOR[e.relation] || '#94a3b8' }}>
                  {fmtRelation(e.relation)}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {incoming.length > 0 && (
        <div>
          <div style={{ color: '#94a3b8', fontSize: 10, marginBottom: 4 }}>INCOMING ({incoming.length})</div>
          {incoming.slice(0, 5).map((e, i) => {
            const sn = nodes.find(n => n.key === e.source)
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                padding: '3px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: '#e2e8f0', fontSize: 11 }}>{sn?.name || e.source}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999,
                  background: (RELATION_COLOR[e.relation] || '#94a3b8') + '33',
                  color: RELATION_COLOR[e.relation] || '#94a3b8' }}>
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
          border: 'none', color: '#64748b', cursor: 'pointer', padding: 2,
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
                background: '#0f172a', color: '#cbd5e1', border: '1px solid #475569',
                whiteSpace: 'nowrap' }}>
                {item.name.toLowerCase()}
              </span>
              {i < pathNames.length - 1 && (
                <span style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1 }}>→</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Confidence / Novelty / Impact */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#cbd5e1' }}>
          Confidence{' '}
          <span style={{ color: '#00AEEF', fontWeight: 700 }}>
            {Math.round((rec.confidence || 0) * 100)}%
          </span>
        </span>
        <span style={{ fontSize: 12, color: '#cbd5e1' }}>
          Novelty{' '}
          <span style={{ color: '#f59e0b', fontWeight: 700 }}>
            {Math.round((rec.novelty || 0) * 100)}%
          </span>
        </span>
        <span style={{ fontSize: 12, color: '#cbd5e1' }}>
          Impact{' '}
          <span style={{ color: '#10b981', fontWeight: 700 }}>
            {Math.round((rec.impact || 0) * 100)}%
          </span>
        </span>
      </div>

      {/* Expandable toggle */}
      <button onClick={() => setExpanded(e => !e)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', color: '#94a3b8',
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
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                Hypothesis
              </div>
              <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px',
                borderLeft: `3px solid ${typeColor}` }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <Sparkles size={13} style={{ color: typeColor, flexShrink: 0, marginTop: 1 }}/>
                  <span style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.5 }}>
                    {rec.hypothesis}
                  </span>
                </div>
              </div>
            </div>
          )}

          {actions.length > 0 && (
            <div>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700,
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
                    <span style={{ color: '#cbd5e1', fontSize: 12, lineHeight: 1.4 }}>{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {impacts.length > 0 && (
            <div>
              <div style={{ color: '#64748b', fontSize: 10, fontWeight: 700,
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
              <div style={{ color: '#475569', fontSize: 11, fontWeight: 600, marginBottom: 4 }}>{label}</div>
              <div style={{ color: '#0055A4', fontSize: 28, fontWeight: 700 }}>{value}</div>
              <div style={{ color: '#64748b', fontSize: 11 }}>{sub}</div>
            </div>
          ))}
        </div>
      )}

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

          {noData ? (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              background: '#f8fafc', borderRadius: 8, padding: 40 }}>
              <Network size={48} color="#94a3b8"/>
              <p style={{ color: '#64748b', fontSize: 15 }}>No ontology data yet</p>
              <button onClick={discover} style={{ padding: '8px 20px', background: '#0055A4',
                color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 }}>
                Run Discovery
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ForceGraph
                  nodes={graph.nodes}
                  edges={graph.edges}
                  selected={selected}
                  onSelect={setSelected}
                />
                {/* Legend — consistent Title Case */}
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {Object.entries(RELATION_COLOR).map(([rel, col]) => (
                    <span key={rel} style={{ fontSize: 11, color: col, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 16, height: 2, background: col, display: 'inline-block' }}/>
                      {fmtRelation(rel)}
                    </span>
                  ))}
                  {Object.entries(DOMAIN_COLOR).filter(([d]) => d !== 'other').map(([d, c]) => (
                    <span key={d} style={{ fontSize: 11, color: c, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }}/>
                      {fmtDomain(d)}
                    </span>
                  ))}
                </div>
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
                    <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 10, fontWeight: 700, letterSpacing: '0.05em' }}>
                      TOP NODES BY PAGERANK
                    </div>
                    {stats.top_nodes_by_pagerank.map((n, i) => (
                      <div key={n.key} onClick={() => setSelected(n.key)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 0', borderBottom: '1px solid #0f172a', cursor: 'pointer' }}>
                        <span style={{ color: '#64748b', fontSize: 11, width: 16 }}>{i + 1}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#f1f5f9', fontSize: 12 }}>{n.name}</div>
                          <div style={{ color: DOMAIN_COLOR[n.domain] || '#94a3b8', fontSize: 10 }}>{fmtDomain(n.domain)}</div>
                        </div>
                        <div style={{ color: '#00AEEF', fontWeight: 700, fontSize: 13 }}>
                          {Math.round((n.pagerank || 0) * 100)}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {stats?.edge_type_distribution && (
                  <div style={{ background: '#1e293b', borderRadius: 8, border: '1px solid #334155', padding: 14 }}>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginBottom: 10, fontWeight: 700, letterSpacing: '0.05em' }}>
                      RELATIONSHIP TYPES
                    </div>
                    {Object.entries(stats.edge_type_distribution).map(([rel, cnt]) => (
                      <div key={rel} style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', padding: '4px 0' }}>
                        <span style={{ fontSize: 12, color: RELATION_COLOR[rel] || '#94a3b8' }}>
                          {fmtRelation(rel)}
                        </span>
                        <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>{cnt}</span>
                      </div>
                    ))}
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
              <p style={{ color: '#64748b' }}>
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
