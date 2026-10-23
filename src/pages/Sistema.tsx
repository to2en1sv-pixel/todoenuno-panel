import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { useHealth } from '@/hooks/useHealth';
import { TARGET_LABEL, TARGET_URL, type CronTarget } from '@/lib/endpoints';
import { fmtAgo } from '@/lib/format';

export function SistemaPage() {
  const health = useHealth();

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <h3 className="font-semibold text-sm mb-3">Conexión Supabase</h3>
        <div className="flex items-center justify-between py-2 border-b" style={{ borderColor: 'var(--bd)' }}>
          <span className="text-sm">Estado</span>
          <Badge tone={health.data?.supabase.ok ? 'ok' : 'er'}>
            {health.isLoading ? 'probando…' : health.data?.supabase.ok ? 'OK' : 'ERROR'}
          </Badge>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-sm">Latencia</span>
          <span className="mono text-sm">{health.data?.supabase.latency_ms ?? '—'} ms</span>
        </div>
        {health.data?.supabase.error && (
          <div className="text-xs mt-2" style={{ color: 'var(--er)' }}>{health.data.supabase.error}</div>
        )}
      </Card>

      <Card>
        <h3 className="font-semibold text-sm mb-3">Endpoints del cron externo</h3>
        <div className="flex flex-col gap-2">
          {(Object.keys(TARGET_URL) as CronTarget[]).map((t) => {
            const info = health.data?.crons.find((c) => c.target === t);
            return (
              <div key={t} className="py-2 border-b" style={{ borderColor: 'var(--bd)' }}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{TARGET_LABEL[t]}</div>
                    <div className="text-[11px] mono tx-mu truncate max-w-[300px]">{TARGET_URL[t]}</div>
                  </div>
                  <Badge tone={info?.fresh ? 'ok' : info?.last_success ? 'er' : 'neutral'}>
                    {info?.fresh ? 'fresco' : info?.last_success ? 'stale' : 'sin datos'}
                  </Badge>
                </div>
                {info?.last_success && (
                  <div className="text-[11px] tx-mu mt-1">Última exitosa: {fmtAgo(info.last_success)}</div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-sm mb-2">Variables de entorno del cliente</h3>
        <p className="text-xs tx-mu mb-3">
          Estas son las únicas variables que vive en el frontend (públicas). Los secretos
          (service role, cron secret) están en Vercel Env y NO se exponen aquí.
        </p>
        <div className="mono text-xs bg-sf bd rounded-lg p-3 whitespace-pre-wrap">
          VITE_SUPABASE_URL={import.meta.env.VITE_SUPABASE_URL?.slice(0, 50)}…
          {'\n'}VITE_SUPABASE_ANON_KEY={import.meta.env.VITE_SUPABASE_ANON_KEY ? '••••••••••••' : '(no definida)'}
          {'\n'}VITE_PANEL_TOKEN={import.meta.env.VITE_PANEL_TOKEN ? '••••••••' : '(no definida)'}
        </div>
      </Card>

      <Card>
        <h3 className="font-semibold text-sm mb-2">Recomendaciones de seguridad</h3>
        <ul className="text-xs tx-mu list-disc pl-5 space-y-1">
          <li>Activa <b>Deployment Protection</b> en Vercel (password de acceso al panel).</li>
          <li>Nunca pongas la <code>service_role</code> key en el bundle del cliente.</li>
          <li>El endpoint <code>/api/cron-run</code> está protegido por <code>x-panel-token</code>.</li>
          <li>Si rotas <code>CRONJOB_SECRET</code>, actualiza también el endpoint externo.</li>
        </ul>
      </Card>
    </div>
  );
}
