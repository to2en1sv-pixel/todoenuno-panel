import { createClient } from '@supabase/supabase-js';

function unwrapMessageContent(rawMsg: any): any {
  let msg = rawMsg;
  for (let i = 0; i < 4; i++) {
    if (!msg || typeof msg !== 'object') break;
    if (msg.ephemeralMessage?.message) {
      msg = msg.ephemeralMessage.message;
      continue;
    }
    if (msg.viewOnceMessage?.message) {
      msg = msg.viewOnceMessage.message;
      continue;
    }
    if (msg.viewOnceMessageV2?.message) {
      msg = msg.viewOnceMessageV2.message;
      continue;
    }
    if (msg.documentWithCaptionMessage?.message) {
      msg = msg.documentWithCaptionMessage.message;
      continue;
    }
    if (msg.editedMessage?.message) {
      msg = msg.editedMessage.message;
      continue;
    }
    break;
  }
  return msg;
}

function extractTextFromEvolutionMessage(rawMsg: any): string {
  const msg = unwrapMessageContent(rawMsg);
  if (!msg || typeof msg !== 'object') return '';

  if (typeof msg.conversation === 'string' && msg.conversation.trim()) {
    return msg.conversation.trim();
  }
  if (msg.extendedTextMessage?.text) {
    return String(msg.extendedTextMessage.text).trim();
  }
  if (msg.buttonsResponseMessage?.selectedDisplayText) {
    return String(msg.buttonsResponseMessage.selectedDisplayText).trim();
  }
  if (msg.templateButtonReplyMessage?.selectedDisplayText) {
    return String(msg.templateButtonReplyMessage.selectedDisplayText).trim();
  }
  if (msg.listResponseMessage?.title) {
    return String(msg.listResponseMessage.title).trim();
  }
  if (msg.interactiveResponseMessage?.body?.text) {
    return String(msg.interactiveResponseMessage.body.text).trim();
  }
  if (msg.imageMessage) {
    const cap = msg.imageMessage.caption ? ` ${String(msg.imageMessage.caption).trim()}` : '';
    return `📷 [Imagen]${cap}`;
  }
  if (msg.videoMessage) {
    const cap = msg.videoMessage.caption ? ` ${String(msg.videoMessage.caption).trim()}` : '';
    return `🎥 [Video]${cap}`;
  }
  if (msg.audioMessage) {
    return '🎤 [Nota de voz]';
  }
  if (msg.stickerMessage) {
    return '🎭 [Sticker]';
  }
  if (msg.locationMessage) {
    return '📍 [Ubicación compartida]';
  }
  if (msg.documentMessage) {
    return `📄 ${msg.documentMessage.fileName || '[Documento]'}`;
  }
  return '';
}

