import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { usePostQueue } from '@/hooks/usePostQueue';
import { useProductos, useVariantes } from '@/hooks/useCatalog';
import { fetchStockItems } from '@/lib/inventory';
import { fetchCashAccounts } from '@/lib/finance';
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

      if ((o.estado === 'en_camino' || o.estado === 'entregado') && !o.liquidado) {
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
  }, [orders, todayISO]);

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
    <div className="max-w-6xl mx-auto flex flex-col gap-5 pb-12">
      {/* HERO OPERATIVO DEL DÍA */}
      <section className="bg-cd bd rounded-2xl p-5 sm:p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs tx-mu tabular-nums">
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
          </div>

          <h1
            className="text-xl sm:text-2xl lg:text-[26px] font-bold mt-2 tracking-tight leading-snug"
            style={{ textWrap: 'balance' }}
          >
            {heroHeadline}
          </h1>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs tx-mu tabular-nums">
            <span>
              Último post social: {lastPost ? fmtAgo(lastPost.posted_at) : 'Sin registros'}
            </span>
            <span aria-hidden="true">·</span>
            <span>{todayPosts.length} publicados hoy</span>
            <span aria-hidden="true">·</span>
            <span>{pendingPosts.length} en cola</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => loadDashboardData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-sf bd text-xs font-medium hover:opacity-85 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Actualizar
          </button>

          <Link
            to="/unichat"
            className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-sf bd text-xs font-medium hover:opacity-85 transition-opacity whitespace-nowrap shrink-0"
          >
            <MessageSquare size={14} />
            UniChat ({chatMetrics.sinResponder.length})
          </Link>

          <button
            type="button"
            onClick={() => setShowOrderModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
            style={{ background: 'var(--tx)', color: 'var(--cd)' }}
          >
            <Plus size={14} />
            Nuevo Pedido
          </button>
        </div>
      </section>

      {/* STRIP DE KPIs OPERATIVOS (4 COLUMNAS) */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Link
          to="/pedidos"
          className="bg-cd bd rounded-2xl p-4 hover:border-[var(--ac)] transition-colors flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Ventas hoy</span>
            <TrendingUp size={15} style={{ color: 'var(--ok)' }} />
          </div>
          {loadingCore ? (
            <Skeleton h={34} />
          ) : (
            <div>
              <div className="text-xl sm:text-2xl font-bold mono tabular-nums">
                {formatMoney(orderMetrics.ventasHoy)}
              </div>
              <div className="text-xs tx-mu mt-0.5 tabular-nums">
                {orderMetrics.pedidosHoyCount} pedido{orderMetrics.pedidosHoyCount === 1 ? '' : 's'} registrados hoy
              </div>
            </div>
          )}
        </Link>

        <Link
          to="/pedidos"
          className="bg-cd bd rounded-2xl p-4 hover:border-[var(--ac)] transition-colors flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Por despachar</span>
            <Truck size={15} style={{ color: 'var(--ac)' }} />
          </div>
          {loadingCore ? (
            <Skeleton h={34} />
          ) : (
            <div>
              <div className="text-xl sm:text-2xl font-bold mono tabular-nums">
                {orderMetrics.porDespachar.length}
              </div>
              <div className="text-xs tx-mu mt-0.5 tabular-nums">
                {orderMetrics.enCaminoCount} en camino · {orderMetrics.encargosUrgentes.length} encargos próx.
              </div>
            </div>
          )}
        </Link>

        <Link
          to="/pedidos"
          className="bg-cd bd rounded-2xl p-4 hover:border-[var(--ac)] transition-colors flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>Cobros en calle</span>
            <DollarSign size={15} className="tx-mu" />
          </div>
          {loadingCore ? (
            <Skeleton h={34} />
          ) : (
            <div>
              <div className="text-xl sm:text-2xl font-bold mono tabular-nums">
                {formatMoney(orderMetrics.cobrosEnCalle)}
              </div>
              <div className="text-xs tx-mu mt-0.5">Pendiente por liquidar</div>
            </div>
          )}
        </Link>

        <Link
          to="/unichat"
          className="bg-cd bd rounded-2xl p-4 hover:border-[var(--ac)] transition-colors flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between text-xs tx-mu">
            <span>UniChat & Todd</span>
            <Bot size={15} style={{ color: 'var(--ac)' }} />
          </div>
          {loadingCore ? (
            <Skeleton h={34} />
          ) : (
            <div>
              <div className="text-xl sm:text-2xl font-bold mono tabular-nums">
                {chatMetrics.sinResponder.length}{' '}
                <span className="text-xs font-normal tx-mu">sin resp.</span>
              </div>
              <div className="text-xs tx-mu mt-0.5 tabular-nums">
                {chatMetrics.toddCount} en Todd · {chatMetrics.humanCount} humano
              </div>
            </div>
          )}
        </Link>
      </section>

      {/* CUERPO PRINCIPAL: 2 COLUMNAS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* COLUMNA IZQUIERDA (OPERACIÓN COD, UNICHAT Y COLA) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* 1. DESPACHO & PEDIDOS DE HOY */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <ShoppingBag size={16} style={{ color: 'var(--ac)' }} />
                <h2 className="text-sm font-semibold">Operación COD & Despachos</h2>
              </div>

              <div className="flex items-center gap-1 p-1 bg-sf bd rounded-xl overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setOrderTab('despachar')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    orderTab === 'despachar'
                      ? 'bg-cd bd font-semibold'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  Por despachar ({orderMetrics.porDespachar.length})
                </button>
                <button
                  type="button"
                  onClick={() => setOrderTab('encargos')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    orderTab === 'encargos'
                      ? 'bg-cd bd font-semibold'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  Encargos ({orderMetrics.encargosUrgentes.length})
                </button>
                <button
                  type="button"
                  onClick={() => setOrderTab('ruta')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    orderTab === 'ruta'
                      ? 'bg-cd bd font-semibold'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  En ruta ({orderMetrics.enRuta.length})
                </button>
                <button
                  type="button"
                  onClick={() => setOrderTab('hoy')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    orderTab === 'hoy'
                      ? 'bg-cd bd font-semibold'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  Creados hoy ({orderMetrics.recientesHoy.length})
                </button>
              </div>
            </div>

            {loadingCore ? (
              <div className="flex flex-col gap-2">
                <Skeleton h={52} />
                <Skeleton h={52} />
                <Skeleton h={52} />
              </div>
            ) : activeTabList.length === 0 ? (
              <div className="py-8 px-4 text-center bg-sf bd rounded-xl flex flex-col items-center gap-3">
                <p className="text-sm tx-mu">
                  {orderTab === 'despachar' && 'No hay pedidos pendientes por empacar o despachar.'}
                  {orderTab === 'encargos' && 'No hay encargos programados para los próximos 2 días.'}
                  {orderTab === 'ruta' && 'No hay pedidos marcados en camino en este momento.'}
                  {orderTab === 'hoy' && 'Aún no se han registrado pedidos nuevos hoy.'}
                </p>
                <button
                  type="button"
                  onClick={() => setShowOrderModal(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-medium bg-cd bd hover:border-[var(--ac)] cursor-pointer"
                >
                  <Plus size={14} />
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
                      className="py-3 first:pt-1 last:pb-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold truncate">
                          <span className="truncate">{o.nombre_cliente || 'Cliente sin nombre'}</span>
                          <span className="text-xs font-normal tx-mu shrink-0">
                            · {getEstadoLabel(o.estado)}
                          </span>
                          {orderTab === 'encargos' && (
                            <span
                              className="text-xs font-medium shrink-0"
                              style={{
                                color: diffEncargo !== null && diffEncargo <= 0 ? 'var(--er)' : 'var(--ac)',
                              }}
                            >
                              · {labelEncargo}
                            </span>
                          )}
                        </div>
                        <div className="text-xs tx-mu truncate mt-0.5 tabular-nums">
                          <span>{o.sku || o.catalogo_sku || 'Producto sin SKU'}</span>
                          {o.departamento ? <span> · {o.departamento}</span> : null}
                          {o.courier ? <span> · {o.courier}</span> : null}
                          {o.created_at ? <span> · {fmtAgo(o.created_at)}</span> : null}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 shrink-0">
                        <div className="text-right">
                          <div className="text-sm font-bold mono tabular-nums">
                            {formatMoney(Number(o.total) || 0)}
                          </div>
                          <div className="text-[11px] tx-mu">
                            {o.metodo_pago || 'Contra entrega'}
                          </div>
                        </div>
                        <Link
                          to="/pedidos"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-sf bd text-xs font-medium hover:border-[var(--ac)] transition-colors whitespace-nowrap"
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

            <div className="mt-4 pt-3 border-t border-[var(--bd)] flex items-center justify-between text-xs">
              <span className="tx-mu tabular-nums">
                Mostrando {Math.min(activeTabList.length, 7)} de {activeTabList.length}
              </span>
              <Link to="/pedidos" className="font-semibold hover:underline" style={{ color: 'var(--ac)' }}>
                Ir al Centro de Pedidos →
              </Link>
            </div>
          </section>

          {/* 2. PULSO UNICHAT & BOT TODD */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare size={16} style={{ color: 'var(--ac)' }} />
                <h2 className="text-sm font-semibold">Pulso WhatsApp & Bot Todd</h2>
              </div>
              <Link
                to="/unichat"
                className="text-xs font-semibold hover:underline whitespace-nowrap"
                style={{ color: 'var(--ac)' }}
              >
                Abrir UniChat →
              </Link>
            </div>

            {loadingCore ? (
              <Skeleton h={90} />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-3 gap-3 p-3 bg-sf bd rounded-xl text-xs">
                  <div>
                    <div className="tx-mu">Activos Todd</div>
                    <div className="text-base font-bold mono tabular-nums mt-0.5 flex items-center gap-1.5">
                      <Bot size={14} style={{ color: 'var(--ac)' }} />
                      {chatMetrics.toddCount}
                    </div>
                  </div>
                  <div>
                    <div className="tx-mu">Modo Humano</div>
                    <div className="text-base font-bold mono tabular-nums mt-0.5 flex items-center gap-1.5">
                      <User size={14} />
                      {chatMetrics.humanCount}
                    </div>
                  </div>
                  <div>
                    <div className="tx-mu">Sin responder</div>
                    <div
                      className="text-base font-bold mono tabular-nums mt-0.5"
                      style={{ color: chatMetrics.sinResponder.length > 0 ? 'var(--er)' : 'var(--ok)' }}
                    >
                      {chatMetrics.sinResponder.length}
                    </div>
                  </div>
                </div>

                {chatMetrics.sinResponder.length === 0 ? (
                  <div className="text-xs tx-mu py-4 text-center bg-sf bd rounded-xl">
                    Todos los chats recientes han sido respondidos.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--bd)]">
                    {chatMetrics.sinResponder.slice(0, 4).map((c) => (
                      <Link
                        key={c.id}
                        to="/unichat"
                        className="py-2.5 first:pt-1 last:pb-1 flex items-center justify-between gap-3 hover:opacity-85 transition-opacity"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">
                            {c.contact_name || formatShortPhone(c)}
                            <span className="font-normal tx-mu">
                              {' '}
                              · {c.status === 'human' ? 'Humano' : 'Bot Todd'}
                            </span>
                          </div>
                          <div className="text-xs tx-mu truncate mt-0.5">
                            {c.last_message || 'Mensaje entrante sin vista previa'}
                          </div>
                        </div>
                        <div className="text-[11px] tx-mu mono tabular-nums shrink-0">
                          {c.updated_at ? fmtAgo(c.updated_at) : ''}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>

          {/* 3. COLA SOCIAL (PUBLICADO HOY + PRÓXIMOS) */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="flex items-center gap-2">
                <Send size={15} className="tx-mu" />
                <h2 className="text-sm font-semibold">Cola de Contenido Social</h2>
              </div>
              <Link to="/cola" className="text-xs font-semibold hover:underline" style={{ color: 'var(--ac)' }}>
                Ver cola →
              </Link>
            </div>

            {queue.isLoading ? (
              <Skeleton h={72} />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-xs font-medium tx-mu mb-2">
                    Publicado hoy ({todayPosts.length})
                  </div>
                  {todayPosts.length === 0 ? (
                    <div className="text-xs tx-mu py-4 px-3 text-center bg-sf bd rounded-xl">
                      Sin publicaciones automáticas hoy.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {todayPosts.slice(0, 3).map((p) => (
                        <div key={p.id} className="flex items-center gap-3 p-2.5 bg-sf bd rounded-xl">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.nombre ?? 'Producto publicado'}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-lg object-cover bg-cd bd shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-cd bd grid place-items-center shrink-0">
                              <Boxes size={14} className="tx-mu" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate">{p.nombre ?? p.sku ?? '—'}</div>
                            <div className="text-[11px] tx-mu mono tabular-nums">{fmtAgo(p.posted_at)}</div>
                          </div>
                          <CheckCircle2 size={15} style={{ color: 'var(--ok)' }} className="shrink-0" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <div className="text-xs font-medium tx-mu mb-2">
                    Próximos en cola ({pendingPosts.length})
                  </div>
                  {pendingPosts.length === 0 ? (
                    <div className="text-xs tx-mu py-4 px-3 text-center bg-sf bd rounded-xl">
                      No hay productos en cola.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {pendingPosts.slice(0, 3).map((p) => (
                        <div key={p.id} className="flex items-center gap-3 p-2.5 bg-sf bd rounded-xl">
                          {p.image_url ? (
                            <img
                              src={p.image_url}
                              alt={p.nombre ?? 'Producto en cola'}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-lg object-cover bg-cd bd shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-cd bd grid place-items-center shrink-0">
                              <Clock size={14} className="tx-mu" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold truncate">{p.nombre ?? p.sku ?? '—'}</div>
                            <div className="text-[11px] tx-mu">En espera</div>
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

        {/* COLUMNA DERECHA (ALERTAS, FINANZAS HOY, NOTAS, BODEGA) */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          {/* 1. CENTRO DE ALERTAS UNIFICADO (DARK-MODE SAFE) */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  size={16}
                  style={{ color: alertCount > 0 ? 'var(--ac)' : 'var(--ok)' }}
                />
                <h2 className="text-sm font-semibold">Centro de Alertas</h2>
              </div>
              <span className="text-xs tx-mu mono tabular-nums">{alertCount} activas</span>
            </div>

            {loadingCore ? (
              <Skeleton h={80} />
            ) : alertCount === 0 ? (
              <div className="text-xs tx-mu py-4 px-3 bg-sf bd rounded-xl text-center">
                Sin alertas operativas, de stock o de pagos próximos.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {orderMetrics.encargosUrgentes.slice(0, 3).map((e) => (
                  <Link
                    key={`enc-${e.id}`}
                    to="/pedidos"
                    className="p-3 bg-sf bd rounded-xl hover:border-[var(--ac)] transition-colors flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold flex items-center gap-1.5">
                        <CalendarClock size={13} style={{ color: 'var(--er)' }} className="shrink-0" />
                        <span className="truncate">Encargo: {e.nombre_cliente || 'Cliente'}</span>
                      </div>
                      <div className="text-[11px] tx-mu mt-0.5 truncate">
                        {e.sku || e.catalogo_sku || 'Sin SKU'} · Fecha {e.fecha_programada || 'por confirmar'}
                      </div>
                    </div>
                    <span className="text-xs font-bold mono tabular-nums shrink-0" style={{ color: 'var(--er)' }}>
                      {formatMoney(Number(e.total) || 0)}
                    </span>
                  </Link>
                ))}

                {pagosProximos.map((p) => (
                  <Link
                    key={`pago-${p.id}`}
                    to="/pagos"
                    className="p-3 bg-sf bd rounded-xl hover:border-[var(--ac)] transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold truncate">Pago próximo: {p.nombre}</div>
                      <div className="text-[11px] tx-mu tabular-nums">Vence {p.fecha_vencimiento}</div>
                    </div>
                    <span className="text-xs font-bold mono tabular-nums shrink-0" style={{ color: 'var(--ac)' }}>
                      {formatMoney(Number(p.monto) || 0)}
                    </span>
                  </Link>
                ))}

                {inventoryMetrics.lowStock.length > 0 && (
                  <div className="p-3 bg-sf bd rounded-xl">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold">Stock bajo real</span>
                      <Link to="/inventario" className="text-[11px] hover:underline" style={{ color: 'var(--ac)' }}>
                        Kárdex →
                      </Link>
                    </div>
                    <div className="divide-y divide-[var(--bd)]">
                      {inventoryMetrics.lowStock.slice(0, 4).map((item) => (
                        <div
                          key={item.sku}
                          className="py-1.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate">{item.nombre || item.sku}</span>
                          <span
                            className="mono tabular-nums font-semibold shrink-0"
                            style={{ color: item.stock_disponible <= 0 ? 'var(--er)' : 'var(--ac)' }}
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
                    className="p-3 bg-sf bd rounded-xl hover:border-[var(--er)] transition-colors flex items-center justify-between text-xs"
                  >
                    <span className="font-semibold" style={{ color: 'var(--er)' }}>
                      {queueErrors.length} error{queueErrors.length > 1 ? 'es' : ''} en cola social
                    </span>
                    <span className="tx-mu">Revisar →</span>
                  </Link>
                )}
              </div>
            )}
          </section>

          {/* 2. PULSO DE CAJA Y PAUTA HOY */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Wallet size={16} style={{ color: 'var(--ok)' }} />
                <h2 className="text-sm font-semibold">Caja & Pauta Hoy</h2>
              </div>
              <Link to="/finanzas" className="text-xs hover:underline" style={{ color: 'var(--ac)' }}>
                Finanzas →
              </Link>
            </div>

            {loadingCore ? (
              <Skeleton h={76} />
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="p-3 bg-sf bd rounded-xl flex items-center justify-between">
                  <div className="text-xs tx-mu">Saldo total cuentas</div>
                  <div className="text-base font-bold mono tabular-nums">{formatMoney(totalCaja)}</div>
                </div>
                <div className="p-3 bg-sf bd rounded-xl flex items-center justify-between">
                  <div>
                    <div className="text-xs tx-mu">Pauta registrada hoy</div>
                    <Link to="/rentabilidad" className="text-[11px] hover:underline" style={{ color: 'var(--ac)' }}>
                      Ver ROAS del mes →
                    </Link>
                  </div>
                  <div className="text-base font-bold mono tabular-nums">{formatMoney(adSpendToday)}</div>
                </div>
              </div>
            )}
          </section>

          {/* 3. NOTAS RÁPIDAS */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <StickyNote size={16} style={{ color: 'var(--ac)' }} />
                <h2 className="text-sm font-semibold">Notas Rápidas</h2>
              </div>
              <span className="text-xs tx-mu mono tabular-nums">{notas.length}</span>
            </div>

            <form onSubmit={handleAddNota} className="flex gap-2 mb-3">
              <input
                type="text"
                value={nuevaNota}
                onChange={(e) => setNuevaNota(e.target.value)}
                placeholder="Anotar pendiente del día..."
                className="flex-1 min-w-0 bg-sf bd rounded-xl px-3 py-2 text-xs outline-none focus:border-[var(--ac)]"
              />
              <button
                type="submit"
                disabled={savingNote || !nuevaNota.trim()}
                aria-label="Agregar nota"
                className="px-3 py-2 rounded-xl text-xs font-semibold hover:opacity-85 disabled:opacity-40 transition-opacity shrink-0 cursor-pointer"
                style={{ background: 'var(--tx)', color: 'var(--cd)' }}
              >
                <Plus size={14} />
              </button>
            </form>

            <div className="flex flex-col gap-2 max-h-56 overflow-y-auto">
              {notas.map((nota) => (
                <div
                  key={nota.id}
                  className="flex items-start justify-between gap-2 p-2.5 bg-sf bd rounded-xl"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs break-words">{nota.contenido}</div>
                    {nota.created_at && (
                      <div className="text-[10px] tx-mu mt-1 tabular-nums">{fmtAgo(nota.created_at)}</div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteNota(nota.id)}
                    aria-label="Eliminar nota"
                    className="p-1.5 rounded-lg tx-mu hover:text-[var(--er)] transition-colors shrink-0 cursor-pointer"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {notas.length === 0 && (
                <div className="text-xs tx-mu text-center py-3">Sin notas pendientes para hoy.</div>
              )}
            </div>
          </section>

          {/* 4. INVENTARIO & CATÁLOGO REAL */}
          <section className="bg-cd bd rounded-2xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Package size={16} className="tx-mu" />
                <h2 className="text-sm font-semibold">Bodega & Catálogo</h2>
              </div>
              <Link to="/catalogo" className="text-xs hover:underline" style={{ color: 'var(--ac)' }}>
                Catálogo →
              </Link>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="p-3 bg-sf bd rounded-xl">
                <div className="tx-mu">SKUs activos</div>
                <div className="text-lg font-bold mono tabular-nums mt-0.5">
                  {inventoryMetrics.activeCount}
                </div>
              </div>
              <div className="p-3 bg-sf bd rounded-xl">
                <div className="tx-mu">Unidades disp.</div>
                <div className="text-lg font-bold mono tabular-nums mt-0.5">
                  {inventoryMetrics.totalUnits}
                </div>
              </div>
              <div className="p-3 bg-sf bd rounded-xl">
                <div className="tx-mu">Productos</div>
                <div className="text-lg font-bold mono tabular-nums mt-0.5">
                  {productos.data?.length ?? '—'}
                </div>
              </div>
              <div className="p-3 bg-sf bd rounded-xl">
                <div className="tx-mu">Variantes</div>
                <div className="text-lg font-bold mono tabular-nums mt-0.5">
                  {variantes.data?.length ?? '—'}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* MODAL NUEVO PEDIDO DIRECTO DESDE HOY */}
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
