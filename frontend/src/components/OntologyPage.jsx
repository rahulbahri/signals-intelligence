import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import axios from 'axios'
import { Network, RefreshCw, Sparkles, X, ChevronDown, ChevronUp } from 'lucide-react'

// ── Domain colours (match sidebar palette) ────────────────────────────────
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
  CAUSES:           '#f59e0b',
  INFLUENCES:       '#8b5cf6',
  CORRELATES_WITH:  '#00AEEF',
  ANTI_CORRELATES:  '#ef4444',
}

// ── Force-directed layout (RAF-based, no D3) ──────────────────────────────
function useForceLayout(nodes, edges, width, height) {
  const posRef  = useRef({})
  const velRef  = useRef({})
  const frameRef = useRef(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!nodes.length) return

    // Initialise positions radially by domain
    const domains = [...new Set(nodes.map(n => n.domain))]
    nodes.forEach((n, i) => {
      if (posRef.current[n.key]) return
      const di = domains.indexOf(n.domain)
      const angle = (di / domains.length) * Math.PI * 2 + (i * 0.3)
      const r = Math.min(width, height) * 0.30
      posRef.current[n.key] = {
        x: width / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 40,
        y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 40,
      }
      velRef.current[n.key] = { x: 0, y: 0 }
    })

    // Build adjacency
    const adj = {}
    edges.forEach(e => {
      adj[e.source] = adj[e.source] || new Set()
      adj[e.target] = adj[e.target] || new Set()
      adj[e.source].add(e.target)
      adj[e.target].add(e.source)
    })

    let t = 0
    const REPULSION = 3500
    const SPRING    = 0.04
    const DAMPING   = 0.75
    const REST      = 120

    function step() {
      const pos = posRef.current
      const vel = velRef.current
      const keys = nodes.map(n => n.key).filter(k => pos[k])

      // Repulsion
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

      // Spring attraction for edges
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

      // Centering
      keys.forEach(k => {
        vel[k].x += (width / 2 - pos[k].x) * 0.002
        vel[k].y += (height / 2 - pos[k].y) * 0.002
      })

      // Integrate
      keys.forEach(k => {
        vel[k].x *= DAMPING; vel[k].y *= DAMPING
        pos[k].x += vel[k].x; pos[k].y += vel[k].y
        pos[k].x = Math.max(20, Math.min(width - 20, pos[k].x))
        pos[k].y = Math.max(20, Math.min(height - 20, pos[k].y))
      })

      t++
      if (t % 6 === 0) setTick(t)
      if (t < 300) frameRef.current = requestAnimationFrame(step)
    }

    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [nodes.length, edges.length, width, height])

  return posRef.current
}

