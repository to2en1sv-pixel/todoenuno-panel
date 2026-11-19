import { createClient } from '@supabase/supabase-js';

type BriefType = 'morning' | 'evening' | 'full';

async function fetchWithTimeoutLocal(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function emitBestEffortOsEvent(
  supabase: any,
  type: string,
  sourceTable: string,
  sourceId: string,
  payload: Record<string, any>,
  idempotencyKey?: string
) {
  const key = idempotencyKey || `${sourceTable}:${sourceId}:${type}:${Date.now()}`;
  try {
    const rpc = await supabase.rpc('emit_os_event', {
      p_type: type,
      p_source_table: sourceTable,
      p_source_id: sourceId,
      p_idempotency_key: key,
      p_payload: payload,
    });
    if (!rpc.error) return;
  } catch {}
  try {
    const res = await supabase.schema('os').from('events').insert({
      type,
      source_table: sourceTable,
      source_id: sourceId,
      idempotency_key: key,
      payload,
    });
    if (!res.error) return;
  } catch {}
  try {
    await supabase.from('os_events').insert({
      type,
      source_table: sourceTable,
      source_id: sourceId,
      idempotency_key: key,
      payload,
    });
  } catch {}
}

interface OsMemorySnapshot {
  daysLoaded: number;
  eventsLoaded: number;
  svTodayIso: string;
  d7StartIso: string;
  d14StartIso: string;
  d14EndIso: string;
  orders7d: number;
  ordersPrev7d: number;
  delivered7d: number;
  deliveredPrev7d: number;
  inProgress7d: number;
  inProgressPrev7d: number;
  cancelled7d: number;
  cancelledPrev7d: number;
  grossSales7d: number;
  grossSalesPrev7d: number;
  revenue7d: number;
  revenuePrev7d: number;
  adSpend7d: number;
  adSpendPrev7d: number;
  chatsIn7d: number;
  chatsOut7d: number;
  closeRate7d: number | null;
  cancelRate7d: number | null;
  cancelRatePrev7d: number | null;
  roas7d: number | null;
  roasPrev7d: number | null;
  roasGross7d: number | null;
  roasGrossPrev7d: number | null;
  topInquiredNoClose: Array<{ sku: string; inquiries: number; orders: number }>;
  topCancelReasons: Array<{ reason: string; count: number }>;
  recentChanges: string[];
  dailyLines: string[];
  recentEventLines: string[];
  deterministicInsight: string;
}

async function loadOsMemorySnapshotServer(
  supabase: any,
  svTodayIso: string,
  daysWindow = 30
): Promise<OsMemorySnapshot> {
  try {
    await supabase.rpc('rebuild_os_memory', { p_days: Math.min(Math.max(daysWindow, 14), 30) });
  } catch {}

  let memoryRows: any[] = [];
  try {
    const memPub = await supabase
      .from('os_daily_memory')
      .select('*')
      .order('day', { ascending: false })
      .limit(daysWindow);
    if (!memPub.error && Array.isArray(memPub.data)) {
      memoryRows = memPub.data;
    } else {
      const memSch = await supabase
        .schema('os')
        .from('daily_memory')
        .select('*')
        .order('day', { ascending: false })
        .limit(daysWindow);
      if (!memSch.error && Array.isArray(memSch.data)) {
        memoryRows = memSch.data;
      }
    }
  } catch {}

  let recentEvents: any[] = [];
  try {
    const evPub = await supabase
      .from('os_events')
      .select('id,type,occurred_at,source_table,source_id,payload')
      .order('id', { ascending: false })
      .limit(350);
    if (!evPub.error && Array.isArray(evPub.data)) {
      recentEvents = evPub.data;
    } else {
      const evSch = await supabase
        .schema('os')
        .from('events')
        .select('id,type,occurred_at,source_table,source_id,payload')
        .order('id', { ascending: false })
        .limit(350);
      if (!evSch.error && Array.isArray(evSch.data)) {
        recentEvents = evSch.data;
      }
    }
  } catch {}

  const todayDate = new Date(`${svTodayIso}T12:00:00Z`);
  const d7Cutoff = new Date(todayDate.getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const d14End = new Date(todayDate.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const d14Cutoff = new Date(todayDate.getTime() - 13 * 86400000).toISOString().slice(0, 10);
  const d14StartUtc = `${d14Cutoff}T06:00:00.000Z`;

  // Consultar fuentes reales deduplicadas (whatsapp_orders + gastos_publicidad) para que 7d vs 7d ant. cuadre 1:1 con Rentabilidad/Pedidos
  const [realOrders14Res, realAds14Res] = await Promise.all([
    supabase
      .from('whatsapp_orders')
      .select('id,estado,total,created_at')
      .gte('created_at', d14StartUtc)
      .order('created_at', { ascending: false })
      .limit(2500),
    supabase
      .from('gastos_publicidad')
      .select('fecha,monto')
      .gte('fecha', d14Cutoff)
      .lte('fecha', svTodayIso)
      .limit(2500),
  ]);

  let orders7d = 0;
  let ordersPrev7d = 0;
  let delivered7d = 0;
  let deliveredPrev7d = 0;
  let inProgress7d = 0;
  let inProgressPrev7d = 0;
  let cancelled7d = 0;
  let cancelledPrev7d = 0;
  let grossSales7d = 0;
  let grossSalesPrev7d = 0;
  let revenue7d = 0;
  let revenuePrev7d = 0;
  let adSpend7d = 0;
  let adSpendPrev7d = 0;
  let chatsIn7d = 0;
  let chatsOut7d = 0;

  if (memoryRows.length > 0) {
    for (const m of memoryRows) {
      const d = String(m.day || '').slice(0, 10);
      if (d >= d7Cutoff) {
        orders7d += Number(m.orders_created || 0);
        delivered7d += Number(m.orders_delivered || 0);
        cancelled7d += Number(m.orders_cancelled || 0);
        revenue7d += Number(m.delivered_revenue || 0);
        adSpend7d += Number(m.ad_spend || 0);
        chatsIn7d += Number(m.chats_received || 0);
        chatsOut7d += Number(m.chats_sent || 0);
      } else if (d >= d14Cutoff) {
        ordersPrev7d += Number(m.orders_created || 0);
        deliveredPrev7d += Number(m.orders_delivered || 0);
        cancelledPrev7d += Number(m.orders_cancelled || 0);
        revenuePrev7d += Number(m.delivered_revenue || 0);
        adSpendPrev7d += Number(m.ad_spend || 0);
      }
    }
  } else {
    for (const ev of recentEvents) {
      const svDay = new Date(new Date(ev.occurred_at).getTime() - 6 * 3600000).toISOString().slice(0, 10);
      const p = ev.payload || {};
      if (svDay >= d7Cutoff) {
        if (ev.type === 'order.created') orders7d += 1;
        if (ev.type === 'order.delivered') {
          delivered7d += 1;
          revenue7d += Number(p.total || 0);
        }
        if (ev.type === 'order.cancelled') cancelled7d += 1;
        if (ev.type === 'marketing.ad.expense') adSpend7d += Number(p.amount ?? p.monto ?? 0);
        if (ev.type === 'chat.message.received') chatsIn7d += 1;
        if (ev.type === 'chat.message.sent') chatsOut7d += 1;
      } else if (svDay >= d14Cutoff) {
        if (ev.type === 'order.created') ordersPrev7d += 1;
        if (ev.type === 'order.delivered') {
          deliveredPrev7d += 1;
          revenuePrev7d += Number(p.total || 0);
        }
        if (ev.type === 'order.cancelled') cancelledPrev7d += 1;
        if (ev.type === 'marketing.ad.expense') adSpendPrev7d += Number(p.amount ?? p.monto ?? 0);
      }
    }
  }

  // Sobrescribir métricas de pedidos y pauta con las tablas fuente reales cuando respondan sin error
  if (!realOrders14Res.error && Array.isArray(realOrders14Res.data)) {
    const normEst = (raw?: string | null) => {
      const s = String(raw || '').trim().toLowerCase();
      if (['entregado', 'entregada', 'completado', 'completada'].includes(s)) return 'entregado';
      if (['cancelado', 'cancelada', 'rechazado', 'devuelto'].includes(s)) return 'cancelado';
      return 'activo';
    };

    orders7d = 0;
    ordersPrev7d = 0;
    delivered7d = 0;
    deliveredPrev7d = 0;
    inProgress7d = 0;
    inProgressPrev7d = 0;
    cancelled7d = 0;
    cancelledPrev7d = 0;
    grossSales7d = 0;
    grossSalesPrev7d = 0;
    revenue7d = 0;
    revenuePrev7d = 0;

    for (const o of realOrders14Res.data) {
      if (!o.created_at) continue;
      const svDay = new Date(new Date(o.created_at).getTime() - 6 * 3600000).toISOString().slice(0, 10);
      const est = normEst(o.estado);
      const total = Number(o.total) || 0;

      if (svDay >= d7Cutoff && svDay <= svTodayIso) {
        orders7d += 1;
        if (est === 'cancelado') {
          cancelled7d += 1;
        } else {
          grossSales7d += total;
          if (est === 'entregado') {
            delivered7d += 1;
            revenue7d += total;
          } else {
            inProgress7d += 1;
          }
        }
      } else if (svDay >= d14Cutoff && svDay < d7Cutoff) {
        ordersPrev7d += 1;
        if (est === 'cancelado') {
          cancelledPrev7d += 1;
        } else {
          grossSalesPrev7d += total;
          if (est === 'entregado') {
            deliveredPrev7d += 1;
            revenuePrev7d += total;
          } else {
            inProgressPrev7d += 1;
          }
        }
      }
    }
  }

  if (!realAds14Res.error && Array.isArray(realAds14Res.data)) {
    adSpend7d = 0;
    adSpendPrev7d = 0;
    for (const g of realAds14Res.data) {
      const f = String(g.fecha || '').slice(0, 10);
      const m = Number(g.monto) || 0;
      if (f >= d7Cutoff && f <= svTodayIso) adSpend7d += m;
      else if (f >= d14Cutoff && f < d7Cutoff) adSpendPrev7d += m;
    }
  }

  const productStats = new Map<string, { inquiries: number; orders: number }>();
  const cancelReasons = new Map<string, number>();
  const recentChanges: string[] = [];

  for (const ev of recentEvents) {
    const p = ev.payload || {};
    const skuKey = String(p.catalogo_sku || p.sku || '').trim().toUpperCase();
    if (skuKey && (ev.type === 'chat.funnel.progressed' || ev.type === 'order.created')) {
      const cur = productStats.get(skuKey) || { inquiries: 0, orders: 0 };
      if (ev.type === 'chat.funnel.progressed') cur.inquiries += 1;
      if (ev.type === 'order.created') cur.orders += 1;
      productStats.set(skuKey, cur);
    }

    if (ev.type === 'order.cancelled' || ev.type === 'order.delivery_issue') {
      const reason = String(p.motivo_cancelacion || p.motivo || p.nota || p.tipo || 'Sin motivo').trim().slice(0, 60);
      cancelReasons.set(reason, (cancelReasons.get(reason) || 0) + 1);
    }

    if (
      recentChanges.length < 6 &&
      ['product.updated', 'inventory.adjustment', 'marketing.meta.synced', 'customer.blacklisted'].includes(ev.type)
    ) {
      const dLabel = new Date(new Date(ev.occurred_at).getTime() - 6 * 3600000).toISOString().slice(5, 16).replace('T', ' ');
      const detail = p.sku || p.nombre_cliente || p.motivo || p.insights_count || '';
      recentChanges.push(`${dLabel} ${ev.type}${detail ? ` (${detail})` : ''}`);
    }
  }

  const topInquiredNoClose = Array.from(productStats.entries())
    .map(([sku, st]) => ({ sku, ...st }))
    .filter((x) => x.inquiries >= 2 && x.orders < x.inquiries)
    .sort((a, b) => b.inquiries - b.orders - (a.inquiries - a.orders))
    .slice(0, 3);

  const topCancelReasons = Array.from(cancelReasons.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const resolvedOrders = delivered7d + cancelled7d;
  const resolvedPrevOrders = deliveredPrev7d + cancelledPrev7d;
  const closeRate7d = chatsIn7d > 0 ? Math.round((orders7d / Math.max(chatsIn7d / 3, 1)) * 1000) / 10 : null;
  const cancelRate7d = resolvedOrders > 0 ? Math.round((cancelled7d / resolvedOrders) * 1000) / 10 : null;
  const cancelRatePrev7d =
    resolvedPrevOrders > 0 ? Math.round((cancelledPrev7d / resolvedPrevOrders) * 1000) / 10 : null;
  const roas7d = adSpend7d > 0 ? Math.round((revenue7d / adSpend7d) * 100) / 100 : null;
  const roasPrev7d = adSpendPrev7d > 0 ? Math.round((revenuePrev7d / adSpendPrev7d) * 100) / 100 : null;
  const roasGross7d = adSpend7d > 0 ? Math.round((grossSales7d / adSpend7d) * 100) / 100 : null;
  const roasGrossPrev7d =
    adSpendPrev7d > 0 ? Math.round((grossSalesPrev7d / adSpendPrev7d) * 100) / 100 : null;

  const dailyLines = memoryRows
    .slice(0, 14)
    .map((m: any) => m.summary_text || `${m.day}: ${m.orders_created} ped, $${Number(m.delivered_revenue || 0).toFixed(2)} cobrado`);

  const recentEventLines = recentEvents.slice(0, 120).map((ev: any) => {
    const svTime = new Date(new Date(ev.occurred_at).getTime() - 6 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
    const p = ev.payload || {};
    const brief = [
      p.nombre_cliente || p.nombre,
      p.sku || p.catalogo_sku,
      p.total !== undefined ? `$${p.total}` : undefined,
      p.amount !== undefined ? `$${p.amount}` : undefined,
      p.codigo_anuncio ? `ad:${p.codigo_anuncio}` : undefined,
      p.paso_actual ? `paso:${p.paso_actual}` : undefined,
      p.motivo_cancelacion || p.motivo,
    ]
      .filter(Boolean)
      .join(' | ');
    return `[${svTime}] ${ev.type} (${ev.source_table}) ${brief}`;
  });

  const deltaTxt =
    ordersPrev7d > 0
      ? `${orders7d >= ordersPrev7d ? '+' : ''}${Math.round(((orders7d - ordersPrev7d) / ordersPrev7d) * 100)}% pedidos vs 7d previos`
      : orders7d > 0
        ? `${orders7d} pedidos en últimos 7d`
        : 'sin historial 7d aún';

  const gapTxt =
    topInquiredNoClose.length > 0
      ? `Mayor brecha consulta→cierre: ${topInquiredNoClose[0].sku} (${topInquiredNoClose[0].inquiries} consultas vs ${topInquiredNoClose[0].orders} cierres).`
      : '';

  const cancelTxt =
    cancelRate7d !== null && cancelRate7d >= 20 && topCancelReasons.length > 0
      ? `Alerta cancelaciones (${cancelRate7d}%): motivo principal "${topCancelReasons[0].reason}".`
      : '';

  const deterministicInsight = [deltaTxt, gapTxt, cancelTxt].filter(Boolean).join(' · ');

  return {
    daysLoaded: memoryRows.length,
    eventsLoaded: recentEvents.length,
    svTodayIso,
    d7StartIso: d7Cutoff,
    d14StartIso: d14Cutoff,
    d14EndIso: d14End,
    orders7d,
    ordersPrev7d,
    delivered7d,
    deliveredPrev7d,
    inProgress7d,
    inProgressPrev7d,
    cancelled7d,
    cancelledPrev7d,
    grossSales7d: Math.round(grossSales7d * 100) / 100,
    grossSalesPrev7d: Math.round(grossSalesPrev7d * 100) / 100,
    revenue7d: Math.round(revenue7d * 100) / 100,
    revenuePrev7d: Math.round(revenuePrev7d * 100) / 100,
    adSpend7d: Math.round(adSpend7d * 100) / 100,
    adSpendPrev7d: Math.round(adSpendPrev7d * 100) / 100,
    chatsIn7d,
    chatsOut7d,
    closeRate7d,
    cancelRate7d,
    cancelRatePrev7d,
    roas7d,
    roasPrev7d,
    roasGross7d,
    roasGrossPrev7d,
    topInquiredNoClose,
    topCancelReasons,
    recentChanges,
    dailyLines,
    recentEventLines,
    deterministicInsight,
  };
}

async function generateBriefAiSynthesis(params: {
  briefType: BriefType;
  svTodayIso: string;
  memory: OsMemorySnapshot;
  ventasHoyMonto: number;
  ventasHoyCount: number;
  porDespacharCount: number;
  enRutaCount: number;
  sinResponderCount: number;
  outOfStockCount: number;
}): Promise<string | null> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || (params.memory.eventsLoaded === 0 && params.memory.daysLoaded === 0)) {
    return null;
  }

  try {
    const res = await fetchWithTimeoutLocal(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 130,
          messages: [
            {
              role: 'system',
              content:
                'Eres el analista ejecutivo de TODOENUNO OS (tienda COD en El Salvador). Con los datos reales de memoria histórica y estado actual, redacta UNA recomendación o patrón accionable de máximo 22 palabras en español plano (sin HTML, sin markdown, sin inventar cifras).',
            },
            {
              role: 'user',
              content: `Fecha: ${params.svTodayIso} (${params.briefType}). Hoy: ${params.ventasHoyCount} ped ($${params.ventasHoyMonto.toFixed(2)}), ${params.porDespacharCount} por despachar, ${params.enRutaCount} en ruta, ${params.sinResponderCount} chats sin resp, ${params.outOfStockCount} agotados. Memoria 7d: ${params.memory.orders7d} pedidos (prev 7d: ${params.memory.ordersPrev7d}), ${params.memory.delivered7d} entregados ($${params.memory.revenue7d}), ${params.memory.cancelled7d} cancelados, pauta $${params.memory.adSpend7d} (ROAS ${params.memory.roas7d ?? 'n/a'}x). Resumen días: ${params.memory.dailyLines.slice(0, 5).join(' ; ')}. Brechas: ${JSON.stringify(params.memory.topInquiredNoClose)}. Motivos cancel: ${JSON.stringify(params.memory.topCancelReasons)}.`,
            },
          ],
        }),
      },
      2300
    );
    if (!res.ok) return null;
    const json: any = await res.json().catch(() => ({}));
    const txt = String(json?.choices?.[0]?.message?.content || '').trim();
    return txt ? txt.slice(0, 220) : null;
  } catch {
    return null;
  }
}

