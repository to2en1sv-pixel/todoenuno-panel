import { createClient } from '@supabase/supabase-js';

function resolveEvolutionTarget(rawPhone?: string | null, rawConvId?: string | null): {
  sendTarget: string;
  cleanPhone: string;
} {
  const phoneStr = String(rawPhone || '').trim();
  const convStr = String(rawConvId || '').trim();

  if (convStr.endsWith('@lid')) {
    const lidDigits = convStr.split('@')[0];
    const phoneDigits = phoneStr.replace(/\D/g, '');
    if (!phoneStr || phoneStr.includes('@lid') || phoneDigits === lidDigits) {
      return {
        sendTarget: convStr,
        cleanPhone: convStr,
      };
    }
  }

  const candidates = [phoneStr, convStr].filter(Boolean);

  for (const cand of candidates) {
    if (cand.includes('@lid')) {
      return {
        sendTarget: cand,
        cleanPhone: cand,
      };
    }

    if (cand.includes('@s.whatsapp.net')) {
      const digits = cand.split('@')[0].replace(/\D/g, '');
      return {
        sendTarget: cand,
        cleanPhone: digits || cand,
      };
    }

    const digits = cand.replace(/\D/g, '');

    if (digits.length === 8) {
      return {
        sendTarget: `503${digits}`,
        cleanPhone: `503${digits}`,
      };
    }

    if (digits.length >= 9 && digits.length <= 13) {
      return {
        sendTarget: digits,
        cleanPhone: digits,
      };
    }

    if (digits.length >= 14 && convStr.includes('@lid')) {
      return {
        sendTarget: convStr,
        cleanPhone: convStr,
      };
    }
  }

  const fallback = candidates[0] || '';
  return {
    sendTarget: fallback,
    cleanPhone: fallback,
  };
}

function stripDataUrlPrefix(raw: string): string {
  const idx = raw.indexOf('base64,');
  return idx !== -1 ? raw.slice(idx + 7) : raw;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    conversationId,
    text,
    instanceId,
    contactPhone,
    pauseBot = true,
    mediaUrl,
    mediaBase64,
    mediaType = 'image',
    fileName = 'imagen.jpg',
  } = req.body || {};

  const messageText = String(text || '').trim();
  const hasMedia = Boolean(mediaUrl || mediaBase64);

  if (!conversationId || (!messageText && !hasMedia)) {
    return res.status(400).json({ error: 'conversationId y text o media son obligatorios' });
  }

  const evolutionUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const evolutionKey = process.env.EVOLUTION_API_KEY || '';
  const defaultInstance = process.env.EVOLUTION_INSTANCE || 'eee';

  if (!evolutionUrl || !evolutionKey) {
    return res.status(500).json({
      error: 'Falta configurar EVOLUTION_API_URL o EVOLUTION_API_KEY en las variables de entorno del servidor.',
    });
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
    let dbPhone = contactPhone;
    let dbInstance = instanceId;
    if (!dbPhone || !dbInstance) {
      const { data: conv } = await supabase
        .from('bb_conversations')
        .select('contact_phone, instance_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (conv) {
        dbPhone = dbPhone || conv.contact_phone;
        dbInstance = dbInstance || conv.instance_id;
      }
    }

    const legacyInstances = new Set(['builderbot-principal', 'ventas', 'builderbot']);
    const targetInstance =
      dbInstance && !legacyInstances.has(String(dbInstance).toLowerCase())
        ? String(dbInstance).trim()
        : defaultInstance;

    const { sendTarget, cleanPhone } = resolveEvolutionTarget(dbPhone, conversationId);
    if (!sendTarget) {
      return res.status(400).json({ error: 'No se encontró un número o JID de WhatsApp válido para este chat' });
    }

    const endpoint = hasMedia
      ? `${evolutionUrl}/message/sendMedia/${encodeURIComponent(targetInstance)}`
      : `${evolutionUrl}/message/sendText/${encodeURIComponent(targetInstance)}`;

    const payload = hasMedia
      ? {
          number: sendTarget,
          mediatype: mediaType || 'image',
          media: mediaUrl ? String(mediaUrl) : stripDataUrlPrefix(String(mediaBase64)),
          caption: messageText,
          fileName: String(fileName || 'producto.jpg'),
          delay: 250,
        }
      : {
          number: sendTarget,
          text: messageText,
          delay: 250,
        };

    const evoRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evolutionKey,
      },
      body: JSON.stringify(payload),
    });

    const rawResponse = await evoRes.text();
    let evoJson: any = {};
    try {
      evoJson = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      evoJson = { raw: rawResponse };
    }

    if (!evoRes.ok) {
      return res.status(evoRes.status).json({
        error: 'Evolution API rechazó el mensaje',
        details: evoJson?.message || evoJson?.response?.message || evoJson?.error || rawResponse || `HTTP ${evoRes.status}`,
        target: sendTarget,
      });
    }

    const messageId =
      evoJson?.key?.id ||
      evoJson?.messageId ||
      `unichat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const nowIso = new Date().toISOString();

    const storedBody = mediaUrl
      ? `[IMG:${mediaUrl}]${messageText ? `\n${messageText}` : ''}`
      : hasMedia
      ? `📷 [Imagen enviada]${messageText ? ` ${messageText}` : ''}`
      : messageText;

    const lastMessagePreview = hasMedia
      ? `📷 ${messageText || 'Imagen enviada'}`
      : messageText;

    await supabase.from('bb_messages').upsert(
      {
        id: String(messageId),
        conversation_id: conversationId,
        body: storedBody,
        from_me: true,
        created_at: nowIso,
        telefono_real: cleanPhone,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );

    const convUpdate: Record<string, any> = {
      last_message: lastMessagePreview,
      updated_at: nowIso,
    };
    if (pauseBot !== false) {
      convUpdate.status = 'human';
    }
    await supabase.from('bb_conversations').update(convUpdate).eq('id', conversationId);

    try {
      await supabase.from('whatsapp_outbound_memory').upsert(
        {
          message_id: String(messageId),
          telefono: cleanPhone,
          texto: messageText || '[MEDIA]',
          created_at: nowIso,
        },
        { onConflict: 'message_id', ignoreDuplicates: true }
      );
    } catch {}

    return res.status(200).json({
      success: true,
      messageId: String(messageId),
      storedBody,
      status: pauseBot !== false ? 'human' : undefined,
      instance: targetInstance,
      target: sendTarget,
    });
  } catch (error: any) {
    console.error('Error en /api/send-message (Evolution):', error);
    return res.status(500).json({ error: 'Error interno', details: error?.message });
  }
}