export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  // Diagnóstico rápido al abrir la URL desde el navegador (GET)
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      endpoint: 'evolution-webhook',
      version: '2.3.7-ready',
      envCheck: {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseServiceKey: Boolean(
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
        ),
        hasEvolutionUrl: Boolean(process.env.EVOLUTION_API_URL),
        hasEvolutionKey: Boolean(process.env.EVOLUTION_API_KEY),
        instance: process.env.EVOLUTION_INSTANCE || 'eee',
      },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (webhookSecret) {
    const incomingSecret = req.headers['x-webhook-secret'] || req.query?.secret;
    if (incomingSecret !== webhookSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  let parsedBody = req.body;
  if (typeof parsedBody === 'string') {
    try {
      parsedBody = JSON.parse(parsedBody);
    } catch {
      parsedBody = {};
    }
  }
  const body =
    parsedBody && parsedBody.body && (parsedBody.body.data || parsedBody.body.event)
      ? parsedBody.body
      : parsedBody || {};

  // Evolution v2.3.7 puede enviar "messages.upsert" o "MESSAGES_UPSERT"
  const eventNormalized = String(body.event || '')
    .toLowerCase()
    .replace(/_/g, '.');
  if (eventNormalized && eventNormalized !== 'messages.upsert') {
    return res.status(200).json({ ignored: true, reason: `event:${eventNormalized}` });
  }

  let data = body.data;
  if (Array.isArray(data)) data = data[0];
  if (!data || !data.key) {
    return res.status(200).json({ ignored: true, reason: 'empty_payload' });
  }

  const remoteJid = String(data.key.remoteJid || '').trim();
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return res.status(200).json({ ignored: true, reason: 'group_or_status' });
  }

  const bodyText = extractTextFromEvolutionMessage(data.message);
  if (!bodyText) {
    return res.status(200).json({ ignored: true, reason: 'no_text_content' });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Faltan credenciales de Supabase en el servidor' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  try {
    // Resolver número real en Evolution 2.3.7 (soporta remoteJidAlt cuando llega @lid)
    const altJid = String(data.key.remoteJidAlt || data.key.participant || '').trim();
    const rawNumberSource = remoteJid.endsWith('@lid') && altJid ? altJid : remoteJid;
    const rawDigits = rawNumberSource.split('@')[0].replace(/\D/g, '');
    const cleanPhone = rawDigits || remoteJid.split('@')[0];
    const last8 = rawDigits.length >= 8 ? rawDigits.slice(-8) : rawDigits;

    const instanceId = String(body.instance || process.env.EVOLUTION_INSTANCE || 'eee').trim();
    const fromMe = Boolean(data.key.fromMe);
    const pushName = !fromMe && data.pushName ? String(data.pushName).trim() : '';
    const messageId = String(
      data.key.id || `evo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    );
    const nowIso = new Date().toISOString();

    // Buscar conversación existente para no duplicar hilos entre @lid y teléfono real
    let existingConv: any = null;
    const { data: byId, error: byIdErr } = await supabase
      .from('bb_conversations')
      .select('*')
      .in('id', Array.from(new Set([remoteJid, cleanPhone].filter(Boolean))))
      .limit(1);

    if (byIdErr) {
      return res.status(500).json({ error: 'Error leyendo bb_conversations', details: byIdErr.message });
    }

    if (byId && byId.length > 0) {
      existingConv = byId[0];
    } else if (last8.length >= 8) {
      const { data: byPhone } = await supabase
        .from('bb_conversations')
        .select('*')
        .ilike('contact_phone', `%${last8}`)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (byPhone && byPhone.length > 0) {
        existingConv = byPhone[0];
      }
    }

    const conversationId = existingConv?.id || remoteJid;

    if (existingConv) {
      const nextPatch: Record<string, any> = {
        last_message: bodyText,
        updated_at: nowIso,
        instance_id: instanceId,
      };
      if (pushName && (!existingConv.contact_name || existingConv.contact_name === existingConv.contact_phone)) {
        nextPatch.contact_name = pushName;
      }
      if (cleanPhone && (!existingConv.contact_phone || String(existingConv.contact_phone).includes('@lid'))) {
        nextPatch.contact_phone = cleanPhone;
      }
      const { error: updErr } = await supabase
        .from('bb_conversations')
        .update(nextPatch)
        .eq('id', conversationId);
      if (updErr) {
        return res.status(500).json({ error: 'Error actualizando bb_conversations', details: updErr.message });
      }
    } else {
      const { error: insErr } = await supabase.from('bb_conversations').insert({
        id: conversationId,
        instance_id: instanceId,
        contact_name: pushName || cleanPhone,
        contact_phone: cleanPhone,
        last_message: bodyText,
        updated_at: nowIso,
        status: 'bot',
      });
      if (insErr) {
        return res.status(500).json({ error: 'Error insertando en bb_conversations', details: insErr.message });
      }
    }

    const { error: msgErr } = await supabase.from('bb_messages').upsert(
      {
        id: messageId,
        conversation_id: conversationId,
        body: bodyText,
        from_me: fromMe,
        created_at: nowIso,
        telefono_real: cleanPhone,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );
    if (msgErr) {
      return res.status(500).json({ error: 'Error guardando en bb_messages', details: msgErr.message });
    }

    return res.status(200).json({ ok: true, conversationId, messageId, event: eventNormalized });
  } catch (err: any) {
    console.error('Error en /api/evolution-webhook:', err);
    return res.status(500).json({ error: err?.message || 'Error procesando webhook Evolution' });
  }
}
