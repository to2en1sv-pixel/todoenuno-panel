import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useInventory, useProductos, useVariantes } from '@/hooks/useCatalog';
import { usePostQueue } from '@/hooks/usePostQueue';
import { useLastRunByTarget, useCronRuns } from '@/hooks/useCronRuns';
import { SCHEDULES, TARGET_LABEL, type CronTarget } from '@/lib/endpoints';
import { fmtAgo, fmtNum } from '@/lib/format';
import { Link } from 'react-router-dom';

function KPI({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-[11px] tx-mu uppercase tracking-wider mt-1">{label}</div>
      {hint && <div className="text-[11px] tx-mu mt-1">{hint}</div>}
    </Card>
  );
}

export function ResumenPage() {
  const productos = useProductos();
  const variantes = useVariantes();
  const inv = useInventory();
  const queue = usePostQueue();
  const last = useLastRunByTarget();
  const runs = useCronRuns(undefined, 8);

  const stockTotal = (inv.data ?? []).reduce((s, x) => s + (x.qty || 0), 0);
  const pending = (queue.data ?? []).filter((q) => q.status && q.status !== 'posted' && q.status !== 'published').length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Productos" value={productos.isLoading ? '…' : fmtNum(productos.data?.length ?? 0)} />
        <KPI label="Variantes" value={variantes.isLoading ? '…' : fmtNum(variantes.data?.length ?? 0)} />
        <KPI label="Stock total" value={inv.isLoading ? '…' : fmtNum(stockTotal)} />
        <KPI label="Posts pendientes" value={queue.isLoading ? '…' : fmtNum(pending)} hint="en cola para publicar" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">Estado de crons</h3>
            <Link to="/crons" className="chip">Ver historial</Link>
          </div>
          <div className="flex flex-col gap-2">
            {(Object.keys(SCHEDULES) as CronTarget[]).map((t) => {
              const r = last.data?.[t];
              const statusOk = r?.status === 'success';
              return (
                <div key={t} className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--bd)' }}>
                  <div>
                    <div className="text-sm font-medium">{TARGET_LABEL[t]}</div>
                    <div className="text-[11px] tx-mu mono">
                      Última: {r ? `${fmtAgo(r.started_at)} • ${r.status}` : 'sin ejecuciones'}
                    </div>
                  </div>
                  <Badge tone={statusOk ? 'ok' : r ? 'er' : 'neutral'}>
                    {statusOk ? 'OK' : r ? 'Falla' : '—'}
                  </Badge>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h3 className="font-semibold text-sm mb-3">Últimas ejecuciones</h3>
          {runs.isLoading && <Skeleton h={80} />}
          {!runs.isLoading && (runs.data ?? []).length === 0 && (
            <div className="tx-mu text-sm">Aún no hay ejecuciones registradas.</div>
          )}
          <div className="flex flex-col gap-2 max-h-72 overflow-auto">
            {(runs.data ?? []).map((r) => (
              <div key={r.id} className="flex justify-between text-xs py-1.5 border-b" style={{ borderColor: 'var(--bd)' }}>
                <div className="mono">{TARGET_LABEL[r.target as CronTarget] ?? r.target}</div>
                <div className="flex items-center gap-2">
                  <span className="tx-mu">{fmtAgo(r.started_at)}</span>
                  <Badge tone={r.status === 'success' ? 'ok' : r.status === 'error' ? 'er' : 'ac'}>{r.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Top productos por stock</h3>
          <Link to="/catalogo" className="chip">Ver catálogo</Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {(inv.data ?? []).slice(0, 8).map((x) => (
            <div key={x.sku} className="bg-sf bd rounded-lg p-3">
              <div className="text-xs mono tx-mu">{x.sku}</div>
              <div className="text-lg font-bold">{fmtNum(x.qty)}</div>
              <div className="text-[11px] tx-mu">{x.state}</div>
            </div>
          ))}
          {!inv.isLoading && (inv.data ?? []).length === 0 && <div className="tx-mu text-sm">Sin inventario.</div>}
        </div>
      </Card>
    </div>
  );
}
