import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { useFbPostsActivos } from '@/hooks/useFbPosts';
import { usePostQueue } from '@/hooks/usePostQueue';
import { fmtAgo } from '@/lib/format';

export function FeedPage() {
  const fb = useFbPostsActivos();
  const queue = usePostQueue();

  const published = (queue.data ?? []).filter((x) => x.status === 'posted' || x.status === 'published').length;
  const pending = (queue.data ?? []).filter((x) => x.status && x.status !== 'posted' && x.status !== 'published').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card><div className="text-2xl font-bold">{fb.data?.length ?? 0}</div><div className="text-[11px] tx-mu uppercase tracking-wider">Posts activos FB</div></Card>
        <Card><div className="text-2xl font-bold">{published}</div><div className="text-[11px] tx-mu uppercase tracking-wider">Publicados (cola)</div></Card>
        <Card><div className="text-2xl font-bold">{pending}</div><div className="text-[11px] tx-mu uppercase tracking-wider">Pendientes (cola)</div></Card>
      </div>

      <Card>
        <h3 className="font-semibold text-sm mb-3">Posts activos en Facebook</h3>
        {fb.isLoading && <Skeleton h={120} />}
        {!fb.isLoading && (fb.data ?? []).length === 0 && <EmptyState title="Sin posts activos" />}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {(fb.data ?? []).map((p) => (
            <div key={p.id} className="bg-sf bd rounded-lg p-3">
              <div className="flex justify-between items-start">
                <span className="text-[11px] mono tx-mu truncate">{p.fb_post_id}</span>
                <Badge tone={p.is_active ? 'ok' : 'neutral'}>{p.is_active ? 'activo' : 'inactivo'}</Badge>
              </div>
              <div className="text-sm font-medium mt-1">Template #{p.template_id ?? '—'}</div>
              <div className="text-[11px] tx-mu mt-1">{fmtAgo(p.created_at)}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
