import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Flame,
  Layers,
  Loader2,
  MessageSquare,
  PackageX,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { fmtAgo } from '@/lib/format';
import { formatCurrency, formatNumber } from '@/lib/rentabilidad';

interface MetaAdAccountSafe {
  ad_account_id: string;
  account_name: string;
  page_id: string | null;
  currency: string;
  active: boolean;
  has_token: boolean;
  last_synced_at: string | null;
}

interface MetaAdInsightRow {
  ad_id: string;
  ad_name: string;
  campaign_name: string;
  account_name: string;
  page_id: string | null;
  codigo_anuncio: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  frequency: number;
  conversations: number;
  costPerMsg: number | null;
  totalOrders: number;
  deliveredOrders: number;
  totalSales: number;
  deliveredSales: number;
  cpaReal: number | null;
  roasBruto: number | null;
  roasCobrado: number | null;
  linkedSku: string | null;
  stockDisponible: number | null;
  stockAlert: boolean;
  fatigueAlert: boolean;
}

interface LiveReportResponse {
  ok: boolean;
  tableReady: boolean;
  connected: boolean;
  status: 'missing_table' | 'pending_tokens' | 'connected';
  accounts: MetaAdAccountSafe[];
  lastSyncedAt: string | null;
  range: { since: string; until: string; days: number };
  totals: {
    spend: number;
    conversations: number;
    totalOrders: number;
    deliveredOrders: number;
    totalSales: number;
    deliveredSales: number;
    stockAlerts: number;
    fatigueAlerts: number;
    costPerMsg: number | null;
    roasCobrado: number | null;
  };
  ads: MetaAdInsightRow[];
  error?: string;
}

interface Props {
  onSynced?: () => Promise<void> | void;
}

