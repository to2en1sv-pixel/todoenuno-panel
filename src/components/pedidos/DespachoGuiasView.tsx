import { useMemo, useState, type ClipboardEvent, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera,
  CheckCircle2,
  CheckSquare,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Square,
  Trash2,
  Truck,
  Upload,
  X,
  ZoomIn,
} from 'lucide-react';
import { emitOsEvent } from '@/lib/osEvents';
import { renderWhatsappTemplate, type OrderWhatsappTemplate } from '@/lib/whatsappTemplates';

export interface DespachoOrderItem {
  id: string;
  pedido_codigo?: string | null;
  nombre_cliente: string | null;
  total: number | null;
  estado: string | null;
  created_at: string | null;
  sku: string | null;
  catalogo_sku?: string | null;
  codigo_anuncio?: string | null;
  items?: any;
  cantidad?: number | null;
  telefono: string | null;
  direccion: string | null;
  metodo_pago: string | null;
  courier?: string | null;
  departamento?: string | null;
  fecha_programada?: string | null;
  notas: string | null;
}

interface AttachedPhoto {
  dataUrl: string;
  fileName: string;
  sizeKb: number;
}

interface DespachoGuiasViewProps {
  pedidos: DespachoOrderItem[];
  templates: OrderWhatsappTemplate[];
  couriers: string[];
  onOrderDispatched: (patch: {
    id: string;
    nextEstado?: 'en_camino';
    notas: string;
  }) => Promise<void> | void;
  onChangeCourier?: (orderId: string, courier: string) => Promise<void> | void;
  onRefresh?: () => void;
}

type StageFilter = 'por_empacar' | 'en_camino' | 'todos_despacho';

function money(v: number | null | undefined): string {
  const n = Number(v || 0);
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizePhone(raw?: string | null): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? `503${digits}` : digits;
}