// ── Force graph SVG ───────────────────────────────────────────────────────
function ForceGraph({ nodes, edges, selected, onSelect }) {
  const W = 900, H = 580
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
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: '#0f172a', borderRadius: 8 }}>
      <defs>
        {Object.entries(RELATION_COLOR).map(([rel, col]) => (
          <marker key={rel} id={`arr-${rel}`} markerWidth="6" markerHeight="6"
            refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill={col} opacity="0.7"/>
          </marker>
        ))}
      </defs>

      {/* Edges */}
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
            opacity={dimmed ? 0.08 : 0.5}
            markerEnd={`url(#arr-${e.relation})`}
          />
        )
      })}

      {/* Nodes */}
      {nodes.map(n => {
        const p = pos[n.key]
        if (!p) return null
        const dimmed = neighborSet && !neighborSet.has(n.key)
        const r = 6 + (n.centrality || 0) * 18
        const col = DOMAIN_COLOR[n.domain] || '#94a3b8'
        const isSelected = selected === n.key
        return (
          <g key={n.key} onClick={() => onSelect(isSelected ? null : n.key)}
            style={{ cursor: 'pointer' }} opacity={dimmed ? 0.2 : 1}>
            {isSelected && (
              <circle cx={p.x} cy={p.y} r={r + 6} fill="none" stroke={col} strokeWidth={2} opacity={0.5}/>
            )}
            <circle cx={p.x} cy={p.y} r={r} fill={col} opacity={0.85}/>
            {(r > 9 || isSelected) && (
              <text x={p.x} y={p.y + r + 10} textAnchor="middle"
                fontSize="9" fill="#cbd5e1" style={{ pointerEvents: 'none' }}>
                {n.name}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── Node inspector panel ───────────────────────────────────────────────────
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
        <button onClick={onClose} style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>
          <X size={14}/>
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
        {[
          ['Domain', node.domain],
          ['Centrality', (node.centrality * 100).toFixed(0) + '%'],
          ['PageRank', (node.pagerank * 100).toFixed(0) + '%'],
          ['Degree', outgoing.length + incoming.length],
        ].map(([label, val]) => (
          <div key={label} style={{ background: '#0f172a', borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ color: '#64748b', fontSize: 10 }}>{label}</div>
            <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{val}</div>
          </div>
        ))}
      </div>
      {outgoing.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ color: '#64748b', fontSize: 10, marginBottom: 4 }}>OUTGOING ({outgoing.length})</div>
          {outgoing.slice(0, 5).map((e, i) => {
            const tn = nodes.find(n => n.key === e.target)
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                padding: '3px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: '#cbd5e1', fontSize: 11 }}>{tn?.name || e.target}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999,
                  background: RELATION_COLOR[e.relation] + '22',
                  color: RELATION_COLOR[e.relation] || '#94a3b8' }}>
                  {e.relation.replace('_', ' ')}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {incoming.length > 0 && (
        <div>
          <div style={{ color: '#64748b', fontSize: 10, marginBottom: 4 }}>INCOMING ({incoming.length})</div>
          {incoming.slice(0, 5).map((e, i) => {
            const sn = nodes.find(n => n.key === e.source)
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between',
                padding: '3px 0', borderBottom: '1px solid #1e293b' }}>
                <span style={{ color: '#cbd5e1', fontSize: 11 }}>{sn?.name || e.source}</span>
                <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 999,
                  background: RELATION_COLOR[e.relation] + '22',
                  color: RELATION_COLOR[e.relation] || '#94a3b8' }}>
                  {e.relation.replace('_', ' ')}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Recommendation card ────────────────────────────────────────────────────
function RecCard({ rec, nodes, onDismiss }) {
  const [open, setOpen] = useState(false)
  const pathNames = (rec.path || []).map(k => {
    const n = nodes.find(nd => nd.key === k)
    return n?.name || k
  })

  const typeColor = {
    untested_link: '#00AEEF',
    bridge_node:   '#8b5cf6',
    cluster:       '#10b981',
  }[rec.rec_type] || '#94a3b8'

  return (
    <div style={{ background: '#1e293b', borderRadius: 8,
      border: `1px solid ${typeColor}33`, marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999,
              background: typeColor + '22', color: typeColor, fontWeight: 600 }}>
              {rec.rec_type.replace('_', ' ')}
            </span>
            {pathNames.length > 1 && (
              <span style={{ fontSize: 10, color: '#64748b' }}>
                {pathNames.join(' → ')}
              </span>
            )}
          </div>
          <div style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>{rec.title}</div>
          <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{rec.description}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={() => setOpen(o => !o)}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
            {open ? <ChevronUp size={14}/> : <ChevronDown size={14}/>}
          </button>
          <button onClick={() => onDismiss(rec.id)}
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}>
            <X size={14}/>
          </button>
        </div>
      </div>

      {open && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid #334155' }}>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 10 }}>
            {[['Confidence', rec.confidence], ['Novelty', rec.novelty], ['Impact', rec.impact]].map(([l, v]) => (
              <div key={l} style={{ flex: 1, background: '#0f172a', borderRadius: 6, padding: '6px 8px', textAlign: 'center' }}>
                <div style={{ color: '#64748b', fontSize: 10 }}>{l}</div>
                <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14 }}>
                  {Math.round((v || 0) * 100)}%
                </div>
              </div>
            ))}
          </div>
          {rec.hypothesis && (
            <div style={{ background: '#0f172a', borderRadius: 6, padding: 10, fontSize: 12, color: '#cbd5e1' }}>
              <span style={{ color: '#00AEEF', fontWeight: 600 }}>Hypothesis: </span>
              {rec.hypothesis}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function OntologyPage() {
  const [graph, setGraph]         = useState({ nodes: [], edges: [] })
  const [stats, setStats]         = useState(null)
  const [recs, setRecs]           = useState([])
  const [tab, setTab]             = useState('graph')
  const [domain, setDomain]       = useState('all')
  const [selected, setSelected]   = useState(null)
  const [discovering, setDisc]    = useState(false)
  const [loading, setLoading]     = useState(true)

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
    setTimeout(() => { loadData(domain); setDisc(false) }, 5000)
  }

  async function dismiss(id) {
    await axios.post(`/api/ontology/recommendations/${id}/dismiss`)
    setRecs(r => r.filter(rec => rec.id !== id))
  }

  const noData = !loading && graph.nodes.length === 0

  const DOMAINS = ['all', ...Object.keys(DOMAIN_COLOR).filter(d => d !== 'other')]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, height: '100%' }}>

      {/* Stat cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Knowledge Nodes', value: stats.total_nodes, sub: 'KPI metrics' },
            { label: 'Relationships',   value: stats.total_edges, sub: 'typed edges' },
            { label: 'Recommendations', value: stats.active_recommendations, sub: 'signal ideas' },
            { label: 'Domains',         value: Object.keys(stats.domain_distribution || {}).length, sub: Object.entries(stats.domain_distribution || {}).map(([d,c]) => `${d}:${c}`).join(' · ') },
          ].map(({ label, value, sub }) => (
            <div key={label} className="card" style={{ padding: 16 }}>
              <div style={{ color: '#64748b', fontSize: 11, marginBottom: 4 }}>{label}</div>
              <div style={{ color: '#0055A4', fontSize: 28, fontWeight: 700 }}>{value}</div>
              <div style={{ color: '#94a3b8', fontSize: 10 }}>{sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs + Run Discovery */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['graph', 'Knowledge Graph'], ['recs', `Signal Recommendations${recs.length ? ` (${recs.length})` : ''}`]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={tab === id ? 'sidebar-link active' : 'sidebar-link'}
              style={{ padding: '6px 14px', borderRadius: 6, fontSize: 13, display: 'inline-flex' }}>
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
          {/* Domain filter */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {DOMAINS.map(d => (
              <button key={d} onClick={() => setDomain(d)}
                style={{ padding: '4px 12px', borderRadius: 999, fontSize: 12, border: 'none',
                  cursor: 'pointer', fontWeight: 500,
                  background: domain === d ? (DOMAIN_COLOR[d] || '#0055A4') : '#e2e8f0',
                  color: domain === d ? '#fff' : '#475569' }}>
                {d === 'all' ? 'All domains' : d.charAt(0).toUpperCase() + d.slice(1)}
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
                {/* Legend */}
                <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(RELATION_COLOR).map(([rel, col]) => (
                    <span key={rel} style={{ fontSize: 10, color: col, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 16, height: 2, background: col, display: 'inline-block' }}/>
                      {rel.replace('_', ' ')}
                    </span>
                  ))}
                  {Object.entries(DOMAIN_COLOR).filter(([d]) => d !== 'other').map(([d, c]) => (
                    <span key={d} style={{ fontSize: 10, color: c, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }}/>
                      {d}
                    </span>
                  ))}
                </div>
              </div>

              {/* PageRank + node inspector */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 260, flexShrink: 0 }}>
                {selected ? (
                  <NodeInspector
                    nodeKey={selected}
                    nodes={graph.nodes}
                    edges={graph.edges}
                    onClose={() => setSelected(null)}
                  />
                ) : stats?.top_nodes_by_pagerank?.length > 0 && (
                  <div style={{ background: '#1e293b', borderRadius: 8,
                    border: '1px solid #334155', padding: 14 }}>
                    <div style={{ color: '#64748b', fontSize: 11, marginBottom: 10, fontWeight: 600 }}>
                      TOP NODES BY PAGERANK
                    </div>
                    {stats.top_nodes_by_pagerank.map((n, i) => (
                      <div key={n.key} onClick={() => setSelected(n.key)}
                        style={{ display: 'flex', alignItems: 'center', gap: 8,
                          padding: '6px 0', borderBottom: '1px solid #0f172a', cursor: 'pointer' }}>
                        <span style={{ color: '#475569', fontSize: 11, width: 16 }}>{i + 1}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ color: '#e2e8f0', fontSize: 12 }}>{n.name}</div>
                          <div style={{ color: DOMAIN_COLOR[n.domain] || '#94a3b8', fontSize: 10 }}>{n.domain}</div>
                        </div>
                        <div style={{ color: '#00AEEF', fontWeight: 700, fontSize: 13 }}>
                          {Math.round((n.pagerank || 0) * 100)}%
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Edge type breakdown */}
                {stats?.edge_type_distribution && (
                  <div style={{ background: '#1e293b', borderRadius: 8,
                    border: '1px solid #334155', padding: 14 }}>
                    <div style={{ color: '#64748b', fontSize: 11, marginBottom: 10, fontWeight: 600 }}>
                      RELATIONSHIP TYPES
                    </div>
                    {Object.entries(stats.edge_type_distribution).map(([rel, cnt]) => (
                      <div key={rel} style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'center', padding: '4px 0' }}>
                        <span style={{ fontSize: 11, color: RELATION_COLOR[rel] || '#94a3b8' }}>
                          {rel.replace('_', ' ')}
                        </span>
                        <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 12 }}>{cnt}</span>
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
        <div style={{ maxWidth: 740 }}>
          {recs.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
              padding: 40, background: '#f8fafc', borderRadius: 8, gap: 12 }}>
              <Sparkles size={40} color="#94a3b8"/>
              <p style={{ color: '#64748b' }}>No recommendations yet — run Discovery first.</p>
            </div>
          ) : (
            recs.map(rec => (
              <RecCard key={rec.id} rec={rec} nodes={graph.nodes} onDismiss={dismiss}/>
            ))
          )}
        </div>
      )}
    </div>
  )
}
