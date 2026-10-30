interface KpiCardProps {
  label: string
  value: string
  hint?: string
  valueClassName?: string
}

export function KpiCard({
  label,
  value,
  hint,
  valueClassName = 'text-slate-900',
}: KpiCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold ${valueClassName}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  )
}
