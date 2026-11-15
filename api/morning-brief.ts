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
