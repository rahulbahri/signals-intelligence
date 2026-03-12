const PRESETS = [
  { label: 'Full Year', from: 1,  to: 12 },
  { label: 'Q1',        from: 1,  to: 3  },
  { label: 'Q2',        from: 4,  to: 6  },
  { label: 'Q3',        from: 7,  to: 9  },
  { label: 'Q4',        from: 10, to: 12 },
  { label: 'H1',        from: 1,  to: 6  },
  { label: 'H2',        from: 7,  to: 12 },
]

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function MonthRangeFilter({ value, onChange }) {
  const activePreset = PRESETS.find(p => p.from === value.from && p.to === value.to)

  function handleFrom(e) {
    const from = Number(e.target.value)
    onChange({ from, to: Math.max(from, value.to) })
  }

  function handleTo(e) {
    const to = Number(e.target.value)
    onChange({ from: Math.min(value.from, to), to })
  }

  const selectCls = `bg-white border border-slate-200 rounded-md text-xs text-slate-600
                     px-2 py-1 focus:outline-none focus:border-[#0055A4]/40 cursor-pointer
                     hover:border-slate-300 transition-colors`

  return (
    <div className="flex-shrink-0 flex items-center gap-1.5 px-6 py-2
                    border-b border-slate-100 bg-slate-50/80">

      {/* Preset buttons */}
      <span className="text-[10px] text-slate-400 uppercase tracking-wider font-medium mr-1">Period</span>
      {PRESETS.map(preset => (
        <button
          key={preset.label}
          onClick={() => onChange(preset)}
          className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
            activePreset?.label === preset.label
              ? 'bg-[#0055A4] text-white'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-transparent hover:border-slate-200'
          }`}
        >
          {preset.label}
        </button>
      ))}

      {/* Divider */}
      <div className="w-px h-4 bg-slate-200 mx-1.5"/>

      {/* Custom range dropdowns */}
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <span>From</span>
        <select value={value.from} onChange={handleFrom} className={selectCls}>
          {MONTH_NAMES.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
        <span>to</span>
        <select value={value.to} onChange={handleTo} className={selectCls}>
          {MONTH_NAMES.map((m, i) => (
            <option key={i} value={i + 1}>{m}</option>
          ))}
        </select>
      </div>

      {/* Active range label when custom (no matching preset) */}
      {!activePreset && (
        <span className="ml-2 text-[10px] text-[#0055A4] bg-blue-50 border border-blue-200
                         px-2 py-0.5 rounded-full font-medium">
          {MONTH_NAMES[value.from - 1]} – {MONTH_NAMES[value.to - 1]}
        </span>
      )}
    </div>
  )
}
