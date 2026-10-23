export function Skeleton({ h = 16, w = '100%', className = '' }: { h?: number; w?: number | string; className?: string }) {
  return <div className={`shimmer ${className}`} style={{ height: h, width: w }} />;
}
