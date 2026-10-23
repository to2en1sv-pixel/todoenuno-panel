import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { usePostQueue } from '@/hooks/usePostQueue';
import { useInventory, useProductos, useVariantes } from '@/hooks/useCatalog';
import { Skeleton } from '@/components/ui/Skeleton';
import { fmtAgo } from '@/lib/format';
import { Package, AlertTriangle, ArrowRight, CircleDot } from 'lucide-react';

export function HoyPage() {
  const queue = usePostQueue();
  const inv = useInventory();
  const productos = useProductos();
  const variantes = useVariantes();

  const now = new Date();

  const lastPost = useMemo(() => {
    const posted = (queue.data ?? []).filter((x) => x.status === 'posted' && x.posted_at);
    if (posted.length === 0) return null;
    return posted.sort((a, b) =>
      new Date(b.posted_at!).getTime() - new Date(a.posted_at!).getTime()
    )[0];
  }, [queue.data]);

  const pending = useMemo(
    () => (queue.data ?? []).filter((x) => x.status === 'pending'),
    [queue.data]
  );
  const nextPost = pending[0] ?? null;

  const todayPosts = useMemo(() => {
    const today = now.toDateString();
    return (queue.data ?? [])
      .filter((x) => x.status === 'posted' && x.posted_at && new Date(x.posted_at).toDateString() === today)
      .sort((a, b) => new Date(b.posted_at!).getTime() - new Date(a.posted_at!).getTime());
  }, [queue.data, now]);

  const lowStock = useMemo(
    () => (inv.data ?? []).filter((x) => x.qty <= 5).sort((a, b) => a.qty - b.qty),
    [inv.data]
  );

  const lastPostMin = lastPost
    ? Math.floor((now.getTime() - new Date(lastPost.posted_at!).getTime()) / 60000)
    : null;
  const systemAlive = lastPostMin !== null && lastPostMin < 24 * 60 && pending.length > 0;
  const systemStale = lastPostMin !== null && lastPostMin >= 24 * 60;

  const greeting = now.getHours() < 12 ? 'Buenos días' : now.getHours() < 19 ? 'Buenas tardes' : 'Buenas noches';
  const dateLabel = now.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 pb-10">
      {/* HERO */}
      <div className="rounded-2xl p-6 lg:p-8" style={{ background: 'var(--tx)', color: 'var(--cd)' }}>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider opacity-60">
          <CircleDot size={12} className={systemAlive ? 'animate-pulse' : ''} style={{ color: systemAlive ? 'var(--ok)' : systemStale ? 'var(--er)' : 'var(--mu)' }} />
          {dateLabel} · {now.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
        </div>

        <h1 className="text-3xl lg:text-4xl font-bold mt-3 tracking-tight">
          {queue.isLoading ? '…' : systemAlive ? `${greeting}, todo en marcha` : systemStale ? 'El sistema está parado' : 'Listo para empezar'}
        </h1>

        <div className="grid grid-cols-3 gap-4 mt-6">
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-60">Último post</div>
            <div className="text-sm lg:text-base font-semibold mt-1">
              {lastPost ? fmtAgo(lastPost.posted_at) : '—'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-60">Siguiente</div>
            <div className="text-sm lg:text-base font-semibold mt-1 truncate">
              {nextPost ? nextPost.nombre ?? 'En cola' : 'Sin cola'}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-60">Hoy</div>
            <div className="text-sm lg:text-base font-semibold mt-1">
              {todayPosts.length} {todayPosts.length === 1 ? 'publicado' : 'publicados'}
            </div>
          </div>
        </div>
      </div>

      {/* PUBLICADO HOY */}
      <section className="bg-cd bd rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Publicado hoy</h2>
          <Link to="/cola" className="text-[11px] tx-mu hover:text-tx inline-flex items-center gap-1">
            Ver cola <ArrowRight size={12} />
          </Link>
        </div>
        {queue.isLoading && <Skeleton h={80} />}
        {!queue.isLoading && todayPosts.length === 0 && (
          <div className="text-sm tx-mu py-4 text-center">
            Aún no se ha publicado nada hoy.
            {nextPost && <> Siguiente: <b>{nextPost.nombre ?? '—'}</b></>}
          </div>
        )}
        <div className="flex flex-col gap-2">
          {todayPosts.map((p) => (
            <div key={p.id} className="flex items-center gap-3 py-2" style={{ borderBottom: '1px solid var(--bd)' }}>
              {p.image_url ? (
                <img src={p.image_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-sf" />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-sf grid place-items-center text-lg">📦</div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.nombre ?? p.sku ?? '—'}</div>
                <div className="text-[11px] tx-mu mono">
                  {fmtAgo(p.posted_at)} · {p.fb_post_id ? 'FB ✓' : 'sin FB ID'}
                </div>
              </div>
              {p.fb_post_id && (
                <a
                  href={`https://facebook.com/${p.fb_post_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="chip"
                >
                  Ver
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* STOCK CRÍTICO */}
      {!inv.isLoading && lowStock.length > 0 && (
        <section className="rounded-2xl p-5" style={{ background: 'var(--kb)', border: '1px solid color-mix(in srgb, var(--ac) 40%, transparent)' }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} style={{ color: 'var(--ac)' }} />
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ac)' }}>
              Stock crítico ({lowStock.length})
            </h2>
          </div>
          <div className="flex flex-col gap-1">
            {lowStock.slice(0, 5).map((x) => (
              <div key={x.sku} className="flex items-center justify-between py-1.5 text-sm">
                <div className="mono text-xs">{x.sku}</div>
                <div className="font-semibold" style={{ color: x.qty === 0 ? 'var(--er)' : 'var(--ac)' }}>
                  {x.qty === 0 ? 'agotado' : `${x.qty} uds`}
                </div>
              </div>
            ))}
            {lowStock.length > 5 && (
              <div className="text-[11px] tx-mu mt-1">+{lowStock.length - 5} más…</div>
            )}
          </div>
        </section>
      )}

      {/* CATÁLOGO */}
      <section className="bg-cd bd rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Package size={14} className="tx-mu" />
          <h2 className="text-sm font-semibold">Catálogo</h2>
          <Link to="/catalogo" className="ml-auto text-[11px] tx-mu hover:text-tx inline-flex items-center gap-1">
            Ver todo <ArrowRight size={12} />
          </Link>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <div className="text-2xl font-bold">{productos.data?.length ?? '—'}</div>
            <div className="text-[11px] tx-mu uppercase tracking-wider mt-1">Productos</div>
          </div>
          <div>
            <div className="text-2xl font-bold">{variantes.data?.length ?? '—'}</div>
            <div className="text-[11px] tx-mu uppercase tracking-wider mt-1">Variantes</div>
          </div>
          <div>
            <div className="text-2xl font-bold">
              {productos.data?.filter((p) => p.is_published).length ?? '—'}
            </div>
            <div className="text-[11px] tx-mu uppercase tracking-wider mt-1">Publicados</div>
          </div>
        </div>
      </section>

      <div className="text-center text-[10px] tx-mu mono mt-2">
        Abre con café · cierra cuando sepas qué hacer
      </div>
    </div>
  );
}
