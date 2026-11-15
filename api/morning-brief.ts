import { createClient } from '@supabase/supabase-js';

type BriefType = 'morning' | 'evening' | 'full';

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
  const staleRouteThresholdMs = nowMs - 36 * 60 * 60 * 1000;
  const last48hIso = new Date(nowMs - 48 * 60 * 60 * 1000).toISOString();

  try {
    const [
      ordersRes,
      convRes,
      msgsRes,
      stateRes,
      stockRes,
      adRes,
      pagosRes,
      notasRes,
      bizDocRes,
      catDocRes,
      accountsRes,
      txTodayRes,
    ] = await Promise.all([
      supabase
        .from('whatsapp_orders')
        .select(
          'id,pedido_codigo,nombre_cliente,sku,catalogo_sku,total,estado,liquidado,es_encargo,fecha_programada,codigo_anuncio,notas,created_at'
        )
        .order('created_at', { ascending: false })
        .limit(800),
      supabase
        .from('bb_conversations')
        .select('id,instance_id,contact_name,contact_phone,last_message,updated_at,status')
        .order('updated_at', { ascending: false })
        .limit(200),
      supabase
        .from('bb_messages')
        .select('conversation_id,from_me,created_at')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('whatsapp_state')
        .select('last_sku,last_nombre,last_detalle,paso_actual,updated_at')
        .gte('updated_at', last48hIso)
        .limit(150),
      supabase
        .from('inventory_stock')
        .select('sku,nombre,costo_unitario,stock_disponible,stock_minimo_alerta,activo,activo_todd')
        .order('stock_disponible', { ascending: true }),
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
      supabase.from('finance_cash_accounts').select('nombre,saldo_actual,activo'),
      supabase
        .from('finance_money_transactions')
        .select('tipo,categoria,monto,fecha')
        .eq('fecha', dateInfo.svTodayIso),
    ]);

    /* 1. INVENTARIO & MAPA DE COSTOS (COGS) */
    const stockRows = Array.isArray(stockRes.data) ? stockRes.data : [];
    const costBySku = new Map<string, number>();
    const nameBySku = new Map<string, string>();
    const normalizedStockEntries: Array<{ key: string; sku: string; costo: number }> = [];

    for (const item of stockRows) {
      const skuUpper = String(item.sku || '').trim().toUpperCase();
      const costo = Number(item.costo_unitario) || 0;
      const itemName = String(item.nombre || item.sku || '').trim();
      if (skuUpper) {
        costBySku.set(skuUpper, costo);
        nameBySku.set(skuUpper, itemName);
        normalizedStockEntries.push({
          key: normalizeTextKey(itemName),
          sku: skuUpper,
          costo,
        });
      }
    }

    const resolveOrderUnitCost = (o: any): { found: boolean; cost: number; label: string } => {
      const catSku = String(o.catalogo_sku || '').trim().toUpperCase();
      if (catSku && costBySku.has(catSku)) {
        const c = costBySku.get(catSku) || 0;
        return { found: c > 0, cost: c, label: nameBySku.get(catSku) || catSku };
      }
      const rawSkuUpper = String(o.sku || '').trim().toUpperCase();
      if (rawSkuUpper && costBySku.has(rawSkuUpper)) {
        const c = costBySku.get(rawSkuUpper) || 0;
        return { found: c > 0, cost: c, label: nameBySku.get(rawSkuUpper) || rawSkuUpper };
      }
      const normRaw = normalizeTextKey(o.sku);
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
      const s = String(item.sku || '').toLowerCase();
      return !s.includes('fee') && !s.includes('test') && !s.includes('descuento') && item.activo !== false;
    });
    const outOfStock = validStock.filter((i: any) => Number(i.stock_disponible || 0) <= 0);
    const lowStock = validStock.filter((i: any) => {
      const qty = Number(i.stock_disponible || 0);
      const min = Math.max(3, Number(i.stock_minimo_alerta) || 3);
      return qty > 0 && qty <= min;
    });

    /* 2. PEDIDOS: DESPACHO, ENCARGOS, RUTA Y VENTAS (HOY / AYER / MES) */
    const orders = Array.isArray(ordersRes.data) ? ordersRes.data : [];
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

    for (const o of orders) {
      const estado = String(o.estado || '').toLowerCase();
      const createdAt = String(o.created_at || '');
      const createdMs = createdAt ? new Date(createdAt).getTime() : 0;
      const isCancelled = estado === 'cancelado';

      if (estado === 'nuevo' || estado === 'por_empacar') {
        porDespachar.push(o);
        if (String(o.notas || '').includes('[Indicación cliente]')) {
          indicacionesPostCierreCount++;
        }
      }

      if (estado === 'en_camino') {
        enRuta.push(o);
        if (createdMs > 0 && createdMs < staleRouteThresholdMs) {
          enRutaRezagados.push(o);
        }
      }

      if (estado === 'entregado' && !o.liquidado) {
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

      if (createdAt >= dateInfo.svTodayStartUtc) {
        if (isCancelled) canceladosHoyOrders.push(o);
        else ventasHoyOrders.push(o);
      }

      if (!isCancelled && createdAt >= dateInfo.svYesterdayStartUtc && createdAt < dateInfo.svTodayStartUtc) {
        ventasAyerOrders.push(o);
      }

      if (!isCancelled && createdAt >= dateInfo.svMonthStartUtc) {
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
      const qty = inferOrderQty(o.sku);
      const resolved = resolveOrderUnitCost(o);
      if (resolved.found) {
        cogsHoyTotal += resolved.cost * qty;
      } else {
        ordersHoySinCosto++;
      }

      const prodLabel = resolved.label || 'Producto';
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

    const accountsRows = Array.isArray(accountsRes.data) ? accountsRes.data : [];
    const totalLiquidity = accountsRows
      .filter((a: any) => a.activo !== false)
      .reduce((s: number, a: any) => s + (Number(a.saldo_actual) || 0), 0);

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

    /* 6. ARMAR MENSAJE SEGÚN TIPO ('morning' | 'evening' | 'full') */
    const lines: string[] = [];

    if (briefType === 'morning') {
      lines.push(`☀️ <b>BRIEF OPERATIVO (8:00 AM) — TODOENUNO</b>`);
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
            const tag = e.diff !== null && e.diff < 0 ? 'atrasado' : e.diff === 0 ? 'hoy' : 'mañana';
            return `${escapeHtml(e.nombre_cliente || 'Cliente')} (${tag})`;
          })
          .join(', ');
        lines.push(`• Encargos urgentes: <b>${encargosUrgentes.length}</b> — ${encPreview}`);
      }
      lines.push(
        `• En ruta ahora: <b>${enRuta.length} guías</b> (${fmtMoney(totalEnRuta)})${
          enRutaRezagados.length > 0 ? ` · ⚠️ <b>${enRutaRezagados.length} con +36h</b>` : ''
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
      if (accountsRows.length > 0) {
        lines.push(`• Liquidez en cuentas: <b>${fmtMoney(totalLiquidity)}</b>`);
      }
      if (otherExpensesToday > 0) {
        lines.push(`• Otros gastos hoy: ${fmtMoney(otherExpensesToday)}`);
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
          lines.push(`• Stock bajo (${lowStock.length}): ${names}`);
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
          enRutaRezagados.length > 0 ? ` · ⚠️ <b>${enRutaRezagados.length} con +36h</b>` : ''
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
        `• Por liquidar: <b>${fmtMoney(totalPorLiquidar)}</b> (${porLiquidar.length} guías)`
      );
      if (accountsRows.length > 0) {
        lines.push(`• Liquidez en cuentas: <b>${fmtMoney(totalLiquidity)}</b>`);
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
          lines.push(`• Stock bajo (${lowStock.length}): ${names}`);
        }
      }

      if (notasRows.length > 0) {
        lines.push('');
        lines.push(`📝 <b>NOTAS PENDIENTES (HOY)</b>`);
        for (const n of notasRows.slice(0, 3)) {
          lines.push(`• ${escapeHtml(String(n.contenido || '').slice(0, 110))}`);
        }
      }

      lines.push('');
      lines.push(
        `🔗 <a href="${panelOrigin}/">Hoy</a> · <a href="${panelOrigin}/unichat">UniChat</a> · <a href="${panelOrigin}/pedidos">Pedidos</a> · <a href="${panelOrigin}/rentabilidad">Rentabilidad</a>`
      );
    }

    const mensaje = lines.join('\n');

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

interface DraftItem {
  sku: string;
  nombre: string;
  cantidad: number;
  costo_unitario: number;
  subtotal: number;
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

async function sendTgMessage(
  chatId: string | number,
  text: string,
  extra: Record<string, any> = {}
) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
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

async function fetchActiveStockCatalog(supabase: any) {
  const { data, error } = await supabase
    .from('inventory_stock')
    .select('sku,nombre,stock_fisico,stock_reservado,stock_disponible,costo_unitario,precio_venta,activo')
    .order('nombre');

  if (error || !Array.isArray(data)) return [];
  return data.filter(
    (item: any) =>
      item.activo !== false && !String(item.sku || '').toLowerCase().includes('fee')
  );
}

async function fetchCashAccounts(supabase: any) {
  try {
    const res = await supabase
      .from('finance_cash_accounts')
      .select('id,nombre,tipo,saldo_actual')
      .order('nombre');
    if (!res.error && Array.isArray(res.data) && res.data.length > 0) {
      return res.data;
    }

    const schemaRes = await supabase
      .schema('finance')
      .from('cash_accounts')
      .select('id,nombre,tipo,saldo_actual')
      .order('nombre');
    if (!schemaRes.error && Array.isArray(schemaRes.data) && schemaRes.data.length > 0) {
      return schemaRes.data;
    }
  } catch {}

  return [
    { id: 'caja_chica', nombre: 'Caja Chica / Efectivo Bodega', tipo: 'cash', saldo_actual: 0 },
    { id: 'banco_principal', nombre: 'Banco Principal', tipo: 'bank', saldo_actual: 0 },
  ];
}

function findBestSkuMatch(rawQuery: string, catalog: any[]) {
  const clean = normalizeSku(rawQuery);
  if (!clean) return null;

  const exact = catalog.find((item) => normalizeSku(item.sku) === clean);
  if (exact) return exact;

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
    .map(
      (i: any) =>
        `- SKU: ${i.sku} | Nombre: ${i.nombre} | Costo: $${Number(i.costo_unitario || 0).toFixed(2)} | Físico: ${Number(i.stock_fisico || 0)} | Disp: ${Number(i.stock_disponible || 0)}`
    )
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
   - "otro": saludo o tema ajeno.
${params.intentHint ? `\nPISTA DE CONTEXTO: El usuario inició con el comando ${params.intentHint}.\n` : ''}
2. Detalles por intent:
   - Si "compra": llena "items" [{ "sku", "raw_name", "cantidad", "costo_unitario" }], "proveedor", "account_id", "asentar_en_finanzas", "notas". (Si en factura viene total de línea, divide entre cantidad para obtener costo_unitario).
   - Si "gasto_operativo": llena "monto" (>0), "descripcion", "account_id", y "categoria" entre: "flete_envio", "empaque_suministros", "alquiler_servicios", "nomina_sueldos", "suscripciones", "comision_pasarela", "gasto_manual", "otro_gasto".
   - Si "gasto_pauta": llena "monto" (>0), "codigo_anuncio" (en MAYÚSCULAS, ej. "PROMO1", o "GENERAL" si no menciona código), "plataforma" ("Meta"|"TikTok"|"Google"|"WhatsApp"|"Otro"), "account_id", "notas".
   - Si "ajuste_inventario": llena "adjustment_mode": "merma" (daño/pérdida/muestra), "delta_positivo" (sumar), "delta_negativo" (restar), o "conteo_exacto" (fijar stock físico total); llena "sku", "raw_name", "cantidad" (entero >= 0: si es conteo_exacto es la cantidad final observada en bodega, si es merma/delta es las unidades que salen/entran), y "motivo".
   - Si "cambiar_estado_pedido": llena "order_query" (nombre de cliente, teléfono o código del pedido), "next_status" en UNO de: "nuevo" | "programado" | "por_empacar" | "en_camino" | "entregado" | "cancelado" ("empacar"/"empaque" -> "por_empacar", "ruta"/"motorista"/"despachado" -> "en_camino", "encargo" -> "programado"), y "cancel_reason" si es cancelación.
   - Si "consulta_pedido" o "consulta_stock": pon en "search_query" el nombre, teléfono, código o producto buscado.
   - En "account_id": elige el id exacto ("efectivo"/"caja" -> caja_chica, "banco"/"transferencia" -> banco_principal), o "${params.accounts[0]?.id || 'caja_chica'}" si no menciona.

3. Devuelve EXCLUSIVAMENTE JSON válido con esta estructura:
{
  "intent": "compra" | "gasto_operativo" | "gasto_pauta" | "ajuste_inventario" | "cambiar_estado_pedido" | "consulta_pedido" | "consulta_pendientes" | "consulta_stock" | "consulta_brief" | "otro",
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
    { "sku": "", "raw_name": "", "cantidad": 0, "costo_unitario": 0 }
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

async function emitBestEffortOsEvent(
  supabase: any,
  type: string,
  sourceTable: string,
  sourceId: string,
  payload: Record<string, any>
) {
  try {
    await supabase.schema('os').from('events').insert({
      type,
      source_table: sourceTable,
      source_id: sourceId,
      idempotency_key: `${sourceTable}:${sourceId}:${type}:${Date.now()}`,
      payload,
    });
  } catch {
    // No bloquear flujo si os.events no está migrado
  }
}

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
    lines.push(
      `• <code>${escapeHtml(it.sku)}</code> (${escapeHtml(it.nombre)})\n  <b>+${it.cantidad} u.</b> × ${fmtMoney(it.costo_unitario)} = <b>${fmtMoney(it.subtotal)}</b>`
    );
  }

  if (compra.unmatchedNotes && compra.unmatchedNotes.length > 0) {
    lines.push('');
    lines.push(`⚠️ <i>No encontré SKU exacto para:</i>`);
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
          String(i.nombre || '').toLowerCase().includes(q)
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
      return `${icon} <code>${escapeHtml(i.sku)}</code> · <b>${escapeHtml(i.nombre)}</b>\n   Disp: <b>${disp}</b> (Físico ${fis} · Res ${res}) · Costo ${fmtMoney(i.costo_unitario)}`;
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
  const { data: orders, error } = await supabase
    .from('whatsapp_orders')
    .select(
      'id,pedido_codigo,nombre_cliente,telefono,departamento,courier,sku,total,estado,liquidado,es_encargo,fecha_programada,created_at'
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    throw new Error(`Error consultando pendientes: ${error.message}`);
  }

  const all = Array.isArray(orders) ? orders : [];
  const nuevos = all.filter((o: any) => String(o.estado || '').toLowerCase() === 'nuevo');
  const porEmpacar = all.filter((o: any) => String(o.estado || '').toLowerCase() === 'por_empacar');
  const enCamino = all.filter((o: any) => String(o.estado || '').toLowerCase() === 'en_camino');
  const encargosProntos = all.filter((o: any) => {
    const est = String(o.estado || '').toLowerCase();
    if (est !== 'programado') return false;
    if (!o.fecha_programada) return true;
    return String(o.fecha_programada).slice(0, 10) <= todayIso;
  });
  const porLiquidar = all.filter(
    (o: any) => String(o.estado || '').toLowerCase() === 'entregado' && o.liquidado !== true
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
        // Compra de mercadería
        const compra = draft as Extract<TelegramDraft, { items: DraftItem[] }>;
        const withFinance = finFlag === '1';
        const resultLines: string[] = [];
        let hadError = false;

        for (const item of compra.items) {
          const motivo = `Compra Telegram · ${compra.proveedor || 'Proveedor'}${
            compra.notas ? ` · ${compra.notas}` : ''
          }`.trim();

          const movRes = await executeInventoryMovementServer(supabase, {
            sku: item.sku,
            tipo_movimiento: 'compra_entrada',
            cantidad: item.cantidad,
            costo_unitario: item.costo_unitario,
            motivo,
            source_id: compra.id,
          });

          if (movRes.ok) {
            resultLines.push(
              `• <code>${escapeHtml(item.sku)}</code> +${item.cantidad} u. (${fmtMoney(
                item.costo_unitario
              )}) → Físico: <b>${movRes.nuevoFisico ?? 'OK'}</b> · Disp: <b>${
                movRes.nuevoDisponible ?? 'OK'
              }</b>`
            );

            await emitBestEffortOsEvent(
              supabase,
              'supplier.bid.received',
              'inventory_stock',
              item.sku,
              {
                sku: item.sku,
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

        let financeSummary = 'Finanzas: No descontado (solo entrada de inventario).';
        if (withFinance && compra.total > 0) {
          const desc = `Compra Telegram (${compra.proveedor}): ${compra.items
            .map((i) => `${i.cantidad}x ${i.sku}`)
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
          `📦 <b>Compras e Inventario:</b>`,
          `• <i>"Compré 10 cascos negros a $12.50 en MotoParts pagado de banco"</i>`,
          `• <code>/compra SKU CANTIDAD COSTO [PROVEEDOR]</code>`,
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
          `• <code>/brief [am|pm]</code> — Brief operativo completo`,
        ].join('\n')
      );
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
      const accounts = await fetchCashAccounts(supabase);
      const lines = [
        `🏦 <b>CUENTAS Y CAJAS EN FINANZAS</b>`,
        '',
        ...accounts.map(
          (a: any) =>
            `• <b>${escapeHtml(a.nombre)}</b> (<code>${escapeHtml(a.id)}</code>): <b>${fmtMoney(a.saldo_actual)}</b>`
        ),
      ];
      await sendTgMessage(chatId, lines.join('\n'));
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/brief')) {
      const arg = rawText.replace(/^\/brief(@\S+)?/i, '').trim();
      await handleBriefCommand(req, chatId, arg);
      return res.status(200).json({ ok: true });
    }

    const [catalog, accounts] = await Promise.all([
      fetchActiveStockCatalog(supabase),
      fetchCashAccounts(supabase),
    ]);

    // Comando rápido determinístico: /compra SKU CANTIDAD COSTO [PROVEEDOR...]
    let intentHint = '';
    if (lowerText.startsWith('/compra')) {
      intentHint = '/compra';
      const rest = rawText.replace(/^\/compra(@\S+)?/i, '').trim();
      const parts = rest.split(/\s+/).filter(Boolean);
      if (parts.length >= 3 && !Number.isNaN(Number(parts[1])) && !Number.isNaN(Number(parts[2]))) {
        const skuQuery = parts[0];
        const qty = Math.max(1, Math.round(Number(parts[1])));
        const cost = Math.max(0, Number(parts[2]));
        const proveedor = parts.slice(3).join(' ') || 'Proveedor';
        const matched = findBestSkuMatch(skuQuery, catalog);

        if (!matched) {
          await sendTgMessage(
            chatId,
            `⚠️ No encontré ningún SKU activo que coincida con <code>${escapeHtml(
              skuQuery
            )}</code>.\nUsa <code>/stock palabra</code> para ver el código exacto o escríbelo en lenguaje natural.`
          );
          return res.status(200).json({ ok: true });
        }

        const defaultAcc = accounts[0] || { id: 'banco_principal', nombre: 'Banco Principal' };
        const draft: TelegramDraft = {
          id: `p_${Date.now().toString(36)}`,
          kind: 'compra',
          chatId,
          status: 'pending',
          createdAt: new Date().toISOString(),
          proveedor,
          notas: 'Comando rápido /compra',
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
            },
          ],
          total: Math.round(qty * cost * 100) / 100,
          rawInput: rawText,
        };

        await saveDraft(supabase, draft);
        await sendDraftConfirmationCard(chatId, draft);
        return res.status(200).json({ ok: true });
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

      const candidate =
        findBestSkuMatch(String(rawItem?.sku || ''), catalog) ||
        findBestSkuMatch(String(rawItem?.raw_name || ''), catalog);

      if (!candidate) {
        unmatchedNotes.push(
          `${rawItem?.raw_name || rawItem?.sku || 'Producto'} (${qty} u. × ${fmtMoney(
            Number(rawItem?.costo_unitario || 0)
          )})`
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
