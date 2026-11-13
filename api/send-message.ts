import { createClient } from '@supabase/supabase-js';

function resolveEvolutionTarget(rawPhone?: string | null, rawConvId?: string | null): {
  sendTarget: string;
  cleanPhone: string;
} {
  const phoneStr = String(rawPhone || '').trim();
  const convStr = String(rawConvId || '').trim();

  // Si el conversationId es un @lid y contact_phone es solo la parte numérica de ese mismo LID (sin teléfono real resuelto),
  // debemos enviar OBLIGATORIAMENTE con @lid para que Evolution v2.3.7 lo entregue.
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

    // Si tiene 14+ dígitos y no coincide con un teléfono normal, probablemente sea un LID guardado sin dominio
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
        details: evoJson?.message || evoJson?.response?.message || evoJson?.error || rawResponse || `HTTP ${evoRes.status}`,
        target: sendTarget,
      });
    }

    const messageId =
      evoJson?.key?.id ||
      evoJson?.messageId ||
      `unichat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const nowIso = new Date().toISOString();

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

    const convUpdate: Record<string, any> = {
      last_message: messageText,
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
          texto: messageText,
          created_at: nowIso,
        },
        { onConflict: 'message_id', ignoreDuplicates: true }
      );
    } catch {}

    return res.status(200).json({
      success: true,
      messageId: String(messageId),
      status: pauseBot !== false ? 'human' : undefined,
      instance: targetInstance,
      target: sendTarget,
    });
  } catch (error: any) {
    console.error('Error en /api/send-message (Evolution):', error);
    return res.status(500).json({ error: 'Error interno', details: error?.message });
  }
}
