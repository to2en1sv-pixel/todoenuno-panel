import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  // Envolvemos TODO en un try/catch para que Vercel nunca devuelva un error HTML
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { conversationId, text, instanceId, contactPhone } = req.body;

    if (!conversationId || !text || !instanceId || !contactPhone) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    let bbKey = '';
    let botId = ''; 

    if (instanceId === 'builderbot-principal') {
      bbKey = process.env.BB_CRM1_KEY!;
      botId = process.env.BB_CRM1_TENANT!; 
    } else if (instanceId === 'ventas') {
      bbKey = process.env.BB_CRM2_KEY!;
      botId = process.env.BB_CRM2_TENANT!; 
    } else {
      return res.status(400).json({ error: 'Instancia no reconocida' });
    }

    // BuilderBot prefiere el teléfono sin el "+" y sin el "@s.whatsapp.net"
    const formattedPhone = contactPhone.replace('+', '').replace('@s.whatsapp.net', '');

    const bbResponse = await fetch(`https://app.builderbot.cloud/api/v1/bot/${botId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-builderbot': bbKey // El header exacto que dice tu captura
      },
      body: JSON.stringify({ 
        phone: formattedPhone,        
        message: text                 
      })
    });

    // Leemos como texto primero para evitar que HTML rompa el JSON
    const responseText = await bbResponse.text();

    if (!bbResponse.ok) {
      console.error('Error de BuilderBot:', responseText);
      const safeText = responseText.substring(0, 100).replace(/</g, '&lt;');
      return res.status(bbResponse.status).json({ 
        error: 'BuilderBot rechazó el mensaje', 
        details: safeText 
      });
    }

    return res.status(200).json({ success: true, response: responseText });

  } catch (error: any) {
    console.error('Error fatal en la API:', error);
    return res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
}