function getSalvadorDateInfo(now = new Date()) {
  // El Salvador es UTC-6 todo el año (sin horario de verano)
  const svNowMs = now.getTime() - 6 * 60 * 60 * 1000;
  const svNow = new Date(svNowMs);
  const svTodayIso = svNow.toISOString().slice(0, 10);

  const svYesterday = new Date(svNowMs - 24 * 60 * 60 * 1000);
  const svYesterdayIso = svYesterday.toISOString().slice(0, 10);

  const svMonthPrefix = svTodayIso.slice(0, 7);
  const svMonthStartIso = `${svMonthPrefix}-01`;

  // Límites exactos en UTC para día actual, ayer y mes en El Salvador (00:00 SV = 06:00 UTC)
  const svTodayStartUtc = `${svTodayIso}T06:00:00.000Z`;
  const svYesterdayStartUtc = `${svYesterdayIso}T06:00:00.000Z`;
  const svMonthStartUtc = `${svMonthStartIso}T06:00:00.000Z`;

  let formattedDate = svTodayIso;
  try {
    formattedDate = new Intl.DateTimeFormat('es-SV', {
      timeZone: 'America/El_Salvador',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
    formattedDate = formattedDate.charAt(0).toUpperCase() + formattedDate.slice(1);
  } catch {}

  const svHour = svNow.getUTCHours();

  return {
    svNowMs,
    svHour,
    svTodayIso,
    svYesterdayIso,
    svMonthPrefix,
    svMonthStartIso,
    svTodayStartUtc,
    svYesterdayStartUtc,
    svMonthStartUtc,
    formattedDate,
  };
}

function escapeHtml(raw?: string | null): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtMoney(n: number): string {
  const num = Number(n || 0);
  const sign = num < 0 ? '-' : '';
  return `${sign}$${Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function normalizeTextKey(raw?: string | null): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferOrderQty(skuText?: string | null): number {
  const raw = String(skuText || '').trim();
  const match =
    raw.match(/(?:^|\s)(\d+)\s*x(?:\s|$)/i) ||
    raw.match(/(?:combo|promo|pack)\s+(?:de\s+)?(\d+)\b/i) ||
    raw.match(/^(\d+)\s+[a-zA-ZáéíóúñÁÉÍÓÚÑ]/);
  if (match && match[1]) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 20) return Math.round(n);
  }
  return 1;
}

function diffDaysIso(targetIso?: string | null, baseIso?: string): number | null {
  if (!targetIso || !baseIso) return null;
  const t = new Date(`${String(targetIso).slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${baseIso.slice(0, 10)}T00:00:00Z`).getTime();
  if (Number.isNaN(t) || Number.isNaN(b)) return null;
  return Math.round((t - b) / (24 * 60 * 60 * 1000));
}

function isLegacyConversation(conv: any): boolean {
  const inst = String(conv?.instance_id || '').toLowerCase();
  if (inst === 'builderbot-principal' || inst === 'ventas' || inst === 'builderbot') {
    return true;
  }
  const hasHexId = /^[0-9a-f]{20,}$/i.test(String(conv?.id || ''));
  const placeholderMsg = String(conv?.last_message || '').trim() === 'Haz clic para ver los mensajes';
  return hasHexId && placeholderMsg;
}

function buildMorningBriefWorkflow(panelOrigin: string) {
  const base = panelOrigin.replace(/\/+$/, '');
  return {
    name: 'Briefs Diarios TODOENUNO v2 (8AM + 5PM)',
    nodes: [
      {
        parameters: {
          rule: {
            interval: [
              {
                field: 'cronExpression',
                expression: '0 8 * * *',
              },
            ],
          },
        },
        id: 'brief-v2-schedule-am',
        name: 'Mañana 8:00 AM',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.1,
        position: [200, 200],
      },
      {
        parameters: {
          method: 'GET',
          url: `${base}/api/morning-brief?type=morning`,
          options: {},
        },
        id: 'brief-v2-fetch-am',
        name: 'Brief Operativo (8AM)',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [460, 200],
      },
      {
        parameters: {
          method: 'POST',
          url: 'https://api.telegram.org/botREEMPLAZAR_CON_TU_TELEGRAM_BOT_TOKEN/sendMessage',
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            "={{ JSON.stringify({ chat_id: 9087238722, text: $json.mensaje, parse_mode: 'HTML', disable_web_page_preview: true }) }}",
          options: {},
        },
        id: 'brief-v2-telegram-am',
        name: 'Enviar Telegram (8AM)',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [720, 200],
      },
      {
        parameters: {
          rule: {
            interval: [
              {
                field: 'cronExpression',
                expression: '0 17 * * *',
              },
            ],
          },
        },
        id: 'brief-v2-schedule-pm',
        name: 'Tarde 5:00 PM',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.1,
        position: [200, 420],
      },
      {
        parameters: {
          method: 'GET',
          url: `${base}/api/morning-brief?type=evening`,
          options: {},
        },
        id: 'brief-v2-fetch-pm',
        name: 'Brief Rentabilidad e Inventario (5PM)',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [460, 420],
      },
      {
        parameters: {
          method: 'POST',
          url: 'https://api.telegram.org/botREEMPLAZAR_CON_TU_TELEGRAM_BOT_TOKEN/sendMessage',
          sendBody: true,
          specifyBody: 'json',
          jsonBody:
            "={{ JSON.stringify({ chat_id: 9087238722, text: $json.mensaje, parse_mode: 'HTML', disable_web_page_preview: true }) }}",
          options: {},
        },
        id: 'brief-v2-telegram-pm',
        name: 'Enviar Telegram (5PM)',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [720, 420],
      },
    ],
    pinData: {},
    connections: {
      'Mañana 8:00 AM': {
        main: [[{ node: 'Brief Operativo (8AM)', type: 'main', index: 0 }]],
      },
      'Brief Operativo (8AM)': {
        main: [[{ node: 'Enviar Telegram (8AM)', type: 'main', index: 0 }]],
      },
      'Tarde 5:00 PM': {
        main: [[{ node: 'Brief Rentabilidad e Inventario (5PM)', type: 'main', index: 0 }]],
      },
      'Brief Rentabilidad e Inventario (5PM)': {
        main: [[{ node: 'Enviar Telegram (5PM)', type: 'main', index: 0 }]],
      },
    },
    active: false,
    settings: {
      executionOrder: 'v1',
      timezone: 'America/El_Salvador',
    },
    tags: [],
  };
}

export default async function handler(req: any, res: any) {
  if (
    req.query?.telegram_mode ||
    req.body?.update_id !== undefined ||
    (req.method === 'POST' && (req.body?.message || req.body?.callback_query))
  ) {
    return handleTelegramBotRequest(req, res);
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const dateInfo = getSalvadorDateInfo();
  const action = String(req.query?.action || req.body?.action || '').trim().toLowerCase();
  const rawType = String(req.query?.type || req.body?.type || 'full')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const briefType: BriefType =
    rawType === 'auto'
      ? dateInfo.svHour < 13
        ? 'morning'
        : 'evening'
      : rawType === 'morning' || rawType === 'am' || rawType === 'operativo'
      ? 'morning'
      : rawType === 'evening' || rawType === 'pm' || rawType === 'tarde' || rawType === 'finanzas'
      ? 'evening'
      : 'full';

  const proto = String(req.headers['x-forwarded-proto'] || 'https');
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'todoenuno-panel.vercel.app');
  const panelOrigin = `${proto}://${host}`;

  if (action === 'workflow') {
    const wf = buildMorningBriefWorkflow(panelOrigin);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="brief-matutino-v2.json"');
    return res.status(200).send(JSON.stringify(wf, null, 2));
  }

  const briefSecret = process.env.BRIEF_SECRET || process.env.TODD_INTERNAL_SECRET;
  if (briefSecret) {
    const incomingSecret = req.headers['x-brief-secret'] || req.headers['x-todd-secret'] || req.query?.secret;
    if (incomingSecret && incomingSecret !== briefSecret) {
      return res.status(401).json({ error: 'Unauthorized brief request' });
    }
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Faltan credenciales de Supabase en el servidor' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  const nowMs = Date.now();
  const last48hIso = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();

  try {
    const streetAndActiveStatuses = [
      'nuevo',
      'programado',
      'encargo',
      'agendado',
      'por_empacar',
      'empacado',
      'confirmado',
      'en_empaque',
      'por empacar',
      'en_camino',
      'en_ruta',
      'en ruta',
      'despachado',
      'enviado',
      'ruta',
      'en camino',
      'entregado',
      'entregada',
      'completado',
      'completada',
    ];

    const safeOrderCols =
      'id,pedido_codigo,nombre_cliente,sku,catalogo_sku,items,total,estado,liquidado,es_encargo,fecha_programada,codigo_anuncio,notas,created_at';

    const [
      ordersResRaw,
      monthOrdersResRaw,
      unliqOrdersResRaw,
      convRes,
      msgsRes,
      stateRes,
      stockRes,
      variantsRes,
      adRes,
      pagosRes,
      notasRes,
      bizDocRes,
      catDocRes,
      accountsRowsRaw,
      txTodayRes,
    ] = await Promise.all([
      supabase
        .from('whatsapp_orders')
        .select(safeOrderCols)
        .order('created_at', { ascending: false })
        .limit(800),
      supabase
        .from('whatsapp_orders')
        .select(safeOrderCols)
        .gte('created_at', dateInfo.svMonthStartUtc)
        .order('created_at', { ascending: false })
        .limit(2500),
      supabase
        .from('whatsapp_orders')
        .select(safeOrderCols)
        .in('estado', streetAndActiveStatuses)
        .or('liquidado.is.null,liquidado.eq.false')
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase
        .from('bb_conversations')
        .select('id,instance_id,contact_name,contact_phone,last_message,updated_at,status')
        .order('updated_at', { ascending: false })
        .limit(250),
      supabase
        .from('bb_messages')
        .select('conversation_id,from_me,created_at')
        .order('created_at', { ascending: false })
        .limit(2000),
      supabase
        .from('whatsapp_state')
        .select('last_sku,last_nombre,last_detalle,paso_actual,updated_at')
        .gte('updated_at', last48hIso)
        .limit(200),
      supabase
        .from('inventory_stock')
        .select('sku,nombre,template_id,costo_unitario,precio_venta,stock_fisico,stock_disponible,stock_minimo_alerta,activo,activo_todd')
        .order('stock_disponible', { ascending: true }),
      supabase
        .from('productos_variantes')
        .select('variante_id,template_id,sku,nombre_completo,color'),
      supabase
        .from('gastos_publicidad')
        .select('monto,fecha,codigo_anuncio')
        .gte('fecha', dateInfo.svMonthStartIso)
        .lte('fecha', dateInfo.svTodayIso),
      supabase.from('panel_pagos').select('id,nombre,monto,fecha_vencimiento,categoria'),
      supabase.from('panel_notas').select('id,contenido,created_at').order('created_at', { ascending: false }).limit(5),
      supabase
        .from('panel_docs')
        .select('contenido')
        .eq('titulo', '__SYSTEM_TODD_BUSINESS_SETTINGS_V1__')
        .maybeSingle(),
      supabase
        .from('panel_docs')
        .select('contenido')
        .eq('titulo', '__SYSTEM_TODD_CATALOG_SETTINGS_V1__')
        .maybeSingle(),
      fetchCashAccounts(supabase, { allowFallbackMock: false }),
      supabase
        .from('finance_money_transactions')
        .select('tipo,categoria,monto,fecha')
        .eq('fecha', dateInfo.svTodayIso),
    ]);

    let ordersRes = ordersResRaw;
    let monthOrdersRes = monthOrdersResRaw;
    let unliqOrdersRes = unliqOrdersResRaw;

    if (ordersRes.error || monthOrdersRes.error || unliqOrdersRes.error) {
      const [fbOrders, fbMonth, fbUnliq] = await Promise.all([
        ordersRes.error
          ? supabase
              .from('whatsapp_orders')
              .select('*')
              .order('created_at', { ascending: false })
              .limit(800)
          : Promise.resolve(ordersRes),
        monthOrdersRes.error
          ? supabase
              .from('whatsapp_orders')
              .select('*')
              .gte('created_at', dateInfo.svMonthStartUtc)
              .order('created_at', { ascending: false })
              .limit(2500)
          : Promise.resolve(monthOrdersRes),
        unliqOrdersRes.error
          ? supabase
              .from('whatsapp_orders')
              .select('*')
              .in('estado', streetAndActiveStatuses)
              .or('liquidado.is.null,liquidado.eq.false')
              .order('created_at', { ascending: false })
              .limit(2000)
          : Promise.resolve(unliqOrdersRes),
      ]);
      ordersRes = fbOrders;
      monthOrdersRes = fbMonth;
      unliqOrdersRes = fbUnliq;
    }

    const osMemory = await loadOsMemorySnapshotServer(supabase, dateInfo.svTodayIso, 14);

    const normalizeOrderStatusLocal = (rawEstado?: string | null) => {
      const raw = String(rawEstado || '').trim().toLowerCase();
      if (!raw) return 'nuevo';
      if (['nuevo', 'programado', 'por_empacar', 'en_camino', 'entregado', 'cancelado'].includes(raw)) return raw;
      if (['en_ruta', 'en ruta', 'despachado', 'enviado', 'ruta', 'en camino'].includes(raw)) return 'en_camino';
      if (['empacado', 'confirmado', 'en_empaque', 'por empacar'].includes(raw)) return 'por_empacar';
      if (['entregada', 'completado', 'completada'].includes(raw)) return 'entregado';
      if (['cancelada', 'rechazado', 'devuelto'].includes(raw)) return 'cancelado';
      if (['encargo', 'agendado'].includes(raw)) return 'programado';
      return 'nuevo';
    };

    /* 1. INVENTARIO & MAPA DE COSTOS (COGS) CON UNIFICACIÓN DE VARIANTES */
    const stockRows = Array.isArray(stockRes.data) ? stockRes.data : [];
    const variantRows = Array.isArray(variantsRes.data) ? variantsRes.data : [];
    const variantSkuSet = new Set(variantRows.map((v: any) => String(v.sku || '').trim().toUpperCase()).filter(Boolean));

    const duplicateChildSkus = new Set<string>();
    const rowsByTemplate = new Map<string, any[]>();
    for (const item of stockRows) {
      const tId = item.template_id !== undefined && item.template_id !== null ? String(item.template_id).trim() : '';
      if (!tId) continue;
      const arr = rowsByTemplate.get(tId) || [];
      arr.push(item);
      rowsByTemplate.set(tId, arr);
    }
    rowsByTemplate.forEach((rows) => {
      if (rows.length <= 1) return;
      const sorted = [...rows].sort((a, b) => {
        const aIsVar = variantSkuSet.has(String(a.sku || '').trim().toUpperCase()) ? 1 : 0;
        const bIsVar = variantSkuSet.has(String(b.sku || '').trim().toUpperCase()) ? 1 : 0;
        if (aIsVar !== bIsVar) return aIsVar - bIsVar;
        return String(a.sku || '').trim().length - String(b.sku || '').trim().length;
      });
      const parentSku = String(sorted[0]?.sku || '').trim().toUpperCase();
      for (let i = 1; i < sorted.length; i++) {
        const childSku = String(sorted[i]?.sku || '').trim().toUpperCase();
        if (childSku && (variantSkuSet.has(childSku) || childSku.startsWith(`${parentSku}-`))) {
          duplicateChildSkus.add(childSku);
        }
      }
    });

    const nonDupStockSkus = new Set(
      stockRows
        .filter((item: any) => !duplicateChildSkus.has(String(item.sku || '').trim().toUpperCase()))
        .map((item: any) => String(item.sku || '').trim().toUpperCase())
        .filter(Boolean)
    );
    for (const item of stockRows) {
      const skuUpper = String(item.sku || '').trim().toUpperCase();
      if (!skuUpper || duplicateChildSkus.has(skuUpper)) continue;
      if (variantSkuSet.has(skuUpper)) {
        for (const pSku of nonDupStockSkus) {
          if (pSku !== skuUpper && skuUpper.startsWith(`${pSku}-`)) {
            duplicateChildSkus.add(skuUpper);
            break;
          }
        }
      }
    }

    const costBySku = new Map<string, number>();
    const nameBySku = new Map<string, string>();
    const templateToParentSku = new Map<string, string>();
    const variantToParentSku = new Map<string, string>();
    const normalizedStockEntries: Array<{ key: string; sku: string; costo: number }> = [];

    const stripOrderText = (raw?: string | null) =>
      normalizeTextKey(
        String(raw || '')
          .replace(/^\s*\d+\s*[x×]\s*/i, '')
          .replace(/\s*\([^)]*\)\s*/g, ' ')
      );

    for (const item of stockRows) {
      const skuUpper = String(item.sku || '').trim().toUpperCase();
      if (!skuUpper || duplicateChildSkus.has(skuUpper) || skuUpper.toLowerCase().includes('fee')) continue;
      const costo = Number(item.costo_unitario) || 0;
      const itemName = String(item.nombre || item.sku || '').trim();
      costBySku.set(skuUpper, costo);
      nameBySku.set(skuUpper, itemName);
      const tId = item.template_id !== undefined && item.template_id !== null ? String(item.template_id).trim() : '';
      if (tId && !templateToParentSku.has(tId)) templateToParentSku.set(tId, skuUpper);
      normalizedStockEntries.push({
        key: stripOrderText(itemName),
        sku: skuUpper,
        costo,
      });
    }

    const masterSkusList = Array.from(costBySku.keys());
    for (const v of variantRows) {
      const vSku = String(v.sku || '').trim().toUpperCase();
      const tId = v.template_id !== undefined && v.template_id !== null ? String(v.template_id).trim() : '';
      let parentSku = tId ? templateToParentSku.get(tId) : undefined;
      if (!parentSku && vSku) {
        parentSku = masterSkusList
          .filter((m) => vSku === m || vSku.startsWith(`${m}-`))
          .sort((a, b) => b.length - a.length)[0];
      }
      if (parentSku && vSku) {
        variantToParentSku.set(vSku, parentSku);
      }
    }

    const canonicalizeCandidateSku = (rawCandidate?: string | null): string | null => {
      const c = String(rawCandidate || '').trim().toUpperCase();
      if (!c) return null;
      if (costBySku.has(c)) return c;
      if (variantToParentSku.has(c)) return variantToParentSku.get(c)!;
      if (templateToParentSku.has(c)) return templateToParentSku.get(c)!;
      const prefix = masterSkusList
        .filter((m) => c.startsWith(`${m}-`))
        .sort((a, b) => b.length - a.length)[0];
      return prefix || null;
    };

    const resolveOrderUnitCost = (o: any): { found: boolean; cost: number; label: string } => {
      const candidates: string[] = [];
      if (o.catalogo_sku) candidates.push(String(o.catalogo_sku));
      if (Array.isArray(o.items)) {
        for (const it of o.items) {
          if (it?.catalogo_sku) candidates.push(String(it.catalogo_sku));
          if (it?.variante_sku) candidates.push(String(it.variante_sku));
          if (it?.sku) candidates.push(String(it.sku));
        }
      }
      if (o.sku) candidates.push(String(o.sku));

      for (const cand of candidates) {
        const master = canonicalizeCandidateSku(cand);
        if (master && costBySku.has(master)) {
          const c = costBySku.get(master) || 0;
          return { found: c > 0, cost: c, label: nameBySku.get(master) || master };
        }
      }

      const normRaw = stripOrderText(o.sku);
      if (normRaw) {
        for (const entry of normalizedStockEntries) {
          if (entry.key && (normRaw.includes(entry.key) || entry.key.includes(normRaw))) {
            return {
              found: entry.costo > 0,
              cost: entry.costo,
              label: nameBySku.get(entry.sku) || entry.sku,
            };
          }
        }
      }
      return {
        found: false,
        cost: 0,
        label: String(o.catalogo_sku || o.sku || 'Producto').trim(),
      };
    };

    const validStock = stockRows.filter((item: any) => {
      const skuUpper = String(item.sku || '').trim().toUpperCase();
      const s = skuUpper.toLowerCase();
      return (
        !s.includes('fee') &&
        !s.includes('test') &&
        !s.includes('descuento') &&
        item.activo !== false &&
        !duplicateChildSkus.has(skuUpper)
      );
    });
    const outOfStock = validStock.filter((i: any) => Number(i.stock_disponible || 0) <= 0);
    const lowStock = validStock.filter((i: any) => {
      const qty = Number(i.stock_disponible || 0);
      const min = Math.max(3, Number(i.stock_minimo_alerta) || 3);
      return qty > 0 && qty <= min;
    });

    /* 2. PEDIDOS: DESPACHO, ENCARGOS, RUTA Y VENTAS (HOY / AYER / MES) */
    const ordersMap = new Map<string, any>();
    for (const o of Array.isArray(ordersRes.data) ? ordersRes.data : []) {
      ordersMap.set(o.id, o);
    }
    for (const o of Array.isArray(monthOrdersRes.data) ? monthOrdersRes.data : []) {
      if (!ordersMap.has(o.id)) ordersMap.set(o.id, o);
    }
    for (const o of Array.isArray(unliqOrdersRes.data) ? unliqOrdersRes.data : []) {
      if (!ordersMap.has(o.id)) ordersMap.set(o.id, o);
    }
    const orders = Array.from(ordersMap.values());
    const porDespachar: any[] = [];
    const encargosUrgentes: Array<any & { diff: number | null }> = [];
    const enRuta: any[] = [];
    const enRutaRezagados: any[] = [];
    const porLiquidar: any[] = [];
    const ventasHoyOrders: any[] = [];
    const canceladosHoyOrders: any[] = [];
    const ventasAyerOrders: any[] = [];
    const ventasMesOrders: any[] = [];
    let indicacionesPostCierreCount = 0;

    let staleRouteHours = 36;
    let activeSaturationLabel = '';
    try {
      if (bizDocRes.data?.contenido) {
        const b = JSON.parse(bizDocRes.data.contenido);
        if (b?.operationalSaturationEnabled !== false) {
          const is34 = b?.operationalSaturationDays === '3-4';
          activeSaturationLabel = is34 ? '3 - 4 días' : '2 - 3 días';
          staleRouteHours = is34 ? 96 : 72;
        }
      } else {
        activeSaturationLabel = '2 - 3 días';
        staleRouteHours = 72;
      }
    } catch {}
    const staleRouteThresholdMs = nowMs - staleRouteHours * 60 * 60 * 1000;

    const svTodayStartMs = new Date(dateInfo.svTodayStartUtc).getTime();
    const svYesterdayStartMs = new Date(dateInfo.svYesterdayStartUtc).getTime();
    const svMonthStartMs = new Date(dateInfo.svMonthStartUtc).getTime();

    for (const o of orders) {
      const estado = normalizeOrderStatusLocal(o.estado);
      const createdAt = String(o.created_at || '');
      const createdMs = createdAt ? new Date(createdAt).getTime() : 0;
      const validCreatedMs = Number.isFinite(createdMs) && createdMs > 0;
      const isCancelled = estado === 'cancelado';

      if (estado === 'nuevo' || estado === 'por_empacar') {
        porDespachar.push(o);
        if (String(o.notas || '').includes('[Indicación cliente]')) {
          indicacionesPostCierreCount++;
        }
      }

      if (estado === 'en_camino' && o.liquidado !== true) {
        enRuta.push(o);
        if (validCreatedMs && createdMs < staleRouteThresholdMs) {
          enRutaRezagados.push(o);
        }
      }

      if (estado === 'entregado' && o.liquidado !== true) {
        porLiquidar.push(o);
      }

      const esEncargo =
        estado === 'programado' ||
        (Boolean(o.es_encargo) && !['cancelado', 'entregado', 'en_camino'].includes(estado));
      if (esEncargo) {
        const diff = diffDaysIso(o.fecha_programada, dateInfo.svTodayIso);
        if (diff === null || diff <= 1) {
          encargosUrgentes.push({ ...o, diff });
        }
      }

      if (validCreatedMs && createdMs >= svTodayStartMs) {
        if (isCancelled) canceladosHoyOrders.push(o);
        else ventasHoyOrders.push(o);
      }

      if (!isCancelled && validCreatedMs && createdMs >= svYesterdayStartMs && createdMs < svTodayStartMs) {
        ventasAyerOrders.push(o);
      }

      if (!isCancelled && validCreatedMs && createdMs >= svMonthStartMs) {
        ventasMesOrders.push(o);
      }
    }

    encargosUrgentes.sort((a, b) => (a.diff ?? 99) - (b.diff ?? 99));

    const totalPorDespachar = porDespachar.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const totalPorLiquidar = porLiquidar.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const totalEnRuta = enRuta.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const ventasHoyMonto = ventasHoyOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const ventasAyerMonto = ventasAyerOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const ventasMesMonto = ventasMesOrders.reduce((s, o) => s + (Number(o.total) || 0), 0);

    // Rentabilidad del día (COGS + Top producto hoy + Top anuncio hoy)
    let cogsHoyTotal = 0;
    let ordersHoySinCosto = 0;
    const topProductTodayMap = new Map<string, { orders: number; revenue: number }>();
    const adSalesToday = new Map<string, { chats: number; orders: number; revenue: number }>();

    for (const o of ventasHoyOrders) {
      let orderCogs = 0;
      let resolvedLabel = '';
      let resolvedAnyCost = false;

      if (Array.isArray(o.items) && o.items.length > 0) {
        for (const it of o.items) {
          const itemQty = Math.max(1, Number(it?.cantidad ?? it?.qty ?? 1) || 1);
          const itemResolved = resolveOrderUnitCost({
            catalogo_sku: it?.catalogo_sku || o.catalogo_sku,
            sku: it?.variante_sku || it?.sku || o.sku,
            items: [it],
          });
          if (!resolvedLabel) resolvedLabel = itemResolved.label;
          if (itemResolved.found) {
            orderCogs += itemResolved.cost * itemQty;
            resolvedAnyCost = true;
          }
        }
      } else {
        const rawCantidad = Number((o as any).cantidad);
        const qty =
          Number.isFinite(rawCantidad) && rawCantidad > 0 ? Math.round(rawCantidad) : inferOrderQty(o.sku);
        const resolved = resolveOrderUnitCost(o);
        resolvedLabel = resolved.label;
        if (resolved.found) {
          orderCogs = resolved.cost * qty;
          resolvedAnyCost = true;
        }
      }

      if (resolvedAnyCost) {
        cogsHoyTotal += orderCogs;
      } else {
        ordersHoySinCosto++;
      }

      const prodLabel = resolvedLabel || 'Producto';
      const curProd = topProductTodayMap.get(prodLabel) || { orders: 0, revenue: 0 };
      curProd.orders += 1;
      curProd.revenue += Number(o.total) || 0;
      topProductTodayMap.set(prodLabel, curProd);

      const ad = String(o.codigo_anuncio || '').trim();
      if (ad) {
        const curAd = adSalesToday.get(ad) || { chats: 0, orders: 0, revenue: 0 };
        curAd.orders += 1;
        curAd.revenue += Number(o.total) || 0;
        adSalesToday.set(ad, curAd);
      }
    }

    /* 3. WHATSAPP & BOT TODD */
    const rawConvs = Array.isArray(convRes.data) ? convRes.data : [];
    const activeConvs = rawConvs.filter(c => !isLegacyConversation(c));
    const activeConvIds = new Set(activeConvs.map(c => c.id));
    const recentMsgs = Array.isArray(msgsRes.data) ? msgsRes.data : [];

    const lastMsgFromMeMap: Record<string, boolean> = {};
    const convsWithActivityYesterday = new Set<string>();
    const convsWithActivityToday = new Set<string>();
    let incomingMsgsYesterday = 0;
    let incomingMsgsToday = 0;

    for (const m of recentMsgs) {
      const cid = String(m.conversation_id || '');
      if (!cid || !activeConvIds.has(cid)) continue;
      if (lastMsgFromMeMap[cid] === undefined) {
        lastMsgFromMeMap[cid] = Boolean(m.from_me);
      }
      const created = String(m.created_at || '');
      if (created >= dateInfo.svTodayStartUtc) {
        convsWithActivityToday.add(cid);
        if (!m.from_me) incomingMsgsToday++;
      } else if (created >= dateInfo.svYesterdayStartUtc && created < dateInfo.svTodayStartUtc) {
        convsWithActivityYesterday.add(cid);
        if (!m.from_me) incomingMsgsYesterday++;
      }
    }

    const sinResponderConvs = activeConvs.filter(c => lastMsgFromMeMap[c.id] === false);
    const sinResponderHumanos = sinResponderConvs.filter(c => c.status === 'human').length;

    const chatsAyerCount = convsWithActivityYesterday.size;
    const toddCloseRateYesterday =
      chatsAyerCount > 0 ? Math.round((ventasAyerOrders.length / chatsAyerCount) * 1000) / 10 : 0;

    const chatsHoyCount = convsWithActivityToday.size;
    const toddCloseRateToday =
      chatsHoyCount > 0 ? Math.round((ventasHoyOrders.length / chatsHoyCount) * 1000) / 10 : 0;

    const stateRows = Array.isArray(stateRes.data) ? stateRes.data : [];
    const productInterestMap = new Map<string, number>();
    const adSalesYesterday = new Map<string, { chats: number; orders: number; revenue: number }>();

    for (const o of ventasAyerOrders) {
      const ad = String(o.codigo_anuncio || '').trim();
      if (!ad) continue;
      const cur = adSalesYesterday.get(ad) || { chats: 0, orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += Number(o.total) || 0;
      adSalesYesterday.set(ad, cur);
    }

    for (const st of stateRows) {
      const label = String(st.last_nombre || st.last_sku || '').trim();
      if (label) {
        productInterestMap.set(label, (productInterestMap.get(label) || 0) + 1);
      }
      const det = String(st.last_detalle || '');
      const updated = String(st.updated_at || '');
      if (det.startsWith('AD:')) {
        const adName = det.slice(3).trim();
        if (adName) {
          if (updated >= dateInfo.svTodayStartUtc) {
            const cur = adSalesToday.get(adName) || { chats: 0, orders: 0, revenue: 0 };
            cur.chats += 1;
            adSalesToday.set(adName, cur);
          } else if (updated >= dateInfo.svYesterdayStartUtc) {
            const cur = adSalesYesterday.get(adName) || { chats: 0, orders: 0, revenue: 0 };
            cur.chats += 1;
            adSalesYesterday.set(adName, cur);
          }
        }
      }
    }

    const topConsultedProducts = Array.from(productInterestMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const topProductToday =
      Array.from(topProductTodayMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue || b[1].orders - a[1].orders)[0] ||
      null;
    const topAdToday =
      Array.from(adSalesToday.entries()).sort((a, b) => b[1].orders - a[1].orders || b[1].chats - a[1].chats)[0] ||
      null;
    const topAdYesterday =
      Array.from(adSalesYesterday.entries()).sort((a, b) => b[1].orders - a[1].orders || b[1].chats - a[1].chats)[0] ||
      null;

    /* 4. PAUTA, RENTABILIDAD, PAGOS Y LIQUIDEZ */
    const adRows = Array.isArray(adRes.data) ? adRes.data : [];
    const adSpendToday = adRows
      .filter((r: any) => String(r.fecha || '').slice(0, 10) === dateInfo.svTodayIso)
      .reduce((s: number, r: any) => s + (Number(r.monto) || 0), 0);
    const adSpendYesterday = adRows
      .filter((r: any) => String(r.fecha || '').slice(0, 10) === dateInfo.svYesterdayIso)
      .reduce((s: number, r: any) => s + (Number(r.monto) || 0), 0);
    const adSpendMonth = adRows.reduce((s: number, r: any) => s + (Number(r.monto) || 0), 0);

    const roasToday = adSpendToday > 0 ? ventasHoyMonto / adSpendToday : null;
    const roasYesterday = adSpendYesterday > 0 ? ventasAyerMonto / adSpendYesterday : null;
    const roasMonth = adSpendMonth > 0 ? ventasMesMonto / adSpendMonth : null;

    // Utilidad operativa estimada del día = Ventas hoy - COGS hoy - Pauta hoy
    const netProfitToday = ventasHoyMonto - cogsHoyTotal - adSpendToday;
    const netMarginTodayPct = ventasHoyMonto > 0 ? (netProfitToday / ventasHoyMonto) * 100 : null;

    const txTodayRows = Array.isArray(txTodayRes.data) ? txTodayRes.data : [];
    const otherExpensesToday = txTodayRows
      .filter((t: any) => t.tipo === 'expense' && t.categoria !== 'pauta_publicidad')
      .reduce((s: number, t: any) => s + (Number(t.monto) || 0), 0);

    const pagosRows = Array.isArray(pagosRes.data) ? pagosRes.data : [];
    const pagosUrgentes = pagosRows
      .map((p: any) => ({ ...p, diff: diffDaysIso(p.fecha_vencimiento, dateInfo.svTodayIso) }))
      .filter((p: any) => p.diff !== null && p.diff >= -2 && p.diff <= 3)
      .sort((a: any, b: any) => a.diff - b.diff);

    const accountsRows = Array.isArray(accountsRowsRaw) ? accountsRowsRaw : [];
    const liquidityInfo = summarizeCashAccounts(accountsRows);
    const totalLiquidity = liquidityInfo.netTotal;

    const finHealth = await computeServerFinancialHealthSnapshot(supabase, dateInfo.svTodayIso, {
      accounts: accountsRows,
      stockRows,
      variantRows,
      pagosRows,
      deliveredUnliq: porLiquidar,
      inRouteList: enRuta,
    });

    /* 5. CONFIG TODD & NOTAS */
    let allowBackorderGlobal = false;
    try {
      if (catDocRes.data?.contenido) {
        const c = JSON.parse(catDocRes.data.contenido);
        allowBackorderGlobal = Boolean(c?.allowBackorderGlobal);
      }
    } catch {}

    let activeHolidayNotice = '';
    try {
      if (bizDocRes.data?.contenido) {
        const b = JSON.parse(bizDocRes.data.contenido);
        const msg = String(b?.holidayMessage || '').trim();
        const start = String(b?.holidayStartDate || '').trim().slice(0, 10);
        const end = String(b?.holidayEndDate || '').trim().slice(0, 10);
        const activeToday =
          Boolean(b?.holidayModeEnabled) &&
          msg.length > 0 &&
          (!start || dateInfo.svTodayIso >= start) &&
          (!end || dateInfo.svTodayIso <= end);
        if (activeToday) activeHolidayNotice = msg;
      }
    } catch {}

    const notasRows = Array.isArray(notasRes.data) ? notasRes.data : [];

    const healthEmoji =
      finHealth.estado === 'Saludable' ? '🟢' : finHealth.estado === 'Atención' ? '🟡' : '🔴';
    const runwayText = finHealth.runwayDias !== null ? `${finHealth.runwayDias}d` : 'N/A';

    let radarBriefAlerts: string[] = [];
    try {
      const briefInference = await computeServerOperationalInference(supabase, dateInfo.svTodayIso, {
        finHealth,
        catalog: stockRows,
        convs: rawConvs,
      });
      if (briefInference.highRiskPreDispatch.length > 0) {
        const topRisk = briefInference.highRiskPreDispatch[0];
        radarBriefAlerts.push(
          `• ⚠️ Riesgo rechazo pre-despacho: <b>${briefInference.highRiskPreDispatch.length}</b> paq. (ej. ${escapeHtml(
            topRisk.cliente
          )} · ${topRisk.riskPct}% prob. — ${escapeHtml(topRisk.reasons[0] || 'patrón zona/courier')})`
        );
      }
      if (briefInference.stockoutPredictions.length > 0) {
        const topStk = briefInference.stockoutPredictions[0];
        radarBriefAlerts.push(
          `• ⏳ Quiebre proyectado: <b>${escapeHtml(topStk.nombre)}</b> en <b>~${topStk.daysLeft.toFixed(
            1
          )}d</b> (${topStk.stockDisponible}u disp · ritmo ${topStk.weightedDailyRate.toFixed(1)}/día)`
        );
      }
      if (briefInference.dailyAnomaly.severity === 'alert' || briefInference.dailyAnomaly.severity === 'warn') {
        radarBriefAlerts.push(
          `• 📉 Pulso causal hoy: ${escapeHtml(briefInference.dailyAnomaly.verdict)}`
        );
      }
    } catch {}

    /* 6. ARMAR MENSAJE SEGÚN TIPO ('morning' | 'evening' | 'full') */
    const lines: string[] = [];

    if (briefType === 'morning') {
      lines.push(`☀️ <b>BRIEF OPERATIVO (8:00 AM) — TODOENUNO</b>`);
      lines.push(`📅 <i>${escapeHtml(dateInfo.formattedDate)}</i>`);

      if (activeSaturationLabel) {
        lines.push('');
        lines.push(`⏳ <b>Saturación operativa activa en Bot Todd:</b> plazo global de <b>${escapeHtml(activeSaturationLabel)}</b> (todo el país).`);
      }

      if (activeHolidayNotice) {
        lines.push('');
        lines.push(`⚠️ <b>Aviso temporal activo en Bot Todd:</b>`);
        lines.push(`<i>"${escapeHtml(activeHolidayNotice.slice(0, 140))}"</i>`);
      }

      lines.push('');
      lines.push(`📦 <b>DESPACHO Y LOGÍSTICA HOY</b>`);
      lines.push(`• Por despachar: <b>${porDespachar.length} pedidos</b> (${fmtMoney(totalPorDespachar)})`);
      if (indicacionesPostCierreCount > 0) {
        lines.push(`• Con indicación especial del cliente: <b>${indicacionesPostCierreCount}</b>`);
      }
      if (encargosUrgentes.length > 0) {
        const encPreview = encargosUrgentes
          .slice(0, 2)
          .map(e => {
            const tag = e.diff !== null && e.diff < 0 ? 'atrasado' : e.diff === 0 ? 'hoy' : 'mañana';
            return `${escapeHtml(e.nombre_cliente || 'Cliente')} (${tag})`;
          })
          .join(', ');
        lines.push(`• Encargos urgentes: <b>${encargosUrgentes.length}</b> — ${encPreview}`);
      }
      lines.push(
        `• En ruta ahora: <b>${enRuta.length} guías</b> (${fmtMoney(totalEnRuta)})${
          enRutaRezagados.length > 0 ? ` · ⚠️ <b>${enRutaRezagados.length} con +${staleRouteHours}h</b>` : ''
        }`
      );
      lines.push(
        `• Salud financiera: <b>${healthEmoji} ${finHealth.score}/100 (${finHealth.estado})</b> · Valor real: <b>${fmtMoney(finHealth.valorTotalReal)}</b> · Oxígeno: <b>${runwayText}</b>`
      );

      lines.push('');
      lines.push(`💬 <b>WHATSAPP &amp; BOT TODD</b>`);
      if (sinResponderConvs.length > 0) {
        lines.push(
          `• Pendientes ahora: <b>${sinResponderConvs.length} sin responder</b>${
            sinResponderHumanos > 0 ? ` (${sinResponderHumanos} en Modo Humano)` : ''
          }`
        );
      } else {
        lines.push(`• Pendientes ahora: bandeja al día ✅`);
      }
      lines.push(
        `• Ayer: <b>${chatsAyerCount} chats</b> (${incomingMsgsYesterday} msgs) → <b>${ventasAyerOrders.length} ped.</b> (${toddCloseRateYesterday}% cierre)`
      );
      if (topConsultedProducts.length > 0) {
        lines.push(
          `• Más cotizados: ${topConsultedProducts
            .map(([name, cnt]) => `${escapeHtml(name)} (${cnt})`)
            .join(', ')}`
        );
      }

      if (notasRows.length > 0) {
        lines.push('');
        lines.push(`📝 <b>NOTAS PENDIENTES (HOY)</b>`);
        for (const n of notasRows.slice(0, 3)) {
          lines.push(`• ${escapeHtml(String(n.contenido || '').slice(0, 110))}`);
        }
      }

      if (radarBriefAlerts.length > 0) {
        lines.push('');
        lines.push(`📡 <b>RADAR PREDICTIVO</b> <i>(/radar)</i>`);
        for (const alertLine of radarBriefAlerts.slice(0, 3)) {
          lines.push(alertLine);
        }
      }

      lines.push('');
      lines.push(
        `🔗 <a href="${panelOrigin}/">Hoy</a> · <a href="${panelOrigin}/unichat">UniChat</a> · <a href="${panelOrigin}/pedidos">Pedidos</a>`
      );
    } else if (briefType === 'evening') {
      lines.push(`🌆 <b>CIERRE FINANCIERO Y STOCK (5:00 PM) — TODOENUNO</b>`);
      lines.push(`📅 <i>${escapeHtml(dateInfo.formattedDate)}</i>`);

      lines.push('');
      lines.push(`📊 <b>RENTABILIDAD DE HOY</b>`);
      lines.push(
        `• Ventas hoy: <b>${fmtMoney(ventasHoyMonto)}</b> (${ventasHoyOrders.length} ped.${
          canceladosHoyOrders.length > 0 ? ` · ${canceladosHoyOrders.length} canc.` : ''
        })`
      );
      lines.push(
        `• Todd hoy: <b>${chatsHoyCount} chats</b> (${incomingMsgsToday} msgs) · <b>${toddCloseRateToday}% cierre</b>`
      );
      if (adSpendToday > 0) {
        lines.push(
          `• Pauta hoy: <b>${fmtMoney(adSpendToday)}</b>${
            roasToday !== null ? ` · ROAS: <b>${roasToday.toFixed(2)}x</b>` : ''
          }`
        );
      } else {
        lines.push(`• Pauta hoy: sin gasto registrado aún`);
      }
      if (ventasHoyOrders.length > 0) {
        const margenTag =
          netMarginTodayPct !== null ? ` (${netMarginTodayPct.toFixed(1)}% margen)` : '';
        lines.push(
          `• Costo prod. (COGS): ${fmtMoney(cogsHoyTotal)} → Utilidad est.: <b>${fmtMoney(
            netProfitToday
          )}</b>${margenTag}`
        );
        if (ordersHoySinCosto > 0) {
          lines.push(
            `  <i>(${ordersHoySinCosto} ped. hoy sin costo unitario cargado en Inventario)</i>`
          );
        }
      }
      if (topProductToday) {
        lines.push(
          `• Producto líder hoy: <b>${escapeHtml(topProductToday[0])}</b> (${topProductToday[1].orders} ped. · ${fmtMoney(
            topProductToday[1].revenue
          )})`
        );
      }
      if (topAdToday) {
        lines.push(
          `• Top anuncio hoy: <b>${escapeHtml(topAdToday[0])}</b> (${topAdToday[1].chats} chats · ${topAdToday[1].orders} ped.)`
        );
      }

      lines.push('');
      lines.push(`💰 <b>FINANZAS Y COBROS</b>`);
      lines.push(
        `• Acumulado del mes: <b>${fmtMoney(ventasMesMonto)}</b> (${ventasMesOrders.length} ped.)${
          roasMonth !== null ? ` · ROAS mes: <b>${roasMonth.toFixed(2)}x</b>` : ''
        }`
      );
      lines.push(
        `• Por liquidar (entregados): <b>${fmtMoney(totalPorLiquidar)}</b> (${porLiquidar.length} guías)`
      );
      if (enRuta.length > 0) {
        lines.push(`• En ruta por cobrar: <b>${fmtMoney(totalEnRuta)}</b> (${enRuta.length} guías)`);
      }
      if (accountsRows.length > 0) {
        if (liquidityInfo.hasNegativeCard && liquidityInfo.cashAndBankTotal !== liquidityInfo.netTotal) {
          lines.push(
            `• Liquidez neta en cuentas: <b>${fmtMoney(totalLiquidity)}</b> (Cajas/Bancos: <b>${fmtMoney(liquidityInfo.cashAndBankTotal)}</b>)`
          );
        } else {
          lines.push(`• Liquidez en cuentas: <b>${fmtMoney(totalLiquidity)}</b>`);
        }
        if (liquidityInfo.compactBreakdown) {
          lines.push(`  <i>(${escapeHtml(liquidityInfo.compactBreakdown)})</i>`);
        }
      }
      if (otherExpensesToday > 0) {
        lines.push(`• Otros gastos hoy: ${fmtMoney(otherExpensesToday)}`);
      }
      lines.push(
        `• Valor total real: <b>${fmtMoney(finHealth.valorTotalReal)}</b> <i>(Caja ${fmtMoney(finHealth.liquidezNeta)} + Stock ${fmtMoney(finHealth.inventarioCosto)} + Entr. ${fmtMoney(finHealth.entregadosSinLiquidar)})</i>`
      );
      lines.push(
        `• Salud financiera: <b>${healthEmoji} ${finHealth.score}/100 (${finHealth.estado})</b> · Oxígeno: <b>${runwayText}</b> · Margen op.: <b>${finHealth.margenOperativoPct.toFixed(1)}%</b>`
      );
      if (finHealth.simulation && finHealth.simulation.mejoraPuntos > 0) {
        lines.push(
          `  <i>↳ Liquidar ${fmtMoney(finHealth.simulation.montoPorLiquidar)} sube salud a ${finHealth.simulation.nuevoScore}/100 (${finHealth.simulation.nuevoEstado})</i>`
        );
      }
      if (pagosUrgentes.length > 0) {
        const pagosTxt = pagosUrgentes
          .slice(0, 3)
          .map((p: any) => {
            const when =
              p.diff < 0 ? 'vencido' : p.diff === 0 ? 'HOY' : `en ${p.diff}d`;
            return `${escapeHtml(p.nombre)} (${fmtMoney(Number(p.monto) || 0)} · ${when})`;
          })
          .join(', ');
        lines.push(`• ⚠️ Pagos próximos: ${pagosTxt}`);
      }

      lines.push('');
      lines.push(`🏭 <b>ALERTAS DE INVENTARIO</b>`);
      if (outOfStock.length === 0 && lowStock.length === 0) {
        lines.push(`• Stock saludable: sin quiebres ni mínimos críticos ✅`);
      } else {
        if (outOfStock.length > 0) {
          const names = outOfStock
            .slice(0, 4)
            .map((i: any) => escapeHtml(i.nombre || i.sku))
            .join(', ');
          lines.push(
            `• Sin stock (${outOfStock.length}): ${names}${
              outOfStock.length > 4 ? ` y ${outOfStock.length - 4} más` : ''
            }${allowBackorderGlobal ? ' <i>(bajo pedido ON)</i>' : ''}`
          );
        }
        if (lowStock.length > 0) {
          const names = lowStock
            .slice(0, 4)
            .map((i: any) => `${escapeHtml(i.nombre || i.sku)} (${Number(i.stock_disponible || 0)})`)
            .join(', ');
          lines.push(
            `• Stock bajo (${lowStock.length}): ${names}${
              lowStock.length > 4 ? ` y ${lowStock.length - 4} más` : ''
            }`
          );
        }
      }

      if (radarBriefAlerts.length > 0) {
        lines.push('');
        lines.push(`📡 <b>RADAR PREDICTIVO</b> <i>(/radar)</i>`);
        for (const alertLine of radarBriefAlerts.slice(0, 3)) {
          lines.push(alertLine);
        }
      }

      lines.push('');
      lines.push(
        `🔗 <a href="${panelOrigin}/rentabilidad">Rentabilidad</a> · <a href="${panelOrigin}/finanzas">Finanzas</a> · <a href="${panelOrigin}/inventario">Inventario</a> · <a href="${panelOrigin}/pagos">Pagos</a>`
      );
    } else {
      // FULL BRIEF (compatibilidad si se consulta sin ?type=)
      lines.push(`☀️ <b>BRIEF COMPLETO — TODOENUNO OS</b>`);
      lines.push(`📅 <i>${escapeHtml(dateInfo.formattedDate)}</i>`);

      if (activeHolidayNotice) {
        lines.push('');
        lines.push(`⚠️ <b>Aviso temporal activo en Bot Todd:</b>`);
        lines.push(`<i>"${escapeHtml(activeHolidayNotice.slice(0, 140))}"</i>`);
      }

      lines.push('');
      lines.push(`📦 <b>DESPACHO Y LOGÍSTICA HOY</b>`);
      lines.push(`• Por despachar: <b>${porDespachar.length} pedidos</b> (${fmtMoney(totalPorDespachar)})`);
      if (indicacionesPostCierreCount > 0) {
        lines.push(`• Con indicación especial del cliente: <b>${indicacionesPostCierreCount}</b>`);
      }
      if (encargosUrgentes.length > 0) {
        const encPreview = encargosUrgentes
          .slice(0, 2)
          .map(e => {
            const tag = e.diff !== null && e.diff < 0 ? 'atrasado' : e.diff === 0 ? 'hoy' : 'próximo';
            return `${escapeHtml(e.nombre_cliente || 'Cliente')} (${tag})`;
          })
          .join(', ');
        lines.push(`• Encargos urgentes: <b>${encargosUrgentes.length}</b> — ${encPreview}`);
      }
      lines.push(
        `• En ruta ahora: <b>${enRuta.length} guías</b> (${fmtMoney(totalEnRuta)})${
          enRutaRezagados.length > 0 ? ` · ⚠️ <b>${enRutaRezagados.length} con +${staleRouteHours}h</b>` : ''
        }`
      );

      lines.push('');
      lines.push(`💬 <b>WHATSAPP &amp; BOT TODD</b>`);
      if (sinResponderConvs.length > 0) {
        lines.push(
          `• Pendientes ahora: <b>${sinResponderConvs.length} sin responder</b>${
            sinResponderHumanos > 0 ? ` (${sinResponderHumanos} en Modo Humano)` : ''
          }`
        );
      } else {
        lines.push(`• Pendientes ahora: bandeja al día ✅`);
      }
      lines.push(
        `• Hoy: <b>${ventasHoyOrders.length} ped.</b> (${fmtMoney(ventasHoyMonto)}) | Ayer: <b>${ventasAyerOrders.length} ped.</b> (${toddCloseRateYesterday}% cierre)`
      );
      if (topConsultedProducts.length > 0) {
        lines.push(
          `• Más cotizados: ${topConsultedProducts
            .map(([name, cnt]) => `${escapeHtml(name)} (${cnt})`)
            .join(', ')}`
        );
      }
      if (topAdYesterday) {
        lines.push(
          `• Top anuncio ayer: <b>${escapeHtml(topAdYesterday[0])}</b> (${topAdYesterday[1].chats} chats · ${topAdYesterday[1].orders} ped.)`
        );
      }

      lines.push('');
      lines.push(`💰 <b>FINANZAS, RENTABILIDAD Y COBROS</b>`);
      lines.push(
        `• Mes: <b>${fmtMoney(ventasMesMonto)}</b> (${ventasMesOrders.length} ped.)${
          roasMonth !== null ? ` · ROAS mes: <b>${roasMonth.toFixed(2)}x</b>` : ''
        }`
      );
      if (adSpendYesterday > 0) {
        lines.push(
          `• Pauta ayer: ${fmtMoney(adSpendYesterday)}${
            roasYesterday !== null ? ` · ROAS ayer: <b>${roasYesterday.toFixed(2)}x</b>` : ''
          }`
        );
      }
      lines.push(
        `• Por liquidar: <b>${fmtMoney(totalPorLiquidar)}</b> (${porLiquidar.length} guías)${
          enRuta.length > 0 ? ` · En ruta: ${fmtMoney(totalEnRuta)} (${enRuta.length})` : ''
        }`
      );
      if (accountsRows.length > 0) {
        if (liquidityInfo.hasNegativeCard && liquidityInfo.cashAndBankTotal !== liquidityInfo.netTotal) {
          lines.push(
            `• Liquidez neta en cuentas: <b>${fmtMoney(totalLiquidity)}</b> (Cajas/Bancos: <b>${fmtMoney(liquidityInfo.cashAndBankTotal)}</b>)`
          );
        } else {
          lines.push(`• Liquidez en cuentas: <b>${fmtMoney(totalLiquidity)}</b>`);
        }
        if (liquidityInfo.compactBreakdown) {
          lines.push(`  <i>(${escapeHtml(liquidityInfo.compactBreakdown)})</i>`);
        }
      }
      lines.push(
        `• Valor total real: <b>${fmtMoney(finHealth.valorTotalReal)}</b> <i>(Caja ${fmtMoney(finHealth.liquidezNeta)} + Stock ${fmtMoney(finHealth.inventarioCosto)} + Entr. ${fmtMoney(finHealth.entregadosSinLiquidar)})</i>`
      );
      lines.push(
        `• Salud financiera: <b>${healthEmoji} ${finHealth.score}/100 (${finHealth.estado})</b> · Oxígeno: <b>${runwayText}</b> · Margen op.: <b>${finHealth.margenOperativoPct.toFixed(1)}%</b>`
      );
      if (finHealth.simulation && finHealth.simulation.mejoraPuntos > 0) {
        lines.push(
          `  <i>↳ Liquidar ${fmtMoney(finHealth.simulation.montoPorLiquidar)} sube salud a ${finHealth.simulation.nuevoScore}/100 (${finHealth.simulation.nuevoEstado})</i>`
        );
      }
      if (pagosUrgentes.length > 0) {
        const pagosTxt = pagosUrgentes
          .slice(0, 3)
          .map((p: any) => {
            const when =
              p.diff < 0 ? 'vencido' : p.diff === 0 ? 'HOY' : `en ${p.diff}d`;
            return `${escapeHtml(p.nombre)} (${fmtMoney(Number(p.monto) || 0)} · ${when})`;
          })
          .join(', ');
        lines.push(`• ⚠️ Pagos próximos: ${pagosTxt}`);
      }

      if (outOfStock.length > 0 || lowStock.length > 0) {
        lines.push('');
        lines.push(`🏭 <b>ALERTAS DE INVENTARIO</b>`);
        if (outOfStock.length > 0) {
          const names = outOfStock
            .slice(0, 4)
            .map((i: any) => escapeHtml(i.nombre || i.sku))
            .join(', ');
          lines.push(
            `• Sin stock (${outOfStock.length}): ${names}${
              outOfStock.length > 4 ? ` y ${outOfStock.length - 4} más` : ''
            }${allowBackorderGlobal ? ' <i>(bajo pedido ON)</i>' : ''}`
          );
        }
        if (lowStock.length > 0) {
          const names = lowStock
            .slice(0, 4)
            .map((i: any) => `${escapeHtml(i.nombre || i.sku)} (${Number(i.stock_disponible || 0)})`)
            .join(', ');
          lines.push(
            `• Stock bajo (${lowStock.length}): ${names}${
              lowStock.length > 4 ? ` y ${lowStock.length - 4} más` : ''
            }`
          );
        }
      }

      if (notasRows.length > 0) {
        lines.push('');
        lines.push(`📝 <b>NOTAS PENDIENTES (HOY)</b>`);
        for (const n of notasRows.slice(0, 3)) {
          lines.push(`• ${escapeHtml(String(n.contenido || '').slice(0, 110))}`);
        }
      }

      if (radarBriefAlerts.length > 0) {
        lines.push('');
        lines.push(`📡 <b>RADAR PREDICTIVO</b> <i>(/radar)</i>`);
        for (const alertLine of radarBriefAlerts.slice(0, 3)) {
          lines.push(alertLine);
        }
      }

      lines.push('');
      lines.push(
        `🔗 <a href="${panelOrigin}/">Hoy</a> · <a href="${panelOrigin}/unichat">UniChat</a> · <a href="${panelOrigin}/pedidos">Pedidos</a> · <a href="${panelOrigin}/rentabilidad">Rentabilidad</a>`
      );
    }

    // Bloque unificado de Memoria OS & Aprendizaje IA (7D vs previos)
    const aiPatternTip = await generateBriefAiSynthesis({
      briefType,
      svTodayIso: dateInfo.svTodayIso,
      memory: osMemory,
      ventasHoyMonto,
      ventasHoyCount: ventasHoyOrders.length,
      porDespacharCount: porDespachar.length,
      enRutaCount: enRuta.length,
      sinResponderCount: sinResponderConvs.length,
      outOfStockCount: outOfStock.length,
    });

    if (osMemory.eventsLoaded > 0 || osMemory.daysLoaded > 0) {
      const insertAt = Math.max(lines.length - 2, 0);
      const pctOrders =
        osMemory.ordersPrev7d > 0
          ? Math.round(((osMemory.orders7d - osMemory.ordersPrev7d) / osMemory.ordersPrev7d) * 100)
          : null;
      const deltaBadge =
        pctOrders !== null
          ? `${pctOrders >= 0 ? '📈 +' : '📉 '}${pctOrders}% vs 7d ant.`
          : `${osMemory.delivered7d} entr.`;
      const memLines: string[] = [
        '',
        `🧠 <b>MEMORIA OS &amp; PATRONES (7D)</b>`,
        `• Pulso 7d: <b>${osMemory.orders7d} ped.</b> (${deltaBadge})`,
        `• Cobro vs Pauta: <b>${fmtMoney(osMemory.revenue7d)}</b> cobrado${
          osMemory.adSpend7d > 0 ? ` · ${fmtMoney(osMemory.adSpend7d)} pauta` : ''
        }${osMemory.roas7d !== null ? ` · ROAS <b>${osMemory.roas7d.toFixed(2)}x</b>` : ''}${
          osMemory.cancelRate7d !== null ? ` · Canc. ${osMemory.cancelRate7d}%` : ''
        }`,
      ];
      if (osMemory.topInquiredNoClose.length > 0) {
        const g = osMemory.topInquiredNoClose[0];
        memLines.push(
          `• 🎯 Brecha Bot: <code>${escapeHtml(g.sku)}</code> (${g.inquiries} consultas → ${g.orders} cierres)`
        );
      }
      if (aiPatternTip) {
        memLines.push(`<blockquote>💡 <b>Lectura IA:</b> ${escapeHtml(aiPatternTip)}</blockquote>`);
      } else if (osMemory.deterministicInsight) {
        memLines.push(`<blockquote>📌 ${escapeHtml(osMemory.deterministicInsight)}</blockquote>`);
      }
      lines.splice(insertAt, 0, ...memLines);
    }

    const mensaje = lines.join('\n');

    await emitBestEffortOsEvent(
      supabase,
      'ai.brief.generated',
      'panel_brief',
      `${briefType}:${dateInfo.svTodayIso}:${dateInfo.svHour}`,
      {
        brief_type: briefType,
        fecha: dateInfo.svTodayIso,
        ventas_hoy: ventasHoyMonto,
        pedidos_hoy: ventasHoyOrders.length,
        por_despachar: porDespachar.length,
        en_ruta: enRuta.length,
        sin_responder: sinResponderConvs.length,
        orders_7d: osMemory.orders7d,
        revenue_7d: osMemory.revenue7d,
        roas_7d: osMemory.roas7d,
        ai_insight: aiPatternTip || osMemory.deterministicInsight || null,
      },
      `ai_brief:${briefType}:${dateInfo.svTodayIso}:${dateInfo.svHour}`
    );

    return res.status(200).json({
      ok: true,
      type: briefType,
      fecha: dateInfo.svTodayIso,
      parse_mode: 'HTML',
      mensaje,
      metrics: {
        porDespacharCount: porDespachar.length,
        porDespacharTotal: totalPorDespachar,
        encargosUrgentesCount: encargosUrgentes.length,
        enRutaCount: enRuta.length,
        enRutaRezagadosCount: enRutaRezagados.length,
        sinResponderCount: sinResponderConvs.length,
        sinResponderHumanos,
        chatsHoyCount,
        ventasHoyCount: ventasHoyOrders.length,
        ventasHoyMonto,
        cogsHoyTotal,
        adSpendToday,
        roasToday,
        netProfitToday,
        chatsAyerCount,
        ventasAyerCount: ventasAyerOrders.length,
        ventasAyerMonto,
        ventasMesCount: ventasMesOrders.length,
        ventasMesMonto,
        adSpendMonth,
        roasMonth,
        porLiquidarCount: porLiquidar.length,
        porLiquidarTotal: totalPorLiquidar,
        outOfStockCount: outOfStock.length,
        lowStockCount: lowStock.length,
        pagosUrgentesCount: pagosUrgentes.length,
      },
    });
  } catch (err: any) {
    console.error('Error en /api/morning-brief:', err);
    return res.status(500).json({
      error: 'Error generando Brief',
      details: err?.message || 'Error desconocido',
    });
  }
}

// ============================================================================
// TELEGRAM BOT HANDLER (INLINED TO AVOID ESM RELATIVE IMPORTS ON VERCEL)
// ============================================================================

const TIME_ZONE = 'America/El_Salvador';
const DRAFTS_DOC_TITLE = '__SYSTEM_TELEGRAM_PURCHASE_DRAFTS_V1__';
const DEFAULT_ALLOWED_CHAT_ID = '9087238722';

interface TelegramCatalogVariant {
  variante_id: number;
  template_id: number;
  sku: string;
  color: string;
  talla: string;
  stock: number;
  precio: number;
  estado: string;
}

interface DraftItem {
  sku: string; // Siempre el SKU padre en inventory_stock
  nombre: string;
  cantidad: number;
  costo_unitario: number;
  subtotal: number;
  variante_id?: number;
  variant_sku?: string;
  color?: string;
  talla?: string;
}

type TelegramDraft =
  | {
      id: string;
      kind?: 'compra';
      chatId: string;
      status: 'pending' | 'confirmed' | 'cancelled';
      createdAt: string;
      proveedor: string;
      notas: string;
      account_id: string;
      account_nombre: string;
      asentar_en_finanzas_sugerido: boolean;
      items: DraftItem[];
      total: number;
      unmatchedNotes?: string[];
      rawInput?: string;
    }
  | {
      id: string;
      kind: 'gasto_operativo';
      chatId: string;
      status: 'pending' | 'confirmed' | 'cancelled';
      createdAt: string;
      monto: number;
      categoria: string;
      descripcion: string;
      account_id: string;
      account_nombre: string;
      rawInput?: string;
    }
  | {
      id: string;
      kind: 'gasto_pauta';
      chatId: string;
      status: 'pending' | 'confirmed' | 'cancelled';
      createdAt: string;
      monto: number;
      codigo_anuncio: string;
      plataforma: 'Meta' | 'TikTok' | 'Google' | 'WhatsApp' | 'Otro';
      notas: string;
      account_id: string;
      account_nombre: string;
      rawInput?: string;
    }
  | {
      id: string;
      kind: 'ajuste_inventario';
      chatId: string;
      status: 'pending' | 'confirmed' | 'cancelled';
      createdAt: string;
      sku: string;
      nombre: string;
      tipo_movimiento: 'merma_dano' | 'ajuste_positivo' | 'ajuste_negativo';
      cantidad: number;
      stock_actual: number;
      stock_resultante: number;
      motivo: string;
      rawInput?: string;
    }
  | {
      id: string;
      kind: 'cambiar_estado_pedido';
      chatId: string;
      status: 'pending' | 'confirmed' | 'cancelled';
      createdAt: string;
      order_id: string;
      pedido_codigo: string;
      nombre_cliente: string;
      telefono: string;
      sku_display: string;
      total: number;
      estado_anterior: string;
      estado_nuevo: 'nuevo' | 'programado' | 'por_empacar' | 'en_camino' | 'entregado' | 'cancelado';
      motivo_cancelacion?: string;
      rawInput?: string;
    };

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Faltan credenciales de Supabase en el servidor');
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}

function getElSalvadorDate(): string {
  const now = new Date();
  const svNowStr = now.toLocaleString('en-US', { timeZone: TIME_ZONE });
  const svDate = new Date(svNowStr);
  const y = svDate.getFullYear();
  const m = String(svDate.getMonth() + 1).padStart(2, '0');
  const d = String(svDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function normalizeSku(sku: string): string {
  return String(sku || '').trim().toUpperCase();
}

function getAllowedChatIds(): string[] {
  const raw = String(process.env.TELEGRAM_ALLOWED_CHAT_IDS || DEFAULT_ALLOWED_CHAT_ID).trim();
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function getBaseUrl(req: any): string {
  const proto = String(req.headers?.['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || 'todoenuno-panel.vercel.app')
    .split(',')[0]
    .trim();
  return `${proto}://${host}`;
}

async function tgCall(method: string, payload: Record<string, any> = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN en Vercel');

  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.description || `Telegram ${method} HTTP ${res.status}`);
  }
  return json?.result;
}

function sanitizeTelegramHtml(raw: string): string {
  const allowed = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'code', 'pre', 'a', 'blockquote']);
  let s = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<(li)>/gi, '• ')
    .replace(/<(p|div|ul|ol|h[1-6])[^>]*>/gi, '')
    .replace(/<\/(ul|ol)>/gi, '\n')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/^#{1,4}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Eliminar cualquier tag HTML no soportado por Telegram
  s = s.replace(/<\/?([a-zA-Z0-9-]+)([^>]*)>/g, (full, tag) => {
    const t = String(tag).toLowerCase();
    return allowed.has(t) ? full : '';
  });
  return s;
}

async function sendTgMessage(
  chatId: string | number,
  text: string,
  extra: Record<string, any> = {}
) {
  try {
    return await tgCall('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...extra,
    });
  } catch (err: any) {
    if (String(err?.message || '').toLowerCase().includes('parse entities')) {
      const plain = String(text || '').replace(/<[^>]+>/g, '');
      return tgCall('sendMessage', {
        chat_id: chatId,
        text: plain,
        disable_web_page_preview: true,
        ...extra,
      });
    }
    throw err;
  }
}

async function readDocJson<T>(
  supabase: any,
  titulo: string,
  fallback: T
): Promise<{ id?: string; data: T }> {
  const { data } = await supabase
    .from('panel_docs')
    .select('id,contenido')
    .eq('titulo', titulo)
    .maybeSingle();

  if (data?.contenido) {
    try {
      return { id: data.id, data: JSON.parse(data.contenido) as T };
    } catch {}
  }
  return { id: data?.id, data: fallback };
}

async function writeDocJson(supabase: any, titulo: string, payload: unknown, existingId?: string) {
  const serialized = JSON.stringify(payload);
  const nowIso = new Date().toISOString();

  if (existingId) {
    await supabase
      .from('panel_docs')
      .update({
        contenido: serialized,
        categoria: 'Sistema',
        estado: 'Completado',
        updated_at: nowIso,
      })
      .eq('id', existingId);
    return;
  }

  const { data: found } = await supabase
    .from('panel_docs')
    .select('id')
    .eq('titulo', titulo)
    .maybeSingle();

  if (found?.id) {
    await supabase
      .from('panel_docs')
      .update({
        contenido: serialized,
        categoria: 'Sistema',
        estado: 'Completado',
        updated_at: nowIso,
      })
      .eq('id', found.id);
  } else {
    await supabase.from('panel_docs').insert({
      titulo,
      contenido: serialized,
      categoria: 'Sistema',
      estado: 'Completado',
      updated_at: nowIso,
    });
  }
}

async function saveDraft(supabase: any, draft: TelegramDraft) {
  const draftsDoc = await readDocJson<TelegramDraft[]>(supabase, DRAFTS_DOC_TITLE, []);
  const nextDrafts = [draft, ...(Array.isArray(draftsDoc.data) ? draftsDoc.data : [])].slice(0, 25);
  await writeDocJson(supabase, DRAFTS_DOC_TITLE, nextDrafts, draftsDoc.id);
}

const TODD_VARIANTS_MARKER = '[VARIANTES_DISPONIBLES]:';
const SYSTEM_TODD_SETTINGS_DOC_TITLE = '__SYSTEM_TODD_CATALOG_SETTINGS_V1__';

function formatVariantLabel(color?: string | null, talla?: string | null): string {
  const c = String(color || '').trim();
  const t = String(talla || '').trim();
  const parts = [
    c,
    t && t.toLowerCase() !== 'única' && t.toLowerCase() !== 'unica' && t.toLowerCase() !== 'estándar'
      ? `Talla ${t}`
      : '',
  ].filter(Boolean);
  return parts.join(' · ') || 'Estándar';
}

function normalizeVariantToken(raw?: string | null): string {
  return String(raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stemSpanishToken(word: string): string {
  let w = normalizeVariantToken(word);
  if (w.length > 4 && w.endsWith('es')) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  if (w.length >= 5 && (w.endsWith('o') || w.endsWith('a'))) w = w.slice(0, -1);
  return w;
}

async function fetchActiveStockCatalog(supabase: any) {
  const [stockRes, varRes] = await Promise.all([
    supabase
      .from('inventory_stock')
      .select(
        'sku,nombre,template_id,stock_fisico,stock_reservado,stock_disponible,costo_unitario,precio_venta,activo,todd_instrucciones,todd_keywords'
      )
      .order('nombre'),
    supabase
      .from('productos_variantes')
      .select('variante_id,template_id,sku,color,talla,stock,precio,estado')
      .order('color', { ascending: true })
      .order('talla', { ascending: true }),
  ]);

  if (stockRes.error || !Array.isArray(stockRes.data)) return [];

  const activeRows = stockRes.data.filter(
    (item: any) =>
      item.activo !== false && !String(item.sku || '').toLowerCase().includes('fee')
  );

  const allVariants: TelegramCatalogVariant[] = Array.isArray(varRes.data)
    ? varRes.data.map((v: any) => ({
        variante_id: Number(v.variante_id),
        template_id: Number(v.template_id),
        sku: normalizeSku(v.sku),
        color: String(v.color || '').trim() || 'Estándar',
        talla: String(v.talla || 'Única').trim() || 'Única',
        stock: Math.max(Number(v.stock) || 0, 0),
        precio: Number(v.precio) || 0,
        estado: String(v.estado || (Number(v.stock) > 0 ? 'DISPONIBLE' : 'NO_DISPONIBLE')),
      }))
    : [];

  const variantSkuSet = new Set(allVariants.map((v) => v.sku).filter(Boolean));
  const variantsByTemplate = new Map<string, TelegramCatalogVariant[]>();
  for (const v of allVariants) {
    if (v.estado === 'PAUSADO') continue;
    const tId = String(v.template_id || '').trim();
    if (!tId) continue;
    const arr = variantsByTemplate.get(tId) || [];
    arr.push(v);
    variantsByTemplate.set(tId, arr);
  }

  // Deduplicar filas hijas de variantes que hayan sido sembradas como filas separadas en inventory_stock
  const duplicateChildSkus = new Set<string>();
  const rowsByTemplate = new Map<string, any[]>();
  for (const row of activeRows) {
    const tId = row.template_id ? String(row.template_id).trim() : '';
    if (!tId) continue;
    const arr = rowsByTemplate.get(tId) || [];
    arr.push(row);
    rowsByTemplate.set(tId, arr);
  }

  rowsByTemplate.forEach((rows) => {
    if (rows.length <= 1) return;
    const sorted = [...rows].sort((a, b) => {
      const aVar = variantSkuSet.has(normalizeSku(a.sku)) ? 1 : 0;
      const bVar = variantSkuSet.has(normalizeSku(b.sku)) ? 1 : 0;
      if (aVar !== bVar) return aVar - bVar;
      return normalizeSku(a.sku).length - normalizeSku(b.sku).length;
    });
    const parentSku = normalizeSku(sorted[0].sku);
    for (let i = 1; i < sorted.length; i++) {
      const childSku = normalizeSku(sorted[i].sku);
      if (variantSkuSet.has(childSku) || childSku.startsWith(`${parentSku}-`)) {
        duplicateChildSkus.add(childSku);
      }
    }
  });

  const nonDupSkus = new Set(
    activeRows
      .filter((r: any) => !duplicateChildSkus.has(normalizeSku(r.sku)))
      .map((r: any) => normalizeSku(r.sku))
  );

  for (const row of activeRows) {
    const sku = normalizeSku(row.sku);
    if (!sku || duplicateChildSkus.has(sku)) continue;
    if (variantSkuSet.has(sku)) {
      for (const pSku of nonDupSkus) {
        if (pSku !== sku && sku.startsWith(`${pSku}-`)) {
          duplicateChildSkus.add(sku);
          break;
        }
      }
    }
  }

  return activeRows
    .filter((row: any) => !duplicateChildSkus.has(normalizeSku(row.sku)))
    .map((row: any) => {
      const tId = row.template_id ? String(row.template_id).trim() : '';
      const skuClean = normalizeSku(row.sku);
      const byTpl = tId ? variantsByTemplate.get(tId) || [] : [];
      const variants =
        byTpl.length > 0
          ? byTpl
          : allVariants.filter(
              (v) => v.estado !== 'PAUSADO' && v.sku.startsWith(`${skuClean}-`)
            );
      return {
        ...row,
        sku: skuClean,
        variants,
      };
    });
}

async function fetchCashAccounts(
  supabase: any,
  options: { allowFallbackMock?: boolean } = {}
) {
  const { allowFallbackMock = true } = options;
  try {
    const res = await supabase
      .from('finance_cash_accounts')
      .select('id,nombre,tipo,saldo_actual,activo')
      .order('nombre');
    if (!res.error && Array.isArray(res.data) && res.data.length > 0) {
      return res.data.filter((a: any) => a.activo !== false);
    }

    const schemaRes = await supabase
      .schema('finance')
      .from('cash_accounts')
      .select('id,nombre,tipo,saldo_actual,activo')
      .order('nombre');
    if (!schemaRes.error && Array.isArray(schemaRes.data) && schemaRes.data.length > 0) {
      return schemaRes.data.filter((a: any) => a.activo !== false);
    }
  } catch {}

  if (!allowFallbackMock) return [];

  return [
    { id: 'caja_chica', nombre: 'Caja Chica / Efectivo Bodega', tipo: 'cash', saldo_actual: 0, activo: true },
    { id: 'banco_principal', nombre: 'Banco Principal', tipo: 'bank', saldo_actual: 0, activo: true },
  ];
}

function summarizeCashAccounts(accounts: any[]) {
  const active = (Array.isArray(accounts) ? accounts : []).filter((a: any) => a.activo !== false);
  const netTotal = Math.round(
    active.reduce((s: number, a: any) => s + (Number(a.saldo_actual) || 0), 0) * 100
  ) / 100;

  const isNegativeCard = (a: any) =>
    (String(a.tipo || '') === 'credit_card' || String(a.id || '') === 'tarjeta_pauta') &&
    Number(a.saldo_actual || 0) < 0;

  const hasNegativeCard = active.some(isNegativeCard);
  const cashAndBankTotal =
    Math.round(
      active
        .filter((a: any) => !isNegativeCard(a))
        .reduce((s: number, a: any) => s + (Number(a.saldo_actual) || 0), 0) * 100
    ) / 100;

  const shortAccountLabel = (a: any): string => {
    const id = String(a.id || '');
    if (id === 'banco_principal') return 'Banco';
    if (id === 'caja_efectivo') return 'Efectivo Repart.';
    if (id === 'caja_chica') return 'Caja Chica';
    if (id === 'tarjeta_pauta') return 'Tarjeta Pauta';
    return String(a.nombre || id || 'Cuenta').split('(')[0].trim().slice(0, 22);
  };

  const compactBreakdown = active
    .map((a: any) => `${shortAccountLabel(a)} ${fmtMoney(Number(a.saldo_actual) || 0)}`)
    .join(' · ');

  return {
    netTotal,
    cashAndBankTotal,
    hasNegativeCard,
    compactBreakdown,
  };
}

function findBestVariantMatch(parentItem: any, rawQuery?: string | null): TelegramCatalogVariant | null {
  const variants: TelegramCatalogVariant[] = Array.isArray(parentItem?.variants)
    ? parentItem.variants
    : [];
  const qRaw = String(rawQuery || '').trim();
  if (!qRaw || variants.length === 0) return null;

  const qSku = normalizeSku(qRaw);
  const bySku = variants.find((v) => normalizeSku(v.sku) === qSku);
  if (bySku) return bySku;

  const qNorm = normalizeVariantToken(qRaw);
  if (!qNorm) return null;

  // Coincidencia exacta de color o "color talla"
  const exactLabel = variants.find((v) => {
    const cNorm = normalizeVariantToken(v.color);
    const tNorm = normalizeVariantToken(v.talla);
    const combined = [cNorm, tNorm !== 'unica' ? tNorm : ''].filter(Boolean).join(' ');
    return cNorm === qNorm || combined === qNorm;
  });
  if (exactLabel) return exactLabel;

  // Coincidencia por tokens con tolerancia de género/plural en español (ej. rosados -> Rosado)
  const qTokens = qNorm
    .split(/\s+/)
    .map((w) => stemSpanishToken(w))
    .filter((w) => w.length >= 2 && w !== 'talla' && w !== 'color');

  if (qTokens.length === 0) return null;

  let best: { variant: TelegramCatalogVariant; score: number } | null = null;
  for (const v of variants) {
    const cStem = stemSpanishToken(v.color);
    const tNorm = normalizeVariantToken(v.talla);
    const tStem = tNorm && tNorm !== 'unica' ? stemSpanishToken(tNorm) : '';
    let score = 0;

    for (const qt of qTokens) {
      if (cStem && (cStem === qt || (qt.length >= 4 && cStem.startsWith(qt)) || (cStem.length >= 4 && qt.startsWith(cStem)))) {
        score += 3;
      }
      if (tStem && (tStem === qt || tNorm === qt)) {
        score += 2;
      }
    }

    if (score > 0 && (!best || score > best.score)) {
      best = { variant: v, score };
    }
  }

  return best ? best.variant : null;
}

function findBestSkuMatch(rawQuery: string, catalog: any[]) {
  const clean = normalizeSku(rawQuery);
  if (!clean) return null;

  const exact = catalog.find((item) => normalizeSku(item.sku) === clean);
  if (exact) return exact;

  // Buscar coincidencia exacta por SKU de variante (ej. ASIS-BB-01-ROSADO)
  const byExactVarSku = catalog.find(
    (item) =>
      Array.isArray(item.variants) &&
      item.variants.some((v: TelegramCatalogVariant) => normalizeSku(v.sku) === clean)
  );
  if (byExactVarSku) return byExactVarSku;

  const lower = rawQuery.trim().toLowerCase();
  const byExactName = catalog.find(
    (item) => String(item.nombre || '').trim().toLowerCase() === lower
  );
  if (byExactName) return byExactName;

  const byPartial = catalog.find(
    (item) =>
      normalizeSku(item.sku).includes(clean) ||
      String(item.nombre || '').toLowerCase().includes(lower)
  );
  return byPartial || null;
}

function findParentAndVariantByQuery(
  rawQuery: string,
  catalog: any[]
): { parent: any | null; variant: TelegramCatalogVariant | null } {
  const clean = normalizeSku(rawQuery);
  if (!clean) return { parent: null, variant: null };

  // 1. SKU padre exacto
  const exactParent = catalog.find((item) => normalizeSku(item.sku) === clean);
  if (exactParent) return { parent: exactParent, variant: null };

  // 2. SKU de variante exacto (prioritario antes de partial match en padre)
  for (const item of catalog) {
    const vars: TelegramCatalogVariant[] = Array.isArray(item.variants) ? item.variants : [];
    const exactVar = vars.find((v) => normalizeSku(v.sku) === clean);
    if (exactVar) return { parent: item, variant: exactVar };
  }

  // 3. Coincidencia por nombre o parcial en padre
  const parent = findBestSkuMatch(rawQuery, catalog);
  if (parent) return { parent, variant: null };

  // 4. Coincidencia parcial en SKU de variante
  for (const item of catalog) {
    const vars: TelegramCatalogVariant[] = Array.isArray(item.variants) ? item.variants : [];
    const partialVar = vars.find((v) => normalizeSku(v.sku).includes(clean));
    if (partialVar) return { parent: item, variant: partialVar };
  }

  return { parent: null, variant: null };
}

function stripVariantToddBlockServer(rawText?: string | null): string {
  const raw = String(rawText || '').trim();
  const idx = raw.indexOf(TODD_VARIANTS_MARKER);
  if (idx === -1) return raw;
  return raw.slice(0, idx).trim();
}

async function applyVariantPurchaseAndSyncServer(
  supabase: any,
  params: {
    parentSku: string;
    varianteId: number;
    addQty: number;
  }
): Promise<{ ok: boolean; nuevoStockVariante?: number; templateId?: number }> {
  try {
    const { data: varRow, error: readErr } = await supabase
      .from('productos_variantes')
      .select('variante_id,template_id,sku,color,talla,stock,precio,estado,image_url')
      .eq('variante_id', params.varianteId)
      .maybeSingle();

    if (readErr || !varRow) {
      return { ok: false };
    }

    const nextStock = Math.max(Number(varRow.stock || 0) + Math.round(params.addQty), 0);
    const nextEstado = nextStock > 0 ? 'DISPONIBLE' : 'NO_DISPONIBLE';
    const nowIso = new Date().toISOString();

    await supabase
      .from('productos_variantes')
      .update({ stock: nextStock, estado: nextEstado, updated_at: nowIso })
      .eq('variante_id', varRow.variante_id);

    if (varRow.sku) {
      try {
        await supabase
          .from('inventory_cache')
          .upsert(
            {
              sku: normalizeSku(varRow.sku),
              qty: nextStock,
              state: nextEstado,
              image_url: varRow.image_url || null,
              updated_at: nowIso,
            },
            { onConflict: 'sku' }
          );
      } catch {}
    }

    return {
      ok: true,
      nuevoStockVariante: nextStock,
      templateId: Number(varRow.template_id) || undefined,
    };
  } catch {
    return { ok: false };
  }
}

async function resyncParentToddVariantsServer(
  supabase: any,
  params: { parentSku: string; templateId: number }
) {
  try {
    const masterSku = normalizeSku(params.parentSku);
    const [varRes, stockRes, settingsDoc] = await Promise.all([
      supabase
        .from('productos_variantes')
        .select('variante_id,template_id,sku,color,talla,stock,precio,estado')
        .eq('template_id', params.templateId)
        .order('color', { ascending: true })
        .order('talla', { ascending: true }),
      supabase
        .from('inventory_stock')
        .select('todd_instrucciones,todd_keywords,precio_venta')
        .eq('sku', masterSku)
        .maybeSingle(),
      readDocJson<{
        allowBackorderGlobal?: boolean;
        backorderSkus?: string[];
        hideExactStockCounts?: boolean;
      }>(supabase, SYSTEM_TODD_SETTINGS_DOC_TITLE, {}),
    ]);

    const variants = (Array.isArray(varRes.data) ? varRes.data : []).filter(
      (v: any) => String(v.estado || '') !== 'PAUSADO'
    );
    if (variants.length === 0) return;

    const cfg = settingsDoc.data || {};
    const backorderSet = new Set(
      (Array.isArray(cfg.backorderSkus) ? cfg.backorderSkus : []).map((s) => normalizeSku(s))
    );
    const allowBackorder = Boolean(cfg.allowBackorderGlobal) || backorderSet.has(masterSku);
    const hideCounts = cfg.hideExactStockCounts !== false;
    const basePrice = Number(stockRes.data?.precio_venta || 0);

    const kwSet = new Set<string>();
    const bulletLines = variants.map((v: any) => {
      const colorTxt = String(v.color || '').trim();
      const tallaTxt = String(v.talla || '').trim();
      if (colorTxt) kwSet.add(colorTxt.toLowerCase());
      if (tallaTxt && tallaTxt.toLowerCase() !== 'única' && tallaTxt.toLowerCase() !== 'unica') {
        kwSet.add(`talla ${tallaTxt.toLowerCase()}`);
      }
      const label = formatVariantLabel(colorTxt, tallaTxt);
      const qty = Math.max(Number(v.stock) || 0, 0);
      const price = Number(v.precio) > 0 ? Number(v.precio) : basePrice;
      const priceTag = price > 0 ? ` ($${price.toFixed(2)})` : '';
      const isAvailable = qty > 0 || allowBackorder;
      if (!isAvailable) return `${label}: Agotado`;
      return hideCounts ? `${label}: Disponible${priceTag}` : `${label}: ${qty} uds${priceTag}`;
    });

    const summaryBlock = `${TODD_VARIANTS_MARKER} ${bulletLines.join(' | ')}`;
    const baseInstr = stripVariantToddBlockServer(stockRes.data?.todd_instrucciones);
    const nextInstrucciones = baseInstr ? `${baseInstr}\n${summaryBlock}` : summaryBlock;

    const existingKw = String(stockRes.data?.todd_keywords || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const existingKwLower = new Set(existingKw.map((k) => k.toLowerCase()));
    kwSet.forEach((kw) => {
      if (!existingKwLower.has(kw.toLowerCase())) {
        existingKw.push(kw);
        existingKwLower.add(kw.toLowerCase());
      }
    });
    const nextKeywords = existingKw.join(', ');

    await supabase
      .from('inventory_stock')
      .update({
        todd_instrucciones: nextInstrucciones,
        todd_keywords: nextKeywords,
        updated_at: new Date().toISOString(),
      })
      .eq('sku', masterSku);

    try {
      await supabase
        .from('productos')
        .update({
          todd_instrucciones: nextInstrucciones,
          todd_keywords: nextKeywords,
        })
        .eq('template_id', params.templateId);
    } catch {}
  } catch {
    // Best effort: nunca bloquear flujo principal de Telegram
  }
}

async function downloadTelegramPhotoAsDataUrl(fileId: string): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN en Vercel');

  const fileInfo = await tgCall('getFile', { file_id: fileId });
  const filePath = String(fileInfo?.file_path || '');
  if (!filePath) throw new Error('Telegram no devolvió ruta de imagen');

  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) {
    throw new Error(`No se pudo descargar la foto desde Telegram (${fileRes.status})`);
  }

  const arrayBuf = await fileRes.arrayBuffer();
  const bytes = Buffer.from(arrayBuf);
  const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function transcribeTelegramAudio(
  fileId: string,
  mimeType = 'audio/ogg',
  fileName?: string
): Promise<string> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN en Vercel');
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY en Vercel para transcribir audio');

  const fileInfo = await tgCall('getFile', { file_id: fileId });
  const filePath = String(fileInfo?.file_path || '');
  if (!filePath) throw new Error('Telegram no devolvió ruta del audio');

  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) {
    throw new Error(`No se pudo descargar el audio desde Telegram (${fileRes.status})`);
  }

  const arrayBuf = await fileRes.arrayBuffer();
  const extFromPath = filePath.split('.').pop()?.toLowerCase();
  const safeExt =
    extFromPath === 'oga' || extFromPath === 'ogg'
      ? 'ogg'
      : extFromPath || 'ogg';
  const safeName = fileName || `voice.${safeExt}`;
  const blob = new Blob([arrayBuf], { type: mimeType || 'audio/ogg' });

  const formData = new FormData();
  formData.append('file', blob, safeName);
  formData.append('model', 'whisper-1');
  formData.append('language', 'es');

  const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
  const whisperJson = await whisperRes.json().catch(() => ({}));
  if (!whisperRes.ok) {
    throw new Error(whisperJson?.error?.message || `Whisper HTTP ${whisperRes.status}`);
  }
  return String(whisperJson?.text || '').trim();
}

async function interpretWithOpenAI(params: {
  text: string;
  imageDataUrl?: string | null;
  catalog: any[];
  accounts: any[];
  intentHint?: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY en las variables de entorno de Vercel.');
  }

  const catalogLines = params.catalog
    .slice(0, 120)
    .map((i: any) => {
      const vars: TelegramCatalogVariant[] = Array.isArray(i.variants) ? i.variants : [];
      const varStr =
        vars.length > 0
          ? ` | Variantes: [${vars
              .map(
                (v) =>
                  `${formatVariantLabel(v.color, v.talla)} (${Number(v.stock || 0)}u, SKU:${v.sku})`
              )
              .join('; ')}]`
          : '';
      return `- SKU: ${i.sku} | Nombre: ${i.nombre} | Costo: $${Number(i.costo_unitario || 0).toFixed(2)} | Físico: ${Number(i.stock_fisico || 0)} | Disp: ${Number(i.stock_disponible || 0)}${varStr}`;
    })
    .join('\n');

  const accountLines = params.accounts
    .map(
      (a: any) =>
        `- id: ${a.id} | Nombre: ${a.nombre} (${a.tipo}) | Saldo: $${Number(a.saldo_actual || 0).toFixed(2)}`
    )
    .join('\n');

  const systemPrompt = `Eres el asistente operativo integral de TODOENUNO OS en El Salvador (compras, gastos, pauta, pedidos COD e inventario).
Analizas texto, transcripciones de notas de voz o fotos de recibos/facturas enviados por Telegram.

CATÁLOGO ACTIVO DE INVENTARIO (usa EXACTAMENTE el SKU del catálogo cuando corresponda):
${catalogLines || '(Sin productos registrados)'}

CUENTAS DE DINERO / CAJAS EN FINANZAS:
${accountLines}

REGLAS ESTRICTAS:
1. Clasifica "intent" en UNA de estas opciones:
   - "compra": compra de mercadería/inventario o ingreso de unidades para reventa (factura de proveedor, "compré X unidades de producto Y").
   - "gasto_pauta": pago/inversión en publicidad o anuncios ("pagué $30 de pauta", "metí $25 a Meta Ads en PROMO1", "anuncio CASCO").
   - "gasto_operativo": gasto del negocio que NO es compra de mercadería para reventa ni pauta ("pagué $20 de gasolina", "bolsas de empaque", "almuerzo", "flete", "internet", "sueldo").
   - "ajuste_inventario": daño, merma, pérdida, muestra regalada o corrección por conteo físico ("se dañaron 2 cascos", "merma 1 unidad", "en bodega solo quedan 8 cascos").
   - "consulta_pedido": busca un pedido por nombre de cliente, teléfono, código o estado ("¿cómo va el pedido de Tatiana?", "busca el 70231940").
   - "cambiar_estado_pedido": el usuario ordena cambiar el estado de un pedido existente ("pasa a entregado el pedido de María", "marca en camino el 70231940", "cancela el pedido de Carlos", "pasa a por empacar el pedido #8831").
   - "consulta_pendientes": pregunta qué hay pendiente por empacar, en ruta, encargos o por liquidar.
   - "consulta_stock": pregunta cuánto stock hay de uno o más productos.
   - "consulta_brief": pide el brief / resumen de ventas del día.
   - "consulta_salud_financiera": pide específicamente el estado de salud financiera, puntaje financiero, valor total real del negocio, patrimonio, oxígeno de caja, compromisos próximos o resumen financiero del mes ("¿cómo está la salud financiera?", "¿cuál es el valor real del negocio?", "dame mi salud financiera", "estado financiero del mes").
   - "consulta_radar_inferencia": pide el radar predictivo, inferencia de datos, paquetes con riesgo de cancelación antes de despachar, predicción de quiebre de stock cruzada con caja, diagnóstico causal de hoy o ROAS real ajustado por entrega ("dame el radar", "qué paquetes tienen riesgo de cancelar", "cuándo se acaba el stock", "qué anuncio deja más ganancia real").
   - "consulta_objeciones_chats": pide analizar chats no cerrados de WhatsApp / Todd para descubrir por qué no compran los leads, qué objeciones tienen o qué productos piden que no hay ("por qué no están comprando en WhatsApp", "qué objeciones tienen los clientes", "analiza chats no cerrados").
   - "consulta_memoria_ia": pregunta abierta de análisis, simulación contrafactual ("¿qué pasa si duplico pauta?", "¿cuántos pedidos necesito para cerrar el mes?"), tendencias, comparación de días/semanas, motivos de cancelación, recomendaciones o memoria del negocio.
   - "otro": saludo simple sin pregunta operativa ni de negocio.
${params.intentHint ? `\nPISTA DE CONTEXTO: El usuario inició con el comando ${params.intentHint}.\n` : ''}
2. Detalles por intent:
   - Si "compra": llena "items" [{ "sku", "variant_sku", "color", "talla", "raw_name", "cantidad", "costo_unitario" }], "proveedor", "account_id", "asentar_en_finanzas", "notas".
     REGLA DE VARIANTES: Si el producto tiene variantes en el catálogo (ej. Rosado / Amarillo) y el usuario compra cantidades por variante (ej. "compré 5 rosados y 5 amarillos del asistente de bebé a $3.50"), emite UN objeto en "items" por cada variante poniendo el SKU padre en "sku", el SKU de variante en "variant_sku" si existe en el catálogo, y el color/talla en "color" / "talla". (Si en factura viene total de línea, divide entre cantidad para obtener costo_unitario).
   - Si "gasto_operativo": llena "monto" (>0), "descripcion", "account_id", y "categoria" entre: "flete_envio", "empaque_suministros", "alquiler_servicios", "nomina_sueldos", "suscripciones", "comision_pasarela", "gasto_manual", "otro_gasto".
   - Si "gasto_pauta": llena "monto" (>0), "codigo_anuncio" (en MAYÚSCULAS, ej. "PROMO1", o "GENERAL" si no menciona código), "plataforma" ("Meta"|"TikTok"|"Google"|"WhatsApp"|"Otro"), "account_id", "notas".
   - Si "ajuste_inventario": llena "adjustment_mode": "merma" (daño/pérdida/muestra), "delta_positivo" (sumar), "delta_negativo" (restar), o "conteo_exacto" (fijar stock físico total); llena "sku", "raw_name", "cantidad" (entero >= 0: si es conteo_exacto es la cantidad final observada en bodega, si es merma/delta es las unidades que salen/entran), y "motivo".
   - Si "cambiar_estado_pedido": llena "order_query" (nombre de cliente, teléfono o código del pedido), "next_status" en UNO de: "nuevo" | "programado" | "por_empacar" | "en_camino" | "entregado" | "cancelado" ("empacar"/"empaque" -> "por_empacar", "ruta"/"motorista"/"despachado" -> "en_camino", "encargo" -> "programado"), y "cancel_reason" si es cancelación.
   - Si "consulta_pedido" o "consulta_stock" o "consulta_memoria_ia": pon en "search_query" el término o la pregunta completa.
   - En "account_id": elige el id exacto ("efectivo"/"caja" -> caja_chica, "banco"/"transferencia" -> banco_principal), o "${params.accounts[0]?.id || 'caja_chica'}" si no menciona.

3. Devuelve EXCLUSIVAMENTE JSON válido con esta estructura:
{
  "intent": "compra" | "gasto_operativo" | "gasto_pauta" | "ajuste_inventario" | "cambiar_estado_pedido" | "consulta_pedido" | "consulta_pendientes" | "consulta_stock" | "consulta_brief" | "consulta_salud_financiera" | "consulta_radar_inferencia" | "consulta_objeciones_chats" | "consulta_memoria_ia" | "otro",
  "search_query": "",
  "order_query": "",
  "next_status": "",
  "cancel_reason": "",
  "proveedor": "",
  "account_id": "",
  "asentar_en_finanzas": true,
  "monto": 0,
  "categoria": "gasto_manual",
  "descripcion": "",
  "codigo_anuncio": "",
  "plataforma": "Meta",
  "adjustment_mode": "merma",
  "sku": "",
  "raw_name": "",
  "cantidad": 0,
  "motivo": "",
  "notas": "",
  "items": [
    { "sku": "", "variant_sku": "", "color": "", "talla": "", "raw_name": "", "cantidad": 0, "costo_unitario": 0 }
  ],
  "reply_hint": ""
}`;

  const userContent: any[] = [];
  if (params.text) {
    userContent.push({ type: 'text', text: params.text });
  } else {
    userContent.push({
      type: 'text',
      text: 'Extrae la compra de mercadería o el gasto (monto, concepto, productos, cantidades, costos y proveedor) de esta imagen.',
    });
  }
  if (params.imageDataUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: params.imageDataUrl, detail: 'high' },
    });
  }

  const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.15,
      max_tokens: 950,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent },
      ],
    }),
  });

  const aiJson = await aiRes.json().catch(() => ({}));
  if (!aiRes.ok) {
    throw new Error(aiJson?.error?.message || `OpenAI HTTP ${aiRes.status}`);
  }

  const rawContent = aiJson?.choices?.[0]?.message?.content || '{}';
  return JSON.parse(rawContent);
}

