import { useMemo } from 'react';
import { usePostQueue } from '@/hooks/usePostQueue';
import { useInventory, useProductos, useVariantes } from '@/hooks/useCatalog';
import { Skeleton } from '@/components/ui/Skeleton';
import { fmtAgo } from '@/lib/format';
import { Package, AlertTriangle, CircleDot } from 'lucide-react';

export function HoyPage() {
  const queue = usePostQueue();
  const inv = useInventory();
  const productos = useProductos();
  const variantes = useVariantes();
  const now = new Date();

  const lastPost = useMemo(() => (queue.data ?? []).filter(x => x.status === 'posted' && x.posted_at).sort((a, b) => new Date(b.posted_at!).getTime() - new Date(a.posted_at!).getTime())[0], [queue.data]);
  const pending = useMemo(() => (queue.data ?? []).filter(x => x.status === 'pending'), [queue.data]);
  const todayPosts = useMemo(() => (queue.data ?? []).filter(x => x.status === 'posted' && x.posted_at && new Date(x.posted_at).toDateString() === now.toDateString()), [queue.data, now]);
  const lowStock = useMemo(() => (inv.data ?? []).filter(x => x.qty <= 5).sort((a, b) => a.qty - b.qty), [inv.data]);

  const lastPostMin = lastPost ? Math.floor((now.getTime() - new Date(lastPost.posted_at!).getTime()) / 60000) : null;
  const systemAlive = lastPostMin !== null && lastPostMin < 1440 && pending.length > 0;
  const greeting = now.getHours() < 12 ? 'Buenos días' : now.getHours() < 19 ? 'Buenas tardes' : 'Buenas noches';

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 pb-10">
      <div className="rounded-2xl p-6 lg:p-8" style={{ background: 'var(--tx)', color: 'var(--cd)' }}>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-60">
          <CircleDot size={12} style={{ color: systemAlive ? 'var(--ok)' : 'var(--er)' }} />
          {now.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })} · {now.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
        </div>
        <h1 className="text-3xl lg:text-4xl font-bold mt-3 tracking-tight">
          {queue.isLoading ? '…' : systemAlive ? `${greeting}, todo en marcha` : 'El sistema está parado'}
        </h1>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <div><div className="text-[10px] uppercase opacity-60">Último post</div><div className="text-sm font-semibold mt-1">{lastPost ? fmtAgo(lastPost.posted_at) : '—'}</div></div>
          <div><div className="text-[10px] uppercase opacity-60">Siguiente</div><div className="text-sm font-semibold mt-1 truncate">{pending[0]?.nombre ?? 'Sin cola'}</div></div>
          <div><div className="text-[10px] uppercase opacity-60">Hoy</div><div className="text-sm font-semibold mt-1">{todayPosts.length} publicados</div></div>
        </div>
      </div>

      <section className="bg-cd bd rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3"><h2 className="text-sm font-semibold">Publicado hoy</h2></div>
        {queue.isLoading && <Skeleton h={80} />}
        {!queue.isLoading && todayPosts.length === 0 && <div className="text-sm tx-mu py-4 text-center">Aún no se ha publicado nada hoy.</div>}
        <div className="flex flex-col gap-2">
          {todayPosts.map(p => (
            <div key={p.id} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--bd)' }}>
              {p.image_url ? <img src={p.image_url} className="w-12 h-12 rounded-lg object-cover bg-sf" /> : <div className="w-12 h-12 rounded-lg bg-sf grid place-items-center text-lg">📦</div>}
              <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{p.nombre ?? p.sku ?? '—'}</div><div className="text-[11px] tx-mu mono">{fmtAgo(p.posted_at)}</div></div>
            </div>
          ))}
        </div>
      </section>

      {!inv.isLoading && lowStock.length > 0 && (
        <section className="rounded-2xl p-5" style={{ background: 'var(--kb)', border: '1px solid color-mix(in srgb, var(--ac) 40%, transparent)' }}>
          <div className="flex items-center gap-2 mb-3"><AlertTriangle size={16} style={{ color: 'var(--ac)' }} /><h2 className="text-sm font-semibold" style={{ color: 'var(--ac)' }}>Stock crítico ({lowStock.length})</h2></div>
          {lowStock.slice(0, 5).map(x => (
            <div key={x.sku} className="flex items-center justify-between py-1.5 text-sm">
              <div className="mono text-xs">{x.sku}</div><div className="font-semibold" style={{ color: x.qty === 0 ? 'var(--er)' : 'var(--ac)' }}>{x.qty === 0 ? 'agotado' : `${x.qty} uds`}</div>
            </div>
          ))}
        </section>
      )}

      <section className="bg-cd bd rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3"><Package size={14} className="tx-mu" /><h2 className="text-sm font-semibold">Catálogo</h2></div>
        <div className="grid grid-cols-3 gap-3">
          <div><div className="text-2xl font-bold">{productos.data?.length ?? '—'}</div><div className="text-[11px] tx-mu uppercase mt-1">Productos</div></div>
          <div><div className="text-2xl font-bold">{variantes.data?.length ?? '—'}</div><div className="text-[11px] tx-mu uppercase mt-1">Variantes</div></div>
          <div><div className="text-2xl font-bold">{productos.data?.filter(p => p.is_published).length ?? '—'}</div><div className="text-[11px] tx-mu uppercase mt-1">Publicados</div></div>
        </div>
      </section>
    </div>
  );
}
