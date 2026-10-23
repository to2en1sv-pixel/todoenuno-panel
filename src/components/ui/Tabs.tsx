export function Tabs<T extends string>({
  value, onChange, items,
}: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div className="inline-flex bg-sf bd rounded-lg p-1 gap-1">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className="px-3 py-1.5 rounded-md text-sm font-semibold"
          style={
            value === it.key
              ? { background: 'var(--cd)', border: '1px solid var(--bd)' }
              : { color: 'var(--mu)' }
          }
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
