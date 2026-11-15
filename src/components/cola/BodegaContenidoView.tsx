import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageSquare,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type { StockItem } from '@/types/inventory';
import {
  CONTENT_PILARS,
  DEFAULT_DIST_CONFIG,
  fetchContentVault,
  fetchSocialDistConfig,
  saveContentVault,
  saveSocialDistConfig,
  uploadMediaToVault,
  type ContentOrigin,
  type ContentPilar,
  type ContentStatus,
  type ContentTargets,
  type ContentVaultItem,
  type MetaConnectedPage,
  type SocialDistConfig,
} from '@/lib/contentVault';

interface Props {
  stockItems: StockItem[];
  totalLinkedLeads: number;
  legacyItemsToImport?: Array<{
    id: string;
    nombre: string | null;
    sku: string | null;
    image_url: string | null;
    status: string | null;
    fb_post_id: string | null;
    posted_at: string | null;
    created_at: string | null;
  }>;
  onSyncLegacyQueue?: () => Promise<void>;
}

function normalizeSku(sku?: string | null): string {
  return String(sku || '').trim().toUpperCase();
}

export function BodegaContenidoView({
  stockItems,
  totalLinkedLeads,
  legacyItemsToImport = [],
  onSyncLegacyQueue,
}: Props) {
  const [items, setItems] = useState<ContentVaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<SocialDistConfig>(DEFAULT_DIST_CONFIG);
  const [metaPages, setMetaPages] = useState<MetaConnectedPage[]>([]);
  const [checkingMeta, setCheckingMeta] = useState(false);
  const [showConfigPanel, setShowConfigPanel] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);

  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [copiedCron, setCopiedCron] = useState(false);

  // Filtros de la bodega
  const [pilarFilter, setPilarFilter] = useState<'all' | ContentPilar>('all');
  const [originFilter, setOriginFilter] = useState<'all' | ContentOrigin>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ContentStatus>('all');
  const [search, setSearch] = useState('');

  // Estados de acción
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [runningNext, setRunningNext] = useState(false);

  // Modal Nueva Pieza / Editor
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createTab, setCreateTab] = useState<'manual' | 'catalogo'>('manual');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);

  // Form Manual / Editor
  const [formTitulo, setFormTitulo] = useState('');
  const [formPilar, setFormPilar] = useState<ContentPilar>('demostracion');
  const [formSku, setFormSku] = useState('');
  const [formMediaType, setFormMediaType] = useState<'imagen' | 'video'>('imagen');
  const [formMediaUrl, setFormMediaUrl] = useState('');
  const [formEvergreen, setFormEvergreen] = useState(true);
  const [formStatus, setFormStatus] = useState<ContentStatus>('listo');
  const [formTargets, setFormTargets] = useState<ContentTargets>({
    facebook: true,
    instagram: true,
    youtube: false,
    tiktok: false,
  });
  const [formCopyFb, setFormCopyFb] = useState('');
  const [formCopyIg, setFormCopyIg] = useState('');
  const [formCopyShort, setFormCopyShort] = useState('');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [generatingAi, setGeneratingAi] = useState(false);
  const [savingItem, setSavingItem] = useState(false);

  // Importación masiva desde catálogo
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedCatalogSkus, setSelectedCatalogSkus] = useState<Set<string>>(new Set());
  const [catalogPilar, setCatalogPilar] = useState<ContentPilar>('producto');

  const notify = useCallback((type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 5500);
  }, []);

  const stockBySku = useMemo(() => {
    const map = new Map<string, StockItem>();
    for (const s of stockItems) {
      map.set(normalizeSku(s.sku), s);
    }
    return map;
  }, [stockItems]);

  const validCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return stockItems
      .filter((s) => {
        const key = s.sku.toLowerCase();
        if (key.includes('fee') || key.includes('test') || key.includes('descuento')) return false;
        if (s.activo === false) return false;
        if (!q) return true;
        return s.nombre.toLowerCase().includes(q) || s.sku.toLowerCase().includes(q);
      })
      .sort((a, b) => b.stock_disponible - a.stock_disponible);
  }, [stockItems, catalogSearch]);

  const loadMetaAccounts = useCallback(async () => {
    setCheckingMeta(true);
    try {
      const res = await fetch('/api/content-distribute?action=accounts');
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data?.pages)) {
        setMetaPages(data.pages);
      }
    } catch {}
    setCheckingMeta(false);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [vaultList, cfg] = await Promise.all([
        fetchContentVault(),
        fetchSocialDistConfig(),
      ]);
      setItems(vaultList);
      setConfig(cfg);
      setFormTargets(cfg.defaultTargets);
    } finally {
      setLoading(false);
    }
    void loadMetaAccounts();
  }, [loadMetaAccounts]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const activeMetaPage = useMemo(() => {
    return (
      metaPages.find((p) => p.page_id === config.defaultPageId && p.has_token) ||
      metaPages.find((p) => p.has_token) ||
      metaPages[0] ||
      null
    );
  }, [metaPages, config.defaultPageId]);

  const metrics = useMemo(() => {
    const todayStr = new Date().toDateString();
    let readyCount = 0;
    let publishedCount = 0;
    let publishedToday = 0;
    let pausedStockCount = 0;
    let evergreenCount = 0;

    for (const it of items) {
      const st = it.sku ? stockBySku.get(normalizeSku(it.sku)) : undefined;
      const isOut = Boolean(st && st.stock_disponible <= 0 && config.autoSkipOutOfStock);

      if (it.status === 'listo' || it.status === 'programado') {
        if (isOut) pausedStockCount++;
        else readyCount++;
      } else if (it.status === 'pausado_stock') {
        pausedStockCount++;
      } else if (it.status === 'publicado') {
        publishedCount++;
        if (it.publishResults?.published_at && new Date(it.publishResults.published_at).toDateString() === todayStr) {
          publishedToday++;
        }
      }
      if (it.evergreen) evergreenCount++;
    }

    return {
      total: items.length,
      readyCount,
      publishedCount,
      publishedToday,
      pausedStockCount,
      evergreenCount,
    };
  }, [items, stockBySku, config.autoSkipOutOfStock]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (pilarFilter !== 'all' && it.pilar !== pilarFilter) return false;
      if (originFilter !== 'all' && it.origen !== originFilter) return false;
      if (statusFilter !== 'all' && it.status !== statusFilter) return false;
      if (q) {
        const hay = [it.titulo, it.sku, it.copies?.fb, it.copies?.ig]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
        if (!hay) return false;
      }
      return true;
    });
  }, [items, pilarFilter, originFilter, statusFilter, search]);

  const resetForm = () => {
    setEditingItemId(null);
    setFormTitulo('');
    setFormPilar('demostracion');
    setFormSku('');
    setFormMediaType('imagen');
    setFormMediaUrl('');
    setFormEvergreen(true);
    setFormStatus('listo');
    setFormTargets({ ...config.defaultTargets });
    setFormCopyFb('');
    setFormCopyIg('');
    setFormCopyShort('');
  };

  const openEditModal = (it: ContentVaultItem) => {
    setEditingItemId(it.id);
    setCreateTab('manual');
    setFormTitulo(it.titulo);
    setFormPilar(it.pilar);
    setFormSku(it.sku || '');
    setFormMediaType(it.mediaType);
    setFormMediaUrl(it.mediaUrl);
    setFormEvergreen(it.evergreen);
    setFormStatus(it.status);
    setFormTargets({ ...it.targets });
    setFormCopyFb(it.copies?.fb || '');
    setFormCopyIg(it.copies?.ig || '');
    setFormCopyShort(it.copies?.short || '');
    setShowCreateModal(true);
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    const res = await uploadMediaToVault(file);
    setUploadingFile(false);
    if (res.ok && res.publicUrl) {
      setFormMediaUrl(res.publicUrl);
      setFormMediaType(res.mediaType);
      if (!formTitulo.trim()) {
        setFormTitulo(file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '));
      }
      notify('ok', 'Archivo subido a Supabase Storage con URL pública lista para FB/IG.');
    } else {
      notify('err', res.error || 'No se pudo subir el archivo.');
    }
    e.target.value = '';
  };

  const handleGenerateAiCopies = async () => {
    if (!formTitulo.trim() && !formSku.trim()) {
      notify('err', 'Escribe un título o selecciona un SKU primero.');
      return;
    }
    setGeneratingAi(true);
    try {
      const stockInfo = formSku ? stockBySku.get(normalizeSku(formSku)) : undefined;
      const res = await fetch('/api/content-distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_copy',
          titulo: formTitulo || stockInfo?.nombre,
          pilar: formPilar,
          sku: formSku || null,
          precio: stockInfo?.precio_venta || null,
          mediaType: formMediaType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.copies) {
        notify('err', data?.error || 'Error generando copys con IA.');
      } else {
        setFormCopyFb(data.copies.fb || '');
        setFormCopyIg(data.copies.ig || '');
        setFormCopyShort(data.copies.short || '');
        notify('ok', 'Copys optimizados para Facebook, Instagram y Shorts generados.');
      }
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleSaveManualItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitulo.trim()) {
      notify('err', 'El título de la pieza es obligatorio.');
      return;
    }
    setSavingItem(true);
    const nowIso = new Date().toISOString();

    let nextItems: ContentVaultItem[];
    if (editingItemId) {
      nextItems = items.map((it) =>
        it.id === editingItemId
          ? {
              ...it,
              titulo: formTitulo.trim(),
              pilar: formPilar,
              sku: formSku.trim().toUpperCase() || null,
              mediaType: formMediaType,
              mediaUrl: formMediaUrl.trim(),
              evergreen: formEvergreen,
              status: formStatus,
              targets: { ...formTargets },
              copies: {
                fb: formCopyFb.trim(),
                ig: formCopyIg.trim(),
                short: formCopyShort.trim(),
              },
              updatedAt: nowIso,
            }
          : it
      );
    } else {
      const newItem: ContentVaultItem = {
        id: `cv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        origen: formSku.trim() ? 'catalogo' : 'manual',
        pilar: formPilar,
        titulo: formTitulo.trim(),
        sku: formSku.trim().toUpperCase() || null,
        mediaType: formMediaType,
        mediaUrl: formMediaUrl.trim(),
        evergreen: formEvergreen,
        cooldownDays: 45,
        status: formStatus,
        targets: { ...formTargets },
        copies: {
          fb: formCopyFb.trim(),
          ig: formCopyIg.trim(),
          short: formCopyShort.trim(),
        },
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      nextItems = [newItem, ...items];
    }

    const ok = await saveContentVault(nextItems);
    setSavingItem(false);
    if (ok) {
      setItems(nextItems);
      setShowCreateModal(false);
      resetForm();
      notify('ok', editingItemId ? 'Pieza actualizada en la Bodega.' : 'Pieza agregada a la Bodega.');
    } else {
      notify('err', 'Se guardó localmente, revisa conexión con Supabase.');
      setItems(nextItems);
    }
  };

  const handleBulkAddFromCatalog = async () => {
    const chosen = validCatalog.filter((c) => selectedCatalogSkus.has(c.sku));
    if (chosen.length === 0) return;

    setSavingItem(true);
    const nowIso = new Date().toISOString();
    const created: ContentVaultItem[] = chosen.map((c, idx) => ({
      id: `cv-${Date.now() + idx}-${Math.random().toString(36).slice(2, 5)}`,
      origen: 'catalogo',
      pilar: catalogPilar,
      titulo: c.nombre,
      sku: c.sku,
      mediaType: 'imagen',
      mediaUrl: c.image_url || '',
      evergreen: true,
      cooldownDays: 45,
      status: 'listo',
      targets: { ...config.defaultTargets },
      copies: {
        fb: `🔥 ¡Disponible! *${c.nombre}* ${c.precio_venta ? `por solo $${Number(c.precio_venta).toFixed(2)}` : ''}\n🚚 Envíos rápidos contra entrega en todo El Salvador.\n💬 Comenta INFO o escríbenos por WhatsApp para pedir el tuyo.`,
        ig: `✨ ${c.nombre} ${c.precio_venta ? `($${Number(c.precio_venta).toFixed(2)})` : ''} — Pago contra entrega en todo El Salvador 🇸🇻\nEscríbenos por DM o WhatsApp.\n#todoenunosv #elsalvador #comprasv #contraentregasv`,
        short: `${c.nombre} disponible contra entrega #Shorts`,
      },
      createdAt: nowIso,
      updatedAt: nowIso,
    }));

    const nextItems = [...created, ...items];
    await saveContentVault(nextItems);
    setItems(nextItems);
    setSelectedCatalogSkus(new Set());
    setShowCreateModal(false);
    setSavingItem(false);
    notify('ok', `${created.length} pieza(s) del catálogo agregadas a la Bodega.`);
  };

  const handleImportLegacyQueue = async () => {
    if (legacyItemsToImport.length === 0) return;
    const existingLegacyIds = new Set(items.map((i) => i.legacyQueueId).filter(Boolean));
    const fresh = legacyItemsToImport.filter((l) => !existingLegacyIds.has(l.id));
    if (fresh.length === 0) {
      notify('ok', 'Todos los elementos de la cola clásica ya están en la Bodega.');
      return;
    }
    const nowIso = new Date().toISOString();
    const converted: ContentVaultItem[] = fresh.map((l, idx) => {
      const stockInfo = l.sku ? stockBySku.get(normalizeSku(l.sku)) : undefined;
      return {
        id: `cv-imp-${Date.now() + idx}-${Math.random().toString(36).slice(2, 5)}`,
        origen: 'catalogo',
        pilar: 'producto',
        titulo: l.nombre || l.sku || 'Producto',
        sku: l.sku ? normalizeSku(l.sku) : null,
        mediaType: 'imagen',
        mediaUrl: l.image_url || stockInfo?.image_url || '',
        evergreen: true,
        cooldownDays: 45,
        status: l.status === 'posted' ? 'publicado' : 'listo',
        targets: { ...config.defaultTargets },
        copies: {
          fb: `🔥 ${l.nombre || l.sku} disponible para envío inmediato contra entrega en todo El Salvador.`,
          ig: `✨ ${l.nombre || l.sku} · Envíos a todo El Salvador 🇸🇻 #todoenunosv`,
          short: `${l.nombre || l.sku} #Shorts`,
        },
        publishResults: l.fb_post_id
          ? { fb_post_id: l.fb_post_id, published_at: l.posted_at || undefined }
          : undefined,
        legacyQueueId: l.id,
        createdAt: l.created_at || nowIso,
        updatedAt: nowIso,
      };
    });

    const nextItems = [...items, ...converted];
    await saveContentVault(nextItems);
    setItems(nextItems);
    notify('ok', `${converted.length} producto(s) importados desde la Cola clásica.`);
  };

  const handlePublishItem = async (it: ContentVaultItem) => {
    setPublishingId(it.id);
    try {
      const res = await fetch('/api/content-distribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          item: it,
          pageId: config.defaultPageId || activeMetaPage?.page_id,
          igUserId: config.igAccountIdOverride || activeMetaPage?.instagram_business_account?.id,
          targets: it.targets,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (data?.skippedOutOfStock) {
        const refreshed = await fetchContentVault();
        setItems(refreshed);
        notify('err', data.error || 'Pausado automáticamente por falta de stock.');
        return;
      }

      if (!res.ok || !data?.ok) {
        const refreshed = await fetchContentVault();
        setItems(refreshed);
        notify('err', data?.error || 'Meta rechazó la publicación.');
        return;
      }

      const refreshed = await fetchContentVault();
      setItems(refreshed);
      if (onSyncLegacyQueue) await onSyncLegacyQueue();

      const fbTag = data?.results?.fb?.ok ? 'Facebook ✓' : data?.results?.fb ? 'Facebook ✗' : '';
      const igTag = data?.results?.ig?.ok ? 'Instagram ✓' : data?.results?.ig ? 'Instagram ✗' : '';
      notify('ok', `Publicado: ${[fbTag, igTag].filter(Boolean).join(' · ')}`);
    } catch (err: any) {
      notify('err', err?.message || 'Error de red publicando en Meta.');
    } finally {
      setPublishingId(null);
    }
  };

  const handleRunNextCron = async () => {
    setRunningNext(true);
    try {
      const res = await fetch('/api/content-distribute?action=run_next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run_next' }),
      });
      const data = await res.json().catch(() => ({}));
      const refreshed = await fetchContentVault();
      setItems(refreshed);
      if (data?.published === false) {
        notify('err', data.reason || 'No hay piezas listas con stock.');
      } else if (res.ok && data?.ok) {
        notify('ok', `Publicado automático "${data?.item?.titulo || 'pieza'}" correctamente.`);
      } else {
        notify('err', data?.error || 'Error ejecutando siguiente publicación.');
      }
    } finally {
      setRunningNext(false);
    }
  };

  const handleRecycle = async (it: ContentVaultItem) => {
    const next = items.map((x) =>
      x.id === it.id ? { ...x, status: 'listo' as ContentStatus, updatedAt: new Date().toISOString() } : x
    );
    await saveContentVault(next);
    setItems(next);
    notify('ok', `"${it.titulo}" regresó a Listo para distribuir.`);
  };

  const handleDeleteItem = async (id: string) => {
    const next = items.filter((x) => x.id !== id);
    await saveContentVault(next);
    setItems(next);
    notify('ok', 'Pieza eliminada de la Bodega.');
  };

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    await saveSocialDistConfig(config);
    setSavingConfig(false);
    setShowConfigPanel(false);
    notify('ok', 'Configuración de Distribuidora guardada.');
  };

  const cronEndpointUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/content-distribute?action=run_next`
      : 'https://todoenuno-panel.vercel.app/api/content-distribute?action=run_next';

  return (
    <div className="space-y-5">
      {/* BANNER META DUAL (FACEBOOK + INSTAGRAM BUSINESS) */}
      <section className="bg-cd bd rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                <Film size={12} /> Bodega de Contenido + Distribuidora Meta (Fase 1)
              </span>
              {activeMetaPage?.has_token ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  <CheckCircle2 size={12} /> FB: {activeMetaPage.page_name}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                  <AlertTriangle size={12} /> Sin página conectada en fb_pages
                </span>
              )}
              {activeMetaPage?.instagram_business_account || config.igAccountIdOverride ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-pink-500/10 text-pink-600 border border-pink-500/20">
                  <CheckCircle2 size={12} /> IG:{' '}
                  {activeMetaPage?.instagram_business_account?.username
                    ? `@${activeMetaPage.instagram_business_account.username}`
                    : `ID ${config.igAccountIdOverride}`}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-sf bd tx-mu">
                  IG Business no detectado aún
                </span>
              )}
            </div>
            <p className="text-xs tx-mu">
              Sube videos o imágenes de marca/testimonios/ofertas y combínalos con tu catálogo. Protegido contra SKUs agotados (stock = 0).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowConfigPanel((v) => !v)}
              className="px-3 py-2 rounded-xl bg-sf bd text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-85 cursor-pointer"
            >
              <Settings2 size={14} /> Canales y Cron
            </button>

            <button
              type="button"
              onClick={handleRunNextCron}
              disabled={runningNext || metrics.readyCount === 0}
              className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              title="Publica la siguiente pieza lista con stock disponible en tus redes activas"
            >
              {runningNext ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
              Publicar Siguiente Ahora
            </button>

            <button
              type="button"
              onClick={() => {
                resetForm();
                setCreateTab('manual');
                setShowCreateModal(true);
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
              style={{ background: 'var(--tx)', color: 'var(--cd)' }}
            >
              <Plus size={14} /> Nueva Pieza
            </button>
          </div>
        </div>

        {/* PANEL DESPLEGABLE DE CANALES META & CRON */}
        {showConfigPanel && (
          <div className="pt-4 border-t border-[var(--bd)] grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tx-mu block">
                Facebook Page (Token en fb_pages)
              </label>
              <div className="flex gap-2">
                <select
                  value={config.defaultPageId || activeMetaPage?.page_id || ''}
                  onChange={(e) => setConfig((prev) => ({ ...prev, defaultPageId: e.target.value }))}
                  className="flex-1 px-3 py-2 rounded-xl bg-sf bd text-xs font-semibold outline-none"
                >
                  {metaPages.length === 0 && <option value="">Sin páginas en fb_pages</option>}
                  {metaPages.map((p) => (
                    <option key={p.page_id} value={p.page_id}>
                      {p.page_name} {p.instagram_business_account ? `(+ IG @${p.instagram_business_account.username || p.instagram_business_account.id})` : ''}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={loadMetaAccounts}
                  disabled={checkingMeta}
                  className="px-3 py-2 rounded-xl bg-sf bd text-xs font-bold"
                  title="Re-verificar páginas e Instagram vinculado"
                >
                  <RefreshCw size={13} className={checkingMeta ? 'animate-spin' : ''} />
                </button>
              </div>
              <input
                value={config.igAccountIdOverride}
                onChange={(e) => setConfig((prev) => ({ ...prev, igAccountIdOverride: e.target.value }))}
                placeholder="IG Business ID manual (opcional si ya lo auto-detectó)"
                className="w-full px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tx-mu block">
                Reglas de Seguridad & Destinos por Defecto
              </label>
              <label className="flex items-center gap-2 p-2.5 rounded-xl bg-sf bd text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoSkipOutOfStock}
                  onChange={(e) => setConfig((prev) => ({ ...prev, autoSkipOutOfStock: e.target.checked }))}
                  className="rounded"
                />
                <span className="font-semibold">Saltar automáticamente productos con Stock = 0</span>
              </label>
              <div className="flex flex-wrap gap-2 text-xs">
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.defaultTargets.facebook}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        defaultTargets: { ...p.defaultTargets, facebook: e.target.checked },
                      }))
                    }
                  />
                  <span>Facebook Page</span>
                </label>
                <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.defaultTargets.instagram}
                    onChange={(e) =>
                      setConfig((p) => ({
                        ...p,
                        defaultTargets: { ...p.defaultTargets, instagram: e.target.checked },
                      }))
                    }
                  />
                  <span>Instagram Reels/Feed</span>
                </label>
                <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sf bd opacity-55">
                  YT Shorts &amp; TikTok (Fase 2-3)
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tx-mu block">
                Endpoint para tu Cron / n8n (Auto-Publicador)
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={cronEndpointUrl}
                  className="flex-1 px-3 py-2 rounded-xl bg-sf bd text-[11px] font-mono outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(cronEndpointUrl);
                    setCopiedCron(true);
                    setTimeout(() => setCopiedCron(false), 2000);
                  }}
                  className="px-3 py-2 rounded-xl bg-sf bd text-xs font-bold inline-flex items-center gap-1"
                >
                  {copiedCron ? <Check size={13} /> : <Copy size={13} />}
                </button>
              </div>
              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                >
                  {savingConfig ? 'Guardando...' : 'Guardar Configuración'}
                </button>
              </div>
            </div>
          </div>
        )}
      </section>

      {banner && (
        <div
          className="bg-cd bd rounded-xl px-4 py-3 text-xs font-medium flex items-center justify-between gap-3"
          style={{
            borderColor: banner.type === 'ok' ? 'var(--ok)' : 'var(--er)',
            color: banner.type === 'ok' ? 'var(--ok)' : 'var(--er)',
          }}
        >
          <span>{banner.text}</span>
          <button type="button" onClick={() => setBanner(null)} className="p-1 cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* KPIs DE BODEGA */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-cd bd rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Listos para distribuir</span>
            <Clock size={15} className="text-indigo-500" />
          </div>
          <div className="text-2xl font-black mono mt-2">{metrics.readyCount}</div>
          <div className="text-xs tx-mu mt-0.5">
            {metrics.pausedStockCount > 0
              ? `${metrics.pausedStockCount} pausados por stock 0`
              : 'Todos con stock válido'}
          </div>
        </div>

        <div className="bg-cd bd rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Publicados (FB / IG)</span>
            <Send size={15} className="text-emerald-500" />
          </div>
          <div className="text-2xl font-black mono mt-2">{metrics.publishedCount}</div>
          <div className="text-xs tx-mu mt-0.5">{metrics.publishedToday} publicados hoy</div>
        </div>

        <div className="bg-cd bd rounded-2xl p-4">
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Piezas Evergreen</span>
            <RotateCcw size={15} className="text-amber-500" />
          </div>
          <div className="text-2xl font-black mono mt-2">{metrics.evergreenCount}</div>
          <div className="text-xs tx-mu mt-0.5">Reciclables cada 45 días</div>
        </div>

        <Link
          to="/social-inbox"
          className="bg-cd bd rounded-2xl p-4 hover:border-[var(--ac)] transition-colors flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Leads desde posts</span>
            <MessageSquare size={15} className="text-sky-500" />
          </div>
          <div className="text-2xl font-black mono mt-2">{totalLinkedLeads}</div>
          <div className="text-xs tx-mu mt-0.5">Comentarios en FB/IG</div>
        </Link>
      </section>

      {/* INVITACIÓN A IMPORTAR SI LA BODEGA ESTÁ VACÍA Y HAY EN COLA CLÁSICA */}
      {!loading && items.length === 0 && legacyItemsToImport.length > 0 && (
        <div className="bg-cd bd rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-indigo-500/30">
          <div className="text-xs">
            <strong className="text-sm block">
              Tienes {legacyItemsToImport.length} publicación(es) en tu Cola Clásica
            </strong>
            <span className="tx-mu">
              Puedes importarlas a tu nueva Bodega con 1 clic para darles copys de Instagram y control anti-agotados.
            </span>
          </div>
          <button
            type="button"
            onClick={handleImportLegacyQueue}
            className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shrink-0"
          >
            Importar a Bodega ({legacyItemsToImport.length})
          </button>
        </div>
      )}

      {/* BARRA DE FILTROS POR PILAR Y ESTADO */}
      <section className="bg-cd bd rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setPilarFilter('all')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold border whitespace-nowrap ${
              pilarFilter === 'all' ? 'bg-sf border-[var(--tx)] text-[var(--tx)]' : 'border-[var(--bd)] tx-mu'
            }`}
          >
            Todos los pilares ({items.length})
          </button>
          {CONTENT_PILARS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPilarFilter(p.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border whitespace-nowrap ${
                pilarFilter === p.id ? 'bg-sf border-[var(--tx)] text-[var(--tx)]' : 'border-[var(--bd)] tx-mu'
              }`}
            >
              {p.emoji} {p.label}
            </button>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <select
            value={originFilter}
            onChange={(e) => setOriginFilter(e.target.value as any)}
            className="px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
          >
            <option value="all">Origen: Todos</option>
            <option value="manual">Manual / Marca</option>
            <option value="catalogo">Desde Catálogo</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
          >
            <option value="all">Estado: Todos</option>
            <option value="listo">Listos para publicar</option>
            <option value="borrador">Borradores</option>
            <option value="publicado">Publicados</option>
            <option value="pausado_stock">Pausados por stock</option>
            <option value="error">Con error</option>
          </select>

          <div className="relative flex-1">
            <Search size={14} className="tx-mu absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por título, SKU o copy..."
              className="w-full bg-sf bd rounded-xl pl-8 pr-3 py-2 text-xs outline-none"
            />
          </div>
        </div>
      </section>

      {/* GRILLA DE PIEZAS EN BODEGA */}
      {loading ? (
        <div className="py-12 text-center text-xs tx-mu">Cargando Bodega de Contenido...</div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-cd bd rounded-2xl p-12 text-center space-y-3">
          <Layers size={32} className="mx-auto tx-mu" />
          <div className="text-sm font-bold">Tu Bodega de Contenido está lista para llenarse</div>
          <p className="text-xs tx-mu max-w-md mx-auto">
            Sube videos cortos, testimonios o fotos de productos, genera copys automáticos para Facebook e Instagram y publícalos sin miedo a pautar productos agotados.
          </p>
          <button
            type="button"
            onClick={() => {
              resetForm();
              setCreateTab('manual');
              setShowCreateModal(true);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5"
            style={{ background: 'var(--tx)', color: 'var(--cd)' }}
          >
            <Plus size={14} /> Agregar primera pieza
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredItems.map((it) => {
            const pilarMeta = CONTENT_PILARS.find((p) => p.id === it.pilar) || CONTENT_PILARS[0];
            const stockInfo = it.sku ? stockBySku.get(normalizeSku(it.sku)) : undefined;
            const outOfStock = Boolean(stockInfo && stockInfo.stock_disponible <= 0);
            const busy = publishingId === it.id;

            return (
              <article key={it.id} className="bg-cd bd rounded-2xl overflow-hidden flex flex-col justify-between shadow-sm">
                <div>
                  {/* Preview multimedia */}
                  <div className="relative h-44 bg-sf border-b border-[var(--bd)] flex items-center justify-center overflow-hidden">
                    {it.mediaUrl ? (
                      it.mediaType === 'video' ? (
                        <video
                          src={it.mediaUrl}
                          controls
                          preload="metadata"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img src={it.mediaUrl} alt={it.titulo} className="w-full h-full object-cover" />
                      )
                    ) : (
                      <div className="text-center tx-mu space-y-1">
                        {it.mediaType === 'video' ? <Film size={26} className="mx-auto" /> : <ImageIcon size={26} className="mx-auto" />}
                        <span className="text-[11px] block">Solo texto / sin archivo</span>
                      </div>
                    )}

                    <div className="absolute top-2.5 left-2.5 flex flex-wrap gap-1">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/70 text-white backdrop-blur-sm">
                        {pilarMeta.emoji} {pilarMeta.label}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-black/60 text-white backdrop-blur-sm">
                        {it.mediaType === 'video' ? '🎬 Video' : '🖼️ Imagen'}
                      </span>
                    </div>

                    <div className="absolute top-2.5 right-2.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                          it.status === 'publicado'
                            ? 'bg-emerald-600 text-white'
                            : it.status === 'pausado_stock' || outOfStock
                            ? 'bg-rose-600 text-white'
                            : it.status === 'error'
                            ? 'bg-rose-600 text-white'
                            : it.status === 'borrador'
                            ? 'bg-zinc-600 text-white'
                            : 'bg-indigo-600 text-white'
                        }`}
                      >
                        {outOfStock && it.status !== 'publicado' ? 'Stock 0' : it.status}
                      </span>
                    </div>
                  </div>

                  {/* Cuerpo */}
                  <div className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-black leading-snug line-clamp-2">{it.titulo}</h3>
                      {it.evergreen && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-bold">
                          ♻️ Evergreen
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {it.sku ? (
                        <span
                          className={`px-2 py-0.5 rounded-md font-mono font-bold border ${
                            outOfStock
                              ? 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                              : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                          }`}
                        >
                          #{it.sku} {stockInfo ? `· ${stockInfo.stock_disponible} disp.` : ''}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-md bg-sf bd tx-mu">Contenido general / Marca</span>
                      )}

                      {it.targets.facebook && (
                        <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 font-bold text-[10px]">
                          FB {it.publishResults?.fb_post_id ? '✓' : ''}
                        </span>
                      )}
                      {it.targets.instagram && (
                        <span className="px-1.5 py-0.5 rounded bg-pink-500/10 text-pink-600 font-bold text-[10px]">
                          IG {it.publishResults?.ig_media_id ? '✓' : ''}
                        </span>
                      )}
                      {(it.targets.youtube || it.copies?.short) && (
                        <span className="px-1.5 py-0.5 rounded bg-sf bd tx-mu text-[10px]">YT/TT listo</span>
                      )}
                    </div>

                    <p className="text-[11px] tx-mu bg-sf bd rounded-xl p-2.5 line-clamp-3 whitespace-pre-wrap">
                      {it.copies?.fb || it.copies?.ig || 'Sin copy redactado todavía — edita para generar con IA.'}
                    </p>

                    {it.publishResults?.error && (
                      <p className="text-[11px] text-rose-600 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">
                        {it.publishResults.error}
                      </p>
                    )}
                  </div>
                </div>

                {/* Pie de acciones */}
                <div className="p-3 border-t border-[var(--bd)] bg-sf flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditModal(it)}
                      className="px-2.5 py-1.5 rounded-lg bg-cd bd text-xs font-bold inline-flex items-center gap-1 hover:border-[var(--ac)] cursor-pointer"
                    >
                      <Edit3 size={12} /> Editar / IA
                    </button>

                    {(it.status === 'publicado' || it.status === 'pausado_stock') && (
                      <button
                        type="button"
                        onClick={() => handleRecycle(it)}
                        className="px-2.5 py-1.5 rounded-lg bg-cd bd text-xs font-bold inline-flex items-center gap-1 hover:border-amber-500 cursor-pointer"
                        title="Regresar a Listo para distribuir"
                      >
                        <RotateCcw size={12} /> Reciclar
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDeleteItem(it.id)}
                      className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                      title="Eliminar de Bodega"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={busy || (outOfStock && config.autoSkipOutOfStock)}
                    onClick={() => handlePublishItem(it)}
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
                    {busy ? 'Publicando...' : 'Publicar FB/IG'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* MODAL CREAR / EDITAR PIEZA EN BODEGA */}
      {showCreateModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowCreateModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[92vh] flex flex-col rounded-2xl bg-cd bd shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] bg-sf flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film size={18} className="text-indigo-500" />
                <h3 className="font-black text-sm">
                  {editingItemId ? 'Editar Pieza de Contenido' : 'Agregar a Bodega de Contenido'}
                </h3>
              </div>
              <button type="button" onClick={() => setShowCreateModal(false)} className="p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            {!editingItemId && (
              <div className="px-5 pt-3 flex gap-2 border-b border-[var(--bd)] bg-sf/50">
                <button
                  type="button"
                  onClick={() => setCreateTab('manual')}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors ${
                    createTab === 'manual'
                      ? 'border-[var(--tx)] text-[var(--tx)]'
                      : 'border-transparent tx-mu'
                  }`}
                >
                  🎬 Pieza Manual (Video / Imagen / Marca)
                </button>
                <button
                  type="button"
                  onClick={() => setCreateTab('catalogo')}
                  className={`px-3 py-2 text-xs font-bold border-b-2 transition-colors ${
                    createTab === 'catalogo'
                      ? 'border-[var(--tx)] text-[var(--tx)]'
                      : 'border-transparent tx-mu'
                  }`}
                >
                  📦 Importar desde Catálogo ({validCatalog.filter((c) => c.stock_disponible > 0).length} con stock)
                </button>
              </div>
            )}

            {createTab === 'manual' ? (
              <form onSubmit={handleSaveManualItem} className="p-5 space-y-4 overflow-y-auto flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase tx-mu block mb-1">
                      Título / Tema de la pieza *
                    </label>
                    <input
                      required
                      value={formTitulo}
                      onChange={(e) => setFormTitulo(e.target.value)}
                      placeholder="Ej. Unboxing Mini Masajeadores o Testimonio cliente"
                      className="w-full px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-bold uppercase tx-mu block mb-1">Pilar de Contenido</label>
                    <select
                      value={formPilar}
                      onChange={(e) => setFormPilar(e.target.value as ContentPilar)}
                      className="w-full px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
                    >
                      {CONTENT_PILARS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.emoji} {p.label} — {p.hint}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Archivo / URL */}
                <div className="p-3.5 rounded-xl bg-sf bd space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tx-mu">
                      Archivo multimedia (Imagen o Video MP4 para Reels)
                    </span>
                    <label className="px-3 py-1.5 rounded-lg bg-cd bd text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer hover:border-[var(--ac)]">
                      {uploadingFile ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                      <span>{uploadingFile ? 'Subiendo...' : 'Subir archivo desde PC'}</span>
                      <input
                        type="file"
                        accept="image/*,video/mp4,video/quicktime,video/webm"
                        onChange={handleFileSelected}
                        className="hidden"
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <select
                      value={formMediaType}
                      onChange={(e) => setFormMediaType(e.target.value as 'imagen' | 'video')}
                      className="px-3 py-2 rounded-xl bg-cd bd text-xs outline-none"
                    >
                      <option value="imagen">🖼️ Imagen</option>
                      <option value="video">🎬 Video / Reel</option>
                    </select>
                    <input
                      value={formMediaUrl}
                      onChange={(e) => setFormMediaUrl(e.target.value)}
                      placeholder="URL pública directa (.jpg / .mp4) — requerida para Instagram"
                      className="sm:col-span-3 px-3 py-2 rounded-xl bg-cd bd text-xs outline-none"
                    />
                  </div>
                </div>

                {/* SKU opcional + Destinos + Evergreen */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-bold uppercase tx-mu block mb-1">
                      SKU vinculado (opcional — protege contra stock 0)
                    </label>
                    <select
                      value={formSku}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormSku(val);
                        const match = stockBySku.get(normalizeSku(val));
                        if (match && !formMediaUrl && match.image_url) {
                          setFormMediaUrl(match.image_url);
                        }
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
                    >
                      <option value="">Sin SKU (Contenido general / marca)</option>
                      {validCatalog.map((c) => (
                        <option key={c.sku} value={c.sku}>
                          #{c.sku} — {c.nombre} ({c.stock_disponible} disp.)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[11px] font-bold uppercase tx-mu block mb-1">Estado inicial</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as ContentStatus)}
                      className="w-full px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
                    >
                      <option value="listo">✅ Listo para publicar / Cron</option>
                      <option value="borrador">📝 Borrador</option>
                      <option value="programado">📅 Programado</option>
                    </select>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formTargets.facebook}
                        onChange={(e) => setFormTargets((t) => ({ ...t, facebook: e.target.checked }))}
                      />
                      <span>Facebook</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formTargets.instagram}
                        onChange={(e) => setFormTargets((t) => ({ ...t, instagram: e.target.checked }))}
                      />
                      <span>Instagram</span>
                    </label>
                    <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formTargets.youtube}
                        onChange={(e) => setFormTargets((t) => ({ ...t, youtube: e.target.checked }))}
                      />
                      <span>YT Shorts (prep.)</span>
                    </label>
                  </div>

                  <label className="inline-flex items-center gap-1.5 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formEvergreen}
                      onChange={(e) => setFormEvergreen(e.target.checked)}
                    />
                    <span>♻️ Pieza Evergreen (reciclable)</span>
                  </label>
                </div>

                {/* Copys Omnicanal IA */}
                <div className="space-y-2.5 pt-2 border-t border-[var(--bd)]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-black uppercase tx-mu">
                      Copys por Red Social
                    </span>
                    <button
                      type="button"
                      onClick={handleGenerateAiCopies}
                      disabled={generatingAi}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      {generatingAi ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                      {generatingAi ? 'Generando...' : 'Generar Copys IA (FB + IG + Short)'}
                    </button>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold tx-mu block mb-1">Copy Facebook Page</label>
                    <textarea
                      rows={3}
                      value={formCopyFb}
                      onChange={(e) => setFormCopyFb(e.target.value)}
                      placeholder="Texto descriptivo con llamado a WhatsApp / comentarios..."
                      className="w-full p-2.5 rounded-xl bg-sf bd text-xs outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold tx-mu block mb-1">Caption Instagram (Reels / Feed)</label>
                    <textarea
                      rows={3}
                      value={formCopyIg}
                      onChange={(e) => setFormCopyIg(e.target.value)}
                      placeholder="Gancho + hashtags locales..."
                      className="w-full p-2.5 rounded-xl bg-sf bd text-xs outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold tx-mu block mb-1">Título corto YouTube Shorts / TikTok</label>
                    <input
                      value={formCopyShort}
                      onChange={(e) => setFormCopyShort(e.target.value)}
                      placeholder="Máximo 95 caracteres + #Shorts"
                      className="w-full px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 rounded-xl bg-sf bd text-xs font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={savingItem}
                    className="px-5 py-2 rounded-xl text-xs font-black"
                    style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                  >
                    {savingItem ? 'Guardando...' : editingItemId ? 'Guardar Cambios' : 'Guardar en Bodega'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="p-5 space-y-3 overflow-y-auto flex-1">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    value={catalogSearch}
                    onChange={(e) => setCatalogSearch(e.target.value)}
                    placeholder="Buscar producto en inventario..."
                    className="flex-1 px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
                  />
                  <select
                    value={catalogPilar}
                    onChange={(e) => setCatalogPilar(e.target.value as ContentPilar)}
                    className="px-3 py-2 rounded-xl bg-sf bd text-xs outline-none"
                  >
                    <option value="producto">Pilar: Producto</option>
                    <option value="oferta">Pilar: Oferta / Promo</option>
                  </select>
                </div>

                <div className="max-h-72 overflow-y-auto divide-y divide-[var(--bd)] border border-[var(--bd)] rounded-xl">
                  {validCatalog.map((c) => {
                    const checked = selectedCatalogSkus.has(c.sku);
                    const disabled = c.stock_disponible <= 0;
                    return (
                      <label
                        key={c.sku}
                        className={`p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-sf ${
                          disabled ? 'opacity-50' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={checked}
                            onChange={() => {
                              setSelectedCatalogSkus((prev) => {
                                const next = new Set(prev);
                                if (next.has(c.sku)) next.delete(c.sku);
                                else next.add(c.sku);
                                return next;
                              });
                            }}
                          />
                          {c.image_url ? (
                            <img src={c.image_url} alt={c.nombre} className="w-9 h-9 rounded-lg object-cover shrink-0" />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-sf bd flex items-center justify-center shrink-0">
                              <Boxes size={14} className="tx-mu" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs font-bold truncate">{c.nombre}</div>
                            <div className="text-[11px] font-mono tx-mu">#{c.sku}</div>
                          </div>
                        </div>
                        <span
                          className={`text-xs font-mono font-bold shrink-0 ${
                            disabled ? 'text-rose-500' : 'text-emerald-600'
                          }`}
                        >
                          {c.stock_disponible} disp.
                        </span>
                      </label>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    className="px-4 py-2 rounded-xl bg-sf bd text-xs font-bold"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={selectedCatalogSkus.size === 0 || savingItem}
                    onClick={handleBulkAddFromCatalog}
                    className="px-5 py-2 rounded-xl text-xs font-black disabled:opacity-45"
                    style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                  >
                    Importar seleccionados ({selectedCatalogSkus.size})
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