type ServerKardexMovementType =
  | 'compra_entrada'
  | 'reserva_pedido'
  | 'liberar_reserva'
  | 'venta_salida'
  | 'devolucion_entrada'
  | 'merma_dano'
  | 'ajuste_positivo'
  | 'ajuste_negativo';

async function executeInventoryMovementServer(
  supabase: any,
  params: {
    sku: string;
    tipo_movimiento: ServerKardexMovementType;
    cantidad: number;
    costo_unitario?: number;
    motivo: string;
    source_table?: string;
    source_id: string;
    usuario?: string;
  }
): Promise<{
  ok: boolean;
  nuevoFisico?: number;
  nuevoDisponible?: number;
  error?: string;
}> {
  const skuClean = normalizeSku(params.sku);
  const absQty = Math.abs(Math.round(params.cantidad));
  const costo = Math.max(Number(params.costo_unitario) || 0, 0);
  const sourceTable = params.source_table || 'telegram_bot';
  const usuario = params.usuario || 'Telegram Bot';

  // 1. Intentar RPC atómico public.record_movement
  const rpcRes = await supabase.rpc('record_movement', {
    p_sku: skuClean,
    p_tipo_movimiento: params.tipo_movimiento,
    p_cantidad: absQty,
    p_costo_unitario: costo,
    p_motivo: params.motivo,
    p_source_table: sourceTable,
    p_source_id: params.source_id,
    p_usuario: usuario,
  });

  if (!rpcRes.error && rpcRes.data) {
    return {
      ok: true,
      nuevoFisico: Number(rpcRes.data.saldo_fisico ?? 0),
      nuevoDisponible: Number(rpcRes.data.saldo_disponible ?? 0),
    };
  }

  // 2. Fallback directo sobre inventory_stock + inventory_kardex
  const { data: existingRow, error: readErr } = await supabase
    .from('inventory_stock')
    .select('sku,nombre,stock_fisico,stock_reservado,costo_unitario')
    .eq('sku', skuClean)
    .maybeSingle();

  if (readErr) {
    return { ok: false, error: readErr.message };
  }

  const stockActual = Number(existingRow?.stock_fisico ?? 0);
  const reservadoActual = Number(existingRow?.stock_reservado ?? 0);
  let nuevoFisico = stockActual;
  let nuevoReservado = reservadoActual;
  let deltaKardex = absQty;

  if (params.tipo_movimiento === 'compra_entrada' || params.tipo_movimiento === 'ajuste_positivo') {
    nuevoFisico = stockActual + absQty;
  } else if (params.tipo_movimiento === 'reserva_pedido') {
    nuevoReservado = reservadoActual + absQty;
  } else if (params.tipo_movimiento === 'liberar_reserva') {
    nuevoReservado = Math.max(reservadoActual - absQty, 0);
  } else if (params.tipo_movimiento === 'venta_salida') {
    nuevoFisico = Math.max(stockActual - absQty, 0);
    nuevoReservado = Math.max(reservadoActual - absQty, 0);
    deltaKardex = -absQty;
  } else if (params.tipo_movimiento === 'ajuste_negativo' || params.tipo_movimiento === 'merma_dano') {
    nuevoFisico = Math.max(stockActual - absQty, 0);
    deltaKardex = -absQty;
  } else if (params.tipo_movimiento === 'devolucion_entrada') {
    nuevoFisico = stockActual + absQty;
    nuevoReservado = Math.max(reservadoActual - absQty, 0);
  }

  const nuevoDisponible = Math.max(nuevoFisico - nuevoReservado, 0);

  const updatePayload: Record<string, any> = {
    stock_fisico: nuevoFisico,
    stock_reservado: nuevoReservado,
    updated_at: new Date().toISOString(),
  };
  if (costo > 0 && params.tipo_movimiento === 'compra_entrada') {
    updatePayload.costo_unitario = costo;
  }

  if (existingRow) {
    const { error: updErr } = await supabase
      .from('inventory_stock')
      .update(updatePayload)
      .eq('sku', skuClean);
    if (updErr) return { ok: false, error: updErr.message };
  } else {
    const { error: insErr } = await supabase.from('inventory_stock').insert({
      sku: skuClean,
      nombre: skuClean,
      stock_fisico: nuevoFisico,
      stock_reservado: nuevoReservado,
      costo_unitario: costo,
      updated_at: new Date().toISOString(),
    });
    if (insErr) return { ok: false, error: insErr.message };
  }

  const { error: kardexErr } = await supabase.from('inventory_kardex').insert({
    sku: skuClean,
    tipo_movimiento: params.tipo_movimiento,
    cantidad: deltaKardex,
    costo_unitario: costo,
    saldo_fisico: nuevoFisico,
    motivo: params.motivo,
    source_table: sourceTable,
    source_id: params.source_id,
    usuario,
  });

  if (kardexErr && params.tipo_movimiento === 'liberar_reserva') {
    await supabase.from('inventory_kardex').insert({
      sku: skuClean,
      tipo_movimiento: 'ajuste_positivo',
      cantidad: deltaKardex,
      costo_unitario: costo,
      saldo_fisico: nuevoFisico,
      motivo: `[Liberación Reserva] ${params.motivo}`,
      source_table: sourceTable,
      source_id: params.source_id,
      usuario,
    });
  }

  return { ok: true, nuevoFisico, nuevoDisponible };
}

