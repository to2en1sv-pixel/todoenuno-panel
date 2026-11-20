import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProductos } from '@/hooks/useCatalog';
import { supabase } from '@/lib/supabase';
import { EventStreamViewer } from '@/components/events/EventStreamViewer';
import { SistemaToddConfig } from '@/components/SistemaToddConfig';
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
  DEFAULT_COURIERS,
  fetchCouriers,
  fetchDriverAccessConfig,
  getCachedDriverAccessConfig,
  saveCouriers,
  saveDriverAccessConfig,
  type CourierItem,
  type CourierTipo,
  type DriverAccessConfig,
} from '@/lib/couriers';
import { ensureOrdersEvidenceBucket } from '@/lib/orderStorage';
import { getDemoShareUrl, isDemoMode } from '@/lib/demoMode';
import {
  fetchPanelAccessConfig,
  getCachedPanelAccessConfig,
  getEnvOverridePin,
  lockPanelSession,
  sanitizePanelPin,
  savePanelAccessConfig,
  type PanelAccessConfig,
} from '@/lib/panelAccess';
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Code,
  Copy,
  Database,
  ExternalLink,
  HardDrive,
  KeyRound,
  Layers,
  Loader2,
  MessageSquare,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  XCircle,
  Zap,
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

type SistemaTab = 'plantillas' | 'couriers' | 'todd' | 'stream' | 'diagnostico' | 'architecture';

type MetaPagePermStatus = {
  page_id: string;
  page_name: string;
  niche?: string | null;
  token_source?: 'fb_publish_pages' | 'fb_pages' | 'none';
  has_token?: boolean;
  tokenValid: boolean;
  canPublish: boolean;
  canInbox: boolean;
  canIgPublish?: boolean;
  permissions?: string[];
  error?: string | null;
};

type MetaAdsStatusData = {
  tableReady: boolean;
  connected: boolean;
  status: 'missing_table' | 'pending_tokens' | 'connected';
  message?: string;
  lastSyncedAt?: string | null;
  accounts: Array<{
    ad_account_id: string;
    account_name: string;
    page_id?: string | null;
    currency: string;
    active: boolean;
    has_token: boolean;
    last_synced_at?: string | null;
  }>;
};

type TelegramBotStatusData = {
  hasBotToken: boolean;
  hasOpenAiKey: boolean;
  hasSecret: boolean;
  allowedChatIds: string[];
  expectedWebhookUrl: string;
  telegramWebhook?: {
    url?: string;
    pending_update_count?: number;
    last_error_message?: string | null;
    isMatchingCurrentHost?: boolean;
  } | null;
  webhookError?: string | null;
};

const META_TOKENS_SETUP_SQL = `-- TODOENUNO OS · Tablas Seguras para Tokens (RLS sin políticas para anon)
CREATE TABLE IF NOT EXISTS public.fb_publish_pages (
  page_id TEXT PRIMARY KEY,
  page_name TEXT NOT NULL,
  publish_token TEXT NOT NULL,
  niche TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fb_publish_pages ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.meta_ad_accounts (
  ad_account_id TEXT PRIMARY KEY, -- Ej: act_123456789012345
  account_name TEXT NOT NULL,
  access_token TEXT NOT NULL,
  page_id TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  active BOOLEAN NOT NULL DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.meta_ad_accounts ENABLE ROW LEVEL SECURITY;`;