export function MetaAdsLiveView({ onSynced }: Props) {
  const [days, setDays] = useState<number>(7);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [report, setReport] = useState<LiveReportResponse | null>(null);
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const loadReport = useCallback(async (targetDays = days) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/meta-ads-sync?action=live_report&days=${targetDays}`);
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setReport({
          ok: false,
          tableReady: false,
          connected: false,
          status: 'pending_tokens',
          accounts: [],
          lastSyncedAt: null,
          range: { since: '', until: '', days: targetDays },
          totals: {
            spend: 0,
            conversations: 0,
            totalOrders: 0,
            deliveredOrders: 0,
            totalSales: 0,
            deliveredSales: 0,
            stockAlerts: 0,
            fatigueAlerts: 0,
            costPerMsg: null,
            roasCobrado: null,
          },
          ads: [],
        });
        return;
      }
      const data = (await res.json()) as LiveReportResponse;
      setReport(data);
    } catch (err: any) {
      setNotice({ type: 'err', text: err?.message || 'Error cargando reporte Meta Ads' });
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void loadReport(days);
  }, [days, loadReport]);

  const handleSyncNow = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/meta-ads-sync?action=sync&days=${days}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', days }),
      });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setNotice({
          type: 'err',
          text: 'Esta ruta requiere estar desplegada en Vercel (/api/meta-ads-sync).',
        });
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setNotice({ type: 'err', text: data?.error || 'Error sincronizando Meta Ads' });
      } else if (!data.connected) {
        setNotice({
          type: 'err',
          text: data.message || 'Falta agregar tus tokens de System User en Supabase (meta_ad_accounts).',
        });
      } else {
        setNotice({
          type: 'ok',
          text: `Sincronizado (${data.since} → ${data.until}): ${data.insightsCount} métricas de anuncios · ${data.syncedSpendRows} registros actualizados en gastos_publicidad.`,
        });
        await loadReport(days);
        if (onSynced) await onSynced();
      }
    } finally {
      setSyncing(false);
    }
  };

  const ads = report?.ads || [];
  const alertAds = ads.filter((a) => a.stockAlert || a.fatigueAlert);

  return (
    <div className="space-y-5">
      {/* CABECERA DE CONEXIÓN & SYNC */}
      <section className="bg-cd bd rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-sf text-[var(--tx)] border border-[var(--bd)]">
              <Zap size={12} /> Meta Marketing API · Cruce COD Real
            </span>

            {report?.connected ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 size={12} /> {report.accounts.filter((a) => a.active && a.has_token).length} Cuenta(s) Conectada(s)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                <AlertTriangle size={12} />
                {report?.status === 'missing_table'
                  ? 'Infraestructura lista · Falta ejecutar SQL en Supabase'
                  : 'Infraestructura lista · Pendiente de tokens'}
              </span>
            )}

            {report?.lastSyncedAt && (
              <span className="text-[11px] tx-mu font-mono tabular-nums">
                Último sync: {fmtAgo(report.lastSyncedAt)}
              </span>
            )}
          </div>
          <p className="text-xs tx-mu">
            Extrae gasto real, mensajes, CTR y frecuencia desde Meta Ads, alimenta <code className="font-mono">gastos_publicidad</code> y cruza contra pedidos <strong>entregados</strong> y stock en bodega.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            aria-label="Rango de días Meta Ads"
            className="px-3 py-2 rounded-lg bg-sf bd text-xs font-medium outline-none"
          >
            <option value={1}>Hoy</option>
            <option value={7}>Últimos 7 días</option>
            <option value={14}>Últimos 14 días</option>
            <option value={30}>Últimos 30 días</option>
          </select>

          <button
            type="button"
            onClick={() => loadReport(days)}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-cd bd text-xs font-medium inline-flex items-center gap-1.5 hover:bg-sf transition-colors cursor-pointer"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refrescar
          </button>

          <button
            type="button"
            onClick={handleSyncNow}
            disabled={syncing}
            className="px-3.5 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 disabled:opacity-50 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            {syncing ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
            {syncing ? 'Sincronizando...' : 'Sincronizar Meta Ads'}
          </button>
        </div>
      </section>

      {notice && (
        <div
          className="bg-cd bd rounded-xl px-4 py-3 text-xs font-medium"
          style={{
            borderColor: notice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
            color: notice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
          }}
        >
          {notice.text}
        </div>
      )}

      {/* BANNER ONBOARDING CUANDO AÚN NO SE CARGAN LOS TOKENS */}
      {!loading && report && !report.connected && (
        <section className="bg-cd bd rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 border-amber-500/30">
          <div className="space-y-1.5 max-w-2xl">
            <div className="text-sm font-semibold flex items-center gap-2">
              <ShieldCheck size={16} className="text-amber-500" />
              Conexión segura preparada (sin tokens expuestos en el navegador)
            </div>
            <p className="text-xs tx-mu leading-relaxed">
              Cuando generes tu <strong>System User Token</strong> en Meta Business Suite con los permisos{' '}
              <code className="font-mono">ads_read</code> y <code className="font-mono">read_insights</code>:
              1) crea las tablas protegidas por RLS con el SQL del módulo Sistema, y 2) inserta tu{' '}
              <code className="font-mono">ad_account_id</code> (<code className="font-mono">act_...</code>) y token directo en{' '}
              <code className="font-mono">meta_ad_accounts</code>. Al instante este tablero empezará a sincronizar tus gastos y ROAS cobrado.
            </p>
          </div>
          <Link
            to="/sistema?tab=diagnostico"
            className="px-3.5 py-2 rounded-lg bg-sf bd text-xs font-semibold inline-flex items-center gap-1.5 hover:border-[var(--tx)]/40 shrink-0"
          >
            Ver SQL y Monitor en Sistema <ExternalLink size={13} />
          </Link>
        </section>
      )}

      {/* KPIs EN VIVO */}
      <section className="bg-cd bd rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--bd)]">
        <div className="p-4">
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Gasto Meta ({days}d)</span>
            <TrendingUp size={14} className="tx-mu" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-2">
            {formatCurrency(report?.totals.spend || 0)}
          </div>
          <div className="text-xs tx-mu mt-0.5 tabular-nums">
            Sincronizado a gastos_publicidad
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Conversaciones Meta</span>
            <MessageSquare size={14} className="tx-mu" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-2">
            {formatNumber(report?.totals.conversations || 0)}
          </div>
          <div className="text-xs tx-mu mt-0.5 font-mono tabular-nums">
            {report?.totals.costPerMsg !== null && report?.totals.costPerMsg !== undefined
              ? `${formatCurrency(report.totals.costPerMsg)} / conversación`
              : 'Sin mensajes medidos aún'}
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>ROAS Cobrado Real</span>
            <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-2">
            {report?.totals.roasCobrado !== null && report?.totals.roasCobrado !== undefined
              ? `${report.totals.roasCobrado.toFixed(2)}x`
              : '—'}
          </div>
          <div className="text-xs tx-mu mt-0.5 font-mono tabular-nums">
            {formatCurrency(report?.totals.deliveredSales || 0)} entregados ({report?.totals.deliveredOrders || 0} ped.)
          </div>
        </div>

        <div className="p-4">
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Alertas Stock / Fatiga</span>
            <AlertTriangle
              size={14}
              className={(report?.totals.stockAlerts || 0) + (report?.totals.fatigueAlerts || 0) > 0 ? 'text-rose-600 dark:text-rose-400' : 'tx-mu'}
            />
          </div>
          <div className="text-2xl font-bold font-mono tabular-nums mt-2">
            {(report?.totals.stockAlerts || 0) + (report?.totals.fatigueAlerts || 0)}
          </div>
          <div className="text-xs tx-mu mt-0.5 font-mono tabular-nums">
            {report?.totals.stockAlerts || 0} stock 0 · {report?.totals.fatigueAlerts || 0} fatiga creativa
          </div>
        </div>
      </section>

      {/* PANEL DE ALERTAS INTELIGENTES (PAUTA EN STOCK 0 O FATIGA) */}
      {alertAds.length > 0 && (
        <section className="bg-cd bd rounded-xl p-4 space-y-2.5 border-rose-500/30">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <Flame size={14} /> Alertas de Fuga de Presupuesto ({alertAds.length})
            </h3>
            <Link to="/cola" className="text-xs font-semibold hover:underline text-[var(--tx)]">
              Renovar creativos en Bodega →
            </Link>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {alertAds.map((a) => (
              <div key={a.ad_id || a.ad_name} className="p-3 rounded-lg bg-sf bd flex items-start justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{a.ad_name}</div>
                  <div className="text-[11px] tx-mu font-mono tabular-nums">
                    Código: {a.codigo_anuncio} · Gasto: {formatCurrency(a.spend)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {a.stockAlert && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold text-[10px]">
                      <PackageX size={11} /> Stock 0 ({a.linkedSku})
                    </span>
                  )}
                  {a.fatigueAlert && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold text-[10px]">
                      <Flame size={11} /> Fatiga (Frec. {a.frequency}x)
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* TABLA DETALLADA POR ANUNCIO CRUZADO CON PEDIDOS REALES */}
      <section className="bg-cd bd rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--bd)] flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold">Rendimiento por Anuncio (Meta Ads × Entregas COD)</h3>
            <p className="text-[11px] tx-mu">
              Incluye códigos detectados en nombres tipo <code className="mono">[CODIGO]</code> o <code className="mono">SKU | Título</code> para cruzar automáticamente con pedidos.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="p-10 text-center text-xs tx-mu">Consultando cruce Meta Ads...</div>
        ) : ads.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Layers size={28} className="mx-auto tx-mu" />
            <div className="text-sm font-bold">Sin datos sincronizados para este rango</div>
            <p className="text-xs tx-mu max-w-md mx-auto">
              Una vez cargues tu cuenta publicitaria y token en <code className="mono">meta_ad_accounts</code>, presiona <strong>Sincronizar Meta Ads</strong> para ver cada anuncio cruzado con tus entregas reales.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-[var(--bd)] text-xs">
              <thead className="bg-sf text-[11px] uppercase tx-mu">
                <tr>
                  <th className="px-4 py-3 text-left font-bold">Anuncio / Campaña</th>
                  <th className="px-4 py-3 text-left font-bold">Código</th>
                  <th className="px-4 py-3 text-right font-bold">Gasto</th>
                  <th className="px-4 py-3 text-right font-bold">Msgs ($/msg)</th>
                  <th className="px-4 py-3 text-right font-bold">Pedidos / Entregados</th>
                  <th className="px-4 py-3 text-right font-bold">ROAS Cobrado</th>
                  <th className="px-4 py-3 text-right font-bold">Frec. / CTR</th>
                  <th className="px-4 py-3 text-center font-bold">Salud</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {ads.map((a) => (
                  <tr key={a.ad_id || `${a.account_name}-${a.ad_name}`} className="hover:bg-sf/60">
                    <td className="px-4 py-3 max-w-xs">
                      <div className="font-bold truncate">{a.ad_name}</div>
                      <div className="text-[11px] tx-mu truncate">
                        {a.campaign_name} · {a.account_name}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold">
                      {a.codigo_anuncio}
                      {a.linkedSku && (
                        <span className="block text-[10px] tx-mu font-normal">
                          Stock: {a.stockDisponible ?? '—'} uds
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold">
                      {formatCurrency(a.spend)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {formatNumber(a.conversations)}
                      <span className="block text-[10px] tx-mu">
                        {a.costPerMsg !== null ? `${formatCurrency(a.costPerMsg)}/msg` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {a.totalOrders} / <strong className="text-emerald-600">{a.deliveredOrders}</strong>
                      <span className="block text-[10px] tx-mu">
                        {formatCurrency(a.deliveredSales)} cobr.
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-black">
                      <span
                        className={
                          a.roasCobrado === null
                            ? 'tx-mu'
                            : a.roasCobrado >= 3
                              ? 'text-emerald-600'
                              : a.roasCobrado < 1
                                ? 'text-rose-600'
                                : 'text-amber-600'
                        }
                      >
                        {a.roasCobrado !== null ? `${a.roasCobrado.toFixed(2)}x` : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {a.frequency.toFixed(1)}x
                      <span className="block text-[10px] tx-mu">{a.ctr.toFixed(2)}% CTR</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {a.stockAlert ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/10 text-rose-600 dark:text-rose-400">
                          Stock 0
                        </span>
                      ) : a.fatigueAlert ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400">
                          Fatiga
                        </span>
                      ) : a.roasCobrado !== null && a.roasCobrado >= 3 ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          Escalando
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-sf bd tx-mu">
                          Activo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