function normalizeEstadoOrder(
  raw?: string | null
): 'nuevo' | 'programado' | 'por_empacar' | 'en_camino' | 'entregado' | 'cancelado' | null {
  const s = normalizeTextKey(raw).toLowerCase();
  if (!s) return null;
  if (s === 'nuevo' || s === 'nueva' || s === 'pendiente') return 'nuevo';
  if (s === 'programado' || s === 'encargo' || s === 'agendado') return 'programado';
  if (
    s === 'por empacar' ||
    s === 'por_empacar' ||
    s === 'empacar' ||
    s === 'empaque' ||
    s === 'empacado' ||
    s === 'confirmado' ||
    s === 'confirmar'
  ) {
    return 'por_empacar';
  }
  if (
    s === 'en camino' ||
    s === 'en_camino' ||
    s === 'en ruta' ||
    s === 'ruta' ||
    s === 'despachado' ||
    s === 'enviado' ||
    s === 'motorista'
  ) {
    return 'en_camino';
  }
  if (s === 'entregado' || s === 'entregada' || s === 'completado' || s === 'cobrado') {
    return 'entregado';
  }
  if (s === 'cancelado' || s === 'cancelada' || s === 'rechazado' || s === 'devuelto' || s === 'anulado') {
    return 'cancelado';
  }
  return null;
}

function resolveOrderSkusForServer(order: any, catalog: any[]): Array<{ sku: string; cantidad: number; costo_unitario: number; stock_reservado: number }> {
  const catalogBySku = new Map<string, any>();
  for (const c of catalog) catalogBySku.set(normalizeSku(c.sku), c);

  const aggregated = new Map<string, { sku: string; cantidad: number; costo_unitario: number; stock_reservado: number }>();
  const addLine = (item: any, qty: number) => {
    if (!item) return;
    const skuClean = normalizeSku(item.sku);
    const prev = aggregated.get(skuClean);
    if (prev) {
      prev.cantidad += qty;
    } else {
      aggregated.set(skuClean, {
        sku: skuClean,
        cantidad: Math.max(1, Math.round(qty)),
        costo_unitario: Number(item.costo_unitario || 0),
        stock_reservado: Number(item.stock_reservado || 0),
      });
    }
  };

  if (Array.isArray(order.items) && order.items.length > 0) {
    for (const it of order.items) {
      const q = Math.min(Math.max(Math.round(Number(it?.cantidad ?? it?.qty ?? 1) || 1), 1), 100);
      const matched =
        (it?.catalogo_sku && catalogBySku.get(normalizeSku(it.catalogo_sku))) ||
        (it?.sku && findBestSkuMatch(String(it.sku), catalog)) ||
        (it?.nombre && findBestSkuMatch(String(it.nombre), catalog));
      if (matched) addLine(matched, q);
    }
  }

  if (aggregated.size === 0) {
    const qty =
      order.cantidad && Number(order.cantidad) > 0
        ? Math.min(Math.max(Math.round(Number(order.cantidad)), 1), 100)
        : inferOrderQty(order.sku);
    const matched =
      (order.catalogo_sku && catalogBySku.get(normalizeSku(order.catalogo_sku))) ||
      (order.sku && findBestSkuMatch(String(order.sku), catalog)) ||
      (order.codigo_anuncio && findBestSkuMatch(String(order.codigo_anuncio), catalog));
    if (matched) addLine(matched, qty);
  }

  return Array.from(aggregated.values());
}

function computeOrderLedgerServer(movements: any[], skuFilter: string) {
  let reserved = 0;
  let sold = 0;
  const targetSku = normalizeSku(skuFilter);
  const sorted = [...movements].sort((a, b) => {
    const ta = new Date(a.created_at).getTime() || 0;
    const tb = new Date(b.created_at).getTime() || 0;
    return ta !== tb ? ta - tb : (Number(a.id) || 0) - (Number(b.id) || 0);
  });

  for (const m of sorted) {
    if (normalizeSku(m.sku) !== targetSku) continue;
    const qty = Math.abs(Number(m.cantidad) || 0);
    if (qty === 0) continue;

    if (m.tipo_movimiento === 'reserva_pedido') {
      reserved += qty;
    } else if (
      m.tipo_movimiento === 'liberar_reserva' ||
      (m.tipo_movimiento === 'ajuste_positivo' && String(m.motivo || '').startsWith('[Liberación Reserva]'))
    ) {
      reserved = Math.max(0, reserved - qty);
    } else if (m.tipo_movimiento === 'venta_salida') {
      sold += qty;
      reserved = Math.max(0, reserved - qty);
    } else if (m.tipo_movimiento === 'devolucion_entrada') {
      sold = Math.max(0, sold - qty);
      reserved = Math.max(0, reserved - qty);
    } else if (m.tipo_movimiento === 'merma_dano') {
      reserved = Math.max(0, reserved - qty);
    }
  }

  return { reservedNet: reserved, soldNet: sold };
}

async function syncOrderInventoryOnStatusChangeServer(
  supabase: any,
  params: {
    order: any;
    prevEstado: string;
    nextEstado: string;
    reingresarStock?: boolean;
    esMerma?: boolean;
    motivoCancelacion?: string;
  }
): Promise<{ summaryText: string }> {
  const catalog = await fetchActiveStockCatalog(supabase);
  const lines = resolveOrderSkusForServer(params.order, catalog);
  if (lines.length === 0) {
    return { summaryText: 'Pedido sin SKU vinculado en bodega (solo cambió estado).' };
  }

  const prevNorm = normalizeEstadoOrder(params.prevEstado) || 'nuevo';
  const nextNorm = normalizeEstadoOrder(params.nextEstado) || 'nuevo';
  const shortId = String(params.order.id || '').slice(0, 8).toUpperCase();

  let existingMovs: any[] = [];
  try {
    const { data } = await supabase
      .from('inventory_kardex')
      .select('*')
      .eq('source_table', 'whatsapp_orders')
      .eq('source_id', params.order.id)
      .order('created_at', { ascending: true });
    if (Array.isArray(data)) existingMovs = data;
  } catch {}

  const actions: string[] = [];

  for (const line of lines) {
    const ledger = computeOrderLedgerServer(existingMovs, line.sku);

    const exec = async (
      tipo: ServerKardexMovementType,
      cantidad: number,
      motivo: string,
      costoUnitario = 0
    ) => {
      const r = await executeInventoryMovementServer(supabase, {
        sku: line.sku,
        tipo_movimiento: tipo,
        cantidad,
        costo_unitario: costoUnitario,
        motivo,
        source_table: 'whatsapp_orders',
        source_id: params.order.id,
        usuario: 'Telegram Bot',
      });
      if (r.ok) {
        actions.push(`${line.sku}: ${tipo} (${cantidad})`);
      }
    };

    if (nextNorm === 'nuevo' || nextNorm === 'programado') {
      if (ledger.soldNet > 0) {
        await exec(
          'devolucion_entrada',
          ledger.soldNet,
          `Reversión de entrega pedido #${shortId} (${params.order.nombre_cliente || 'Cliente'})`,
          line.costo_unitario
        );
      } else if (ledger.reservedNet > 0) {
        await exec(
          'liberar_reserva',
          ledger.reservedNet,
          `Liberación de reserva pedido #${shortId} devuelto a ${nextNorm === 'programado' ? 'Encargo' : 'Nuevo'}`
        );
      }
    } else if (nextNorm === 'por_empacar' || nextNorm === 'en_camino') {
      if (ledger.soldNet > 0) {
        await exec(
          'devolucion_entrada',
          ledger.soldNet,
          `Reingreso por retorno a ${nextNorm === 'en_camino' ? 'Ruta' : 'Empaque'} #${shortId}`,
          line.costo_unitario
        );
      }
      const neededReserve = Math.max(line.cantidad - ledger.reservedNet, 0);
      if (neededReserve > 0) {
        await exec(
          'reserva_pedido',
          neededReserve,
          `Reserva en ${nextNorm === 'por_empacar' ? 'Empaque' : 'Ruta'} pedido #${shortId} (${params.order.nombre_cliente || 'Cliente'})`
        );
      }
    } else if (nextNorm === 'entregado') {
      const neededSell = Math.max(line.cantidad - ledger.soldNet, 0);
      if (neededSell > 0) {
        const missingReserve = Math.max(neededSell - ledger.reservedNet, 0);
        if (missingReserve > 0) {
          await exec('reserva_pedido', missingReserve, `Auto-reserva previa a entrega #${shortId}`);
        }
        await exec(
          'venta_salida',
          neededSell,
          `Venta entregada pedido #${shortId} (${params.order.nombre_cliente || 'Cliente'})`,
          line.costo_unitario
        );
      }
    } else if (nextNorm === 'cancelado') {
      const motivoTxt = params.motivoCancelacion || 'Cancelado desde Telegram';
      const debeReingresar = params.reingresarStock !== false;
      if (ledger.soldNet > 0) {
        if (!params.esMerma && debeReingresar) {
          await exec(
            'devolucion_entrada',
            ledger.soldNet,
            `Devolución post-entrega #${shortId} (${motivoTxt})`,
            line.costo_unitario
          );
        }
      } else if (ledger.reservedNet > 0) {
        if (params.esMerma) {
          await exec('liberar_reserva', ledger.reservedNet, `Liberar reserva por merma #${shortId} (${motivoTxt})`);
          await exec('merma_dano', ledger.reservedNet, `Producto dañado en devolución #${shortId} (${motivoTxt})`, line.costo_unitario);
        } else if (debeReingresar) {
          await exec('liberar_reserva', ledger.reservedNet, `Reserva liberada por devolución #${shortId} (${motivoTxt})`);
        }
      } else if ((prevNorm === 'por_empacar' || prevNorm === 'en_camino') && debeReingresar) {
        const reservableFallback = Math.min(line.cantidad, Math.max(line.stock_reservado, 0));
        if (reservableFallback > 0) {
          await exec('liberar_reserva', reservableFallback, `Reserva liberada por devolución #${shortId} (${motivoTxt})`);
        }
        if (params.esMerma) {
          await exec('merma_dano', line.cantidad, `Producto dañado en devolución #${shortId} (${motivoTxt})`, line.costo_unitario);
        }
      }
    }
  }

  return {
    summaryText: actions.length > 0 ? `Kárdex sincronizado: ${actions.join(', ')}` : 'Sin cambios pendientes en Kárdex.',
  };
}

async function recordFinanceExpenseServer(
  supabase: any,
  params: {
    account_id: string;
    categoria: string;
    monto: number;
    descripcion: string;
    fecha: string;
  }
): Promise<{ ok: boolean; nuevoSaldo?: number; error?: string }> {
  const monto = Math.round(Math.abs(params.monto) * 100) / 100;
  if (monto <= 0) return { ok: true };

  try {
    const ins = await supabase
      .from('finance_money_transactions')
      .insert({
        account_id: params.account_id,
        tipo: 'expense',
        categoria: params.categoria || 'gasto_manual',
        monto,
        descripcion: params.descripcion,
        fecha: params.fecha,
        es_manual: true,
      })
      .select()
      .single();

    if (ins.error) {
      return { ok: false, error: ins.error.message };
    }

    const rpcBal = await supabase.rpc('update_account_balance', {
      p_account_id: params.account_id,
      p_delta: -monto,
    });

    if (rpcBal.error) {
      const { data: accRow } = await supabase
        .from('finance_cash_accounts')
        .select('saldo_actual')
        .eq('id', params.account_id)
        .maybeSingle();
      if (accRow) {
        const nextBal = Number(accRow.saldo_actual || 0) - monto;
        await supabase
          .from('finance_cash_accounts')
          .update({ saldo_actual: nextBal })
          .eq('id', params.account_id);
        return { ok: true, nuevoSaldo: nextBal };
      }
    } else {
      const { data: accRow } = await supabase
        .from('finance_cash_accounts')
        .select('saldo_actual')
        .eq('id', params.account_id)
        .maybeSingle();
      return {
        ok: true,
        nuevoSaldo: accRow ? Number(accRow.saldo_actual) : undefined,
      };
    }

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error asentando egreso en Finanzas' };
  }
}

// emitBestEffortOsEvent consolidado al inicio de api/morning-brief.ts

async function sendDraftConfirmationCard(chatId: string | number, draft: TelegramDraft) {
  const kind = draft.kind || 'compra';

  if (kind === 'gasto_operativo' && draft.kind === 'gasto_operativo') {
    const lines = [
      `💸 <b>BORRADOR DE GASTO OPERATIVO</b>`,
      `💵 Monto: <b>${fmtMoney(draft.monto)}</b>`,
      `🏷️ Categoría: <code>${escapeHtml(draft.categoria)}</code>`,
      `📝 Concepto: <b>${escapeHtml(draft.descripcion)}</b>`,
      `🏦 Caja/Cuenta: <b>${escapeHtml(draft.account_nombre)}</b>`,
      '',
      '¿Confirmas descontar este gasto en Finanzas?',
    ];
    await sendTgMessage(chatId, lines.join('\n'), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirmar Gasto en Caja', callback_data: `tg_ok:${draft.id}:1` },
            { text: '❌ Cancelar', callback_data: `tg_no:${draft.id}` },
          ],
        ],
      },
    });
    return;
  }

  if (kind === 'gasto_pauta' && draft.kind === 'gasto_pauta') {
    const lines = [
      `📈 <b>BORRADOR DE GASTO DE PAUTA</b>`,
      `💵 Monto: <b>${fmtMoney(draft.monto)}</b>`,
      `🎯 Código anuncio: <code>${escapeHtml(draft.codigo_anuncio)}</code>`,
      `📣 Plataforma: <b>${escapeHtml(draft.plataforma)}</b>`,
      draft.notas ? `📝 Nota: <i>${escapeHtml(draft.notas)}</i>` : '',
      `🏦 Caja sugerida: <b>${escapeHtml(draft.account_nombre)}</b>`,
      '',
      'Elige cómo registrar esta pauta en TODOENUNO OS:',
    ].filter((l) => l !== '');

    await sendTgMessage(chatId, lines.join('\n'), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📈 Solo Pauta (ROAS)', callback_data: `tg_ok:${draft.id}:0` },
            { text: '💰 Pauta + Descontar Caja', callback_data: `tg_ok:${draft.id}:1` },
          ],
          [{ text: '❌ Cancelar', callback_data: `tg_no:${draft.id}` }],
        ],
      },
    });
    return;
  }

  if (kind === 'ajuste_inventario' && draft.kind === 'ajuste_inventario') {
    const labelTipo =
      draft.tipo_movimiento === 'merma_dano'
        ? 'Merma / Daño'
        : draft.tipo_movimiento === 'ajuste_positivo'
          ? 'Ajuste Positivo (+)'
          : 'Ajuste Negativo (-)';
    const sign = draft.tipo_movimiento === 'ajuste_positivo' ? '+' : '-';

    const lines = [
      `🛠️ <b>BORRADOR DE AJUSTE / MERMA</b>`,
      `📦 SKU: <code>${escapeHtml(draft.sku)}</code> (${escapeHtml(draft.nombre)})`,
      `⚙️ Movimiento: <b>${labelTipo}</b> (<b>${sign}${draft.cantidad} u.</b>)`,
      `📊 Físico actual: <b>${draft.stock_actual}</b> → Nuevo físico: <b>${draft.stock_resultante}</b>`,
      `📝 Motivo: <i>${escapeHtml(draft.motivo)}</i>`,
      '',
      '¿Confirmas asentar este movimiento en Kárdex?',
    ];

    await sendTgMessage(chatId, lines.join('\n'), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Confirmar Ajuste', callback_data: `tg_ok:${draft.id}:0` },
            { text: '❌ Cancelar', callback_data: `tg_no:${draft.id}` },
          ],
        ],
      },
    });
    return;
  }

  if (kind === 'cambiar_estado_pedido' && draft.kind === 'cambiar_estado_pedido') {
    const impactHint =
      draft.estado_nuevo === 'por_empacar' || draft.estado_nuevo === 'en_camino'
        ? '📦 Kárdex: reservará unidades en bodega si aún no estaban reservadas.'
        : draft.estado_nuevo === 'entregado'
          ? '📉 Kárdex: descontará stock físico (venta entregada).'
          : draft.estado_nuevo === 'cancelado'
            ? '↩️ Kárdex: liberará reserva / reingresará stock (o márcalo como merma si se dañó).'
            : '🔓 Kárdex: liberará reserva si venía de Empaque/Ruta.';

    const lines = [
      `🔄 <b>CONFIRMAR CAMBIO DE ESTADO DE PEDIDO</b>`,
      `🧾 Pedido: <code>${escapeHtml(draft.pedido_codigo)}</code> · <b>${fmtMoney(draft.total)}</b>`,
      `👤 Cliente: <b>${escapeHtml(draft.nombre_cliente)}</b> (${escapeHtml(draft.telefono || 's/n')})`,
      `📦 Producto: ${escapeHtml(draft.sku_display)}`,
      '',
      `${formatEstadoBadge(draft.estado_anterior)}  ➔  <b>${formatEstadoBadge(draft.estado_nuevo)}</b>`,
      draft.motivo_cancelacion ? `📝 Motivo: <i>${escapeHtml(draft.motivo_cancelacion)}</i>` : '',
      `<i>${impactHint}</i>`,
    ].filter((l) => l !== '');

    const buttons =
      draft.estado_nuevo === 'cancelado'
        ? [
            [
              { text: '✅ Cancelar y Reingresar Stock', callback_data: `tg_ok:${draft.id}:1` },
              { text: '💔 Cancelar como Merma', callback_data: `tg_ok:${draft.id}:2` },
            ],
            [{ text: '❌ No hacer cambios', callback_data: `tg_no:${draft.id}` }],
          ]
        : [
            [
              { text: '✅ Confirmar Cambio', callback_data: `tg_ok:${draft.id}:0` },
              { text: '❌ Cancelar', callback_data: `tg_no:${draft.id}` },
            ],
          ];

    await sendTgMessage(chatId, lines.join('\n'), {
      reply_markup: { inline_keyboard: buttons },
    });
    return;
  }

  // Default: Compra de mercadería
  const compra = draft as Extract<TelegramDraft, { items: DraftItem[] }>;
  const lines: string[] = [];
  lines.push(`📦 <b>BORRADOR DE COMPRA POR CONFIRMAR</b>`);
  lines.push(`🏭 Proveedor: <b>${escapeHtml(compra.proveedor || 'Proveedor')}</b>`);
  if (compra.notas) lines.push(`📝 Nota: <i>${escapeHtml(compra.notas)}</i>`);
  lines.push('');

  for (const it of compra.items) {
    const varLabel = it.variante_id ? formatVariantLabel(it.color, it.talla) : '';
    const varBadge = varLabel ? ` · 🎨 <b>${escapeHtml(varLabel)}</b>` : '';
    lines.push(
      `• <code>${escapeHtml(it.sku)}</code> (${escapeHtml(it.nombre)})${varBadge}\n  <b>+${it.cantidad} u.</b> × ${fmtMoney(it.costo_unitario)} = <b>${fmtMoney(it.subtotal)}</b>`
    );
  }

  if (compra.unmatchedNotes && compra.unmatchedNotes.length > 0) {
    lines.push('');
    lines.push(`⚠️ <i>No encontré SKU/variante exacto para:</i>`);
    for (const u of compra.unmatchedNotes) {
      lines.push(`  • ${escapeHtml(u)}`);
    }
  }

  lines.push('');
  lines.push(`💵 <b>Total compra: ${fmtMoney(compra.total)}</b>`);
  lines.push(`🏦 Caja sugerida: <b>${escapeHtml(compra.account_nombre)}</b>`);
  lines.push('');
  lines.push('Elige cómo registrar esta entrada en TODOENUNO OS:');

  await sendTgMessage(chatId, lines.join('\n'), {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ Solo Inventario', callback_data: `tg_ok:${compra.id}:0` },
          { text: '💰 Inventario + Descontar Caja', callback_data: `tg_ok:${compra.id}:1` },
        ],
        [{ text: '❌ Cancelar', callback_data: `tg_no:${compra.id}` }],
      ],
    },
  });
}

async function handleStockQuery(supabase: any, chatId: string | number, searchRaw: string) {
  const catalog = await fetchActiveStockCatalog(supabase);
  const q = searchRaw.trim().toLowerCase();
  const filtered = q
    ? catalog.filter(
        (i: any) =>
          String(i.sku || '').toLowerCase().includes(q) ||
          String(i.nombre || '').toLowerCase().includes(q) ||
          (Array.isArray(i.variants) &&
            i.variants.some(
              (v: TelegramCatalogVariant) =>
                String(v.sku || '').toLowerCase().includes(q) ||
                String(v.color || '').toLowerCase().includes(q) ||
                String(v.talla || '').toLowerCase().includes(q)
            ))
      )
    : catalog;

  if (filtered.length === 0) {
    await sendTgMessage(
      chatId,
      `🔍 No encontré productos activos que coincidan con <b>${escapeHtml(searchRaw)}</b>.`
    );
    return;
  }

  const lines = [
    `📦 <b>STOCK EN BODEGA${q ? ` (${escapeHtml(searchRaw)})` : ''}</b>`,
    '',
    ...filtered.slice(0, 15).map((i: any) => {
      const disp = Number(i.stock_disponible || 0);
      const fis = Number(i.stock_fisico || 0);
      const res = Number(i.stock_reservado || 0);
      const icon = disp <= 0 ? '🔴' : disp <= 5 ? '🟡' : '🟢';
      const vars: TelegramCatalogVariant[] = Array.isArray(i.variants) ? i.variants : [];
      const varLine =
        vars.length > 0
          ? `\n   🎨 Variantes: ${vars
              .map((v) => `${escapeHtml(formatVariantLabel(v.color, v.talla))} (<b>${v.stock}</b>)`)
              .join(' | ')}`
          : '';
      return `${icon} <code>${escapeHtml(i.sku)}</code> · <b>${escapeHtml(i.nombre)}</b>\n   Disp: <b>${disp}</b> (Físico ${fis} · Res ${res}) · Costo ${fmtMoney(i.costo_unitario)}${varLine}`;
    }),
  ];

  if (filtered.length > 15) {
    lines.push(`\n<i>Mostrando 15 de ${filtered.length} SKUs. Usa /stock palabra para filtrar.</i>`);
  }

  await sendTgMessage(chatId, lines.join('\n'));
}

function formatEstadoBadge(estado?: string | null): string {
  const e = String(estado || '').toLowerCase();
  if (e === 'entregado') return '✅ Entregado';
  if (e === 'en_camino') return '🚚 En ruta';
  if (e === 'por_empacar') return '📦 Por empacar';
  if (e === 'programado') return '📅 Encargo';
  if (e === 'cancelado') return '❌ Cancelado';
  return '🆕 Nuevo';
}

