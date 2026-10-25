import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
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
      botId = process.env.BB_CRM1_TENANT!; // Usamos el UUID cb5063...
    } else if (instanceId === 'ventas') {
      bbKey = process.env.BB_CRM2_KEY!;
      botId = process.env.BB_CRM2_TENANT!; // Usamos el UUID de ventas
    } else {
      return res.status(400).json({ error: 'Instancia no reconocida' });
    }

    // Formatear teléfono (sin +, sin espacios)
    const formattedPhone = contactPhone.replace('+', '').replace('@s.whatsapp.net', '');

    // URL exacta de la API v2
    const bbResponse = await fetch(`https://app.builderbot.cloud/api/v2/${botId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-builderbot': bbKey
      },
      body: JSON.stringify({ 
        // FORMATO EXACTO DEL cURL
        messages: {
          content: text
        },
        number: formattedPhone,
        checkIfExists: false
      })
    });

    const responseText = await bbResponse.text();

    if (!bbResponse.ok) {
      console.error('Error de BuilderBot:', responseText);
      return res.status(bbResponse.status).json({ 
        error: 'BuilderBot rechazó el mensaje', 
        details: responseText.substring(0, 100) 
      });
    }

    return res.status(200).json({ success: true, response: responseText });

  } catch (error: any) {
    console.error('Error fatal en la API:', error);
    return res.status(500).json({ error: 'Error interno del servidor', details: error.message });
  }
}
