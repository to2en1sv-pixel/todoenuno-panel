import { createClient } from '@supabase/supabase-js';

const GRAPH_VERSION = 'v19.0';
const INSIGHTS_DOC_TITLE = '__SYSTEM_META_ADS_INSIGHTS_V1__';
const TIME_ZONE = 'America/El_Salvador';

async function emitServerOsEvent(
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

function getElSalvadorDate(offsetDays = 0): string {
  const now = new Date();
  const svNowStr = now.toLocaleString('en-US', { timeZone: TIME_ZONE });
  const svDate = new Date(svNowStr);
  svDate.setDate(svDate.getDate() + offsetDays);
  const y = svDate.getFullYear();
  const m = String(svDate.getMonth() + 1).padStart(2, '0');
  const d = String(svDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function readDocJson<T>(supabase: any, titulo: string, fallback: T): Promise<{ id?: string; data: T }> {
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

function normalizeAdAccountId(raw: string): string {
  const clean = String(raw || '').trim();
  if (!clean) return '';
  return clean.startsWith('act_') ? clean : `act_${clean}`;
}

/**
 * Extrae el código de anuncio/SKU desde el nombre del anuncio o campaña.
 * Ejemplos soportados:
 *  - "[PROMO1] Video Masajeador" -> "PROMO1"
 *  - "MASAJ-01 | Reel Testimonio" -> "MASAJ-01"
 *  - "PROMO1 - Oferta" -> "PROMO1"
 */
function extractAdCode(adName?: string, campaignName?: string): string {
  const raw = String(adName || campaignName || '').trim();
  if (!raw) return 'META-GENERAL';

  const bracket = raw.match(/\[([A-Za-z0-9_-]{2,28})\]/);
  if (bracket?.[1]) return bracket[1].toUpperCase();

  const pipeSplit = raw.split(/\s*[|·]\s*/)[0]?.trim();
  if (pipeSplit && /^[A-Za-z0-9_-]{2,24}$/.test(pipeSplit)) {
    return pipeSplit.toUpperCase();
  }

  const dashSplit = raw.split(/\s+-\s+/)[0]?.trim();
  if (dashSplit && /^[A-Za-z0-9_-]{2,24}$/.test(dashSplit)) {
    return dashSplit.toUpperCase();
  }

  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28) || 'META-GENERAL';
}

function extractMessagingCount(actions: any[]): number {
  if (!Array.isArray(actions)) return 0;
  const preferredTypes = [
    'onsite_conversion.messaging_conversation_started_7d',
    'onsite_conversion.total_messaging_connection',
    'onsite_conversion.messaging_first_reply',
  ];
  for (const t of preferredTypes) {
    const found = actions.find((a) => a?.action_type === t);
    if (found && Number(found.value) > 0) return Number(found.value);
  }
  return 0;
}

async function safeFetchAdAccounts(supabase: any): Promise<{
  tableReady: boolean;
  accounts: Array<{
    ad_account_id: string;
    account_name: string;
    access_token: string;
    page_id: string | null;
    currency: string;
    active: boolean;
    last_synced_at: string | null;
  }>;
  error?: string;
}> {
  try {
    const { data, error } = await supabase
      .from('meta_ad_accounts')
      .select('ad_account_id,account_name,access_token,page_id,currency,active,last_synced_at');

    if (error) {
      const msg = String(error.message || '');
      if (/does not exist|relation|42P01|schema cache/i.test(msg)) {
        return { tableReady: false, accounts: [], error: 'Tabla meta_ad_accounts aún no creada en Supabase' };
      }
      return { tableReady: false, accounts: [], error: msg };
    }

    return {
      tableReady: true,
      accounts: Array.isArray(data) ? data : [],
    };
  } catch (err: any) {
    return { tableReady: false, accounts: [], error: err?.message || 'Error leyendo meta_ad_accounts' };
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = String(req.query?.action || req.body?.action || 'live_report').trim().toLowerCase();

  try {
    const supabase = getSupabaseAdmin();
    const { tableReady, accounts, error: tableErr } = await safeFetchAdAccounts(supabase);
    const activeAccounts = accounts.filter((a) => a.active !== false && Boolean(a.access_token));
    const safeAccounts = accounts.map(({ access_token, ...safe }) => ({
      ...safe,
      has_token: Boolean(access_token),
    }));

    /* 1. STATUS DE CONEXIÓN (NUNCA EXPONE TOKENS) */
    if (action === 'status') {
      const cached = await readDocJson<any>(supabase, INSIGHTS_DOC_TITLE, {
        lastSyncedAt: null,
        rows: [],
      });
      return res.status(200).json({
        ok: true,
        tableReady,
        connected: tableReady && activeAccounts.length > 0,
        status: !tableReady ? 'missing_table' : activeAccounts.length === 0 ? 'pending_tokens' : 'connected',
        message: !tableReady
          ? tableErr
          : activeAccounts.length === 0
            ? 'Tabla meta_ad_accounts lista. Agrega tu ad_account_id y System User token cuando los tengas.'
            : `${activeAccounts.length} cuenta(s) publicitaria(s) conectada(s).`,
        accounts: safeAccounts,
        lastSyncedAt: cached.data?.lastSyncedAt || null,
      });
    }

    /* 2. SINCRONIZAR DESDE META MARKETING API -> GASTOS_PUBLICIDAD + CACHE */
    if (action === 'sync') {
      if (!tableReady || activeAccounts.length === 0) {
        return res.status(200).json({
          ok: true,
          connected: false,
          tableReady,
          status: !tableReady ? 'missing_table' : 'pending_tokens',
          syncedRows: 0,
          message: !tableReady
            ? 'Tabla meta_ad_accounts aún no creada en Supabase.'
            : 'Esperando tokens en tabla meta_ad_accounts para iniciar sincronización automática.',
        });
      }

      const days = Math.min(90, Math.max(1, Number(req.query?.days || req.body?.days || 2)));
      const since = String(req.query?.since || req.body?.since || getElSalvadorDate(-(days - 1)));
      const until = String(req.query?.until || req.body?.until || getElSalvadorDate(0));
      const timeRange = encodeURIComponent(JSON.stringify({ since, until }));

      const syncedInsights: any[] = [];
      const accountErrors: Array<{ ad_account_id: string; error: string }> = [];

      for (const acc of activeAccounts) {
        const actId = normalizeAdAccountId(acc.ad_account_id);
        const fields = [
          'campaign_id',
          'campaign_name',
          'adset_id',
          'adset_name',
          'ad_id',
          'ad_name',
          'spend',
          'impressions',
          'clicks',
          'ctr',
          'cpc',
          'frequency',
          'actions',
          'date_start',
          'date_stop',
        ].join(',');

        const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
          actId
        )}/insights?level=ad&time_increment=1&time_range=${timeRange}&limit=250&fields=${fields}&access_token=${encodeURIComponent(
          acc.access_token
        )}`;

        const gRes = await fetch(url);
        const gJson = await gRes.json().catch(() => ({}));
        if (!gRes.ok || gJson?.error) {
          accountErrors.push({
            ad_account_id: actId,
            error: gJson?.error?.message || `Meta Ads HTTP ${gRes.status}`,
          });
          continue;
        }

        const rows = Array.isArray(gJson?.data) ? gJson.data : [];
        for (const r of rows) {
          const spend = Number(r.spend || 0);
          const impressions = Number(r.impressions || 0);
          if (spend <= 0 && impressions <= 0) continue;

          const codigo = extractAdCode(r.ad_name, r.campaign_name);
          const conversations = extractMessagingCount(r.actions);
          syncedInsights.push({
            ad_account_id: actId,
            account_name: acc.account_name,
            page_id: acc.page_id || null,
            fecha: String(r.date_start || until),
            campaign_id: String(r.campaign_id || ''),
            campaign_name: String(r.campaign_name || ''),
            adset_name: String(r.adset_name || ''),
            ad_id: String(r.ad_id || ''),
            ad_name: String(r.ad_name || ''),
            codigo_anuncio: codigo,
            spend,
            impressions,
            clicks: Number(r.clicks || 0),
            ctr: Number(r.ctr || 0),
            cpc: Number(r.cpc || 0),
            frequency: Number(r.frequency || 0),
            conversations,
          });
        }

        await supabase
          .from('meta_ad_accounts')
          .update({ last_synced_at: new Date().toISOString() })
          .eq('ad_account_id', acc.ad_account_id);
      }

      // Agrupar gasto por (fecha, codigo_anuncio) para actualizar gastos_publicidad sin duplicados
      const dailySpendMap = new Map<
        string,
        { fecha: string; codigo_anuncio: string; monto: number; detalle: string }
      >();
      for (const row of syncedInsights) {
        const key = `${row.fecha}::${row.codigo_anuncio}`;
        const cur = dailySpendMap.get(key) || {
          fecha: row.fecha,
          codigo_anuncio: row.codigo_anuncio,
          monto: 0,
          detalle: row.ad_name || row.campaign_name,
        };
        cur.monto = Math.round((cur.monto + row.spend) * 100) / 100;
        dailySpendMap.set(key, cur);
      }

      // Leer filas previas sincronizadas en ese rango para upsert limpio y cálculo de delta real
      const { data: existingGastos } = await supabase
        .from('gastos_publicidad')
        .select('id,fecha,codigo_anuncio,plataforma,monto,notas')
        .eq('plataforma', 'Meta')
        .gte('fecha', since)
        .lte('fecha', until);

      const existingMap = new Map<string, any>();
      for (const g of existingGastos || []) {
        if (String(g.notas || '').includes('[META_SYNC]')) {
          existingMap.set(`${g.fecha}::${String(g.codigo_anuncio || '').toUpperCase()}`, g);
        }
      }

      let upsertedCount = 0;
      const eventDeltas: Array<{
        fecha: string;
        codigo_anuncio: string;
        delta: number;
        prevMonto: number;
        newMonto: number;
        detalle: string;
      }> = [];

      for (const [key, entry] of dailySpendMap.entries()) {
        if (entry.monto <= 0) continue;
        const noteTag = `[META_SYNC] ${entry.detalle}`.slice(0, 180);
        const prev = existingMap.get(key);
        const prevMonto = prev ? Math.round((Number(prev.monto) || 0) * 100) / 100 : 0;
        const delta = Math.round((entry.monto - prevMonto) * 100) / 100;

        if (prev?.id) {
          await supabase
            .from('gastos_publicidad')
            .update({ monto: entry.monto, notas: noteTag })
            .eq('id', prev.id);
        } else {
          await supabase.from('gastos_publicidad').insert({
            fecha: entry.fecha,
            codigo_anuncio: entry.codigo_anuncio,
            plataforma: 'Meta',
            monto: entry.monto,
            notas: noteTag,
          });
        }
        upsertedCount++;

        if (delta > 0.009) {
          eventDeltas.push({
            fecha: entry.fecha,
            codigo_anuncio: entry.codigo_anuncio,
            delta,
            prevMonto,
            newMonto: entry.monto,
            detalle: entry.detalle,
          });
        }
      }

      // Combinar cache histórica con nuevos registros reemplazando el rango [since, until]
      const prevDoc = await readDocJson<any>(supabase, INSIGHTS_DOC_TITLE, {
        lastSyncedAt: null,
        rows: [],
      });
      const prevRows = Array.isArray(prevDoc.data?.rows) ? prevDoc.data.rows : [];
      const keptOldRows = prevRows.filter((r: any) => r.fecha < since || r.fecha > until);
      const mergedRows = [...syncedInsights, ...keptOldRows]
        .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''))
        .slice(0, 1500);

      const nowIso = new Date().toISOString();
      await writeDocJson(
        supabase,
        INSIGHTS_DOC_TITLE,
        {
          lastSyncedAt: nowIso,
          lastRange: { since, until },
          rows: mergedRows,
        },
        prevDoc.id
      );

      for (const d of eventDeltas) {
        await emitServerOsEvent(
          supabase,
          'marketing.ad.expense',
          'gastos_publicidad',
          `${d.fecha}:${d.codigo_anuncio}`,
          {
            fecha: d.fecha,
            codigo_anuncio: d.codigo_anuncio,
            platform: 'meta',
            amount: d.delta,
            total_acumulado_dia: d.newMonto,
            detalle: d.detalle,
            origen: 'meta_ads_sync',
          },
          `meta_sync:${d.fecha}:${d.codigo_anuncio}:${Math.round(d.prevMonto * 100)}->${Math.round(d.newMonto * 100)}`
        );
      }

      const totalSyncedSpend = Array.from(dailySpendMap.values()).reduce((s, e) => s + e.monto, 0);
      await emitServerOsEvent(
        supabase,
        'marketing.meta.synced',
        'meta_ad_accounts',
        `${since}:${until}`,
        {
          since,
          until,
          insights_count: syncedInsights.length,
          synced_spend_rows: upsertedCount,
          total_spend: Math.round(totalSyncedSpend * 100) / 100,
          accounts_synced: activeAccounts.length,
          origen: 'meta_ads_sync',
        },
        `meta_sync:summary:${since}:${until}:${Date.now()}`
      );

      return res.status(200).json({
        ok: true,
        connected: true,
        since,
        until,
        insightsCount: syncedInsights.length,
        syncedSpendRows: upsertedCount,
        accountErrors,
        lastSyncedAt: nowIso,
      });
    }

    /* 3. REPORTE EN VIVO CRUZADO (META ADS + PEDIDOS ENTREGADOS + STOCK) */
    if (action === 'live_report') {
      const days = Math.min(90, Math.max(1, Number(req.query?.days || 7)));
      const since = getElSalvadorDate(-(days - 1));
      const until = getElSalvadorDate(0);

      const [cachedDoc, ordersRes, stockRes, variantsRes] = await Promise.all([
        readDocJson<any>(supabase, INSIGHTS_DOC_TITLE, { lastSyncedAt: null, rows: [] }),
        supabase
          .from('whatsapp_orders')
          .select('id,sku,catalogo_sku,items,total,estado,codigo_anuncio,created_at')
          .gte('created_at', `${since}T06:00:00.000Z`),
        supabase
          .from('inventory_stock')
          .select('sku,nombre,template_id,stock_disponible,activo'),
        supabase
          .from('productos_variantes')
          .select('variante_id,template_id,sku,nombre_completo,color'),
      ]);

      const rawRows = (Array.isArray(cachedDoc.data?.rows) ? cachedDoc.data.rows : []).filter(
        (r: any) => r.fecha >= since && r.fecha <= until
      );

      const normSku = (v: any) => String(v || '').trim().toUpperCase();
      const normText = (v: any) =>
        String(v || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .replace(/^\s*\d+\s*[x×]\s*/i, '')
          .replace(/\s*\([^)]*\)\s*/g, ' ')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const allStockRows = Array.isArray(stockRes?.data) ? stockRes.data : [];
      const allVariantRows = Array.isArray(variantsRes?.data) ? variantsRes.data : [];
      const variantSkuSet = new Set(allVariantRows.map((v: any) => normSku(v.sku)).filter(Boolean));

      const duplicateChildSkus = new Set<string>();
      const rowsByTemplate = new Map<string, any[]>();
      for (const s of allStockRows) {
        const tId = s.template_id !== undefined && s.template_id !== null ? String(s.template_id).trim() : '';
        if (!tId) continue;
        const arr = rowsByTemplate.get(tId) || [];
        arr.push(s);
        rowsByTemplate.set(tId, arr);
      }
      rowsByTemplate.forEach((rows) => {
        if (rows.length <= 1) return;
        const sorted = [...rows].sort((a, b) => {
          const aIsVar = variantSkuSet.has(normSku(a.sku)) ? 1 : 0;
          const bIsVar = variantSkuSet.has(normSku(b.sku)) ? 1 : 0;
          if (aIsVar !== bIsVar) return aIsVar - bIsVar;
          return normSku(a.sku).length - normSku(b.sku).length;
        });
        const parentSku = normSku(sorted[0]?.sku);
        for (let i = 1; i < sorted.length; i++) {
          const childSku = normSku(sorted[i]?.sku);
          if (childSku && (variantSkuSet.has(childSku) || childSku.startsWith(`${parentSku}-`))) {
            duplicateChildSkus.add(childSku);
          }
        }
      });

      const stockBySku = new Map<string, any>();
      const templateToParentSku = new Map<string, string>();
      const nameToParentSku = new Map<string, string>();
      const variantToParentSku = new Map<string, string>();

      for (const s of allStockRows) {
        const sKey = normSku(s.sku);
        if (!sKey || duplicateChildSkus.has(sKey) || sKey.toLowerCase().includes('fee')) continue;
        stockBySku.set(sKey, s);
        const tId = s.template_id !== undefined && s.template_id !== null ? String(s.template_id).trim() : '';
        if (tId && !templateToParentSku.has(tId)) templateToParentSku.set(tId, sKey);
        const nKey = normText(s.nombre || s.sku);
        if (nKey && !nameToParentSku.has(nKey)) nameToParentSku.set(nKey, sKey);
      }

      const masterSkus = Array.from(stockBySku.keys());
      for (const v of allVariantRows) {
        const vSku = normSku(v.sku);
        const tId = v.template_id !== undefined && v.template_id !== null ? String(v.template_id).trim() : '';
        let parentSku = tId ? templateToParentSku.get(tId) : undefined;
        if (!parentSku && vSku) {
          parentSku = masterSkus
            .filter((m) => vSku === m || vSku.startsWith(`${m}-`))
            .sort((a, b) => b.length - a.length)[0];
        }
        if (parentSku) {
          if (vSku) variantToParentSku.set(vSku, parentSku);
          const vName = normText(v.nombre_completo);
          if (vName && !nameToParentSku.has(vName)) nameToParentSku.set(vName, parentSku);
        }
      }

      const resolveMasterSkuForOrder = (o: any): string | null => {
        const candidates: string[] = [];
        if (o.catalogo_sku) candidates.push(normSku(o.catalogo_sku));
        if (Array.isArray(o.items)) {
          for (const it of o.items) {
            if (it?.catalogo_sku) candidates.push(normSku(it.catalogo_sku));
            if (it?.variante_sku) candidates.push(normSku(it.variante_sku));
            if (it?.sku) candidates.push(normSku(it.sku));
          }
        }
        if (o.sku) candidates.push(normSku(o.sku));

        for (const c of candidates) {
          if (!c) continue;
          if (stockBySku.has(c)) return c;
          if (variantToParentSku.has(c)) return variantToParentSku.get(c)!;
          if (templateToParentSku.has(c)) return templateToParentSku.get(c)!;
          const prefix = masterSkus
            .filter((m) => c.startsWith(`${m}-`))
            .sort((a, b) => b.length - a.length)[0];
          if (prefix) return prefix;
        }
        const nKey = normText(o.sku);
        if (nKey && nameToParentSku.has(nKey)) return nameToParentSku.get(nKey)!;
        return candidates[0] || null;
      };

      const ordersByCode = new Map<
        string,
        { totalOrders: number; deliveredOrders: number; totalSales: number; deliveredSales: number; skus: Set<string> }
      >();

      for (const o of ordersRes?.data || []) {
        const code = String(o.codigo_anuncio || '').trim().toUpperCase();
        if (!code) continue;
        const cur = ordersByCode.get(code) || {
          totalOrders: 0,
          deliveredOrders: 0,
          totalSales: 0,
          deliveredSales: 0,
          skus: new Set<string>(),
        };
        const total = Number(o.total || 0);
        const estado = String(o.estado || '').toLowerCase();
        if (estado !== 'cancelado' && estado !== 'anulado') {
          cur.totalOrders += 1;
          cur.totalSales += total;
        }
        if (estado === 'entregado') {
          cur.deliveredOrders += 1;
          cur.deliveredSales += total;
        }
        const resolvedSku = resolveMasterSkuForOrder(o);
        if (resolvedSku) cur.skus.add(resolvedSku);
        ordersByCode.set(code, cur);
      }

      // Agrupar insights por ad_id (o codigo_anuncio) en el rango seleccionado
      const adMap = new Map<string, any>();
      for (const r of rawRows) {
        const key = r.ad_id || `${r.ad_account_id}::${r.codigo_anuncio}`;
        const cur = adMap.get(key) || {
          ad_id: r.ad_id,
          ad_name: r.ad_name || r.campaign_name,
          campaign_name: r.campaign_name,
          account_name: r.account_name,
          page_id: r.page_id,
          codigo_anuncio: r.codigo_anuncio,
          spend: 0,
          impressions: 0,
          clicks: 0,
          conversations: 0,
          freqSum: 0,
          freqDays: 0,
        };
        cur.spend += Number(r.spend || 0);
        cur.impressions += Number(r.impressions || 0);
        cur.clicks += Number(r.clicks || 0);
        cur.conversations += Number(r.conversations || 0);
        if (Number(r.frequency) > 0) {
          cur.freqSum += Number(r.frequency);
          cur.freqDays += 1;
        }
        adMap.set(key, cur);
      }

      const ads = Array.from(adMap.values())
        .map((a) => {
          const ord = ordersByCode.get(a.codigo_anuncio) || {
            totalOrders: 0,
            deliveredOrders: 0,
            totalSales: 0,
            deliveredSales: 0,
            skus: new Set<string>(),
          };
          const avgFreq = a.freqDays > 0 ? a.freqSum / a.freqDays : 0;
          const ctr = a.impressions > 0 ? (a.clicks / a.impressions) * 100 : 0;
          const costPerMsg = a.conversations > 0 ? a.spend / a.conversations : null;
          const cpaReal = ord.totalOrders > 0 ? a.spend / ord.totalOrders : null;
          const roasCobrado = a.spend > 0 ? ord.deliveredSales / a.spend : null;
          const roasBruto = a.spend > 0 ? ord.totalSales / a.spend : null;

          // Verificar si el código del anuncio o sus SKUs asociados tienen stock 0
          const directCanonical =
            variantToParentSku.get(a.codigo_anuncio) || a.codigo_anuncio;
          const directStock = stockBySku.get(directCanonical);
          let linkedSku: string | null = directStock ? directStock.sku : null;
          let stockDisponible: number | null = directStock ? Number(directStock.stock_disponible) : null;
          if (stockDisponible === null) {
            for (const sKey of ord.skus) {
              const st = stockBySku.get(variantToParentSku.get(sKey) || sKey);
              if (st) {
                linkedSku = st.sku;
                stockDisponible = Number(st.stock_disponible);
                break;
              }
            }
          }

          const stockAlert = stockDisponible !== null && stockDisponible <= 0;
          const fatigueAlert = avgFreq >= 2.8 || (a.impressions >= 1500 && ctr < 0.75);

          return {
            ...a,
            spend: Math.round(a.spend * 100) / 100,
            ctr: Math.round(ctr * 100) / 100,
            frequency: Math.round(avgFreq * 100) / 100,
            costPerMsg: costPerMsg !== null ? Math.round(costPerMsg * 100) / 100 : null,
            totalOrders: ord.totalOrders,
            deliveredOrders: ord.deliveredOrders,
            totalSales: Math.round(ord.totalSales * 100) / 100,
            deliveredSales: Math.round(ord.deliveredSales * 100) / 100,
            cpaReal: cpaReal !== null ? Math.round(cpaReal * 100) / 100 : null,
            roasBruto: roasBruto !== null ? Math.round(roasBruto * 100) / 100 : null,
            roasCobrado: roasCobrado !== null ? Math.round(roasCobrado * 100) / 100 : null,
            linkedSku,
            stockDisponible,
            stockAlert,
            fatigueAlert,
          };
        })
        .sort((a, b) => b.spend - a.spend);

      const totals = ads.reduce(
        (acc, cur) => {
          acc.spend += cur.spend;
          acc.conversations += cur.conversations;
          acc.totalOrders += cur.totalOrders;
          acc.deliveredOrders += cur.deliveredOrders;
          acc.totalSales += cur.totalSales;
          acc.deliveredSales += cur.deliveredSales;
          if (cur.stockAlert) acc.stockAlerts += 1;
          if (cur.fatigueAlert) acc.fatigueAlerts += 1;
          return acc;
        },
        {
          spend: 0,
          conversations: 0,
          totalOrders: 0,
          deliveredOrders: 0,
          totalSales: 0,
          deliveredSales: 0,
          stockAlerts: 0,
          fatigueAlerts: 0,
        }
      );

      return res.status(200).json({
        ok: true,
        tableReady,
        connected: tableReady && activeAccounts.length > 0,
        status: !tableReady ? 'missing_table' : activeAccounts.length === 0 ? 'pending_tokens' : 'connected',
        accounts: safeAccounts,
        lastSyncedAt: cachedDoc.data?.lastSyncedAt || null,
        range: { since, until, days },
        totals: {
          ...totals,
          spend: Math.round(totals.spend * 100) / 100,
          totalSales: Math.round(totals.totalSales * 100) / 100,
          deliveredSales: Math.round(totals.deliveredSales * 100) / 100,
          costPerMsg:
            totals.conversations > 0 ? Math.round((totals.spend / totals.conversations) * 100) / 100 : null,
          roasCobrado:
            totals.spend > 0 ? Math.round((totals.deliveredSales / totals.spend) * 100) / 100 : null,
        },
        ads,
      });
    }

    return res.status(400).json({ error: `Acción no soportada: ${action}` });
  } catch (err: any) {
    console.error('Error en /api/meta-ads-sync:', err);
    return res.status(500).json({ error: err?.message || 'Error interno en Meta Ads Sync' });
  }
}
