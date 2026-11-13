import { createClient } from '@supabase/supabase-js';

function extractTextFromEvolutionMessage(msg: any): string {
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
  if (msg.listResponseMessage?.title) {
    return String(msg.listResponseMessage.title).trim();
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
  if (msg.documentMessage) {
    return `📄 ${msg.documentMessage.fileName || '[Documento]'}`;
  }
  return '';
}

export default async function handler(req: any, res: any) {
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

  const body = req.body || {};
  const eventName = String(body.event || '').toLowerCase();
  if (eventName && eventName !== 'messages.upsert') {
    return res.status(200).json({ ignored: true, reason: `event:${eventName}` });
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
    // Resolver número real en Evolution 2.3.7 (soporta remoteJidAlt cuando llega @lid)
    const altJid = String(data.key.remoteJidAlt || '').trim();
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
    const { data: byId } = await supabase
      .from('bb_conversations')
      .select('*')
      .in('id', Array.from(new Set([remoteJid, cleanPhone].filter(Boolean))))
      .limit(1);

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
      await supabase.from('bb_conversations').update(nextPatch).eq('id', conversationId);
    } else {
      await supabase.from('bb_conversations').insert({
        id: conversationId,
        instance_id: instanceId,
        contact_name: pushName || cleanPhone,
        contact_phone: cleanPhone,
        last_message: bodyText,
        updated_at: nowIso,
        status: 'bot',
      });
    }

    await supabase.from('bb_messages').upsert(
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

    return res.status(200).json({ ok: true, conversationId, messageId });
  } catch (err: any) {
    console.error('Error en /api/evolution-webhook:', err);
    return res.status(500).json({ error: err?.message || 'Error procesando webhook Evolution' });
  }
}