async function handleOrderSearchQuery(supabase: any, chatId: string | number, queryRaw: string) {
  const q = queryRaw.trim();
  if (!q) {
    await handlePendingOrdersQuery(supabase, chatId);
    return;
  }

  const { data: orders, error } = await supabase
    .from('whatsapp_orders')
    .select(
      'id,pedido_codigo,nombre_cliente,telefono,direccion,departamento,courier,sku,catalogo_sku,total,estado,liquidado,es_encargo,fecha_programada,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(400);

  if (error) {
    throw new Error(`Error consultando pedidos: ${error.message}`);
  }

  const qLower = q.toLowerCase();
  const qDigits = q.replace(/\D/g, '');
  const matched = (orders || []).filter((o: any) => {
    const hay = [
      o.pedido_codigo,
      o.nombre_cliente,
      o.telefono,
      o.sku,
      o.catalogo_sku,
      o.courier,
      o.departamento,
      String(o.id || '').slice(0, 8),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (hay.includes(qLower)) return true;
    if (qDigits.length >= 4 && String(o.telefono || '').replace(/\D/g, '').includes(qDigits)) {
      return true;
    }
    return false;
  });

  if (matched.length === 0) {
    await sendTgMessage(
      chatId,
      `🔍 No encontré pedidos recientes para <b>${escapeHtml(q)}</b>.\nPrueba con nombre, teléfono o código (ej. <code>/pedido 70231940</code>).`
    );
    return;
  }

  const lines = [
    `🔎 <b>PEDIDOS ENCONTRADOS PARA "${escapeHtml(q)}" (${matched.length})</b>`,
    '',
    ...matched.slice(0, 6).map((o: any) => {
      const code = o.pedido_codigo || String(o.id || '').slice(0, 8).toUpperCase();
      const liq =
        String(o.estado || '').toLowerCase() === 'entregado'
          ? o.liquidado
            ? ' · 💵 Liquidado'
            : ' · ⏳ Por liquidar'
          : '';
      const fechaProg = o.fecha_programada ? ` · Prog: ${o.fecha_programada}` : '';
      return (
        `${formatEstadoBadge(o.estado)} <code>${escapeHtml(code)}</code> — <b>${fmtMoney(o.total)}</b>${liq}\n` +
        `👤 ${escapeHtml(o.nombre_cliente || 'Cliente')} (${escapeHtml(o.telefono || 's/n')})\n` +
        `📦 ${escapeHtml(o.sku || o.catalogo_sku || 'Producto')}\n` +
        `📍 ${escapeHtml(o.departamento || 'SV')}${o.courier ? ` · 🛵 ${escapeHtml(o.courier)}` : ''}${fechaProg}`
      );
    }),
  ];

  if (matched.length > 6) {
    lines.push(`\n<i>Mostrando los 6 más recientes de ${matched.length} coincidencias.</i>`);
  }

  await sendTgMessage(chatId, lines.join('\n\n'));
}

async function handlePendingOrdersQuery(supabase: any, chatId: string | number) {
  const todayIso = getElSalvadorDate();
  const pendingStreetStatuses = [
    'nuevo',
    'programado',
    'encargo',
    'agendado',
    'por_empacar',
    'empacado',
    'confirmado',
    'en_empaque',
    'por empacar',
    'en_camino',
    'en_ruta',
    'en ruta',
    'despachado',
    'enviado',
    'ruta',
    'en camino',
    'entregado',
    'entregada',
    'completado',
    'completada',
  ];

  const [recentRes, unliqRes] = await Promise.all([
    supabase
      .from('whatsapp_orders')
      .select(
        'id,pedido_codigo,nombre_cliente,telefono,departamento,courier,sku,total,estado,liquidado,es_encargo,fecha_programada,created_at'
      )
      .order('created_at', { ascending: false })
      .limit(500),
    supabase
      .from('whatsapp_orders')
      .select(
        'id,pedido_codigo,nombre_cliente,telefono,departamento,courier,sku,total,estado,liquidado,es_encargo,fecha_programada,created_at'
      )
      .in('estado', pendingStreetStatuses)
      .or('liquidado.is.null,liquidado.eq.false')
      .order('created_at', { ascending: false })
      .limit(2000),
  ]);

  if (recentRes.error) {
    throw new Error(`Error consultando pendientes: ${recentRes.error.message}`);
  }

  const normalizeEstado = (rawEstado?: string | null) => {
    const raw = String(rawEstado || '').trim().toLowerCase();
    if (!raw) return 'nuevo';
    if (['nuevo', 'programado', 'por_empacar', 'en_camino', 'entregado', 'cancelado'].includes(raw)) return raw;
    if (['en_ruta', 'en ruta', 'despachado', 'enviado', 'ruta', 'en camino'].includes(raw)) return 'en_camino';
    if (['empacado', 'confirmado', 'en_empaque', 'por empacar'].includes(raw)) return 'por_empacar';
    if (['entregada', 'completado', 'completada'].includes(raw)) return 'entregado';
    if (['cancelada', 'rechazado', 'devuelto'].includes(raw)) return 'cancelado';
    if (['encargo', 'agendado'].includes(raw)) return 'programado';
    return 'nuevo';
  };

  const merged = new Map<string, any>();
  for (const o of Array.isArray(recentRes.data) ? recentRes.data : []) merged.set(o.id, o);
  for (const o of Array.isArray(unliqRes.data) ? unliqRes.data : []) {
    if (!merged.has(o.id)) merged.set(o.id, o);
  }

  const all = Array.from(merged.values());
  const nuevos = all.filter((o: any) => normalizeEstado(o.estado) === 'nuevo');
  const porEmpacar = all.filter((o: any) => normalizeEstado(o.estado) === 'por_empacar');
  const enCamino = all.filter((o: any) => normalizeEstado(o.estado) === 'en_camino' && o.liquidado !== true);
  const encargosProntos = all.filter((o: any) => {
    const est = normalizeEstado(o.estado);
    if (est !== 'programado') return false;
    if (!o.fecha_programada) return true;
    return String(o.fecha_programada).slice(0, 10) <= todayIso;
  });
  const porLiquidar = all.filter(
    (o: any) => normalizeEstado(o.estado) === 'entregado' && o.liquidado !== true
  );

  const sumTotal = (arr: any[]) => arr.reduce((s, o) => s + (Number(o.total) || 0), 0);

  const lines: string[] = [
    `📋 <b>COLA OPERATIVA Y PENDIENTES (EN VIVO)</b>`,
    '',
    `• 🆕 Nuevos sin confirmar: <b>${nuevos.length}</b> (${fmtMoney(sumTotal(nuevos))})`,
    `• 📦 Por empacar: <b>${porEmpacar.length}</b> (${fmtMoney(sumTotal(porEmpacar))})`,
    `• 🚚 En ruta con motorista: <b>${enCamino.length}</b> (${fmtMoney(sumTotal(enCamino))})`,
    `• 📅 Encargos para hoy o vencidos: <b>${encargosProntos.length}</b> (${fmtMoney(sumTotal(encargosProntos))})`,
    `• 💵 Entregados por liquidar: <b>${porLiquidar.length}</b> (<b>${fmtMoney(sumTotal(porLiquidar))}</b>)`,
  ];

  const despachoQueue = [...porEmpacar, ...encargosProntos].slice(0, 6);
  if (despachoQueue.length > 0) {
    lines.push('');
    lines.push(`<b>Próximos a empacar / despachar:</b>`);
    for (const o of despachoQueue) {
      const code = o.pedido_codigo || String(o.id || '').slice(0, 6).toUpperCase();
      lines.push(
        `• <code>${escapeHtml(code)}</code> · ${escapeHtml(o.nombre_cliente || 'Cliente')} · ${escapeHtml(
          o.sku || 'SKU'
        )} · <b>${fmtMoney(o.total)}</b>`
      );
    }
  }

  await sendTgMessage(chatId, lines.join('\n'));
}

async function handleBriefCommand(req: any, chatId: string | number, argRaw: string) {
  const arg = argRaw.trim().toLowerCase();
  const nowSvHour = Number(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIME_ZONE,
      hour: 'numeric',
      hour12: false,
    }).format(new Date())
  );

  let briefType = nowSvHour < 13 ? 'morning' : 'evening';
  if (arg === 'am' || arg === 'morning' || arg === 'manana' || arg === 'mañana') {
    briefType = 'morning';
  } else if (arg === 'pm' || arg === 'evening' || arg === 'tarde' || arg === 'noche') {
    briefType = 'evening';
  } else if (arg === 'full') {
    briefType = 'full';
  }

  const baseUrl = getBaseUrl(req);
  const res = await fetch(`${baseUrl}/api/morning-brief?type=${briefType}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.mensaje) {
    throw new Error(data?.error || 'No se pudo generar el brief en este momento.');
  }

  await sendTgMessage(chatId, data.mensaje);
}

function formatDeltaBadge(curr: number, prev: number, isCurrency = false): string {
  if (prev <= 0) return curr > 0 ? '🆕' : '—';
  const pct = Math.round(((curr - prev) / prev) * 100);
  const sign = pct >= 0 ? '+' : '';
  const icon = pct > 5 ? '📈' : pct < -5 ? '📉' : '➡️';
  const diff = curr - prev;
  const diffStr = isCurrency
    ? ` (${diff >= 0 ? '+' : '-'}$${Math.abs(diff).toFixed(2)})`
    : '';
  return `${icon} ${sign}${pct}%${diffStr}`;
}

const AI_QUICK_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '📡 Radar IA', callback_data: 'ia_quick:radar' },
      { text: '🩺 Salud Financiera', callback_data: 'ia_quick:salud' },
    ],
    [
      { text: '🔍 Objeciones Chats', callback_data: 'ia_quick:objeciones' },
      { text: '📊 7d vs Anterior', callback_data: 'ia_quick:compare7d' },
    ],
    [
      { text: '📦 Riesgo Stock', callback_data: 'ia_quick:stock_risk' },
      { text: '☀️ Brief Operativo', callback_data: 'ia_quick:brief' },
    ],
  ],
};

interface ServerFinancialHealthSnapshot {
  periodLabel: string;
  cutoffIso: string | null;
  ingresos: number;
  egresosOperativos: number;
  comprasInventario: number;
  utilidadOperativa: number;
  flujoNetoCaja: number;
  margenOperativoPct: number;
  valorTotalReal: number;
  liquidezNeta: number;
  liquidezPositiva: number;
  deudaTarjetaPauta: number;
  inventarioCosto: number;
  unidadesFisicas: number;
  skusActivosCount: number;
  skusSinCostoCount: number;
  entregadosSinLiquidar: number;
  entregadosCount: number;
  enRutaPotencial: number;
  enRutaCount: number;
  score: number;
  estado: 'Saludable' | 'Atención' | 'Riesgo';
  runwayDias: number | null;
  gastoDiarioPromedio: number;
  compromisos15dTotal: number;
  compromisos15dCount: number;
  pagosVencidosCount: number;
  pctCapitalAtrapado: number;
  budgetPct: number | null;
  hasBudgets: boolean;
  pillars: Array<{
    id: string;
    label: string;
    score: number;
    maxScore: number;
    summary: string;
    status: 'ok' | 'warn' | 'risk';
  }>;
  findings: string[];
  simulation: {
    montoPorLiquidar: number;
    nuevaLiquidezNeta: number;
    nuevoScore: number;
    nuevoEstado: 'Saludable' | 'Atención' | 'Riesgo';
    mejoraPuntos: number;
  } | null;
}

function addDaysYmdUtc(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + delta)).toISOString().slice(0, 10);
}

function isInventoryPurchaseCatServer(cat?: string | null): boolean {
  const c = String(cat || '').trim().toLowerCase();
  return (
    c === 'pago_proveedor' ||
    c === 'compra_inventario' ||
    c === 'compra_mercaderia' ||
    c.includes('proveedor')
  );
}

function evaluateCoreHealthServer(params: {
  ingresos: number;
  egresosOperativos: number;
  utilidadOperativa: number;
  margenOperativoPct: number;
  liquidezNeta: number;
  liquidezPositiva: number;
  deudaTarjetaPauta: number;
  entregadosSinLiquidar: number;
  inventarioCosto: number;
  compromisos15dTotal: number;
  compromisos15dCount: number;
  pagosVencidosCount: number;
  gastoDiarioPromedio: number;
  budgetPct: number | null;
  hasBudgets: boolean;
}) {
  const wMargen = params.hasBudgets ? 30 : 35;
  const wLiquidez = params.hasBudgets ? 30 : 40;
  const wCalle = params.hasBudgets ? 20 : 25;
  const wPresupuesto = params.hasBudgets ? 20 : 0;

  // 1. Margen operativo
  let margenRatio = 0.5;
  let margenSummary = 'Sin movimientos operativos en el mes';
  let margenStatus: 'ok' | 'warn' | 'risk' = 'warn';
  if (params.ingresos > 0 || params.egresosOperativos > 0) {
    if (params.ingresos === 0 && params.egresosOperativos > 0) {
      margenRatio = 0.15;
      margenStatus = 'risk';
      margenSummary = 'Solo egresos sin cobros liquidados aún';
    } else {
      const m = params.margenOperativoPct;
      if (m >= 25) {
        margenRatio = 1;
        margenStatus = 'ok';
      } else if (m >= 10) {
        margenRatio = 0.72;
        margenStatus = 'ok';
      } else if (m >= 0) {
        margenRatio = 0.48;
        margenStatus = 'warn';
      } else {
        margenRatio = Math.max(0.05, 0.35 + m / 100);
        margenStatus = 'risk';
      }
      margenSummary = `${m.toFixed(1)}% (${params.utilidadOperativa >= 0 ? '+' : ''}${fmtMoney(params.utilidadOperativa)})`;
    }
  }
  const margenScore = Math.round(wMargen * margenRatio);

  // 2. Liquidez y vencimientos
  const obligacionesCortoPlazo = params.compromisos15dTotal + params.deudaTarjetaPauta;
  const coberturaRatio =
    obligacionesCortoPlazo > 0
      ? params.liquidezPositiva / obligacionesCortoPlazo
      : params.liquidezPositiva > 0
      ? 3
      : 1;
  const runwayDias =
    params.gastoDiarioPromedio > 0.5
      ? Math.max(0, Math.round(params.liquidezPositiva / params.gastoDiarioPromedio))
      : null;

  let liqFactor = 0.7;
  let liqStatus: 'ok' | 'warn' | 'risk' = 'ok';
  if (params.liquidezNeta <= 0 && obligacionesCortoPlazo > 0) {
    liqFactor = 0.1;
    liqStatus = 'risk';
  } else if (coberturaRatio < 1 || params.pagosVencidosCount > 0) {
    liqFactor = 0.32;
    liqStatus = 'risk';
  } else if (coberturaRatio < 1.5 || (runwayDias !== null && runwayDias < 7)) {
    liqFactor = 0.62;
    liqStatus = 'warn';
  } else if (runwayDias !== null && runwayDias < 14) {
    liqFactor = 0.8;
    liqStatus = 'ok';
  } else {
    liqFactor = 1;
    liqStatus = 'ok';
  }
  const liqScore = Math.round(wLiquidez * liqFactor);
  const liqParts: string[] = [];
  if (runwayDias !== null) liqParts.push(`${runwayDias}d oxígeno`);
  if (params.compromisos15dCount > 0) liqParts.push(`${fmtMoney(params.compromisos15dTotal)} en 15d`);
  else liqParts.push('sin vencimientos en 15d');
  if (params.deudaTarjetaPauta > 0) liqParts.push(`Pauta -${fmtMoney(params.deudaTarjetaPauta)}`);

  // 3. Cobro en calle (COD)
  const baseEfectivoCalle = Math.max(params.liquidezPositiva, 0) + params.entregadosSinLiquidar;
  const pctRetenido =
    baseEfectivoCalle > 0 ? (params.entregadosSinLiquidar / baseEfectivoCalle) * 100 : 0;
  let calleFactor = 1;
  let calleStatus: 'ok' | 'warn' | 'risk' = 'ok';
  if (params.entregadosSinLiquidar <= 0) {
    calleFactor = 1;
    calleStatus = 'ok';
  } else if (pctRetenido >= 55) {
    calleFactor = 0.2;
    calleStatus = 'risk';
  } else if (pctRetenido >= 30) {
    calleFactor = 0.55;
    calleStatus = 'warn';
  } else {
    calleFactor = 0.85;
    calleStatus = 'ok';
  }
  const calleScore = Math.round(wCalle * calleFactor);
  const calleSummary =
    params.entregadosSinLiquidar > 0
      ? `${fmtMoney(params.entregadosSinLiquidar)} sin depositar (${pctRetenido.toFixed(0)}% del efectivo)`
      : 'Todo entregado está liquidado';

  const pillars: ServerFinancialHealthSnapshot['pillars'] = [
    { id: 'margen', label: 'Margen operativo', score: margenScore, maxScore: wMargen, summary: margenSummary, status: margenStatus },
    { id: 'liquidez', label: 'Liquidez y vencimientos', score: liqScore, maxScore: wLiquidez, summary: liqParts.join(' · '), status: liqStatus },
    { id: 'calle', label: 'Cobro en calle (COD)', score: calleScore, maxScore: wCalle, summary: calleSummary, status: calleStatus },
  ];

  let totalScore = margenScore + liqScore + calleScore;
  if (params.hasBudgets && params.budgetPct !== null) {
    let budFactor = 1;
    let budStatus: 'ok' | 'warn' | 'risk' = 'ok';
    if (params.budgetPct > 100) {
      budFactor = 0.2;
      budStatus = 'risk';
    } else if (params.budgetPct > 85) {
      budFactor = 0.6;
      budStatus = 'warn';
    }
    const budScore = Math.round(wPresupuesto * budFactor);
    totalScore += budScore;
    pillars.push({
      id: 'presupuesto',
      label: 'Control presupuestos',
      score: budScore,
      maxScore: wPresupuesto,
      summary: `${params.budgetPct.toFixed(0)}% ejecutado en el mes`,
      status: budStatus,
    });
  }

  const score = Math.max(0, Math.min(100, totalScore));
  const estado: 'Saludable' | 'Atención' | 'Riesgo' =
    score >= 75 ? 'Saludable' : score >= 45 ? 'Atención' : 'Riesgo';
  const basePatrimonio = Math.max(params.liquidezPositiva, 0) + params.inventarioCosto + params.entregadosSinLiquidar;
  const pctCapitalAtrapado =
    basePatrimonio > 0 ? ((params.inventarioCosto + params.entregadosSinLiquidar) / basePatrimonio) * 100 : 0;

  return { score, estado, runwayDias, pctCapitalAtrapado, pillars };
}

async function computeServerFinancialHealthSnapshot(
  supabase: any,
  svTodayIso: string,
  preloaded?: {
    accounts?: any[];
    stockRows?: any[];
    variantRows?: any[];
    pagosRows?: any[];
    deliveredUnliq?: any[];
    inRouteList?: any[];
  }
): Promise<ServerFinancialHealthSnapshot> {
  const monthKey = svTodayIso.slice(0, 7);
  const monthStart = `${monthKey}-01`;
  const minus30 = addDaysYmdUtc(svTodayIso, -29);
  const plus15 = addDaysYmdUtc(svTodayIso, 15);
  const daysInPeriod = Math.max(Number(svTodayIso.slice(8, 10)) || 1, 1);

  const [accounts, txRes, budgetsRes, stockRows, variantRows, pagosRows, unliqData, cutoffRes] =
    await Promise.all([
      preloaded?.accounts
        ? Promise.resolve(preloaded.accounts)
        : fetchCashAccounts(supabase, { allowFallbackMock: false }),
      supabase
        .from('finance_money_transactions')
        .select('id,tipo,categoria,monto,fecha,created_at')
        .order('fecha', { ascending: false })
        .limit(1500),
      supabase
        .from('finance_budgets')
        .select('categoria,monto_limite,periodo')
        .eq('periodo', monthKey),
      preloaded?.stockRows
        ? Promise.resolve(preloaded.stockRows)
        : supabase
            .from('inventory_stock')
            .select('sku,nombre,template_id,stock_fisico,stock_disponible,costo_unitario,precio_venta,activo')
            .then((r: any) => (Array.isArray(r?.data) ? r.data : [])),
      preloaded?.variantRows
        ? Promise.resolve(preloaded.variantRows)
        : supabase
            .from('productos_variantes')
            .select('variante_id,template_id,sku')
            .then((r: any) => (Array.isArray(r?.data) ? r.data : [])),
      preloaded?.pagosRows
        ? Promise.resolve(preloaded.pagosRows)
        : supabase
            .from('panel_pagos')
            .select('id,nombre,monto,fecha_vencimiento,categoria')
            .then((r: any) => (Array.isArray(r?.data) ? r.data : [])),
      preloaded?.deliveredUnliq && preloaded?.inRouteList
        ? Promise.resolve({
            delivered: preloaded.deliveredUnliq,
            inRoute: preloaded.inRouteList,
          })
        : supabase
            .from('whatsapp_orders')
            .select('estado,total,liquidado')
            .in('estado', ['en_camino', 'en_ruta', 'en ruta', 'despachado', 'enviado', 'ruta', 'en camino', 'entregado', 'entregada', 'completado', 'completada'])
            .or('liquidado.is.null,liquidado.eq.false')
            .limit(1500)
            .then((r: any) => {
              const rows = Array.isArray(r?.data) ? r.data : [];
              return {
                delivered: rows.filter(
                  (o: any) => normalizeEstadoOrder(o.estado) === 'entregado' && o.liquidado !== true
                ),
                inRoute: rows.filter((o: any) => normalizeEstadoOrder(o.estado) === 'en_camino'),
              };
            }),
      supabase
        .from('os_events')
        .select('type,payload,created_at')
        .in('type', ['system.finance_reset', 'system.finance_cutoff_cleared'])
        .order('created_at', { ascending: false })
        .limit(1),
    ]);

  let cutoffIso: string | null = null;
  const latestCutoffEv = Array.isArray(cutoffRes?.data) && cutoffRes.data.length > 0 ? cutoffRes.data[0] : null;
  if (latestCutoffEv && latestCutoffEv.type === 'system.finance_reset' && latestCutoffEv.payload?.finance_cutoff) {
    cutoffIso = String(latestCutoffEv.payload.finance_cutoff);
  }

  const allTxsRaw = Array.isArray(txRes?.data) ? txRes.data : [];
  const activeTxs = cutoffIso
    ? allTxsRaw.filter((tx: any) => {
        const cutoffMs = new Date(cutoffIso!).getTime();
        if (Number.isNaN(cutoffMs)) return true;
        if (tx.created_at) {
          const recMs = new Date(tx.created_at).getTime();
          if (!Number.isNaN(recMs)) return recMs >= cutoffMs;
        }
        const txDate = String(tx.fecha || '').slice(0, 10);
        if (txDate) return txDate >= cutoffIso!.slice(0, 10);
        return true;
      })
    : allTxsRaw;

  const extractYmd = (tx: any): string => {
    if (tx.fecha && /^\d{4}-\d{2}-\d{2}/.test(String(tx.fecha))) return String(tx.fecha).slice(0, 10);
    if (tx.created_at) {
      const ms = new Date(tx.created_at).getTime();
      if (Number.isFinite(ms)) return new Date(ms - 6 * 3600000).toISOString().slice(0, 10);
    }
    return svTodayIso;
  };

  let ingresos = 0;
  let egresosOperativos = 0;
  let comprasInventario = 0;
  let last30OpEx = 0;
  const monthExpenseByCat = new Map<string, number>();

  for (const tx of activeTxs) {
    const ymd = extractYmd(tx);
    const monto = Number(tx.monto) || 0;
    const cat = String(tx.categoria || '').trim().toLowerCase();
    const isTransfer = tx.tipo === 'transfer';
    const isAdj = cat === 'ajuste_saldo';

    if (ymd >= minus30 && ymd <= svTodayIso && !isTransfer && !isAdj && tx.tipo === 'expense' && !isInventoryPurchaseCatServer(cat)) {
      last30OpEx += monto;
    }

    if (ymd >= monthStart && ymd <= svTodayIso) {
      if (isTransfer || isAdj) continue;
      if (tx.tipo === 'income') {
        ingresos += monto;
      } else if (tx.tipo === 'expense') {
        monthExpenseByCat.set(cat, (monthExpenseByCat.get(cat) || 0) + monto);
        if (isInventoryPurchaseCatServer(cat)) comprasInventario += monto;
        else egresosOperativos += monto;
      }
    }
  }

  const utilidadOperativa = ingresos - egresosOperativos;
  const flujoNetoCaja = ingresos - egresosOperativos - comprasInventario;
  const margenOperativoPct =
    ingresos > 0 ? (utilidadOperativa / ingresos) * 100 : egresosOperativos > 0 ? -100 : 0;

  // Deduplicar filas hijas de variantes en inventario para el valor real al costo
  const variantSkuSet = new Set(
    (variantRows || []).map((v: any) => String(v.sku || '').trim().toUpperCase()).filter(Boolean)
  );
  const dupChildSkus = new Set<string>();
  const rowsByTpl = new Map<string, any[]>();
  for (const s of stockRows || []) {
    const tId = s.template_id !== undefined && s.template_id !== null ? String(s.template_id).trim() : '';
    if (!tId) continue;
    const arr = rowsByTpl.get(tId) || [];
    arr.push(s);
    rowsByTpl.set(tId, arr);
  }
  rowsByTpl.forEach((rows) => {
    if (rows.length <= 1) return;
    const sorted = [...rows].sort((a, b) => {
      const aV = variantSkuSet.has(String(a.sku || '').trim().toUpperCase()) ? 1 : 0;
      const bV = variantSkuSet.has(String(b.sku || '').trim().toUpperCase()) ? 1 : 0;
      if (aV !== bV) return aV - bV;
      return String(a.sku || '').length - String(b.sku || '').length;
    });
    const pSku = String(sorted[0]?.sku || '').trim().toUpperCase();
    for (let i = 1; i < sorted.length; i++) {
      const cSku = String(sorted[i]?.sku || '').trim().toUpperCase();
      if (cSku && (variantSkuSet.has(cSku) || cSku.startsWith(`${pSku}-`))) dupChildSkus.add(cSku);
    }
  });

  let inventarioCosto = 0;
  let unidadesFisicas = 0;
  let skusActivosCount = 0;
  let skusSinCostoCount = 0;
  for (const item of stockRows || []) {
    const skuU = String(item.sku || '').trim().toUpperCase();
    if (!skuU || skuU.includes('FEE') || dupChildSkus.has(skuU) || item.activo === false) continue;
    skusActivosCount++;
    const fisico = Math.max(Number(item.stock_fisico ?? item.stock_disponible ?? 0) || 0, 0);
    const costo = Math.max(Number(item.costo_unitario) || 0, 0);
    unidadesFisicas += fisico;
    inventarioCosto += fisico * costo;
    if (fisico > 0 && costo <= 0) skusSinCostoCount++;
  }

  const liquidezNeta = (accounts || []).reduce((s: number, a: any) => s + (Number(a.saldo_actual) || 0), 0);
  const liquidezPositiva = (accounts || []).reduce(
    (s: number, a: any) => s + Math.max(Number(a.saldo_actual) || 0, 0),
    0
  );
  const deudaTarjetaPauta = (accounts || []).reduce((s: number, a: any) => {
    const v = Number(a.saldo_actual) || 0;
    return v < 0 ? s + Math.abs(v) : s;
  }, 0);

  const entregadosList = unliqData.delivered || [];
  const enRutaList = unliqData.inRoute || [];
  const entregadosSinLiquidar = entregadosList.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const enRutaPotencial = enRutaList.reduce((s: number, o: any) => s + (Number(o.total) || 0), 0);
  const valorTotalReal = liquidezNeta + inventarioCosto + entregadosSinLiquidar;

  let compromisos15dTotal = 0;
  let compromisos15dCount = 0;
  let pagosVencidosCount = 0;
  for (const p of pagosRows || []) {
    const fecha = String(p.fecha_vencimiento || '').slice(0, 10);
    if (!fecha) continue;
    if (fecha < svTodayIso) {
      pagosVencidosCount++;
      compromisos15dTotal += Number(p.monto) || 0;
      compromisos15dCount++;
    } else if (fecha <= plus15) {
      compromisos15dTotal += Number(p.monto) || 0;
      compromisos15dCount++;
    }
  }

  const budgetRows = Array.isArray(budgetsRes?.data) ? budgetsRes.data : [];
  const totalPresupuestado = budgetRows.reduce((s: number, b: any) => s + (Number(b.monto_limite) || 0), 0);
  const totalGastadoBudgets = budgetRows.reduce((s: number, b: any) => {
    const cat = String(b.categoria || '').trim().toLowerCase();
    return s + (monthExpenseByCat.get(cat) || 0);
  }, 0);
  const hasBudgets = totalPresupuestado > 0;
  const budgetPct = hasBudgets ? (totalGastadoBudgets / totalPresupuestado) * 100 : null;

  const gastoDiarioPromedio =
    last30OpEx > 0 ? last30OpEx / 30 : egresosOperativos / Math.max(daysInPeriod, 1);

  const core = evaluateCoreHealthServer({
    ingresos,
    egresosOperativos,
    utilidadOperativa,
    margenOperativoPct,
    liquidezNeta,
    liquidezPositiva,
    deudaTarjetaPauta,
    entregadosSinLiquidar,
    inventarioCosto,
    compromisos15dTotal,
    compromisos15dCount,
    pagosVencidosCount,
    gastoDiarioPromedio,
    budgetPct,
    hasBudgets,
  });

  let simulation: ServerFinancialHealthSnapshot['simulation'] = null;
  if (entregadosSinLiquidar > 0.5) {
    const simIng = ingresos + entregadosSinLiquidar;
    const simUtil = utilidadOperativa + entregadosSinLiquidar;
    const simMargen = simIng > 0 ? (simUtil / simIng) * 100 : 0;
    const simCore = evaluateCoreHealthServer({
      ingresos: simIng,
      egresosOperativos,
      utilidadOperativa: simUtil,
      margenOperativoPct: simMargen,
      liquidezNeta: liquidezNeta + entregadosSinLiquidar,
      liquidezPositiva: liquidezPositiva + entregadosSinLiquidar,
      deudaTarjetaPauta,
      entregadosSinLiquidar: 0,
      inventarioCosto,
      compromisos15dTotal,
      compromisos15dCount,
      pagosVencidosCount,
      gastoDiarioPromedio,
      budgetPct,
      hasBudgets,
    });
    simulation = {
      montoPorLiquidar: entregadosSinLiquidar,
      nuevaLiquidezNeta: liquidezNeta + entregadosSinLiquidar,
      nuevoScore: simCore.score,
      nuevoEstado: simCore.estado,
      mejoraPuntos: simCore.score - core.score,
    };
  }

  const findings: string[] = [];
  if (entregadosSinLiquidar > 0) {
    findings.push(
      `${entregadosList.length} pedido(s) entregado(s) sin depositar (${fmtMoney(entregadosSinLiquidar)}).`
    );
  }
  if (pagosVencidosCount > 0 || compromisos15dTotal > liquidezPositiva) {
    findings.push(
      pagosVencidosCount > 0
        ? `${pagosVencidosCount} pago(s) fijo(s) vencido(s) o por cubrir (${fmtMoney(compromisos15dTotal)} en 15d).`
        : `Compromisos próximos 15d (${fmtMoney(compromisos15dTotal)}) superan tu caja positiva (${fmtMoney(liquidezPositiva)}).`
    );
  } else if (compromisos15dCount > 0) {
    findings.push(
      `${compromisos15dCount} pago(s) próximo(s) en 15d (${fmtMoney(compromisos15dTotal)}), cubiertos por tu liquidez.`
    );
  }
  if (skusSinCostoCount > 0) {
    findings.push(`${skusSinCostoCount} producto(s) con stock pero costo en $0.00 (subestima valor real).`);
  }

  const monthNamesShort = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const mIdx = Math.max(0, Math.min(11, (Number(svTodayIso.slice(5, 7)) || 1) - 1));
  const periodLabel = `Del 1 al ${daysInPeriod} de ${monthNamesShort[mIdx]} ${svTodayIso.slice(0, 4)}`;

  return {
    periodLabel,
    cutoffIso,
    ingresos,
    egresosOperativos,
    comprasInventario,
    utilidadOperativa,
    flujoNetoCaja,
    margenOperativoPct,
    valorTotalReal,
    liquidezNeta,
    liquidezPositiva,
    deudaTarjetaPauta,
    inventarioCosto,
    unidadesFisicas,
    skusActivosCount,
    skusSinCostoCount,
    entregadosSinLiquidar,
    entregadosCount: entregadosList.length,
    enRutaPotencial,
    enRutaCount: enRutaList.length,
    score: core.score,
    estado: core.estado,
    runwayDias: core.runwayDias,
    gastoDiarioPromedio,
    compromisos15dTotal,
    compromisos15dCount,
    pagosVencidosCount,
    pctCapitalAtrapado: core.pctCapitalAtrapado,
    budgetPct,
    hasBudgets,
    pillars: core.pillars,
    findings: findings.slice(0, 3),
    simulation,
  };
}

async function handleFinancialHealthQuery(supabase: any, chatId: string | number) {
  const svToday = getElSalvadorDate();
  tgCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  const h = await computeServerFinancialHealthSnapshot(supabase, svToday);
  const badge = h.estado === 'Saludable' ? '🟢' : h.estado === 'Atención' ? '🟡' : '🔴';
  const runwayTxt = h.runwayDias !== null ? `${h.runwayDias} días` : 'N/A';

  const statusIcon = (s: 'ok' | 'warn' | 'risk') => (s === 'ok' ? '🟢' : s === 'warn' ? '🟡' : '🔴');

  const lines: string[] = [
    `🩺 <b>SALUD FINANCIERA · TODOENUNO OS</b>`,
    `🗓 <i>${escapeHtml(h.periodLabel)}</i>`,
    `━━━━━━━━━━━━━━`,
    `${badge} <b>Puntaje: ${h.score}/100 (${h.estado})</b>`,
    `• Oxígeno de caja: <b>${runwayTxt}</b> · Capital en bodega/calle: <b>${h.pctCapitalAtrapado.toFixed(0)}%</b>`,
    `• Compromisos próximos 15d: <b>${fmtMoney(h.compromisos15dTotal)}</b> (${h.compromisos15dCount} pago${h.compromisos15dCount === 1 ? '' : 's'}${h.pagosVencidosCount > 0 ? ` · ⚠️ ${h.pagosVencidosCount} venc.` : ''})`,
    '',
    `📋 <b>PILARES DE SALUD</b>`,
    ...h.pillars.map(
      (p) =>
        `• ${statusIcon(p.status)} <b>${escapeHtml(p.label)}: ${p.score}/${p.maxScore}</b> — ${escapeHtml(p.summary)}`
    ),
    '',
    `💎 <b>VALOR TOTAL REAL DEL NEGOCIO: ${fmtMoney(h.valorTotalReal)}</b>`,
    `• Liquidez neta en cuentas: <b>${fmtMoney(h.liquidezNeta)}</b>${h.deudaTarjetaPauta > 0 ? ` <i>(Tarjeta pauta -${fmtMoney(h.deudaTarjetaPauta)})</i>` : ''}`,
    `• Inventario al costo: <b>${fmtMoney(h.inventarioCosto)}</b> <i>(${h.unidadesFisicas} uds en ${h.skusActivosCount} SKUs)</i>`,
    `• Entregados sin liquidar: <b>${fmtMoney(h.entregadosSinLiquidar)}</b> <i>(${h.entregadosCount} guías)</i>`,
    h.enRutaCount > 0
      ? `• <i>Referencia en ruta: ${fmtMoney(h.enRutaPotencial)} (${h.enRutaCount} guías, no sumado)</i>`
      : '',
    '',
    `📊 <b>FLUJO DEL MES ACTUAL</b>`,
    `• Ingresos liquidados: <b>${fmtMoney(h.ingresos)}</b>`,
    `• Egresos operativos: <b>${fmtMoney(h.egresosOperativos)}</b> → Neto op.: <b>${h.utilidadOperativa >= 0 ? '+' : ''}${fmtMoney(h.utilidadOperativa)}</b> (${h.margenOperativoPct.toFixed(1)}%)`,
    `• Compras de inventario (stock): <b>${fmtMoney(h.comprasInventario)}</b> · Flujo caja: <b>${h.flujoNetoCaja >= 0 ? '+' : ''}${fmtMoney(h.flujoNetoCaja)}</b>`,
  ].filter(Boolean);

  if (h.simulation) {
    lines.push('');
    lines.push(
      `<blockquote>⚡ <b>Simulador rápido:</b> Si liquidas hoy los <b>${fmtMoney(h.simulation.montoPorLiquidar)}</b> entregados, tu liquidez sube a <b>${fmtMoney(h.simulation.nuevaLiquidezNeta)}</b> y tu salud pasa a <b>${h.simulation.nuevoScore}/100 (${h.simulation.nuevoEstado})</b>${h.simulation.mejoraPuntos > 0 ? ` (+${h.simulation.mejoraPuntos} pts)` : ''}.</blockquote>`
    );
  }

  if (h.findings.length > 0) {
    lines.push('');
    lines.push(`🔎 <b>HALLAZGOS PRIORITARIOS</b>`);
    for (const f of h.findings) {
      lines.push(`• ${escapeHtml(f)}`);
    }
  }

  await sendTgMessage(chatId, lines.join('\n'), { reply_markup: AI_QUICK_KEYBOARD });
}

/* ========================================================================== */
/* MOTOR DE INFERENCIA DE DATOS IA (6 CAPACIDADES PREDICTIVAS Y CAUSALES)     */
/* ========================================================================== */

interface ServerOperationalInference {
  svTodayIso: string;
  roasStartCutoffIso: string;
  sampleResolved60d: number;
  globalDeliveryRatePct: number;
  globalCancelRatePct: number;
  dailyAnomaly: {
    severity: 'ok' | 'positive' | 'warn' | 'alert';
    weekdayName: string;
    baselineDaysUsed: number;
    pacingFactor: number;
    chatsToday: number;
    baselineChatsPaced: number;
    ordersToday: number;
    baselineOrdersPaced: number;
    revenueToday: number;
    baselineRevenuePaced: number;
    verdict: string;
  };
  highRiskPreDispatch: Array<{
    orderId: string;
    cliente: string;
    total: number;
    estado: string;
    departamento: string;
    courier: string;
    riskPct: number;
    reasons: string[];
  }>;
  stockoutPredictions: Array<{
    sku: string;
    nombre: string;
    stockDisponible: number;
    encargosPendientes: number;
    weightedDailyRate: number;
    daysLeft: number;
    suggestedReorderQty: number;
    reorderCost: number;
    cashVerdict: string;
  }>;
  adEffectiveRoas: Array<{
    codigo: string;
    orders: number;
    delivered: number;
    cancelled: number;
    inProgress: number;
    deliveryRatePct: number | null;
    grossSales: number;
    deliveredRevenue: number;
    adSpend: number;
    cogsDelivered: number;
    grossRoas: number | null;
    effectiveRoas: number | null;
    netContribution: number;
    flag: 'ganador' | 'engañoso' | 'normal' | 'muestra_pequena';
  }>;
  counterfactualParams: {
    avgTicketDelivered: number;
    avgCogsPerOrder: number;
    avgGrossMarginPerOrder: number;
    dailyOperatingBurn: number;
    commitments15d: number;
    breakEvenOrdersPerDay: number | null;
    ordersPerDayFor25Net: number | null;
  };
}

function getSvHourDecimal(): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/El_Salvador',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 12);
    const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return h + m / 60;
  } catch {
    return 12;
  }
}

function getSvDayOfWeekName(isoYmd: string): { dow: number; name: string } {
  const names = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const dt = new Date(`${isoYmd}T12:00:00-06:00`);
  const dow = Number.isNaN(dt.getTime()) ? 0 : dt.getDay();
  return { dow, name: names[dow] || 'día' };
}

function extractUnitQtySimple(order: any): number {
  const q = Number(order?.cantidad);
  if (Number.isFinite(q) && q > 0) return Math.min(Math.round(q), 50);
  if (Array.isArray(order?.items) && order.items.length > 0) {
    const sum = order.items.reduce((acc: number, it: any) => {
      const iq = Number(it?.cantidad ?? it?.qty ?? 1);
      return acc + (Number.isFinite(iq) && iq > 0 ? Math.round(iq) : 1);
    }, 0);
    if (sum > 0) return Math.min(sum, 50);
  }
  const m = String(order?.sku || '').match(/(?:^|\s)(\d+)\s*x(?:\s|$)/i);
  if (m?.[1]) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 30) return n;
  }
  return 1;
}

async function computeServerOperationalInference(
  supabase: any,
  svTodayIso: string,
  preloaded?: {
    finHealth?: ServerFinancialHealthSnapshot;
    catalog?: any[];
    convs?: any[];
  }
): Promise<ServerOperationalInference> {
  const d60CutoffUtc = new Date(Date.now() - 60 * 86400000).toISOString();
  const d60DateIso = new Date(Date.now() - 60 * 86400000 - 6 * 3600000).toISOString().slice(0, 10);
  const d14DateIso = new Date(Date.now() - 13 * 86400000 - 6 * 3600000).toISOString().slice(0, 10);
  const d7DateIso = new Date(Date.now() - 6 * 86400000 - 6 * 3600000).toISOString().slice(0, 10);

  const [ordersRes, adsRes, catalogRows, convRows, roasCutoffDoc, finHealth] = await Promise.all([
    supabase
      .from('whatsapp_orders')
      .select(
        'id,pedido_codigo,nombre_cliente,telefono,sku,catalogo_sku,cantidad,items,total,estado,departamento,courier,codigo_anuncio,motivo_cancelacion,liquidado,fecha_programada,created_at'
      )
      .gte('created_at', d60CutoffUtc)
      .order('created_at', { ascending: false })
      .limit(2500),
    supabase
      .from('gastos_publicidad')
      .select('monto,fecha,codigo_anuncio')
      .gte('fecha', d60DateIso)
      .lte('fecha', svTodayIso)
      .limit(1500),
    preloaded?.catalog
      ? Promise.resolve(preloaded.catalog)
      : fetchActiveStockCatalog(supabase),
    preloaded?.convs
      ? Promise.resolve(preloaded.convs)
      : supabase
          .from('bb_conversations')
          .select('id,contact_phone,updated_at')
          .gte('updated_at', new Date(Date.now() - 30 * 86400000).toISOString())
          .limit(600)
          .then((r: any) => (Array.isArray(r?.data) ? r.data : []))
          .catch(() => []),
    supabase
      .from('panel_docs')
      .select('contenido')
      .eq('titulo', '__SYSTEM_ROAS_START_V1__')
      .maybeSingle()
      .then((r: any) => r?.data?.contenido || null)
      .catch(() => null),
    preloaded?.finHealth
      ? Promise.resolve(preloaded.finHealth)
      : computeServerFinancialHealthSnapshot(supabase, svTodayIso),
  ]);

  let roasStartCutoffIso = '2026-11-19';
  if (roasCutoffDoc) {
    try {
      const parsed = JSON.parse(roasCutoffDoc);
      if (parsed?.startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(parsed.startDate))) {
        roasStartCutoffIso = String(parsed.startDate);
      }
    } catch {}
  }

  const orders = Array.isArray(ordersRes?.data) ? ordersRes.data : [];
  const ads = Array.isArray(adsRes?.data) ? adsRes.data : [];
  const catalog = Array.isArray(catalogRows) ? catalogRows : [];
  const convs = Array.isArray(convRows) ? convRows : [];

  const catalogBySku = new Map<string, any>();
  for (const c of catalog) {
    const k = String(c.sku || '').trim().toUpperCase();
    if (k) catalogBySku.set(k, c);
  }

  const resolveOrderSkuCost = (o: any): { skuKey: string; unitCost: number } => {
    const rawCat = String(o.catalogo_sku || '').trim().toUpperCase();
    if (rawCat && catalogBySku.has(rawCat)) {
      return { skuKey: rawCat, unitCost: Number(catalogBySku.get(rawCat)?.costo_unitario || 0) };
    }
    const rawSku = String(o.sku || '').trim().toUpperCase();
    if (rawSku && catalogBySku.has(rawSku)) {
      return { skuKey: rawSku, unitCost: Number(catalogBySku.get(rawSku)?.costo_unitario || 0) };
    }
    for (const [k, item] of catalogBySku.entries()) {
      const itemName = String(item.nombre || '').toUpperCase();
      if (
        (rawSku && (rawSku.includes(k) || (itemName && rawSku.includes(itemName.slice(0, 12))))) ||
        (rawCat && k.startsWith(rawCat.split('-')[0]))
      ) {
        return { skuKey: k, unitCost: Number(item.costo_unitario || 0) };
      }
    }
    return { skuKey: rawCat || rawSku.split(' ')[0] || '', unitCost: 0 };
  };

  /* ---------------------------------------------------------------------- */
  /* A. ESTADÍSTICAS HISTÓRICAS 60D + SCORING DE RIESGO PRE-DESPACHO        */
  /* ---------------------------------------------------------------------- */
  let totalResolved = 0;
  let totalDelivered = 0;
  let totalCancelled = 0;
  let sumTicketDelivered = 0;
  let sumCogsDelivered = 0;
  let countDeliveredWithCogs = 0;

  const deptHist = new Map<string, { resolved: number; cancelled: number }>();
  const courierHist = new Map<string, { resolved: number; cancelled: number }>();
  const skuHist = new Map<string, { resolved: number; cancelled: number }>();
  const phoneCancels = new Map<string, number>();

  const dailyOrdersMap = new Map<string, { orders: number; revenue: number }>();
  const skuUnits7d = new Map<string, number>();
  const skuUnits14d = new Map<string, number>();
  const skuScheduled = new Map<string, number>();

  const adAgg = new Map<
    string,
    {
      orders: number;
      delivered: number;
      cancelled: number;
      inProgress: number;
      grossSales: number;
      deliveredRevenue: number;
      cogsDelivered: number;
      adSpend: number;
    }
  >();

  for (const o of orders) {
    const est = normalizeEstadoOrder(o.estado) || 'nuevo';
    const svDay = o.created_at
      ? new Date(new Date(o.created_at).getTime() - 6 * 3600000).toISOString().slice(0, 10)
      : '';
    const qty = extractUnitQtySimple(o);
    const total = Number(o.total || 0);
    const { skuKey, unitCost } = resolveOrderSkuCost(o);
    const dept = String(o.departamento || '').trim();
    const courier = String(o.courier || '').trim();
    const phoneDigits = String(o.telefono || '').replace(/\D/g, '').slice(-8);

    // Línea base diaria (no cancelados)
    if (svDay && est !== 'cancelado') {
      const dm = dailyOrdersMap.get(svDay) || { orders: 0, revenue: 0 };
      dm.orders += 1;
      dm.revenue += total;
      dailyOrdersMap.set(svDay, dm);
    }

    // Velocidad de stock (7d / 14d) + encargos futuros
    if (skuKey) {
      if (est === 'programado') {
        skuScheduled.set(skuKey, (skuScheduled.get(skuKey) || 0) + qty);
      } else if (est !== 'cancelado') {
        if (svDay >= d7DateIso) {
          skuUnits7d.set(skuKey, (skuUnits7d.get(skuKey) || 0) + qty);
        }
        if (svDay >= d14DateIso) {
          skuUnits14d.set(skuKey, (skuUnits14d.get(skuKey) || 0) + qty);
        }
      }
    }

    // Resueltos para probabilidades empíricas
    if (est === 'entregado' || est === 'cancelado') {
      totalResolved += 1;
      const isCanc = est === 'cancelado';
      if (isCanc) {
        totalCancelled += 1;
        if (phoneDigits.length >= 8) {
          phoneCancels.set(phoneDigits, (phoneCancels.get(phoneDigits) || 0) + 1);
        }
      } else {
        totalDelivered += 1;
        sumTicketDelivered += total;
        if (unitCost > 0) {
          sumCogsDelivered += unitCost * qty;
          countDeliveredWithCogs += 1;
        }
      }

      if (dept) {
        const dH = deptHist.get(dept) || { resolved: 0, cancelled: 0 };
        dH.resolved += 1;
        if (isCanc) dH.cancelled += 1;
        deptHist.set(dept, dH);
      }
      if (courier) {
        const cH = courierHist.get(courier) || { resolved: 0, cancelled: 0 };
        cH.resolved += 1;
        if (isCanc) cH.cancelled += 1;
        courierHist.set(courier, cH);
      }
      if (skuKey) {
        const sH = skuHist.get(skuKey) || { resolved: 0, cancelled: 0 };
        sH.resolved += 1;
        if (isCanc) sH.cancelled += 1;
        skuHist.set(skuKey, sH);
      }
    }

    // ROAS real ajustado por entrega (desde roasStartCutoffIso o últimos 30d si no hay aún post-corte)
    const adCode = String(o.codigo_anuncio || '').trim().toUpperCase();
    if (adCode && adCode !== 'ORGANICO' && adCode !== 'ORGÁNICO') {
      const includeByDate = svDay >= roasStartCutoffIso || svDay >= d14DateIso;
      if (includeByDate) {
        const a = adAgg.get(adCode) || {
          orders: 0,
          delivered: 0,
          cancelled: 0,
          inProgress: 0,
          grossSales: 0,
          deliveredRevenue: 0,
          cogsDelivered: 0,
          adSpend: 0,
        };
        a.orders += 1;
        if (est !== 'cancelado') a.grossSales += total;
        if (est === 'entregado') {
          a.delivered += 1;
          a.deliveredRevenue += total;
          a.cogsDelivered += unitCost * qty;
        } else if (est === 'cancelado') {
          a.cancelled += 1;
        } else {
          a.inProgress += 1;
        }
        adAgg.set(adCode, a);
      }
    }
  }

  for (const ad of ads) {
    const f = String(ad.fecha || '').slice(0, 10);
    if (f < roasStartCutoffIso) continue;
    const code = String(ad.codigo_anuncio || 'GENERAL').trim().toUpperCase();
    if (!code || code === 'GENERAL') continue;
    const a = adAgg.get(code) || {
      orders: 0,
      delivered: 0,
      cancelled: 0,
      inProgress: 0,
      grossSales: 0,
      deliveredRevenue: 0,
      cogsDelivered: 0,
      adSpend: 0,
    };
    a.adSpend += Number(ad.monto || 0);
    adAgg.set(code, a);
  }

  const globalCancelRate = totalResolved > 0 ? totalCancelled / totalResolved : 0.18;
  const globalDeliveryRatePct = totalResolved > 0 ? (totalDelivered / totalResolved) * 100 : 82;
  const globalCancelRatePct = 100 - globalDeliveryRatePct;

  // Evaluar pedidos activos PRE-DESPACHO ('nuevo' y 'por_empacar') con suavizado Bayesiano
  const PRIOR_WEIGHT = 5;
  const smoothedRate = (h?: { resolved: number; cancelled: number }) => {
    if (!h || h.resolved < 3) return null;
    return (h.cancelled + PRIOR_WEIGHT * globalCancelRate) / (h.resolved + PRIOR_WEIGHT);
  };

  const highRiskPreDispatch: ServerOperationalInference['highRiskPreDispatch'] = [];
  for (const o of orders) {
    const est = normalizeEstadoOrder(o.estado) || 'nuevo';
    if (est !== 'nuevo' && est !== 'por_empacar') continue;

    const dept = String(o.departamento || '').trim();
    const courier = String(o.courier || '').trim();
    const { skuKey } = resolveOrderSkuCost(o);
    const phoneDigits = String(o.telefono || '').replace(/\D/g, '').slice(-8);
    const prevCanc = phoneDigits.length >= 8 ? phoneCancels.get(phoneDigits) || 0 : 0;

    const signals: Array<{ rate: number; reason: string }> = [];
    const dRate = smoothedRate(dept ? deptHist.get(dept) : undefined);
    if (dRate !== null && dRate > globalCancelRate + 0.06) {
      const h = deptHist.get(dept)!;
      signals.push({
        rate: dRate,
        reason: `${dept} (${Math.round((h.cancelled / h.resolved) * 100)}% canc. en ${h.resolved} ped.)`,
      });
    }
    const cRate = smoothedRate(courier ? courierHist.get(courier) : undefined);
    if (cRate !== null && cRate > globalCancelRate + 0.06) {
      const h = courierHist.get(courier)!;
      signals.push({
        rate: cRate,
        reason: `${courier} (${Math.round((h.cancelled / h.resolved) * 100)}% canc. en ${h.resolved} ped.)`,
      });
    }
    const sRate = smoothedRate(skuKey ? skuHist.get(skuKey) : undefined);
    if (sRate !== null && sRate > globalCancelRate + 0.08) {
      const h = skuHist.get(skuKey)!;
      signals.push({
        rate: sRate,
        reason: `SKU ${skuKey} (${Math.round((h.cancelled / h.resolved) * 100)}% canc. en ${h.resolved} ped.)`,
      });
    }

    let combinedRisk =
      signals.length > 0
        ? signals.reduce((acc, s) => acc + s.rate, 0) / signals.length
        : globalCancelRate;

    const reasons = signals.map((s) => s.reason);
    if (prevCanc >= 1) {
      combinedRisk = Math.min(0.92, Math.max(combinedRisk + 0.35, 0.65));
      reasons.unshift(`Teléfono con ${prevCanc} cancelación(es) previa(s)`);
    }

    const riskPct = Math.round(combinedRisk * 100);
    if (riskPct >= 30 || prevCanc >= 1) {
      highRiskPreDispatch.push({
        orderId: String(o.id),
        cliente: String(o.nombre_cliente || 'Cliente'),
        total: Number(o.total || 0),
        estado: est,
        departamento: dept || 'Sin depto',
        courier: courier || 'Sin asignar',
        riskPct,
        reasons: reasons.slice(0, 2),
      });
    }
  }
  highRiskPreDispatch.sort((a, b) => b.riskPct - a.riskPct);

  /* ---------------------------------------------------------------------- */
  /* B. DIAGNÓSTICO CAUSAL DE ANOMALÍAS HOY (AJUSTADO A HORA ACTUAL SV)     */
  /* ---------------------------------------------------------------------- */
  const { dow: todayDow, name: weekdayName } = getSvDayOfWeekName(svTodayIso);
  const svHour = getSvHourDecimal();
  // Ventana comercial activa 8:00 AM - 9:00 PM (13h): escala proporcional para no dar falsas alarmas temprano
  const pacingFactor = Math.min(1, Math.max(0.18, (svHour - 8) / 13));

  const dailyChatsMap = new Map<string, number>();
  for (const c of convs) {
    const svDay = c.updated_at
      ? new Date(new Date(c.updated_at).getTime() - 6 * 3600000).toISOString().slice(0, 10)
      : '';
    if (svDay) dailyChatsMap.set(svDay, (dailyChatsMap.get(svDay) || 0) + 1);
  }

  const sameWeekdayDays: string[] = [];
  const last14Days: string[] = [];
  for (let i = 1; i <= 28; i++) {
    const iso = new Date(Date.now() - i * 86400000 - 6 * 3600000).toISOString().slice(0, 10);
    if (i <= 14) last14Days.push(iso);
    if (getSvDayOfWeekName(iso).dow === todayDow) sameWeekdayDays.push(iso);
  }

  const refDays = sameWeekdayDays.length >= 2 ? sameWeekdayDays : last14Days;
  const baselineOrdersFull =
    refDays.reduce((s, d) => s + (dailyOrdersMap.get(d)?.orders || 0), 0) / Math.max(1, refDays.length);
  const baselineRevenueFull =
    refDays.reduce((s, d) => s + (dailyOrdersMap.get(d)?.revenue || 0), 0) / Math.max(1, refDays.length);
  const baselineChatsFull =
    refDays.reduce((s, d) => s + (dailyChatsMap.get(d) || 0), 0) / Math.max(1, refDays.length);

  const baselineOrdersPaced = Math.round(baselineOrdersFull * pacingFactor * 10) / 10;
  const baselineRevenuePaced = Math.round(baselineRevenueFull * pacingFactor * 100) / 100;
  const baselineChatsPaced = Math.round(baselineChatsFull * pacingFactor * 10) / 10;

  const ordersToday = dailyOrdersMap.get(svTodayIso)?.orders || 0;
  const revenueToday = dailyOrdersMap.get(svTodayIso)?.revenue || 0;
  const chatsToday = dailyChatsMap.get(svTodayIso) || 0;

  let anomalySeverity: 'ok' | 'positive' | 'warn' | 'alert' = 'ok';
  let anomalyVerdict = '';
  if (svHour < 10.5) {
    anomalyVerdict = `Jornada arrancando (${ordersToday} ped. · ${chatsToday} chats activos). Aún temprano para diagnosticar desvío.`;
  } else if (baselineOrdersPaced < 1.5) {
    anomalyVerdict = `Muestra histórica pequeña para los ${weekdayName} (${ordersToday} ped. hoy vs prom. ${baselineOrdersPaced}).`;
  } else {
    const orderRatio = ordersToday / Math.max(0.5, baselineOrdersPaced);
    const chatRatio = baselineChatsPaced >= 2 ? chatsToday / baselineChatsPaced : 1;

    if (orderRatio >= 1.3) {
      anomalySeverity = 'positive';
      anomalyVerdict = `Ritmo fuerte (+${Math.round((orderRatio - 1) * 100)}% vs ${weekdayName} típico): ${ordersToday} ped. vs ${baselineOrdersPaced} esperados a esta hora.`;
    } else if (orderRatio <= 0.65) {
      anomalySeverity = orderRatio <= 0.45 ? 'alert' : 'warn';
      if (chatRatio >= 0.85) {
        anomalyVerdict = `Caída de cierre (-${Math.round((1 - orderRatio) * 100)}% pedidos), PERO chats en ritmo normal (${chatsToday} vs ${baselineChatsPaced}). El cuello de botella hoy está en conversión/objeciones, no en tráfico.`;
      } else {
        anomalyVerdict = `Caída de tráfico (-${Math.round((1 - chatRatio) * 100)}% chats y -${Math.round((1 - orderRatio) * 100)}% pedidos vs un ${weekdayName} normal). Revisa entrega de pauta en Meta Ads.`;
      }
    } else {
      anomalyVerdict = `Ritmo normal para un ${weekdayName} a esta hora (${ordersToday} ped. vs ${baselineOrdersPaced} esperados · ${chatsToday} chats).`;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* C. PREDICCIÓN DE QUIEBRE DE STOCK CRUZADA CON CAJA Y ENCARGOS          */
  /* ---------------------------------------------------------------------- */
  const stockoutPredictions: ServerOperationalInference['stockoutPredictions'] = [];
  const availableCashNow = finHealth.liquidezNeta;
  const cashAfterLiq = finHealth.liquidezNeta + finHealth.entregadosSinLiquidar;
  const dailyBurn =
    finHealth.runwayDias && finHealth.runwayDias > 0 && finHealth.liquidezNeta > 0
      ? finHealth.liquidezNeta / finHealth.runwayDias
      : finHealth.egresosOperativos / Math.max(1, new Date().getDate());

  for (const c of catalog) {
    if (c.activo === false) continue;
    const skuKey = String(c.sku || '').trim().toUpperCase();
    if (!skuKey) continue;
    const u7 = skuUnits7d.get(skuKey) || 0;
    const u14 = skuUnits14d.get(skuKey) || 0;
    const weightedDailyRate = 0.65 * (u7 / 7) + 0.35 * (u14 / 14);
    if (weightedDailyRate < 0.2) continue;

    const disp = Number(c.stock_disponible ?? c.stock_fisico ?? 0);
    const enc = skuScheduled.get(skuKey) || 0;
    const netFree = Math.max(0, disp - enc);
    const daysLeft = netFree / weightedDailyRate;

    if (daysLeft <= 10) {
      const suggestedReorderQty = Math.max(10, Math.ceil(weightedDailyRate * 14));
      const unitCost = Number(c.costo_unitario || 0);
      const reorderCost = Math.round(suggestedReorderQty * unitCost * 100) / 100;

      let cashVerdict = 'Sin costo unitario cargado';
      if (reorderCost > 0) {
        const cashLeftNow = availableCashNow - reorderCost;
        const runwayAfterNow = dailyBurn > 0 ? Math.round(cashLeftNow / dailyBurn) : 99;
        const cashLeftAfterLiq = cashAfterLiq - reorderCost;
        if (cashLeftNow >= 0 && runwayAfterNow >= 20) {
          cashVerdict = `Financiable hoy ($${reorderCost.toFixed(2)} · oxígeno queda en ~${runwayAfterNow}d)`;
        } else if (cashLeftAfterLiq >= 0 && finHealth.entregadosSinLiquidar > 0) {
          cashVerdict = `Liquida primero ($${finHealth.entregadosSinLiquidar.toFixed(2)} en calle) para cubrir $${reorderCost.toFixed(2)}`;
        } else {
          cashVerdict = `Caja ajustada para $${reorderCost.toFixed(2)} — pedir lote parcial`;
        }
      }

      stockoutPredictions.push({
        sku: skuKey,
        nombre: String(c.nombre || skuKey),
        stockDisponible: disp,
        encargosPendientes: enc,
        weightedDailyRate,
        daysLeft,
        suggestedReorderQty,
        reorderCost,
        cashVerdict,
      });
    }
  }
  stockoutPredictions.sort((a, b) => a.daysLeft - b.daysLeft);

  /* ---------------------------------------------------------------------- */
  /* D. ROAS REAL AJUSTADO POR ENTREGA Y CONTRIBUCIÓN NETA POR ANUNCIO      */
  /* ---------------------------------------------------------------------- */
  const adEffectiveRoas: ServerOperationalInference['adEffectiveRoas'] = Array.from(adAgg.entries())
    .map(([codigo, a]) => {
      const resolved = a.delivered + a.cancelled;
      const deliveryRatePct = resolved > 0 ? (a.delivered / resolved) * 100 : null;
      const grossRoas = a.adSpend > 0 ? a.grossSales / a.adSpend : null;
      const effectiveRoas = a.adSpend > 0 ? a.deliveredRevenue / a.adSpend : null;
      const netContribution = a.deliveredRevenue - a.cogsDelivered - a.adSpend;

      let flag: 'ganador' | 'engañoso' | 'normal' | 'muestra_pequena' = 'normal';
      if (resolved < 4) {
        flag = 'muestra_pequena';
      } else if (deliveryRatePct !== null && deliveryRatePct < 65) {
        flag = 'engañoso';
      } else if (
        deliveryRatePct !== null &&
        deliveryRatePct >= 78 &&
        (effectiveRoas === null || effectiveRoas >= 3)
      ) {
        flag = 'ganador';
      }

      return {
        codigo,
        orders: a.orders,
        delivered: a.delivered,
        cancelled: a.cancelled,
        inProgress: a.inProgress,
        deliveryRatePct,
        grossSales: a.grossSales,
        deliveredRevenue: a.deliveredRevenue,
        adSpend: a.adSpend,
        cogsDelivered: a.cogsDelivered,
        grossRoas,
        effectiveRoas,
        netContribution,
        flag,
      };
    })
    .sort((a, b) => b.netContribution - a.netContribution || b.delivered - a.delivered)
    .slice(0, 8);

  /* ---------------------------------------------------------------------- */
  /* E. PARÁMETROS BASE PARA SIMULACIÓN CONTRAFACTUAL ("¿QUÉ PASA SI...?")  */
  /* ---------------------------------------------------------------------- */
  const avgTicketDelivered = totalDelivered > 0 ? sumTicketDelivered / totalDelivered : 15;
  const avgCogsPerOrder =
    countDeliveredWithCogs > 0 ? sumCogsDelivered / countDeliveredWithCogs : avgTicketDelivered * 0.35;
  const avgGrossMarginPerOrder = Math.max(1, avgTicketDelivered - avgCogsPerOrder);
  const dailyOperatingBurn = Math.max(0, dailyBurn);
  const breakEvenOrdersPerDay =
    dailyOperatingBurn > 0 ? Math.round((dailyOperatingBurn / avgGrossMarginPerOrder) * 10) / 10 : null;
  const ordersPerDayFor25Net =
    dailyOperatingBurn > 0
      ? Math.round(((dailyOperatingBurn / 0.75) / avgGrossMarginPerOrder) * 10) / 10
      : null;

  return {
    svTodayIso,
    roasStartCutoffIso,
    sampleResolved60d: totalResolved,
    globalDeliveryRatePct,
    globalCancelRatePct,
    dailyAnomaly: {
      severity: anomalySeverity,
      weekdayName,
      baselineDaysUsed: refDays.length,
      pacingFactor,
      chatsToday,
      baselineChatsPaced,
      ordersToday,
      baselineOrdersPaced,
      revenueToday,
      baselineRevenuePaced,
      verdict: anomalyVerdict,
    },
    highRiskPreDispatch: highRiskPreDispatch.slice(0, 6),
    stockoutPredictions: stockoutPredictions.slice(0, 6),
    adEffectiveRoas,
    counterfactualParams: {
      avgTicketDelivered,
      avgCogsPerOrder,
      avgGrossMarginPerOrder,
      dailyOperatingBurn,
      commitments15d: finHealth.compromisos15dTotal,
      breakEvenOrdersPerDay,
      ordersPerDayFor25Net,
    },
  };
}

async function handleRadarInferenceQuery(supabase: any, chatId: string | number) {
  tgCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const svToday = getElSalvadorDate();
  const inf = await computeServerOperationalInference(supabase, svToday);

  const anomalyIcon =
    inf.dailyAnomaly.severity === 'positive'
      ? '🚀'
      : inf.dailyAnomaly.severity === 'alert'
      ? '🔴'
      : inf.dailyAnomaly.severity === 'warn'
      ? '🟡'
      : '🟢';

  const lines: string[] = [
    `📡 <b>RADAR PREDICTIVO E INFERENCIA · TODOENUNO</b>`,
    `🗓 <i>${escapeHtml(svToday)} · Base: ${inf.sampleResolved60d} pedidos resueltos (60d · ${inf.globalDeliveryRatePct.toFixed(0)}% entrega global)</i>`,
    `━━━━━━━━━━━━━━`,
    ``,
    `${anomalyIcon} <b>1. DIAGNÓSTICO CAUSAL DE HOY</b>`,
    `• ${escapeHtml(inf.dailyAnomaly.verdict)}`,
    `• Chats hoy: <b>${inf.dailyAnomaly.chatsToday}</b> (esp. ~${inf.dailyAnomaly.baselineChatsPaced}) · Pedidos: <b>${inf.dailyAnomaly.ordersToday}</b> (esp. ~${inf.dailyAnomaly.baselineOrdersPaced}) · Venta: <b>${fmtMoney(inf.dailyAnomaly.revenueToday)}</b>`,
    ``,
    `🛡 <b>2. RIESGO DE RECHAZO PRE-DESPACHO</b>`,
  ];

  if (inf.highRiskPreDispatch.length === 0) {
    lines.push(`• Sin paquetes de riesgo alto en <i>Nuevo / Por empacar</i> ahora mismo ✅`);
  } else {
    for (const r of inf.highRiskPreDispatch.slice(0, 4)) {
      lines.push(
        `• <b>${escapeHtml(r.cliente)}</b> (${fmtMoney(r.total)}) → <b>${r.riskPct}% riesgo</b> · <i>${escapeHtml(
          r.reasons.join(' + ') || `${r.departamento} / ${r.courier}`
        )}</i>`
      );
    }
  }

  lines.push(``);
  lines.push(`⏳ <b>3. QUIEBRE DE STOCK + CAJA</b>`);
  if (inf.stockoutPredictions.length === 0) {
    lines.push(`• Todos los SKUs activos tienen más de 10 días de cobertura al ritmo actual ✅`);
  } else {
    for (const s of inf.stockoutPredictions.slice(0, 4)) {
      const encTxt = s.encargosPendientes > 0 ? ` (${s.encargosPendientes} en encargos)` : '';
      lines.push(
        `• <b>${escapeHtml(s.nombre)}</b> (<code>${escapeHtml(s.sku)}</code>): <b>~${s.daysLeft.toFixed(
          1
        )}d</b> · ${s.stockDisponible}u disp${encTxt} · ritmo ${s.weightedDailyRate.toFixed(1)}/día`
      );
      lines.push(`  <i>↳ Sugerido ${s.suggestedReorderQty}u: ${escapeHtml(s.cashVerdict)}</i>`);
    }
  }

  lines.push(``);
  lines.push(`📣 <b>4. ROAS REAL AJUSTADO POR ENTREGA</b>`);
  if (inf.adEffectiveRoas.length === 0) {
    lines.push(`• Sin anuncios con atribución reciente aún.`);
  } else {
    for (const a of inf.adEffectiveRoas.slice(0, 5)) {
      const badge =
        a.flag === 'ganador'
          ? '🟢'
          : a.flag === 'engañoso'
          ? '🔴'
          : a.flag === 'muestra_pequena'
          ? '⚪'
          : '🟡';
      const delTxt =
        a.deliveryRatePct !== null
          ? `${a.deliveryRatePct.toFixed(0)}% entr. (${a.delivered}/${a.delivered + a.cancelled})`
          : `${a.inProgress} en ruta`;
      const roasTxt =
        a.effectiveRoas !== null
          ? ` · ROAS cobrado <b>${a.effectiveRoas.toFixed(2)}x</b>`
          : a.adSpend > 0
          ? ` · Pauta ${fmtMoney(a.adSpend)}`
          : '';
      lines.push(
        `• ${badge} <code>${escapeHtml(a.codigo)}</code>: ${a.orders} ped · ${delTxt}${roasTxt} · Neto <b>${fmtMoney(
          a.netContribution
        )}</b>`
      );
    }
  }

  lines.push(``);
  lines.push(
    `<blockquote>⚡ <b>Siguiente nivel:</b> usa <code>/objeciones</code> para minar los chats no cerrados de Todd, o pregúntame cualquier escenario <i>"¿Qué pasa si...?"</i> por texto o nota de voz.</blockquote>`
  );

  await sendTgMessage(chatId, lines.join('\n'), { reply_markup: AI_QUICK_KEYBOARD });
}

async function handleObjectionsMiningQuery(supabase: any, chatId: string | number) {
  tgCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});
  const svToday = getElSalvadorDate();
  const since48hIso = new Date(Date.now() - 48 * 3600000).toISOString();
  const since14dIso = new Date(Date.now() - 14 * 86400000).toISOString();

  const [convsRes, ordersRes] = await Promise.all([
    supabase
      .from('bb_conversations')
      .select('id,contact_name,contact_phone,last_message,updated_at,status')
      .gte('updated_at', since48hIso)
      .order('updated_at', { ascending: false })
      .limit(45),
    supabase
      .from('whatsapp_orders')
      .select('telefono,estado')
      .gte('created_at', since14dIso)
      .limit(1000),
  ]);

  const convs = Array.isArray(convsRes?.data) ? convsRes.data : [];
  const recentOrders = Array.isArray(ordersRes?.data) ? ordersRes.data : [];

  const buyerPhones = new Set<string>();
  for (const o of recentOrders) {
    const est = normalizeEstadoOrder(o.estado);
    if (est === 'cancelado') continue;
    const d8 = String(o.telefono || '').replace(/\D/g, '').slice(-8);
    if (d8.length === 8) buyerPhones.add(d8);
  }

  const unconverted = convs
    .filter((c: any) => {
      const d8 = String(c.contact_phone || '').replace(/\D/g, '').slice(-8);
      if (!d8 || d8.length < 8) return true;
      return !buyerPhones.has(d8);
    })
    .slice(0, 18);

  if (unconverted.length === 0) {
    await sendTgMessage(
      chatId,
      `🔍 <b>MINERÍA DE OBJECIONES (48H)</b>\n━━━━━━━━━━━━━━\n• No se encontraron conversaciones sin pedido en las últimas 48 horas ✅`,
      { reply_markup: AI_QUICK_KEYBOARD }
    );
    return;
  }

  const convIds = unconverted.map((c: any) => c.id).filter(Boolean);
  const { data: msgsData } = await supabase
    .from('bb_messages')
    .select('conversation_id,body,from_me,created_at')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false })
    .limit(220);

  const msgsByConv = new Map<string, Array<{ from_me: boolean; body: string }>>();
  for (const m of Array.isArray(msgsData) ? msgsData : []) {
    const cid = String(m.conversation_id || '');
    const body = String(m.body || '').trim();
    if (!cid || !body) continue;
    const arr = msgsByConv.get(cid) || [];
    if (arr.length < 6) {
      arr.push({ from_me: Boolean(m.from_me), body: body.slice(0, 160) });
      msgsByConv.set(cid, arr);
    }
  }

  const transcriptBlocks: string[] = [];
  let charBudget = 0;
  let analyzedCount = 0;

  for (const c of unconverted) {
    const msgs = (msgsByConv.get(String(c.id)) || []).reverse();
    if (msgs.length === 0 && !c.last_message) continue;
    const snippet =
      msgs.length > 0
        ? msgs.map((m) => `${m.from_me ? 'TODD' : 'CLIENTE'}: ${m.body}`).join(' | ')
        : `ULTIMO: ${String(c.last_message || '').slice(0, 160)}`;
    const block = `[Chat #${analyzedCount + 1} · estado=${c.status || 'bot'}] ${snippet}`;
    if (charBudget + block.length > 4800) break;
    transcriptBlocks.push(block);
    charBudget += block.length;
    analyzedCount += 1;
  }

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey || transcriptBlocks.length === 0) {
    await sendTgMessage(
      chatId,
      [
        `🔍 <b>CHATS SIN CIERRE (ÚLTIMAS 48H)</b>`,
        `━━━━━━━━━━━━━━`,
        `• Detectados <b>${unconverted.length}</b> chats sin pedido en 48h.`,
        ...unconverted.slice(0, 6).map(
          (c: any) =>
            `• <b>${escapeHtml(c.contact_name || 'Lead')}</b>: <i>"${escapeHtml(
              String(c.last_message || 'Sin texto').slice(0, 90)
            )}"</i>`
        ),
      ].join('\n'),
      { reply_markup: AI_QUICK_KEYBOARD }
    );
    return;
  }

  const aiRes = await fetchWithTimeoutLocal(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 580,
        messages: [
          {
            role: 'system',
            content:
              'Eres un analista de conversión WhatsApp para TODOENUNO (ecommerce COD en El Salvador). Analiza transcripciones reales de chats NO CERRADOS de las últimas 48h. Responde en español usando SOLO HTML básico de Telegram (<b>, <i>, <code>, <blockquote>) — NUNCA uses markdown (** o ###). Estructura EXACTAMENTE en 4 secciones breves: 1) 🚧 <b>Top objeciones reales</b> (máx 3 con conteo exacto de chats), 2) 💡 <b>Demanda oculta / oportunidades</b> (productos, colores o combos que pidieron), 3) ⚙️ <b>Fricción detectada en Todd / reglas</b> (plazos de entrega, falta de respuesta, precio o envío), 4) <blockquote>⚡ <b>Acción inmediata para subir cierre:</b> 1 recomendación concreta.</blockquote> No inventes nada que no aparezca en los chats.',
          },
          {
            role: 'user',
            content: `MUESTRA DE ${analyzedCount} CHATS NO CERRADOS (ÚLTIMAS 48H, ${svToday}):\n\n${transcriptBlocks.join('\n')}`,
          },
        ],
      }),
    },
    9000
  );

  const aiJson: any = await aiRes.json().catch(() => ({}));
  const rawAnswer = String(aiJson?.choices?.[0]?.message?.content || '').trim();
  if (!aiRes.ok || !rawAnswer) {
    throw new Error(aiJson?.error?.message || 'No se pudieron analizar los chats en este momento.');
  }

  await sendTgMessage(
    chatId,
    `🔍 <b>MINERÍA DE OBJECIONES · CHATS TODD</b>\n🗓 <i>${escapeHtml(svToday)} · Muestra: ${analyzedCount} chats no cerrados (48h)</i>\n━━━━━━━━━━━━━━\n\n${sanitizeTelegramHtml(
      rawAnswer
    )}`,
    { reply_markup: AI_QUICK_KEYBOARD }
  );
}

