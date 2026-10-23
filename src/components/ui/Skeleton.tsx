export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <div style={{ height: h, width: w, background: 'var(--sf)', borderRadius: 6, opacity: 0.7 }} />;
}
