import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { conversationId, text, instanceId } = req.body;

  if (!conversationId || !text || !instanceId) {
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
    const bbResponse = await fetch(`${bbUrl}/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'X-Tenant-ID': bbTenant,
        'Authorization': `Bearer ${bbKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        content: text,
        message_type: 'TEXT', 
        sender: 'AGENT' // ¡CORREGIDO!
      })
    });

    if (!bbResponse.ok) {
      const errorData = await bbResponse.text();
      console.error('Error de BuilderBot al enviar mensaje:', errorData);
      return res.status(500).json({ error: 'BuilderBot rechazó el mensaje', details: errorData });
    }

    return res.status(200).json({ success: true });

  } catch (error: any) {
    console.error('Error enviando mensaje:', error);
    return res.status(500).json({ error: 'Error interno', details: error.message });
  }
}
