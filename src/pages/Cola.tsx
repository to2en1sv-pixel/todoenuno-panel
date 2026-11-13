import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchStockItems } from '@/lib/inventory';
import { Skeleton } from '@/components/ui/Skeleton';
import { fmtAgo } from '@/lib/format';
import type { StockItem } from '@/types/inventory';
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  Loader2,
  MessageSquare,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';

type QueueItem = {
  id: string;
  template_id?: number | null;
  variante_id?: number | null;
  nombre: string | null;
  sku: string | null;
  image_url: string | null;
  status: string | null;
  posted_at: string | null;
  created_at: string | null;
  fb_post_id: string | null;
};

type FbLeadLite = {
  id: string;
  fb_post_id: string | null;
  fb_user_name: string | null;
  message_text: string | null;
  keyword: string | null;
  created_at: string;
};

function isErrorStatus(status?: string | null): boolean {
  const s = (status || '').toLowerCase();
  return s === 'failed' || s === 'error';
}

function normalizeSkuKey(sku?: string | null): string {
  return (sku || '').trim().toUpperCase();
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ColaPage() {
  const queryClient = useQueryClient();

  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [fbLeads, setFbLeads] = useState<FbLeadLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filtros
  const [filter, setFilter] = useState<'all' | 'pending' | 'posted' | 'error'>('all');
  const [stockFilter, setStockFilter] = useState<'all' | 'in_stock' | 'out_of_stock'>('all');
  const [search, setSearch] = useState('');

  // Selección y acciones por fila / lote
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmBulkAction, setConfirmBulkAction] = useState<'delete' | 'purge_oos' | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // Modal Agregar a Cola
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<'catalog' | 'manual'>('catalog');
  const [catalogSearch, setCatalogSearch] = useState('');
  const [selectedSkusToAdd, setSelectedSkusToAdd] = useState<Set<string>>(new Set());
  const [manualNombre, setManualNombre] = useState('');
  const [manualSku, setManualSku] = useState('');
  const [manualImg, setManualImg] = useState('');
  const [addingItems, setAddingItems] = useState(false);

  // Modal Detalle & Generador de Copy
  const [detailItem, setDetailItem] = useState<QueueItem | null>(null);
  const [generatedCopy, setGeneratedCopy] = useState('');
  const [generatingCopy, setGeneratingCopy] = useState(false);
  const [copiedCopy, setCopiedCopy] = useState(false);

  const showNotice = useCallback((type: 'ok' | 'err', text: string) => {
    setBanner({ type, text });
    setTimeout(() => {
      setBanner((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  }, []);

  const loadData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoading(true);

    try {
      const [queueRes, stockRes, leadsRes] = await Promise.all([
        supabase
          .from('post_queue')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
        fetchStockItems(),
        supabase
          .from('fb_leads')
          .select('id,fb_post_id,fb_user_name,message_text,keyword,created_at')
          .order('created_at', { ascending: false })
          .limit(500),
      ]);

      if (!queueRes.error && Array.isArray(queueRes.data)) {
        setQueueItems(queueRes.data as QueueItem[]);
      }
      setStockItems(stockRes.items || []);

      if (!leadsRes.error && Array.isArray(leadsRes.data)) {
        setFbLeads(leadsRes.data as FbLeadLite[]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadData(false);
  }, [loadData]);

  const syncAfterMutation = useCallback(async () => {
    await Promise.all([
      loadData(true),
      queryClient.invalidateQueries({ queryKey: ['post_queue'] }),
    ]);
  }, [loadData, queryClient]);

  // Mapa de inventario real por SKU
  const stockBySku = useMemo(() => {
    const map = new Map<string, StockItem>();
    for (const s of stockItems) {
      map.set(normalizeSkuKey(s.sku), s);
    }
    return map;
  }, [stockItems]);

  // Mapa de leads reales agrupados por fb_post_id
  const leadsByPostId = useMemo(() => {
    const map = new Map<string, FbLeadLite[]>();
    for (const l of fbLeads) {
      if (!l.fb_post_id) continue;
      const arr = map.get(l.fb_post_id) || [];
      arr.push(l);
      map.set(l.fb_post_id, arr);
    }
    return map;
  }, [fbLeads]);

  // SKUs activos actualmente en estado pending
  const pendingSkusSet = useMemo(() => {
    const set = new Set<string>();
    for (const item of queueItems) {
      if (item.status === 'pending' && item.sku) {
        set.add(normalizeSkuKey(item.sku));
      }
    }
    return set;
  }, [queueItems]);

  // Métricas globales
  const metrics = useMemo(() => {
    const todayStr = new Date().toDateString();
    let pending = 0;
    let pendingWithStock = 0;
    let pendingOutOfStock = 0;
    let posted = 0;
    let postedToday = 0;
    let errorCount = 0;
    let totalLinkedLeads = 0;
    let lastPostedItem: QueueItem | null = null;

    const pendingOutOfStockIds: string[] = [];

    for (const item of queueItems) {
      const stockInfo = item.sku ? stockBySku.get(normalizeSkuKey(item.sku)) : undefined;

      if (item.status === 'pending') {
        pending++;
        if (stockInfo) {
          if (stockInfo.stock_disponible > 0) pendingWithStock++;
          else {
            pendingOutOfStock++;
            pendingOutOfStockIds.push(item.id);
          }
        }
      } else if (item.status === 'posted') {
        posted++;
        if (item.posted_at && new Date(item.posted_at).toDateString() === todayStr) {
          postedToday++;
        }
        if (
          item.posted_at &&
          (!lastPostedItem?.posted_at ||
            new Date(item.posted_at).getTime() > new Date(lastPostedItem.posted_at).getTime())
        ) {
          lastPostedItem = item;
        }
      } else if (isErrorStatus(item.status)) {
        errorCount++;
      }

      if (item.fb_post_id) {
        totalLinkedLeads += leadsByPostId.get(item.fb_post_id)?.length || 0;
      }
    }

    return {
      all: queueItems.length,
      pending,
      pendingWithStock,
      pendingOutOfStock,
      pendingOutOfStockIds,
      posted,
      postedToday,
      errorCount,
      totalLinkedLeads,
      lastPostedItem,
    };
  }, [queueItems, stockBySku, leadsByPostId]);

  // Lista filtrada
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return queueItems.filter((item) => {
      if (filter === 'pending' && item.status !== 'pending') return false;
      if (filter === 'posted' && item.status !== 'posted') return false;
      if (filter === 'error' && !isErrorStatus(item.status)) return false;

      if (stockFilter !== 'all') {
        const stockInfo = item.sku ? stockBySku.get(normalizeSkuKey(item.sku)) : undefined;
        const disp = stockInfo ? stockInfo.stock_disponible : null;
        if (stockFilter === 'in_stock' && (disp === null || disp <= 0)) return false;
        if (stockFilter === 'out_of_stock' && (disp === null || disp > 0)) return false;
      }

      if (q) {
        const match = [item.nombre, item.sku, item.fb_post_id]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [queueItems, filter, stockFilter, search, stockBySku]);

  // Catálogo filtrable para Modal Agregar
  const validCatalog = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    return stockItems
      .filter((item) => {
        const s = item.sku.toLowerCase();
        if (s.includes('fee') || s.includes('test') || s.includes('descuento')) return false;
        if (item.activo === false) return false;
        if (!q) return true;
        return (
          item.nombre.toLowerCase().includes(q) ||
          item.sku.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.stock_disponible - a.stock_disponible);
  }, [stockItems, catalogSearch]);

  /* --------------------------- Acciones individuales --------------------------- */

  const handleUpdateStatus = async (item: QueueItem, nextStatus: 'pending' | 'posted') => {
    setBusyId(item.id);
    try {
      const payload =
        nextStatus === 'posted'
          ? { status: 'posted', posted_at: new Date().toISOString() }
          : { status: 'pending' };

      const { error } = await supabase.from('post_queue').update(payload).eq('id', item.id);
      if (error) {
        showNotice('err', `No se pudo actualizar: ${error.message}`);
      } else {
        showNotice(
          'ok',
          nextStatus === 'pending'
            ? `"${item.nombre || item.sku}" reencolado como pendiente.`
            : `"${item.nombre || item.sku}" marcado como publicado.`
        );
        await syncAfterMutation();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteRow = async (id: string) => {
    setBusyId(id);
    try {
      const { error } = await supabase.from('post_queue').delete().eq('id', id);
      if (error) {
        showNotice('err', `Error al eliminar: ${error.message}`);
      } else {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setConfirmDeleteId(null);
        showNotice('ok', 'Elemento eliminado de la cola.');
        await syncAfterMutation();
      }
    } finally {
      setBusyId(null);
    }
  };

  /* --------------------------- Acciones en lote --------------------------- */

  const toggleSelectAllFiltered = () => {
    if (filtered.length === 0) return;
    const allSelected = filtered.every((x) => selectedIds.has(x.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((x) => x.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkStatus = async (status: 'pending' | 'posted') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const payload =
        status === 'posted'
          ? { status: 'posted', posted_at: new Date().toISOString() }
          : { status: 'pending' };
      const { error } = await supabase.from('post_queue').update(payload).in('id', ids);
      if (error) {
        showNotice('err', error.message);
      } else {
        showNotice('ok', `${ids.length} registro(s) actualizados.`);
        setSelectedIds(new Set());
        await syncAfterMutation();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async (targetIds?: string[]) => {
    const ids = targetIds || Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkBusy(true);
    try {
      const { error } = await supabase.from('post_queue').delete().in('id', ids);
      if (error) {
        showNotice('err', error.message);
      } else {
        showNotice('ok', `${ids.length} elemento(s) eliminados de la cola.`);
        setSelectedIds(new Set());
        setConfirmBulkAction(null);
        await syncAfterMutation();
      }
    } finally {
      setBulkBusy(false);
    }
  };

  /* --------------------------- Agregar a Cola --------------------------- */

  const handleEnqueueCatalogSelected = async () => {
    const chosen = validCatalog.filter((c) => selectedSkusToAdd.has(c.sku));
    if (chosen.length === 0) return;

    setAddingItems(true);
    try {
      const rows = chosen.map((c) => ({
        nombre: c.nombre,
        sku: c.sku,
        image_url: c.image_url || null,
        status: 'pending',
      }));

      const { error } = await supabase.from('post_queue').insert(rows);
      if (error) {
        showNotice('err', `Error al encolar: ${error.message}`);
      } else {
        showNotice('ok', `${rows.length} producto(s) agregados a la cola.`);
        setSelectedSkusToAdd(new Set());
        setShowAddModal(false);
        await syncAfterMutation();
      }
    } finally {
      setAddingItems(false);
    }
  };

  const handleSelectAvailableNotPending = () => {
    const eligible = validCatalog.filter(
      (c) => c.stock_disponible > 0 && !pendingSkusSet.has(normalizeSkuKey(c.sku))
    );
    setSelectedSkusToAdd(new Set(eligible.map((c) => c.sku)));
  };

  const handleEnqueueManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualNombre.trim()) return;

    setAddingItems(true);
    try {
      const { error } = await supabase.from('post_queue').insert({
        nombre: manualNombre.trim(),
        sku: manualSku.trim().toUpperCase() || null,
        image_url: manualImg.trim() || null,
        status: 'pending',
      });
      if (error) {
        showNotice('err', `No se pudo agregar: ${error.message}`);
      } else {
        showNotice('ok', `"${manualNombre.trim()}" agregado a la cola.`);
        setManualNombre('');
        setManualSku('');
        setManualImg('');
        setShowAddModal(false);
        await syncAfterMutation();
      }
    } finally {
      setAddingItems(false);
    }
  };

  /* --------------------------- Generador de Copy en Detalle --------------------------- */

  const handleGenerateCopy = async (item: QueueItem) => {
    const stockInfo = item.sku ? stockBySku.get(normalizeSkuKey(item.sku)) : undefined;
    const price = Number(stockInfo?.precio_venta) || 15;
    const cost = Number(stockInfo?.costo_unitario) || 5;

    setGeneratingCopy(true);
    setGeneratedCopy('');
    try {
      const res = await fetch('/api/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName: item.nombre || item.sku || 'Producto TODOENUNO',
          marketLow: Math.max(1, price - 3),
          marketHigh: price + 6,
          marketAvg: price + 2,
          productCost: cost,
          shippingCost: 3.5,
          cpa: 2.5,
          totalCost: cost + 6,
          marginPct: price > 0 ? Math.round(((price - cost - 6) / price) * 100) : 30,
          idealPrice: price,
          profit: Math.max(0, price - cost - 6),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error generando copy');
      }
      setGeneratedCopy(data.copy || '');
    } catch (err: any) {
      showNotice('err', err.message || 'No se pudo generar el copy.');
    } finally {
      setGeneratingCopy(false);
    }
  };

  const handleCopyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCopy(true);
      setTimeout(() => setCopiedCopy(false), 2000);
    } catch {}
  };

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 pb-12">
      {/* ENCABEZADO OPERATIVO */}
      <section className="bg-cd bd rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs tx-mu tabular-nums">
            <span>Automatización de Redes</span>
            <span aria-hidden="true">·</span>
            <span>
              Último post:{' '}
              {metrics.lastPostedItem?.posted_at
                ? fmtAgo(metrics.lastPostedItem.posted_at)
                : 'Sin registros'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{metrics.postedToday} hoy</span>
          </div>
          <h1
            className="text-xl sm:text-2xl font-bold mt-1.5 tracking-tight"
            style={{ textWrap: 'balance' }}
          >
            Cola de Publicación Social
          </h1>
          <p className="text-xs tx-mu mt-1">
            Controla qué productos esperan turno para publicarse, detecta SKUs agotados antes de pautar y revisa los leads captados.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-sf bd text-xs font-medium hover:opacity-85 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Actualizar
          </button>

          <Link
            to="/social-inbox"
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-sf bd text-xs font-medium hover:opacity-85 transition-opacity whitespace-nowrap shrink-0"
          >
            <MessageSquare size={14} />
            Social Inbox
          </Link>

          <button
            type="button"
            onClick={() => {
              setAddMode('catalog');
              setShowAddModal(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            style={{ background: 'var(--tx)', color: 'var(--cd)' }}
          >
            <Plus size={14} />
            Agregar a Cola
          </button>
        </div>
      </section>

      {/* AVISO / FEEDBACK */}
      {banner && (
        <div
          className="bg-cd bd rounded-xl px-4 py-3 text-xs font-medium flex items-center justify-between gap-3"
          style={{
            borderColor: banner.type === 'ok' ? 'var(--ok)' : 'var(--er)',
            color: banner.type === 'ok' ? 'var(--ok)' : 'var(--er)',
          }}
        >
          <span>{banner.text}</span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            aria-label="Cerrar aviso"
            className="p-1 rounded hover:opacity-75 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* TIRA DE KPIs DE LA COLA (4 COLUMNAS) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <button
          type="button"
          onClick={() => setFilter('pending')}
          className="text-left bg-cd bd rounded-2xl p-4 hover:border-[var(--ac)] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Pendientes en cola</span>
            <Clock size={15} style={{ color: 'var(--ac)' }} />
          </div>
          {loading ? (
            <Skeleton h={34} />
          ) : (
            <div className="mt-2">
              <div className="text-2xl font-bold mono tabular-nums">{metrics.pending}</div>
              <div className="text-xs tx-mu mt-0.5 tabular-nums">
                {metrics.pendingWithStock} con stock · {metrics.pendingOutOfStock} agotados
              </div>
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFilter('posted')}
          className="text-left bg-cd bd rounded-2xl p-4 hover:border-[var(--ok)] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Publicados</span>
            <Send size={15} style={{ color: 'var(--ok)' }} />
          </div>
          {loading ? (
            <Skeleton h={34} />
          ) : (
            <div className="mt-2">
              <div className="text-2xl font-bold mono tabular-nums">{metrics.posted}</div>
              <div className="text-xs tx-mu mt-0.5 tabular-nums">
                {metrics.postedToday} publicados hoy
              </div>
            </div>
          )}
        </button>

        <button
          type="button"
          onClick={() => setFilter('error')}
          className="text-left bg-cd bd rounded-2xl p-4 hover:border-[var(--er)] transition-colors cursor-pointer"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Con error</span>
            <AlertCircle size={15} style={{ color: metrics.errorCount > 0 ? 'var(--er)' : 'var(--mu)' }} />
          </div>
          {loading ? (
            <Skeleton h={34} />
          ) : (
            <div className="mt-2">
              <div
                className="text-2xl font-bold mono tabular-nums"
                style={{ color: metrics.errorCount > 0 ? 'var(--er)' : 'var(--tx)' }}
              >
                {metrics.errorCount}
              </div>
              <div className="text-xs tx-mu mt-0.5">
                {metrics.errorCount > 0 ? 'Listos para reintentar' : 'Sin errores recientes'}
              </div>
            </div>
          )}
        </button>

        <Link
          to="/social-inbox"
          className="bg-cd bd rounded-2xl p-4 hover:border-[var(--ac)] transition-colors flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Leads desde posts</span>
            <MessageSquare size={15} style={{ color: 'var(--ac)' }} />
          </div>
          {loading ? (
            <Skeleton h={34} />
          ) : (
            <div className="mt-2">
              <div className="text-2xl font-bold mono tabular-nums">{metrics.totalLinkedLeads}</div>
              <div className="text-xs tx-mu mt-0.5">Comentarios captados</div>
            </div>
          )}
        </Link>
      </section>

      {/* ALERTA DE PENDIENTES SIN STOCK */}
      {metrics.pendingOutOfStock > 0 && (
        <div
          className="bg-cd bd rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={{ borderColor: 'var(--ac)' }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} style={{ color: 'var(--ac)' }} className="shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold">
                Tienes {metrics.pendingOutOfStock} producto{metrics.pendingOutOfStock > 1 ? 's' : ''} pendiente{metrics.pendingOutOfStock > 1 ? 's' : ''} en cola con stock disponible en 0.
              </div>
              <div className="tx-mu mt-0.5">
                Conviene quitarlos de la cola para evitar publicar artículos agotados en redes.
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setFilter('pending');
                setStockFilter('out_of_stock');
              }}
              className="px-3 py-2 rounded-xl bg-sf bd text-xs font-medium hover:opacity-85 whitespace-nowrap cursor-pointer"
            >
              Ver agotados
            </button>

            {confirmBulkAction === 'purge_oos' ? (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => handleBulkDelete(metrics.pendingOutOfStockIds)}
                  className="px-3 py-2 rounded-xl text-xs font-semibold text-white whitespace-nowrap cursor-pointer"
                  style={{ background: 'var(--er)' }}
                >
                  {bulkBusy ? 'Quitando...' : `Confirmar (${metrics.pendingOutOfStockIds.length})`}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmBulkAction(null)}
                  className="px-2.5 py-2 rounded-xl bg-sf bd text-xs cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmBulkAction('purge_oos')}
                className="px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap cursor-pointer"
                style={{ background: 'var(--ac)', color: '#fff' }}
              >
                Quitar agotados
              </button>
            )}
          </div>
        </div>
      )}

      {/* BARRA DE FILTROS Y BÚSQUEDA */}
      <section className="bg-cd bd rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Tabs segmentados de estado */}
          <div className="flex items-center gap-1 p-1 bg-sf bd rounded-xl overflow-x-auto">
            {(
              [
                { key: 'all', label: `Todos (${metrics.all})` },
                { key: 'pending', label: `Pendientes (${metrics.pending})` },
                { key: 'posted', label: `Publicados (${metrics.posted})` },
                { key: 'error', label: `Errores (${metrics.errorCount})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilter(tab.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === tab.key ? 'bg-cd bd font-semibold' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Filtro stock + búsqueda */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1 lg:max-w-lg">
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as any)}
              aria-label="Filtrar por stock"
              className="bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
            >
              <option value="all">Stock: Todos</option>
              <option value="in_stock">Solo con stock (&gt; 0)</option>
              <option value="out_of_stock">Solo agotados (0)</option>
            </select>

            <div className="relative flex-1">
              <Search size={14} className="tx-mu absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar producto, SKU o fb_post_id..."
                className="w-full bg-sf bd rounded-xl pl-8 pr-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
              />
            </div>
          </div>
        </div>

        {/* Barra de acciones masivas cuando hay selección */}
        {selectedIds.size > 0 && (
          <div className="pt-3 border-t border-[var(--bd)] flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold tabular-nums">
              {selectedIds.size} seleccionado{selectedIds.size > 1 ? 's' : ''}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => handleBulkStatus('pending')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sf bd text-xs font-medium hover:border-[var(--ac)] cursor-pointer"
              >
                <RotateCcw size={13} />
                Pasar a Pendiente
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => handleBulkStatus('posted')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sf bd text-xs font-medium hover:border-[var(--ok)] cursor-pointer"
              >
                <CheckCircle2 size={13} />
                Marcar Publicado
              </button>

              {confirmBulkAction === 'delete' ? (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={bulkBusy}
                    onClick={() => handleBulkDelete()}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer"
                    style={{ background: 'var(--er)' }}
                  >
                    {bulkBusy ? 'Borrando...' : 'Confirmar borrado'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBulkAction(null)}
                    className="px-2.5 py-1.5 rounded-lg bg-sf bd text-xs cursor-pointer"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBulkAction('delete')}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sf bd text-xs font-medium cursor-pointer"
                  style={{ color: 'var(--er)' }}
                >
                  <Trash2 size={13} />
                  Eliminar
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* LISTADO PRINCIPAL DE POST_QUEUE */}
      <section className="bg-cd bd rounded-2xl overflow-hidden">
        {/* Cabecera de selección */}
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2.5 bg-sf border-b border-[var(--bd)] flex items-center justify-between text-xs tx-mu">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allFilteredSelected}
                onChange={toggleSelectAllFiltered}
                className="rounded"
              />
              <span>Seleccionar visibles ({filtered.length})</span>
            </label>
            <span className="tabular-nums hidden sm:inline">
              Inventario y leads enlazados en tiempo real
            </span>
          </div>
        )}

        {loading && (
          <div className="p-4 flex flex-col gap-3">
            <Skeleton h={64} />
            <Skeleton h={64} />
            <Skeleton h={64} />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-12 px-4 text-center flex flex-col items-center gap-3">
            <Layers size={28} className="tx-mu" />
            <div className="text-sm font-medium">No hay publicaciones que coincidan con este filtro.</div>
            <p className="text-xs tx-mu max-w-md">
              Agrega productos de tu catálogo real para que la automatización de redes los tome en orden, o limpia los filtros activos.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
              {(filter !== 'all' || stockFilter !== 'all' || search) && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all');
                    setStockFilter('all');
                    setSearch('');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-sf bd text-xs font-medium cursor-pointer"
                >
                  Ver todos
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setAddMode('catalog');
                  setShowAddModal(true);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                style={{ background: 'var(--tx)', color: 'var(--cd)' }}
              >
                <Plus size={14} />
                Agregar producto a la cola
              </button>
            </div>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="divide-y divide-[var(--bd)]">
            {filtered.map((item) => {
              const stockInfo = item.sku ? stockBySku.get(normalizeSkuKey(item.sku)) : undefined;
              const postLeads = item.fb_post_id ? leadsByPostId.get(item.fb_post_id) || [] : [];
              const isBase64Img = Boolean(item.image_url && item.image_url.startsWith('data:image/'));
              const isErr = isErrorStatus(item.status);
              const isPosted = item.status === 'posted';
              const isPending = item.status === 'pending';
              const isRowBusy = busyId === item.id;

              return (
                <div
                  key={item.id}
                  className="p-4 hover:bg-sf/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-3.5"
                >
                  {/* Izquierda: Checkbox + Imagen + Info */}
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleSelectOne(item.id)}
                      aria-label={`Seleccionar ${item.nombre || item.sku || 'post'}`}
                      className="mt-1 sm:mt-0 shrink-0 cursor-pointer"
                    />

                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.nombre || 'Producto en cola'}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-xl object-cover bg-sf bd shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-xl bg-sf bd grid place-items-center shrink-0">
                        <Package size={18} className="tx-mu" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold truncate">
                          {item.nombre || 'Producto sin nombre'}
                        </span>
                        <span
                          className="text-xs font-medium whitespace-nowrap"
                          style={{
                            color: isPosted
                              ? 'var(--ok)'
                              : isErr
                                ? 'var(--er)'
                                : 'var(--ac)',
                          }}
                        >
                          ·{' '}
                          {isPosted
                            ? `Publicado${item.posted_at ? ` ${fmtAgo(item.posted_at)}` : ''}`
                            : isErr
                              ? 'Error al publicar'
                              : 'Pendiente'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tx-mu mt-1 tabular-nums">
                        <span className="mono">{item.sku || 'Sin SKU'}</span>
                        {stockInfo ? (
                          <>
                            <span aria-hidden="true">·</span>
                            <span
                              className="font-medium"
                              style={{
                                color: stockInfo.stock_disponible <= 0 ? 'var(--er)' : 'var(--ok)',
                              }}
                            >
                              {stockInfo.stock_disponible > 0
                                ? `${stockInfo.stock_disponible} uds disp.`
                                : 'Agotado (0 uds)'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="mono">{formatMoney(Number(stockInfo.precio_venta) || 0)}</span>
                          </>
                        ) : (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Sin ficha en inventario</span>
                          </>
                        )}

                        {postLeads.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-medium" style={{ color: 'var(--ac)' }}>
                              {postLeads.length} lead{postLeads.length > 1 ? 's' : ''} FB
                            </span>
                          </>
                        )}

                        {item.created_at && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Creado {fmtAgo(item.created_at)}</span>
                          </>
                        )}
                      </div>

                      {isBase64Img && isPending && (
                        <div className="text-[11px] mt-1" style={{ color: 'var(--ac)' }}>
                          Imagen almacenada como Base64 local: verifica si tu flujo de Meta exige URL pública HTTPS.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Derecha: Acciones de fila */}
                  <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 pl-7 md:pl-0">
                    <button
                      type="button"
                      onClick={() => {
                        setDetailItem(item);
                        setGeneratedCopy('');
                        setCopiedCopy(false);
                      }}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd text-xs font-medium hover:border-[var(--ac)] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Sparkles size={13} style={{ color: 'var(--ac)' }} />
                      Detalle & Copy
                    </button>

                    {(isErr || isPosted) && (
                      <button
                        type="button"
                        disabled={isRowBusy}
                        onClick={() => handleUpdateStatus(item, 'pending')}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd text-xs font-medium hover:border-[var(--ac)] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <RotateCcw size={13} />
                        Reencolar
                      </button>
                    )}

                    {isPending && (
                      <button
                        type="button"
                        disabled={isRowBusy}
                        onClick={() => handleUpdateStatus(item, 'posted')}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-sf bd text-xs font-medium hover:border-[var(--ok)] transition-colors whitespace-nowrap cursor-pointer"
                      >
                        <CheckCircle2 size={13} style={{ color: 'var(--ok)' }} />
                        Marcar publicado
                      </button>
                    )}

                    {item.fb_post_id && (
                      <a
                        href={`https://facebook.com/${item.fb_post_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sf bd text-xs tx-mu hover:text-[var(--tx)] transition-colors whitespace-nowrap"
                        title="Abrir publicación en Facebook"
                      >
                        <ExternalLink size={13} />
                        FB
                      </a>
                    )}

                    {confirmDeleteId === item.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={isRowBusy}
                          onClick={() => handleDeleteRow(item.id)}
                          className="px-2.5 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer"
                          style={{ background: 'var(--er)' }}
                        >
                          {isRowBusy ? '...' : 'Borrar'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2 py-1.5 rounded-lg bg-sf bd text-xs cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(item.id)}
                        aria-label="Eliminar de cola"
                        className="p-1.5 rounded-lg bg-sf bd tx-mu hover:text-[var(--er)] transition-colors cursor-pointer"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* MODAL AGREGAR A COLA */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-cd bd rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Agregar productos a la cola social</h2>
                <p className="text-xs tx-mu mt-0.5">
                  Elige productos reales de tu inventario o registra una publicación personalizada.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                aria-label="Cerrar modal"
                className="p-2 rounded-xl bg-sf bd tx-mu hover:text-[var(--tx)] cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 pt-3 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1 p-1 bg-sf bd rounded-xl">
                <button
                  type="button"
                  onClick={() => setAddMode('catalog')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    addMode === 'catalog' ? 'bg-cd bd font-semibold' : 'tx-mu'
                  }`}
                >
                  Desde catálogo real
                </button>
                <button
                  type="button"
                  onClick={() => setAddMode('manual')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer ${
                    addMode === 'manual' ? 'bg-cd bd font-semibold' : 'tx-mu'
                  }`}
                >
                  Ingreso manual
                </button>
              </div>

              {addMode === 'catalog' && (
                <button
                  type="button"
                  onClick={handleSelectAvailableNotPending}
                  className="text-xs font-semibold hover:underline cursor-pointer"
                  style={{ color: 'var(--ac)' }}
                >
                  Seleccionar disponibles no encolados
                </button>
              )}
            </div>

            {addMode === 'catalog' ? (
              <>
                <div className="px-5 py-3">
                  <div className="relative">
                    <Search size={14} className="tx-mu absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
                      placeholder="Buscar por nombre o SKU..."
                      className="w-full bg-sf bd rounded-xl pl-8 pr-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto px-5 pb-3 divide-y divide-[var(--bd)]">
                  {validCatalog.length === 0 ? (
                    <div className="py-10 text-center text-xs tx-mu">
                      No se encontraron productos activos con ese criterio.
                    </div>
                  ) : (
                    validCatalog.map((item) => {
                      const alreadyPending = pendingSkusSet.has(normalizeSkuKey(item.sku));
                      const checked = selectedSkusToAdd.has(item.sku);
                      return (
                        <label
                          key={item.sku}
                          className="py-2.5 flex items-center gap-3 cursor-pointer hover:bg-sf/50 px-2 rounded-lg"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedSkusToAdd((prev) => {
                                const next = new Set(prev);
                                if (next.has(item.sku)) next.delete(item.sku);
                                else next.add(item.sku);
                                return next;
                              });
                            }}
                          />
                          {item.image_url ? (
                            <img
                              src={item.image_url}
                              alt={item.nombre}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-lg object-cover bg-sf bd shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-sf bd grid place-items-center shrink-0">
                              <Boxes size={14} className="tx-mu" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate">
                              {item.nombre}
                              {alreadyPending && (
                                <span className="font-normal" style={{ color: 'var(--ac)' }}>
                                  {' '}
                                  · Ya en cola
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] tx-mu mono tabular-nums">
                              {item.sku} · {formatMoney(Number(item.precio_venta) || 0)}
                            </div>
                          </div>
                          <span
                            className="text-xs font-semibold mono tabular-nums shrink-0"
                            style={{
                              color: item.stock_disponible > 0 ? 'var(--ok)' : 'var(--er)',
                            }}
                          >
                            {item.stock_disponible} uds
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>

                <div className="px-5 py-4 border-t border-[var(--bd)] flex items-center justify-between gap-3">
                  <span className="text-xs tx-mu tabular-nums">
                    {selectedSkusToAdd.size} seleccionado{selectedSkusToAdd.size === 1 ? '' : 's'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowAddModal(false)}
                      className="px-4 py-2 rounded-xl bg-sf bd text-xs font-medium cursor-pointer"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      disabled={selectedSkusToAdd.size === 0 || addingItems}
                      onClick={handleEnqueueCatalogSelected}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer"
                      style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                    >
                      {addingItems && <Loader2 size={13} className="animate-spin" />}
                      Encolar seleccionados ({selectedSkusToAdd.size})
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <form onSubmit={handleEnqueueManual} className="p-5 flex flex-col gap-3.5">
                <div>
                  <label className="block text-xs font-medium mb-1">Nombre del producto o campaña *</label>
                  <input
                    required
                    value={manualNombre}
                    onChange={(e) => setManualNombre(e.target.value)}
                    placeholder="Ej. Asistente de bebé rosado"
                    className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">SKU (opcional)</label>
                  <input
                    value={manualSku}
                    onChange={(e) => setManualSku(e.target.value)}
                    placeholder="Ej. ASIS-BB-01"
                    className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs mono outline-none focus:border-[var(--ac)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">URL pública de imagen (opcional)</label>
                  <input
                    value={manualImg}
                    onChange={(e) => setManualImg(e.target.value)}
                    placeholder="https://..."
                    className="w-full bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
                  />
                </div>
                {manualImg.trim() && (
                  <div className="flex items-center gap-3 p-2.5 bg-sf bd rounded-xl">
                    <img
                      src={manualImg.trim()}
                      alt="Vista previa"
                      referrerPolicy="no-referrer"
                      className="w-14 h-14 rounded-lg object-cover bg-cd bd"
                    />
                    <span className="text-xs tx-mu">Vista previa de imagen</span>
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 rounded-xl bg-sf bd text-xs font-medium cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={!manualNombre.trim() || addingItems}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-40 cursor-pointer"
                    style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                  >
                    {addingItems && <Loader2 size={13} className="animate-spin" />}
                    Agregar a la cola
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* MODAL DETALLE, LEADS & COPY IA */}
      {detailItem && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[1px] flex items-center justify-center p-4">
          <div className="bg-cd bd rounded-2xl w-full max-w-xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-bold truncate">
                  {detailItem.nombre || detailItem.sku || 'Detalle de publicación'}
                </h2>
                <div className="text-xs tx-mu mono tabular-nums mt-0.5">
                  {detailItem.sku || 'Sin SKU'}
                  {detailItem.fb_post_id ? ` · FB ID ${detailItem.fb_post_id}` : ''}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailItem(null)}
                aria-label="Cerrar detalle"
                className="p-2 rounded-xl bg-sf bd tx-mu hover:text-[var(--tx)] cursor-pointer shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
              {/* Vista previa imagen + ficha rápida */}
              <div className="flex items-start gap-4 p-3.5 bg-sf bd rounded-xl">
                {detailItem.image_url ? (
                  <img
                    src={detailItem.image_url}
                    alt={detailItem.nombre || 'Producto'}
                    referrerPolicy="no-referrer"
                    className="w-20 h-20 rounded-xl object-cover bg-cd bd shrink-0"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-xl bg-cd bd grid place-items-center shrink-0">
                    <ImageIcon size={22} className="tx-mu" />
                  </div>
                )}

                <div className="min-w-0 flex-1 text-xs flex flex-col gap-1">
                  <div className="font-semibold text-sm">
                    Estado:{' '}
                    <span
                      style={{
                        color:
                          detailItem.status === 'posted'
                            ? 'var(--ok)'
                            : isErrorStatus(detailItem.status)
                              ? 'var(--er)'
                              : 'var(--ac)',
                      }}
                    >
                      {detailItem.status === 'posted'
                        ? 'Publicado'
                        : isErrorStatus(detailItem.status)
                          ? 'Error'
                          : 'Pendiente'}
                    </span>
                  </div>
                  {detailItem.sku && stockBySku.get(normalizeSkuKey(detailItem.sku)) && (
                    <div className="tx-mu tabular-nums">
                      Stock disponible:{' '}
                      <strong className="text-[var(--tx)]">
                        {stockBySku.get(normalizeSkuKey(detailItem.sku))!.stock_disponible} uds
                      </strong>{' '}
                      · Precio:{' '}
                      <strong className="text-[var(--tx)]">
                        {formatMoney(
                          Number(stockBySku.get(normalizeSkuKey(detailItem.sku))!.precio_venta) || 0
                        )}
                      </strong>
                    </div>
                  )}
                  <div className="tx-mu tabular-nums">
                    Creado: {detailItem.created_at ? fmtAgo(detailItem.created_at) : '—'}
                    {detailItem.posted_at ? ` · Publicado: ${fmtAgo(detailItem.posted_at)}` : ''}
                  </div>
                </div>
              </div>

              {/* Generador de Copy IA */}
              <div className="p-4 bg-sf bd rounded-xl flex flex-col gap-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold flex items-center gap-1.5">
                      <Sparkles size={14} style={{ color: 'var(--ac)' }} />
                      Copy sugerido para Meta / WhatsApp
                    </div>
                    <div className="text-[11px] tx-mu mt-0.5">
                      Usa los datos reales de precio y costo del producto en tu catálogo.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={generatingCopy}
                    onClick={() => handleGenerateCopy(detailItem)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold shrink-0 cursor-pointer disabled:opacity-50"
                    style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                  >
                    {generatingCopy ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Generando...
                      </>
                    ) : (
                      <>
                        <Sparkles size={13} />
                        Generar copy
                      </>
                    )}
                  </button>
                </div>

                {generatedCopy && (
                  <div className="flex flex-col gap-2">
                    <textarea
                      readOnly
                      value={generatedCopy}
                      rows={6}
                      className="w-full bg-cd bd rounded-xl p-3 text-xs leading-relaxed outline-none"
                    />
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleCopyText(generatedCopy)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cd bd text-xs font-medium cursor-pointer"
                      >
                        {copiedCopy ? <Check size={13} style={{ color: 'var(--ok)' }} /> : <Copy size={13} />}
                        {copiedCopy ? 'Copiado' : 'Copiar texto'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Leads vinculados a este post en Facebook */}
              <div className="p-4 bg-sf bd rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold">
                    Comentarios / Leads captados
                  </div>
                  <Link to="/social-inbox" className="text-[11px] hover:underline" style={{ color: 'var(--ac)' }}>
                    Ir a Social Inbox →
                  </Link>
                </div>
                {!detailItem.fb_post_id ? (
                  <div className="text-xs tx-mu">
                    Este registro aún no tiene un ID de publicación de Facebook vinculado.
                  </div>
                ) : (leadsByPostId.get(detailItem.fb_post_id) || []).length === 0 ? (
                  <div className="text-xs tx-mu">
                    Aún no hay comentarios registrados en fb_leads para este post.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--bd)] max-h-44 overflow-y-auto">
                    {(leadsByPostId.get(detailItem.fb_post_id) || []).map((lead) => (
                      <div key={lead.id} className="py-2 first:pt-0 last:pb-0 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold truncate">
                            {lead.fb_user_name || 'Usuario FB'}
                          </span>
                          <span className="text-[11px] tx-mu tabular-nums shrink-0">
                            {fmtAgo(lead.created_at)}
                          </span>
                        </div>
                        <div className="tx-mu mt-0.5 break-words">
                          {lead.message_text || lead.keyword || 'Interacción sin texto'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