function hasPhotoNoticeSent(notas?: string | null): boolean {
  return /\[Foto gu[ií]a enviada/i.test(String(notas || ''));
}

function getSvDateTimeStamp(): string {
  try {
    return new Intl.DateTimeFormat('es-SV', {
      timeZone: 'America/El_Salvador',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 16).replace('T', ' ');
  }
}

async function compressImageFile(file: File): Promise<AttachedPhoto> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
      el.src = objectUrl;
    });

    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no soporta compresión de imagen.');
    ctx.drawImage(img, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (dataUrl.length > 1_400_000) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.68);
    }

    const base64Part = dataUrl.split(',')[1] || '';
    const sizeKb = Math.max(1, Math.round((base64Part.length * 0.75) / 1024));
    const cleanName = (file.name || 'paquete-guia').replace(/\.[a-z0-9]+$/i, '') + '.jpg';

    return { dataUrl, fileName: cleanName, sizeKb };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function DespachoGuiasView({
  pedidos,
  templates,
  couriers,
  onOrderDispatched,
  onChangeCourier,
  onRefresh,
}: DespachoGuiasViewProps) {
  const defaultTemplate = useMemo(
    () =>
      templates.find((t) => t.id === 'paquete_en_ruta' && t.activo) ||
      templates.find((t) => t.id === 'en_camino' && t.activo) ||
      templates.find((t) => t.activo && t.categoria !== 'repartidor') ||
      templates[0],
    [templates]
  );

  const [stageFilter, setStageFilter] = useState<StageFilter>('por_empacar');
  const [courierFilter, setCourierFilter] = useState<string>('Todos');
  const [search, setSearch] = useState<string>('');

  const [selectedTplId, setSelectedTplId] = useState<string>(defaultTemplate?.id || 'paquete_en_ruta');
  const [customTemplateText, setCustomTemplateText] = useState<string>('');
  const [isEditedManually, setIsEditedManually] = useState<boolean>(false);
  const [autoMoveToRoute, setAutoMoveToRoute] = useState<boolean>(true);
  const [pauseBot, setPauseBot] = useState<boolean>(false);

  const [photosByOrder, setPhotosByOrder] = useState<Record<string, AttachedPhoto>>({});
  const [guidesByOrder, setGuidesByOrder] = useState<Record<string, string>>({});
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [dragOverOrderId, setDragOverOrderId] = useState<string | null>(null);
  const [zoomPhoto, setZoomPhoto] = useState<{ title: string; url: string } | null>(null);

  const [sendingOrderId, setSendingOrderId] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{
    active: boolean;
    current: number;
    total: number;
    currentName: string;
    okCount: number;
    errCount: number;
  } | null>(null);
  const [rowFeedback, setRowFeedback] = useState<Record<string, { type: 'ok' | 'err'; text: string }>>({});

  const activeTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTplId) || defaultTemplate,
    [templates, selectedTplId, defaultTemplate]
  );

  const rawMessagePattern = isEditedManually
    ? customTemplateText
    : activeTemplate?.mensaje ||
      '¡Hola {nombre}! 📦 Tu pedido de *{producto}* ({total}) ya quedó empacado y salió en ruta con *{courier}*. Te compartimos foto de tu paquete con su guía para tu tranquilidad 🙌';

  const dispatchPool = useMemo(() => {
    return pedidos.filter((p) => {
      const est = String(p.estado || 'nuevo').toLowerCase();
      return est === 'por_empacar' || est === 'en_camino';
    });
  }, [pedidos]);

  const counts = useMemo(() => {
    const porEmpacar = dispatchPool.filter((p) => String(p.estado || '').toLowerCase() === 'por_empacar').length;
    const enCamino = dispatchPool.filter((p) => String(p.estado || '').toLowerCase() === 'en_camino').length;
    const withPhoto = dispatchPool.filter((p) => Boolean(photosByOrder[p.id])).length;
    return { porEmpacar, enCamino, withPhoto };
  }, [dispatchPool, photosByOrder]);

  const visibleOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return dispatchPool.filter((p) => {
      const est = String(p.estado || 'nuevo').toLowerCase();
      if (stageFilter === 'por_empacar' && est !== 'por_empacar') return false;
      if (stageFilter === 'en_camino' && est !== 'en_camino') return false;

      if (courierFilter !== 'Todos' && (p.courier || 'Motorista Central 1') !== courierFilter) {
        return false;
      }

      if (q) {
        const hay = [
          p.nombre_cliente,
          p.telefono,
          p.pedido_codigo,
          p.sku,
          p.catalogo_sku,
          p.direccion,
          p.departamento,
          p.courier,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [dispatchPool, stageFilter, courierFilter, search]);

  const readySelectedOrders = useMemo(
    () =>
      visibleOrders.filter(
        (o) => selectedIds[o.id] && Boolean(photosByOrder[o.id]) && Boolean(normalizePhone(o.telefono))
      ),
    [visibleOrders, selectedIds, photosByOrder]
  );

  const previewSampleOrder = readySelectedOrders[0] || visibleOrders[0] || null;
  const previewRenderedText = useMemo(() => {
    if (!previewSampleOrder) return rawMessagePattern;
    return renderWhatsappTemplate(rawMessagePattern, previewSampleOrder, {
      guia: guidesByOrder[previewSampleOrder.id] || undefined,
    });
  }, [rawMessagePattern, previewSampleOrder, guidesByOrder]);

  const handleAttachFile = async (orderId: string, file?: File | null) => {
    if (!file || !file.type.startsWith('image/')) {
      setRowFeedback((prev) => ({
        ...prev,
        [orderId]: { type: 'err', text: 'Selecciona un archivo de imagen válido (JPG/PNG).' },
      }));
      return;
    }

    try {
      const compressed = await compressImageFile(file);
      setPhotosByOrder((prev) => ({ ...prev, [orderId]: compressed }));
      setSelectedIds((prev) => ({ ...prev, [orderId]: true }));
      setRowFeedback((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    } catch (err: any) {
      setRowFeedback((prev) => ({
        ...prev,
        [orderId]: { type: 'err', text: err?.message || 'No se pudo procesar la foto.' },
      }));
    }
  };

  const handlePasteOnOrder = (orderId: string, e: ClipboardEvent<HTMLElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          e.preventDefault();
          void handleAttachFile(orderId, file);
          break;
        }
      }
    }
  };

  const handleDropOnOrder = (orderId: string, e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOverOrderId(null);
    const file = e.dataTransfer?.files?.[0];
    if (file) {
      void handleAttachFile(orderId, file);
    }
  };

  const sendSingleOrderPhoto = async (order: DespachoOrderItem): Promise<boolean> => {
    const photo = photosByOrder[order.id];
    const cleanPhone = normalizePhone(order.telefono);

    if (!photo) {
      setRowFeedback((prev) => ({
        ...prev,
        [order.id]: { type: 'err', text: 'Adjunta primero la foto del paquete con guía.' },
      }));
      return false;
    }
    if (!cleanPhone) {
      setRowFeedback((prev) => ({
        ...prev,
        [order.id]: { type: 'err', text: 'El pedido no tiene número de WhatsApp válido.' },
      }));
      return false;
    }

    const guia = (guidesByOrder[order.id] || '').trim();
    const messageText = renderWhatsappTemplate(rawMessagePattern, order, {
      guia: guia || undefined,
    });

    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactPhone: cleanPhone,
          contactName: order.nombre_cliente || cleanPhone,
          text: messageText,
          mediaBase64: photo.dataUrl,
          mediaType: 'image',
          fileName: photo.fileName,
          productSku: order.catalogo_sku || undefined,
          sendVideoAfterImage: false,
          pauseBot,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.details || data?.error || `HTTP ${res.status}`);
      }

      const stamp = `[Foto guía enviada ${getSvDateTimeStamp()}${guia ? ` · Guía: ${guia}` : ''}]`;
      const existingNotas = String(order.notas || '').trim();
      const nextNotas = existingNotas ? `${existingNotas}\n${stamp}` : stamp;
      const shouldMove =
        autoMoveToRoute && String(order.estado || '').toLowerCase() === 'por_empacar';

      await onOrderDispatched({
        id: order.id,
        nextEstado: shouldMove ? 'en_camino' : undefined,
        notas: nextNotas,
      });

      try {
        await emitOsEvent({
          type: 'order.dispatch.photo_sent',
          source_table: 'whatsapp_orders',
          source_id: order.id,
          payload: {
            order_id: order.id,
            pedido_codigo: order.pedido_codigo || order.id.slice(0, 8),
            cliente: order.nombre_cliente,
            courier: order.courier || 'Motorista Central 1',
            guia: guia || null,
            moved_to_route: shouldMove,
          },
        });
      } catch {}

      setSelectedIds((prev) => ({ ...prev, [order.id]: false }));
      setRowFeedback((prev) => ({
        ...prev,
        [order.id]: {
          type: 'ok',
          text: shouldMove
            ? 'Foto enviada por Evolution y pedido pasado a En Ruta.'
            : 'Foto y aviso enviados por Evolution.',
        },
      }));
      return true;
    } catch (err: any) {
      setRowFeedback((prev) => ({
        ...prev,
        [order.id]: {
          type: 'err',
          text: err?.message || 'Error enviando imagen por Evolution.',
        },
      }));
      return false;
    }
  };

  const handleSendSingle = async (order: DespachoOrderItem) => {
    setSendingOrderId(order.id);
    try {
      await sendSingleOrderPhoto(order);
    } finally {
      setSendingOrderId(null);
    }
  };

  const handleBatchSend = async () => {
    const queue = readySelectedOrders;
    if (queue.length === 0) return;

    let okCount = 0;
    let errCount = 0;

    setBatchProgress({
      active: true,
      current: 0,
      total: queue.length,
      currentName: queue[0]?.nombre_cliente || 'Cliente',
      okCount: 0,
      errCount: 0,
    });

    for (let i = 0; i < queue.length; i++) {
      const ord = queue[i];
      setBatchProgress({
        active: true,
        current: i + 1,
        total: queue.length,
        currentName: ord.nombre_cliente || ord.telefono || 'Cliente',
        okCount,
        errCount,
      });

      const ok = await sendSingleOrderPhoto(ord);
      if (ok) okCount += 1;
      else errCount += 1;

      if (i < queue.length - 1) {
        await new Promise((r) => setTimeout(r, 1400));
      }
    }

    setBatchProgress({
      active: false,
      current: queue.length,
      total: queue.length,
      currentName: 'Completado',
      okCount,
      errCount,
    });
  };

  const toggleSelectAllWithPhoto = () => {
    const withPhoto = visibleOrders.filter((o) => Boolean(photosByOrder[o.id]) && Boolean(normalizePhone(o.telefono)));
    if (withPhoto.length === 0) return;
    const allSelected = withPhoto.every((o) => Boolean(selectedIds[o.id]));
    const next = { ...selectedIds };
    for (const o of withPhoto) {
      next[o.id] = !allSelected;
    }
    setSelectedIds(next);
  };

  return (
    <div className="space-y-4">
      {/* KPIs enfocados de Despacho */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-cd bd rounded-2xl p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
            <Package size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider tx-mu">Por Empacar</p>
            <p className="text-lg font-black">{counts.porEmpacar}</p>
          </div>
        </div>

        <div className="bg-cd bd rounded-2xl p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 text-indigo-500 flex items-center justify-center shrink-0">
            <Truck size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider tx-mu">En Ruta</p>
            <p className="text-lg font-black">{counts.enCamino}</p>
          </div>
        </div>

        <div className="bg-cd bd rounded-2xl p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
            <Camera size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider tx-mu">Fotos Adjuntas</p>
            <p className="text-lg font-black">{counts.withPhoto}</p>
          </div>
        </div>

        <div className="bg-cd bd rounded-2xl p-3.5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center shrink-0">
            <Send size={18} />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider tx-mu">Listos en Lote</p>
            <p className="text-lg font-black">{readySelectedOrders.length}</p>
          </div>
        </div>
      </div>

      {/* Compositor compartido de mensaje + envío en lote */}
      <section className="bg-cd bd rounded-2xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 pb-3 border-b border-[var(--bd)]">
          <div>
            <h2 className="text-sm font-bold flex items-center gap-2">
              <Camera size={16} className="text-emerald-500" />
              Envío de Foto de Paquete + Guía por Evolution API
            </h2>
            <p className="text-[11px] tx-mu mt-0.5">
              Sube, arrastra o pega (<code className="mono">Ctrl+V</code>) la foto del paquete con guía en cada pedido. Se comprime automático y se envía como imagen con mensaje al cliente.
            </p>
          </div>
          <Link
            to="/sistema?tab=plantillas"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-sf bd hover:border-indigo-500 self-start"
          >
            <Settings2 size={12} /> Editar plantilla en Sistema
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          <div className="lg:col-span-7 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider tx-mu">
                Plantilla de aviso
              </label>
              <select
                value={selectedTplId}
                onChange={(e) => {
                  setSelectedTplId(e.target.value);
                  setIsEditedManually(false);
                }}
                className="bg-sf bd rounded-lg px-2.5 py-1 text-xs font-semibold outline-none focus:border-indigo-500"
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

            <textarea
              rows={3}
              value={rawMessagePattern}
              onChange={(e) => {
                setCustomTemplateText(e.target.value);
                setIsEditedManually(true);
              }}
              className="w-full bg-sf bd rounded-xl p-2.5 text-xs outline-none focus:border-emerald-500 resize-y"
              placeholder="Escribe el mensaje que acompañará la foto del paquete..."
            />

            <div className="flex flex-wrap items-center gap-3 text-[11px]">
              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none font-medium">
                <input
                  type="checkbox"
                  checked={autoMoveToRoute}
                  onChange={(e) => setAutoMoveToRoute(e.target.checked)}
                  className="rounded accent-emerald-600"
                />
                Pasar de <strong>Por Empacar ➔ En Ruta</strong> al enviar
              </label>

              <label className="inline-flex items-center gap-1.5 cursor-pointer select-none font-medium tx-mu">
                <input
                  type="checkbox"
                  checked={pauseBot}
                  onChange={(e) => setPauseBot(e.target.checked)}
                  className="rounded accent-indigo-600"
                />
                Pausar bot Todd después del envío
              </label>
            </div>
          </div>

          <div className="lg:col-span-5 bg-sf bd rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] font-bold tx-mu uppercase tracking-wider">
              <span>Vista previa ({previewSampleOrder?.nombre_cliente || 'Ejemplo'})</span>
              <span>Variables: {'{nombre}'}, {'{courier}'}, {'{guia}'}</span>
            </div>
            <p className="text-xs whitespace-pre-wrap leading-relaxed bg-cd bd rounded-lg p-2.5 max-h-24 overflow-y-auto">
              {previewRenderedText}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleBatchSend}
                disabled={readySelectedOrders.length === 0 || Boolean(batchProgress?.active)}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white text-xs font-bold shadow cursor-pointer transition-colors"
              >
                {batchProgress?.active ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Enviando {batchProgress.current}/{batchProgress.total}...
                  </>
                ) : (
                  <>
                    <Send size={14} />
                    Enviar Lote por Evolution ({readySelectedOrders.length})
                  </>
                )}
              </button>
            </div>

            {batchProgress && (
              <div className="text-[11px] font-semibold flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-cd bd">
                {batchProgress.active ? (
                  <span>
                    Enviando a <strong>{batchProgress.currentName}</strong>...
                  </span>
                ) : (
                  <span className="text-emerald-600 dark:text-emerald-400">
                    Lote terminado: {batchProgress.okCount} enviados · {batchProgress.errCount} errores
                  </span>
                )}
                {!batchProgress.active && (
                  <button
                    type="button"
                    onClick={() => setBatchProgress(null)}
                    className="tx-mu hover:text-[var(--tx)]"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Filtros de cola de despacho */}
      <div className="bg-cd bd rounded-2xl p-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: 'por_empacar' as StageFilter, label: `Por Empacar (${counts.porEmpacar})` },
            { id: 'en_camino' as StageFilter, label: `En Ruta (${counts.enCamino})` },
            { id: 'todos_despacho' as StageFilter, label: `Todos (${dispatchPool.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStageFilter(tab.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                stageFilter === tab.id
                  ? 'bg-emerald-600 text-white shadow'
                  : 'bg-sf bd tx-mu hover:text-[var(--tx)]'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <button
            type="button"
            onClick={toggleSelectAllWithPhoto}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-sf bd hover:border-emerald-500 flex items-center gap-1.5 cursor-pointer"
            title="Marcar/desmarcar todos los pedidos visibles que ya tienen foto"
          >
            <CheckSquare size={13} className="text-emerald-500" />
            Seleccionar con foto
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente, teléfono, código o SKU..."
              className="w-full bg-sf bd rounded-xl pl-8 pr-3 py-1.5 text-xs outline-none focus:border-emerald-500"
            />
          </div>

          <select
            value={courierFilter}
            onChange={(e) => setCourierFilter(e.target.value)}
            className="bg-sf bd rounded-xl px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-emerald-500"
          >
            <option value="Todos">Todos los Couriers</option>
            {couriers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="p-2 rounded-xl bg-sf bd hover:border-indigo-500 cursor-pointer"
              title="Recargar pedidos"
            >
              <RefreshCw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Lista de tarjetas de despacho con foto */}
      {visibleOrders.length === 0 ? (
        <div className="bg-cd bd rounded-2xl py-12 px-4 text-center space-y-2">
          <Package size={28} className="mx-auto opacity-30" />
          <p className="text-sm font-bold">No hay paquetes en esta vista de despacho</p>
          <p className="text-xs tx-mu">
            Cuando confirmes pedidos a <strong>Por Empacar</strong>, aparecerán aquí listos para tomarles foto con su guía y enviarlos por WhatsApp.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
          {visibleOrders.map((order) => {
            const photo = photosByOrder[order.id];
            const isSelected = Boolean(selectedIds[order.id]);
            const cleanPhone = normalizePhone(order.telefono);
            const alreadySent = hasPhotoNoticeSent(order.notas);
            const feedback = rowFeedback[order.id];
            const isSendingThis = sendingOrderId === order.id;
            const orderCode = order.pedido_codigo || order.id.slice(0, 8).toUpperCase();
            const isPorEmpacar = String(order.estado || '').toLowerCase() === 'por_empacar';
            const currentCourier = order.courier || couriers[0] || 'Motorista Central 1';

            return (
              <article
                key={order.id}
                onPaste={(e) => handlePasteOnOrder(order.id, e)}
                tabIndex={0}
                className={`bg-cd rounded-2xl border p-4 flex flex-col gap-3 transition-all outline-none focus-within:ring-2 focus-within:ring-emerald-500/30 ${
                  isSelected
                    ? 'border-emerald-500 shadow-sm'
                    : dragOverOrderId === order.id
                    ? 'border-indigo-500 bg-indigo-500/5'
                    : 'border-[var(--bd)]'
                }`}
              >
                {/* Fila superior: selección, cliente, estado y monto */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedIds((prev) => ({ ...prev, [order.id]: !prev[order.id] }))
                      }
                      className="mt-0.5 text-emerald-600 cursor-pointer shrink-0"
                      title="Seleccionar para envío en lote"
                    >
                      {isSelected ? <CheckSquare size={18} /> : <Square size={18} className="tx-mu" />}
                    </button>

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-black truncate">
                          {order.nombre_cliente || 'Cliente sin nombre'}
                        </span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sf bd tx-mu">
                          {orderCode}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            isPorEmpacar
                              ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                              : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400'
                          }`}
                        >
                          {isPorEmpacar ? 'Por Empacar' : 'En Ruta'}
                        </span>
                        {alreadySent && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                            <CheckCircle2 size={10} /> Foto enviada
                          </span>
                        )}
                      </div>

                      <div className="text-xs tx-mu mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span>📱 {order.telefono || 'Sin teléfono'}</span>
                        <span>📦 {order.sku || order.catalogo_sku || 'Producto'}</span>
                      </div>

                      {order.direccion && (
                        <div className="text-[11px] tx-mu mt-0.5 flex items-center gap-1 truncate">
                          <MapPin size={11} className="shrink-0" />
                          <span className="truncate">
                            {order.direccion}
                            {order.departamento ? ` · ${order.departamento}` : ''}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                      {money(order.total)}
                    </div>
                    <div className="text-[10px] tx-mu">{order.metodo_pago || 'Contra entrega'}</div>
                  </div>
                </div>

                {/* Zona de carga de foto + guía y courier */}
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-stretch">
                  {/* Dropzone / Preview */}
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragOverOrderId(order.id);
                    }}
                    onDragLeave={() => setDragOverOrderId(null)}
                    onDrop={(e) => handleDropOnOrder(order.id, e)}
                    className={`sm:col-span-6 rounded-xl border-2 border-dashed p-2.5 flex items-center justify-center min-h-[112px] transition-colors ${
                      photo
                        ? 'border-emerald-500/50 bg-emerald-500/5'
                        : dragOverOrderId === order.id
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-[var(--bd)] bg-sf'
                    }`}
                  >
                    {photo ? (
                      <div className="w-full flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setZoomPhoto({
                              title: `${order.nombre_cliente || orderCode} · ${photo.fileName}`,
                              url: photo.dataUrl,
                            })
                          }
                          className="relative group shrink-0 rounded-lg overflow-hidden border border-[var(--bd)] cursor-zoom-in"
                          title="Ampliar foto del paquete"
                        >
                          <img
                            src={photo.dataUrl}
                            alt="Foto paquete con guía"
                            className="w-20 h-20 object-cover"
                          />
                          <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white">
                            <ZoomIn size={16} />
                          </span>
                        </button>

                        <div className="flex-1 min-w-0 space-y-1.5">
                          <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                            <ImageIcon size={12} /> Foto lista ({photo.sizeKb} KB)
                          </div>
                          <p className="text-[10px] tx-mu truncate">{photo.fileName}</p>
                          <div className="flex items-center gap-1.5">
                            <label className="px-2 py-1 rounded-lg bg-cd bd text-[10px] font-semibold cursor-pointer hover:border-indigo-500">
                              Cambiar
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) void handleAttachFile(order.id, f);
                                  e.target.value = '';
                                }}
                              />
                            </label>
                            <button
                              type="button"
                              onClick={() => {
                                setPhotosByOrder((prev) => {
                                  const next = { ...prev };
                                  delete next[order.id];
                                  return next;
                                });
                                setSelectedIds((prev) => ({ ...prev, [order.id]: false }));
                              }}
                              className="p-1 rounded-lg bg-cd bd text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                              title="Quitar foto"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <label className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-center cursor-pointer py-1">
                        <div className="w-8 h-8 rounded-full bg-cd bd flex items-center justify-center text-emerald-500">
                          <Upload size={15} />
                        </div>
                        <span className="text-[11px] font-bold">
                          Subir foto paquete + guía
                        </span>
                        <span className="text-[10px] tx-mu">
                          Clic, arrastra o pega (<code className="mono">Ctrl+V</code>)
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleAttachFile(order.id, f);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>

                  {/* Courier + N° Guía + Enviar */}
                  <div className="sm:col-span-6 flex flex-col justify-between gap-2">
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider tx-mu block mb-1">
                          Courier / Motorista
                        </label>
                        <select
                          value={currentCourier}
                          onChange={(e) => {
                            if (onChangeCourier) {
                              void onChangeCourier(order.id, e.target.value);
                            }
                          }}
                          className="w-full bg-sf bd rounded-lg px-2.5 py-1.5 text-xs font-semibold outline-none focus:border-emerald-500"
                        >
                          {!couriers.includes(currentCourier) && (
                            <option value={currentCourier}>{currentCourier}</option>
                          )}
                          {couriers.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider tx-mu block mb-1">
                          N° de Guía (opcional · llena {'{guia}'})
                        </label>
                        <input
                          type="text"
                          value={guidesByOrder[order.id] || ''}
                          onChange={(e) =>
                            setGuidesByOrder((prev) => ({ ...prev, [order.id]: e.target.value }))
                          }
                          placeholder="Ej. SV-884210"
                          className="w-full bg-sf bd rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-emerald-500"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleSendSingle(order)}
                        disabled={!photo || !cleanPhone || isSendingThis || Boolean(batchProgress?.active)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white text-xs font-bold cursor-pointer transition-colors"
                      >
                        {isSendingThis ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            Enviando...
                          </>
                        ) : (
                          <>
                            <Send size={13} />
                            {isPorEmpacar && autoMoveToRoute
                              ? 'Enviar Foto y Pasar a Ruta'
                              : 'Enviar Foto por Evolution'}
                          </>
                        )}
                      </button>

                      {cleanPhone && (
                        <a
                          href={`https://wa.me/${cleanPhone}?text=${encodeURIComponent(
                            renderWhatsappTemplate(rawMessagePattern, order, {
                              guia: guidesByOrder[order.id] || undefined,
                            })
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2 rounded-xl bg-sf bd tx-mu hover:text-[var(--tx)] shrink-0"
                          title="Abrir chat manual en WhatsApp Web (solo texto)"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {feedback && (
                  <div
                    className={`text-[11px] font-semibold px-3 py-1.5 rounded-lg border ${
                      feedback.type === 'ok'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                        : 'bg-rose-500/10 border-rose-500/30 text-rose-500'
                    }`}
                  >
                    {feedback.text}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Modal de ampliación de foto */}
      {zoomPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setZoomPhoto(null)}
        >
          <div
            className="bg-cd bd rounded-2xl max-w-2xl w-full p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold truncate">{zoomPhoto.title}</h3>
              <button
                type="button"
                onClick={() => setZoomPhoto(null)}
                className="p-1.5 rounded-lg bg-sf bd cursor-pointer"
              >
                <X size={14} />
              </button>
            </div>
            <img
              src={zoomPhoto.url}
              alt={zoomPhoto.title}
              className="w-full max-h-[75vh] object-contain rounded-xl bg-black/40"
            />
          </div>
        </div>
      )}
    </div>
  );
}