function resolveTabParam(raw: string | null): SistemaTab {
  if (raw === 'plantillas') return 'plantillas';
  if (raw === 'couriers' || raw === 'envios') return 'couriers';
  if (raw === 'todd' || raw === 'bot') return 'todd';
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

  /* ------------------------------------------------------------------ */
  /* 1B. Estado del Gestor de Couriers & Transportistas                 */
  /* ------------------------------------------------------------------ */
  const [couriersList, setCouriersList] = useState<CourierItem[]>([]);
  const [courierSource, setCourierSource] = useState<'supabase' | 'local'>('supabase');
  const [loadingCouriers, setLoadingCouriers] = useState(true);
  const [savingCouriers, setSavingCouriers] = useState(false);
  const [hasUnsavedCouriers, setHasUnsavedCouriers] = useState(false);
  const [courierNotice, setCourierNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [newCourierName, setNewCourierName] = useState('');
  const [newCourierTipo, setNewCourierTipo] = useState<CourierTipo>('motorista');
  const [newCourierZonas, setNewCourierZonas] = useState('');
  const [newCourierTel, setNewCourierTel] = useState('');
  const [newCourierPin, setNewCourierPin] = useState('');
  const [driverAccess, setDriverAccess] = useState<DriverAccessConfig>(() =>
    getCachedDriverAccessConfig()
  );
  const [savingDriverAccess, setSavingDriverAccess] = useState(false);
  const [panelAccess, setPanelAccess] = useState<PanelAccessConfig>(() =>
    getCachedPanelAccessConfig()
  );
  const [savingPanelAccess, setSavingPanelAccess] = useState(false);
  const [showPinManager, setShowPinManager] = useState(false);
  const [panelPinNotice, setPanelPinNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const envPinLocked = Boolean(getEnvOverridePin());
  const [bucketStatus, setBucketStatus] = useState<{
    checking: boolean;
    ok?: boolean;
    message?: string;
  }>({ checking: false });

  useEffect(() => {
    let active = true;
    setLoadingCouriers(true);
    Promise.all([fetchCouriers(), fetchDriverAccessConfig(), fetchPanelAccessConfig()])
      .then(([{ couriers: loaded, source }, accessCfg, panelCfg]) => {
        if (!active) return;
        setCouriersList(loaded);
        setCourierSource(source);
        setDriverAccess(accessCfg);
        setPanelAccess(panelCfg);
      })
      .finally(() => {
        if (active) setLoadingCouriers(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const persistCouriersList = async (nextList: CourierItem[], okMessage?: string) => {
    setSavingCouriers(true);
    try {
      const res = await saveCouriers(nextList);
      setCouriersList(res.couriers);
      setCourierSource(res.source);
      setHasUnsavedCouriers(false);
      setCourierNotice({
        type: 'ok',
        text:
          okMessage ||
          (res.source === 'supabase'
            ? 'Couriers guardados y sincronizados con Pedidos, Despacho & Guías y Portal Repartidor.'
            : 'Couriers guardados localmente.'),
      });
      setTimeout(() => {
        setCourierNotice((prev) => (prev?.type === 'ok' ? null : prev));
      }, 4500);
    } catch (err: any) {
      setCourierNotice({ type: 'err', text: err?.message || 'Error guardando couriers.' });
    } finally {
      setSavingCouriers(false);
    }
  };

  const handleAddCourier = async () => {
    const cleanName = newCourierName.trim();
    if (!cleanName) {
      setCourierNotice({ type: 'err', text: 'Escribe el nombre del courier o motorista.' });
      return;
    }
    if (couriersList.some((c) => c.nombre.toLowerCase() === cleanName.toLowerCase())) {
      setCourierNotice({ type: 'err', text: 'Ya existe un courier con ese nombre.' });
      return;
    }
    const created: CourierItem = {
      id: `cour_${Date.now().toString(36)}`,
      nombre: cleanName,
      tipo: newCourierTipo,
      zonas: newCourierZonas.trim(),
      telefono: newCourierTel.trim(),
      pin: newCourierPin.replace(/\D/g, '').slice(0, 6),
      activo: true,
    };
    const next = [...couriersList, created];
    setNewCourierName('');
    setNewCourierZonas('');
    setNewCourierTel('');
    setNewCourierPin('');
    await persistCouriersList(next, `Courier "${cleanName}" agregado y disponible en Pedidos.`);
  };

  const handleSaveDriverAccess = async () => {
    setSavingDriverAccess(true);
    try {
      const res = await saveDriverAccessConfig(driverAccess);
      setDriverAccess(res.config);
      setCourierNotice({
        type: 'ok',
        text: res.config.requirePin
          ? `Acceso protegido con PIN Maestro (${res.config.adminPin}) y PIN individual por courier.`
          : 'PIN desactivado: cualquier motorista puede abrir su ruta directamente.',
      });
    } finally {
      setSavingDriverAccess(false);
    }
  };

  const handleSavePanelAccess = async () => {
    if (panelAccess.requirePin && sanitizePanelPin(panelAccess.pin).length < 4) {
      setPanelPinNotice({ type: 'err', text: 'El PIN del panel debe tener entre 4 y 8 dígitos.' });
      return;
    }
    setSavingPanelAccess(true);
    setPanelPinNotice(null);
    try {
      const res = await savePanelAccessConfig(panelAccess);
      setPanelAccess(res.config);
      setPanelPinNotice({
        type: 'ok',
        text: res.config.requirePin
          ? `PIN del panel guardado (${res.savedToCloud ? 'sincronizado en nube' : 'local'}). La ruta /demo sigue siendo pública.`
          : 'Protección con PIN desactivada para el panel real.',
      });
    } finally {
      setSavingPanelAccess(false);
    }
  };

  const handleInitOrdersBucket = async () => {
    setBucketStatus({ checking: true });
    const res = await ensureOrdersEvidenceBucket();
    setBucketStatus({
      checking: false,
      ok: res.ok,
      message: res.ok
        ? 'Bucket "orders-evidence" activo y listo en Supabase Storage.'
        : res.error || 'No se pudo verificar el bucket.',
    });
  };

  const handleUpdateCourierItem = (id: string, patch: Partial<CourierItem>) => {
    setCouriersList((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setHasUnsavedCouriers(true);
  };

  const handleToggleCourierItem = async (id: string) => {
    const next = couriersList.map((c) => (c.id === id ? { ...c, activo: !c.activo } : c));
    await persistCouriersList(next);
  };

  const handleDeleteCourierItem = async (id: string) => {
    const next = couriersList.filter((c) => c.id !== id);
    await persistCouriersList(
      next.length > 0 ? next : DEFAULT_COURIERS.map((c) => ({ ...c })),
      next.length > 0 ? 'Courier eliminado.' : 'Se restauraron los couriers base.'
    );
  };

  const handleResetCouriers = async () => {
    await persistCouriersList(
      DEFAULT_COURIERS.map((c) => ({ ...c })),
      'Lista base de couriers restaurada.'
    );
  };

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
    return renderWhatsappTemplate(selectedTemplate.mensaje, sampleOrder, {
      guia: 'SV-884210',
      tiempo: '30 minutos',
    });
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

  // Infraestructura Meta (Páginas + Ads) sin exponer tokens
  const [checkingMeta, setCheckingMeta] = useState(false);
  const [metaApiUnavailable, setMetaApiUnavailable] = useState(false);
  const [metaPubTableReady, setMetaPubTableReady] = useState<boolean | null>(null);
  const [metaPagesStatus, setMetaPagesStatus] = useState<MetaPagePermStatus[]>([]);
  const [metaAdsStatus, setMetaAdsStatus] = useState<MetaAdsStatusData | null>(null);
  const [metaInfraError, setMetaInfraError] = useState<string | null>(null);
  const [showMetaSql, setShowMetaSql] = useState(false);
  const [copiedMetaSql, setCopiedMetaSql] = useState(false);
  const [copiedMetaCron, setCopiedMetaCron] = useState(false);

  const metaCronUrl = useMemo(() => {
    const origin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://todoenuno-panel.vercel.app';
    return `${origin}/api/meta-ads-sync?action=sync&days=2`;
  }, []);

  const checkMetaInfra = useCallback(async () => {
    setCheckingMeta(true);
    setMetaInfraError(null);
    setMetaApiUnavailable(false);
    try {
      const [permRes, adsRes] = await Promise.all([
        fetch('/api/content-distribute?action=check_permissions'),
        fetch('/api/meta-ads-sync?action=status'),
      ]);

      const permCt = permRes.headers.get('content-type') || '';
      const adsCt = adsRes.headers.get('content-type') || '';

      if (!permCt.includes('application/json') || !adsCt.includes('application/json')) {
        setMetaApiUnavailable(true);
        return;
      }

      const [permJson, adsJson] = await Promise.all([
        permRes.json().catch(() => null),
        adsRes.json().catch(() => null),
      ]);

      if (permRes.ok && permJson?.ok) {
        setMetaPubTableReady(Boolean(permJson.pubTableReady));
        setMetaPagesStatus(Array.isArray(permJson.pages) ? permJson.pages : []);
      } else if (permJson?.error) {
        setMetaInfraError(permJson.error);
      }

      if (adsRes.ok && adsJson?.ok) {
        setMetaAdsStatus({
          tableReady: Boolean(adsJson.tableReady),
          connected: Boolean(adsJson.connected),
          status: adsJson.status || 'pending_tokens',
          message: adsJson.message,
          lastSyncedAt: adsJson.lastSyncedAt || null,
          accounts: Array.isArray(adsJson.accounts) ? adsJson.accounts : [],
        });
      } else if (adsJson?.error) {
        setMetaInfraError((prev) => prev || adsJson.error);
      }
    } catch (err: any) {
      setMetaInfraError(err?.message || 'Error consultando infraestructura Meta');
    } finally {
      setCheckingMeta(false);
    }
  }, []);

  // Bot Telegram de Compras & Brief (Vercel + GPT)
  const [checkingTelegram, setCheckingTelegram] = useState(false);
  const [registeringTelegram, setRegisteringTelegram] = useState(false);
  const [telegramApiUnavailable, setTelegramApiUnavailable] = useState(false);
  const [telegramStatus, setTelegramStatus] = useState<TelegramBotStatusData | null>(null);
  const [telegramNotice, setTelegramNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const checkTelegramBot = useCallback(async () => {
    setCheckingTelegram(true);
    setTelegramApiUnavailable(false);
    try {
      const res = await fetch('/api/morning-brief?telegram_mode=status');
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const raw = await res.text().catch(() => '');
        if (res.ok && raw.trim().toLowerCase().startsWith('<!doctype')) {
          setTelegramApiUnavailable(true);
        } else {
          setTelegramNotice({
            type: 'err',
            text: `Respuesta inesperada de /api/morning-brief (HTTP ${res.status}): ${raw.slice(0, 140)}`,
          });
        }
        return;
      }
      const json = await res.json().catch(() => null);
      if (res.ok && json?.ok) {
        setTelegramStatus(json);
      } else if (json?.error) {
        setTelegramNotice({ type: 'err', text: json.error });
      }
    } catch (err: any) {
      setTelegramNotice({ type: 'err', text: err?.message || 'Error consultando bot de Telegram' });
    } finally {
      setCheckingTelegram(false);
    }
  }, []);

  const handleRegisterTelegramWebhook = async () => {
    setRegisteringTelegram(true);
    setTelegramNotice(null);
    try {
      const res = await fetch('/api/morning-brief?telegram_mode=register_webhook', { method: 'POST' });
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        const raw = await res.text().catch(() => '');
        setTelegramNotice({
          type: 'err',
          text:
            res.ok && raw.trim().toLowerCase().startsWith('<!doctype')
              ? 'Esta acción se ejecuta una vez desplegado en Vercel.'
              : `Error HTTP ${res.status} en /api/morning-brief: ${raw.slice(0, 160) || 'Sin detalle'}`,
        });
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        setTelegramNotice({
          type: 'err',
          text: json?.error || 'No se pudo registrar el webhook en Telegram.',
        });
      } else {
        setTelegramNotice({
          type: 'ok',
          text: `Webhook y comandos (/compra, /gasto, /pedido, /estado, /pendientes, /merma, /stock, /cajas, /brief) conectados a ${json.webhookUrl}.`,
        });
        await checkTelegramBot();
      }
    } finally {
      setRegisteringTelegram(false);
    }
  };

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
      void checkMetaInfra();
      void checkTelegramBot();
    }
  }, [activeTab, checkCrons, runSystemHealthCheck, checkMetaInfra, checkTelegramBot]);

  const fmtTime = (ts: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16">
      {/* ENCABEZADO GENERAL */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Sistema, Plantillas &amp; Diagnóstico
          </h1>
          <p className="text-xs tx-mu mt-1">
            Plantillas WhatsApp · Couriers y PIN QR · Reglas Bot Todd · Salud de tablas, Meta y Crons
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {!isDemoMode() && (
            <>
              <button
                type="button"
                onClick={() => setShowPinManager((v) => !v)}
                className={`px-3 py-2 border rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                  showPinManager
                    ? 'border-[var(--tx)] bg-sf text-[var(--tx)]'
                    : 'border-[var(--bd)] bg-cd hover:bg-sf text-[var(--tx)]'
                }`}
                title="Configurar PIN de acceso del panel real"
              >
                <KeyRound size={12} className="tx-mu" />
                PIN Panel ({panelAccess.requirePin ? 'Activo' : 'Inactivo'})
              </button>
              <button
                type="button"
                onClick={() => {
                  const url = getDemoShareUrl();
                  void navigator.clipboard?.writeText(url);
                  setTplNotice({ type: 'ok', text: `Enlace Demo copiado: ${url}` });
                  window.setTimeout(() => setTplNotice(null), 4000);
                }}
                className="px-3 py-2 border border-[var(--bd)] bg-cd hover:bg-sf rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
                title="Copia la URL pública del entorno Demo con datos ficticios"
              >
                <Copy size={12} className="tx-mu" />
                Copiar URL Demo
              </button>
              <a
                href="/demo"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-opacity whitespace-nowrap"
              >
                Abrir Demo <ExternalLink size={12} />
              </a>
            </>
          )}
          <Link
            to="/repartidor"
            className="px-3 py-2 border border-[var(--bd)] bg-cd hover:bg-sf rounded-lg text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
          >
            Portal Repartidor <ExternalLink size={12} className="tx-mu" />
          </Link>
        </div>
      </header>

      {!isDemoMode() && showPinManager && (
        <section className="bg-cd bd rounded-xl p-5 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-[var(--tx)]">
                Protección con PIN del Panel Real
              </h2>
              <p className="text-xs tx-mu mt-0.5">
                Si compartes el enlace <span className="mono">/demo</span> y alguien borra la ruta para entrar al inicio, el panel real pedirá este PIN antes de cargar cualquier dato.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                lockPanelSession();
                window.location.reload();
              }}
              className="px-3 py-1.5 rounded-lg border border-[var(--bd)] bg-sf hover:border-[var(--tx)] text-xs font-semibold text-[var(--tx)] whitespace-nowrap self-start sm:self-auto"
            >
              Bloquear ahora
            </button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--tx)] cursor-pointer select-none sm:pb-2">
              <input
                type="checkbox"
                disabled={envPinLocked}
                checked={panelAccess.requirePin}
                onChange={(e) =>
                  setPanelAccess((prev) => ({ ...prev, requirePin: e.target.checked }))
                }
              />
              <span>Exigir PIN al abrir el panel real</span>
            </label>

            <div className="w-full sm:w-48">
              <label className="block text-[11px] font-medium tx-mu mb-1">
                PIN numérico (4 a 8 dígitos)
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={8}
                disabled={envPinLocked}
                value={panelAccess.pin}
                onChange={(e) =>
                  setPanelAccess((prev) => ({
                    ...prev,
                    pin: sanitizePanelPin(e.target.value),
                  }))
                }
                placeholder="2026"
                className="w-full px-3 py-2 rounded-lg bg-sf border border-[var(--bd)] text-xs mono font-semibold text-[var(--tx)] focus:outline-none focus:border-[var(--tx)] disabled:opacity-60"
              />
            </div>

            {!envPinLocked && (
              <button
                type="button"
                onClick={handleSavePanelAccess}
                disabled={savingPanelAccess}
                className="px-4 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
              >
                {savingPanelAccess ? 'Guardando...' : 'Guardar PIN'}
              </button>
            )}
          </div>

          {envPinLocked && (
            <p className="text-xs tx-mu">
              El PIN está controlado actualmente por la variable de entorno <span className="mono">VITE_PANEL_PIN</span> en Vercel.
            </p>
          )}

          {panelPinNotice && (
            <div
              className="text-xs font-medium"
              style={{ color: panelPinNotice.type === 'ok' ? 'var(--ok)' : 'var(--er)' }}
            >
              {panelPinNotice.text}
            </div>
          )}
        </section>
      )}

      {/* Selector de Pestañas Underline */}
      <nav className="flex items-center gap-6 border-b border-[var(--bd)] overflow-x-auto">
        {(
          [
            { id: 'plantillas', label: 'Plantillas WhatsApp', icon: MessageSquare },
            { id: 'couriers', label: 'Couriers & Envíos', icon: Truck },
            { id: 'todd', label: 'Bot Todd', icon: Bot },
            { id: 'diagnostico', label: 'Salud & Crons', icon: Activity },
            { id: 'stream', label: 'Event Stream', icon: Radio },
            { id: 'architecture', label: 'Arquitectura', icon: Layers },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => handleTabChange(id)}
            className={`pb-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap -mb-px inline-flex items-center gap-1.5 cursor-pointer ${
              activeTab === id
                ? 'border-[var(--tx)] text-[var(--tx)] font-semibold'
                : 'border-transparent tx-mu hover:text-[var(--tx)]'
            }`}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </nav>

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
            <aside className="lg:col-span-4 bg-cd bd rounded-xl p-4 flex flex-col gap-3">
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
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--tx)] text-[var(--cd)] cursor-pointer shrink-0 hover:opacity-90"
                >
                  <Plus size={13} />
                  Nueva
                </button>
              </div>

              {loadingTemplates ? (
                <div className="py-8 text-center text-xs tx-mu">Cargando plantillas...</div>
              ) : (
                <div className="border border-[var(--bd)] rounded-xl divide-y divide-[var(--bd)] overflow-hidden">
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
                        className={`w-full text-left p-3 transition-colors cursor-pointer ${
                          active ? 'bg-sf font-semibold' : 'bg-cd hover:bg-sf/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold truncate">{tpl.titulo}</span>
                          <span
                            className={`text-[11px] font-medium shrink-0 ${
                              tpl.activo ? 'text-emerald-600 dark:text-emerald-400' : 'tx-mu'
                            }`}
                          >
                            {tpl.activo ? 'Activa' : 'Pausada'}
                          </span>
                        </div>
                        <div className="text-[11px] tx-mu mt-0.5 truncate">
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
                <span>Reflejo inmediato en:</span>
                <Link to="/pedidos" className="font-semibold text-[var(--tx)] hover:underline">
                  Pedidos →
                </Link>
              </div>
            </aside>

            {/* Editor + Vista Previa */}
            <div className="lg:col-span-8 bg-cd bd rounded-xl p-5 flex flex-col gap-4">
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
      {/* PESTAÑA 1B: REGLAS OPERATIVAS DE BOT TODD                          */}
      {/* ================================================================== */}
      {activeTab === 'todd' && <SistemaToddConfig />}

      {/* ================================================================== */}
      {/* PESTAÑA 2: SALUD DEL SISTEMA, TABLAS & CRONS                       */}
      {/* ================================================================== */}
      {activeTab === 'diagnostico' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {/* Columna izquierda: Tablas reales + Crons */}
          <div className="lg:col-span-2 flex flex-col gap-4">
            {/* Chequeo en vivo de tablas Supabase */}
            <section className="bg-cd bd rounded-xl p-5">
              <div className="flex items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-2">
                  <Database size={16} className="tx-mu" />
                  <h2 className="text-sm font-semibold">Diagnóstico en Vivo de Tablas Supabase</h2>
                </div>
                <button
                  type="button"
                  onClick={runSystemHealthCheck}
                  disabled={checkingTables}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sf bd text-xs font-medium cursor-pointer disabled:opacity-50"
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
                      <div className="text-[11px] tx-mu font-mono tabular-nums truncate">
                        {item.table} · {item.ms} ms
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {item.ok ? (
                        <>
                          <div className="text-xs font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                            {item.count?.toLocaleString('en-US')} reg.
                          </div>
                          <div className="text-[10px] tx-mu">Operativa</div>
                        </>
                      ) : (
                        <div className="text-xs font-semibold text-rose-600 dark:text-rose-400">
                          Error
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Tareas programadas cron-job.org */}
            <section className="bg-cd bd rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="tx-mu" />
                  <h2 className="text-sm font-semibold">Tareas Programadas (cron-job.org)</h2>
                </div>
                <button
                  type="button"
                  onClick={checkCrons}
                  disabled={isCheckingCrons}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sf bd text-xs font-medium rounded-lg disabled:opacity-50 cursor-pointer"
                >
                  <RefreshCw size={13} className={isCheckingCrons ? 'animate-spin' : ''} />
                  {isCheckingCrons ? 'Consultando...' : 'Refrescar'}
                </button>
              </div>

              {cronError && (
                <div className="p-3 bg-sf border border-rose-500/40 text-rose-600 dark:text-rose-400 text-xs rounded-lg mb-4">
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
                        <div className="text-[11px] tx-mu font-mono truncate mt-0.5">{job.url}</div>
                      </div>
                      <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between gap-1 shrink-0">
                        <span
                          className={`text-xs font-semibold flex items-center gap-1 ${
                            ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                          {ok ? 'Éxito' : job.lastStatusText}
                        </span>
                        <div className="text-[11px] tx-mu flex items-center gap-1 font-mono tabular-nums">
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

            {/* Infraestructura Segura Meta (Páginas + Ads) */}
            <section className="bg-cd bd rounded-xl p-5 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Zap size={16} style={{ color: 'var(--ac)' }} />
                    <h2 className="text-sm font-semibold">Infraestructura Segura Meta (Páginas + Ads)</h2>
                  </div>
                  <p className="text-[11px] tx-mu mt-0.5">
                    Verifica permisos desde el servidor (<code className="mono">/me/permissions</code>) sin exponer tokens en el navegador.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={checkMetaInfra}
                  disabled={checkingMeta}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sf bd text-xs font-medium rounded-xl disabled:opacity-50 cursor-pointer self-start sm:self-auto shrink-0"
                >
                  <RefreshCw size={13} className={checkingMeta ? 'animate-spin' : ''} />
                  {checkingMeta ? 'Verificando...' : 'Verificar permisos Meta'}
                </button>
              </div>

              {metaApiUnavailable && (
                <div className="p-3 bg-sf bd rounded-xl text-xs tx-mu flex items-center gap-2">
                  <AlertTriangle size={14} style={{ color: 'var(--wa)' }} />
                  <span>
                    Los endpoints <code className="mono">/api/content-distribute</code> y <code className="mono">/api/meta-ads-sync</code> se ejecutan en producción (Vercel). Al desplegar verás aquí el estado en vivo de tus 4 páginas y cuentas publicitarias.
                  </span>
                </div>
              )}

              {metaInfraError && (
                <div
                  className="p-3 bg-sf bd text-xs rounded-xl"
                  style={{ borderColor: 'var(--er)', color: 'var(--er)' }}
                >
                  {metaInfraError}
                </div>
              )}

              {/* Estado de tablas RLS */}
              {!metaApiUnavailable && (metaPubTableReady !== null || metaAdsStatus) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-3 bg-sf bd rounded-xl flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">Tabla fb_publish_pages</div>
                      <div className="text-[11px] tx-mu truncate">Tokens publicación (sin tocar Social Inbox)</div>
                    </div>
                    <span
                      className="text-[11px] font-bold shrink-0"
                      style={{ color: metaPubTableReady ? 'var(--ok)' : 'var(--wa)' }}
                    >
                      {metaPubTableReady ? 'Tabla lista' : 'Ejecutar SQL'}
                    </span>
                  </div>

                  <div className="p-3 bg-sf bd rounded-xl flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">Tabla meta_ad_accounts</div>
                      <div className="text-[11px] tx-mu truncate">
                        {metaAdsStatus?.connected
                          ? `${metaAdsStatus.accounts.filter((a) => a.active && a.has_token).length} cuenta(s) activa(s)`
                          : metaAdsStatus?.tableReady
                            ? 'Lista · Pendiente de tokens'
                            : 'Ejecutar SQL'}
                      </div>
                    </div>
                    <span
                      className="text-[11px] font-bold shrink-0"
                      style={{
                        color: metaAdsStatus?.connected
                          ? 'var(--ok)'
                          : metaAdsStatus?.tableReady
                            ? 'var(--ac)'
                            : 'var(--wa)',
                      }}
                    >
                      {metaAdsStatus?.connected
                        ? 'Conectado'
                        : metaAdsStatus?.tableReady
                          ? 'Pendiente'
                          : 'Falta SQL'}
                    </span>
                  </div>
                </div>
              )}

              {/* Lista de páginas y permisos detectados */}
              {metaPagesStatus.length > 0 && (
                <div className="space-y-2">
                  <div className="text-[11px] font-semibold tx-mu uppercase tracking-wider">
                    Permisos por Página Facebook ({metaPagesStatus.length})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {metaPagesStatus.map((p) => (
                      <div key={p.page_id} className="p-3 bg-sf bd rounded-xl space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold truncate">{p.page_name}</span>
                          <span className="text-[10px] mono px-1.5 py-0.5 rounded bg-cd bd tx-mu shrink-0">
                            {p.token_source === 'fb_publish_pages'
                              ? 'fb_publish_pages'
                              : p.token_source === 'fb_pages'
                                ? 'fb_pages (Inbox)'
                                : 'Sin token'}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-[11px]">
                          <span
                            className="inline-flex items-center gap-1 font-medium"
                            style={{ color: p.canPublish ? 'var(--ok)' : 'var(--er)' }}
                          >
                            {p.canPublish ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                            pages_manage_posts
                          </span>
                          <span
                            className="inline-flex items-center gap-1 font-medium"
                            style={{ color: p.canInbox ? 'var(--ok)' : 'var(--mu)' }}
                          >
                            {p.canInbox ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                            pages_messaging
                          </span>
                        </div>
                        {p.error && (
                          <div className="text-[11px] truncate" style={{ color: 'var(--er)' }} title={p.error}>
                            {p.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Bloque SQL copiable con RLS */}
              <div className="p-3.5 bg-sf bd rounded-xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMetaSql((v) => !v)}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold cursor-pointer hover:opacity-80"
                  >
                    <Code size={14} style={{ color: 'var(--ac)' }} />
                    SQL de creación segura en Supabase (RLS sin políticas públicas)
                    {showMetaSql ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(META_TOKENS_SETUP_SQL);
                      setCopiedMetaSql(true);
                      setTimeout(() => setCopiedMetaSql(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cd bd text-[11px] font-medium cursor-pointer"
                  >
                    {copiedMetaSql ? <Check size={12} style={{ color: 'var(--ok)' }} /> : <Copy size={12} />}
                    {copiedMetaSql ? 'SQL copiado' : 'Copiar SQL'}
                  </button>
                </div>

                {showMetaSql && (
                  <pre className="p-3 rounded-lg bg-cd bd text-[11px] mono overflow-x-auto leading-relaxed tx-mu">
                    {META_TOKENS_SETUP_SQL}
                  </pre>
                )}
              </div>

              {/* Cron URL recomendado para Meta Ads Sync */}
              <div className="p-3.5 bg-sf bd rounded-xl space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold">Endpoint Cron diario de Meta Ads</div>
                    <p className="text-[11px] tx-mu">
                      Recomendado programar en cron-job.org todos los días a las <strong>4:55 PM</strong> (antes del Brief Nocturno de las 5:00 PM).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(metaCronUrl);
                      setCopiedMetaCron(true);
                      setTimeout(() => setCopiedMetaCron(false), 2000);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-cd bd text-[11px] font-medium cursor-pointer shrink-0"
                  >
                    {copiedMetaCron ? <Check size={12} style={{ color: 'var(--ok)' }} /> : <Copy size={12} />}
                    {copiedMetaCron ? 'URL copiada' : 'Copiar URL Cron'}
                  </button>
                </div>
                <div className="p-2 rounded-lg bg-cd bd text-[11px] mono truncate tx-mu">
                  {metaCronUrl}
                </div>
              </div>
            </section>

            {/* Bot Telegram Compras & Consultas (Vercel + GPT-4o-mini) */}
            <section className="bg-cd bd rounded-xl p-5 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <Send size={16} className="tx-mu" />
                    <h2 className="text-sm font-semibold">Bot Telegram Operaciones & Brief (Vercel + GPT)</h2>
                  </div>
                  <p className="text-[11px] tx-mu mt-0.5">
                    Texto, notas de voz (Whisper) o foto de factura/recibo para registrar compras, gastos/pauta (<code className="mono">/gasto</code>), mermas/ajustes (<code className="mono">/merma</code>), cambiar estado de pedidos (<code className="mono">/estado</code>) y consultar <code className="mono">/pedido</code>, <code className="mono">/pendientes</code>, <code className="mono">/stock</code>, <code className="mono">/cajas</code> y <code className="mono">/brief</code>.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={checkTelegramBot}
                    disabled={checkingTelegram}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sf bd text-xs font-medium rounded-lg disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw size={13} className={checkingTelegram ? 'animate-spin' : ''} />
                    Verificar
                  </button>
                  <button
                    type="button"
                    onClick={handleRegisterTelegramWebhook}
                    disabled={registeringTelegram}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--tx)] text-[var(--cd)] disabled:opacity-50 cursor-pointer hover:opacity-90"
                  >
                    {registeringTelegram ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Conectar Webhook
                  </button>
                </div>
              </div>

              {telegramNotice && (
                <div
                  className="p-3 bg-sf bd text-xs rounded-xl"
                  style={{
                    borderColor: telegramNotice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
                    color: telegramNotice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
                  }}
                >
                  {telegramNotice.text}
                </div>
              )}

              {telegramApiUnavailable && (
                <div className="p-3 bg-sf bd rounded-xl text-xs tx-mu flex items-center gap-2">
                  <AlertTriangle size={14} style={{ color: 'var(--wa)' }} />
                  <span>
                    El webhook (<code className="mono">/api/morning-brief?telegram_mode=webhook</code>) corre en Vercel. Una vez desplegado, agrega <code className="mono">TELEGRAM_BOT_TOKEN</code> en tus variables de Vercel y pulsa <strong>Conectar Webhook</strong>.
                  </span>
                </div>
              )}

              {!telegramApiUnavailable && telegramStatus && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="p-3 bg-sf bd rounded-xl">
                    <div className="text-[11px] tx-mu">TELEGRAM_BOT_TOKEN</div>
                    <div
                      className="text-xs font-bold mt-0.5"
                      style={{ color: telegramStatus.hasBotToken ? 'var(--ok)' : 'var(--er)' }}
                    >
                      {telegramStatus.hasBotToken ? 'Configurado en Vercel' : 'Falta en Vercel'}
                    </div>
                  </div>
                  <div className="p-3 bg-sf bd rounded-xl">
                    <div className="text-[11px] tx-mu">OPENAI_API_KEY (GPT)</div>
                    <div
                      className="text-xs font-bold mt-0.5"
                      style={{ color: telegramStatus.hasOpenAiKey ? 'var(--ok)' : 'var(--er)' }}
                    >
                      {telegramStatus.hasOpenAiKey ? 'Conectado (gpt-4o-mini)' : 'Falta en Vercel'}
                    </div>
                  </div>
                  <div className="p-3 bg-sf bd rounded-xl">
                    <div className="text-[11px] tx-mu">Webhook activo</div>
                    <div
                      className="text-xs font-bold mt-0.5 truncate"
                      style={{
                        color: telegramStatus.telegramWebhook?.isMatchingCurrentHost
                          ? 'var(--ok)'
                          : 'var(--wa)',
                      }}
                      title={telegramStatus.telegramWebhook?.url || 'Sin registrar'}
                    >
                      {telegramStatus.telegramWebhook?.url
                        ? telegramStatus.telegramWebhook.isMatchingCurrentHost
                          ? 'Conectado'
                          : 'Otra URL'
                        : 'Sin conectar'}
                    </div>
                  </div>
                </div>
              )}

              <div className="p-3 bg-sf bd rounded-xl text-[11px] tx-mu space-y-1">
                <div>
                  <strong className="text-[var(--tx)]">Uso en Telegram:</strong> escribe natural, envía <strong>nota de voz</strong> o foto de factura/recibo (ej. <em>"Compré 10 cascos a $12.50"</em>, <em>"Gasté $45 en Meta Ads"</em>, <em>"Pasa a entregado el pedido de María"</em>, <em>"Se dañaron 2 cascos"</em>), o usa <code className="mono">/compra</code> · <code className="mono">/gasto</code> · <code className="mono">/pedido</code> · <code className="mono">/estado</code> · <code className="mono">/pendientes</code> · <code className="mono">/merma</code> · <code className="mono">/ajuste</code> · <code className="mono">/stock</code> · <code className="mono">/cajas</code> · <code className="mono">/brief</code>.
                </div>
                {telegramStatus?.allowedChatIds?.length ? (
                  <div>
                    Chats autorizados: <code className="mono">{telegramStatus.allowedChatIds.join(', ')}</code>
                  </div>
                ) : null}
              </div>
            </section>
          </div>

          {/* Columna derecha: Bot Todd & Seguridad */}
          <div className="lg:col-span-1 flex flex-col gap-4">
            <section className="bg-cd bd rounded-xl p-5 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <Bot size={16} className="tx-mu" />
                <h2 className="text-sm font-semibold">Integraciones & Endpoints</h2>
              </div>

              <div className="p-3.5 bg-sf bd rounded-xl flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold">Supabase Catálogo</div>
                  <div className="text-[11px] tx-mu mt-0.5 font-mono tabular-nums">
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
                  <div className="text-[11px] tx-mu font-mono truncate mt-0.5">/api/todd-bridge</div>
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

            <section className="rounded-xl p-5 bg-cd bd">
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-2 text-[var(--tx)]">
                <ShieldCheck size={15} className="tx-mu" /> Monitoreo Seguro
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
          <section className="bg-cd bd rounded-xl p-6">
            <h2 className="text-base font-bold flex items-center gap-2 mb-2">
              <Sparkles size={16} className="tx-mu" />
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
            <section className="bg-cd bd rounded-xl p-5">
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
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                      {row.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            <section className="bg-cd bd rounded-xl p-5 flex flex-col justify-between gap-4">
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
                  className="px-3.5 py-2 bg-sf bd text-xs font-medium rounded-lg hover:border-[var(--tx)]"
                >
                  Abrir Docs & Roadmap
                </Link>
                <button
                  type="button"
                  onClick={() => handleTabChange('plantillas')}
                  className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--tx)] text-[var(--cd)] flex items-center gap-1.5 cursor-pointer hover:opacity-90"
                >
                  <MessageSquare size={14} />
                  Editar Plantillas WhatsApp
                </button>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* PESTAÑA: GESTOR CENTRAL DE COURIERS & TRANSPORTISTAS              */}
      {/* ================================================================== */}
      {activeTab === 'couriers' && (
        <div className="flex flex-col gap-4">
          {courierNotice && (
            <div
              className="bg-cd bd rounded-xl px-4 py-3 text-xs font-medium flex items-center justify-between gap-2"
              style={{
                borderColor: courierNotice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
                color: courierNotice.type === 'ok' ? 'var(--ok)' : 'var(--er)',
              }}
            >
              <span>{courierNotice.text}</span>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Agregar nuevo courier */}
            <section className="lg:col-span-4 bg-cd bd rounded-xl p-5 flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Truck size={15} className="tx-mu" />
                  Agregar Transportista / Courier
                </h2>
                <p className="text-[11px] tx-mu mt-0.5">
                  Aparecerán al instante en <strong>Nuevo Pedido</strong>, <strong>Despacho & Guías</strong>, <strong>Manifiesto</strong> y <strong>Portal Repartidor</strong>.
                </p>
              </div>

              <div className="space-y-2.5">
                <div>
                  <label className="text-[11px] font-semibold tx-mu block mb-1">Nombre *</label>
                  <input
                    type="text"
                    value={newCourierName}
                    onChange={(e) => setNewCourierName(e.target.value)}
                    placeholder="Ej. Boxful, C807, Motorista Juan"
                    className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                  />
                </div>

                <div>
                  <label className="text-[11px] font-semibold tx-mu block mb-1">Tipo</label>
                  <select
                    value={newCourierTipo}
                    onChange={(e) => setNewCourierTipo(e.target.value as CourierTipo)}
                    className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:border-[var(--ac)]"
                  >
                    <option value="motorista">Motorista propio</option>
                    <option value="externo">Courier externo (Cargo / Urbano / Boxful)</option>
                    <option value="encomienda">Encomienda / Departamental</option>
                    <option value="oficina">Retiro en oficina / punto</option>
                  </select>
                </div>

                <div>
                  <label className="text-[11px] font-semibold tx-mu block mb-1">Zonas que cubre (opcional)</label>
                  <input
                    type="text"
                    value={newCourierZonas}
                    onChange={(e) => setNewCourierZonas(e.target.value)}
                    placeholder="Ej. San Salvador, Santa Tecla, Soyapango"
                    className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] font-semibold tx-mu block mb-1">Teléfono (opcional)</label>
                    <input
                      type="text"
                      value={newCourierTel}
                      onChange={(e) => setNewCourierTel(e.target.value)}
                      placeholder="7890-1234"
                      className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold tx-mu block mb-1">PIN QR (4-6 dígitos)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={newCourierPin}
                      onChange={(e) => setNewCourierPin(e.target.value.replace(/\D/g, ''))}
                      placeholder="Ej. 1003"
                      className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs mono font-bold outline-none focus:border-[var(--ac)]"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAddCourier}
                  disabled={savingCouriers}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                  style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                >
                  {savingCouriers ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                  Agregar Courier
                </button>
              </div>

              {/* Seguridad PIN Portal Repartidor & Bucket Storage */}
              <div className="pt-3 mt-1 border-t border-[var(--bd)] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-bold flex items-center gap-1.5">
                    <KeyRound size={14} style={{ color: 'var(--ac)' }} />
                    Seguridad Portal Repartidor
                  </h3>
                  <Link
                    to="/repartidor"
                    className="text-[11px] font-bold hover:underline inline-flex items-center gap-1"
                    style={{ color: 'var(--ac)' }}
                  >
                    Abrir Portal <ExternalLink size={11} />
                  </Link>
                </div>

                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={driverAccess.requirePin}
                    onChange={(e) =>
                      setDriverAccess((prev) => ({ ...prev, requirePin: e.target.checked }))
                    }
                  />
                  <span>Exigir PIN al abrir /repartidor o escanear QR</span>
                </label>

                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-[10px] font-bold uppercase tx-mu block mb-1">
                      PIN Maestro Admin (ve todos)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={driverAccess.adminPin}
                      onChange={(e) =>
                        setDriverAccess((prev) => ({
                          ...prev,
                          adminPin: e.target.value.replace(/\D/g, ''),
                        }))
                      }
                      className="w-full bg-sf bd rounded-xl px-3 py-1.5 text-xs mono font-bold outline-none focus:border-[var(--ac)]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSaveDriverAccess}
                    disabled={savingDriverAccess}
                    className="mt-4 px-3 py-1.5 rounded-xl bg-sf bd hover:border-[var(--ac)] text-xs font-bold cursor-pointer"
                  >
                    {savingDriverAccess ? '...' : 'Guardar PIN'}
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-sf bd space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold flex items-center gap-1.5">
                      <HardDrive size={13} className="text-emerald-500" />
                      Bucket Fotos & Evidencias
                    </span>
                    <button
                      type="button"
                      onClick={handleInitOrdersBucket}
                      disabled={bucketStatus.checking}
                      className="px-2.5 py-1 rounded-lg bg-cd bd text-[11px] font-semibold cursor-pointer hover:border-emerald-500"
                    >
                      {bucketStatus.checking ? 'Creando...' : 'Activar bucket'}
                    </button>
                  </div>
                  <p className="text-[10px] tx-mu">
                    Bucket <code className="mono">orders-evidence</code> en Supabase Storage para fotos de guía, entrega y firma.
                  </p>
                  {bucketStatus.message && (
                    <div
                      className="text-[11px] font-semibold"
                      style={{ color: bucketStatus.ok ? 'var(--ok)' : 'var(--er)' }}
                    >
                      {bucketStatus.message}
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Lista editable de couriers */}
            <section className="lg:col-span-8 bg-cd bd rounded-xl p-5 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[var(--bd)]">
                <div>
                  <h2 className="text-sm font-bold">
                    Couriers Registrados (<span className="font-mono tabular-nums">{couriersList.filter((c) => c.activo).length}</span> activos)
                  </h2>
                  <p className="text-[11px] tx-mu">
                    Origen: {courierSource === 'supabase' ? 'Nube (Supabase)' : 'Respaldo local'} · Asigna PIN numérico a cada motorista para entrar por QR.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetCouriers}
                    disabled={savingCouriers}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sf bd rounded-lg text-xs font-medium cursor-pointer hover:border-[var(--tx)]"
                  >
                    <RotateCcw size={13} /> Restaurar base
                  </button>
                  <button
                    type="button"
                    onClick={() => persistCouriersList(couriersList)}
                    disabled={savingCouriers || !hasUnsavedCouriers}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--tx)] text-[var(--cd)] cursor-pointer disabled:opacity-45 hover:opacity-90"
                  >
                    {savingCouriers ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    {hasUnsavedCouriers ? 'Guardar cambios' : 'Guardado'}
                  </button>
                </div>
              </div>

              {loadingCouriers ? (
                <div className="py-10 text-center text-xs tx-mu">Cargando couriers...</div>
              ) : (
                <div className="space-y-2.5">
                  {couriersList.map((c) => (
                    <div
                      key={c.id}
                      className={`p-3.5 bg-sf bd rounded-xl flex flex-col gap-2.5 ${
                        !c.activo ? 'opacity-65' : ''
                      }`}
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                        <input
                          type="text"
                          value={c.nombre}
                          onChange={(e) => handleUpdateCourierItem(c.id, { nombre: e.target.value })}
                          placeholder="Nombre del courier"
                          className="sm:col-span-3 bg-cd bd rounded-lg px-2.5 py-1.5 text-xs font-bold outline-none focus:border-[var(--ac)]"
                        />
                        <select
                          value={c.tipo}
                          onChange={(e) =>
                            handleUpdateCourierItem(c.id, { tipo: e.target.value as CourierTipo })
                          }
                          className="sm:col-span-2 bg-cd bd rounded-lg px-2 py-1.5 text-xs font-semibold outline-none focus:border-[var(--ac)]"
                        >
                          <option value="motorista">Motorista propio</option>
                          <option value="externo">Courier externo</option>
                          <option value="encomienda">Encomienda</option>
                          <option value="oficina">Retiro en oficina</option>
                        </select>
                        <input
                          type="text"
                          value={c.zonas || ''}
                          onChange={(e) => handleUpdateCourierItem(c.id, { zonas: e.target.value })}
                          placeholder="Zonas de cobertura"
                          className="sm:col-span-3 bg-cd bd rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[var(--ac)]"
                        />
                        <input
                          type="text"
                          value={c.telefono || ''}
                          onChange={(e) => handleUpdateCourierItem(c.id, { telefono: e.target.value })}
                          placeholder="Teléfono"
                          className="sm:col-span-2 bg-cd bd rounded-lg px-2.5 py-1.5 text-xs outline-none focus:border-[var(--ac)]"
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          value={c.pin || ''}
                          onChange={(e) =>
                            handleUpdateCourierItem(c.id, {
                              pin: e.target.value.replace(/\D/g, ''),
                            })
                          }
                          placeholder="PIN QR"
                          title="PIN numérico para iniciar sesión en /repartidor o al escanear QR"
                          className="sm:col-span-2 bg-cd bd rounded-lg px-2.5 py-1.5 text-xs mono font-bold outline-none focus:border-[var(--ac)]"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="tx-mu">
                          ID: <code className="mono">{c.id}</code>
                          {c.pin ? (
                            <span className="ml-2 font-semibold text-emerald-600 dark:text-emerald-400">
                              · PIN: <code className="mono">{c.pin}</code>
                            </span>
                          ) : null}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleToggleCourierItem(c.id)}
                            className="px-2.5 py-1 rounded-lg bg-cd bd font-semibold cursor-pointer"
                            style={{ color: c.activo ? 'var(--ok)' : 'var(--mu)' }}
                          >
                            {c.activo ? 'Activo' : 'Pausado'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCourierItem(c.id)}
                            className="p-1.5 rounded-lg bg-cd bd tx-mu hover:text-rose-500 cursor-pointer"
                            title="Eliminar courier"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
