import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { conversationId, text, instanceId, contactPhone } = req.body;

  if (!conversationId || !text || !instanceId || !contactPhone) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos' });
  }

  let bbKey = '';
  let botId = ''; // El ID del bot para la URL

  if (instanceId === 'builderbot-principal') {
    bbKey = process.env.BB_CRM1_KEY!;
    botId = process.env.BB_CRM1_TENANT!; // En este caso el Bot ID es el mismo Tenant ID
  } else if (instanceId === 'ventas') {
    bbKey = process.env.BB_CRM2_KEY!;
    botId = process.env.BB_CRM2_TENANT!; 
  } else {
    return res.status(400).json({ error: 'Instancia no reconocida' });
  }

  // Aseguramos que el teléfono tenga el formato +503...
  const formattedPhone = contactPhone.startsWith('+') ? contactPhone : `+${contactPhone}`;

  try {
    // Usamos la URL de app.builderbot.cloud como indica la documentación
    const bbResponse = await fetch(`https://app.builderbot.cloud/api/v1/bot/${botId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-builderbot': bbKey // <-- EL HEADER CORRECTO
      },
      body: JSON.stringify({ 
        phone: formattedPhone,        
        message: text                 
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
    console.error('Error enviando mensaje:', error);
    return res.status(500).json({ error: 'Error interno', details: error.message });
  }
}
