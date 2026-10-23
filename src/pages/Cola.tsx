import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { usePostQueue } from '@/hooks/usePostQueue';
import { fmtAgo } from '@/lib/format';

export function ColaPage() {
  const q = usePostQueue();
  const [filter, setFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');

  const statuses = useMemo(() => {
    const set = new Set<string>();
    (q.data ?? []).forEach((x) => { if (x.status) set.add(x.status); });
    return ['all', ...Array.from(set)];
  }, [q.data]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((x) => {
      if (filter !== 'all' && x.status !== filter) return false;
      if (s && ![x.nombre, x.sku].filter(Boolean).some((v) => (v as string).toLowerCase().includes(s))) return false;
      return true;
    });
  }, [q.data, filter, search]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className="chip"
            style={filter === s ? { background: 'var(--tx)', color: 'var(--cd)', borderColor: 'var(--tx)' } : {}}
          >
            {s === 'all' ? 'Todos' : s}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nombre o SKU…"
          className="bg-cd bd rounded-lg px-3 py-2 text-sm outline-none ml-auto max-w-xs w-full"
        />
      </div>

      <Card>
        {q.isLoading && <Skeleton h={200} />}
        {!q.isLoading && filtered.length === 0 && <EmptyState title="Sin posts en cola" />}
        {filtered.length > 0 && (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left tx-mu mono text-[11px]">
                  <th className="py-2 px-2">Producto</th>
                  <th>SKU</th>
                  <th>Tipo</th>
                  <th>Prioridad</th>
                  <th>Estado</th>
                  <th>Publicado</th>
                  <th>FB Post</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((x) => (
                  <tr key={x.id} className="border-t" style={{ borderColor: 'var(--bd)' }}>
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-2">
                        {x.image_url ? <img src={x.image_url} alt="" className="w-8 h-8 rounded object-cover" /> : <div className="w-8 h-8 rounded bg-sf" />}
                        <span className="text-xs font-medium">{x.nombre ?? '—'}</span>
                      </div>
                    </td>
                    <td className="mono text-xs">{x.sku ?? '—'}</td>
                    <td className="text-xs">{x.content_type ?? '—'}</td>
                    <td className="mono text-xs">{x.priority ?? '—'}</td>
                    <td><Badge tone={x.status === 'posted' || x.status === 'published' ? 'ok' : x.status === 'failed' ? 'er' : 'ac'}>{x.status ?? '—'}</Badge></td>
                    <td className="text-xs tx-mu">{x.posted_at ? fmtAgo(x.posted_at) : '—'}</td>
                    <td className="mono text-[11px]">{x.fb_post_id ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
