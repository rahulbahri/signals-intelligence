import { useState, useRef } from 'react'
import axios from 'axios'
import { Upload, CheckCircle, AlertCircle, FileText, Trash2 } from 'lucide-react'

export default function CSVUpload({ onUploaded }) {
  const [dragging, setDragging]   = useState(false)
  const [result,   setResult]     = useState(null)
  const [error,    setError]      = useState(null)
  const [loading,  setLoading]    = useState(false)
  const [uploads,  setUploads]    = useState([])
  const fileRef = useRef()

  async function fetchUploads() {
    try {
      const r = await axios.get('/api/uploads')
      setUploads(r.data)
    } catch {}
  }

  useState(() => { fetchUploads() }, [])

  async function handleFile(file) {
    if (!file?.name.endsWith('.csv')) { setError('Please upload a .csv file'); return }
    setLoading(true); setResult(null); setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await axios.post('/api/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setResult(r.data)
      onUploaded?.()
      fetchUploads()
    } catch(e) {
      setError(e.response?.data?.detail || 'Upload failed')
    }
    setLoading(false)
  }

  async function deleteUpload(id) {
    await axios.delete(`/api/uploads/${id}`)
    fetchUploads()
    onUploaded?.()
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-slate-800 font-semibold text-base mb-1 flex items-center gap-2">
          <span className="w-1 h-5 bg-[#0055A4] rounded-full"/>
          Data Upload
        </h2>
        <p className="text-slate-500 text-xs">
          Upload a CSV to recompute KPIs. Column names are auto-detected.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]) }}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all ${
          dragging
            ? 'border-[#0055A4] bg-blue-50'
            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
        }`}
      >
        <input ref={fileRef} type="file" accept=".csv" className="hidden"
          onChange={e => handleFile(e.target.files[0])}/>
        {loading
          ? <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 border-4 border-[#0055A4] border-t-transparent rounded-full animate-spin"/>
              <p className="text-slate-500 text-sm">Processing…</p>
            </div>
          : <div className="flex flex-col items-center gap-3">
              <Upload size={36} className="text-slate-400"/>
              <p className="text-slate-700 font-medium">Drop CSV here or click to browse</p>
              <p className="text-slate-400 text-xs">Accepts: date, revenue, cogs, opex, ar, mrr, arr, customers, churn, is_recurring, sm_allocated, headcount</p>
            </div>
        }
      </div>

      {/* Result */}
      {result && (
        <div className="card p-5 border-l-4 border-l-emerald-500 bg-emerald-50/60">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-emerald-600"/>
            <span className="text-emerald-700 font-medium text-sm">{result.message}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ['Rows',    result.rows_processed],
              ['Months',  result.months_detected],
              ['KPIs',    result.kpis_computed?.length],
              ['Upload',  `#${result.upload_id}`],
            ].map(([l, v]) => (
              <div key={l} className="bg-white rounded-lg p-3 text-center border border-emerald-100">
                <div className="text-slate-800 font-bold">{v}</div>
                <div className="text-slate-500 text-xs">{l}</div>
              </div>
            ))}
          </div>
          {result.kpis_computed?.length > 0 && (
            <div className="mt-3">
              <p className="text-slate-500 text-xs mb-1">KPIs computed:</p>
              <div className="flex flex-wrap gap-1.5">
                {result.kpis_computed.map(k => (
                  <span key={k} className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs font-medium">{k}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="card p-4 border-l-4 border-l-red-500 bg-red-50/60 flex items-center gap-2">
          <AlertCircle size={16} className="text-red-500 shrink-0"/>
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      {/* Expected format */}
      <div className="card p-5">
        <h3 className="text-slate-700 text-sm font-semibold mb-3">Expected CSV Format</h3>
        <div className="overflow-x-auto">
          <table className="text-xs text-left w-full">
            <thead>
              <tr className="border-b border-slate-100">
                {['Column','Aliases','Required','Used For'].map(h => (
                  <th key={h} className="py-2 pr-6 text-slate-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {[
                ['date',        'transaction_date, month, period',       '✓', 'Month grouping'],
                ['revenue',     'sales, total_revenue, net_revenue',     '✓', 'Most KPIs'],
                ['cogs',        'cost_of_goods_sold, cost',              '',  'Gross/Operating Margin'],
                ['opex',        'operating_expenses, sg_and_a',          '',  'Margins, OpEx Ratio'],
                ['ar',          'accounts_receivable, receivables',      '',  'DSO, Cash Cycle'],
                ['customers',   'customer_count, clients',               '',  'Churn, CAC Payback'],
                ['churn',       'churned_customers, lost_customers',     '',  'Churn Rate, NRR'],
                ['is_recurring','recurring (0/1)',                       '',  'Revenue Quality'],
                ['sm_allocated','sales_marketing, s_m',                  '',  'Sales Efficiency'],
                ['arr',         'annual_recurring_revenue',              '',  'ARR Growth'],
              ].map(([col, alias, req, use]) => (
                <tr key={col} className="hover:bg-slate-50/60">
                  <td className="py-2 pr-6 text-[#0055A4] font-mono font-medium">{col}</td>
                  <td className="py-2 pr-6 text-slate-500">{alias}</td>
                  <td className="py-2 pr-6 text-amber-600 font-bold">{req}</td>
                  <td className="py-2 pr-6 text-slate-600">{use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload history */}
      {uploads.length > 0 && (
        <div className="card p-5">
          <h3 className="text-slate-700 text-sm font-semibold mb-3">Upload History</h3>
          <div className="space-y-1">
            {uploads.map(u => (
              <div key={u.id} className="flex items-center justify-between py-2.5 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-slate-400"/>
                  <div>
                    <p className="text-slate-700 text-sm font-medium">{u.filename}</p>
                    <p className="text-slate-400 text-xs">{u.row_count} rows · {new Date(u.uploaded_at).toLocaleString()}</p>
                  </div>
                </div>
                <button onClick={() => deleteUpload(u.id)}
                  className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors">
                  <Trash2 size={13}/>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
