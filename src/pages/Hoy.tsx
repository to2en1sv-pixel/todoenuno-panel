import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { usePostQueue } from '@/hooks/usePostQueue';
import { useProductos, useVariantes } from '@/hooks/useCatalog';
import { fetchStockItems } from '@/lib/inventory';
import {
  fetchCashAccounts,
  getFinanceCutoffDate,
  hydrateFinanceCutoffFromOsEvents,
  isRecordBeforeFinanceCutoff,
} from '@/lib/finance';
import PedidoModal from '@/components/PedidoModal';
import { Skeleton } from '@/components/ui/Skeleton';
import { fmtAgo } from '@/lib/format';
import type { StockItem } from '@/types/inventory';
import type { CashAccount } from '@/types/finance';
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Clock,
  DollarSign,
  MessageSquare,
  Package,
  Plus,
  RefreshCw,
  Send,
  ShoppingBag,
  StickyNote,
  Trash2,
  TrendingUp,
  Truck,
  User,
  Wallet,
} from 'lucide-react';

type OrderRow = {
  id: string;
  pedido_codigo?: string | null;
  nombre_cliente?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  departamento?: string | null;
  courier?: string | null;
  sku?: string | null;
  catalogo_sku?: string | null;
  total?: number | null;
  estado?: string | null;
  metodo_pago?: string | null;
  liquidado?: boolean | null;
  es_encargo?: boolean | null;
  fecha_programada?: string | null;
  codigo_anuncio?: string | null;
  created_at?: string | null;
};

type ConversationRow = {
  id: string;
  instance_id?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  last_message?: string | null;
  updated_at?: string | null;
  status?: string | null;
};

type PagoRow = {
  id: string;
  nombre: string;
  monto: number;
  fecha_vencimiento: string;
  categoria?: string;
};

type NotaRow = {
  id: string;
  contenido: string;
  created_at: string;
  local?: boolean;
};

const LOCAL_NOTES_KEY = 'todoenuno_hoy_notes_fallback_v1';

function getTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDiffDaysFromToday(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const target = new Date(dateStr.slice(0, 10) + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((target.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24));
}

function isLegacyConversation(conv: ConversationRow): boolean {
  const inst = String(conv.instance_id || '').toLowerCase();
  if (inst === 'builderbot-principal' || inst === 'ventas' || inst === 'builderbot') {
    return true;
  }
  const hasHexId = /^[0-9a-f]{20,}$/i.test(conv.id);
  const placeholderMsg = (conv.last_message || '').trim() === 'Haz clic para ver los mensajes';
  return hasHexId && placeholderMsg;
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortPhone(conv: ConversationRow): string {
  const raw = conv.contact_phone || conv.id || '';
  if (!raw) return 'Sin teléfono';
  if (raw.includes('@lid')) return `LID ${raw.split('@')[0].slice(-6)}`;
  const digits = raw.split('@')[0].replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('503')) {
    return `+503 ${digits.slice(3, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 8) {
    return `+503 ${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return raw.split('@')[0];
}

function getEstadoLabel(estado?: string | null): string {
  switch (estado) {
    case 'nuevo':
      return 'Nuevo';
    case 'programado':
      return 'Encargo';
    case 'por_empacar':
      return 'Por empacar';
    case 'en_camino':
      return 'En camino';
    case 'entregado':
      return 'Entregado';
    case 'cancelado':
      return 'Cancelado';
    default:
      return estado || 'Sin estado';
  }
}

export function HoyPage() {
  const queue = usePostQueue();
  const productos = useProductos();
  const variantes = useVariantes();

  const [now, setNow] = useState(() => new Date());
  const [loadingCore, setLoadingCore] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [lastMsgFromMeMap, setLastMsgFromMeMap] = useState<Record<string, boolean>>({});
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [cashAccounts, setCashAccounts] = useState<CashAccount[]>([]);
  const [adSpendToday, setAdSpendToday] = useState(0);
  const [pagosProximos, setPagosProximos] = useState<PagoRow[]>([]);
  const [financeCutoff, setFinanceCutoff] = useState<string | null>(() => getFinanceCutoffDate());

  const [notas, setNotas] = useState<NotaRow[]>([]);
  const [nuevaNota, setNuevaNota] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [orderTab, setOrderTab] = useState<'despachar' | 'encargos' | 'ruta' | 'hoy'>('despachar');
  const [showOrderModal, setShowOrderModal] = useState(false);

  // Actualizar reloj cada minuto
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const loadDashboardData = useCallback(async (isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoadingCore(true);

    const todayISO = getTodayISO();

    try {
      const [
        ordersRes,
        convRes,
        msgsRes,
        stockRes,
        accountsRes,
        adRes,
        pagosRes,
        notasRes,
      ] = await Promise.all([
        supabase
          .from('whatsapp_orders')
          .select(
            'id,pedido_codigo,nombre_cliente,telefono,direccion,departamento,courier,sku,catalogo_sku,total,estado,metodo_pago,liquidado,es_encargo,fecha_programada,codigo_anuncio,created_at'
          )
          .order('created_at', { ascending: false })
          .limit(250),
        supabase
          .from('bb_conversations')
          .select('id,instance_id,contact_name,contact_phone,last_message,updated_at,status')
          .order('updated_at', { ascending: false })
          .limit(120),
        supabase
          .from('bb_messages')
          .select('conversation_id,from_me,created_at')
          .order('created_at', { ascending: false })
          .limit(300),
        fetchStockItems(),
        fetchCashAccounts(),
        supabase
          .from('gastos_publicidad')
          .select('monto,fecha')
          .eq('fecha', todayISO),
        supabase.from('panel_pagos').select('id,nombre,monto,fecha_vencimiento,categoria'),
        supabase.from('panel_notas').select('*').order('created_at', { ascending: false }),
      ]);

      const cutoff = await hydrateFinanceCutoffFromOsEvents(supabase);
      setFinanceCutoff(cutoff);

      if (!ordersRes.error && Array.isArray(ordersRes.data)) {
        setOrders(ordersRes.data as OrderRow[]);
      }

      if (!convRes.error && Array.isArray(convRes.data)) {
        setConversations(convRes.data as ConversationRow[]);
      }

      if (!msgsRes.error && Array.isArray(msgsRes.data)) {
        const dirMap: Record<string, boolean> = {};
        for (const m of msgsRes.data as any[]) {
          if (m.conversation_id && dirMap[m.conversation_id] === undefined) {
            dirMap[m.conversation_id] = Boolean(m.from_me);
          }
        }
        setLastMsgFromMeMap(dirMap);
      }

      setStockItems(stockRes.items || []);
      setCashAccounts(accountsRes.accounts || []);

      if (!adRes.error && Array.isArray(adRes.data)) {
        const sumAd = adRes.data.reduce((acc, r: any) => acc + (Number(r.monto) || 0), 0);
        setAdSpendToday(sumAd);
      } else {
        setAdSpendToday(0);
      }

      if (!pagosRes.error && Array.isArray(pagosRes.data)) {
        setPagosProximos(
          (pagosRes.data as PagoRow[]).filter((p) => {
            const diff = getDiffDaysFromToday(p.fecha_vencimiento);
            return diff !== null && diff >= -2 && diff <= 5;
          })
        );
      }

      if (!notasRes.error && Array.isArray(notasRes.data)) {
        setNotas(notasRes.data as NotaRow[]);
      } else {
        try {
          const cached = localStorage.getItem(LOCAL_NOTES_KEY);
          if (cached) setNotas(JSON.parse(cached));
        } catch {}
      }
    } finally {
      setLoadingCore(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboardData(false);
  }, [loadDashboardData]);

  // Notas CRUD (con fallback local si Supabase no responde)
  const handleAddNota = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = nuevaNota.trim();
    if (!content || savingNote) return;

    setSavingNote(true);
    try {
      const { data, error } = await supabase
        .from('panel_notas')
        .insert({ contenido: content })
        .select();

      if (!error && data && data[0]) {
        setNotas((prev) => [data[0] as NotaRow, ...prev]);
        setNuevaNota('');
      } else {
        const localItem: NotaRow = {
          id: `local-${Date.now()}`,
          contenido: content,
          created_at: new Date().toISOString(),
          local: true,
        };
        const updated = [localItem, ...notas];
        setNotas(updated);
        try {
          localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(updated));
        } catch {}
        setNuevaNota('');
      }
    } finally {
      setSavingNote(false);
    }
  };

  const handleDeleteNota = async (id: string) => {
    const next = notas.filter((n) => n.id !== id);
    setNotas(next);
    if (!id.startsWith('local-')) {
      await supabase.from('panel_notas').delete().eq('id', id);
    } else {
      try {
        localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(next));
      } catch {}
    }
  };

  /* --------------------------- Derivados en tiempo real --------------------------- */

  const todayISO = getTodayISO();

  const orderMetrics = useMemo(() => {
    let ventasHoy = 0;
    let pedidosHoyCount = 0;
    let cobrosEnCalle = 0;
    let enCaminoCount = 0;

    const porDespachar: OrderRow[] = [];
    const encargosUrgentes: Array<OrderRow & { diffDays: number | null }> = [];
    const enRuta: OrderRow[] = [];
    const recientesHoy: OrderRow[] = [];

    for (const o of orders) {
      const total = Number(o.total) || 0;
      const isCancelled = o.estado === 'cancelado';
      const createdToday = Boolean(o.created_at && o.created_at.startsWith(todayISO));

      if (createdToday && !isCancelled) {
        ventasHoy += total;
        pedidosHoyCount++;
      }

      if (createdToday) {
        recientesHoy.push(o);
      }

      if (o.estado === 'nuevo' || o.estado === 'por_empacar') {
        porDespachar.push(o);
      }

      if (o.estado === 'en_camino') {
        enCaminoCount++;
        enRuta.push(o);
      }

      if (
        (o.estado === 'en_camino' || o.estado === 'entregado') &&
        !o.liquidado &&
        !isRecordBeforeFinanceCutoff(o.created_at, undefined, financeCutoff)
      ) {
        cobrosEnCalle += total;
      }

      const esEncargo =
        o.estado === 'programado' ||
        (Boolean(o.es_encargo) && o.estado !== 'cancelado' && o.estado !== 'entregado' && o.estado !== 'en_camino');

      if (esEncargo) {
        const diffDays = getDiffDaysFromToday(o.fecha_programada);
        if (diffDays === null || diffDays <= 2) {
          encargosUrgentes.push({ ...o, diffDays });
        }
      }
    }

    encargosUrgentes.sort((a, b) => (a.diffDays ?? 99) - (b.diffDays ?? 99));

    return {
      ventasHoy,
      pedidosHoyCount,
      cobrosEnCalle,
      enCaminoCount,
      porDespachar,
      encargosUrgentes,
      enRuta,
      recientesHoy,
    };
  }, [orders, todayISO, financeCutoff]);

  const chatMetrics = useMemo(() => {
    const active = conversations.filter((c) => !isLegacyConversation(c));
    let toddCount = 0;
    let humanCount = 0;
    const sinResponder: ConversationRow[] = [];

    for (const c of active) {
      if (c.status === 'human') humanCount++;
      else toddCount++;

      if (lastMsgFromMeMap[c.id] === false) {
        sinResponder.push(c);
      }
    }

    return {
      total: active.length,
      toddCount,
      humanCount,
      sinResponder,
    };
  }, [conversations, lastMsgFromMeMap]);

  const inventoryMetrics = useMemo(() => {
    const valid = stockItems.filter((item) => {
      const s = item.sku.toLowerCase();
      return !s.includes('fee') && !s.includes('test') && !s.includes('descuento') && item.activo !== false;
    });

    const lowStock = valid
      .filter((item) => {
        const umbral = Math.max(3, Number(item.stock_minimo_alerta) || 3);
        return item.stock_disponible <= umbral;
      })
      .sort((a, b) => a.stock_disponible - b.stock_disponible);

    const totalUnits = valid.reduce((acc, item) => acc + Math.max(0, Number(item.stock_disponible) || 0), 0);

    return {
      activeCount: valid.length,
      totalUnits,
      lowStock,
    };
  }, [stockItems]);

  const totalCaja = useMemo(
    () => cashAccounts.filter((a) => a.activo !== false).reduce((acc, a) => acc + (Number(a.saldo_actual) || 0), 0),
    [cashAccounts]
  );

  // Cola Social
  const lastPost = useMemo(
    () =>
      (queue.data ?? [])
        .filter((x) => x.status === 'posted' && x.posted_at)
        .sort((a, b) => new Date(b.posted_at!).getTime() - new Date(a.posted_at!).getTime())[0],
    [queue.data]
  );
  const pendingPosts = useMemo(() => (queue.data ?? []).filter((x) => x.status === 'pending'), [queue.data]);
  const todayPosts = useMemo(
    () =>
      (queue.data ?? []).filter(
        (x) => x.status === 'posted' && x.posted_at && new Date(x.posted_at).toDateString() === now.toDateString()
      ),
    [queue.data, now]
  );
  const queueErrors = useMemo(() => (queue.data ?? []).filter((x) => x.status === 'error'), [queue.data]);

  const greeting = now.getHours() < 12 ? 'Buenos días' : now.getHours() < 19 ? 'Buenas tardes' : 'Buenas noches';

  const heroHeadline = useMemo(() => {
    if (loadingCore) return `${greeting}, cargando pulso del día...`;
    if (orderMetrics.porDespachar.length > 0 && chatMetrics.sinResponder.length > 0) {
      return `${greeting}: ${orderMetrics.porDespachar.length} por despachar y ${chatMetrics.sinResponder.length} chats por atender`;
    }
    if (orderMetrics.porDespachar.length > 0) {
      return `${greeting}: ${orderMetrics.porDespachar.length} pedido${orderMetrics.porDespachar.length > 1 ? 's' : ''} listo${orderMetrics.porDespachar.length > 1 ? 's' : ''} para despacho`;
    }
    if (chatMetrics.sinResponder.length > 0) {
      return `${greeting}: ${chatMetrics.sinResponder.length} conversación${chatMetrics.sinResponder.length > 1 ? 'es' : ''} esperando respuesta`;
    }
    return `${greeting}, operación al día`;
  }, [loadingCore, greeting, orderMetrics.porDespachar.length, chatMetrics.sinResponder.length]);

  const alertCount =
    orderMetrics.encargosUrgentes.length +
    chatMetrics.sinResponder.length +
    inventoryMetrics.lowStock.length +
    pagosProximos.length +
    queueErrors.length;

  const activeTabList = useMemo(() => {
    if (orderTab === 'despachar') return orderMetrics.porDespachar;
    if (orderTab === 'encargos') return orderMetrics.encargosUrgentes;
    if (orderTab === 'ruta') return orderMetrics.enRuta;
    return orderMetrics.recientesHoy;
  }, [orderTab, orderMetrics]);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16">
      {/* Encabezado operativo del día */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mu)] tabular-nums">
            <span className="capitalize">
              {now.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
            <span aria-hidden="true">·</span>
            <span className="mono">
              {now.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Todd {chatMetrics.toddCount} · Humano {chatMetrics.humanCount}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              {todayPosts.length} publicados hoy · {pendingPosts.length} en cola
            </span>
          </div>

          <h1
            className="text-2xl font-bold tracking-tight text-[var(--tx)] mt-1"
            style={{ textWrap: 'balance' }}
          >
            {heroHeadline}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => loadDashboardData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Actualizar
          </button>

          <Link
            to="/unichat"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-semibold text-[var(--tx)] transition-colors whitespace-nowrap shrink-0"
          >
            <MessageSquare size={13} />
            UniChat ({chatMetrics.sinResponder.length})
          </Link>

          <button
            type="button"
            onClick={() => setShowOrderModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 text-xs font-semibold transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus size={14} />
            Nuevo pedido
          </button>
        </div>
      </header>

      {/* Franja unificada de 4 KPIs operativos */}
      <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--bd)]">
        <Link
          to="/pedidos"
          className="p-5 hover:bg-sf/50 transition-colors flex flex-col justify-between gap-1.5"
        >
          <div className="flex items-center justify-between text-xs font-medium text-[var(--mu)]">
            <span>Ventas hoy</span>
            <TrendingUp size={14} className="text-emerald-600 dark:text-emerald-400" />
          </div>
          {loadingCore ? (
            <Skeleton h={34} />
          ) : (
            <div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)]">
                {formatMoney(orderMetrics.ventasHoy)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
                {orderMetrics.pedidosHoyCount} pedido{orderMetrics.pedidosHoyCount === 1 ? '' : 's'} hoy
              </div>
            </div>
          )}
        </Link>

        <Link
          to="/pedidos"
          className="p-5 hover:bg-sf/50 transition-colors flex flex-col justify-between gap-1.5"
        >
          <div className="flex items-center justify-between text-xs font-medium text-[var(--mu)]">
            <span>Por despachar</span>
            <Truck size={14} className="text-amber-600 dark:text-amber-400" />
          </div>
          {loadingCore ? (
            <Skeleton h={34} />
          ) : (
            <div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)]">
                {orderMetrics.porDespachar.length}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
                {orderMetrics.enCaminoCount} en camino · {orderMetrics.encargosUrgentes.length} encargos
              </div>
            </div>
          )}
        </Link>

        <Link
          to="/finanzas"
          className="p-5 hover:bg-sf/50 transition-colors flex flex-col justify-between gap-1.5"
        >
          <div className="flex items-center justify-between text-xs font-medium text-[var(--mu)]">
            <span>Cobros en calle</span>
            <DollarSign size={14} className="text-[var(--mu)]" />
          </div>
          {loadingCore ? (
            <Skeleton h={34} />
          ) : (
            <div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                {formatMoney(orderMetrics.cobrosEnCalle)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1">Pendiente por liquidar</div>
            </div>
          )}
        </Link>

        <Link
          to="/unichat"
          className="p-5 hover:bg-sf/50 transition-colors flex flex-col justify-between gap-1.5"
        >
          <div className="flex items-center justify-between text-xs font-medium text-[var(--mu)]">
            <span>UniChat &amp; Todd</span>
            <Bot size={14} className="text-[var(--mu)]" />
          </div>
          {loadingCore ? (
            <Skeleton h={34} />
          ) : (
            <div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)]">
                {chatMetrics.sinResponder.length}{' '}
                <span className="text-xs font-normal font-sans text-[var(--mu)]">sin resp.</span>
              </div>
              <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
                {chatMetrics.toddCount} Todd · {chatMetrics.humanCount} humano
              </div>
            </div>
          )}
        </Link>
      </section>

      {/* Cuerpo principal: 2 columnas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Columna izquierda */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          {/* 1. Despacho y pedidos */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 pt-4 border-b border-[var(--bd)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-[var(--tx)] pb-2 sm:pb-3">
                Operación COD &amp; Despachos
              </h2>

              <nav className="flex items-center gap-5 overflow-x-auto">
                {[
                  { id: 'despachar', label: `Por despachar (${orderMetrics.porDespachar.length})` },
                  { id: 'encargos', label: `Encargos (${orderMetrics.encargosUrgentes.length})` },
                  { id: 'ruta', label: `En ruta (${orderMetrics.enRuta.length})` },
                  { id: 'hoy', label: `Creados hoy (${orderMetrics.recientesHoy.length})` },
                ].map(t => {
                  const active = orderTab === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setOrderTab(t.id as any)}
                      className={`pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                        active
                          ? 'border-[var(--tx)] text-[var(--tx)]'
                          : 'border-transparent text-[var(--mu)] hover:text-[var(--tx)]'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </nav>
            </div>

            {loadingCore ? (
              <div className="p-5 flex flex-col gap-2">
                <Skeleton h={48} />
                <Skeleton h={48} />
                <Skeleton h={48} />
              </div>
            ) : activeTabList.length === 0 ? (
              <div className="py-12 px-5 text-center flex flex-col items-center gap-3">
                <p className="text-xs text-[var(--mu)]">
                  {orderTab === 'despachar' && 'No hay pedidos pendientes por empacar o despachar.'}
                  {orderTab === 'encargos' && 'No hay encargos programados para los próximos 2 días.'}
                  {orderTab === 'ruta' && 'No hay pedidos marcados en camino en este momento.'}
                  {orderTab === 'hoy' && 'Aún no se han registrado pedidos nuevos hoy.'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowOrderModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-semibold text-[var(--tx)] transition-colors cursor-pointer"
                >
                  <Plus size={13} />
                  Registrar pedido
                </button>
              </div>
            ) : (
              <div className="divide-y divide-[var(--bd)]">
                {activeTabList.slice(0, 7).map((o) => {
                  const diffEncargo =
                    orderTab === 'encargos' ? getDiffDaysFromToday(o.fecha_programada) : null;
                  const labelEncargo =
                    diffEncargo === null
                      ? 'Sin fecha'
                      : diffEncargo < 0
                        ? `Atrasado ${Math.abs(diffEncargo)}d`
                        : diffEncargo === 0
                          ? 'Despachar hoy'
                          : diffEncargo === 1
                            ? 'Para mañana'
                            : `En ${diffEncargo} días`;

                  return (
                    <div
                      key={o.id}
                      className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:bg-sf/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-medium text-[var(--tx)] truncate">
                          <span className="truncate">{o.nombre_cliente || 'Cliente sin nombre'}</span>
                          <span className="text-xs font-normal text-[var(--mu)] shrink-0">
                            · {getEstadoLabel(o.estado)}
                          </span>
                          {orderTab === 'encargos' && (
                            <span
                              className={`text-xs font-medium shrink-0 ${
                                diffEncargo !== null && diffEncargo <= 0
                                  ? 'text-rose-600 dark:text-rose-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              · {labelEncargo}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[var(--mu)] truncate mt-0.5 tabular-nums">
                          <span>{o.sku || o.catalogo_sku || 'Producto sin SKU'}</span>
                          {o.departamento ? <span> · {o.departamento}</span> : null}
                          {o.courier ? <span> · {o.courier}</span> : null}
                          {o.created_at ? <span> · {fmtAgo(o.created_at)}</span> : null}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                        <div className="text-right">
                          <div className="text-sm font-bold font-mono tabular-nums text-[var(--tx)]">
                            {formatMoney(Number(o.total) || 0)}
                          </div>
                          <div className="text-[11px] text-[var(--mu)]">
                            {o.metodo_pago || 'Contra entrega'}
                          </div>
                        </div>
                        <Link
                          to="/pedidos"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-medium text-[var(--tx)] transition-colors whitespace-nowrap"
                        >
                          Gestionar
                          <ArrowRight size={12} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="px-5 py-3 border-t border-[var(--bd)] bg-sf/30 flex items-center justify-between text-xs">
              <span className="text-[var(--mu)] tabular-nums">
                Mostrando {Math.min(activeTabList.length, 7)} de {activeTabList.length}
              </span>
              <Link
                to="/pedidos"
                className="font-semibold text-[var(--tx)] hover:opacity-75 transition-opacity"
              >
                Ir a Pedidos →
              </Link>
            </div>
          </section>

          {/* 2. Pulso UniChat & Bot Todd */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold text-[var(--tx)]">Pulso WhatsApp &amp; Bot Todd</h2>
                {!loadingCore && (
                  <span className="text-xs text-[var(--mu)] tabular-nums hidden sm:inline">
                    · {chatMetrics.toddCount} Todd · {chatMetrics.humanCount} humano · {chatMetrics.sinResponder.length} sin responder
                  </span>
                )}
              </div>
              <Link
                to="/unichat"
                className="text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] transition-colors whitespace-nowrap"
              >
                Abrir UniChat →
              </Link>
            </div>

            {loadingCore ? (
              <div className="p-5">
                <Skeleton h={90} />
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-3 divide-x divide-[var(--bd)] border-b border-[var(--bd)] bg-sf/30 text-xs">
                  <div className="px-5 py-3">
                    <div className="text-[var(--mu)]">Activos Todd</div>
                    <div className="text-base font-bold font-mono tabular-nums mt-0.5 flex items-center gap-1.5 text-[var(--tx)]">
                      <Bot size={13} className="text-[var(--mu)]" />
                      {chatMetrics.toddCount}
                    </div>
                  </div>
                  <div className="px-5 py-3">
                    <div className="text-[var(--mu)]">Modo Humano</div>
                    <div className="text-base font-bold font-mono tabular-nums mt-0.5 flex items-center gap-1.5 text-[var(--tx)]">
                      <User size={13} className="text-[var(--mu)]" />
                      {chatMetrics.humanCount}
                    </div>
                  </div>
                  <div className="px-5 py-3">
                    <div className="text-[var(--mu)]">Sin responder</div>
                    <div
                      className={`text-base font-bold font-mono tabular-nums mt-0.5 ${
                        chatMetrics.sinResponder.length > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {chatMetrics.sinResponder.length}
                    </div>
                  </div>
                </div>

                {chatMetrics.sinResponder.length === 0 ? (
                  <div className="text-xs text-[var(--mu)] py-8 text-center">
                    Todos los chats recientes han sido respondidos.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--bd)]">
                    {chatMetrics.sinResponder.slice(0, 4).map((c) => (
                      <Link
                        key={c.id}
                        to="/unichat"
                        className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-sf/50 transition-colors"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-[var(--tx)] truncate">
                            {c.contact_name || formatShortPhone(c)}
                            <span className="font-normal text-[var(--mu)]">
                              {' '}
                              · {c.status === 'human' ? 'Humano' : 'Bot Todd'}
                            </span>
                          </div>
                          <div className="text-xs text-[var(--mu)] truncate mt-0.5">
                            {c.last_message || 'Mensaje entrante sin vista previa'}
                          </div>
                        </div>
                        <div className="text-[11px] text-[var(--mu)] font-mono tabular-nums shrink-0">
                          {c.updated_at ? fmtAgo(c.updated_at) : ''}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 3. Cola de Contenido Social */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-[var(--tx)]">Cola de Contenido Social</h2>
                {lastPost && (
                  <span className="text-xs text-[var(--mu)] hidden sm:inline">
                    · Último {fmtAgo(lastPost.posted_at)}
                  </span>
                )}
              </div>
              <Link
                to="/cola"
                className="text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
              >
                Ver cola →
              </Link>
            </div>

            {queue.isLoading ? (
              <div className="p-5">
                <Skeleton h={72} />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-[var(--bd)]">
                <div className="p-5">
                  <div className="text-xs font-medium text-[var(--mu)] mb-3 tabular-nums">
                    Publicado hoy ({todayPosts.length})
                  </div>
                  {todayPosts.length === 0 ? (
                    <div className="text-xs text-[var(--mu)] py-6 text-center">
                      Sin publicaciones automáticas hoy.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--bd)]">
                      {todayPosts.slice(0, 3).map((p) => (
                        <div key={p.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.nombre ?? 'Producto publicado'}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-lg object-cover bg-sf border border-[var(--bd)] shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-sf border border-[var(--bd)] grid place-items-center shrink-0">
                              <Boxes size={14} className="text-[var(--mu)]" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-[var(--tx)] truncate">{p.nombre ?? p.sku ?? '—'}</div>
                            <div className="text-[11px] text-[var(--mu)] font-mono tabular-nums">{fmtAgo(p.posted_at)}</div>
                          </div>
                          <CheckCircle2 size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="p-5">
                  <div className="text-xs font-medium text-[var(--mu)] mb-3 tabular-nums">
                    Próximos en cola ({pendingPosts.length})
                  </div>
                  {pendingPosts.length === 0 ? (
                    <div className="text-xs text-[var(--mu)] py-6 text-center">
                      No hay productos en cola.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--bd)]">
                      {pendingPosts.slice(0, 3).map((p) => (
                        <div key={p.id} className="py-2.5 first:pt-0 last:pb-0 flex items-center gap-3">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.nombre ?? 'Producto en cola'}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-lg object-cover bg-sf border border-[var(--bd)] shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-sf border border-[var(--bd)] grid place-items-center shrink-0">
                              <Clock size={14} className="text-[var(--mu)]" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium text-[var(--tx)] truncate">{p.nombre ?? p.sku ?? '—'}</div>
                            <div className="text-[11px] text-[var(--mu)]">En espera</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* Columna derecha */}
        <div className="lg:col-span-4 flex flex-col gap-6">
          {/* 1. Centro de alertas */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--tx)]">Centro de alertas</h2>
              <span className="text-xs text-[var(--mu)] font-mono tabular-nums">{alertCount} activas</span>
            </div>

            {loadingCore ? (
              <div className="p-5">
                <Skeleton h={80} />
              </div>
            ) : alertCount === 0 ? (
              <div className="text-xs text-[var(--mu)] py-8 px-5 text-center">
                Sin alertas operativas, de stock o de pagos próximos.
              </div>
            ) : (
              <div className="divide-y divide-[var(--bd)]">
                {orderMetrics.encargosUrgentes.slice(0, 3).map((e) => (
                  <Link
                    key={`enc-${e.id}`}
                    to="/pedidos"
                    className="px-5 py-3 hover:bg-sf/50 transition-colors flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--tx)] flex items-center gap-1.5">
                        <CalendarClock size={13} className="text-rose-600 dark:text-rose-400 shrink-0" />
                        <span className="truncate">Encargo: {e.nombre_cliente || 'Cliente'}</span>
                      </div>
                      <div className="text-[11px] text-[var(--mu)] mt-0.5 truncate">
                        {e.sku || e.catalogo_sku || 'Sin SKU'} · Fecha {e.fecha_programada || 'por confirmar'}
                      </div>
                    </div>
                    <span className="text-xs font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400 shrink-0">
                      {formatMoney(Number(e.total) || 0)}
                    </span>
                  </Link>
                ))}

                {pagosProximos.map((p) => (
                  <Link
                    key={`pago-${p.id}`}
                    to="/finanzas"
                    className="px-5 py-3 hover:bg-sf/50 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--tx)] truncate">Pago próximo: {p.nombre}</div>
                      <div className="text-[11px] text-[var(--mu)] tabular-nums">Vence {p.fecha_vencimiento}</div>
                    </div>
                    <span className="text-xs font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 shrink-0">
                      {formatMoney(Number(p.monto) || 0)}
                    </span>
                  </Link>
                ))}

                {inventoryMetrics.lowStock.length > 0 && (
                  <div className="px-5 py-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-[var(--tx)]">Stock bajo real</span>
                      <Link to="/inventario" className="text-[11px] font-medium text-[var(--mu)] hover:text-[var(--tx)]">
                        Kárdex →
                      </Link>
                    </div>
                    <div className="space-y-1.5">
                      {inventoryMetrics.lowStock.slice(0, 4).map((item) => (
                        <div
                          key={item.sku}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate text-[var(--mu)]">{item.nombre || item.sku}</span>
                          <span
                            className={`font-mono tabular-nums font-semibold shrink-0 ${
                              item.stock_disponible <= 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {item.stock_disponible} disp.
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {queueErrors.length > 0 && (
                  <Link
                    to="/cola"
                    className="px-5 py-3 hover:bg-sf/50 transition-colors flex items-center justify-between text-xs"
                  >
                    <span className="font-semibold text-rose-600 dark:text-rose-400">
                      {queueErrors.length} error{queueErrors.length > 1 ? 'es' : ''} en cola social
                    </span>
                    <span className="text-[var(--mu)]">Revisar →</span>
                  </Link>
                )}
              </div>
            )}
          </section>

          {/* 2. Pulso de caja y pauta hoy */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--tx)]">Caja &amp; Pauta hoy</h2>
              <Link to="/finanzas" className="text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)]">
                Finanzas →
              </Link>
            </div>

            {loadingCore ? (
              <div className="p-5">
                <Skeleton h={76} />
              </div>
            ) : (
              <div className="divide-y divide-[var(--bd)]">
                <div className="px-5 py-3.5 flex items-center justify-between">
                  <div className="text-xs text-[var(--mu)]">Saldo total cuentas</div>
                  <div className="text-base font-bold font-mono tabular-nums text-[var(--tx)]">{formatMoney(totalCaja)}</div>
                </div>
                <div className="px-5 py-3.5 flex items-center justify-between">
                  <div>
                    <div className="text-xs text-[var(--mu)]">Pauta registrada hoy</div>
                    <Link to="/rentabilidad" className="text-[11px] font-medium text-[var(--mu)] hover:text-[var(--tx)]">
                      Ver ROAS del mes →
                    </Link>
                  </div>
                  <div className="text-base font-bold font-mono tabular-nums text-[var(--tx)]">{formatMoney(adSpendToday)}</div>
                </div>
              </div>
            )}
          </section>

          {/* 3. Notas rápidas */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-[var(--tx)]">Notas rápidas</h2>
              <span className="text-xs text-[var(--mu)] font-mono tabular-nums">{notas.length}</span>
            </div>

            <div className="p-4 border-b border-[var(--bd)]">
              <form onSubmit={handleAddNota} className="flex gap-2">
                <input
                  type="text"
                  value={nuevaNota}
                  onChange={(e) => setNuevaNota(e.target.value)}
                  placeholder="Anotar pendiente del día..."
                  className="flex-1 min-w-0 bg-sf border border-[var(--bd)] rounded-lg px-3 py-2 text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                />
                <button
                  type="submit"
                  disabled={savingNote || !nuevaNota.trim()}
                  aria-label="Agregar nota"
                  className="px-3 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0 cursor-pointer"
                >
                  <Plus size={14} />
                </button>
              </form>
            </div>

            <div className="divide-y divide-[var(--bd)] max-h-56 overflow-y-auto">
              {notas.map((nota) => (
                <div
                  key={nota.id}
                  className="flex items-start justify-between gap-2 px-5 py-3 hover:bg-sf/50 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-[var(--tx)] break-words">{nota.contenido}</div>
                    {nota.created_at && (
                      <div className="text-[10px] text-[var(--mu)] mt-1 tabular-nums">{fmtAgo(nota.created_at)}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteNota(nota.id)}
                    aria-label="Eliminar nota"
                    className="p-1.5 rounded-lg text-[var(--mu)] hover:text-rose-500 transition-colors shrink-0 cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {notas.length === 0 && (
                <div className="text-xs text-[var(--mu)] text-center py-6">Sin notas pendientes para hoy.</div>
              )}
            </div>
          </section>

          {/* 4. Inventario y catálogo */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--tx)]">Bodega &amp; Catálogo</h2>
              <Link to="/catalogo" className="text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)]">
                Catálogo →
              </Link>
            </div>

            <div className="grid grid-cols-2 divide-x divide-y divide-[var(--bd)] text-xs">
              <div className="p-4">
                <div className="text-[var(--mu)]">SKUs activos</div>
                <div className="text-lg font-bold font-mono tabular-nums mt-0.5 text-[var(--tx)]">
                  {inventoryMetrics.activeCount}
                </div>
              </div>
              <div className="p-4 border-t-0">
                <div className="text-[var(--mu)]">Unidades disp.</div>
                <div className="text-lg font-bold font-mono tabular-nums mt-0.5 text-[var(--tx)]">
                  {inventoryMetrics.totalUnits}
                </div>
              </div>
              <div className="p-4 border-l-0">
                <div className="text-[var(--mu)]">Productos</div>
                <div className="text-lg font-bold font-mono tabular-nums mt-0.5 text-[var(--tx)]">
                  {productos.data?.length ?? '—'}
                </div>
              </div>
              <div className="p-4">
                <div className="text-[var(--mu)]">Variantes</div>
                <div className="text-lg font-bold font-mono tabular-nums mt-0.5 text-[var(--tx)]">
                  {variantes.data?.length ?? '—'}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Modal nuevo pedido directo desde Hoy */}
      {showOrderModal && (
        <PedidoModal
          onClose={() => setShowOrderModal(false)}
          onSaved={() => {
            setShowOrderModal(false);
            void loadDashboardData(true);
          }}
          pedidosExistentes={orders}
        />
      )}
    </div>
  );
}
