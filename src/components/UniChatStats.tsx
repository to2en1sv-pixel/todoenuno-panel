import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  ArrowRight,
  BarChart3,
  Bot,
  Clock,
  Eye,
  EyeOff,
  Megaphone,
  MessageSquare,
  Package,
  RefreshCw,
  ShoppingBag,
  TrendingUp,
  User,
} from 'lucide-react';

export type StatsPeriod = 'today' | '7d' | '30d' | 'all';

type ConversationLite = {
  id: string;
  instance_id: string;
  contact_name: string | null;
  contact_phone: string | null;
  last_message: string | null;
  updated_at?: string;
  status: string | null;
};

type WhatsappStateLite = {
  telefono: string;
  last_sku?: string | null;
  last_nombre?: string | null;
  last_precio?: number | null;
  last_detalle?: string | null;
  paso_actual?: string | null;
  updated_at?: string | null;
};

type MessageLite = {
  id: string;
  conversation_id: string;
  from_me: boolean;
  created_at: string;
  telefono_real?: string | null;
};

interface UniChatStatsProps {
  conversations: ConversationLite[];
  allOrders: any[];
  lastMsgFromMeMap: Record<string, boolean>;
  hideLegacy: boolean;
  legacyCount: number;
  onToggleHideLegacy: () => void;
  onBackToChats: (filter?: 'all' | 'unread' | 'bot' | 'human') => void;
  onRefreshAll: () => Promise<void>;
}

const FUNNEL_STEPS: { key: string; label: string; hint: string }[] = [
  { key: 'inicio', label: 'Inicio', hint: 'Primer contacto' },
  { key: 'cotizando', label: 'Cotizando', hint: 'Consultando precio y variantes' },
  { key: 'esperando_nombre', label: 'Esperando nombre', hint: 'Iniciando toma de datos' },
  { key: 'esperando_direccion', label: 'Esperando dirección', hint: 'Pidiendo punto de entrega' },
  { key: 'esperando_pago', label: 'Confirmando pago', hint: 'Contra entrega o transferencia' },
  { key: 'completado', label: 'Completado', hint: 'Pedido cerrado por Todd' },
];

const PERIOD_LABELS: Record<StatsPeriod, string> = {
  today: 'Hoy',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  all: 'Todo el historial',
};

function cleanDigits8(raw?: string | null): string {
  const digits = String(raw || '').split('@')[0].replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('503')) return digits.slice(3);
  return digits.length >= 8 ? digits.slice(-8) : '';
}

function isLegacyConv(conv: ConversationLite): boolean {
  const inst = String(conv.instance_id || '').toLowerCase();
  if (inst === 'builderbot-principal' || inst === 'ventas' || inst === 'builderbot') {
    return true;
  }
  const hasHexId = /^[0-9a-f]{20,}$/i.test(conv.id);
  const placeholderMsg = (conv.last_message || '').trim() === 'Haz clic para ver los mensajes';
  return hasHexId && placeholderMsg;
}

