interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}

export function KpiCard({
  label,
  value,
  hint,
  valueClassName = 'text-[var(--tx)]',
}: KpiCardProps) {
  return (
    <div className="rounded-xl border border-[var(--bd)] bg-cd p-5">
      <p className="text-xs font-medium text-[var(--mu)]">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold font-mono tabular-nums ${valueClassName}`}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-[var(--mu)]">{hint}</p> : null}
    </div>
  );
}
