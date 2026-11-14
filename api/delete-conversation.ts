import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversationId, contactPhone, clearToddState = true } = req.body || {};

  if (!conversationId) {
    return res.status(400).json({ error: 'Falta parámetro obligatorio: conversationId' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Faltan credenciales de Supabase en el servidor' });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false },
    });

    // 1. Eliminar mensajes asociados primero (por si no existe ON DELETE CASCADE en FK)
    const { error: msgDelError } = await supabase
      .from('bb_messages')
      .delete()
      .eq('conversation_id', conversationId);

    if (msgDelError) {
      return res.status(500).json({
        error: 'No se pudieron eliminar los mensajes de la conversación',
        details: msgDelError.message,
      });
    }

    // 2. Eliminar la conversación principal
    const { error: convDelError } = await supabase
      .from('bb_conversations')
      .delete()
      .eq('id', conversationId);

    if (convDelError) {
      return res.status(500).json({
        error: 'No se pudo eliminar la conversación en Supabase',
        details: convDelError.message,
      });
    }

    // 3. Limpiar estado de Bot Todd, locks y memoria saliente si se solicitó
    if (clearToddState !== false) {
      const rawPhone = String(contactPhone || conversationId || '').split('@')[0];
      const cleanDigits = rawPhone.replace(/\D/g, '');
      const last8 = cleanDigits.length >= 8 ? cleanDigits.slice(-8) : cleanDigits;
      const candidates = Array.from(
        new Set(
          [
            String(conversationId),
            String(contactPhone || ''),
            rawPhone,
            cleanDigits,
            last8,
            last8 ? `503${last8}` : '',
          ].filter(Boolean)
        )
      );

      if (candidates.length > 0) {
        try {
          await supabase.from('whatsapp_state').delete().in('telefono', candidates);
        } catch {}
        try {
          await supabase.from('whatsapp_processing_locks').delete().in('telefono', candidates);
        } catch {}
        try {
          await supabase.from('whatsapp_outbound_memory').delete().in('telefono', candidates);
        } catch {}
      }
    }

    return res.status(200).json({
      success: true,
      deletedConversationId: conversationId,
    });
  } catch (error: any) {
    console.error('Error en delete-conversation:', error);
    return res.status(500).json({
      error: 'Error interno eliminando conversación',
      details: error?.message,
    });
  }
}
