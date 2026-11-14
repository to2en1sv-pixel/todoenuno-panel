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
  { key: 'cotizando', label: 'Cotizando', hint: 'Consultando precio / variantes' },
  { key: 'esperando_nombre', label: 'Esperando nombre', hint: 'En cierre de datos' },
  { key: 'esperando_direccion', label: 'Esperando dirección', hint: 'Pidiendo ubicación' },
  { key: 'esperando_pago', label: 'Confirmando pago', hint: 'Contra entrega / transf.' },
  { key: 'completado', label: 'Completado', hint: 'Pedido cerrado por Todd' },
];

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

  const activeConvIdSet = useMemo(
    () => new Set(baseConversations.map(c => c.id)),
    [baseConversations]
  );

  // Pedidos dentro del rango (o 24h después del inicio del chat para cubrir cierres)
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

    // Mensajes en periodo (filtrando legacy si hideLegacy está activo)
    let incomingMsgs = 0;
    let outgoingMsgs = 0;
    for (const m of messages) {
      if (hideLegacy && conversations.length > 0) {
        // Si conocemos las conversaciones y no pertenece a ninguna activa cuando hideLegacy=true
        const conv = conversations.find(c => c.id === m.conversation_id);
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
  }, [baseConversations, lastMsgFromMeMap, ordersByPhone, messages, hideLegacy, conversations]);

  // 2. Embudo de Bot Todd (whatsapp_state)
  const funnelData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of FUNNEL_STEPS) counts[s.key] = 0;
    let otherCount = 0;

    for (const st of states) {
      const rawStep = String(st.paso_actual || 'inicio').toLowerCase().trim();
      if (rawStep in counts) counts[rawStep] += 1;
      else otherCount += 1;
    }

    const total = states.length;
    const maxStepCount = Math.max(1, ...FUNNEL_STEPS.map(s => counts[s.key]));

    // Detectar mayor punto de freno antes de 'completado'
    const activeSteps = FUNNEL_STEPS.filter(s => s.key !== 'completado' && s.key !== 'inicio');
    let bottleneck: { label: string; count: number } | null = null;
    for (const s of activeSteps) {
      if (counts[s.key] > 0 && (!bottleneck || counts[s.key] > bottleneck.count)) {
        bottleneck = { label: s.label, count: counts[s.key] };
      }
    }

    return { counts, total, maxStepCount, otherCount, bottleneck };
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
      if (hideLegacy && !activeConvIdSet.has(m.conversation_id)) {
        const conv = conversations.find(c => c.id === m.conversation_id);
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
    const night = hours.slice(18, 24).reduce((s, h) => s + h.incoming, 0) + hours.slice(0, 6).reduce((s, h) => s + h.incoming, 0);

    let bestBand = 'Sin actividad';
    if (totalIncoming > 0) {
      if (afternoon >= morning && afternoon >= night) bestBand = 'Tarde (12:00–17:59)';
      else if (night >= morning && night >= afternoon) bestBand = 'Noche (18:00–05:59)';
      else bestBand = 'Mañana (06:00–11:59)';
    }

    return { hours, maxIncoming, totalIncoming, peak, bestBand };
  }, [messages, hideLegacy, activeConvIdSet, conversations]);

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

    return Array.from(map.values())
      .sort((a, b) => b.chats - a.chats)
      .slice(0, 6);
  }, [states, ordersByPhone]);

  // 5. Atribución de Anuncios Meta Ads (AD:... en whatsapp_state + codigo_anuncio en whatsapp_orders)
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

    return Array.from(map.values())
      .sort((a, b) => b.chats - a.chats || b.orders - a.orders)
      .slice(0, 6);
  }, [states, ordersInPeriod]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-cd overflow-hidden">
      {/* Barra superior de la subvista Estadísticas */}
      <div className="px-3.5 py-2.5 sm:px-5 sm:py-3 border-b border-[var(--bd)] bg-sf flex flex-wrap items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center p-0.5 rounded-xl bg-cd border border-[var(--bd)] shrink-0">
            <button
              type="button"
              onClick={() => onBackToChats()}
              className="px-2.5 py-1 rounded-lg text-xs font-bold tx-mu hover:text-[var(--tx)] flex items-center gap-1.5 whitespace-nowrap transition-colors"
            >
              <MessageSquare size={13} />
              <span>Chats</span>
            </button>
            <button
              type="button"
              className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[var(--tx)] text-[var(--cd)] flex items-center gap-1.5 whitespace-nowrap shadow-sm"
            >
              <BarChart3 size={13} />
              <span>Estadísticas</span>
            </button>
          </div>
          <div className="hidden md:block min-w-0">
            <h2 className="text-sm font-bold tracking-tight truncate">
              Rendimiento de Conversaciones & Bot Todd
            </h2>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Selector de período */}
          <div className="flex items-center gap-0.5 p-0.5 rounded-xl bg-cd border border-[var(--bd)] text-[11px] font-bold">
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
                className={`px-2.5 py-1 rounded-lg whitespace-nowrap transition-colors ${
                  period === item.id
                    ? 'bg-[var(--tx)] text-[var(--cd)]'
                    : 'tx-mu hover:text-[var(--tx)]'
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
              className={`px-2.5 py-1.5 rounded-xl border text-[11px] font-bold flex items-center gap-1 whitespace-nowrap transition-colors ${
                hideLegacy
                  ? 'border-[var(--bd)] bg-cd tx-mu hover:text-[var(--tx)]'
                  : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-500'
              }`}
            >
              {hideLegacy ? <EyeOff size={12} /> : <Eye size={12} />}
              <span className="hidden sm:inline">{hideLegacy ? 'Sin legacy' : 'Con legacy'}</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={refreshing}
            title="Actualizar estadísticas"
            className="p-1.5 rounded-xl border border-[var(--bd)] bg-cd hover:bg-sf tx-mu hover:text-[var(--tx)] transition-colors"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Contenido scrollable */}
      <div className="flex-1 overflow-y-auto p-3.5 sm:p-5 space-y-4">
        {statsError && (
          <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-xs font-semibold flex items-center justify-between gap-2">
            <span>{statsError}</span>
            <button
              type="button"
              onClick={() => loadStatsData(period, true)}
              className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold shrink-0"
            >
              Reintentar
            </button>
          </div>
        )}

        {loadingStats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="p-4 rounded-xl bg-sf border border-[var(--bd)] space-y-2">
                  <Skeleton h={14} />
                  <Skeleton h={28} />
                  <Skeleton h={12} />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Skeleton h={256} />
              <Skeleton h={256} />
            </div>
          </div>
        ) : kpis.totalChats === 0 && kpis.totalMsgs === 0 && funnelData.total === 0 ? (
          <div className="p-8 rounded-xl bg-sf border border-[var(--bd)] text-center space-y-3 max-w-lg mx-auto my-8">
            <BarChart3 size={28} className="mx-auto opacity-40" />
            <div className="space-y-1">
              <h3 className="text-sm font-bold">Sin actividad registrada en este período</h3>
              <p className="text-xs tx-mu">
                No hay conversaciones ni mensajes dentro del rango seleccionado. Puedes ampliar el período o volver a la bandeja de chats.
              </p>
            </div>
            <div className="flex items-center justify-center gap-2 pt-1">
              {period !== 'all' && (
                <button
                  type="button"
                  onClick={() => setPeriod('all')}
                  className="px-3.5 py-1.5 rounded-xl bg-[var(--tx)] text-[var(--cd)] text-xs font-bold"
                >
                  Ver todo el historial
                </button>
              )}
              <button
                type="button"
                onClick={() => onBackToChats()}
                className="px-3.5 py-1.5 rounded-xl border border-[var(--bd)] bg-cd text-xs font-bold"
              >
                Ir a Chats
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* 1. Fila de 4 KPIs Principales */}
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
              {/* Conversaciones Activas */}
              <div className="p-3.5 rounded-xl bg-sf border border-[var(--bd)] flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tx-mu">Conversaciones activas</span>
                  <Bot size={15} className="text-purple-500 shrink-0" />
                </div>
                <div className="text-2xl font-black font-mono tabular-nums">
                  {kpis.totalChats}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] tx-mu">
                  <span className="tabular-nums">
                    <strong className="text-purple-500">{kpis.botChats}</strong> Todd ·{' '}
                    <strong className="text-amber-500">{kpis.humanChats}</strong> Humano
                  </span>
                  <span className="font-mono tabular-nums">{kpis.botRate}% bot</span>
                </div>
              </div>

              {/* Conversión Chat -> Pedido */}
              <div className="p-3.5 rounded-xl bg-sf border border-[var(--bd)] flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tx-mu">Cierre Chat → Pedido</span>
                  <ShoppingBag size={15} className="text-emerald-500 shrink-0" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-black font-mono tabular-nums text-emerald-500">
                    {kpis.conversionRate.toFixed(1)}%
                  </span>
                  <span className="text-xs font-mono tabular-nums tx-mu">
                    {formatMoney(kpis.convertedRevenue)}
                  </span>
                </div>
                <div className="text-[11px] tx-mu tabular-nums">
                  {kpis.convertedChats} de {kpis.identifiableChats || kpis.totalChats} chats cerraron{' '}
                  {kpis.convertedOrdersCount} pedido(s)
                </div>
              </div>

              {/* Pendientes por responder */}
              <div className="p-3.5 rounded-xl bg-sf border border-[var(--bd)] flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tx-mu">Sin responder ahora</span>
                  <Clock
                    size={15}
                    className={kpis.unreadChats > 0 ? 'text-rose-500 shrink-0' : 'tx-mu shrink-0'}
                  />
                </div>
                <div className="flex items-baseline gap-2">
                  <span
                    className={`text-2xl font-black font-mono tabular-nums ${
                      kpis.unreadChats > 0 ? 'text-rose-500' : ''
                    }`}
                  >
                    {kpis.unreadChats}
                  </span>
                  {kpis.unreadChats > 0 && (
                    <span className="text-[11px] font-mono tabular-nums tx-mu">
                      prom. {formatWaitDuration(kpis.avgWaitMinutes)}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="tx-mu">
                    {kpis.unreadChats === 0 ? 'Bandeja al día' : 'Esperando respuesta'}
                  </span>
                  {kpis.unreadChats > 0 && (
                    <button
                      type="button"
                      onClick={() => onBackToChats('unread')}
                      className="font-bold text-[var(--ac)] hover:underline inline-flex items-center gap-0.5 whitespace-nowrap"
                    >
                      Atender <ArrowRight size={11} />
                    </button>
                  )}
                </div>
              </div>

              {/* Volumen de mensajes */}
              <div className="p-3.5 rounded-xl bg-sf border border-[var(--bd)] flex flex-col justify-between gap-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tx-mu">Mensajes procesados</span>
                  <MessageSquare size={15} className="text-indigo-500 shrink-0" />
                </div>
                <div className="text-2xl font-black font-mono tabular-nums">
                  {kpis.totalMsgs}
                </div>
                <div className="flex items-center justify-between gap-2 text-[11px] tx-mu tabular-nums">
                  <span>
                    {kpis.incomingMsgs} entrantes · {kpis.outgoingMsgs} salientes
                  </span>
                  <span className="font-mono">{kpis.avgMsgsPerChat.toFixed(1)}/chat</span>
                </div>
              </div>
            </div>

            {/* 2. Embudo de Bot Todd + Horarios Pico */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Embudo de Bot Todd */}
              <div className="p-4 rounded-xl bg-sf border border-[var(--bd)] space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold flex items-center gap-1.5">
                      <Bot size={15} className="text-purple-500" />
                      Embudo de Bot Todd
                    </h3>
                    <p className="text-[11px] tx-mu">
                      En qué paso de compra se encuentran {funnelData.total} clientes registrados
                    </p>
                  </div>
                  {funnelData.bottleneck && (
                    <span className="text-[11px] font-semibold text-amber-500 whitespace-nowrap">
                      Freno: {funnelData.bottleneck.label}
                    </span>
                  )}
                </div>

                {funnelData.total === 0 ? (
                  <p className="text-xs tx-mu py-6 text-center">
                    No hay registros de flujo de Todd en este período.
                  </p>
                ) : (
                  <div className="space-y-2.5 pt-1">
                    {FUNNEL_STEPS.map(step => {
                      const count = funnelData.counts[step.key] || 0;
                      const pct = funnelData.total > 0 ? Math.round((count / funnelData.total) * 100) : 0;
                      const widthPct = Math.round((count / funnelData.maxStepCount) * 100);
                      const isDone = step.key === 'completado';

                      return (
                        <div key={step.key} className="space-y-1">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="min-w-0 truncate">
                              <span className="font-semibold text-[var(--tx)]">{step.label}</span>
                              <span className="text-[10px] tx-mu ml-1.5 hidden sm:inline">
                                · {step.hint}
                              </span>
                            </div>
                            <span className="font-mono tabular-nums text-[11px] shrink-0">
                              <strong>{count}</strong>{' '}
                              <span className="tx-mu">({pct}%)</span>
                            </span>
                          </div>
                          <div className="h-2 w-full rounded-full bg-cd overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                isDone ? 'bg-emerald-500' : 'bg-purple-500'
                              }`}
                              style={{ width: `${count > 0 ? Math.max(widthPct, 4) : 0}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="pt-2 border-t border-[var(--bd)] flex items-center justify-between text-[11px] tx-mu">
                  <span>Distribución actual en bandeja</span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onBackToChats('bot')}
                      className="hover:text-[var(--tx)] font-semibold inline-flex items-center gap-1"
                    >
                      <Bot size={11} className="text-purple-500" /> Ver {kpis.botChats} en Todd
                    </button>
                    <button
                      type="button"
                      onClick={() => onBackToChats('human')}
                      className="hover:text-[var(--tx)] font-semibold inline-flex items-center gap-1"
                    >
                      <User size={11} className="text-amber-500" /> Ver {kpis.humanChats} en Humano
                    </button>
                  </div>
                </div>
              </div>

              {/* Horarios Pico de Mensajes Entrantes */}
              <div className="p-4 rounded-xl bg-sf border border-[var(--bd)] flex flex-col justify-between gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold flex items-center gap-1.5">
                      <Clock size={15} className="text-indigo-500" />
                      Horarios pico de clientes
                    </h3>
                    <p className="text-[11px] tx-mu">
                      Mensajes entrantes por hora ({hourlyActivity.totalIncoming} recibidos)
                    </p>
                  </div>
                  {hourlyActivity.totalIncoming > 0 && (
                    <span className="text-[11px] font-mono font-bold text-indigo-500 whitespace-nowrap">
                      Pico {hourlyActivity.peak.label} ({hourlyActivity.peak.incoming})
                    </span>
                  )}
                </div>

                {hourlyActivity.totalIncoming === 0 ? (
                  <p className="text-xs tx-mu py-10 text-center">
                    Aún no hay suficientes mensajes entrantes en este rango para calcular horarios pico.
                  </p>
                ) : (
                  <>
                    <div className="pt-3 pb-1">
                      <div className="h-36 flex items-end gap-1">
                        {hourlyActivity.hours.map(h => {
                          const heightPct = Math.round(
                            (h.incoming / hourlyActivity.maxIncoming) * 100
                          );
                          const isPeak = h.hour === hourlyActivity.peak.hour && h.incoming > 0;
                          return (
                            <div
                              key={h.hour}
                              title={`${String(h.hour).padStart(2, '0')}:00–${String(h.hour).padStart(
                                2,
                                '0'
                              )}:59 · ${h.incoming} entrantes / ${h.outgoing} salientes`}
                              className="flex-1 h-full flex flex-col justify-end items-center group"
                            >
                              <div
                                className={`w-full rounded-t transition-colors ${
                                  isPeak
                                    ? 'bg-emerald-500'
                                    : h.incoming > 0
                                    ? 'bg-indigo-500/75 group-hover:bg-indigo-500'
                                    : 'bg-cd'
                                }`}
                                style={{
                                  height: `${h.incoming > 0 ? Math.max(heightPct, 8) : 4}%`,
                                }}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[10px] font-mono tx-mu mt-1.5">
                        <span>00h</span>
                        <span>06h</span>
                        <span>12h</span>
                        <span>18h</span>
                        <span>23h</span>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[var(--bd)] flex items-center justify-between text-[11px] tx-mu">
                      <span>Franja con mayor demanda</span>
                      <span className="font-bold text-[var(--tx)]">{hourlyActivity.bestBand}</span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 3. Top Productos Consultados & Atribución Meta Ads */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Top Productos */}
              <div className="p-4 rounded-xl bg-sf border border-[var(--bd)] space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold flex items-center gap-1.5">
                      <Package size={15} className="text-amber-500" />
                      Productos más consultados
                    </h3>
                    <p className="text-[11px] tx-mu">
                      Detectados por Todd o enviados desde el catálogo
                    </p>
                  </div>
                </div>

                {topProducts.length === 0 ? (
                  <p className="text-xs tx-mu py-6 text-center">
                    Todavía no hay consultas de productos registradas en este período.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--bd)]">
                    {topProducts.map(prod => {
                      const convRate = prod.chats > 0 ? Math.round((prod.converted / prod.chats) * 100) : 0;
                      return (
                        <div
                          key={prod.key}
                          className="py-2 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold truncate text-[var(--tx)]">{prod.name}</div>
                            <div className="text-[10px] font-mono tx-mu truncate">{prod.sku}</div>
                          </div>
                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div className="font-bold text-[var(--tx)]">
                              {prod.chats} {prod.chats === 1 ? 'chat' : 'chats'}
                            </div>
                            <div className="text-[10px] tx-mu">
                              {prod.converted > 0 ? (
                                <span className="text-emerald-500 font-semibold">
                                  {prod.converted} ped. ({convRate}%) · {formatMoney(prod.revenue)}
                                </span>
                              ) : (
                                '0 cierres aún'
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Anuncios Meta Ads */}
              <div className="p-4 rounded-xl bg-sf border border-[var(--bd)] space-y-3">
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-1.5">
                    <Megaphone size={15} className="text-indigo-500" />
                    Origen de anuncios (Meta Ads)
                  </h3>
                  <p className="text-[11px] tx-mu">
                    Chats entrantes con etiqueta Click-to-WhatsApp y pedidos atribuidos
                  </p>
                </div>

                {adAttribution.length === 0 ? (
                  <p className="text-xs tx-mu py-6 text-center">
                    Cuando entren clientes desde campañas Click-to-WhatsApp con etiqueta AD, verás aquí qué anuncio trae más chats y ventas.
                  </p>
                ) : (
                  <div className="divide-y divide-[var(--bd)]">
                    {adAttribution.map(ad => {
                      const rate = ad.chats > 0 ? Math.round((ad.orders / ad.chats) * 100) : 0;
                      return (
                        <div
                          key={ad.tag}
                          className="py-2 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 font-semibold truncate text-[var(--tx)]">
                            {ad.tag}
                          </div>
                          <div className="text-right font-mono tabular-nums shrink-0">
                            <div className="font-bold">
                              {ad.chats} chats · {ad.orders} ped.
                            </div>
                            <div className="text-[10px] tx-mu">
                              {ad.orders > 0 ? (
                                <span className="text-emerald-500 font-semibold">
                                  {rate}% cierre · {formatMoney(ad.revenue)}
                                </span>
                              ) : (
                                'Sin pedidos cerrados'
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
