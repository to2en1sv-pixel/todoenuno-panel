import { createClient } from '@supabase/supabase-js';

function cleanDigits8(raw?: string | null): string {
  const base = String(raw || '').split('@')[0].replace(/\D/g, '');
  if (base.length === 11 && base.startsWith('503')) return base.slice(3);
  if (base.length === 8) return base;
  return base.length > 8 && base.length <= 12 ? base.slice(-8) : '';
}

function resolveCanonicalPhoneKey(phone?: string | null, conversationId?: string | null): string {
  const p8 = cleanDigits8(phone);
  if (p8) return p8;
  const convP8 = cleanDigits8(conversationId);
  if (convP8) return convP8;
  return String(conversationId || phone || '').trim();
}

function buildToddN8nWorkflow(panelOrigin: string) {
  const base = panelOrigin.replace(/\/+$/, '');

  const normalizeCode = `const items = $input.all();
const valid = [];

for (const item of items) {
  const root = item.json.body || item.json || {};
  if (root.source === 'evolution-panel-bridge') {
    const text = String(root.text || '').trim();
    const conversationId = String(root.conversationId || '').trim();
    if (!text || !conversationId) continue;
    if (root.convStatus === 'human') continue;

    valid.push({
      json: {
        conversationId,
        replyTarget: String(root.replyTarget || root.rawPhone || conversationId),
        phone: String(root.phone || ''),
        rawPhone: String(root.rawPhone || ''),
        pushName: String(root.pushName || ''),
        text,
        adTag: root.adTag || null,
        instance: String(root.instance || 'eee'),
        messageId: String(root.messageId || ''),
      },
    });
    continue;
  }

  let data = root.data;
  if (Array.isArray(data)) data = data[0];
  if (!data || !data.key) continue;
  if (data.key.fromMe === true) continue;

  const remoteJid = String(data.key.remoteJid || '').trim();
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') continue;

  const altJid = String(data.key.remoteJidAlt || data.key.participantAlt || data.key.senderPn || '').trim();
  const rawSrc = remoteJid.endsWith('@lid') && altJid ? altJid : remoteJid;
  const digits = rawSrc.split('@')[0].replace(/\\D/g, '');
  const phone = digits.length >= 8 ? digits.slice(-8) : remoteJid;

  const msg = data.message || {};
  const text = String(
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.buttonsResponseMessage?.selectedDisplayText ||
    msg.listResponseMessage?.title ||
    (msg.imageMessage ? '[Cliente envió imagen]' : '') ||
    (msg.audioMessage ? '[Cliente envió nota de voz]' : '') ||
    ''
  ).trim();

  if (!text) continue;

  valid.push({
    json: {
      conversationId: remoteJid,
      replyTarget: digits || remoteJid,
      phone,
      rawPhone: digits || remoteJid,
      pushName: String(data.pushName || ''),
      text,
      adTag: msg.extendedTextMessage?.contextInfo?.externalAdReply?.title || null,
      instance: String(root.instance || 'eee'),
      messageId: String(data.key.id || ''),
    },
  });
}

return valid;`;

  const promptCode = `const incoming = $('2. Normalizar Entrada').first().json;
const ctx = $('3. Cargar Contexto Todd (Panel)').first().json;

const catalogLines = (ctx.catalog || []).map((p, idx) => {
  const vars = Array.isArray(p.variantes) && p.variantes.length > 0
    ? p.variantes.map(v => \`\${v.color}\${v.talla && v.talla !== 'Única' ? ' Talla ' + v.talla : ''}: \${v.stock} uds ($\${Number(v.precio || p.precio).toFixed(2)})\`).join(' | ')
    : \`Stock general: \${p.stockDisponible} uds\`;
  return [
    \`\${idx + 1}. SKU: \${p.sku} | Nombre: \${p.nombre} | Precio: $\${Number(p.precio || 0).toFixed(2)} | TieneFoto: \${p.tieneFoto ? 'SI' : 'NO'}\`,
    \`   Disponibilidad: \${vars}\`,
    p.pitch ? \`   Pitch: \${p.pitch}\` : '',
    p.instrucciones ? \`   Reglas/Detalles: \${p.instrucciones}\` : '',
    p.keywords ? \`   Keywords: \${p.keywords}\` : '',
  ].filter(Boolean).join('\\n');
}).join('\\n\\n');

const historyText = (ctx.recentMessages || [])
  .map(m => \`\${m.from_me ? 'Todd/Asesor' : 'Cliente'}: \${m.body}\`)
  .join('\\n');

const st = ctx.state || {};
const af = ctx.antifraud || {};

const systemPrompt = \`Eres Todd, asistente comercial experto en ventas contra entrega (COD) en El Salvador para TODO EN UNO.
Tu objetivo es HÍBRIDO:
1) Responder dudas abiertas con amabilidad, brevedad y tono cercano salvadoreño (precios, envíos, colores, tallas, uso) usando ÚNICAMENTE la información real del CATÁLOGO ACTIVO.
2) Guiar la conversación paso a paso hacia el cierre del pedido recopilando:
   - Producto y variante (color/talla si aplica)
   - Nombre completo
   - Dirección exacta con punto de referencia y departamento
   - Método de pago ("Contra entrega" o "Transferencia")

REGLAS CRÍTICAS:
- NUNCA inventes productos, precios, colores ni stock fuera del catálogo.
- Envíos en El Salvador: San Salvador y área metropolitana mismo día o siguiente; departamentos 24-48h hábiles.
- Si el cliente pide ver fotos o pregunta por un producto por primera vez y TieneFoto = SI, pon "send_product_image": true y "product_sku" con el SKU exacto.
- Si el cliente te da su número real de 8 dígitos en el chat (útil cuando escribe desde @lid), guárdalo en "customer_phone".
- RIESGO ANTIFRAUDE DEL CLIENTE ACTUAL: Total pedidos=\${af.totalPedidos || 0}, Entregados=\${af.entregados || 0}, Cancelados=\${af.cancelados || 0}, ListaNegra=\${af.enListaNegra ? 'SI (' + (af.motivoListaNegra || 'Reportado') + ')' : 'NO'}.
  * Si ListaNegra=SI o Cancelados>=2: NO confirmes contra entrega directo; indica amablemente que para procesar su orden se requiere pago anticipado por transferencia o escala a humano ("escalate_to_human": true).
- Solo pon "create_order_now": true cuando YA tengas confirmados TODOS estos datos: producto/SKU, nombre_cliente, direccion completa y metodo_pago.

CATÁLOGO ACTIVO:
\${catalogLines || 'Sin productos activos.'}

ESTADO ACTUAL DEL CLIENTE (whatsapp_state):
- paso_actual: \${st.paso_actual || 'inicio'}
- last_sku: \${st.last_sku || 'ninguno'}
- last_nombre: \${st.last_nombre || 'ninguno'}
- last_precio: \${st.last_precio || 0}
- nombre_cliente: \${st.nombre_cliente || incoming.pushName || 'desconocido'}
- direccion: \${st.direccion || 'pendiente'}
- metodo_pago: \${st.metodo_pago || 'pendiente'}
- etiqueta_anuncio_meta: \${incoming.adTag || st.last_detalle || 'ninguna'}

Responde ESTRICTAMENTE con un objeto JSON válido con estas llaves exactas:
{
  "reply_text": "Mensaje corto para WhatsApp (máx 4-6 líneas, usa *negritas* simples de WhatsApp)",
  "paso_actual": "inicio | cotizando | esperando_nombre | esperando_direccion | esperando_pago | completado",
  "send_product_image": false,
  "product_sku": "SKU exacto o null",
  "product_name": "Nombre del producto o null",
  "unit_price": 0,
  "quantity": 1,
  "variant_color": "Color elegido o null",
  "variant_size": "Talla elegida o null",
  "customer_name": "Nombre completo o null",
  "customer_phone": "8 dígitos si lo dio en el texto o null",
  "customer_address": "Dirección completa o null",
  "department": "San Salvador | La Libertad | Santa Ana | San Miguel | Sonsonate | Usulután | Otro | null",
  "payment_method": "Contra entrega | Transferencia | null",
  "create_order_now": false,
  "escalate_to_human": false
}\`;

const userPrompt = \`HISTORIAL RECIENTE:\\n\${historyText || '(Sin mensajes previos)'}\\n\\nMENSAJE NUEVO DEL CLIENTE (\${incoming.pushName || incoming.phone}):\\n"\${incoming.text}"\`;

return [{
  json: {
    openAiBody: {
      model: 'gpt-4o-mini',
      temperature: 0.35,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    },
  },
}];`;

  const parseCode = `const incoming = $('2. Normalizar Entrada').first().json;
const ctx = $('3. Cargar Contexto Todd (Panel)').first().json;
const aiRaw = $input.first().json;

let parsed = {};
try {
  const content = aiRaw?.choices?.[0]?.message?.content || '{}';
  parsed = typeof content === 'string' ? JSON.parse(content) : content;
} catch {
  parsed = {
    reply_text: '¡Hola! 😊 Con gusto te ayudo. ¿Qué producto de nuestro catálogo te interesa hoy?',
    paso_actual: 'inicio',
  };
}

const st = ctx.state || {};
const sku = parsed.product_sku || st.last_sku || null;
const qty = Math.max(Number(parsed.quantity || 1) || 1, 1);
const unitPrice = Number(parsed.unit_price || st.last_precio || 0) || 0;
const replyText = String(parsed.reply_text || '').trim() || '¡Hola! ¿En qué producto te puedo ayudar?';

const sendPayload = {
  conversationId: incoming.conversationId,
  contactPhone: parsed.customer_phone || incoming.replyTarget,
  instanceId: incoming.instance || 'eee',
  text: replyText,
  pauseBot: parsed.escalate_to_human === true,
};
if (parsed.send_product_image === true && sku) {
  sendPayload.productSku = sku;
}

const statePayload = {
  action: 'update_state',
  conversationId: incoming.conversationId,
  phone: parsed.customer_phone || incoming.phone,
  paso_actual: parsed.paso_actual || st.paso_actual || 'cotizando',
  last_sku: sku,
  last_nombre: parsed.product_name || st.last_nombre || null,
  last_precio: unitPrice > 0 ? unitPrice : null,
  last_detalle: incoming.adTag ? \`AD:\${incoming.adTag}\` : st.last_detalle || null,
  nombre_cliente: parsed.customer_name || st.nombre_cliente || null,
  direccion: parsed.customer_address || st.direccion || null,
  metodo_pago: parsed.payment_method || st.metodo_pago || null,
};

const orderPayload = {
  action: 'create_order',
  conversationId: incoming.conversationId,
  phone: parsed.customer_phone || incoming.phone,
  nombre_cliente: parsed.customer_name || st.nombre_cliente || incoming.pushName || 'Cliente WhatsApp',
  direccion: parsed.customer_address || st.direccion || '',
  departamento: parsed.department || 'San Salvador',
  metodo_pago: parsed.payment_method || st.metodo_pago || 'Contra entrega',
  sku: parsed.product_name || st.last_nombre || sku || 'Producto WhatsApp',
  catalogo_sku: sku,
  cantidad: qty,
  total: unitPrice > 0 ? Number((unitPrice * qty).toFixed(2)) : 0,
  color: parsed.variant_color || null,
  talla: parsed.variant_size || null,
  codigo_anuncio: incoming.adTag || (String(st.last_detalle || '').startsWith('AD:') ? String(st.last_detalle).slice(3) : null),
  notas: \`Pedido automático Bot Todd (\${incoming.conversationId})\`,
};

return [{
  json: {
    sendPayload,
    statePayload,
    orderPayload,
    createOrderNow: Boolean(parsed.create_order_now),
  },
}];`;

  return {
    name: 'Todd v2 - Hibrido OpenAI + UniChat',
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path: 'todd-v2',
          responseMode: 'onReceived',
          options: {},
        },
        id: 'todd-v2-webhook',
        name: '1. Webhook Panel -> Todd',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 260],
        webhookId: 'todd-v2-panel-bridge',
      },
      {
        parameters: { jsCode: normalizeCode },
        id: 'todd-v2-normalize',
        name: '2. Normalizar Entrada',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [220, 260],
      },
      {
        parameters: {
          method: 'POST',
          url: `${base}/api/todd-bridge`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'Content-Type', value: 'application/json' },
            ],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify({ action: "context", conversationId: $json.conversationId, phone: $json.phone, rawPhone: $json.rawPhone, pushName: $json.pushName, adTag: $json.adTag }) }}',
          options: {},
        },
        id: 'todd-v2-context',
        name: '3. Cargar Contexto Todd (Panel)',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [450, 260],
      },
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [
              {
                id: 'cond-bot-active',
                leftValue: '={{ $json.shouldReply }}',
                rightValue: true,
                operator: { type: 'boolean', operation: 'true', singleValue: true },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
        id: 'todd-v2-if-bot',
        name: '4. ¿Bot Activo?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [670, 260],
      },
      {
        parameters: { jsCode: promptCode },
        id: 'todd-v2-prompt',
        name: '5. Construir Prompt OpenAI',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [900, 180],
      },
      {
        parameters: {
          method: 'POST',
          url: 'https://api.openai.com/v1/chat/completions',
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'Authorization', value: 'Bearer REEMPLAZAR_CON_TU_OPENAI_API_KEY' },
              { name: 'Content-Type', value: 'application/json' },
            ],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json.openAiBody) }}',
          options: {},
        },
        id: 'todd-v2-openai',
        name: '6. OpenAI GPT-4o-mini (Hibrido)',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [1130, 180],
      },
      {
        parameters: { jsCode: parseCode },
        id: 'todd-v2-parse',
        name: '7. Parsear Respuesta IA',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1360, 180],
      },
      {
        parameters: {
          method: 'POST',
          url: `${base}/api/send-message`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'Content-Type', value: 'application/json' },
            ],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ JSON.stringify($json.sendPayload) }}',
          options: {},
        },
        id: 'todd-v2-send',
        name: '8. Enviar Mensaje/Foto por Panel',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [1590, 180],
      },
      {
        parameters: {
          conditions: {
            options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
            conditions: [
              {
                id: 'cond-create-order',
                leftValue: "={{ $('7. Parsear Respuesta IA').first().json.createOrderNow }}",
                rightValue: true,
                operator: { type: 'boolean', operation: 'true', singleValue: true },
              },
            ],
            combinator: 'and',
          },
          options: {},
        },
        id: 'todd-v2-if-order',
        name: '9. ¿Crear Pedido?',
        type: 'n8n-nodes-base.if',
        typeVersion: 2,
        position: [1820, 180],
      },
      {
        parameters: {
          method: 'POST',
          url: `${base}/api/todd-bridge`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'Content-Type', value: 'application/json' },
            ],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: "={{ JSON.stringify($('7. Parsear Respuesta IA').first().json.orderPayload) }}",
          options: {},
        },
        id: 'todd-v2-create-order',
        name: '10A. Crear Pedido en Sistema',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [2060, 100],
      },
      {
        parameters: {
          method: 'POST',
          url: `${base}/api/todd-bridge`,
          sendHeaders: true,
          headerParameters: {
            parameters: [
              { name: 'Content-Type', value: 'application/json' },
            ],
          },
          sendBody: true,
          specifyBody: 'json',
          jsonBody: "={{ JSON.stringify($('7. Parsear Respuesta IA').first().json.statePayload) }}",
          options: {},
        },
        id: 'todd-v2-update-state',
        name: '10B. Actualizar Estado Todd',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.1,
        position: [2060, 300],
      },
    ],
    pinData: {},
    connections: {
      '1. Webhook Panel -> Todd': {
        main: [[{ node: '2. Normalizar Entrada', type: 'main', index: 0 }]],
      },
      '2. Normalizar Entrada': {
        main: [[{ node: '3. Cargar Contexto Todd (Panel)', type: 'main', index: 0 }]],
      },
      '3. Cargar Contexto Todd (Panel)': {
        main: [[{ node: '4. ¿Bot Activo?', type: 'main', index: 0 }]],
      },
      '4. ¿Bot Activo?': {
        main: [[{ node: '5. Construir Prompt OpenAI', type: 'main', index: 0 }], []],
      },
      '5. Construir Prompt OpenAI': {
        main: [[{ node: '6. OpenAI GPT-4o-mini (Hibrido)', type: 'main', index: 0 }]],
      },
      '6. OpenAI GPT-4o-mini (Hibrido)': {
        main: [[{ node: '7. Parsear Respuesta IA', type: 'main', index: 0 }]],
      },
      '7. Parsear Respuesta IA': {
        main: [[{ node: '8. Enviar Mensaje/Foto por Panel', type: 'main', index: 0 }]],
      },
      '8. Enviar Mensaje/Foto por Panel': {
        main: [[{ node: '9. ¿Crear Pedido?', type: 'main', index: 0 }]],
      },
      '9. ¿Crear Pedido?': {
        main: [
          [{ node: '10A. Crear Pedido en Sistema', type: 'main', index: 0 }],
          [{ node: '10B. Actualizar Estado Todd', type: 'main', index: 0 }],
        ],
      },
    },
    active: false,
    settings: { executionOrder: 'v1' },
    tags: [],
  };
}

