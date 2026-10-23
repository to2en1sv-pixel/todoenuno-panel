export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="text-center py-12">
      <div style={{ fontSize: 32 }}>📭</div>
      <div className="font-semibold mt-2">{title}</div>
      {hint && <div className="tx-mu text-sm mt-1">{hint}</div>}
    </div>
  );
}