async function handleAiMemoryQuery(supabase: any, chatId: string | number, questionRaw: string) {
  const svToday = getElSalvadorDate();
  const d30CutoffUtc = new Date(Date.now() - 30 * 86400000).toISOString();
  const d7CutoffStr = new Date(Date.now() - 6 * 86400000 - 6 * 3600000).toISOString().slice(0, 10);

  // Indicador visual "escribiendo..." en Telegram sin bloquear el flujo
  tgCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

  const [mem, catalog, accounts, pendingRes, orders30Res] = await Promise.all([
    loadOsMemorySnapshotServer(supabase, svToday, 30),
    fetchActiveStockCatalog(supabase),
    fetchCashAccounts(supabase, { allowFallbackMock: false }),
    supabase
      .from('whatsapp_orders')
      .select('estado,total,liquidado')
      .in('estado', ['en_camino', 'en_ruta', 'en ruta', 'despachado', 'enviado', 'ruta', 'en camino', 'entregado', 'entregada', 'completado', 'completada'])
      .or('liquidado.is.null,liquidado.eq.false')
      .limit(1500),
    supabase
      .from('whatsapp_orders')
      .select('estado,total,sku,catalogo_sku,departamento,codigo_anuncio,motivo_cancelacion,created_at')
      .gte('created_at', d30CutoffUtc)
      .order('created_at', { ascending: false })
      .limit(1500),
  ]);

  const unliqList = Array.isArray(pendingRes?.data) ? pendingRes.data : [];
  const deliveredUnliq = unliqList.filter(
    (o: any) => normalizeEstadoOrder(o.estado) === 'entregado' && o.liquidado !== true
  );
  const inRouteList = unliqList.filter((o: any) => normalizeEstadoOrder(o.estado) === 'en_camino');
  const sumArr = (a: any[]) => a.reduce((s, x) => s + (Number(x.total) || 0), 0);

  const finHealth = await computeServerFinancialHealthSnapshot(supabase, svToday, {
    accounts,
    deliveredUnliq,
    inRouteList,
  });

  const inference = await computeServerOperationalInference(supabase, svToday, {
    finHealth,
    catalog,
  }).catch(() => null);

  // Agregaciones reales 30d + Stock Runway (días de inventario al ritmo 7d)
  const orders30 = Array.isArray(orders30Res?.data) ? orders30Res.data : [];
  const skuVel7d = new Map<string, number>();
  const deptStats = new Map<string, { total: number; delivered: number; cancelled: number }>();
  const adStats30 = new Map<string, { orders: number; delivered: number; revenue: number }>();
  const cancelReasons30 = new Map<string, number>();

  for (const o of orders30) {
    const est = normalizeEstadoOrder(o.estado) || 'nuevo';
    const svDay = o.created_at
      ? new Date(new Date(o.created_at).getTime() - 6 * 3600000).toISOString().slice(0, 10)
      : '';
    const skuKey = String(o.catalogo_sku || o.sku || '')
      .trim()
      .toUpperCase()
      .split('-')[0];
    if (svDay >= d7CutoffStr && est !== 'cancelado' && skuKey) {
      skuVel7d.set(skuKey, (skuVel7d.get(skuKey) || 0) + 1);
    }

    const dept = String(o.departamento || 'Sin depto').trim() || 'Sin depto';
    const ds = deptStats.get(dept) || { total: 0, delivered: 0, cancelled: 0 };
    ds.total += 1;
    if (est === 'entregado') ds.delivered += 1;
    if (est === 'cancelado') ds.cancelled += 1;
    deptStats.set(dept, ds);

    const adCode = String(o.codigo_anuncio || '').trim().toUpperCase();
    if (adCode) {
      const as = adStats30.get(adCode) || { orders: 0, delivered: 0, revenue: 0 };
      as.orders += 1;
      if (est === 'entregado') {
        as.delivered += 1;
        as.revenue += Number(o.total || 0);
      }
      adStats30.set(adCode, as);
    }

    if (est === 'cancelado') {
      const r = String(o.motivo_cancelacion || 'Sin motivo especificado').trim().slice(0, 50);
      cancelReasons30.set(r, (cancelReasons30.get(r) || 0) + 1);
    }
  }

  const runwayAlerts: string[] = [];
  for (const c of catalog) {
    const disp = Number(c.stock_disponible || 0);
    const baseSku = String(c.sku || '').trim().toUpperCase();
    const vel7 = skuVel7d.get(baseSku) || 0;
    if (vel7 >= 2) {
      const dailyRate = vel7 / 7;
      const daysLeft = disp > 0 ? Math.round((disp / dailyRate) * 10) / 10 : 0;
      if (daysLeft <= 6) {
        runwayAlerts.push(
          `${c.sku} (${c.nombre}): ${disp}u disp · ritmo ${vel7}/7d (~${daysLeft}d)`
        );
      }
    }
  }

  const topDepts = Array.from(deptStats.entries())
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6)
    .map(
      ([d, s]) =>
        `${d}: ${s.total} ped (${s.delivered} entr, ${s.cancelled} canc)`
    );

  const topAds30 = Array.from(adStats30.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue || b[1].orders - a[1].orders)
    .slice(0, 6)
    .map(
      ([ad, s]) =>
        `${ad}: ${s.orders} ped, ${s.delivered} entr ($${s.revenue.toFixed(2)})`
    );

  const topCancels30 = Array.from(cancelReasons30.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([r, n]) => `${r} (${n})`);

  const zeroStock = catalog
    .filter((c: any) => Number(c.stock_disponible || 0) <= 0)
    .slice(0, 8)
    .map((c: any) => `${c.sku} (${c.nombre})`);

  const cashSummary = summarizeCashAccounts(accounts);
  const totalCash = cashSummary.netTotal;
  const cleanQuestion = questionRaw.trim();

  if (!cleanQuestion) {
    const summaryLines = [
      `🧠 <b>MEMORIA HISTÓRICA · TODOENUNO OS</b>`,
      `🗓 <i>${escapeHtml(mem.d7StartIso)} → ${escapeHtml(mem.svTodayIso)} vs ${escapeHtml(mem.d14StartIso)} → ${escapeHtml(mem.d14EndIso)}</i>`,
      `━━━━━━━━━━━━━━`,
      `📊 <b>SEMANA ACTUAL vs ANTERIOR (7D reales)</b>`,
      `• Pedidos creados: <b>${mem.orders7d}</b> vs ${mem.ordersPrev7d} (${formatDeltaBadge(mem.orders7d, mem.ordersPrev7d)})`,
      `• Entregados: <b>${mem.delivered7d}</b> vs ${mem.deliveredPrev7d} · En ruta/proceso: <b>${mem.inProgress7d}</b> vs ${mem.inProgressPrev7d} · Cancelados: <b>${mem.cancelled7d}</b> vs ${mem.cancelledPrev7d}`,
      `• Facturado (no canc.): <b>${fmtMoney(mem.grossSales7d)}</b> vs ${fmtMoney(mem.grossSalesPrev7d)} · Cobrado (entr.): <b>${fmtMoney(mem.revenue7d)}</b> vs ${fmtMoney(mem.revenuePrev7d)}`,
      `• Pauta Meta: <b>${fmtMoney(mem.adSpend7d)}</b> vs ${fmtMoney(mem.adSpendPrev7d)}${
        mem.roas7d !== null ? ` · ROAS cobrado: <b>${mem.roas7d.toFixed(2)}x</b>` : ''
      }${mem.roasPrev7d !== null ? ` (prev ${mem.roasPrev7d.toFixed(2)}x)` : ''}${
        mem.roasGross7d !== null ? ` · ROAS venta: <b>${mem.roasGross7d.toFixed(2)}x</b>` : ''
      }`,
      '',
      `💰 <b>PULSO EN VIVO Y SALUD FINANCIERA</b>`,
      `• Salud: <b>${finHealth.estado === 'Saludable' ? '🟢' : finHealth.estado === 'Atención' ? '🟡' : '🔴'} ${finHealth.score}/100 (${finHealth.estado})</b> · Valor real: <b>${fmtMoney(finHealth.valorTotalReal)}</b> · Oxígeno: <b>${finHealth.runwayDias !== null ? `${finHealth.runwayDias}d` : 'N/A'}</b>`,
      cashSummary.hasNegativeCard && cashSummary.cashAndBankTotal !== totalCash
        ? `• Liquidez neta: <b>${fmtMoney(totalCash)}</b> (Cajas/Bancos: <b>${fmtMoney(cashSummary.cashAndBankTotal)}</b>)`
        : `• Liquidez en cuentas: <b>${fmtMoney(totalCash)}</b>`,
      cashSummary.compactBreakdown ? `  <i>(${escapeHtml(cashSummary.compactBreakdown)})</i>` : '',
      `• Stock al costo: <b>${fmtMoney(finHealth.inventarioCosto)}</b> (${finHealth.unidadesFisicas} uds) · Calle: <b>${deliveredUnliq.length} entr. sin depositar</b> (${fmtMoney(sumArr(deliveredUnliq))}) · <b>${inRouteList.length} en ruta</b> (${fmtMoney(sumArr(inRouteList))})`,
      runwayAlerts.length > 0
        ? `• 🚨 Stock en riesgo: <code>${escapeHtml(runwayAlerts[0])}</code>`
        : '',
      mem.topInquiredNoClose.length > 0
        ? `• 🎯 Brecha Bot: ${mem.topInquiredNoClose
            .map((g) => `<code>${escapeHtml(g.sku)}</code> (${g.inquiries}→${g.orders})`)
            .join(', ')}`
        : '',
      mem.dailyLines.length > 0
        ? `\n📅 <b>Últimos días (Bitácora OS)</b>\n${mem.dailyLines
            .slice(0, 5)
            .map((l) => `• ${escapeHtml(l)}`)
            .join('\n')}`
        : '',
      `\n<blockquote>💬 Escribe directo tu pregunta o usa los botones de análisis rápido abajo.</blockquote>`,
    ].filter(Boolean);

    await sendTgMessage(chatId, summaryLines.join('\n'), { reply_markup: AI_QUICK_KEYBOARD });
    return;
  }

  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    await sendTgMessage(
      chatId,
      [
        `🧠 <b>ANÁLISIS DESDE MEMORIA OS</b>`,
        `━━━━━━━━━━━━━━`,
        `• 7d vs prev: <b>${mem.orders7d}</b> vs ${mem.ordersPrev7d} ped. · <b>${mem.delivered7d}</b> vs ${mem.deliveredPrev7d} entr. (${mem.inProgress7d} en ruta/proceso)`,
        `• Facturado: <b>${fmtMoney(mem.grossSales7d)}</b> vs ${fmtMoney(mem.grossSalesPrev7d)} · Cobrado: <b>${fmtMoney(mem.revenue7d)}</b> vs ${fmtMoney(mem.revenuePrev7d)} · Pauta: <b>${fmtMoney(mem.adSpend7d)}</b>`,
        mem.deterministicInsight ? `<blockquote>📌 ${escapeHtml(mem.deterministicInsight)}</blockquote>` : '',
        mem.dailyLines.slice(0, 4).map((l) => `• ${escapeHtml(l)}`).join('\n'),
      ]
        .filter(Boolean)
        .join('\n'),
      { reply_markup: AI_QUICK_KEYBOARD }
    );
    return;
  }

  const contextBlock = [
    `Fecha hoy SV: ${svToday}`,
    `NOTA METODOLÓGICA: Las cifras semanales vienen directamente de pedidos reales por fecha de creación (entregados + en_proceso + cancelados = total pedidos) y de gastos_publicidad sin duplicados.`,
    `SEMANA ACTUAL (${mem.d7StartIso} a ${mem.svTodayIso}): pedidos=${mem.orders7d}, entregados=${mem.delivered7d}, en_proceso_o_ruta=${mem.inProgress7d}, cancelados=${mem.cancelled7d}, tasa_cancelacion_resueltos=${mem.cancelRate7d ?? 'N/A'}%, facturado_no_cancelado=$${mem.grossSales7d.toFixed(2)}, cobrado_entregado=$${mem.revenue7d.toFixed(2)}, pauta_meta=$${mem.adSpend7d.toFixed(2)}, roas_cobrado=${mem.roas7d ?? 'N/A'}, roas_facturado=${mem.roasGross7d ?? 'N/A'}, chats_in=${mem.chatsIn7d}, chats_out=${mem.chatsOut7d}`,
    `SEMANA ANTERIOR (${mem.d14StartIso} a ${mem.d14EndIso}): pedidos=${mem.ordersPrev7d}, entregados=${mem.deliveredPrev7d}, en_proceso_o_ruta=${mem.inProgressPrev7d}, cancelados=${mem.cancelledPrev7d}, tasa_cancelacion_resueltos=${mem.cancelRatePrev7d ?? 'N/A'}%, facturado_no_cancelado=$${mem.grossSalesPrev7d.toFixed(2)}, cobrado_entregado=$${mem.revenuePrev7d.toFixed(2)}, pauta_meta=$${mem.adSpendPrev7d.toFixed(2)}, roas_cobrado=${mem.roasPrev7d ?? 'N/A'}, roas_facturado=${mem.roasGrossPrev7d ?? 'N/A'}`,
    `ESTADO EN VIVO HOY: liquidez_neta=$${totalCash.toFixed(2)}, cajas_y_bancos=$${cashSummary.cashAndBankTotal.toFixed(2)}, desglose_cuentas="${cashSummary.compactBreakdown}", entregados_sin_depositar=${deliveredUnliq.length} ($${sumArr(deliveredUnliq).toFixed(2)}), en_ruta=${inRouteList.length} ($${sumArr(inRouteList).toFixed(2)})`,
    `SALUD FINANCIERA Y VALOR REAL DEL NEGOCIO (${finHealth.periodLabel}): puntaje=${finHealth.score}/100 (${finHealth.estado}), valor_total_real=$${finHealth.valorTotalReal.toFixed(2)} (liquidez_neta=$${finHealth.liquidezNeta.toFixed(2)} + inventario_costo=$${finHealth.inventarioCosto.toFixed(2)} [${finHealth.unidadesFisicas} uds en ${finHealth.skusActivosCount} SKUs] + entregados_sin_liquidar=$${finHealth.entregadosSinLiquidar.toFixed(2)}), oxigeno_caja=${finHealth.runwayDias !== null ? `${finHealth.runwayDias} dias` : 'N/A'}, compromisos_15d=$${finHealth.compromisos15dTotal.toFixed(2)} (${finHealth.compromisos15dCount} pagos, ${finHealth.pagosVencidosCount} vencidos), capital_en_bodega_o_calle=${finHealth.pctCapitalAtrapado.toFixed(0)}%, ingresos_liquidados_mes=$${finHealth.ingresos.toFixed(2)}, egresos_operativos_mes=$${finHealth.egresosOperativos.toFixed(2)}, compras_stock_mes=$${finHealth.comprasInventario.toFixed(2)}, utilidad_operativa_mes=$${finHealth.utilidadOperativa.toFixed(2)}, margen_operativo=${finHealth.margenOperativoPct.toFixed(1)}%, pilares=${JSON.stringify(finHealth.pillars.map((p) => `${p.label}: ${p.score}/${p.maxScore} (${p.summary})`))}${finHealth.simulation ? `, simulador_liquidacion="Liquidar $${finHealth.simulation.montoPorLiquidar.toFixed(2)} sube liquidez a $${finHealth.simulation.nuevaLiquidezNeta.toFixed(2)} y salud a ${finHealth.simulation.nuevoScore}/100 (${finHealth.simulation.nuevoEstado})"` : ''}`,
    inference
      ? `INFERENCIA PREDICTIVA Y PARÁMETROS CONTRAFACTUALES (base ${inference.sampleResolved60d} ped. resueltos 60d, entrega_global=${inference.globalDeliveryRatePct.toFixed(1)}%): diagnostico_hoy="${inference.dailyAnomaly.verdict}"; riesgo_pre_despacho=${JSON.stringify(inference.highRiskPreDispatch.slice(0, 4).map((r) => `${r.cliente} ($${r.total}): ${r.riskPct}% [${r.reasons.join(', ')}]`))}; quiebre_stock_y_caja=${JSON.stringify(inference.stockoutPredictions.slice(0, 4).map((s) => `${s.sku}: ~${s.daysLeft.toFixed(1)}d (${s.stockDisponible}u, ritmo ${s.weightedDailyRate.toFixed(1)}/d, ${s.cashVerdict})`))}; roas_real_ajustado=${JSON.stringify(inference.adEffectiveRoas.slice(0, 5).map((a) => `${a.codigo}: ${a.orders}ped, entr=${a.deliveryRatePct?.toFixed(0) ?? 'N/A'}%, pauta=$${a.adSpend.toFixed(2)}, roas_cobrado=${a.effectiveRoas?.toFixed(2) ?? 'N/A'}, neto=$${a.netContribution.toFixed(2)} (${a.flag})`))}; constantes_simulacion={ticket_promedio_entregado:$${inference.counterfactualParams.avgTicketDelivered.toFixed(2)}, cogs_promedio:$${inference.counterfactualParams.avgCogsPerOrder.toFixed(2)}, margen_bruto_por_pedido:$${inference.counterfactualParams.avgGrossMarginPerOrder.toFixed(2)}, quema_operativa_diaria:$${inference.counterfactualParams.dailyOperatingBurn.toFixed(2)}, pedidos_entregados_dia_punto_equilibrio:${inference.counterfactualParams.breakEvenOrdersPerDay ?? 'N/A'}, pedidos_entregados_dia_meta_25_neto:${inference.counterfactualParams.ordersPerDayFor25Net ?? 'N/A'}, compromisos_15d:$${inference.counterfactualParams.commitments15d.toFixed(2)}}`
      : '',
    `STOCK EN RIESGO (ritmo 7d vs disponible): ${runwayAlerts.join(' | ') || 'ninguno en alerta'}`,
    `SIN STOCK ACTUALMENTE: ${zeroStock.join(', ') || 'ninguno'}`,
    `BRECHA BOT (consultas -> pedidos): ${JSON.stringify(mem.topInquiredNoClose)}`,
    `TOP DEPARTAMENTOS (30d): ${topDepts.join(' | ') || 'sin datos'}`,
    `TOP ANUNCIOS POR ENTREGAS REALES (30d): ${topAds30.join(' | ') || 'sin atribución'}`,
    `MOTIVOS CANCELACIÓN (30d pedidos): ${topCancels30.join(' | ') || 'sin motivos registrados'}`,
    `MOTIVOS CANCELACIÓN/INCIDENCIA (eventos): ${JSON.stringify(mem.topCancelReasons)}`,
    ``,
    `BITÁCORA DIARIA OS (solo referencia de chats/eventos):`,
    mem.dailyLines.join('\n') || '(sin filas diarias aún)',
    ``,
    `EVENTOS RECIENTES (os_events últimos ${mem.recentEventLines.length}):`,
    mem.recentEventLines.slice(0, 75).join('\n'),
  ]
    .filter(Boolean)
    .join('\n');

  const aiRes = await fetchWithTimeoutLocal(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.25,
        max_tokens: 720,
        messages: [
          {
            role: 'system',
            content:
              'Eres el Cerebro Analítico e Inferencial IA de TODOENUNO OS (tienda ecommerce contra entrega en El Salvador). Responde en español usando SOLO HTML básico de Telegram (<b>, <i>, <code>, <blockquote>) — PROHIBIDO usar markdown como ** o ###. Organiza la respuesta de forma visual y fácil de escanear en celular: usa emojis de sección (📊, 💰, 📦, 📡, ⚡), viñetas (•) con cifras en <b>negrita</b> y termina con un <blockquote>⚡ <b>Conclusión / Acción:</b> ...</blockquote> breve y accionable. Si el dueño hace una pregunta contrafactual o hipotética ("¿qué pasa si duplico pauta?", "¿cuántos pedidos diarios necesito para...?", "¿me alcanza el stock/caja si...?"), usa las constantes reales del bloque INFERENCIA PREDICTIVA Y PARÁMETROS CONTRAFACTUALES para simular paso a paso el impacto en stock, flujo de caja y margen sin inventar tasas. Siempre menciona cuando una muestra sea pequeña. Usa EXCLUSIVAMENTE los datos reales proporcionados.',
          },
          {
            role: 'user',
            content: `PREGUNTA DEL DUEÑO: "${cleanQuestion}"\n\nDATOS REALES DE TODOENUNO OS:\n${contextBlock}`,
          },
        ],
      }),
    },
    9000
  );

  const aiJson: any = await aiRes.json().catch(() => ({}));
  const rawAnswer = String(aiJson?.choices?.[0]?.message?.content || '').trim();
  if (!aiRes.ok || !rawAnswer) {
    throw new Error(aiJson?.error?.message || 'No se pudo consultar la memoria IA en este momento.');
  }

  const formattedAnswer = sanitizeTelegramHtml(rawAnswer);
  await sendTgMessage(
    chatId,
    `🧠 <b>MEMORIA OS · ANÁLISIS IA</b>\n🗓 <i>${escapeHtml(svToday)}</i>\n━━━━━━━━━━━━━━\n\n${formattedAnswer}`,
    { reply_markup: AI_QUICK_KEYBOARD }
  );
}

