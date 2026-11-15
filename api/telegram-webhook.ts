import { createClient } from '@supabase/supabase-js';

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

interface PurchaseDraft {
  id: string;
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

function escapeHtml(raw?: string | null): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtMoney(n: number): string {
  return `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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

async function interpretWithOpenAI(params: {
  text: string;
  imageDataUrl?: string | null;
  catalog: any[];
  accounts: any[];
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Falta OPENAI_API_KEY en las variables de entorno de Vercel.');
  }

  const catalogLines = params.catalog
    .slice(0, 120)
    .map(
      (i: any) =>
        `- SKU: ${i.sku} | Nombre: ${i.nombre} | Costo actual: $${Number(i.costo_unitario || 0).toFixed(2)} | Disp: ${Number(i.stock_disponible || 0)}`
    )
    .join('\n');

  const accountLines = params.accounts
    .map(
      (a: any) =>
        `- id: ${a.id} | Nombre: ${a.nombre} (${a.tipo}) | Saldo: $${Number(a.saldo_actual || 0).toFixed(2)}`
    )
    .join('\n');

  const systemPrompt = `Eres el asistente operativo de inventario y compras de TODOENUNO OS en El Salvador.
Analizas mensajes de texto o fotos de facturas/recibos de compras a proveedores que el dueño envía por Telegram.

CATÁLOGO ACTIVO DE INVENTARIO (usa EXACTAMENTE el SKU del catálogo cuando corresponda):
${catalogLines || '(Sin productos registrados)'}

CUENTAS DE DINERO / CAJAS EN FINANZAS:
${accountLines}

REGLAS ESTRICTAS:
1. Clasifica "intent":
   - "compra": cuando el usuario reporta una compra, factura, recibo o ingreso de mercadería/unidades.
   - "consulta_stock": si solo pregunta cuánto stock hay de uno o más productos.
   - "consulta_brief": si pide el resumen/brief/ventas del día.
   - "otro": saludo o mensaje no relacionado.
2. Si "intent" = "compra":
   - Extrae cada línea de producto en "items":
     - "sku": código SKU exacto del catálogo que mejor coincide (o "" si definitivamente no existe en el catálogo).
     - "raw_name": nombre tal como viene en el mensaje o factura.
     - "cantidad": entero positivo.
     - "costo_unitario": número >= 0 (si viene el total de la línea en la factura en vez del unitario, divídelo entre la cantidad para obtener el costo_unitario; si no menciona precio, usa el costo actual del catálogo o 0).
   - "proveedor": nombre del proveedor o tienda (ej. "MotoParts", "Importadora X", o "Proveedor" si no se menciona).
   - "account_id": id exacto de la cuenta que mejor coincide si mencionó pago ("efectivo"/"caja" -> caja_chica, "banco"/"transferencia" -> banco_principal), si no mencionó usa "${params.accounts[0]?.id || 'banco_principal'}".
   - "asentar_en_finanzas": true si mencionó que pagó / efectivo / transferencia / caja / banco o envió factura pagada; false si solo dijo ingresar stock.
   - "notas": breve nota útil (ej. número de factura o detalle extra).
3. Devuelve EXCLUSIVAMENTE JSON válido con este formato:
{
  "intent": "compra" | "consulta_stock" | "consulta_brief" | "otro",
  "search_query": "",
  "proveedor": "",
  "account_id": "",
  "asentar_en_finanzas": true,
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
      text: 'Extrae los productos, cantidades, costos y proveedor de esta imagen de compra/factura.',
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
      max_tokens: 900,
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

async function executePurchaseMovement(
  supabase: any,
  params: {
    sku: string;
    cantidad: number;
    costo_unitario: number;
    motivo: string;
    source_id: string;
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

  // 1. Intentar RPC atómico public.record_movement
  const rpcRes = await supabase.rpc('record_movement', {
    p_sku: skuClean,
    p_tipo_movimiento: 'compra_entrada',
    p_cantidad: absQty,
    p_costo_unitario: costo,
    p_motivo: params.motivo,
    p_source_table: 'telegram_bot',
    p_source_id: params.source_id,
    p_usuario: 'Telegram Bot',
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
  const nuevoFisico = stockActual + absQty;
  const nuevoDisponible = Math.max(nuevoFisico - reservadoActual, 0);

  const updatePayload: Record<string, any> = {
    stock_fisico: nuevoFisico,
    updated_at: new Date().toISOString(),
  };
  if (costo > 0) updatePayload.costo_unitario = costo;

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
      stock_reservado: 0,
      costo_unitario: costo,
      updated_at: new Date().toISOString(),
    });
    if (insErr) return { ok: false, error: insErr.message };
  }

  await supabase.from('inventory_kardex').insert({
    sku: skuClean,
    tipo_movimiento: 'compra_entrada',
    cantidad: absQty,
    costo_unitario: costo,
    saldo_fisico: nuevoFisico,
    motivo: params.motivo,
    source_table: 'telegram_bot',
    source_id: params.source_id,
    usuario: 'Telegram Bot',
  });

  return { ok: true, nuevoFisico, nuevoDisponible };
}

async function recordFinancePurchaseExpense(
  supabase: any,
  params: {
    account_id: string;
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
        categoria: 'pago_proveedor',
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

async function sendDraftConfirmationCard(chatId: string | number, draft: PurchaseDraft) {
  const lines: string[] = [];
  lines.push(`📦 <b>BORRADOR DE COMPRA POR CONFIRMAR</b>`);
  lines.push(`🏭 Proveedor: <b>${escapeHtml(draft.proveedor || 'Proveedor')}</b>`);
  if (draft.notas) lines.push(`📝 Nota: <i>${escapeHtml(draft.notas)}</i>`);
  lines.push('');

  for (const it of draft.items) {
    lines.push(
      `• <code>${escapeHtml(it.sku)}</code> (${escapeHtml(it.nombre)})\n  <b>+${it.cantidad} u.</b> × ${fmtMoney(it.costo_unitario)} = <b>${fmtMoney(it.subtotal)}</b>`
    );
  }

  if (draft.unmatchedNotes && draft.unmatchedNotes.length > 0) {
    lines.push('');
    lines.push(`⚠️ <i>No encontré SKU exacto para:</i>`);
    for (const u of draft.unmatchedNotes) {
      lines.push(`  • ${escapeHtml(u)}`);
    }
  }

  lines.push('');
  lines.push(`💵 <b>Total compra: ${fmtMoney(draft.total)}</b>`);
  lines.push(`🏦 Caja sugerida: <b>${escapeHtml(draft.account_nombre)}</b>`);
  lines.push('');
  lines.push('Elige cómo registrar esta entrada en TODOENUNO OS:');

  const keyboard = [
    [
      { text: '✅ Solo Inventario', callback_data: `tg_ok:${draft.id}:0` },
      { text: '💰 Inventario + Descontar Caja', callback_data: `tg_ok:${draft.id}:1` },
    ],
    [{ text: '❌ Cancelar', callback_data: `tg_no:${draft.id}` }],
  ];

  await sendTgMessage(chatId, lines.join('\n'), {
    reply_markup: { inline_keyboard: keyboard },
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

export default async function handler(req: any, res: any) {
  const action = String(req.query?.action || '').trim().toLowerCase();

  try {
    const baseUrl = getBaseUrl(req);
    const webhookUrl = `${baseUrl}/api/telegram-webhook`;
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
            isMatchingCurrentHost: info?.url === webhookUrl,
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
          { command: 'compra', description: 'Registrar compra: /compra SKU CANTIDAD COSTO' },
          { command: 'stock', description: 'Ver inventario actual: /stock [producto]' },
          { command: 'cajas', description: 'Ver saldos de cajas y bancos' },
          { command: 'brief', description: 'Pedir el brief operativo (AM/PM)' },
          { command: 'ayuda', description: 'Ver ejemplos de uso con texto o foto' },
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

      const draftsDoc = await readDocJson<PurchaseDraft[]>(supabase, DRAFTS_DOC_TITLE, []);
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
              ? 'Esta compra ya fue confirmada.'
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
            text: `❌ <b>Compra cancelada</b>\nNo se hicieron cambios en Inventario ni Finanzas.`,
            parse_mode: 'HTML',
          });
        }
        return res.status(200).json({ ok: true });
      }

      // Confirmación real: bloquear inmediatamente contra doble clic
      drafts[idx] = { ...draft, status: 'confirmed' };
      await writeDocJson(supabase, DRAFTS_DOC_TITLE, drafts.slice(0, 25), draftsDoc.id);
      await tgCall('answerCallbackQuery', {
        callback_query_id: cqId,
        text: 'Registrando compra...',
      });

      const withFinance = finFlag === '1';
      const resultLines: string[] = [];
      let hadError = false;

      for (const item of draft.items) {
        const motivo = `Compra Telegram · ${draft.proveedor || 'Proveedor'}${
          draft.notas ? ` · ${draft.notas}` : ''
        }`.trim();

        const movRes = await executePurchaseMovement(supabase, {
          sku: item.sku,
          cantidad: item.cantidad,
          costo_unitario: item.costo_unitario,
          motivo,
          source_id: draft.id,
        });

        if (movRes.ok) {
          resultLines.push(
            `• <code>${escapeHtml(item.sku)}</code> +${item.cantidad} u. (${fmtMoney(
              item.costo_unitario
            )}) → Físico: <b>${movRes.nuevoFisico ?? 'OK'}</b> · Disp: <b>${
              movRes.nuevoDisponible ?? 'OK'
            }</b>`
          );

          await emitBestEffortOsEvent(supabase, 'supplier.bid.received', 'inventory_stock', item.sku, {
            sku: item.sku,
            cantidad: item.cantidad,
            costo_unitario: item.costo_unitario,
            total_compra: item.subtotal,
            proveedor: draft.proveedor || null,
            tipo: 'compra_entrada',
            origen: 'telegram_bot',
            saldo_nuevo: movRes.nuevoFisico,
          });
        } else {
          hadError = true;
          resultLines.push(`• ❌ <code>${escapeHtml(item.sku)}</code>: ${escapeHtml(movRes.error)}`);
        }
      }

      let financeSummary = 'Finanzas: No descontado (solo entrada de inventario).';
      if (withFinance && draft.total > 0) {
        const desc = `Compra Telegram (${draft.proveedor}): ${draft.items
          .map((i) => `${i.cantidad}x ${i.sku}`)
          .join(', ')}`;
        const finRes = await recordFinancePurchaseExpense(supabase, {
          account_id: draft.account_id,
          monto: draft.total,
          descripcion: desc,
          fecha: getElSalvadorDate(),
        });

        if (finRes.ok) {
          financeSummary = `💰 Egreso asentado en <b>${escapeHtml(draft.account_nombre)}</b>: -${fmtMoney(
            draft.total
          )}${
            finRes.nuevoSaldo !== undefined
              ? ` (Saldo actual: <b>${fmtMoney(finRes.nuevoSaldo)}</b>)`
              : ''
          }`;

          await emitBestEffortOsEvent(
            supabase,
            'finance.expense.created',
            'finance_money_transactions',
            draft.id,
            {
              account_id: draft.account_id,
              categoria: 'pago_proveedor',
              monto: draft.total,
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

      const finalMsg = [
        hadError ? `⚠️ <b>COMPRA PARCIAL REGISTRADA</b>` : `✅ <b>COMPRA REGISTRADA EN TODOENUNO OS</b>`,
        `🏭 Proveedor: <b>${escapeHtml(draft.proveedor)}</b> · Total: <b>${fmtMoney(draft.total)}</b>`,
        '',
        ...resultLines,
        '',
        financeSummary,
      ].join('\n');

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

    /* 5. MANEJO DE MENSAJES DE TEXTO Y FOTOS */
    const msg = update.message;
    if (!msg) {
      return res.status(200).json({ ok: true });
    }

    const chatId = String(msg.chat?.id || msg.from?.id || '');
    if (!allowedChatIds.includes(chatId)) {
      await sendTgMessage(
        chatId,
        `⛔ Chat ID <code>${escapeHtml(chatId)}</code> no autorizado para registrar movimientos. Agrégalo a <code>TELEGRAM_ALLOWED_CHAT_IDS</code> en Vercel si deseas darle acceso.`
      );
      return res.status(200).json({ ok: true });
    }

    const rawText = String(msg.text || msg.caption || '').trim();
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;

    if (!rawText && !hasPhoto) {
      await sendTgMessage(
        chatId,
        'Envíame un texto (ej. <i>"Compré 10 cascos negros a $12"</i>), una foto de factura o usa /ayuda.'
      );
      return res.status(200).json({ ok: true });
    }

    const lowerText = rawText.toLowerCase();

    // Comandos directos
    if (lowerText === '/start' || lowerText === '/ayuda' || lowerText === '/help') {
      await sendTgMessage(
        chatId,
        [
          `🤖 <b>TODOENUNO OS · Bot de Compras e Inventario (GPT)</b>`,
          '',
          `<b>1. Registrar compra en lenguaje natural:</b>`,
          `• <i>"Compré 10 cascos negros a $12.50 en MotoParts pagado de banco"</i>`,
          `• <i>"Entraron 20 mini masajeadores a $4 c/u"</i>`,
          '',
          `<b>2. Foto de factura o recibo:</b>`,
          `• Envía la foto de la factura (con o sin comentario) y GPT extraerá productos, cantidades y costos.`,
          '',
          `<b>3. Comandos rápidos:</b>`,
          `• <code>/compra SKU CANTIDAD COSTO [PROVEEDOR]</code>`,
          `• <code>/stock [nombre o sku]</code> — Ver disponible en bodega`,
          `• <code>/cajas</code> — Ver saldos de cajas/bancos`,
          `• <code>/brief [am|pm]</code> — Pedir el resumen al instante`,
        ].join('\n')
      );
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/stock')) {
      const term = rawText.replace(/^\/stock(@\S+)?/i, '').trim();
      await handleStockQuery(supabase, chatId, term);
      return res.status(200).json({ ok: true });
    }

    if (lowerText.startsWith('/cajas')) {
      const accounts = await fetchCashAccounts(supabase);
      const lines = [
        `🏦 <b>CUENTAS Y CAJAS EN FINANZAS</b>`,
        '',
        ...accounts.map(
          (a: any) => `• <b>${escapeHtml(a.nombre)}</b> (<code>${escapeHtml(a.id)}</code>): <b>${fmtMoney(a.saldo_actual)}</b>`
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
    if (lowerText.startsWith('/compra')) {
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
        const draft: PurchaseDraft = {
          id: `p_${Date.now().toString(36)}`,
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

        const draftsDoc = await readDocJson<PurchaseDraft[]>(supabase, DRAFTS_DOC_TITLE, []);
        const nextDrafts = [draft, ...(Array.isArray(draftsDoc.data) ? draftsDoc.data : [])].slice(0, 25);
        await writeDocJson(supabase, DRAFTS_DOC_TITLE, nextDrafts, draftsDoc.id);
        await sendDraftConfirmationCard(chatId, draft);
        return res.status(200).json({ ok: true });
      }
      // Si escribió /compra en formato libre (ej. "/compra 10 cascos a $12"), lo dejamos pasar a GPT
    }

    // Flujo inteligente con OpenAI GPT-4o-mini (texto natural o foto de factura)
    let imageDataUrl: string | null = null;
    if (hasPhoto) {
      const largestPhoto = msg.photo[msg.photo.length - 1];
      imageDataUrl = await downloadTelegramPhotoAsDataUrl(largestPhoto.file_id);
    }

    const parsed = await interpretWithOpenAI({
      text: rawText.replace(/^\/compra(@\S+)?/i, '').trim(),
      imageDataUrl,
      catalog,
      accounts,
    });

    if (parsed.intent === 'consulta_stock') {
      await handleStockQuery(supabase, chatId, String(parsed.search_query || rawText));
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent === 'consulta_brief') {
      await handleBriefCommand(req, chatId, '');
      return res.status(200).json({ ok: true });
    }

    if (parsed.intent !== 'compra' || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      await sendTgMessage(
        chatId,
        parsed.reply_hint
          ? escapeHtml(parsed.reply_hint)
          : `No detecté una compra clara en tu mensaje.\n\nPrueba así:\n<i>"Compré 10 cascos negros a $12.50 en MotoParts"</i>\no envía una foto de la factura.`
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

    const chosenAccount =
      accounts.find((a: any) => a.id === parsed.account_id) ||
      accounts[0] || { id: 'banco_principal', nombre: 'Banco Principal' };

    const totalCompra =
      Math.round(draftItems.reduce((s, it) => s + it.subtotal, 0) * 100) / 100;

    const draft: PurchaseDraft = {
      id: `p_${Date.now().toString(36)}`,
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

    const draftsDoc = await readDocJson<PurchaseDraft[]>(supabase, DRAFTS_DOC_TITLE, []);
    const nextDrafts = [draft, ...(Array.isArray(draftsDoc.data) ? draftsDoc.data : [])].slice(0, 25);
    await writeDocJson(supabase, DRAFTS_DOC_TITLE, nextDrafts, draftsDoc.id);

    await sendDraftConfirmationCard(chatId, draft);
    return res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('Error en /api/telegram-webhook:', err);
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
