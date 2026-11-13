import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProductos } from '@/hooks/useCatalog';
import { supabase } from '@/lib/supabase';
import { EventStreamViewer } from '@/components/events/EventStreamViewer';
import {
  DEFAULT_ORDER_WA_TEMPLATES,
  WA_TEMPLATE_VARIABLES,
  fetchOrderWhatsappTemplates,
  renderWhatsappTemplate,
  saveOrderWhatsappTemplates,
  type OrderTemplateCategory,
  type OrderWhatsappTemplate,
} from '@/lib/whatsappTemplates';
import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  Clock,
  Code,
  Copy,
  Database,
  ExternalLink,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';

type CronJob = {
  id: string;
  title: string;
  url: string;
  lastStatus: number;
  lastStatusText: string;
  lastExecution: number;
  nextExecution: number;
};

type TableHealth = {
  table: string;
  label: string;
  count: number | null;
  ms: number;
  ok: boolean;
  error?: string;
};

type SistemaTab = 'plantillas' | 'stream' | 'diagnostico' | 'architecture';

function resolveTabParam(raw: string | null): SistemaTab {
  if (raw === 'plantillas') return 'plantillas';
  if (raw === 'diagnostico' || raw === 'crons') return 'diagnostico';
  if (raw === 'architecture') return 'architecture';
  if (raw === 'stream') return 'stream';
  return 'plantillas';
}

