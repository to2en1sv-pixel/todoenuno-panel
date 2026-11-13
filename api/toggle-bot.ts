import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { conversationId, action, contactPhone } = req.body || {};

  if (!conversationId || !action) {
    return res.status(400).json({ error: 'Faltan parámetros obligatorios (conversationId, action)' });
  }

  const normalizedStatus = action === 'human' ? 'human' : 'bot';

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

    const { error: updateError } = await supabase
      .from('bb_conversations')
      .update({
        status: normalizedStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    if (updateError) {
      return res.status(500).json({
        error: 'No se pudo actualizar el estado de la conversación en Supabase',
        details: updateError.message,
      });
    }

    // Si pasamos a modo humano, liberamos cualquier lock activo de procesamiento del bot para ese número
    if (normalizedStatus === 'human') {
      const cleanDigits = String(contactPhone || conversationId || '').replace(/\D/g, '');
      const last8 = cleanDigits.length >= 8 ? cleanDigits.slice(-8) : cleanDigits;
      const candidates = Array.from(
        new Set([cleanDigits, last8, last8 ? `503${last8}` : ''].filter(Boolean))
      );
      if (candidates.length > 0) {
        try {
          await supabase.from('whatsapp_processing_locks').delete().in('telefono', candidates);
        } catch {
          // Opcional si la tabla no existe o no hay locks
        }
      }
    }

    return res.status(200).json({
      success: true,
      status: normalizedStatus,
      engine: 'evolution-v2',
    });
  } catch (error: any) {
    console.error('Error en toggle-bot:', error);
    return res.status(500).json({ error: 'Error interno', details: error?.message });
  }
}