export default async function handler(req: any, res: any) {
  const action = String(req.body?.action || req.query?.action || '').trim().toLowerCase();

  if (req.method === 'GET' && action === 'workflow') {
    const proto = String(req.headers['x-forwarded-proto'] || 'https');
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'todoenuno-panel.vercel.app');
    const panelOrigin = `${proto}://${host}`;
    const workflowJson = buildToddN8nWorkflow(panelOrigin);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="todd-v2-workflow.json"');
    return res.status(200).send(JSON.stringify(workflowJson, null, 2));
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      endpoint: 'todd-bridge',
      actions: ['context', 'update_state', 'create_order', 'workflow'],
      hasSecretConfigured: Boolean(process.env.TODD_INTERNAL_SECRET),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const toddSecret = process.env.TODD_INTERNAL_SECRET;
  if (toddSecret) {
    const incomingSecret = req.headers['x-todd-secret'] || req.query?.secret;
    if (incomingSecret !== toddSecret) {
      return res.status(401).json({ error: 'Unauthorized todd bridge request' });
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

  try {
    // 1. CONTEXTO COMPLETO PARA BOT TODD
    if (action === 'context') {
      const { conversationId, phone, rawPhone, adTag } = req.body || {};
      if (!conversationId && !phone) {
        return res.status(400).json({ error: 'conversationId o phone requerido' });
      }

      const p8 = cleanDigits8(phone || rawPhone || conversationId);
      const canonicalPhone = resolveCanonicalPhoneKey(phone || rawPhone, conversationId);
      const stateCandidates = Array.from(
        new Set([p8, p8 ? `503${p8}` : '', String(rawPhone || ''), String(conversationId || '')].filter(Boolean))
      );

      const [convRes, stateRes, msgsRes, stockRes, varsRes, ordersRes, blRes] = await Promise.all([
        conversationId
          ? supabase.from('bb_conversations').select('*').eq('id', conversationId).maybeSingle()
          : Promise.resolve({ data: null }),
        stateCandidates.length > 0
          ? supabase
              .from('whatsapp_state')
              .select('*')
              .in('telefono', stateCandidates)
              .order('updated_at', { ascending: false })
              .limit(1)
          : Promise.resolve({ data: [] }),
        conversationId
          ? supabase
              .from('bb_messages')
              .select('body, from_me, created_at')
              .eq('conversation_id', conversationId)
              .order('created_at', { ascending: false })
              .limit(12)
          : Promise.resolve({ data: [] }),
        supabase
          .from('inventory_stock')
          .select('sku, nombre, precio_venta, stock_disponible, activo, activo_todd, todd_pitch, todd_instrucciones, todd_keywords, categoria, template_id, image_url')
          .order('nombre'),
        supabase
          .from('productos_variantes')
          .select('variante_id, template_id, sku, color, talla, stock, precio, estado'),
        p8.length === 8
          ? supabase
              .from('whatsapp_orders')
              .select('id, estado, total, sku, created_at, motivo_cancelacion')
              .ilike('telefono', `%${p8}%`)
              .order('created_at', { ascending: false })
              .limit(15)
          : Promise.resolve({ data: [] }),
        p8.length === 8
          ? supabase
              .from('client_blacklist')
              .select('telefono, motivo, severidad')
              .ilike('telefono', `%${p8}%`)
              .limit(1)
          : Promise.resolve({ data: [] }),
      ]);

      const conversation = convRes.data || null;
      const convStatus = conversation?.status ? String(conversation.status) : 'bot';
      const state = Array.isArray(stateRes.data) && stateRes.data.length > 0 ? stateRes.data[0] : null;
      const recentMessages = Array.isArray(msgsRes.data) ? [...msgsRes.data].reverse() : [];

      const activeVariants = (varsRes.data || []).filter((v: any) => v.estado !== 'PAUSADO');
      const catalog = (stockRes.data || [])
        .filter((item: any) => item.activo !== false && item.activo_todd !== false)
        .map((item: any) => {
          const itemVars = item.template_id
            ? activeVariants
                .filter((v: any) => String(v.template_id) === String(item.template_id))
                .map((v: any) => ({
                  sku: v.sku,
                  color: v.color,
                  talla: v.talla,
                  stock: Number(v.stock || 0),
                  precio: Number(v.precio || item.precio_venta || 0),
                }))
            : [];

          return {
            sku: item.sku,
            nombre: item.nombre,
            precio: Number(item.precio_venta || 0),
            stockDisponible: Number(item.stock_disponible || 0),
            tieneFoto: Boolean(item.image_url),
            categoria: item.categoria || null,
            pitch: item.todd_pitch || null,
            instrucciones: item.todd_instrucciones || null,
            keywords: item.todd_keywords || null,
            variantes: itemVars,
          };
        });

      const orderRows = Array.isArray(ordersRes.data) ? ordersRes.data : [];
      const entregados = orderRows.filter((o: any) => String(o.estado || '').toLowerCase() === 'entregado').length;
      const cancelados = orderRows.filter((o: any) => String(o.estado || '').toLowerCase() === 'cancelado').length;
      const blEntry = Array.isArray(blRes.data) && blRes.data.length > 0 ? blRes.data[0] : null;

      return res.status(200).json({
        ok: true,
        shouldReply: convStatus !== 'human',
        canonicalPhone,
        conversation: conversation
          ? {
              id: conversation.id,
              status: convStatus,
              contact_name: conversation.contact_name,
              contact_phone: conversation.contact_phone,
            }
          : { id: conversationId, status: convStatus },
        state,
        recentMessages,
        catalog,
        adTag: adTag || null,
        antifraud: {
          totalPedidos: orderRows.length,
          entregados,
          cancelados,
          enListaNegra: Boolean(blEntry),
          motivoListaNegra: blEntry?.motivo || null,
        },
      });
    }

    // 2. ACTUALIZAR ESTADO EN WHATSAPP_STATE
    if (action === 'update_state') {
      const {
        conversationId,
        phone,
        paso_actual,
        last_sku,
        last_nombre,
        last_precio,
        last_detalle,
        nombre_cliente,
        direccion,
        metodo_pago,
      } = req.body || {};

      const keyPhone = resolveCanonicalPhoneKey(phone, conversationId);
      if (!keyPhone) {
        return res.status(400).json({ error: 'No se pudo resolver el identificador telefono para whatsapp_state' });
      }

      const patch: Record<string, any> = {
        telefono: keyPhone,
        updated_at: new Date().toISOString(),
      };
      if (paso_actual !== undefined && paso_actual !== null) patch.paso_actual = String(paso_actual);
      if (last_sku !== undefined && last_sku !== null) patch.last_sku = String(last_sku).toUpperCase();
      if (last_nombre !== undefined && last_nombre !== null) patch.last_nombre = String(last_nombre);
      if (last_precio !== undefined && last_precio !== null && Number(last_precio) > 0) {
        patch.last_precio = Number(last_precio);
      }
      if (last_detalle !== undefined && last_detalle !== null) patch.last_detalle = String(last_detalle);
      if (nombre_cliente !== undefined && nombre_cliente !== null) patch.nombre_cliente = String(nombre_cliente);
      if (direccion !== undefined && direccion !== null) patch.direccion = String(direccion);
      if (metodo_pago !== undefined && metodo_pago !== null) patch.metodo_pago = String(metodo_pago);

      const { error } = await supabase
        .from('whatsapp_state')
        .upsert(patch, { onConflict: 'telefono' });

      if (error) {
        return res.status(500).json({ error: 'Error actualizando whatsapp_state', details: error.message });
      }

      return res.status(200).json({ ok: true, telefono: keyPhone, paso_actual: patch.paso_actual });
    }

    // 3. CREAR PEDIDO DESDE BOT TODD
    if (action === 'create_order') {
      const {
        conversationId,
        phone,
        nombre_cliente,
        direccion,
        departamento = 'San Salvador',
        metodo_pago = 'Contra entrega',
        sku,
        catalogo_sku,
        cantidad = 1,
        total,
        color,
        talla,
        codigo_anuncio,
        notas,
      } = req.body || {};

      const keyPhone = resolveCanonicalPhoneKey(phone, conversationId);
      const p8 = cleanDigits8(phone || conversationId);
      const qty = Math.min(Math.max(Math.round(Number(cantidad) || 1), 1), 100);
      const cleanCatalogSku = catalogo_sku ? String(catalogo_sku).trim().toUpperCase() : null;

      let stockProduct: any = null;
      if (cleanCatalogSku) {
        const { data } = await supabase
          .from('inventory_stock')
          .select('sku, nombre, precio_venta, template_id')
          .eq('sku', cleanCatalogSku)
          .maybeSingle();
        stockProduct = data;
      }

      let matchedVariant: any = null;
      if (stockProduct?.template_id && (color || talla)) {
        const { data: vars } = await supabase
          .from('productos_variantes')
          .select('variante_id, sku, color, talla, precio')
          .eq('template_id', stockProduct.template_id);
        if (Array.isArray(vars) && vars.length > 0) {
          const cNorm = String(color || '').toLowerCase().trim();
          const tNorm = String(talla || '').toLowerCase().trim();
          matchedVariant =
            vars.find(
              (v: any) =>
                (!cNorm || String(v.color || '').toLowerCase().includes(cNorm)) &&
                (!tNorm || String(v.talla || '').toLowerCase().includes(tNorm))
            ) || vars[0];
        }
      }

      // Evitar duplicados en una ventana de 3 minutos
      if (keyPhone) {
        const threeMinAgo = new Date(Date.now() - 3 * 60 * 1000).toISOString();
        const { data: recentDup } = await supabase
          .from('whatsapp_orders')
          .select('id, pedido_codigo, total, estado')
          .eq('telefono', keyPhone)
          .gte('created_at', threeMinAgo)
          .limit(1);
        if (recentDup && recentDup.length > 0) {
          return res.status(200).json({ ok: true, deduplicated: true, order: recentDup[0] });
        }
      }

      const unitPrice =
        Number(matchedVariant?.precio || 0) ||
        Number(stockProduct?.precio_venta || 0) ||
        0;
      const computedTotal =
        Number(total) > 0 ? Number(total) : Number((unitPrice * qty).toFixed(2));

      const variantSuffix = matchedVariant
        ? ` (${[matchedVariant.color, matchedVariant.talla !== 'Única' ? `Talla ${matchedVariant.talla}` : ''].filter(Boolean).join(' · ')})`
        : color
        ? ` (${color}${talla ? ` · Talla ${talla}` : ''})`
        : '';

      const productDisplayName = `${stockProduct?.nombre || sku || cleanCatalogSku || 'Producto WhatsApp'}${variantSuffix}`;

      const itemsPayload = [
        {
          sku: cleanCatalogSku || productDisplayName,
          catalogo_sku: cleanCatalogSku,
          nombre: productDisplayName,
          cantidad: qty,
          precio: computedTotal,
          ...(matchedVariant
            ? {
                variante_id: matchedVariant.variante_id,
                variante_sku: matchedVariant.sku,
                color: matchedVariant.color,
                talla: matchedVariant.talla,
              }
            : {}),
        },
      ];

      const baseOrder = {
        nombre_cliente: String(nombre_cliente || 'Cliente WhatsApp').trim(),
        telefono: keyPhone,
        sku: productDisplayName,
        total: computedTotal,
        direccion: String(direccion || 'Pendiente de confirmar').trim(),
        metodo_pago: String(metodo_pago || 'Contra entrega').trim(),
        codigo_anuncio: codigo_anuncio ? String(codigo_anuncio).trim() : null,
        notas: notas ? String(notas).trim() : 'Pedido creado por Bot Todd',
        estado: 'nuevo',
      };

      const fullOrder = {
        ...baseOrder,
        catalogo_sku: cleanCatalogSku,
        items: itemsPayload,
        departamento: String(departamento || 'San Salvador').trim(),
      };

      let insertRes = await supabase.from('whatsapp_orders').insert(fullOrder).select().single();
      if (insertRes.error && insertRes.error.message?.includes('column')) {
        insertRes = await supabase.from('whatsapp_orders').insert(baseOrder).select().single();
      }

      if (insertRes.error) {
        return res.status(500).json({ error: 'Error creando pedido en whatsapp_orders', details: insertRes.error.message });
      }

      // Actualizar estado y vincular nombre/teléfono real si venía de @lid
      const nowIso = new Date().toISOString();
      try {
        await supabase.from('whatsapp_state').upsert(
          {
            telefono: keyPhone,
            paso_actual: 'completado',
            last_sku: cleanCatalogSku,
            last_nombre: stockProduct?.nombre || productDisplayName,
            last_precio: unitPrice > 0 ? unitPrice : computedTotal,
            nombre_cliente: baseOrder.nombre_cliente,
            direccion: baseOrder.direccion,
            metodo_pago: baseOrder.metodo_pago,
            updated_at: nowIso,
          },
          { onConflict: 'telefono' }
        );
      } catch {}

      if (conversationId) {
        try {
          const convPatch: Record<string, any> = { updated_at: nowIso };
          if (baseOrder.nombre_cliente && baseOrder.nombre_cliente !== 'Cliente WhatsApp') {
            convPatch.contact_name = baseOrder.nombre_cliente;
          }
          if (p8.length === 8) {
            convPatch.contact_phone = `503${p8}`;
          }
          await supabase.from('bb_conversations').update(convPatch).eq('id', conversationId);
        } catch {}
      }

      try {
        await (supabase as any)
          .schema('os')
          .from('events')
          .insert({
            type: 'order.created',
            source_table: 'whatsapp_orders',
            source_id: String(insertRes.data?.id || keyPhone),
            idempotency_key: `todd:order.created:${insertRes.data?.id || Date.now()}`,
            payload: {
              order_id: insertRes.data?.id,
              nombre_cliente: baseOrder.nombre_cliente,
              telefono: keyPhone,
              total: computedTotal,
              sku: cleanCatalogSku || productDisplayName,
              estado: 'nuevo',
              origen: 'bot_todd_n8n',
            },
          });
      } catch {}

      return res.status(200).json({ ok: true, order: insertRes.data });
    }

    return res.status(400).json({ error: `Acción no soportada: ${action}` });
  } catch (err: any) {
    console.error('Error en /api/todd-bridge:', err);
    return res.status(500).json({ error: 'Error interno en todd-bridge', details: err?.message });
  }
}
