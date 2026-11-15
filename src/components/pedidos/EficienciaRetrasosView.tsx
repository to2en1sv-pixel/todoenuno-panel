import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Send,
  Settings2,
  Truck,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { emitOsEvent } from '@/lib/osEvents';
import {
  evaluateOrderSla,
  formatDurationCompact,
  getSvOffsetIso,
  getSvTodayIso,
  saveDispatchSlaSettings,
  type DispatchSlaSettings,
  type OrderSlaEvaluation,
} from '@/lib/dispatchSla';
import {
  formatFriendlySpanishDate,
  renderWhatsappTemplate,
  type OrderWhatsappTemplate,
} from '@/lib/whatsappTemplates';

export interface DelayOrderItem {
  id: string;
  pedido_codigo?: string | null;
  nombre_cliente: string | null;
  total: number | null;
  estado: string | null;
  created_at: string | null;
  sku: string | null;
  catalogo_sku?: string | null;
  telefono: string | null;
  direccion: string | null;
  metodo_pago: string | null;
  courier?: string | null;
  departamento?: string | null;
  fecha_programada?: string | null;
  es_encargo?: boolean | null;
  notas: string | null;
}

function money(v: number | null | undefined): string {
  const n = Number(v || 0);
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/* ------------------------------------------------------------------ */
/* MODAL: REPROGRAMAR ENTREGA & AVISAR POR EVOLUTION API              */
/* ------------------------------------------------------------------ */

interface DelayModalProps {
  pedido: DelayOrderItem;
  templates: OrderWhatsappTemplate[];
  onClose: () => void;
  onSentSuccess: (patch: {
    id: string;
    fecha_programada: string;
    notas: string;
    conversationId?: string;
  }) => void;
}

const MOTIVOS_DEMORA = [
  'Alta demanda en despacho',
  'Demora logística en ruta / clima',
  'Reasignación de motorista en zona',
  'Validación de dirección / horario',
];

export function DelayRescheduleModal({
  pedido,
  templates,
  onClose,
  onSentSuccess,
}: DelayModalProps) {
  const svTomorrow = getSvOffsetIso(1);
  const svDayAfter = getSvOffsetIso(2);
  const svThreeDays = getSvOffsetIso(3);

  const defaultDelayTpl = useMemo(
    () =>
      templates.find((t) => t.id === 'retraso_reprogramacion' && t.activo) ||
      templates.find((t) => t.id === 'reprogramar' && t.activo) ||
      templates.find((t) => t.activo && t.categoria !== 'repartidor') ||
      templates[0],
    [templates]
  );

  const [selectedTplId, setSelectedTplId] = useState<string>(defaultDelayTpl?.id || 'retraso_reprogramacion');
  const [nuevaFecha, setNuevaFecha] = useState<string>(() => {
    const existing = pedido.fecha_programada ? String(pedido.fecha_programada).slice(0, 10) : '';
    return existing && existing >= svTomorrow ? existing : svTomorrow;
  });
  const [motivoDemora, setMotivoDemora] = useState<string>(MOTIVOS_DEMORA[0]);
  const [pauseBot, setPauseBot] = useState<boolean>(false);
  const [customMessage, setCustomMessage] = useState<string>('');
  const [isEditedManually, setIsEditedManually] = useState<boolean>(false);
  const [sending, setSending] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ conversationId?: string } | null>(null);

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTplId) || defaultDelayTpl,
    [templates, selectedTplId, defaultDelayTpl]
  );

  const renderedPreview = useMemo(() => {
    const raw =
      activeTemplate?.mensaje ||
      '¡Hola {nombre}! 👋 Te escribimos de TODOENUNO respecto a tu pedido de *{producto}* ({total}). Tuvimos una demora operativa y reprogramaremos tu entrega para el *{nueva_fecha}*. ¿Nos confirmas si podrás recibirlo ese día en 📍 {direccion}?';
    return renderWhatsappTemplate(raw, pedido, { nueva_fecha: nuevaFecha });
  }, [activeTemplate, pedido, nuevaFecha]);

  useEffect(() => {
    if (!isEditedManually) {
      setCustomMessage(renderedPreview);
    }
  }, [renderedPreview, isEditedManually]);

  const finalMessage = (isEditedManually ? customMessage : renderedPreview).trim();
  const cleanPhone = String(pedido.telefono || '').replace(/\D/g, '');
  const waFallbackHref = `https://wa.me/${cleanPhone.length === 8 ? `503${cleanPhone}` : cleanPhone}?text=${encodeURIComponent(finalMessage)}`;

  const persistRescheduleOnOrder = async (via: 'evolution' | 'wa_me') => {
    const svToday = getSvTodayIso();
    const stamp = `[Aviso demora enviado ${svToday} -> Reprogramado ${nuevaFecha}]`;
    const motivoTag = motivoDemora.trim() ? `Motivo demora: ${motivoDemora.trim()}` : '';
    const existingNotas = String(pedido.notas || '').trim();
    const additions = [stamp, motivoTag].filter(Boolean).join(' · ');
    const nextNotas = existingNotas ? `${existingNotas}\n${additions}` : additions;

    const { error: updErr } = await supabase
      .from('whatsapp_orders')
      .update({
        fecha_programada: nuevaFecha,
        notas: nextNotas,
      })
      .eq('id', pedido.id);

    if (updErr) {
      console.warn('Error actualizando pedido reprogramado:', updErr);
    }

    try {
      await emitOsEvent({
        type: 'order.delay.notified',
        source_table: 'whatsapp_orders',
        source_id: pedido.id,
        payload: {
          order_id: pedido.id,
          pedido_codigo: pedido.pedido_codigo || pedido.id.slice(0, 8),
          cliente: pedido.nombre_cliente,
          telefono: pedido.telefono,
          nueva_fecha: nuevaFecha,
          motivo: motivoDemora,
          via,
        },
      });
    } catch {}

    return nextNotas;
  };

  const handleSendEvolution = async () => {
    if (!pedido.telefono || !cleanPhone) {
      setErrorMsg('Este pedido no tiene un teléfono de WhatsApp válido.');
      return;
    }
    if (!nuevaFecha) {
      setErrorMsg('Selecciona la nueva fecha de entrega.');
      return;
    }
    if (!finalMessage) {
      setErrorMsg('El mensaje no puede estar vacío.');
      return;
    }

    setSending(true);
    setErrorMsg(null);

    try {
      const resp = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactPhone: pedido.telefono,
          contactName: pedido.nombre_cliente || undefined,
          text: finalMessage,
          pauseBot,
        }),
      });

      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.success) {
        const detail = data?.details || data?.error || `Error HTTP ${resp.status}`;
        setErrorMsg(`No se pudo enviar por Evolution API: ${detail}`);
        setSending(false);
        return;
      }

      const nextNotas = await persistRescheduleOnOrder('evolution');
      setSuccessInfo({ conversationId: data?.conversationId });
      onSentSuccess({
        id: pedido.id,
        fecha_programada: nuevaFecha,
        notas: nextNotas,
        conversationId: data?.conversationId,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error de red enviando por Evolution API.');
    } finally {
      setSending(false);
    }
  };

  const handleManualFallbackClick = async () => {
    const nextNotas = await persistRescheduleOnOrder('wa_me');
    onSentSuccess({
      id: pedido.id,
      fecha_programada: nuevaFecha,
      notas: nextNotas,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl max-h-[92vh] flex flex-col rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
      >
        <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="p-2 rounded-xl bg-amber-500/15 text-amber-600 shrink-0">
              <Clock size={18} />
            </span>
            <div className="min-w-0">
              <h3 className="font-black text-sm truncate">
                Avisar Demora y Reprogramar — {pedido.nombre_cliente || 'Cliente'}
              </h3>
              <p className="text-[11px] tx-mu truncate">
                {pedido.pedido_codigo || `#${pedido.id.slice(0, 8).toUpperCase()}`} · {pedido.sku || 'Producto'} ·{' '}
                {money(pedido.total)} · Tel: {pedido.telefono || 'Sin teléfono'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-cd shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {successInfo ? (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center space-y-3">
              <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
              <div>
                <h4 className="font-black text-base text-emerald-700 dark:text-emerald-300">
                  ¡Aviso enviado por WhatsApp (Evolution API)!
                </h4>
                <p className="text-xs tx-mu mt-1">
                  El mensaje quedó registrado en el chat del cliente y el pedido fue reprogramado para el{' '}
                  <strong>{formatFriendlySpanishDate(nuevaFecha)}</strong> ({nuevaFecha}).
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                {successInfo.conversationId && (
                  <Link
                    to={`/unichat?chat=${encodeURIComponent(successInfo.conversationId)}`}
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <MessageCircle size={14} /> Ver conversación en UniChat
                  </Link>
                )}
                <button
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-bold"
                >
                  Cerrar
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Selector de Nueva Fecha */}
              <div className="space-y-2">
                <label className="text-[11px] font-black uppercase tracking-wider tx-mu flex items-center gap-1.5">
                  <Calendar size={13} className="text-amber-500" />
                  1. Nueva fecha tentativa de entrega
                </label>
                <div className="flex flex-wrap gap-2 items-center">
                  {[
                    { label: 'Mañana', iso: svTomorrow },
                    { label: 'Pasado mañana', iso: svDayAfter },
                    { label: '+3 días', iso: svThreeDays },
                  ].map((opt) => (
                    <button
                      key={opt.iso}
                      type="button"
                      onClick={() => setNuevaFecha(opt.iso)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                        nuevaFecha === opt.iso
                          ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                          : 'bg-sf border-[var(--bd)] hover:border-amber-500/40'
                      }`}
                    >
                      {opt.label} ({opt.iso.slice(5)})
                    </button>
                  ))}
                  <input
                    type="date"
                    value={nuevaFecha}
                    onChange={(e) => setNuevaFecha(e.target.value)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-sf border border-[var(--bd)] outline-none focus:border-amber-500"
                  />
                </div>
                <p className="text-[11px] tx-mu">
                  En el mensaje aparecerá como:{' '}
                  <strong className="text-[var(--tx)]">{formatFriendlySpanishDate(nuevaFecha)}</strong>
                </p>
              </div>

              {/* Motivo interno + Selector de Plantilla */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                    Motivo interno (nota del pedido)
                  </label>
                  <select
                    value={motivoDemora}
                    onChange={(e) => setMotivoDemora(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-sf border border-[var(--bd)] outline-none"
                  >
                    {MOTIVOS_DEMORA.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                    Plantilla base (editable en Sistema)
                  </label>
                  <select
                    value={selectedTplId}
                    onChange={(e) => {
                      setSelectedTplId(e.target.value);
                      setIsEditedManually(false);
                    }}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-sf border border-[var(--bd)] outline-none"
                  >
                    {templates
                      .filter((t) => t.activo && t.categoria !== 'repartidor')
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.titulo}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {/* Mensaje editable */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11px] font-black uppercase tracking-wider tx-mu">
                    2. Mensaje que se enviará por Evolution API
                  </label>
                  {isEditedManually && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditedManually(false);
                        setCustomMessage(renderedPreview);
                      }}
                      className="text-[11px] font-bold text-indigo-500 hover:underline"
                    >
                      Restaurar plantilla
                    </button>
                  )}
                </div>
                <textarea
                  rows={4}
                  value={isEditedManually ? customMessage : renderedPreview}
                  onChange={(e) => {
                    setIsEditedManually(true);
                    setCustomMessage(e.target.value);
                  }}
                  className="w-full p-3 rounded-xl text-xs bg-sf border border-[var(--bd)] focus:border-emerald-500 outline-none leading-relaxed"
                />
              </div>

              {/* Opción Bot Todd */}
              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-sf border border-[var(--bd)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={pauseBot}
                  onChange={(e) => setPauseBot(e.target.checked)}
                  className="mt-0.5 rounded accent-amber-500"
                />
                <div className="text-xs">
                  <span className="font-bold block">Pausar Bot Todd al enviar (pasar chat a Modo Humano)</span>
                  <span className="text-[11px] tx-mu">
                    Si lo dejas desmarcado, cuando el cliente responda &quot;Sí, ese día recibo&quot; Todd podrá seguir respondiéndole y actualizar la nota automáticamente.
                  </span>
                </div>
              </label>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 text-xs font-medium">
                  {errorMsg}
                </div>
              )}
            </>
          )}
        </div>

        {!successInfo && (
          <div className="p-4 border-t border-[var(--bd)] bg-sf flex flex-wrap items-center justify-between gap-2 shrink-0">
            <a
              href={waFallbackHref}
              target="_blank"
              rel="noreferrer"
              onClick={handleManualFallbackClick}
              className="px-3 py-2 rounded-xl border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-bold inline-flex items-center gap-1.5 tx-mu hover:text-[var(--tx)]"
              title="Respaldo manual por si Evolution API no está disponible"
            >
              <ExternalLink size={13} /> Respaldo wa.me
            </a>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded-xl border border-[var(--bd)] text-xs font-bold"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSendEvolution}
                disabled={sending}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-black inline-flex items-center gap-2 shadow-sm"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? 'Enviando por Evolution...' : 'Enviar Directo por WhatsApp'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SUBMÓDULO: EFICIENCIA OPERATIVA & RETRASOS DE PAQUETES             */
/* ------------------------------------------------------------------ */

interface EficienciaRetrasosViewProps {
  pedidos: DelayOrderItem[];
  slaSettings: DispatchSlaSettings;
  onUpdateSlaSettings: (next: DispatchSlaSettings) => void;
  onOpenDelayModal: (pedido: DelayOrderItem) => void;
  onCambiarEstadoDirecto: (pedido: DelayOrderItem, nuevoEstado: string) => void;
  nowMs: number;
}

type DelayFilter = 'pendientes_avisar' | 'todos_retrasados' | 'por_vencer' | 'notificados';

export function EficienciaRetrasosView({
  pedidos,
  slaSettings,
  onUpdateSlaSettings,
  onOpenDelayModal,
  onCambiarEstadoDirecto,
  nowMs,
}: EficienciaRetrasosViewProps) {
  const [filterTab, setFilterTab] = useState<DelayFilter>('pendientes_avisar');
  const [bodegaInput, setBodegaInput] = useState<number>(slaSettings.bodegaHours);
  const [rutaInput, setRutaInput] = useState<number>(slaSettings.rutaHours);
  const [savingSla, setSavingSla] = useState<boolean>(false);
  const [savedFeedback, setSavedFeedback] = useState<boolean>(false);

  useEffect(() => {
    setBodegaInput(slaSettings.bodegaHours);
    setRutaInput(slaSettings.rutaHours);
  }, [slaSettings]);

  const evaluated = useMemo(() => {
    const active: Array<{ pedido: DelayOrderItem; sla: OrderSlaEvaluation }> = [];
    const bodegaHoursList: number[] = [];
    const rutaHoursList: number[] = [];
    const courierBreakdown = new Map<
      string,
      { courier: string; activos: number; retrasados: number; montoRiesgo: number }
    >();

    for (const p of pedidos) {
      const sla = evaluateOrderSla(p, slaSettings, nowMs);
      if (sla.stageGroup === 'finalizado') continue;

      active.push({ pedido: p, sla });

      if (sla.stageGroup === 'bodega') {
        bodegaHoursList.push(sla.elapsedHours);
      } else if (sla.stageGroup === 'ruta') {
        rutaHoursList.push(sla.elapsedHours);
      }

      if (sla.severity !== 'scheduled_future') {
        const courierName = (p.courier || 'Sin asignar').trim();
        const cur = courierBreakdown.get(courierName) || {
          courier: courierName,
          activos: 0,
          retrasados: 0,
          montoRiesgo: 0,
        };
        cur.activos += 1;
        if (sla.severity === 'delayed') {
          cur.retrasados += 1;
          cur.montoRiesgo += Number(p.total) || 0;
        }
        courierBreakdown.set(courierName, cur);
      }
    }

    const delayedAll = active
      .filter((x) => x.sla.severity === 'delayed')
      .sort((a, b) => b.sla.elapsedHours - a.sla.elapsedHours);

    const pendingNotify = delayedAll.filter((x) => !x.sla.yaNotificado);
    const notifiedList = active
      .filter((x) => x.sla.yaNotificado)
      .sort((a, b) => b.sla.elapsedHours - a.sla.elapsedHours);
    const warningList = active
      .filter((x) => x.sla.severity === 'warning' && !x.sla.yaNotificado)
      .sort((a, b) => b.sla.elapsedHours - a.sla.elapsedHours);

    const evaluables = active.filter((x) => x.sla.severity !== 'scheduled_future');
    const onTimeCount = evaluables.filter((x) => x.sla.severity !== 'delayed').length;
    const slaCompliancePct =
      evaluables.length > 0 ? Math.round((onTimeCount / evaluables.length) * 100) : 100;

    const avgBodegaH =
      bodegaHoursList.length > 0
        ? bodegaHoursList.reduce((s, h) => s + h, 0) / bodegaHoursList.length
        : 0;
    const avgRutaH =
      rutaHoursList.length > 0
        ? rutaHoursList.reduce((s, h) => s + h, 0) / rutaHoursList.length
        : 0;

    const moneyAtRisk = delayedAll.reduce((s, x) => s + (Number(x.pedido.total) || 0), 0);

    return {
      delayedAll,
      pendingNotify,
      notifiedList,
      warningList,
      slaCompliancePct,
      evaluablesCount: evaluables.length,
      onTimeCount,
      avgBodegaH,
      avgRutaH,
      moneyAtRisk,
      couriers: Array.from(courierBreakdown.values()).sort(
        (a, b) => b.retrasados - a.retrasados || b.activos - a.activos
      ),
    };
  }, [pedidos, slaSettings, nowMs]);

  const handleSaveSla = async () => {
    setSavingSla(true);
    const saved = await saveDispatchSlaSettings({
      bodegaHours: bodegaInput,
      rutaHours: rutaInput,
    });
    onUpdateSlaSettings(saved);
    setSavingSla(false);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2200);
  };

  const visibleRows =
    filterTab === 'pendientes_avisar'
      ? evaluated.pendingNotify
      : filterTab === 'todos_retrasados'
      ? evaluated.delayedAll
      : filterTab === 'por_vencer'
      ? evaluated.warningList
      : evaluated.notifiedList;

  return (
    <div className="space-y-5">
      {/* 1. KPIs DE EFICIENCIA OPERATIVA + RELOJ CONFIGURABLE */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-[var(--bd)] bg-cd p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider tx-mu">
              Cumplimiento Reloj (SLA)
            </span>
            <CheckCircle2
              size={16}
              className={
                evaluated.slaCompliancePct >= 85
                  ? 'text-emerald-500'
                  : evaluated.slaCompliancePct >= 65
                  ? 'text-amber-500'
                  : 'text-rose-500'
              }
            />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span
              className={`text-3xl font-black font-mono ${
                evaluated.slaCompliancePct >= 85
                  ? 'text-emerald-600'
                  : evaluated.slaCompliancePct >= 65
                  ? 'text-amber-600'
                  : 'text-rose-600'
              }`}
            >
              {evaluated.slaCompliancePct}%
            </span>
            <span className="text-xs tx-mu">
              ({evaluated.onTimeCount}/{evaluated.evaluablesCount} activos en tiempo)
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-sf overflow-hidden">
            <div
              className={`h-full rounded-full ${
                evaluated.slaCompliancePct >= 85
                  ? 'bg-emerald-500'
                  : evaluated.slaCompliancePct >= 65
                  ? 'bg-amber-500'
                  : 'bg-rose-500'
              }`}
              style={{ width: `${evaluated.slaCompliancePct}%` }}
            />
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--bd)] bg-cd p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider tx-mu">
              Tiempo Promedio Activo
            </span>
            <Clock size={16} className="text-indigo-500" />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="p-2 rounded-xl bg-sf border border-[var(--bd)]">
              <span className="text-[10px] tx-mu block">Bodega</span>
              <span className="text-lg font-black font-mono">
                {formatDurationCompact(evaluated.avgBodegaH)}
              </span>
            </div>
            <div className="p-2 rounded-xl bg-sf border border-[var(--bd)]">
              <span className="text-[10px] tx-mu block">En Ruta</span>
              <span className="text-lg font-black font-mono">
                {formatDurationCompact(evaluated.avgRutaH)}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider text-rose-600">
              Paquetes con Retraso
            </span>
            <AlertTriangle size={16} className="text-rose-500" />
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <span className="text-3xl font-black font-mono text-rose-600">
              {evaluated.delayedAll.length}
            </span>
            <span className="text-sm font-black font-mono text-rose-600">
              {money(evaluated.moneyAtRisk)} en riesgo
            </span>
          </div>
          <p className="mt-1.5 text-[11px] tx-mu">
            <strong className="text-rose-600">{evaluated.pendingNotify.length} sin avisar</strong> ·{' '}
            {evaluated.notifiedList.length} ya notificados/reprogramados
          </p>
        </div>

        {/* Configuración rápida de Reloj SLA */}
        <div className="rounded-2xl border border-[var(--bd)] bg-cd p-4 shadow-sm space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-black uppercase tracking-wider tx-mu flex items-center gap-1">
              <Settings2 size={13} className="text-amber-500" /> Reloj de Despacho (SLA)
            </span>
            {savedFeedback && (
              <span className="text-[10px] font-bold text-emerald-600">✓ Guardado</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] tx-mu block">Límite Bodega (h)</label>
              <input
                type="number"
                min={4}
                max={168}
                value={bodegaInput}
                onChange={(e) => setBodegaInput(Number(e.target.value) || 24)}
                className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg bg-sf border border-[var(--bd)] text-xs font-mono font-bold"
              />
            </div>
            <div>
              <label className="text-[10px] tx-mu block">Límite Ruta (h)</label>
              <input
                type="number"
                min={6}
                max={240}
                value={rutaInput}
                onChange={(e) => setRutaInput(Number(e.target.value) || 36)}
                className="mt-0.5 w-full px-2.5 py-1.5 rounded-lg bg-sf border border-[var(--bd)] text-xs font-mono font-bold"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveSla}
            disabled={savingSla}
            className="w-full py-1.5 rounded-xl bg-sf hover:bg-amber-500 hover:text-white border border-[var(--bd)] text-[11px] font-bold transition-colors"
          >
            {savingSla ? 'Guardando...' : 'Aplicar tiempos'}
          </button>
        </div>
      </div>

      {/* 2. CUELLOS DE BOTELLA POR COURIER */}
      {evaluated.couriers.length > 0 && (
        <div className="rounded-2xl border border-[var(--bd)] bg-cd p-4 shadow-sm">
          <h3 className="text-xs font-black uppercase tracking-wider tx-mu flex items-center gap-1.5 mb-3">
            <Truck size={14} className="text-indigo-500" /> Eficiencia por Courier / Flota Activa
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {evaluated.couriers.map((c) => (
              <div
                key={c.courier}
                className={`p-3 rounded-xl border ${
                  c.retrasados > 0
                    ? 'bg-rose-500/5 border-rose-500/25'
                    : 'bg-sf border-[var(--bd)]'
                }`}
              >
                <div className="text-xs font-bold truncate">{c.courier}</div>
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span className="tx-mu">{c.activos} activos</span>
                  <span
                    className={`font-black font-mono ${
                      c.retrasados > 0 ? 'text-rose-600' : 'text-emerald-600'
                    }`}
                  >
                    {c.retrasados > 0 ? `${c.retrasados} atrasados` : 'Al día'}
                  </span>
                </div>
                {c.montoRiesgo > 0 && (
                  <div className="mt-0.5 text-[10px] font-mono text-rose-500">
                    {money(c.montoRiesgo)} en demora
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. BANDEJA ACCIONABLE DE RETRASOS Y REPROGRAMACIÓN */}
      <div className="rounded-2xl border border-[var(--bd)] bg-cd shadow-sm overflow-hidden">
        <div className="p-4 border-b border-[var(--bd)] bg-sf flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black flex items-center gap-2">
              <Clock size={16} className="text-rose-500" />
              Bandeja de Retrasos de Paquetes & Avisos por WhatsApp
            </h3>
            <p className="text-xs tx-mu mt-0.5">
              Los pedidos que superan el reloj prudencial aparecen aquí automáticamente para avisar demoras por Evolution API y reprogramar su entrega.
            </p>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {[
              {
                id: 'pendientes_avisar' as DelayFilter,
                label: 'Pendientes de avisar',
                count: evaluated.pendingNotify.length,
                badgeCls: 'bg-rose-600 text-white',
              },
              {
                id: 'todos_retrasados' as DelayFilter,
                label: 'Todos los retrasados',
                count: evaluated.delayedAll.length,
                badgeCls: 'bg-rose-500/15 text-rose-600',
              },
              {
                id: 'por_vencer' as DelayFilter,
                label: 'Por vencer',
                count: evaluated.warningList.length,
                badgeCls: 'bg-amber-500/15 text-amber-600',
              },
              {
                id: 'notificados' as DelayFilter,
                label: 'Ya avisados / Reprog.',
                count: evaluated.notifiedList.length,
                badgeCls: 'bg-emerald-500/15 text-emerald-600',
              },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterTab(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border flex items-center gap-1.5 transition-colors ${
                  filterTab === tab.id
                    ? 'bg-cd border-[var(--tx)] text-[var(--tx)] shadow-sm'
                    : 'bg-cd/40 border-[var(--bd)] tx-mu hover:text-[var(--tx)]'
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-black ${tab.badgeCls}`}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {visibleRows.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
            <p className="text-sm font-bold">
              {filterTab === 'pendientes_avisar'
                ? 'No tienes paquetes retrasados pendientes de avisar al cliente'
                : 'No hay paquetes en esta categoría'}
            </p>
            <p className="text-xs tx-mu">
              Reloj configurado: {slaSettings.bodegaHours}h máx. en bodega · {slaSettings.rutaHours}h máx. en ruta.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--bd)]">
            {visibleRows.map(({ pedido, sla }) => {
              const codigo = pedido.pedido_codigo || `#${pedido.id.slice(0, 8).toUpperCase()}`;
              const estado = String(pedido.estado || 'nuevo').toLowerCase();

              return (
                <div
                  key={pedido.id}
                  className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-sf/60 transition-colors"
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-sf border border-[var(--bd)]">
                        {codigo}
                      </span>
                      <span className="font-black text-sm truncate">
                        {pedido.nombre_cliente || 'Cliente sin nombre'}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black border ${
                          sla.severity === 'delayed'
                            ? 'bg-rose-500/15 text-rose-600 border-rose-500/30'
                            : sla.severity === 'warning'
                            ? 'bg-amber-500/15 text-amber-600 border-amber-500/30'
                            : 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
                        }`}
                      >
                        <Clock size={11} />
                        {sla.durationLabel} · {sla.stageGroup === 'ruta' ? 'En Ruta' : sla.stageGroup === 'programado' ? 'Encargo Vencido' : 'Bodega'}
                      </span>

                      {sla.yaNotificado && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
                          <CheckCircle2 size={11} />
                          Avisado{sla.reprogramadoPara ? ` · Reprog. ${sla.reprogramadoPara}` : ''}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tx-mu">
                      <span className="inline-flex items-center gap-1 font-medium text-[var(--tx)]">
                        <Package size={12} /> {pedido.sku || 'Sin producto'}
                      </span>
                      <span className="font-mono font-black text-emerald-600">
                        {money(pedido.total)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin size={12} /> {pedido.departamento || 'San Salvador'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Truck size={12} /> {pedido.courier || 'Motorista Central 1'}
                      </span>
                      <span>Tel: {pedido.telefono || '—'}</span>
                    </div>

                    {pedido.direccion && (
                      <p className="text-[11px] tx-mu truncate max-w-2xl">
                        📍 {pedido.direccion}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {(estado === 'nuevo' || estado === 'por_empacar' || estado === 'programado') && (
                      <button
                        type="button"
                        onClick={() => onCambiarEstadoDirecto(pedido, 'en_camino')}
                        className="px-3 py-2 rounded-xl border border-violet-500/30 bg-violet-500/10 hover:bg-violet-500/20 text-violet-600 dark:text-violet-300 text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        <Truck size={13} /> Pasar a Ruta
                      </button>
                    )}

                    {estado === 'en_camino' && (
                      <button
                        type="button"
                        onClick={() => onCambiarEstadoDirecto(pedido, 'entregado')}
                        className="px-3 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 text-xs font-bold inline-flex items-center gap-1.5"
                      >
                        <CheckCircle2 size={13} /> Marcar Entregado
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => onOpenDelayModal(pedido)}
                      className={`px-3.5 py-2 rounded-xl text-xs font-black inline-flex items-center gap-1.5 shadow-sm transition-colors ${
                        sla.yaNotificado
                          ? 'border border-[var(--bd)] bg-sf hover:bg-cd text-[var(--tx)]'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      }`}
                    >
                      <MessageCircle size={14} />
                      {sla.yaNotificado ? 'Re-avisar / Cambiar fecha' : 'Reprogramar y Avisar (WhatsApp)'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