async function handleTelegramBotRequest(req: any, res: any) {
  const action = String(req.query?.telegram_mode || req.query?.action || '')
    .trim()
    .toLowerCase();

  try {
    const baseUrl = getBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/morning-brief?telegram_mode=webhook`;
    const legacyWebhookUrl = `${baseUrl}/api/telegram-webhook`;
    const allowedChatIds = getAllowedChatIds();
    const hasBotToken = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);
    const hasSecret = Boolean(process.env.TELEGRAM_WEBHOOK_SECRET);

    /* 1. PANEL STATUS CHECK (SIN EXPONER TOKENS) */
    if (req.method === 'GET' && action === 'status') {
      let telegramWebhook: any = null;
      let webhookError: string | null = null;

      if (hasBotToken) {
        try {
          const info = await tgCall('getWebhookInfo');
          telegramWebhook = {
            url: info?.url || '',
            pending_update_count: Number(info?.pending_update_count || 0),
            last_error_message: info?.last_error_message || null,
            last_error_date: info?.last_error_date || null,
            isMatchingCurrentHost: info?.url === webhookUrl || info?.url === legacyWebhookUrl,
          };
        } catch (err: any) {
          webhookError = err?.message || 'Error consultando getWebhookInfo';
        }
      }

      return res.status(200).json({
        ok: true,
        hasBotToken,
        hasOpenAiKey,
        hasSecret,
        allowedChatIds,
        expectedWebhookUrl: webhookUrl,
        telegramWebhook,
        webhookError,
      });
    }

    /* 2. REGISTRAR WEBHOOK + COMANDOS EN TELEGRAM DESDE EL PANEL */
    if (req.method === 'POST' && action === 'register_webhook') {
      if (!hasBotToken) {
        return res.status(400).json({
          error: 'Falta la variable TELEGRAM_BOT_TOKEN en Vercel Environment Variables.',
        });
      }

      const setPayload: Record<string, any> = {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
      };
      if (process.env.TELEGRAM_WEBHOOK_SECRET) {
        setPayload.secret_token = process.env.TELEGRAM_WEBHOOK_SECRET;
      }

      await tgCall('setWebhook', setPayload);
      await tgCall('setMyCommands', {
        commands: [
          { command: 'compra', description: 'Registrar compra: /compra SKU CANT COSTO' },
          { command: 'gasto', description: 'Registrar gasto o pauta: /gasto MONTO CONCEPTO' },
          { command: 'pedido', description: 'Buscar pedido por cliente, tel o código' },
          { command: 'estado', description: 'Cambiar estado: /estado CLIENTE ESTADO' },
          { command: 'pendientes', description: 'Ver empaque, ruta y cobros por liquidar' },
          { command: 'merma', description: 'Registrar daño o ajuste: /merma SKU CANT' },
          { command: 'stock', description: 'Ver inventario actual: /stock [producto]' },
          { command: 'cajas', description: 'Ver saldos de cajas y bancos' },
          { command: 'salud', description: 'Ver salud financiera (0-100) y valor real del negocio' },
          { command: 'radar', description: 'Radar IA: anomalías, riesgo rechazo, stock+caja y ROAS real' },
          { command: 'objeciones', description: 'Minar objeciones y demanda oculta en chats no cerrados (48h)' },
          { command: 'memoria', description: 'Resumen histórico 30d de OS Memory' },
          { command: 'ia', description: 'Preguntar o simular escenarios (¿qué pasa si...?) con IA' },
          { command: 'brief', description: 'Pedir el brief operativo (AM/PM)' },
          { command: 'ayuda', description: 'Ver guía de texto, notas de voz y fotos' },
        ],
      });

      const info = await tgCall('getWebhookInfo');
      return res.status(200).json({
        ok: true,
        webhookUrl,
        telegramWebhook: {
          url: info?.url || webhookUrl,
          pending_update_count: Number(info?.pending_update_count || 0),
          last_error_message: info?.last_error_message || null,
        },
      });
    }

    if (req.method !== 'POST') {
      return res.status(200).json({ ok: true, endpoint: 'telegram-webhook' });
    }

    /* 3. VALIDAR SECRET DE TELEGRAM SI FUE CONFIGURADO */
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret) {
      const incomingSecret = req.headers?.['x-telegram-bot-api-secret-token'];
      if (incomingSecret !== expectedSecret) {
        return res.status(401).json({ error: 'Invalid Telegram webhook secret' });
      }
    }

    const update = req.body || {};
    const supabase = getSupabaseAdmin();

    /* 4. MANEJO DE BOTONES DE CONFIRMACIÓN (CALLBACK QUERY) */
    if (update.callback_query) {
      const cq = update.callback_query;
      const cqId = cq.id;
      const chatId = String(cq.message?.chat?.id || cq.from?.id || '');
      const messageId = cq.message?.message_id;
      const dataStr = String(cq.data || '');

      if (!allowedChatIds.includes(chatId)) {
        await tgCall('answerCallbackQuery', {
          callback_query_id: cqId,
          text: '⛔ Chat no autorizado.',
          show_alert: true,
        });
        return res.status(200).json({ ok: true });
      }

      const [cmd, draftId, finFlag] = dataStr.split(':');

      if (cmd === 'ia_quick') {
        await tgCall('answerCallbackQuery', {
          callback_query_id: cqId,
          text: 'Analizando datos reales...',
        });
        if (draftId === 'brief') {
          await handleBriefCommand(req, chatId, '');
        } else if (draftId === 'salud') {
          await handleFinancialHealthQuery(supabase, chatId);
        } else if (draftId === 'radar') {
          await handleRadarInferenceQuery(supabase, chatId);
        } else if (draftId === 'objeciones') {
          await handleObjectionsMiningQuery(supabase, chatId);
        } else {
          const quickPrompts: Record<string, string> = {
            compare7d: 'Compárame esta semana (últimos 7 días) contra la semana anterior en pedidos, entregas, cancelaciones, cobrado, pauta y ROAS. Dime qué mejoró y qué empeoró.',
            stock_risk: '¿Qué productos tienen riesgo de quedarse sin stock en los próximos días al ritmo de venta actual, cuánto cuesta reponerlos y me alcanza con la liquidez actual?',
            bot_gaps: '¿Qué productos están preguntando más en el bot sin cerrar pedido, por qué puede estar pasando y cómo mejoramos el cierre?',
            top_ads: '¿Qué anuncios/códigos están dejando más utilidad neta real ajustada por entrega y cuáles tienen cancelación alta?',
          };
          await handleAiMemoryQuery(
            supabase,
            chatId,
            quickPrompts[draftId] || quickPrompts.compare7d
          );
        }
        return res.status(200).json({ ok: true });
      }

      if ((cmd !== 'tg_ok' && cmd !== 'tg_no') || !draftId) {
        await tgCall('answerCallbackQuery', { callback_query_id: cqId });
        return res.status(200).json({ ok: true });
      }

      const draftsDoc = await readDocJson<TelegramDraft[]>(supabase, DRAFTS_DOC_TITLE, []);
      const drafts = Array.isArray(draftsDoc.data) ? draftsDoc.data : [];
      const idx = drafts.findIndex((d) => d.id === draftId);

      if (idx === -1) {
        await tgCall('answerCallbackQuery', {
          callback_query_id: cqId,
          text: 'Borrador expirado o no encontrado.',
          show_alert: true,
        });
        return res.status(200).json({ ok: true });
      }

      const draft = drafts[idx];
      if (draft.status !== 'pending') {
        await tgCall('answerCallbackQuery', {
          callback_query_id: cqId,
          text:
            draft.status === 'confirmed'
              ? 'Este registro ya fue confirmado.'
              : 'Este borrador ya fue cancelado.',
        });
        return res.status(200).json({ ok: true });
      }

      if (cmd === 'tg_no') {
        drafts[idx] = { ...draft, status: 'cancelled' };
        await writeDocJson(supabase, DRAFTS_DOC_TITLE, drafts.slice(0, 25), draftsDoc.id);
        await tgCall('answerCallbackQuery', { callback_query_id: cqId, text: 'Cancelado' });
        if (messageId) {
          await tgCall('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: `❌ <b>Operación cancelada</b>\nNo se hicieron cambios en Inventario, ROAS ni Finanzas.`,
            parse_mode: 'HTML',
          });
        }
        return res.status(200).json({ ok: true });
      }

      // Bloquear inmediatamente contra doble clic
      drafts[idx] = { ...draft, status: 'confirmed' };
      await writeDocJson(supabase, DRAFTS_DOC_TITLE, drafts.slice(0, 25), draftsDoc.id);
      await tgCall('answerCallbackQuery', {
        callback_query_id: cqId,
        text: 'Guardando en TODOENUNO OS...',
      });

      const kind = draft.kind || 'compra';
      let finalMsg = '';

      if (kind === 'gasto_operativo' && draft.kind === 'gasto_operativo') {
        const finRes = await recordFinanceExpenseServer(supabase, {
          account_id: draft.account_id,
          categoria: draft.categoria,
          monto: draft.monto,
          descripcion: `[Telegram] ${draft.descripcion}`,
          fecha: getElSalvadorDate(),
        });

        if (finRes.ok) {
          await emitBestEffortOsEvent(
            supabase,
            'finance.expense.created',
            'finance_money_transactions',
            draft.id,
            {
              account_id: draft.account_id,
              categoria: draft.categoria,
              monto: draft.monto,
              descripcion: draft.descripcion,
              fecha: getElSalvadorDate(),
              es_manual: true,
              origen: 'telegram_bot',
            }
          );
          finalMsg = [
            `✅ <b>GASTO OPERATIVO REGISTRADO</b>`,
            `💵 Monto: <b>-${fmtMoney(draft.monto)}</b>`,
            `🏷️ Categoría: <code>${escapeHtml(draft.categoria)}</code>`,
            `📝 ${escapeHtml(draft.descripcion)}`,
            `🏦 Descontado de <b>${escapeHtml(draft.account_nombre)}</b>${
              finRes.nuevoSaldo !== undefined
                ? ` (Saldo actual: <b>${fmtMoney(finRes.nuevoSaldo)}</b>)`
                : ''
            }`,
          ].join('\n');
        } else {
          finalMsg = `⚠️ No se pudo guardar el gasto en Finanzas: ${escapeHtml(finRes.error)}`;
        }
      } else if (kind === 'gasto_pauta' && draft.kind === 'gasto_pauta') {
        const fechaHoy = getElSalvadorDate();
        const { error: adErr } = await supabase.from('gastos_publicidad').insert({
          fecha: fechaHoy,
          codigo_anuncio: draft.codigo_anuncio,
          plataforma: draft.plataforma,
          monto: draft.monto,
          notas: draft.notas ? `[Telegram] ${draft.notas}` : '[Telegram]',
        });

        if (adErr) {
          finalMsg = `⚠️ Error guardando en gastos_publicidad: ${escapeHtml(adErr.message)}`;
        } else {
          await emitBestEffortOsEvent(
            supabase,
            'marketing.ad.expense',
            'gastos_publicidad',
            draft.id,
            {
              codigo_anuncio: draft.codigo_anuncio,
              platform: draft.plataforma.toLowerCase(),
              amount: draft.monto,
              date: fechaHoy,
              origen: 'telegram_bot',
            }
          );

          let boxLine = 'Finanzas: No descontado de caja (solo ROAS).';
          if (finFlag === '1') {
            const finRes = await recordFinanceExpenseServer(supabase, {
              account_id: draft.account_id,
              categoria: 'pauta_publicidad',
              monto: draft.monto,
              descripcion: `Pauta ${draft.plataforma} (${draft.codigo_anuncio})`,
              fecha: fechaHoy,
            });
            if (finRes.ok) {
              boxLine = `💰 Descontado de <b>${escapeHtml(draft.account_nombre)}</b>${
                finRes.nuevoSaldo !== undefined
                  ? ` (Saldo actual: <b>${fmtMoney(finRes.nuevoSaldo)}</b>)`
                  : ''
              }`;
            } else {
              boxLine = `⚠️ Pauta guardada, pero falló descuento de caja: ${escapeHtml(finRes.error)}`;
            }
          }

          finalMsg = [
            `✅ <b>GASTO DE PAUTA REGISTRADO</b>`,
            `🎯 Anuncio: <code>${escapeHtml(draft.codigo_anuncio)}</code> (${escapeHtml(draft.plataforma)})`,
            `💵 Monto: <b>${fmtMoney(draft.monto)}</b> · Fecha: ${fechaHoy}`,
            boxLine,
          ].join('\n');
        }
      } else if (kind === 'ajuste_inventario' && draft.kind === 'ajuste_inventario') {
        const movRes = await executeInventoryMovementServer(supabase, {
          sku: draft.sku,
          tipo_movimiento: draft.tipo_movimiento,
          cantidad: draft.cantidad,
          motivo: `[Telegram] ${draft.motivo}`,
          source_id: draft.id,
        });

        if (movRes.ok) {
          await emitBestEffortOsEvent(
            supabase,
            'inventory.adjustment',
            'inventory_stock',
            draft.sku,
            {
              sku: draft.sku,
              tipo: draft.tipo_movimiento,
              cantidad: draft.cantidad,
              motivo: draft.motivo,
              saldo_nuevo: movRes.nuevoFisico,
              origen: 'telegram_bot',
            }
          );
          finalMsg = [
            `✅ <b>AJUSTE DE INVENTARIO ASENTADO</b>`,
            `📦 <code>${escapeHtml(draft.sku)}</code> (${escapeHtml(draft.nombre)})`,
            `⚙️ ${escapeHtml(draft.tipo_movimiento)} · ${draft.cantidad} u.`,
            `📊 Nuevo Físico: <b>${movRes.nuevoFisico ?? 'OK'}</b> · Disponible: <b>${movRes.nuevoDisponible ?? 'OK'}</b>`,
            `📝 ${escapeHtml(draft.motivo)}`,
          ].join('\n');
        } else {
          finalMsg = `⚠️ No se pudo registrar el ajuste en Kárdex: ${escapeHtml(movRes.error)}`;
        }
      } else if (kind === 'cambiar_estado_pedido' && draft.kind === 'cambiar_estado_pedido') {
        const { data: orderRow, error: fetchOrdErr } = await supabase
          .from('whatsapp_orders')
          .select('*')
          .eq('id', draft.order_id)
          .maybeSingle();

        if (fetchOrdErr || !orderRow) {
          finalMsg = `⚠️ No se encontró el pedido <code>${escapeHtml(draft.pedido_codigo)}</code> en la base de datos.`;
        } else {
          const prevEstadoActual = normalizeEstadoOrder(orderRow.estado) || 'nuevo';
          const updateFields: Record<string, any> = { estado: draft.estado_nuevo };
          if (draft.estado_nuevo === 'cancelado' && draft.motivo_cancelacion) {
            updateFields.motivo_cancelacion = draft.motivo_cancelacion;
          }

          let updRes = await supabase
            .from('whatsapp_orders')
            .update(updateFields)
            .eq('id', orderRow.id);

          if (updRes.error && updateFields.motivo_cancelacion) {
            updRes = await supabase
              .from('whatsapp_orders')
              .update({ estado: draft.estado_nuevo })
              .eq('id', orderRow.id);
          }

          if (updRes.error) {
            finalMsg = `⚠️ No se pudo actualizar el estado del pedido: ${escapeHtml(updRes.error.message)}`;
          } else {
            const isMerma = finFlag === '2';
            const reingresarStock = draft.estado_nuevo === 'cancelado' ? !isMerma : true;
            let invSummary = '';
            try {
              const syncRes = await syncOrderInventoryOnStatusChangeServer(supabase, {
                order: orderRow,
                prevEstado: prevEstadoActual,
                nextEstado: draft.estado_nuevo,
                reingresarStock,
                esMerma: isMerma,
                motivoCancelacion: draft.motivo_cancelacion,
              });
              invSummary = syncRes.summaryText;
            } catch (syncErr: any) {
              invSummary = `⚠️ Estado actualizado, pero revisa Kárdex: ${syncErr?.message || 'error'}`;
            }

            const eventMap: Record<string, string> = {
              nuevo: 'order.created',
              programado: 'order.scheduled',
              por_empacar: 'order.confirmed',
              en_camino: 'order.shipped',
              entregado: 'order.delivered',
              cancelado: 'order.cancelled',
            };

            await emitBestEffortOsEvent(
              supabase,
              eventMap[draft.estado_nuevo] || 'order.confirmed',
              'whatsapp_orders',
              orderRow.id,
              {
                order_id: orderRow.id,
                nombre_cliente: orderRow.nombre_cliente,
                telefono: orderRow.telefono,
                sku: orderRow.sku,
                catalogo_sku: orderRow.catalogo_sku,
                total: orderRow.total,
                estado_anterior: prevEstadoActual,
                estado: draft.estado_nuevo,
                es_merma: isMerma,
                origen: 'telegram_bot',
              }
            );

            finalMsg = [
              `✅ <b>ESTADO DE PEDIDO ACTUALIZADO</b>`,
              `🧾 <code>${escapeHtml(draft.pedido_codigo)}</code> · <b>${escapeHtml(draft.nombre_cliente)}</b>`,
              `${formatEstadoBadge(prevEstadoActual)}  ➔  <b>${formatEstadoBadge(draft.estado_nuevo)}</b>`,
              invSummary ? `📦 ${escapeHtml(invSummary)}` : '',
            ]
              .filter(Boolean)
              .join('\n');
          }
        }
      } else {
        // Compra de mercadería (con soporte por variante sin duplicar filas en inventory_stock)
        const compra = draft as Extract<TelegramDraft, { items: DraftItem[] }>;
        const withFinance = finFlag === '1';
        const resultLines: string[] = [];
        const touchedTemplates = new Map<string, number>();
        let hadError = false;

        for (const item of compra.items) {
          const varLabel = item.variante_id ? formatVariantLabel(item.color, item.talla) : '';
          const motivo = `Compra Telegram · ${compra.proveedor || 'Proveedor'}${
            varLabel ? ` [${varLabel}]` : ''
          }${compra.notas ? ` · ${compra.notas}` : ''}`.trim();

          const movRes = await executeInventoryMovementServer(supabase, {
            sku: item.sku,
            tipo_movimiento: 'compra_entrada',
            cantidad: item.cantidad,
            costo_unitario: item.costo_unitario,
            motivo,
            source_id: compra.id,
          });

          if (movRes.ok) {
            let varStockSuffix = '';
            if (item.variante_id) {
              const varSyncRes = await applyVariantPurchaseAndSyncServer(supabase, {
                parentSku: item.sku,
                varianteId: item.variante_id,
                addQty: item.cantidad,
              });
              if (varSyncRes.ok) {
                if (varSyncRes.templateId) {
                  touchedTemplates.set(normalizeSku(item.sku), varSyncRes.templateId);
                }
                if (varSyncRes.nuevoStockVariante !== undefined) {
                  varStockSuffix = ` · ${escapeHtml(varLabel)}: <b>${varSyncRes.nuevoStockVariante}</b>`;
                }
              }
            }

            const varTitle = varLabel ? ` · 🎨 <b>${escapeHtml(varLabel)}</b>` : '';
            resultLines.push(
              `• <code>${escapeHtml(item.sku)}</code>${varTitle} +${item.cantidad} u. (${fmtMoney(
                item.costo_unitario
              )}) → Físico: <b>${movRes.nuevoFisico ?? 'OK'}</b> · Disp: <b>${
                movRes.nuevoDisponible ?? 'OK'
              }</b>${varStockSuffix}`
            );

            await emitBestEffortOsEvent(
              supabase,
              'supplier.bid.received',
              'inventory_stock',
              item.sku,
              {
                sku: item.sku,
                variante_id: item.variante_id || null,
                variant_sku: item.variant_sku || null,
                color: item.color || null,
                talla: item.talla || null,
                cantidad: item.cantidad,
                costo_unitario: item.costo_unitario,
                total_compra: item.subtotal,
                proveedor: compra.proveedor || null,
                tipo: 'compra_entrada',
                origen: 'telegram_bot',
                saldo_nuevo: movRes.nuevoFisico,
              }
            );
          } else {
            hadError = true;
            resultLines.push(`• ❌ <code>${escapeHtml(item.sku)}</code>: ${escapeHtml(movRes.error)}`);
          }
        }

        // Resincronizar [VARIANTES_DISPONIBLES] de Bot Todd una sola vez por producto padre
        for (const [parentSku, templateId] of touchedTemplates.entries()) {
          await resyncParentToddVariantsServer(supabase, { parentSku, templateId });
        }

        let financeSummary = 'Finanzas: No descontado (solo entrada de inventario).';
        if (withFinance && compra.total > 0) {
          const desc = `Compra Telegram (${compra.proveedor}): ${compra.items
            .map((i) => {
              const vLbl = i.variante_id ? ` (${formatVariantLabel(i.color, i.talla)})` : '';
              return `${i.cantidad}x ${i.sku}${vLbl}`;
            })
            .join(', ')}`;
          const finRes = await recordFinanceExpenseServer(supabase, {
            account_id: compra.account_id,
            categoria: 'pago_proveedor',
            monto: compra.total,
            descripcion: desc,
            fecha: getElSalvadorDate(),
          });

          if (finRes.ok) {
            financeSummary = `💰 Egreso asentado en <b>${escapeHtml(compra.account_nombre)}</b>: -${fmtMoney(
              compra.total
            )}${
              finRes.nuevoSaldo !== undefined
                ? ` (Saldo actual: <b>${fmtMoney(finRes.nuevoSaldo)}</b>)`
                : ''
            }`;

            await emitBestEffortOsEvent(
              supabase,
              'finance.expense.created',
              'finance_money_transactions',
              compra.id,
              {
                account_id: compra.account_id,
                categoria: 'pago_proveedor',
                monto: compra.total,
                descripcion: desc,
                fecha: getElSalvadorDate(),
                es_manual: true,
                origen: 'telegram_bot',
              }
            );
          } else {
            financeSummary = `⚠️ Inventario actualizado, pero falló Finanzas: ${escapeHtml(finRes.error)}`;
          }
        }

        finalMsg = [
          hadError ? `⚠️ <b>COMPRA PARCIAL REGISTRADA</b>` : `✅ <b>COMPRA REGISTRADA EN TODOENUNO OS</b>`,
          `🏭 Proveedor: <b>${escapeHtml(compra.proveedor)}</b> · Total: <b>${fmtMoney(compra.total)}</b>`,
          '',
          ...resultLines,
          '',
          financeSummary,
        ].join('\n');
      }

      if (messageId) {
        await tgCall('editMessageText', {
          chat_id: chatId,
          message_id: messageId,
          text: finalMsg,
          parse_mode: 'HTML',
        });
      } else {
        await sendTgMessage(chatId, finalMsg);
      }

      return res.status(200).json({ ok: true });
    }

    /* 5. MANEJO DE MENSAJES (TEXTO, NOTAS DE VOZ Y FOTOS) */
    const msg = update.message;
    if (!msg) {
      return res.status(200).json({ ok: true });
    }

    const chatId = String(msg.chat?.id || msg.from?.id || '');
    if (!allowedChatIds.includes(chatId)) {
      await sendTgMessage(
        chatId,
        `⛔ Chat ID <code>${escapeHtml(chatId)}</code> no autorizado para operar TODOENUNO OS. Agrégalo a <code>TELEGRAM_ALLOWED_CHAT_IDS</code> en Vercel si deseas darle acceso.`
      );
      return res.status(200).json({ ok: true });
    }

    let rawText = String(msg.text || msg.caption || '').trim();
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    const voiceOrAudio = msg.voice || msg.audio || null;

    if (voiceOrAudio?.file_id) {
      const transcript = await transcribeTelegramAudio(
        voiceOrAudio.file_id,
        voiceOrAudio.mime_type || 'audio/ogg',
        voiceOrAudio.file_name
      );
      if (!transcript) {
        await sendTgMessage(chatId, '🎙️ No logré entender el audio. Intenta grabarlo de nuevo más claro.');
        return res.status(200).json({ ok: true });
      }
      await sendTgMessage(chatId, `🎙️ <i>Escuché: "${escapeHtml(transcript)}"</i>`);
      rawText = rawText ? `${rawText} ${transcript}` : transcript;
    }

    if (!rawText && !hasPhoto) {
      await sendTgMessage(
        chatId,
        'Envíame un texto, una <b>nota de voz</b> o una <b>foto de factura/recibo</b>. Escribe /ayuda para ver ejemplos.'
      );
      return res.status(200).json({ ok: true });
    }

    const lowerText = rawText.toLowerCase();

    // Comandos directos
    if (lowerText === '/start' || lowerText === '/ayuda' || lowerText === '/help') {
      await sendTgMessage(
        chatId,
        [
          `🤖 <b>TODOENUNO OS · Bot Operativo (Vercel + Whisper + GPT)</b>`,
          '',
          `Puedes escribir natural, mandar <b>nota de voz 🎙️</b> o enviar <b>foto de recibo/factura 📸</b>:`,
          '',
          `📦 <b>Compras e Inventario (con variantes):</b>`,
          `• <i>"Compré 5 rosados y 5 amarillos de asistente de bebé a $3.50"</i>`,
          `• <code>/compra SKU CANTIDAD COSTO [PROVEEDOR]</code>`,
          `• <code>/compra SKU color:CANT [color:CANT] COSTO [PROVEEDOR]</code>`,
          `• <code>/merma SKU CANT [MOTIVO]</code> o <i>"Se dañaron 2 cascos"</i>`,
          `• <code>/ajuste SKU NUEVO_CONTEO [MOTIVO]</code> o <i>"En bodega solo quedan 8 cascos"</i>`,
          '',
          `💸 <b>Gastos y Pauta:</b>`,
          `• <i>"Pagué $20 de gasolina de Caja Chica"</i>`,
          `• <i>"Pagué $35 de pauta al anuncio PROMO1"</i>`,
          `• <code>/gasto MONTO CONCEPTO</code>`,
          '',
          `🔎 <b>Pedidos y Consultas en vivo:</b>`,
          `• <code>/pedido [nombre, teléfono o código]</code>`,
          `• <code>/estado CLIENTE ESTADO</code> o <i>"Marca como entregado el pedido de María"</i>`,
          `• <code>/pendientes</code> — Cola de empaque, ruta y cobros por liquidar`,
          `• <code>/stock [producto]</code> — Disponible en bodega`,
          `• <code>/cajas</code> — Saldos de cajas y bancos`,
          `• <code>/salud</code> (o <code>/finanzas</code>) — Salud financiera (0-100), valor real y oxígeno de caja`,
          `• <code>/radar</code> (o <code>/inferencia</code>) — Diagnóstico causal hoy, riesgo rechazo, quiebre stock+caja y ROAS real`,
          `• <code>/objeciones</code> — Minería IA de chats no cerrados de Todd (últimas 48h)`,
          `• <code>/memoria</code> — Resumen histórico 30d de OS Memory`,
          `• <code>/ia [pregunta]</code> — Analizar o simular escenarios ("¿qué pasa si duplico pauta?")`,
          `• <code>/brief [am|pm]</code> — Brief operativo completo`,
        ].join('\n')
      );
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/memoria')) {
      const arg = rawText.replace(/^\/memoria(@\S+)?/i, '').trim();
      await handleAiMemoryQuery(supabase, chatId, arg);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/ia')) {
      const arg = rawText.replace(/^\/ia(@\S+)?/i, '').trim();
      await handleAiMemoryQuery(supabase, chatId, arg);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/stock')) {
      const term = rawText.replace(/^\/stock(@\S+)?/i, '').trim();
      await handleStockQuery(supabase, chatId, term);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/pendientes')) {
      await handlePendingOrdersQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/pedido')) {
      const q = rawText.replace(/^\/pedido(@\S+)?/i, '').trim();
      await handleOrderSearchQuery(supabase, chatId, q);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/cajas')) {
      const accounts = await fetchCashAccounts(supabase, { allowFallbackMock: false });
      const summary = summarizeCashAccounts(accounts);
      const lines = [
        `🏦 <b>CUENTAS Y CAJAS EN FINANZAS</b>`,
        '',
        ...accounts.map(
          (a: any) =>
            `• <b>${escapeHtml(a.nombre)}</b> (<code>${escapeHtml(a.id)}</code>): <b>${fmtMoney(a.saldo_actual)}</b>`
        ),
        '',
        `━━━━━━━━━━━━━━`,
        summary.hasNegativeCard && summary.cashAndBankTotal !== summary.netTotal
          ? `💰 Cajas y Bancos: <b>${fmtMoney(summary.cashAndBankTotal)}</b>\n💵 Liquidez neta total: <b>${fmtMoney(summary.netTotal)}</b>\n\n<blockquote>ℹ️ La Tarjeta Meta Ads está en negativo por deducciones de pauta y reduce el neto global; puedes fondearla con Transferir o Ajustar saldo en Finanzas.</blockquote>`
          : `💵 Liquidez total en cuentas: <b>${fmtMoney(summary.netTotal)}</b>`,
      ];
      await sendTgMessage(chatId, lines.join('\n'));
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/salud') || lowerText.startsWith('/finanzas')) {
      await handleFinancialHealthQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/radar') || lowerText.startsWith('/inferencia')) {
      await handleRadarInferenceQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/objeciones')) {
      await handleObjectionsMiningQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/brief')) {
      const arg = rawText.replace(/^\/brief(@\S+)?/i, '').trim();
      await handleBriefCommand(req, chatId, arg);
      return res.status(200).json({ ok: true });
    }

    // Fast-path: preguntas analíticas / predictivas / objeciones / financieras sin doble llamada OpenAI
    const isActionLike =
      /^\/|compr[eé]|gast[eé]|pagu[eé]|met[ií]|ingres[eé]|dañ[oóa]|merma|ajuste|marca|pasa\s+a|cambia\s+el|cu[aá]nto\s+stock|pendientes|pedido\s+de/i.test(
        rawText
      );
    const isDirectRadarQuestion =
      !hasPhoto &&
      !isActionLike &&
      /(radar\s*(predictivo|ia)?|inferencia|riesgo\s+de\s+(cancel|rechaz)|paquetes\s+con\s+riesgo|quiebre\s+de\s+stock|roas\s+real\s+ajustado)/i.test(
        rawText
      );
    if (isDirectRadarQuestion) {
      await handleRadarInferenceQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }
    const isDirectObjectionsQuestion =
      !hasPhoto &&
      !isActionLike &&
      /(objeciones|por\s*qu[eé]\s+no\s+(compran|cierran|est[aá]n\s+comprando)|chats?\s+(no\s+cerrados|sin\s+cerrar|sin\s+pedido)|demanda\s+oculta)/i.test(
        rawText
      );
    if (isDirectObjectionsQuestion) {
      await handleObjectionsMiningQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }
    const isDirectHealthQuestion =
      !hasPhoto &&
      !isActionLike &&
      /(salud\s+financiera|valor\s+(total\s+)?real|puntaje\s+financiero|estado\s+financiero|ox[ií]geno\s+de\s+caja)/i.test(
        rawText
      );
    if (isDirectHealthQuestion) {
      await handleFinancialHealthQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }
    const isDirectMemoryQuestion =
      !hasPhoto &&
      !isActionLike &&
      rawText.length >= 10 &&
      /(semana|compar|relaci[oó]n\s+a\s+la|roas|por\s*qu[eé]|qu[eé]\s+pasa\s+si|si\s+(duplic|subo|bajo|invierto|aumento)|cu[aá]ntos\s+pedidos\s+(diarios\s+)?necesito|tendencia|pauta|cancel|product|departament|ayer\b|recomiend|analiz|memoria|negocio|ventas|cierre|cerrando|finanzas|liquidez|margen|patrimonio|ox[ií]geno|runway|compromisos|egresos)/i.test(
        rawText
      );
    if (isDirectMemoryQuestion) {
      await handleAiMemoryQuery(supabase, chatId, rawText);
      return res.status(200).json({ ok: true });
    }

    tgCall('sendChatAction', { chat_id: chatId, action: 'typing' }).catch(() => {});

    const [catalog, accounts] = await Promise.all([
      fetchActiveStockCatalog(supabase),
      fetchCashAccounts(supabase),
    ]);

    // Comando rápido determinístico:
    // 1) /compra SKU COLOR:CANT [COLOR:CANT...] COSTO [PROVEEDOR...]
    // 2) /compra SKU COLOR CANT COSTO [PROVEEDOR...]
    // 3) /compra SKU_O_SKU_VARIANTE CANT COSTO [PROVEEDOR...]
    let intentHint = '';
    if (lowerText.startsWith('/compra')) {
      intentHint = '/compra';
      const rest = rawText.replace(/^\/compra(@\S+)?/i, '').trim();
      const parts = rest.split(/\s+/).filter(Boolean);

      if (parts.length >= 3) {
        const defaultAcc = accounts[0] || { id: 'banco_principal', nombre: 'Banco Principal' };
        const pairTokens: Array<{ color: string; qty: number }> = [];
        let cursor = 1;
        while (cursor < parts.length) {
          const m = parts[cursor].match(/^([^:\s]+):(\d+)$/);
          if (!m) break;
          pairTokens.push({ color: m[1], qty: Math.max(1, Math.round(Number(m[2]))) });
          cursor++;
        }

        if (pairTokens.length > 0 && cursor < parts.length && !Number.isNaN(Number(parts[cursor]))) {
          const cost = Math.max(0, Number(parts[cursor]));
          const proveedor = parts.slice(cursor + 1).join(' ') || 'Proveedor';
          const { parent } = findParentAndVariantByQuery(parts[0], catalog);

          if (!parent) {
            await sendTgMessage(
              chatId,
              `⚠️ No encontré ningún SKU activo que coincida con <code>${escapeHtml(parts[0])}</code>.`
            );
            return res.status(200).json({ ok: true });
          }

          const draftItems: DraftItem[] = [];
          const unmatchedNotes: string[] = [];
          for (const pt of pairTokens) {
            const matchedVar = findBestVariantMatch(parent, pt.color);
            if (!matchedVar) {
              unmatchedNotes.push(`${parent.sku} · variante "${pt.color}" no encontrada`);
              continue;
            }
            draftItems.push({
              sku: parent.sku,
              nombre: parent.nombre || parent.sku,
              cantidad: pt.qty,
              costo_unitario: cost,
              subtotal: Math.round(pt.qty * cost * 100) / 100,
              variante_id: matchedVar.variante_id,
              variant_sku: matchedVar.sku,
              color: matchedVar.color,
              talla: matchedVar.talla,
            });
          }

          if (draftItems.length === 0) {
            await sendTgMessage(
              chatId,
              `⚠️ No encontré esas variantes en <code>${escapeHtml(parent.sku)}</code>.\nUsa <code>/stock ${escapeHtml(parent.sku)}</code> para ver los colores/tallas exactos.`
            );
            return res.status(200).json({ ok: true });
          }

          const totalCompra =
            Math.round(draftItems.reduce((s, it) => s + it.subtotal, 0) * 100) / 100;
          const draft: TelegramDraft = {
            id: `p_${Date.now().toString(36)}`,
            kind: 'compra',
            chatId,
            status: 'pending',
            createdAt: new Date().toISOString(),
            proveedor,
            notas: 'Comando rápido /compra por variante',
            account_id: defaultAcc.id,
            account_nombre: defaultAcc.nombre,
            asentar_en_finanzas_sugerido: cost > 0,
            items: draftItems,
            total: totalCompra,
            unmatchedNotes: unmatchedNotes.length > 0 ? unmatchedNotes : undefined,
            rawInput: rawText,
          };

          await saveDraft(supabase, draft);
          await sendDraftConfirmationCard(chatId, draft);
          return res.status(200).json({ ok: true });
        }

        // Caso /compra SKU COLOR CANTIDAD COSTO [PROVEEDOR...]
        if (
          parts.length >= 4 &&
          Number.isNaN(Number(parts[1])) &&
          !Number.isNaN(Number(parts[2])) &&
          !Number.isNaN(Number(parts[3]))
        ) {
          const skuQuery = parts[0];
          const varQuery = parts[1];
          const qty = Math.max(1, Math.round(Number(parts[2])));
          const cost = Math.max(0, Number(parts[3]));
          const proveedor = parts.slice(4).join(' ') || 'Proveedor';
          const { parent } = findParentAndVariantByQuery(skuQuery, catalog);

          if (parent) {
            const matchedVar = findBestVariantMatch(parent, varQuery);
            if (!matchedVar) {
              await sendTgMessage(
                chatId,
                `⚠️ El producto <code>${escapeHtml(parent.sku)}</code> no tiene una variante que coincida con "${escapeHtml(varQuery)}".\nUsa <code>/stock ${escapeHtml(parent.sku)}</code> para ver variantes disponibles.`
              );
              return res.status(200).json({ ok: true });
            }

            const draft: TelegramDraft = {
              id: `p_${Date.now().toString(36)}`,
              kind: 'compra',
              chatId,
              status: 'pending',
              createdAt: new Date().toISOString(),
              proveedor,
              notas: 'Comando rápido /compra por variante',
              account_id: defaultAcc.id,
              account_nombre: defaultAcc.nombre,
              asentar_en_finanzas_sugerido: cost > 0,
              items: [
                {
                  sku: parent.sku,
                  nombre: parent.nombre || parent.sku,
                  cantidad: qty,
                  costo_unitario: cost,
                  subtotal: Math.round(qty * cost * 100) / 100,
                  variante_id: matchedVar.variante_id,
                  variant_sku: matchedVar.sku,
                  color: matchedVar.color,
                  talla: matchedVar.talla,
                },
              ],
              total: Math.round(qty * cost * 100) / 100,
              rawInput: rawText,
            };

            await saveDraft(supabase, draft);
            await sendDraftConfirmationCard(chatId, draft);
            return res.status(200).json({ ok: true });
          }
        }

        // Caso clásico /compra SKU CANTIDAD COSTO [PROVEEDOR...] (también acepta SKU_VARIANTE directo)
        if (!Number.isNaN(Number(parts[1])) && !Number.isNaN(Number(parts[2]))) {
          const skuQuery = parts[0];
          const qty = Math.max(1, Math.round(Number(parts[1])));
          const cost = Math.max(0, Number(parts[2]));
          const proveedor = parts.slice(3).join(' ') || 'Proveedor';
          const { parent: matched, variant: directVar } = findParentAndVariantByQuery(
            skuQuery,
            catalog
          );

          if (!matched) {
            await sendTgMessage(
              chatId,
              `⚠️ No encontré ningún SKU activo que coincida con <code>${escapeHtml(
                skuQuery
              )}</code>.\nUsa <code>/stock palabra</code> para ver el código exacto o escríbelo en lenguaje natural.`
            );
            return res.status(200).json({ ok: true });
          }

          const draft: TelegramDraft = {
            id: `p_${Date.now().toString(36)}`,
            kind: 'compra',
            chatId,
            status: 'pending',
            createdAt: new Date().toISOString(),
            proveedor,
            notas: directVar ? 'Comando rápido /compra (SKU variante)' : 'Comando rápido /compra',
            account_id: defaultAcc.id,
            account_nombre: defaultAcc.nombre,
            asentar_en_finanzas_sugerido: cost > 0,
            items: [
              {
                sku: matched.sku,
                nombre: matched.nombre || matched.sku,
                cantidad: qty,
                costo_unitario: cost,
                subtotal: Math.round(qty * cost * 100) / 100,
                ...(directVar
                  ? {
                      variante_id: directVar.variante_id,
                      variant_sku: directVar.sku,
                      color: directVar.color,
                      talla: directVar.talla,
                    }
                  : {}),
              },
            ],
            total: Math.round(qty * cost * 100) / 100,
            rawInput: rawText,
          };

          await saveDraft(supabase, draft);
          await sendDraftConfirmationCard(chatId, draft);
          return res.status(200).json({ ok: true });
        }
      }
    } else if (lowerText.startsWith('/merma') || lowerText.startsWith('/ajuste')) {
      const isMerma = lowerText.startsWith('/merma');
      intentHint = isMerma ? '/merma (ajuste_inventario)' : '/ajuste (ajuste_inventario)';
      const rest = rawText.replace(/^\/(merma|ajuste)(@\S+)?/i, '').trim();
      const parts = rest.split(/\s+/).filter(Boolean);
      if (parts.length >= 2 && !Number.isNaN(Number(parts[1]))) {
        const matched = findBestSkuMatch(parts[0], catalog);
        if (matched) {
          const rawNum = Number(parts[1]);
          const motivo = parts.slice(2).join(' ') || (isMerma ? 'Merma / Daño reportado' : 'Conteo físico');
          const stockActual = Number(matched.stock_fisico || 0);

          let tipoMov: 'merma_dano' | 'ajuste_positivo' | 'ajuste_negativo' = 'merma_dano';
          let qty = Math.abs(Math.round(rawNum));
          let resultante = Math.max(stockActual - qty, 0);

          if (!isMerma) {
            if (parts[1].startsWith('+')) {
              tipoMov = 'ajuste_positivo';
              resultante = stockActual + qty;
            } else if (parts[1].startsWith('-')) {
              tipoMov = 'ajuste_negativo';
              resultante = Math.max(stockActual - qty, 0);
            } else {
              // Conteo físico exacto
              const target = Math.max(0, Math.round(rawNum));
              const diff = target - stockActual;
              if (diff === 0) {
                await sendTgMessage(
                  chatId,
                  `ℹ️ <code>${escapeHtml(matched.sku)}</code> ya tiene stock físico de <b>${stockActual}</b>.`
                );
                return res.status(200).json({ ok: true });
              }
              tipoMov = diff > 0 ? 'ajuste_positivo' : 'ajuste_negativo';
              qty = Math.abs(diff);
              resultante = target;
            }
          }

          if (qty > 0) {
            const draft: TelegramDraft = {
              id: `a_${Date.now().toString(36)}`,
              kind: 'ajuste_inventario',
              chatId,
              status: 'pending',
              createdAt: new Date().toISOString(),
              sku: matched.sku,
              nombre: matched.nombre || matched.sku,
              tipo_movimiento: tipoMov,
              cantidad: qty,
              stock_actual: stockActual,
              stock_resultante: resultante,
              motivo,
              rawInput: rawText,
            };
            await saveDraft(supabase, draft);
            await sendDraftConfirmationCard(chatId, draft);
            return res.status(200).json({ ok: true });
          }
        }
      }
    } else if (lowerText.startsWith('/gasto')) {
      intentHint = '/gasto (gasto_operativo o gasto_pauta)';
    } else if (lowerText.startsWith('/estado')) {
      intentHint = '/estado (cambiar_estado_pedido)';
    }

    // Flujo inteligente con OpenAI GPT-4o-mini (texto, voz transcrita o foto)
    let imageDataUrl: string | null = null;
    if (hasPhoto) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      imageDataUrl = await downloadTelegramPhotoAsDataUrl(largestPhoto.file_id);
    }

    const cleanedPromptText = rawText
      .replace(/^\/(compra|gasto|merma|ajuste|estado)(@\S+)?/i, '')
      .trim();

    const parsed = await interpretWithOpenAI({
      text: cleanedPromptText || rawText,
      imageDataUrl,
      catalog,
      accounts,
      intentHint,
    });

    if (parsed.intent === 'consulta_stock') {
      await handleStockQuery(supabase, chatId, String(parsed.search_query || cleanedPromptText || rawText));
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'consulta_pedido') {
      await handleOrderSearchQuery(
        supabase,
        chatId,
        String(parsed.search_query || cleanedPromptText || rawText)
      );
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'cambiar_estado_pedido') {
      const targetEstado = normalizeEstadoOrder(String(parsed.next_status || ''));
      const orderQuery = String(parsed.order_query || parsed.search_query || '').trim();

      if (!targetEstado || !orderQuery) {
        await sendTgMessage(
          chatId,
          '⚠️ Indica el pedido (cliente, teléfono o código) y el nuevo estado.\nEjemplo: <code>/estado María entregado</code> o <i>"Pasa a ruta el pedido 70231940"</i>.'
        );
        return res.status(200).json({ ok: true });
      }

      const { data: recentOrders, error: ordErr } = await supabase
        .from('whatsapp_orders')
        .select('id,pedido_codigo,nombre_cliente,telefono,sku,catalogo_sku,total,estado,created_at')
        .order('created_at', { ascending: false })
        .limit(400);

      if (ordErr) {
        throw new Error(`Error buscando pedidos: ${ordErr.message}`);
      }

      const qLower = orderQuery.toLowerCase();
      const qDigits = orderQuery.replace(/\D/g, '');
      const allOrders = Array.isArray(recentOrders) ? recentOrders : [];

      // 1. Priorizar coincidencia exacta de código, short ID o teléfono completo
      let candidates = allOrders.filter((o: any) => {
        const code = String(o.pedido_codigo || '').trim().toLowerCase();
        const shortId = String(o.id || '').slice(0, 8).toLowerCase();
        const phoneDigits = String(o.telefono || '').replace(/\D/g, '');
        return (
          (code && code === qLower) ||
          (shortId && shortId === qLower.replace(/^#/, '')) ||
          (qDigits.length >= 6 && phoneDigits === qDigits)
        );
      });

      // 2. Si no hubo match exacto, buscar por coincidencia parcial en nombre / teléfono / código
      if (candidates.length === 0) {
        candidates = allOrders.filter((o: any) => {
          const hay = [o.pedido_codigo, o.nombre_cliente, o.telefono, String(o.id || '').slice(0, 8)]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (hay.includes(qLower)) return true;
          if (qDigits.length >= 4 && String(o.telefono || '').replace(/\D/g, '').includes(qDigits)) {
            return true;
          }
          return false;
        });
      }

      if (candidates.length === 0) {
        await sendTgMessage(
          chatId,
          `🔍 No encontré ningún pedido reciente para <b>${escapeHtml(orderQuery)}</b>.\nUsa <code>/pedido ${escapeHtml(orderQuery)}</code> para verificar.`
        );
        return res.status(200).json({ ok: true });
      }

      // Si hay más de 1 coincidencia y no todas ya están resueltas, pedir desambiguación si difieren
      const actionable = candidates.filter(
        (o: any) => (normalizeEstadoOrder(o.estado) || 'nuevo') !== targetEstado
      );
      const pool = actionable.length > 0 ? actionable : candidates;

      if (pool.length > 1) {
        const listLines = pool.slice(0, 5).map((o: any) => {
          const code = o.pedido_codigo || String(o.id || '').slice(0, 8).toUpperCase();
          return `• <code>${escapeHtml(code)}</code> · <b>${escapeHtml(o.nombre_cliente || 'Cliente')}</b> (${escapeHtml(
            o.telefono || 's/n'
          )}) · ${formatEstadoBadge(o.estado)} · ${fmtMoney(o.total)}`;
        });
        await sendTgMessage(
          chatId,
          [
            `🔎 Encontré <b>${pool.length} pedidos</b> que coinciden con "${escapeHtml(orderQuery)}":`,
            '',
            ...listLines,
            '',
            `Indícame el código o teléfono exacto, por ejemplo: <code>/estado ${escapeHtml(
              pool[0].pedido_codigo || String(pool[0].id || '').slice(0, 8).toUpperCase()
            )} ${targetEstado}</code>`,
          ].join('\n')
        );
        return res.status(200).json({ ok: true });
      }

      const targetOrder = pool[0];
      const currentEstado = normalizeEstadoOrder(targetOrder.estado) || 'nuevo';
      const orderCode =
        targetOrder.pedido_codigo || String(targetOrder.id || '').slice(0, 8).toUpperCase();

      if (currentEstado === targetEstado) {
        await sendTgMessage(
          chatId,
          `ℹ️ El pedido <code>${escapeHtml(orderCode)}</code> (${escapeHtml(
            targetOrder.nombre_cliente || 'Cliente'
          )}) ya está en estado <b>${formatEstadoBadge(currentEstado)}</b>.`
        );
        return res.status(200).json({ ok: true });
      }

      const draft: TelegramDraft = {
        id: `st_${Date.now().toString(36)}`,
        kind: 'cambiar_estado_pedido',
        chatId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        order_id: targetOrder.id,
        pedido_codigo: orderCode,
        nombre_cliente: targetOrder.nombre_cliente || 'Cliente',
        telefono: targetOrder.telefono || '',
        sku_display: targetOrder.sku || targetOrder.catalogo_sku || 'Producto',
        total: Number(targetOrder.total || 0),
        estado_anterior: currentEstado,
        estado_nuevo: targetEstado,
        motivo_cancelacion:
          targetEstado === 'cancelado'
            ? String(parsed.cancel_reason || 'Cancelado desde Telegram').trim()
            : undefined,
        rawInput: rawText,
      };

      await saveDraft(supabase, draft);
      await sendDraftConfirmationCard(chatId, draft);
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'consulta_pendientes') {
      await handlePendingOrdersQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'consulta_brief') {
      await handleBriefCommand(req, chatId, '');
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'consulta_salud_financiera') {
      await handleFinancialHealthQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'consulta_radar_inferencia') {
      await handleRadarInferenceQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'consulta_objeciones_chats') {
      await handleObjectionsMiningQuery(supabase, chatId);
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'consulta_memoria_ia') {
      await handleAiMemoryQuery(
        supabase,
        chatId,
        String(parsed.search_query || cleanedPromptText || rawText)
      );
      return res.status(200).json({ ok: true });
    }

    // Fallback inteligente si preguntó algo sobre el negocio en lenguaje natural
    const looksLikeBusinessQuestion =
      /\?|por\s*qu[eé]|qu[eé]\s+pas[oó]|cu[aá]l|c[oó]mo\s+(va|est[aá]|cerr|rend)|tendencia|roas|pauta|cancel|product|semana|ayer|recomiend|analiz|memoria|negocio|ventas|salud|finanzas|liquidez|margen|valor\s+real|ox[ií]geno/i.test(
        rawText
      );
    if (parsed.intent === 'otro' && rawText.length >= 10 && looksLikeBusinessQuestion) {
      await handleAiMemoryQuery(supabase, chatId, rawText);
      return res.status(200).json({ ok: true });
    }

    const chosenAccount =
      accounts.find((a: any) => a.id === parsed.account_id) ||
      accounts[0] || { id: 'caja_chica', nombre: 'Caja Chica' };

    if (parsed.intent === 'gasto_operativo') {
      const monto = Math.round(Number(parsed.monto || 0) * 100) / 100;
      if (monto <= 0) {
        await sendTgMessage(
          chatId,
          '⚠️ Detecté un gasto operativo pero no identifiqué el monto. Ejemplo: <i>"Pagué $20 de gasolina de caja chica"</i>.'
        );
        return res.status(200).json({ ok: true });
      }
      const draft: TelegramDraft = {
        id: `g_${Date.now().toString(36)}`,
        kind: 'gasto_operativo',
        chatId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        monto,
        categoria: String(parsed.categoria || 'gasto_manual').trim() || 'gasto_manual',
        descripcion: String(parsed.descripcion || cleanedPromptText || 'Gasto operativo').trim(),
        account_id: chosenAccount.id,
        account_nombre: chosenAccount.nombre,
        rawInput: rawText || '[Foto de recibo]',
      };
      await saveDraft(supabase, draft);
      await sendDraftConfirmationCard(chatId, draft);
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'gasto_pauta') {
      const monto = Math.round(Number(parsed.monto || 0) * 100) / 100;
      if (monto <= 0) {
        await sendTgMessage(
          chatId,
          '⚠️ Detecté un gasto de pauta pero falta el monto. Ejemplo: <i>"Pagué $35 de pauta al anuncio PROMO1"</i>.'
        );
        return res.status(200).json({ ok: true });
      }
      const allowedPlatforms = ['Meta', 'TikTok', 'Google', 'WhatsApp', 'Otro'] as const;
      const rawPlat = String(parsed.plataforma || 'Meta').trim();
      const plataforma =
        allowedPlatforms.find((p) => p.toLowerCase() === rawPlat.toLowerCase()) || 'Meta';

      const draft: TelegramDraft = {
        id: `ad_${Date.now().toString(36)}`,
        kind: 'gasto_pauta',
        chatId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        monto,
        codigo_anuncio:
          String(parsed.codigo_anuncio || 'GENERAL')
            .trim()
            .toUpperCase() || 'GENERAL',
        plataforma,
        notas: String(parsed.notas || parsed.descripcion || '').trim(),
        account_id: chosenAccount.id,
        account_nombre: chosenAccount.nombre,
        rawInput: rawText || '[Comprobante pauta]',
      };
      await saveDraft(supabase, draft);
      await sendDraftConfirmationCard(chatId, draft);
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'ajuste_inventario') {
      const candidate =
        findBestSkuMatch(String(parsed.sku || ''), catalog) ||
        findBestSkuMatch(String(parsed.raw_name || ''), catalog);

      if (!candidate) {
        await sendTgMessage(
          chatId,
          `⚠️ No encontré qué SKU ajustar en tu mensaje.\nUsa <code>/stock palabra</code> para ver el código exacto.`
        );
        return res.status(200).json({ ok: true });
      }

      const stockActual = Number(candidate.stock_fisico || 0);
      const rawQty = Math.round(Number(parsed.cantidad || 0));
      const mode = String(parsed.adjustment_mode || 'merma').toLowerCase();

      let tipoMov: 'merma_dano' | 'ajuste_positivo' | 'ajuste_negativo' = 'merma_dano';
      let qty = Math.abs(rawQty);
      let resultante = Math.max(stockActual - qty, 0);

      if (mode === 'conteo_exacto') {
        const target = Math.max(0, rawQty);
        const diff = target - stockActual;
        if (diff === 0) {
          await sendTgMessage(
            chatId,
            `ℹ️ <code>${escapeHtml(candidate.sku)}</code> ya tiene físico exacto de <b>${stockActual}</b>.`
          );
          return res.status(200).json({ ok: true });
        }
        tipoMov = diff > 0 ? 'ajuste_positivo' : 'ajuste_negativo';
        qty = Math.abs(diff);
        resultante = target;
      } else if (mode === 'delta_positivo') {
        tipoMov = 'ajuste_positivo';
        resultante = stockActual + qty;
      } else if (mode === 'delta_negativo') {
        tipoMov = 'ajuste_negativo';
        resultante = Math.max(stockActual - qty, 0);
      }

      if (qty <= 0) {
        await sendTgMessage(chatId, '⚠️ Indica cuántas unidades ajustar o reportar como merma.');
        return res.status(200).json({ ok: true });
      }

      const draft: TelegramDraft = {
        id: `a_${Date.now().toString(36)}`,
        kind: 'ajuste_inventario',
        chatId,
        status: 'pending',
        createdAt: new Date().toISOString(),
        sku: candidate.sku,
        nombre: candidate.nombre || candidate.sku,
        tipo_movimiento: tipoMov,
        cantidad: qty,
        stock_actual: stockActual,
        stock_resultante: resultante,
        motivo: String(parsed.motivo || 'Reporte desde Telegram').trim(),
        rawInput: rawText,
      };
      await saveDraft(supabase, draft);
      await sendDraftConfirmationCard(chatId, draft);
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent !== 'compra' || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      await sendTgMessage(
        chatId,
        parsed.reply_hint
          ? escapeHtml(parsed.reply_hint)
          : `No detecté una acción clara.\n\nPrueba:\n• <i>"Compré 10 cascos negros a $12.50"</i>\n• <i>"Pagué $20 de gasolina de caja chica"</i>\n• <i>"¿Cómo va el pedido de Tatiana?"</i>\n• O envía /ayuda.`
      );
      return res.status(200).json({ ok: true });
    }

    const draftItems: DraftItem[] = [];
    const unmatchedNotes: string[] = [];

    for (const rawItem of parsed.items) {
      const qty = Math.round(Number(rawItem?.cantidad || 0));
      if (qty <= 0) continue;

      const byVarSku = findParentAndVariantByQuery(String(rawItem?.variant_sku || ''), catalog);
      const bySku = findParentAndVariantByQuery(String(rawItem?.sku || ''), catalog);
      const byName = findParentAndVariantByQuery(String(rawItem?.raw_name || ''), catalog);

      const candidate = byVarSku.parent || bySku.parent || byName.parent;
      const directVariant = byVarSku.variant || bySku.variant || byName.variant;

      if (!candidate) {
        unmatchedNotes.push(
          `${rawItem?.raw_name || rawItem?.sku || 'Producto'} (${qty} u. × ${fmtMoney(
            Number(rawItem?.costo_unitario || 0)
          )})`
        );
        continue;
      }

      const variantQuery = [rawItem?.color, rawItem?.talla].filter(Boolean).join(' ').trim();
      const matchedVariant =
        directVariant ||
        findBestVariantMatch(candidate, String(rawItem?.variant_sku || '')) ||
        findBestVariantMatch(candidate, variantQuery) ||
        findBestVariantMatch(candidate, String(rawItem?.raw_name || ''));

      // Si el usuario especificó explícitamente un color/variante y el producto tiene variantes pero no coincide ninguna, avisar en notas
      if (variantQuery && Array.isArray(candidate.variants) && candidate.variants.length > 0 && !matchedVariant) {
        const dispList = candidate.variants
          .map((v: TelegramCatalogVariant) => formatVariantLabel(v.color, v.talla))
          .join(', ');
        unmatchedNotes.push(
          `${candidate.sku} · variante "${variantQuery}" no existe (activas: ${dispList})`
        );
        continue;
      }

      const unitCost = Math.max(
        Number(rawItem?.costo_unitario ?? candidate.costo_unitario ?? 0) || 0,
        0
      );

      draftItems.push({
        sku: candidate.sku,
        nombre: candidate.nombre || candidate.sku,
        cantidad: qty,
        costo_unitario: Math.round(unitCost * 100) / 100,
        subtotal: Math.round(qty * unitCost * 100) / 100,
        ...(matchedVariant
          ? {
              variante_id: matchedVariant.variante_id,
              variant_sku: matchedVariant.sku,
              color: matchedVariant.color,
              talla: matchedVariant.talla,
            }
          : {}),
      });
    }

    if (draftItems.length === 0) {
      await sendTgMessage(
        chatId,
        [
          `⚠️ Entendí la compra, pero no logré empatar los productos con ningún SKU activo de tu inventario:`,
          ...unmatchedNotes.map((u) => `• ${escapeHtml(u)}`),
          '',
          `Usa <code>/stock palabra</code> para ver los SKUs exactos o créalo primero en Catálogo Visual.`,
        ].join('\n')
      );
      return res.status(200).json({ ok: true });
    }

    const totalCompra =
      Math.round(draftItems.reduce((s, it) => s + it.subtotal, 0) * 100) / 100;

    const draft: TelegramDraft = {
      id: `p_${Date.now().toString(36)}`,
      kind: 'compra',
      chatId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      proveedor: String(parsed.proveedor || 'Proveedor').trim() || 'Proveedor',
      notas: String(parsed.notas || '').trim(),
      account_id: chosenAccount.id,
      account_nombre: chosenAccount.nombre,
      asentar_en_finanzas_sugerido: parsed.asentar_en_finanzas !== false,
      items: draftItems,
      total: totalCompra,
      unmatchedNotes: unmatchedNotes.length > 0 ? unmatchedNotes : undefined,
      rawInput: rawText || '[Foto de factura]',
    };

    await saveDraft(supabase, draft);
    await sendDraftConfirmationCard(chatId, draft);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('Error en /api/morning-brief (telegram):', err);
    try {
      const chatId = err?.chatId || req.body?.message?.chat?.id || req.body?.callback_query?.message?.chat?.id;
      if (chatId && process.env.TELEGRAM_BOT_TOKEN && !action) {
        await sendTgMessage(
          chatId,
          `⚠️ Error procesando tu solicitud: ${escapeHtml(err?.message || 'Error interno')}`
        );
      }
    } catch {}
    if (action) {
      return res.status(500).json({ error: err?.message || 'Error interno en Telegram Webhook' });
    }
    return res.status(200).json({ ok: true, handledError: err?.message });
  }
}
