export function Skeleton({ h = 16 }: { h?: number }) { 
  return <div style={{ height: h, background: 'var(--sf)', borderRadius: 6, opacity: 0.7 }} />; 
}