function getPeriodStartIso(period: StatsPeriod): string | null {
  const now = new Date();
  if (period === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    return start.toISOString();
  }
  if (period === '7d') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (period === '30d') {
    return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

function formatWaitDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 min';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours / 24)} d`;
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function UniChatStats({
  conversations,
  allOrders,
  lastMsgFromMeMap,
  hideLegacy,
  legacyCount,
  onToggleHideLegacy,
  onBackToChats,
  onRefreshAll,
}: UniChatStatsProps) {
  const [period, setPeriod] = useState<StatsPeriod>('7d');
  const [states, setStates] = useState<WhatsappStateLite[]>([]);
  const [messages, setMessages] = useState<MessageLite[]>([]);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);

  const loadStatsData = useCallback(async (selectedPeriod: StatsPeriod, isManual = false) => {
    if (isManual) setRefreshing(true);
    else setLoadingStats(true);
    setStatsError(null);

    try {
      const startIso = getPeriodStartIso(selectedPeriod);

      let stateQuery = supabase
        .from('whatsapp_state')
        .select('telefono,last_sku,last_nombre,last_precio,last_detalle,paso_actual,updated_at')
        .order('updated_at', { ascending: false })
        .limit(2000);

      let msgQuery = supabase
        .from('bb_messages')
        .select('id,conversation_id,from_me,created_at,telefono_real')
        .order('created_at', { ascending: false })
        .limit(3000);

      if (startIso) {
        msgQuery = msgQuery.gte('created_at', startIso);
        stateQuery = stateQuery.gte('updated_at', startIso);
      }

      const [stateRes, msgRes] = await Promise.all([stateQuery, msgQuery]);

      if (stateRes.error) throw new Error(stateRes.error.message);
      if (msgRes.error) throw new Error(msgRes.error.message);

      setStates((stateRes.data || []) as WhatsappStateLite[]);
      setMessages((msgRes.data || []) as MessageLite[]);
    } catch (err: any) {
      setStatsError(err?.message || 'No se pudieron cargar las métricas de UniChat.');
    } finally {
      setLoadingStats(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadStatsData(period);
  }, [period, loadStatsData]);

  const handleManualRefresh = async () => {
    await Promise.all([onRefreshAll(), loadStatsData(period, true)]);
  };

  const periodStartMs = useMemo(() => {
    const iso = getPeriodStartIso(period);
    return iso ? new Date(iso).getTime() : null;
  }, [period]);

  const convIndex = useMemo(() => {
    const map = new Map<string, ConversationLite>();
    for (const c of conversations) map.set(c.id, c);
    return map;
  }, [conversations]);

  const baseConversations = useMemo(() => {
    return conversations.filter(c => {
      if (hideLegacy && isLegacyConv(c)) return false;
      if (periodStartMs !== null) {
        const ts = c.updated_at ? new Date(c.updated_at).getTime() : 0;
        if (!ts || ts < periodStartMs) return false;
      }
      return true;
    });
  }, [conversations, hideLegacy, periodStartMs]);

  const ordersInPeriod = useMemo(() => {
    return allOrders.filter(o => {
      if (String(o.estado || '').toLowerCase() === 'cancelado') return false;
      if (periodStartMs === null) return true;
      const ts = o.created_at ? new Date(o.created_at).getTime() : 0;
      return ts >= periodStartMs;
    });
  }, [allOrders, periodStartMs]);

  const ordersByPhone = useMemo(() => {
    const map = new Map<string, { count: number; total: number }>();
    for (const o of ordersInPeriod) {
      const p8 = cleanDigits8(o.telefono);
      if (!p8) continue;
      const cur = map.get(p8) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(o.total || 0);
      map.set(p8, cur);
    }
    return map;
  }, [ordersInPeriod]);

  // 1. KPIs principales
  const kpis = useMemo(() => {
    const totalChats = baseConversations.length;
    let botChats = 0;
    let humanChats = 0;
    let unreadChats = 0;
    let waitMinutesSum = 0;

    let identifiableChats = 0;
    let convertedChats = 0;
    let convertedRevenue = 0;
    let convertedOrdersCount = 0;
    const seenPhones = new Set<string>();

    const nowMs = Date.now();

    for (const c of baseConversations) {
      if (c.status === 'human') humanChats += 1;
      else botChats += 1;

      if (lastMsgFromMeMap[c.id] === false) {
        unreadChats += 1;
        if (c.updated_at) {
          const mins = Math.max(0, (nowMs - new Date(c.updated_at).getTime()) / 60000);
          waitMinutesSum += mins;
        }
      }

      const p8 = cleanDigits8(c.contact_phone || c.id);
      if (p8 && !seenPhones.has(p8)) {
        seenPhones.add(p8);
        identifiableChats += 1;
        const ord = ordersByPhone.get(p8);
        if (ord && ord.count > 0) {
          convertedChats += 1;
          convertedRevenue += ord.total;
          convertedOrdersCount += ord.count;
        }
      }
    }

    const botRate = totalChats > 0 ? Math.round((botChats / totalChats) * 100) : 0;
    const conversionDenominator = identifiableChats > 0 ? identifiableChats : totalChats;
    const conversionRate =
      conversionDenominator > 0 ? (convertedChats / conversionDenominator) * 100 : 0;
    const avgWaitMinutes = unreadChats > 0 ? waitMinutesSum / unreadChats : 0;

    let incomingMsgs = 0;
    let outgoingMsgs = 0;
    for (const m of messages) {
      if (hideLegacy) {
        const conv = convIndex.get(m.conversation_id);
        if (conv && isLegacyConv(conv)) continue;
      }
      if (m.from_me) outgoingMsgs += 1;
      else incomingMsgs += 1;
    }
    const totalMsgs = incomingMsgs + outgoingMsgs;
    const avgMsgsPerChat = totalChats > 0 ? totalMsgs / totalChats : 0;

    return {
      totalChats,
      botChats,
      humanChats,
      botRate,
      unreadChats,
      avgWaitMinutes,
      identifiableChats,
      convertedChats,
      convertedRevenue,
      convertedOrdersCount,
      conversionRate,
      totalMsgs,
      incomingMsgs,
      outgoingMsgs,
      avgMsgsPerChat,
    };
  }, [baseConversations, lastMsgFromMeMap, ordersByPhone, messages, hideLegacy, convIndex]);

  // 2. Embudo de Bot Todd (whatsapp_state)
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of FUNNEL_STEPS) counts[s.key] = 0;

    for (const st of states) {
      const rawStep = String(st.paso_actual || 'inicio').toLowerCase().trim();
      if (rawStep in counts) counts[rawStep] += 1;
    }

    const total = states.length;
    const maxStepCount = Math.max(1, ...FUNNEL_STEPS.map(s => counts[s.key]));

    const activeSteps = FUNNEL_STEPS.filter(s => s.key !== 'completado' && s.key !== 'inicio');
    let bottleneck: { label: string; count: number } | null = null;
    for (const s of activeSteps) {
      if (counts[s.key] > 0 && (!bottleneck || counts[s.key] > bottleneck.count)) {
        bottleneck = { label: s.label, count: counts[s.key] };
      }
    }

    return { counts, total, maxStepCount, bottleneck };
  }, [states]);

  // 3. Horarios pico de mensajes entrantes (0h - 23h)
  const hourlyActivity = useMemo(() => {
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      label: `${String(h).padStart(2, '0')}h`,
      incoming: 0,
      outgoing: 0,
    }));

    for (const m of messages) {
      if (hideLegacy) {
        const conv = convIndex.get(m.conversation_id);
        if (conv && isLegacyConv(conv)) continue;
      }
      const d = new Date(m.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const h = d.getHours();
      if (m.from_me) hours[h].outgoing += 1;
      else hours[h].incoming += 1;
    }

    const maxIncoming = Math.max(1, ...hours.map(h => h.incoming));
    const totalIncoming = hours.reduce((acc, h) => acc + h.incoming, 0);
    const peak = hours.reduce(
      (best, cur) => (cur.incoming > best.incoming ? cur : best),
      hours[0]
    );

    const morning = hours.slice(6, 12).reduce((s, h) => s + h.incoming, 0);
    const afternoon = hours.slice(12, 18).reduce((s, h) => s + h.incoming, 0);
    const night =
      hours.slice(18, 24).reduce((s, h) => s + h.incoming, 0) +
      hours.slice(0, 6).reduce((s, h) => s + h.incoming, 0);

    let bestBand = 'Sin actividad';
    if (totalIncoming > 0) {
      if (afternoon >= morning && afternoon >= night) bestBand = 'Tarde (12:00–17:59)';
      else if (night >= morning && night >= afternoon) bestBand = 'Noche (18:00–05:59)';
      else bestBand = 'Mañana (06:00–11:59)';
    }

    return { hours, maxIncoming, totalIncoming, peak, bestBand };
  }, [messages, hideLegacy, convIndex]);

  // 4. Top Productos consultados en WhatsApp
  const topProducts = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; sku: string; chats: number; converted: number; revenue: number }
    >();

    for (const st of states) {
      const sku = (st.last_sku || '').trim();
      const name = (st.last_nombre || '').trim();
      if (!sku && !name) continue;
      const key = (sku || name).toUpperCase();
      const cur = map.get(key) || {
        key,
        name: name || sku,
        sku: sku || '—',
        chats: 0,
        converted: 0,
        revenue: 0,
      };
      cur.chats += 1;
      const p8 = cleanDigits8(st.telefono);
      if (p8) {
        const ord = ordersByPhone.get(p8);
        if (ord && ord.count > 0) {
          cur.converted += 1;
          cur.revenue += ord.total;
        }
      }
      map.set(key, cur);
    }

    const list = Array.from(map.values())
      .sort((a, b) => b.chats - a.chats)
      .slice(0, 6);
    const maxChats = Math.max(1, ...list.map(p => p.chats));
    return { list, maxChats };
  }, [states, ordersByPhone]);

  // 5. Atribución de Anuncios Meta Ads
  const adAttribution = useMemo(() => {
    const map = new Map<
      string,
      { tag: string; chats: number; orders: number; revenue: number }
    >();

    for (const st of states) {
      const det = String(st.last_detalle || '').trim();
      if (!det.startsWith('AD:')) continue;
      const tag = det.slice(3).trim();
      if (!tag) continue;
      const cur = map.get(tag) || { tag, chats: 0, orders: 0, revenue: 0 };
      cur.chats += 1;
      map.set(tag, cur);
    }

    for (const o of ordersInPeriod) {
      const tag = String(o.codigo_anuncio || '').trim();
      if (!tag) continue;
      const cur = map.get(tag) || { tag, chats: 0, orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += Number(o.total || 0);
      map.set(tag, cur);
    }

    const list = Array.from(map.values())
      .sort((a, b) => b.chats - a.chats || b.orders - a.orders)
      .slice(0, 6);
    const maxChats = Math.max(1, ...list.map(a => Math.max(a.chats, a.orders)));
    return { list, maxChats };
  }, [states, ordersInPeriod]);

  const activeHourInfo =
    hoveredHour !== null
      ? hourlyActivity.hours[hoveredHour]
      : hourlyActivity.totalIncoming > 0
      ? hourlyActivity.peak
      : null;

  const heroHeadline = useMemo(() => {
    if (kpis.totalChats === 0) return 'Sin conversaciones registradas en este período';
    const chatWord = kpis.totalChats === 1 ? 'conversación' : 'conversaciones';
    const orderWord = kpis.convertedOrdersCount === 1 ? 'pedido' : 'pedidos';
    return `${kpis.totalChats} ${chatWord}, ${kpis.convertedOrdersCount} ${orderWord} cerrados (${formatMoney(
      kpis.convertedRevenue
    )})`;
  }, [kpis.totalChats, kpis.convertedOrdersCount, kpis.convertedRevenue]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden" style={{ background: 'var(--bg)' }}>
      {/* Barra superior limpia */}
      <header className="px-3.5 py-2.5 sm:px-5 sm:py-3 border-b border-[var(--bd)] bg-cd flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center p-1 rounded-xl bg-sf bd shrink-0">
            <button
              type="button"
              onClick={() => onBackToChats()}
              className="px-3 py-1 rounded-lg text-xs font-medium tx-mu hover:text-[var(--tx)] flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
            >
              <MessageSquare size={13} />
              <span>Chats</span>
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded-lg text-xs font-semibold bg-cd bd flex items-center gap-1.5 whitespace-nowrap shadow-sm"
            >
              <BarChart3 size={13} style={{ color: 'var(--ac)' }} />
              <span>Estadísticas</span>
            </button>
          </div>
          <span className="hidden md:inline text-xs tx-mu truncate">
            Analítica de WhatsApp, Bot Todd y conversión COD
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center p-1 rounded-xl bg-sf bd text-xs">
            {(
              [
                { id: 'today', label: 'Hoy' },
                { id: '7d', label: '7 días' },
                { id: '30d', label: '30 días' },
                { id: 'all', label: 'Todo' },
              ] as { id: StatsPeriod; label: string }[]
            ).map(item => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPeriod(item.id)}
                className={`px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors cursor-pointer ${
                  period === item.id
                    ? 'bg-cd bd font-semibold text-[var(--tx)]'
                    : 'tx-mu hover:text-[var(--tx)] font-medium'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {legacyCount > 0 && (
            <button
              type="button"
              onClick={onToggleHideLegacy}
              title={hideLegacy ? 'Incluir chats antiguos de BuilderBot' : 'Ocultar chats antiguos de BuilderBot'}
              className={`px-2.5 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                hideLegacy
                  ? 'border-[var(--bd)] bg-sf tx-mu hover:text-[var(--tx)]'
                  : 'border-[var(--ac)] bg-cd text-[var(--tx)]'
              }`}
            >
              {hideLegacy ? <EyeOff size={13} /> : <Eye size={13} />}
              <span className="hidden sm:inline">{hideLegacy ? 'Sin legacy' : 'Con legacy'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Actualizar estadísticas"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-sf bd text-xs font-medium hover:opacity-85 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>
      </header>

      {/* Contenido scrollable */}
      <div className="flex-1 overflow-y-auto p-3.5 sm:p-5">
        <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-6">
          {statsError && (
            <div className="p-3.5 rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-xs font-semibold flex items-center justify-between gap-3">
              <span>{statsError}</span>
              <button
                type="button"
                onClick={() => loadStatsData(period, true)}
                className="px-3 py-1.5 rounded-xl bg-rose-600 text-white text-xs font-semibold shrink-0 cursor-pointer"
              >
                Reintentar
              </button>
            </div>
          )}

          {loadingStats ? (
            <div className="flex flex-col gap-4">
              <div className="bg-cd bd rounded-2xl p-5 space-y-2.5">
                <Skeleton h={14} />
                <Skeleton h={28} />
                <Skeleton h={14} />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="p-4 rounded-2xl bg-cd bd space-y-2">
                    <Skeleton h={14} />
                    <Skeleton h={30} />
                    <Skeleton h={12} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Skeleton h={280} />
                <Skeleton h={280} />
              </div>
            </div>
          ) : kpis.totalChats === 0 && kpis.totalMsgs === 0 && funnelData.total === 0 ? (
            <div className="p-8 rounded-2xl bg-cd bd text-center space-y-3 max-w-lg mx-auto my-8">
              <BarChart3 size={28} className="mx-auto tx-mu opacity-50" />
              <div className="space-y-1">
                <h3 className="text-sm font-bold">Sin actividad registrada en {PERIOD_LABELS[period].toLowerCase()}</h3>
                <p className="text-xs tx-mu">
                  No hay conversaciones ni mensajes dentro del rango seleccionado. Amplía el período o vuelve a la bandeja de chats.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2.5 pt-2">
                {period !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setPeriod('all')}
                    className="px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
                    style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                  >
                    Ver todo el historial
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onBackToChats()}
                  className="px-4 py-2 rounded-xl bg-sf bd text-xs font-medium cursor-pointer"
                >
                  Ir a Chats
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Hero Resumen Ejecutivo */}
              <section className="bg-cd bd rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs tx-mu tabular-nums">
                    <span>{PERIOD_LABELS[period]}</span>
                    <span aria-hidden="true">·</span>
                    <span>Automatización Todd {kpis.botRate}%</span>
                    <span aria-hidden="true">·</span>
                    <span>Cierre {kpis.conversionRate.toFixed(1)}%</span>
                  </div>
                  <h1
                    className="text-lg sm:text-xl font-bold mt-1.5 tracking-tight leading-snug"
                    style={{ textWrap: 'balance' }}
                  >
                    {heroHeadline}
                  </h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-xs tx-mu tabular-nums">
                    <span>{kpis.totalMsgs} mensajes totales</span>
                    <span aria-hidden="true">·</span>
                    <span>{kpis.incomingMsgs} de clientes</span>
                    <span aria-hidden="true">·</span>
                    <span>{kpis.outgoingMsgs} respuestas enviadas</span>
                  </div>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {kpis.unreadChats > 0 && (
                    <button
                      type="button"
                      onClick={() => onBackToChats('unread')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90 whitespace-nowrap shrink-0 cursor-pointer"
                      style={{ background: 'var(--tx)', color: 'var(--cd)' }}
                    >
                      <MessageSquare size={14} />
                      Atender pendientes ({kpis.unreadChats})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onBackToChats()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl bg-sf bd text-xs font-medium hover:opacity-85 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Volver a bandeja
                  </button>
                </div>
              </section>

              {/* Strip de 4 KPIs (estilo Hoy.tsx) */}
              <section className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                {/* KPI 1: Conversaciones */}
                <div className="bg-cd bd rounded-2xl p-4 flex flex-col justify-between gap-2.5">
                  <div className="flex items-center justify-between text-xs tx-mu">
                    <span>Conversaciones</span>
                    <Bot size={15} style={{ color: 'var(--ac)' }} />
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-bold mono tabular-nums">
                      {kpis.totalChats}
                    </div>
                    <div className="text-xs tx-mu mt-0.5 tabular-nums">
                      {kpis.botChats} Todd · {kpis.humanChats} humano ({kpis.botRate}% auto)
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-sf overflow-hidden flex">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${kpis.totalChats > 0 ? kpis.botRate : 0}%`,
                        background: 'var(--ac)',
                      }}
                    />
                  </div>
                </div>

                {/* KPI 2: Conversión Chat -> Pedido */}
                <div className="bg-cd bd rounded-2xl p-4 flex flex-col justify-between gap-2.5">
                  <div className="flex items-center justify-between text-xs tx-mu">
                    <span>Cierre Chat → Pedido</span>
                    <TrendingUp size={15} style={{ color: 'var(--ok)' }} />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span
                        className="text-xl sm:text-2xl font-bold mono tabular-nums"
                        style={{ color: 'var(--ok)' }}
                      >
                        {kpis.conversionRate.toFixed(1)}%
                      </span>
                      <span className="text-xs font-semibold mono tabular-nums tx-mu">
                        {formatMoney(kpis.convertedRevenue)}
                      </span>
                    </div>
                    <div className="text-xs tx-mu mt-0.5 tabular-nums">
                      {kpis.convertedChats} de {kpis.identifiableChats || kpis.totalChats} chats compraron
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-sf overflow-hidden">
                    <div
                      className="h-full transition-all"
                      style={{
                        width: `${Math.min(100, Math.round(kpis.conversionRate))}%`,
                        background: 'var(--ok)',
                      }}
                    />
                  </div>
                </div>

                {/* KPI 3: Sin responder ahora */}
                <div className="bg-cd bd rounded-2xl p-4 flex flex-col justify-between gap-2.5">
                  <div className="flex items-center justify-between text-xs tx-mu">
                    <span>Sin responder</span>
                    <Clock
                      size={15}
                      style={{ color: kpis.unreadChats > 0 ? 'var(--er)' : 'var(--mu)' }}
                    />
                  </div>
                  <div>
                    <div className="flex items-baseline gap-2">
                      <span
                        className="text-xl sm:text-2xl font-bold mono tabular-nums"
                        style={kpis.unreadChats > 0 ? { color: 'var(--er)' } : undefined}
                      >
                        {kpis.unreadChats}
                      </span>
                      {kpis.unreadChats > 0 && (
                        <span className="text-xs mono tabular-nums tx-mu">
                          prom. {formatWaitDuration(kpis.avgWaitMinutes)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs tx-mu mt-0.5">
                      {kpis.unreadChats === 0 ? 'Bandeja al día' : 'Clientes esperando respuesta'}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-xs pt-0.5">
                    <span className="tx-mu tabular-nums">
                      {kpis.unreadChats > 0 ? 'Prioridad alta' : '0 pendientes'}
                    </span>
                    {kpis.unreadChats > 0 && (
                      <button
                        type="button"
                        onClick={() => onBackToChats('unread')}
                        className="font-semibold hover:underline inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                        style={{ color: 'var(--ac)' }}
                      >
                        Atender <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                </div>

                {/* KPI 4: Mensajes procesados */}
                <div className="bg-cd bd rounded-2xl p-4 flex flex-col justify-between gap-2.5">
                  <div className="flex items-center justify-between text-xs tx-mu">
                    <span>Mensajes</span>
                    <ShoppingBag size={15} className="tx-mu" />
                  </div>
                  <div>
                    <div className="text-xl sm:text-2xl font-bold mono tabular-nums">
                      {kpis.totalMsgs}
                    </div>
                    <div className="text-xs tx-mu mt-0.5 tabular-nums">
                      {kpis.incomingMsgs} entrantes · {kpis.outgoingMsgs} salientes
                    </div>
                  </div>
                  <div className="text-xs tx-mu tabular-nums">
                    Promedio <span className="mono font-semibold text-[var(--tx)]">{kpis.avgMsgsPerChat.toFixed(1)}</span> msgs / chat
                  </div>
                </div>
              </section>

              {/* Cuerpo Analítico: Embudo Todd + Horarios Pico */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Embudo de Bot Todd */}
                <section className="bg-cd bd rounded-2xl p-5 flex flex-col justify-between gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Bot size={16} style={{ color: 'var(--ac)' }} />
                        <h2 className="text-sm font-semibold">Embudo de Bot Todd</h2>
                      </div>
                      <p className="text-xs tx-mu mt-0.5 tabular-nums">
                        Distribución de {funnelData.total} clientes según su paso actual
                      </p>
                    </div>
                    {funnelData.bottleneck && (
                      <span
                        className="text-xs font-medium whitespace-nowrap"
                        style={{ color: 'var(--ac)' }}
                      >
                        Mayor freno: {funnelData.bottleneck.label}
                      </span>
                    )}
                  </div>

                  {funnelData.total === 0 ? (
                    <div className="py-8 px-4 text-center bg-sf bd rounded-xl text-xs tx-mu">
                      No hay estados de conversación de Todd registrados en este período.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {FUNNEL_STEPS.map((step, idx) => {
                        const count = funnelData.counts[step.key] || 0;
                        const pct =
                          funnelData.total > 0 ? Math.round((count / funnelData.total) * 100) : 0;
                        const widthPct = Math.round((count / funnelData.maxStepCount) * 100);
                        const isDone = step.key === 'completado';
                        const isFirst = step.key === 'inicio';

                        return (
                          <div key={step.key} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <div className="min-w-0 truncate flex items-center gap-2">
                                <span className="mono text-[11px] tx-mu w-4 shrink-0">
                                  0{idx + 1}
                                </span>
                                <span className="font-semibold text-[var(--tx)]">{step.label}</span>
                                <span className="tx-mu hidden sm:inline truncate">
                                  · {step.hint}
                                </span>
                              </div>
                              <div className="mono tabular-nums shrink-0 text-right">
                                <span className="font-semibold text-[var(--tx)]">{count}</span>
                                <span className="tx-mu ml-1.5">({pct}%)</span>
                              </div>
                            </div>
                            <div className="h-2 w-full rounded-full bg-sf overflow-hidden">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${count > 0 ? Math.max(widthPct, 3) : 0}%`,
                                  background: isDone
                                    ? 'var(--ok)'
                                    : isFirst
                                    ? 'var(--mu)'
                                    : 'var(--ac)',
                                  opacity: isFirst ? 0.55 : isDone ? 1 : 0.85,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-3 border-t border-[var(--bd)] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="tx-mu">Filtrar bandeja por modo</span>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={() => onBackToChats('bot')}
                        className="font-medium hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <Bot size={13} style={{ color: 'var(--ac)' }} />
                        Todd ({kpis.botChats})
                      </button>
                      <button
                        type="button"
                        onClick={() => onBackToChats('human')}
                        className="font-medium hover:underline inline-flex items-center gap-1.5 cursor-pointer"
                      >
                        <User size={13} className="tx-mu" />
                        Humano ({kpis.humanChats})
                      </button>
                    </div>
                  </div>
                </section>

                {/* Horarios Pico de Mensajes Entrantes */}
                <section className="bg-cd bd rounded-2xl p-5 flex flex-col justify-between gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Clock size={16} style={{ color: 'var(--ac)' }} />
                        <h2 className="text-sm font-semibold">Horarios pico de clientes</h2>
                      </div>
                      <p className="text-xs tx-mu mt-0.5 tabular-nums">
                        {hourlyActivity.totalIncoming} mensajes entrantes por hora del día
                      </p>
                    </div>
                    {activeHourInfo && hourlyActivity.totalIncoming > 0 && (
                      <div className="text-right shrink-0">
                        <div className="text-xs font-semibold mono tabular-nums text-[var(--tx)]">
                          {String(activeHourInfo.hour).padStart(2, '0')}:00–
                          {String(activeHourInfo.hour).padStart(2, '0')}:59
                        </div>
                        <div className="text-[11px] mono tabular-nums tx-mu">
                          {activeHourInfo.incoming} entr. · {activeHourInfo.outgoing} sal.
                        </div>
                      </div>
                    )}
                  </div>

                  {hourlyActivity.totalIncoming === 0 ? (
                    <div className="py-10 px-4 text-center bg-sf bd rounded-xl text-xs tx-mu">
                      Aún no hay suficientes mensajes entrantes en este período para calcular horarios pico.
                    </div>
                  ) : (
                    <div>
                      <div className="relative h-44 flex">
                        {/* Eje Y simple */}
                        <div className="w-7 pr-1.5 flex flex-col justify-between text-[10px] mono tabular-nums tx-mu pb-5 text-right shrink-0">
                          <span>{hourlyActivity.maxIncoming}</span>
                          <span>{Math.round(hourlyActivity.maxIncoming / 2)}</span>
                          <span>0</span>
                        </div>

                        <div className="flex-1 flex flex-col min-w-0">
                          {/* Área de barras con líneas guía */}
                          <div className="relative flex-1 flex items-end gap-1 border-b border-[var(--bd)] pb-0.5">
                            <div
                              className="absolute inset-x-0 top-0 border-t border-dashed opacity-40 pointer-events-none"
                              style={{ borderColor: 'var(--bd)' }}
                            />
                            <div
                              className="absolute inset-x-0 top-1/2 border-t border-dashed opacity-40 pointer-events-none"
                              style={{ borderColor: 'var(--bd)' }}
                            />

                            {hourlyActivity.hours.map(h => {
                              const heightPct = Math.round(
                                (h.incoming / hourlyActivity.maxIncoming) * 100
                              );
                              const isPeak =
                                h.hour === hourlyActivity.peak.hour && h.incoming > 0;
                              const isHovered = hoveredHour === h.hour;

                              return (
                                <button
                                  key={h.hour}
                                  type="button"
                                  onMouseEnter={() => setHoveredHour(h.hour)}
                                  onMouseLeave={() => setHoveredHour(null)}
                                  onFocus={() => setHoveredHour(h.hour)}
                                  onClick={() =>
                                    setHoveredHour(prev => (prev === h.hour ? null : h.hour))
                                  }
                                  aria-label={`${h.label}: ${h.incoming} mensajes entrantes`}
                                  className="flex-1 h-full flex flex-col justify-end items-center cursor-pointer group focus:outline-none"
                                >
                                  <div
                                    className="w-full rounded-t transition-opacity"
                                    style={{
                                      height: `${h.incoming > 0 ? Math.max(heightPct, 7) : 3}%`,
                                      background: isPeak
                                        ? 'var(--ok)'
                                        : isHovered
                                        ? 'var(--tx)'
                                        : h.incoming > 0
                                        ? 'var(--ac)'
                                        : 'var(--sf)',
                                      opacity:
                                        h.incoming === 0
                                          ? 0.9
                                          : hoveredHour !== null && !isHovered
                                          ? 0.45
                                          : 1,
                                    }}
                                  />
                                </button>
                              );
                            })}
                          </div>

                          {/* Etiquetas cada 3h */}
                          <div className="h-5 flex items-center justify-between text-[10px] mono tabular-nums tx-mu pt-1">
                            <span>00h</span>
                            <span>03h</span>
                            <span>06h</span>
                            <span>09h</span>
                            <span>12h</span>
                            <span>15h</span>
                            <span>18h</span>
                            <span>21h</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t border-[var(--bd)] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="tx-mu">Franja con mayor demanda</span>
                    <div className="flex items-center gap-3 tabular-nums">
                      {hourlyActivity.totalIncoming > 0 && (
                        <span className="tx-mu">
                          Hora pico:{' '}
                          <strong className="mono text-[var(--tx)]">
                            {hourlyActivity.peak.label} ({hourlyActivity.peak.incoming})
                          </strong>
                        </span>
                      )}
                      <span className="font-semibold text-[var(--tx)]">{hourlyActivity.bestBand}</span>
                    </div>
                  </div>
                </section>
              </div>

              {/* Productos Consultados & Anuncios Meta Ads */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Top Productos */}
                <section className="bg-cd bd rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <Package size={16} style={{ color: 'var(--ac)' }} />
                        <h2 className="text-sm font-semibold">Productos más consultados</h2>
                      </div>
                      <p className="text-xs tx-mu mt-0.5">
                        Interés detectado en WhatsApp y su conversión real a pedidos
                      </p>
                    </div>
                  </div>

                  {topProducts.list.length === 0 ? (
                    <div className="py-8 px-4 text-center bg-sf bd rounded-xl text-xs tx-mu">
                      Todavía no hay consultas de productos registradas en este período.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--bd)]">
                      {topProducts.list.map((prod, idx) => {
                        const convRate =
                          prod.chats > 0 ? Math.round((prod.converted / prod.chats) * 100) : 0;
                        const barWidth = Math.round((prod.chats / topProducts.maxChats) * 100);

                        return (
                          <div key={prod.key} className="py-3 first:pt-1 last:pb-1 space-y-1.5">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <div className="min-w-0 flex items-center gap-2.5">
                                <span className="mono text-[11px] tx-mu w-4 shrink-0">
                                  0{idx + 1}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-semibold truncate text-[var(--tx)]">
                                    {prod.name}
                                  </div>
                                  <div className="text-[11px] mono tx-mu truncate">{prod.sku}</div>
                                </div>
                              </div>

                              <div className="text-right mono tabular-nums shrink-0">
                                <div className="font-semibold text-[var(--tx)]">
                                  {prod.chats} {prod.chats === 1 ? 'chat' : 'chats'}
                                </div>
                                <div className="text-[11px]">
                                  {prod.converted > 0 ? (
                                    <span style={{ color: 'var(--ok)' }}>
                                      {prod.converted} ped. ({convRate}%) ·{' '}
                                      {formatMoney(prod.revenue)}
                                    </span>
                                  ) : (
                                    <span className="tx-mu">0 cierres aún</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="h-1 w-full rounded-full bg-sf overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.max(barWidth, 5)}%`,
                                  background: prod.converted > 0 ? 'var(--ok)' : 'var(--ac)',
                                  opacity: 0.75,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Anuncios Meta Ads */}
                <section className="bg-cd bd rounded-2xl p-5 space-y-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Megaphone size={16} style={{ color: 'var(--ac)' }} />
                      <h2 className="text-sm font-semibold">Origen de anuncios (Meta Ads)</h2>
                    </div>
                    <p className="text-xs tx-mu mt-0.5">
                      Chats entrantes con etiqueta Click-to-WhatsApp y ventas atribuidas
                    </p>
                  </div>

                  {adAttribution.list.length === 0 ? (
                    <div className="py-8 px-4 text-center bg-sf bd rounded-xl text-xs tx-mu">
                      Cuando entren clientes desde campañas Click-to-WhatsApp con etiqueta AD, verás aquí qué anuncio trae más chats y ventas.
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--bd)]">
                      {adAttribution.list.map((ad, idx) => {
                        const rate = ad.chats > 0 ? Math.round((ad.orders / ad.chats) * 100) : 0;
                        const volume = Math.max(ad.chats, ad.orders);
                        const barWidth = Math.round((volume / adAttribution.maxChats) * 100);

                        return (
                          <div key={ad.tag} className="py-3 first:pt-1 last:pb-1 space-y-1.5">
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <div className="min-w-0 flex items-center gap-2.5">
                                <span className="mono text-[11px] tx-mu w-4 shrink-0">
                                  0{idx + 1}
                                </span>
                                <span className="font-semibold truncate text-[var(--tx)]">
                                  {ad.tag}
                                </span>
                              </div>
                              <div className="text-right mono tabular-nums shrink-0">
                                <div className="font-semibold text-[var(--tx)]">
                                  {ad.chats} chats · {ad.orders} ped.
                                </div>
                                <div className="text-[11px]">
                                  {ad.orders > 0 ? (
                                    <span style={{ color: 'var(--ok)' }}>
                                      {rate}% cierre · {formatMoney(ad.revenue)}
                                    </span>
                                  ) : (
                                    <span className="tx-mu">Sin pedidos cerrados</span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="h-1 w-full rounded-full bg-sf overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.max(barWidth, 5)}%`,
                                  background: ad.orders > 0 ? 'var(--ok)' : 'var(--ac)',
                                  opacity: 0.75,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
