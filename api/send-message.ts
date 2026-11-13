import { createClient } from '@supabase/supabase-js';

function resolveEvolutionTarget(rawPhone?: string | null, rawConvId?: string | null): {
  sendTarget: string;
  cleanPhone: string;
} {
  const candidates = [rawPhone, rawConvId]
    .map(v => String(v || '').trim())
    .filter(Boolean);

  for (const cand of candidates) {
    // Si es un JID explícito de WhatsApp (@s.whatsapp.net o @lid), lo respetamos
    if (cand.includes('@lid')) {
      return {
        sendTarget: cand,
        cleanPhone: cand.split('@')[0],
      };
    }

    const rawPart = cand.includes('@') ? cand.split('@')[0] : cand;
    const digits = rawPart.replace(/\D/g, '');

    if (digits.length === 8) {
      return {
        sendTarget: `503${digits}`,
        cleanPhone: `503${digits}`,
      };
    }

    if (digits.length >= 9) {
      return {
        sendTarget: digits,
        cleanPhone: digits,
      };
    }
  }

  const fallback = candidates[0] || '';
  return {
    sendTarget: fallback,
    cleanPhone: fallback.replace(/\D/g, '') || fallback,
  };
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
  } = req.body || {};

  const messageText = String(text || '').trim();
  if (!conversationId || !messageText) {
    return res.status(400).json({ error: 'conversationId y text son obligatorios' });
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
    // 1. Si no llegó contactPhone, lo consultamos en bb_conversations
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

    // Evitar enviar a nombres de instancia heredados de BuilderBot
    const legacyInstances = new Set(['builderbot-principal', 'ventas', 'builderbot']);
    const targetInstance =
      dbInstance && !legacyInstances.has(String(dbInstance).toLowerCase())
        ? String(dbInstance).trim()
        : defaultInstance;

    const { sendTarget, cleanPhone } = resolveEvolutionTarget(dbPhone, conversationId);
    if (!sendTarget) {
      return res.status(400).json({ error: 'No se encontró un número o JID de WhatsApp válido para este chat' });
    }

    // 2. Enviar mensaje por Evolution API v2.3.7
    const evoRes = await fetch(
      `${evolutionUrl}/message/sendText/${encodeURIComponent(targetInstance)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: evolutionKey,
        },
        body: JSON.stringify({
          number: sendTarget,
          text: messageText,
          delay: 250,
        }),
      }
    );

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
        details: evoJson?.message || evoJson?.error || rawResponse || `HTTP ${evoRes.status}`,
      });
    }

    const messageId =
      evoJson?.key?.id ||
      evoJson?.messageId ||
      `unichat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const nowIso = new Date().toISOString();

    // 3. Guardar mensaje en bb_messages para reflejo inmediato en UniChat
    await supabase.from('bb_messages').upsert(
      {
        id: String(messageId),
        conversation_id: conversationId,
        body: messageText,
        from_me: true,
        created_at: nowIso,
        telefono_real: cleanPhone,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );

    // 4. Actualizar conversación y pausar Bot Todd si un humano respondió
    const convUpdate: Record<string, any> = {
      last_message: messageText,
      updated_at: nowIso,
    };
    if (pauseBot !== false) {
      convUpdate.status = 'human';
    }
    await supabase.from('bb_conversations').update(convUpdate).eq('id', conversationId);

    // 5. Registrar en whatsapp_outbound_memory para filtro anti-eco en n8n
    try {
      await supabase.from('whatsapp_outbound_memory').upsert(
        {
          message_id: String(messageId),
          telefono: cleanPhone,
          texto: messageText,
          created_at: nowIso,
        },
        { onConflict: 'message_id', ignoreDuplicates: true }
      );
    } catch {
      // No bloquear si la tabla no aplica
    }

    return res.status(200).json({
      success: true,
      messageId: String(messageId),
      status: pauseBot !== false ? 'human' : undefined,
      instance: targetInstance,
    });
  } catch (error: any) {
    console.error('Error en /api/send-message (Evolution):', error);
    return res.status(500).json({ error: 'Error interno', details: error?.message });
  }
}
