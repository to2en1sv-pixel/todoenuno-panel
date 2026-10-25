import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { conversationId, action, instanceId } = req.body;

  if (!conversationId || !action || !instanceId) {
    return res.status(400).json({ error: 'Faltan parámetros' });
  }

  let bbUrl = '';
  let bbTenant = '';
  let bbKey = '';

  if (instanceId === 'builderbot-principal') {
    bbUrl = process.env.BB_CRM1_URL!;
    bbTenant = process.env.BB_CRM1_TENANT!;
    bbKey = process.env.BB_CRM1_KEY!;
  } else if (instanceId === 'ventas') {
    bbUrl = process.env.BB_CRM2_URL!;
    bbTenant = process.env.BB_CRM2_TENANT!;
    bbKey = process.env.BB_CRM2_KEY!;
  } else {
    return res.status(400).json({ error: 'Instancia no reconocida' });
  }

  try {
    const isMuted = action === 'human';

    // Solo enviamos is_muted. Si BuilderBot requiere assignee_id, 
    // tendríamos que buscar el ID real del usuario, pero mutearlo 
    // es suficiente para detener al bot.
    const bbResponse = await fetch(`${bbUrl}/api/v1/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: {
        'X-Tenant-ID': bbTenant,
        'Authorization': `Bearer ${bbKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        is_muted: isMuted
      })
    });

    if (!bbResponse.ok) {
      const errorData = await bbResponse.text();
      console.error('Error de BuilderBot:', errorData);
      return res.status(500).json({ error: 'BuilderBot rechazó la petición', details: errorData });
    }

    // Si funcionó en BuilderBot, actualizamos Supabase
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    await supabase
      .from('bb_conversations')
      .update({ status: action })
      .eq('id', conversationId);

    return res.status(200).json({ success: true, status: action });

  } catch (error: any) {
    console.error('Error en toggle-bot:', error);
    return res.status(500).json({ error: 'Error interno', details: error.message });
  }
}
