export function fmtMoney(n: number | null | undefined, cur = 'USD') {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-SV', { style: 'currency', currency: cur }).format(n);
}
export function fmtNum(n: number | null | undefined) {
  if (n == null) return '—';
  return new Intl.NumberFormat('es-SV').format(n);
}
export function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' });
}
export function fmtAgo(iso: string | null | undefined) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'hace instantes';
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}