export function SistemaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SistemaTab>(() =>
    resolveTabParam(searchParams.get('tab'))
  );

  useEffect(() => {
    const paramTab = searchParams.get('tab');
    if (paramTab) {
      setActiveTab(resolveTabParam(paramTab));
    }
  }, [searchParams]);

  const handleTabChange = (tab: SistemaTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  /* ------------------------------------------------------------------ */
  /* 1. Estado del Editor de Plantillas WhatsApp                        */
  /* ------------------------------------------------------------------ */
  const [templates, setTemplates] = useState<OrderWhatsappTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [templateSource, setTemplateSource] = useState<'supabase' | 'local'>('supabase');
  const [selectedTplId, setSelectedTplId] = useState<string>('confirmacion');
  const [savingTemplates, setSavingTemplates] = useState(false);
  const [hasUnsavedTpl, setHasUnsavedTpl] = useState(false);
  const [tplNotice, setTplNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [confirmDeleteTplId, setConfirmDeleteTplId] = useState<string | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);

  // Datos de muestra editables para previsualización en vivo
  const [sampleOrder, setSampleOrder] = useState({
    nombre_cliente: 'Tatiana Gómez',
    sku: 'Asistente de bebé (Rosado)',
    total: 15,
    direccion: 'Residencial Pasadena, San Miguel',
    departamento: 'San Miguel',
    courier: 'Motorista Central 1',
    fecha_programada: '2026-11-15',
    metodo_pago: 'Contra entrega',
    telefono: '60744809',
    pedido_codigo: 'PED-1042',
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const showTplNotice = useCallback((type: 'ok' | 'err', text: string) => {
    setTplNotice({ type, text });
    setTimeout(() => {
      setTplNotice((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  useEffect(() => {
    let active = true;
    setLoadingTemplates(true);
    fetchOrderWhatsappTemplates()
      .then(({ templates: loaded, source }) => {
        if (!active) return;
        setTemplates(loaded);
        setTemplateSource(source);
        setSelectedTplId((prev) =>
          loaded.some((t) => t.id === prev) ? prev : loaded[0]?.id || 'confirmacion'
        );
      })
      .finally(() => {
        if (active) setLoadingTemplates(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTplId) || templates[0] || null,
    [templates, selectedTplId]
  );

  const updateSelectedTemplate = (patch: Partial<OrderWhatsappTemplate>) => {
    if (!selectedTemplate) return;
    setTemplates((prev) =>
      prev.map((t) => (t.id === selectedTemplate.id ? { ...t, ...patch } : t))
    );
    setHasUnsavedTpl(true);
  };

  const insertVariableAtCursor = (token: string) => {
    if (!selectedTemplate) return;
    const el = textareaRef.current;
    const current = selectedTemplate.mensaje || '';
    if (!el) {
      updateSelectedTemplate({ mensaje: `${current}${current ? ' ' : ''}${token}` });
      return;
    }
    const start = el.selectionStart ?? current.length;
    const end = el.selectionEnd ?? current.length;
    const next = current.slice(0, start) + token + current.slice(end);
    updateSelectedTemplate({ mensaje: next });
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    }, 10);
  };

  const handleSaveTemplates = async () => {
    setSavingTemplates(true);
    try {
      const res = await saveOrderWhatsappTemplates(templates);
      setTemplateSource(res.source);
      setHasUnsavedTpl(false);
      if (res.source === 'supabase') {
        showTplNotice('ok', 'Plantillas guardadas en Supabase y sincronizadas con Pedidos y Repartidor.');
      } else {
        showTplNotice(
          'ok',
          'Plantillas guardadas localmente (verifica conexión Supabase si deseas respaldo en la nube).'
        );
      }
    } finally {
      setSavingTemplates(false);
    }
  };

  const handleAddTemplate = () => {
    const newId = `custom_${Date.now()}`;
    const nueva: OrderWhatsappTemplate = {
      id: newId,
      titulo: 'Nueva plantilla personalizada',
      etiquetaBoton: 'Enviar Mensaje',
      categoria: 'pedidos',
      descripcion: 'Plantilla personalizada visible en el modal de Pedidos.',
      mensaje:
        '¡Hola {nombre}! 👋 Te escribimos de TODOENUNO respecto a tu pedido de *{producto}* ({total}).',
      activo: true,
      isDefault: false,
    };
    setTemplates((prev) => [...prev, nueva]);
    setSelectedTplId(newId);
    setHasUnsavedTpl(true);
  };

  const handleResetDefaultTemplate = () => {
    if (!selectedTemplate) return;
    const def = DEFAULT_ORDER_WA_TEMPLATES.find((d) => d.id === selectedTemplate.id);
    if (!def) return;
    setTemplates((prev) =>
      prev.map((t) => (t.id === def.id ? { ...def } : t))
    );
    setHasUnsavedTpl(true);
    showTplNotice('ok', 'Texto restaurado al original. Pulsa Guardar para aplicarlo.');
  };

  const handleDeleteCustomTemplate = async (id: string) => {
    const next = templates.filter((t) => t.id !== id);
    setTemplates(next);
    setConfirmDeleteTplId(null);
    if (selectedTplId === id && next[0]) {
      setSelectedTplId(next[0].id);
    }
    setSavingTemplates(true);
    try {
      const res = await saveOrderWhatsappTemplates(next);
      setTemplateSource(res.source);
      setHasUnsavedTpl(false);
      showTplNotice('ok', 'Plantilla eliminada.');
    } finally {
      setSavingTemplates(false);
    }
  };

  const liveRenderedPreview = useMemo(() => {
    if (!selectedTemplate) return '';
    return renderWhatsappTemplate(selectedTemplate.mensaje, sampleOrder);
  }, [selectedTemplate, sampleOrder]);

  /* ------------------------------------------------------------------ */
  /* 2. Diagnóstico, Crons & Salud Real                                 */
  /* ------------------------------------------------------------------ */
  const productos = useProductos();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isCheckingCrons, setIsCheckingCrons] = useState(false);
  const [cronError, setCronError] = useState('');

  const [tableHealth, setTableHealth] = useState<TableHealth[]>([]);
  const [checkingTables, setCheckingTables] = useState(false);
  const [toddBridgeOk, setToddBridgeOk] = useState<{ ok: boolean; detail: string } | null>(null);

  const checkCrons = useCallback(async () => {
    setIsCheckingCrons(true);
    setCronError('');
    try {
      const res = await fetch('/api/cron-status');
      const textResponse = await res.text();
      let data: any;
      try {
        data = JSON.parse(textResponse);
      } catch {
        throw new Error('El endpoint /api/cron-status no devolvió JSON válido.');
      }
      if (!res.ok) throw new Error(data.details || data.error || 'Error en el servidor');
      setJobs(data.jobs || []);
    } catch (err: any) {
      setCronError(err.message);
    } finally {
      setIsCheckingCrons(false);
    }
  }, []);

  const runSystemHealthCheck = useCallback(async () => {
    setCheckingTables(true);
    const tablesToProbe = [
      { table: 'whatsapp_orders', label: 'Pedidos COD' },
      { table: 'inventory_stock', label: 'Inventario & Stock' },
      { table: 'bb_conversations', label: 'Chats WhatsApp' },
      { table: 'post_queue', label: 'Cola Social' },
      { table: 'panel_docs', label: 'Docs & Config' },
      { table: 'fb_leads', label: 'Leads Facebook' },
    ];

    try {
      const results = await Promise.all(
        tablesToProbe.map(async ({ table, label }) => {
          const t0 = performance.now();
          const { count, error } = await supabase
            .from(table)
            .select('*', { count: 'exact', head: true });
          const ms = Math.round(performance.now() - t0);
          return {
            table,
            label,
            count: error ? null : count ?? 0,
            ms,
            ok: !error,
            error: error?.message,
          } satisfies TableHealth;
        })
      );
      setTableHealth(results);

      try {
        const res = await fetch('/api/todd-bridge?action=workflow');
        setToddBridgeOk({
          ok: res.ok,
          detail: res.ok ? 'Bridge Todd v2 operativo' : `HTTP ${res.status}`,
        });
      } catch {
        setToddBridgeOk({ ok: false, detail: 'Sin respuesta del endpoint' });
      }
    } finally {
      setCheckingTables(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'diagnostico') {
      void checkCrons();
      void runSystemHealthCheck();
    }
  }, [activeTab, checkCrons, runSystemHealthCheck]);

  const fmtTime = (ts: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 pb-12">
      {/* ENCABEZADO GENERAL */}
      <section className="flex flex-col lg:flex-row justify-between items-start lg:items-center bg-cd p-5 rounded-2xl bd gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Server size={20} style={{ color: 'var(--ac)' }} className="shrink-0" />
            <h1 className="text-lg sm:text-xl font-bold tracking-tight">
              Sistema, Plantillas & Diagnóstico
            </h1>
          </div>
          <p className="text-xs tx-mu mt-1">
            Personaliza los mensajes WhatsApp de Pedidos/Repartidor, monitorea tablas, crons y eventos del sistema.
          </p>
        </div>

        {/* Selector de Pestañas */}
        <div className="flex items-center p-1 bg-sf rounded-xl bd w-full lg:w-auto overflow-x-auto">
          <button
            type="button"
            onClick={() => handleTabChange('plantillas')}
            className={`flex-1 lg:flex-none px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'plantillas' ? 'bg-cd bd' : 'tx-mu hover:text-[var(--tx)]'
            }`}
          >
            <MessageSquare size={14} style={{ color: activeTab === 'plantillas' ? 'var(--ac)' : undefined }} />
            Plantillas WhatsApp
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('diagnostico')}
            className={`flex-1 lg:flex-none px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'diagnostico' ? 'bg-cd bd' : 'tx-mu hover:text-[var(--tx)]'
            }`}
          >
            <Activity size={14} />
            Salud & Crons
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('stream')}
            className={`flex-1 lg:flex-none px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'stream' ? 'bg-cd bd' : 'tx-mu hover:text-[var(--tx)]'
            }`}
          >
            <Radio size={14} style={{ color: activeTab === 'stream' ? 'var(--ok)' : undefined }} />
            Event Stream
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('architecture')}
            className={`flex-1 lg:flex-none px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'architecture' ? 'bg-cd bd' : 'tx-mu hover:text-[var(--tx)]'
            }`}
          >
            <Layers size={14} />
            Arquitectura
          </button>
        </div>
      </section>

      {/* ================================================================== */}
      {/* PESTAÑA 1: EDITOR DE PLANTILLAS WHATSAPP (PEDIDOS & REPARTIDOR)   */}
      {/* ================================================================== */}
      {activeTab === 'plantillas' && (
        <div className="flex flex-col gap-4">
          {tplNotice && (
            <div
              className="bg-cd bd rounded-xl px-4 py-3 text-xs font-medium flex items-center justify-between gap-2"
              style={{
                borderColor: tplNotice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
                color: tplNotice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
              }}
            >
              <span>{tplNotice.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Lista de plantillas */}
            <aside className="lg:col-span-4 bg-cd bd rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Plantillas registradas</h2>
                  <p className="text-[11px] tx-mu">
                    Origen: {templateSource === 'supabase' ? 'Nube (Supabase)' : 'Respaldo local'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddTemplate}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer shrink-0"
                  style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                >
                  <Plus size={13} />
                  Nueva
                </button>
              </div>

              {loadingTemplates ? (
                <div className="py-8 text-center text-xs tx-mu">Cargando plantillas...</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {templates.map((tpl) => {
                    const active = tpl.id === selectedTemplate?.id;
                    return (
                      <button
                        key={tpl.id}
                        type="button"
                        onClick={() => {
                          setSelectedTplId(tpl.id);
                          setConfirmDeleteTplId(null);
                        }}
                        className={`text-left p-3 rounded-xl bd transition-colors cursor-pointer ${
                          active ? 'bg-sf border-[var(--ac)]' : 'bg-cd hover:bg-sf/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold truncate">{tpl.titulo}</span>
                          <span
                            className="text-[11px] font-medium shrink-0"
                            style={{ color: tpl.activo ? 'var(--ok)' : 'var(--mu)' }}
                          >
                            {tpl.activo ? 'Activa' : 'Pausada'}
                          </span>
                        </div>
                        <div className="text-[11px] tx-mu mt-1 truncate">
                          {tpl.categoria === 'repartidor'
                            ? 'Uso: Panel Repartidor'
                            : 'Uso: Modal Pedidos'}
                          {' · '}
                          {tpl.etiquetaBoton}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="pt-2 border-t border-[var(--bd)] text-[11px] tx-mu flex items-center justify-between">
                <span>Los cambios se reflejan al instante en:</span>
                <Link to="/pedidos" className="font-semibold hover:underline" style={{ color: 'var(--ac)' }}>
                  Pedidos →
                </Link>
              </div>
            </aside>

            {/* Editor + Vista Previa */}
            <div className="lg:col-span-8 bg-cd bd rounded-2xl p-5 flex flex-col gap-4">
              {!selectedTemplate ? (
                <div className="py-10 text-center text-xs tx-mu">
                  Selecciona una plantilla de la izquierda para editarla.
                </div>
              ) : (
                <>
                  {/* Cabecera Editor */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--bd)]">
                    <div className="min-w-0">
                      <h2 className="text-sm font-bold truncate">{selectedTemplate.titulo}</h2>
                      <p className="text-xs tx-mu mt-0.5">
                        {selectedTemplate.descripcion || 'Edita el mensaje y las variables dinámicas.'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      {selectedTemplate.isDefault ? (
                        <button
                          type="button"
                          onClick={handleResetDefaultTemplate}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-sf bd text-xs font-medium hover:border-[var(--ac)] cursor-pointer"
                        >
                          <RotateCcw size={13} />
                          Restaurar original
                        </button>
                      ) : confirmDeleteTplId === selectedTemplate.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleDeleteCustomTemplate(selectedTemplate.id)}
                            className="px-3 py-2 rounded-xl text-xs font-semibold text-white cursor-pointer"
                            style={{ background: 'var(--er)' }}
                          >
                            Confirmar borrado
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteTplId(null)}
                            className="px-2.5 py-2 rounded-xl bg-sf bd text-xs cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteTplId(selectedTemplate.id)}
                          className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-sf bd text-xs font-medium cursor-pointer"
                          style={{ color: 'var(--er)' }}
                        >
                          <Trash2 size={13} />
                          Eliminar
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={savingTemplates}
                        onClick={handleSaveTemplates}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer disabled:opacity-50"
                        style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                      >
                        {savingTemplates ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Save size={13} />
                        )}
                        {hasUnsavedTpl ? 'Guardar cambios' : 'Guardado'}
                      </button>
                    </div>
                  </div>

                  {/* Campos de configuración */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium mb-1">Título de la plantilla</label>
                      <input
                        value={selectedTemplate.titulo}
                        onChange={(e) => updateSelectedTemplate({ titulo: e.target.value })}
                        className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium mb-1">Texto del botón</label>
                      <input
                        value={selectedTemplate.etiquetaBoton}
                        onChange={(e) => updateSelectedTemplate({ etiquetaBoton: e.target.value })}
                        className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium">Ubicación:</label>
                      <select
                        value={selectedTemplate.categoria}
                        disabled={selectedTemplate.id === 'repartidor_llegando'}
                        onChange={(e) =>
                          updateSelectedTemplate({
                            categoria: e.target.value as OrderTemplateCategory,
                          })
                        }
                        className="bg-sf bd rounded-xl px-3 py-1.5 text-xs outline-none focus:border-[var(--ac)] disabled:opacity-60"
                      >
                        <option value="pedidos">Modal WhatsApp en Pedidos</option>
                        <option value="personalizada">Extra en Modal Pedidos</option>
                        <option value="repartidor">Panel de Repartidor (/entregar)</option>
                      </select>
                    </div>

                    <label className="inline-flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={selectedTemplate.activo}
                        onChange={(e) => updateSelectedTemplate({ activo: e.target.checked })}
                      />
                      <span>Plantilla activa en el flujo</span>
                    </label>
                  </div>

                  {/* Variables dinámicas insertables */}
                  <div>
                    <div className="text-xs font-medium mb-1.5">
                      Variables dinámicas (haz clic para insertar en el mensaje):
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {WA_TEMPLATE_VARIABLES.map((v) => (
                        <button
                          key={v.key}
                          type="button"
                          onClick={() => insertVariableAtCursor(v.key)}
                          className="px-2.5 py-1 rounded-lg bg-sf bd text-[11px] hover:border-[var(--ac)] transition-colors cursor-pointer"
                          title={`Ejemplo: ${v.example}`}
                        >
                          <span className="mono font-semibold" style={{ color: 'var(--ac)' }}>
                            {v.key}
                          </span>{' '}
                          <span className="tx-mu">{v.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Textarea del mensaje */}
                  <div>
                    <label className="block text-xs font-medium mb-1">
                      Mensaje de WhatsApp (soporta negritas con *texto* y saltos de línea)
                    </label>
                    <textarea
                      ref={textareaRef}
                      rows={5}
                      value={selectedTemplate.mensaje}
                      onChange={(e) => updateSelectedTemplate({ mensaje: e.target.value })}
                      className="w-full bg-sf bd rounded-xl p-3 text-xs leading-relaxed outline-none focus:border-[var(--ac)]"
                    />
                  </div>

                  {/* Vista previa en vivo */}
                  <div className="p-4 bg-sf bd rounded-xl flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        <Sparkles size={14} style={{ color: 'var(--ok)' }} />
                        Vista previa en tiempo real
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(liveRenderedPreview);
                          setCopiedPreview(true);
                          setTimeout(() => setCopiedPreview(false), 1800);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cd bd text-[11px] font-medium cursor-pointer"
                      >
                        {copiedPreview ? (
                          <Check size={12} style={{ color: 'var(--ok)' }} />
                        ) : (
                          <Copy size={12} />
                        )}
                        {copiedPreview ? 'Copiado' : 'Copiar vista previa'}
                      </button>
                    </div>

                    <div className="p-3.5 bg-cd bd rounded-xl text-xs whitespace-pre-wrap leading-relaxed">
                      {liveRenderedPreview || 'Escribe un mensaje para ver la vista previa.'}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                      <input
                        value={sampleOrder.nombre_cliente}
                        onChange={(e) =>
                          setSampleOrder((p) => ({ ...p, nombre_cliente: e.target.value }))
                        }
                        placeholder="Nombre prueba"
                        aria-label="Nombre cliente de prueba"
                        className="bg-cd bd rounded-lg px-2.5 py-1.5 outline-none"
                      />
                      <input
                        value={sampleOrder.sku}
                        onChange={(e) => setSampleOrder((p) => ({ ...p, sku: e.target.value }))}
                        placeholder="Producto prueba"
                        aria-label="Producto de prueba"
                        className="bg-cd bd rounded-lg px-2.5 py-1.5 outline-none"
                      />
                      <input
                        type="number"
                        value={sampleOrder.total}
                        onChange={(e) =>
                          setSampleOrder((p) => ({ ...p, total: Number(e.target.value) || 0 }))
                        }
                        placeholder="Total $"
                        aria-label="Monto de prueba"
                        className="bg-cd bd rounded-lg px-2.5 py-1.5 mono outline-none"
                      />
                      <input
                        value={sampleOrder.courier}
                        onChange={(e) => setSampleOrder((p) => ({ ...p, courier: e.target.value }))}
                        placeholder="Motorista"
                        aria-label="Motorista de prueba"
                        className="bg-cd bd rounded-lg px-2.5 py-1.5 outline-none"
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* PESTAÑA 2: SALUD DEL SISTEMA, TABLAS & CRONS                       */}
      {/* ================================================================== */}
      {activeTab === 'diagnostico' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Columna izquierda: Tablas reales + Crons */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Chequeo en vivo de tablas Supabase */}
            <section className="bg-cd bd rounded-2xl p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Database size={16} style={{ color: 'var(--ac)' }} />
                  <h2 className="text-sm font-semibold">Diagnóstico en Vivo de Tablas Supabase</h2>
                </div>
                <button
                  type="button"
                  onClick={runSystemHealthCheck}
                  disabled={checkingTables}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sf bd text-xs font-medium cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw size={13} className={checkingTables ? 'animate-spin' : ''} />
                  {checkingTables ? 'Verificando...' : 'Ejecutar chequeo'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {tableHealth.map((item) => (
                  <div
                    key={item.table}
                    className="p-3.5 bg-sf bd rounded-xl flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">{item.label}</div>
                      <div className="text-[11px] tx-mu mono truncate">
                        {item.table} · {item.ms} ms
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {item.ok ? (
                        <>
                          <div
                            className="text-xs font-bold mono tabular-nums"
                            style={{ color: 'var(--ok)' }}
                          >
                            {item.count?.toLocaleString('en-US')} reg.
                          </div>
                          <div className="text-[10px] tx-mu">Operativa</div>
                        </>
                      ) : (
                        <div className="text-xs font-semibold" style={{ color: 'var(--er)' }}>
                          Error
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Tareas programadas cron-job.org */}
            <section className="bg-cd bd rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="tx-mu" />
                  <h2 className="text-sm font-semibold">Tareas Programadas (cron-job.org)</h2>
                </div>
                <button
                  type="button"
                  onClick={checkCrons}
                  disabled={isCheckingCrons}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sf bd text-xs font-medium rounded-xl disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw size={13} className={isCheckingCrons ? 'animate-spin' : ''} />
                  {isCheckingCrons ? 'Consultando...' : 'Refrescar'}
                </button>
              </div>

              {cronError && (
                <div
                  className="p-3 bg-sf bd text-xs rounded-xl mb-4"
                  style={{ borderColor: 'var(--er)', color: 'var(--er)' }}
                >
                  {cronError}
                </div>
              )}

              <div className="flex flex-col gap-2.5">
                {jobs.map((job) => {
                  const ok = job.lastStatus >= 200 && job.lastStatus < 300;
                  return (
                    <div
                      key={job.id}
                      className="p-3.5 bg-sf rounded-xl bd flex flex-col sm:flex-row justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-xs sm:text-sm truncate">{job.title}</div>
                        <div className="text-[11px] tx-mu mono truncate mt-0.5">{job.url}</div>
                      </div>
                      <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0">
                        <span
                          className="text-xs font-semibold flex items-center gap-1"
                          style={{ color: ok ? 'var(--ok)' : 'var(--er)' }}
                        >
                          {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          {ok ? 'Éxito' : job.lastStatusText}
                        </span>
                        <div className="text-[11px] tx-mu flex items-center gap-1 tabular-nums">
                          <Clock size={11} /> {fmtTime(job.lastExecution)}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {jobs.length === 0 && !isCheckingCrons && !cronError && (
                  <div className="text-xs tx-mu text-center py-6 bg-sf bd rounded-xl">
                    No se encontraron tareas registradas en cron-job.org.
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* Columna derecha: Bot Todd & Seguridad */}
          <div className="lg:col-span-1 flex flex-col gap-4">
            <section className="bg-cd bd rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Bot size={16} style={{ color: 'var(--ac)' }} />
                <h2 className="text-sm font-semibold">Integraciones & Endpoints</h2>
              </div>

              <div className="p-3.5 bg-sf bd rounded-xl flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold">Supabase Catálogo</div>
                  <div className="text-[11px] tx-mu mt-0.5">
                    {productos.data?.length ?? 0} productos activos
                  </div>
                </div>
                <span
                  className="text-xs font-semibold flex items-center gap-1"
                  style={{ color: productos.error ? 'var(--er)' : 'var(--ok)' }}
                >
                  {productos.error ? <XCircle size={13} /> : <CheckCircle2 size={13} />}
                  {productos.error ? 'Error' : 'OK'}
                </span>
              </div>

              <div className="p-3.5 bg-sf bd rounded-xl flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold">Bot Todd v2 Bridge</div>
                  <div className="text-[11px] tx-mu mono truncate mt-0.5">/api/todd-bridge</div>
                </div>
                {toddBridgeOk ? (
                  <span
                    className="text-xs font-semibold shrink-0"
                    style={{ color: toddBridgeOk.ok ? 'var(--ok)' : 'var(--er)' }}
                  >
                    {toddBridgeOk.ok ? 'Activo' : toddBridgeOk.detail}
                  </span>
                ) : (
                  <span className="text-xs tx-mu">...</span>
                )}
              </div>

              <div className="p-3.5 bg-sf bd rounded-xl text-xs flex flex-col gap-1.5">
                <div className="font-semibold">Rutas clave de la tienda</div>
                <Link to="/docs" className="tx-mu hover:text-[var(--tx)] flex items-center justify-between">
                  <span>Guías Evolution & Bot Todd</span>
                  <ExternalLink size={12} />
                </Link>
                <Link to="/unichat" className="tx-mu hover:text-[var(--tx)] flex items-center justify-between">
                  <span>UniChat & Control Todd/Humano</span>
                  <ExternalLink size={12} />
                </Link>
              </div>
            </section>

            <section className="rounded-2xl p-5 bg-cd bd">
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2" style={{ color: 'var(--ac)' }}>
                <ShieldCheck size={16} /> Monitoreo Seguro
              </h3>
              <p className="text-xs tx-mu leading-relaxed">
                Las consultas de diagnóstico son de solo lectura: verifican conectividad, tiempos de respuesta y estado de crons sin disparar envíos ni modificar pedidos.
              </p>
            </section>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* PESTAÑA 3: EVENT STREAM                                            */}
      {/* ================================================================== */}
      {activeTab === 'stream' && <EventStreamViewer />}

      {/* ================================================================== */}
      {/* PESTAÑA 4: ARQUITECTURA REAL DE TODOENUNO OS                       */}
      {/* ================================================================== */}
      {activeTab === 'architecture' && (
        <div className="flex flex-col gap-4">
          <section className="bg-cd bd rounded-2xl p-6">
            <h2 className="text-base font-bold flex items-center gap-2 mb-2">
              <Sparkles size={18} style={{ color: 'var(--ac)' }} />
              Arquitectura TODOENUNO OS — Estado Actual
            </h2>
            <p className="text-xs tx-mu leading-relaxed">
              Sistema operativo unificado de comercio COD en El Salvador: integra atención automatizada por WhatsApp (Evolution API v2.3.7 + Bot Todd v2), despacho logístico, inventario por variantes/Kárdex y control financiero en tiempo real.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-5">
              <div className="p-4 rounded-xl bg-sf bd">
                <div className="text-xs font-semibold mono mb-1" style={{ color: 'var(--ac)' }}>
                  1. Capa Mensajería & IA
                </div>
                <h3 className="font-bold text-sm mb-1">Evolution v2.3.7 + Bot Todd v2</h3>
                <p className="text-xs tx-mu leading-relaxed">
                  Webhook híbrido que sincroniza chats en Supabase, permite pausa instantánea en modo Humano y crea pedidos reales desde WhatsApp.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-sf bd">
                <div className="text-xs font-semibold mono mb-1" style={{ color: 'var(--ok)' }}>
                  2. Capa Pedidos & Kárdex
                </div>
                <h3 className="font-bold text-sm mb-1">COD Engine & Inventario Real</h3>
                <p className="text-xs tx-mu leading-relaxed">
                  Reserva y descuento automático por SKU/variantes, detección de riesgo antifraude y hoja de ruta móvil para repartidores.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-sf bd">
                <div className="text-xs font-semibold mono mb-1">
                  3. Capa Eventos & Finanzas
                </div>
                <h3 className="font-bold text-sm mb-1">OS Event Store & Money Engine</h3>
                <p className="text-xs tx-mu leading-relaxed">
                  Registro inmutable <code className="mono">os.events</code>, liquidación de efectivo a cajas y cálculo de ROAS real por código de anuncio.
                </p>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <section className="bg-cd bd rounded-2xl p-5">
              <h3 className="text-xs font-semibold tx-mu uppercase tracking-wider mb-3 flex items-center gap-2">
                <Layers size={14} /> Capacidades en Producción
              </h3>
              <div className="divide-y divide-[var(--bd)] text-xs">
                {[
                  { name: 'Sprint 1–2: OS Event Store & Money Engine', status: 'Activo' },
                  { name: 'Sprint 3–6: Catálogo Visual, Variantes & Kárdex', status: 'Activo' },
                  { name: 'Sprint 7–9: Pedidos COD, Encargos & Panel Repartidor', status: 'Activo' },
                  { name: 'Sprint 10–12: UniChat Responsive + Bot Todd v2 Híbrido', status: 'Activo' },
                  { name: 'Sprint 13: Plantillas Editables, Hoy, Cola & Docs OS', status: 'Activo' },
                ].map((row) => (
                  <div key={row.name} className="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-2">
                    <span className="font-medium">{row.name}</span>
                    <span className="font-semibold shrink-0" style={{ color: 'var(--ok)' }}>
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-cd bd rounded-2xl p-5 flex flex-col justify-between gap-4">
              <div>
                <h3 className="text-xs font-semibold tx-mu uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Code size={14} /> Archivos y Recursos Clave
                </h3>
                <div className="flex flex-col gap-2 text-xs">
                  <div className="p-3 bg-sf rounded-xl bd">
                    <div className="mono font-semibold">public/todd-v2-workflow.json</div>
                    <div className="text-[11px] tx-mu mt-0.5">Flujo n8n listo para importar con herramientas de catálogo, foto y pedido</div>
                  </div>
                  <div className="p-3 bg-sf rounded-xl bd">
                    <div className="mono font-semibold">api/evolution-webhook.ts · api/todd-bridge.ts</div>
                    <div className="text-[11px] tx-mu mt-0.5">Puente bidireccional entre Evolution API, UniChat y n8n</div>
                  </div>
                  <div className="p-3 bg-sf rounded-xl bd">
                    <div className="mono font-semibold">src/lib/whatsappTemplates.ts</div>
                    <div className="text-[11px] tx-mu mt-0.5">Motor compartido de plantillas editables para Pedidos y Repartidor</div>
                  </div>
                </div>
              </div>

              <div className="pt-3 border-t border-[var(--bd)] flex flex-wrap justify-end gap-2">
                <Link
                  to="/docs"
                  className="px-3.5 py-2 bg-sf bd text-xs font-semibold rounded-xl hover:border-[var(--ac)]"
                >
                  Abrir Docs & Roadmap
                </Link>
                <button
                  type="button"
                  onClick={() => handleTabChange('plantillas')}
                  className="px-4 py-2 text-xs font-semibold rounded-xl flex items-center gap-1.5 cursor-pointer"
                  style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                >
                  <MessageSquare size={14} />
                  Editar Plantillas WhatsApp
                </button>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
