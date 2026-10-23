import { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { useCronRuns } from '@/hooks/useCronRuns';
import { useToast } from '@/components/Toast';
import { apiFetch } from '@/lib/api';
import { SCHEDULES, TARGET_LABEL, TARGET_URL, type CronTarget } from '@/lib/endpoints';
import { fmtAgo, fmtDate } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';

export function CronsPage() {
  const [target, setTarget] = useState<CronTarget | undefined>(undefined);
  const runs = useCronRuns(target, 100);
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<CronTarget | null>(null);

  async function trigger(t: CronTarget) {
    if (!confirm(`¿Ejecutar ahora "${TARGET_LABEL[t]}"?\n\nEsto llamará al endpoint real de producción.`)) return;
    setBusy(t);
    try {
      const res = await apiFetch<{ ok: boolean; http_status: number; message?: string }>('/api/cron-run', {
        method: 'POST',
        body: JSON.stringify({ target: t }),
      });
      toast.push(res.ok ? 'success' : 'error',
        `${TARGET_LABEL[t]} → ${res.http_status}${res.message ? ' • ' + res.message : ''}`);
      await qc.invalidateQueries({ queryKey: ['cron_runs'] });
      await qc.invalidateQueries({ queryKey: ['cron_last_by_target'] });
    } catch (e: unknown) {
      toast.push('error', (e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {(Object.keys(SCHEDULES) as CronTarget[]).map((t) => (
          <Card key={t}>
            <div className="flex justify-between items-start">
              <div>
                <div className="font-semibold text-sm">{TARGET_LABEL[t]}</div>
                <div className="text-[11px] mono tx-mu mt-0.5 truncate">{TARGET_URL[t]}</div>
              </div>
              <Badge tone="ac">{SCHEDULES[t].length}x/día</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {SCHEDULES[t].map((h) => <span key={h} className="chip mono">{h}</span>)}
            </div>
            <Button
              variant="primary"
              className="mt-3 w-full"
              disabled={busy === t}
              onClick={() => trigger(t)}
            >
              {busy === t ? 'Ejecutando…' : '▶ Ejecutar ahora'}
            </Button>
          </Card>
        ))}
      </div>

      <Card>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h3 className="font-semibold text-sm mr-auto">Historial de ejecuciones</h3>
          <button onClick={() => setTarget(undefined)} className="chip" style={!target ? { background: 'var(--tx)', color: 'var(--cd)', borderColor: 'var(--tx)' } : {}}>Todos</button>
          {(Object.keys(SCHEDULES) as CronTarget[]).map((t) => (
            <button key={t} onClick={() => setTarget(t)} className="chip"
              style={target === t ? { background: 'var(--tx)', color: 'var(--cd)', borderColor: 'var(--tx)' } : {}}>
              {TARGET_LABEL[t]}
            </button>
          ))}
        </div>

        {runs.isLoading && <Skeleton h={200} />}
        {!runs.isLoading && (runs.data ?? []).length === 0 && (
          <EmptyState title="Sin ejecuciones registradas" hint="Se poblará cuando el cron externo llame a los endpoints." />
        )}
        {(runs.data ?? []).length > 0 && (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left tx-mu mono text-[11px]">
                  <th className="py-2 px-2">Inicio</th>
                  <th>Endpoint</th>
                  <th>Origen</th>
                  <th>Estado</th>
                  <th>HTTP</th>
                  <th>Duración</th>
                  <th>Mensaje</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: 'var(--bd)' }}>
                    <td className="py-2 px-2 text-xs" title={fmtDate(r.started_at)}>{fmtAgo(r.started_at)}</td>
                    <td className="text-xs">{TARGET_LABEL[r.target as CronTarget] ?? r.target}</td>
                    <td className="mono text-[11px] tx-mu">{r.source}</td>
                    <td><Badge tone={r.status === 'success' ? 'ok' : r.status === 'error' ? 'er' : 'ac'}>{r.status}</Badge></td>
                    <td className="mono text-xs">{r.http_status ?? '—'}</td>
                    <td className="mono text-xs">{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</td>
                    <td className="text-xs tx-mu truncate max-w-[280px]">{r.message ?? '—'}</td>
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
