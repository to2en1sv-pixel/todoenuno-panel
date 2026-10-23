import { useMemo, useState } from 'react';
import { usePostQueue } from '@/hooks/usePostQueue';
import { Skeleton } from '@/components/ui/Skeleton';
import { fmtAgo } from '@/lib/format';
import { ExternalLink, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

export function ColaPage() {
  const q = usePostQueue();
  const [filter, setFilter] = useState<'all' | 'pending' | 'posted'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((x) => {
      if (filter !== 'all' && x.status !== filter) return false;
      if (s && ![x.nombre, x.sku].filter(Boolean).some((v) => (v as string).toLowerCase().includes(s))) return false;
      return true;
    });
  }, [q.data, filter, search]);

  const counts = useMemo(() => {
    const data = q.data ?? [];
    return {
      all: data.length,
      pending: data.filter(x => x.status === 'pending').length,
      posted: data.filter(x => x.status === 'posted').length,
    };
  }, [q.data]);

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4 pb-10">
      
      {/* Barra de Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilter('all')} className="px-3 py-1.5 rounded-lg text-sm font-semibold" style={filter === 'all' ? { background: 'var(--tx)', color: 'var(--cd)' } : { background: 'var(--cd)', border: '1px solid var(--bd)', color: 'var(--mu)' }}>
          Todas ({counts.all})
        </button>
        <button onClick={() => setFilter('pending')} className="px-3 py-1.5 rounded-lg text-sm font-semibold" style={filter === 'pending' ? { background: 'var(--tx)', color: 'var(--cd)' } : { background: 'var(--cd)', border: '1px solid var(--bd)', color: 'var(--mu)' }}>
          Pendientes ({counts.pending})
        </button>
        <button onClick={() => setFilter('posted')} className="px-3 py-1.5 rounded-lg text-sm font-semibold" style={filter === 'posted' ? { background: 'var(--tx)', color: 'var(--cd)' } : { background: 'var(--cd)', border: '1px solid var(--bd)', color: 'var(--mu)' }}>
          Publicados ({counts.posted})
        </button>
        
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar producto o SKU..."
          className="bg-cd bd rounded-lg px-3 py-2 text-sm outline-none flex-1 max-w-xs ml-auto"
        />
      </div>

      {/* Lista de Posts */}
      <div className="bg-cd bd rounded-2xl overflow-hidden">
        {q.isLoading && <div className="p-4"><Skeleton h={100} /></div>}
        
        {!q.isLoading && filtered.length === 0 && (
          <div className="text-center py-12 tx-mu">
            No hay posts en esta categoría.
          </div>
        )}

        {filtered.map((item, i) => (
          <div key={item.id} className="flex items-center gap-4 p-4 hover:bg-sf transition-colors" style={{ borderBottom: i < filtered.length - 1 ? '1px solid var(--bd)' : 'none' }}>
            
            {/* Imagen */}
            {item.image_url ? (
              <img src={item.image_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-sf shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-lg bg-sf grid place-items-center shrink-0 text-lg">📦</div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold truncate">{item.nombre ?? 'Sin nombre'}</div>
              <div className="text-[11px] tx-mu mono mt-0.5">{item.sku ?? '—'}</div>
            </div>

            {/* Estado */}
            <div className="flex items-center gap-2 shrink-0">
              {item.status === 'posted' && (
                <span className="chip ok"><CheckCircle2 size={12} /> Publicado {item.posted_at ? `· ${fmtAgo(item.posted_at)}` : ''}</span>
              )}
              {item.status === 'pending' && (
                <span className="chip" style={{ color: 'var(--ac)', borderColor: 'var(--ac)' }}><Clock size={12} /> Pendiente</span>
              )}
              {item.status === 'failed' && (
                <span className="chip er"><AlertCircle size={12} /> Falló</span>
              )}
              
              {/* Enlace a FB */}
              {item.fb_post_id && (
                <a href={`https://facebook.com/${item.fb_post_id}`} target="_blank" rel="noreferrer" className="p-2 rounded-lg bg-sf hover:bg-bd tx-mu transition-colors" title="Ver en Facebook">
                  <ExternalLink size={14} />
                </a>
              )}
            </div>

          </div>
        ))}
      </div>
    </div>
  );
}
