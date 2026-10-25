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
      botId = process.env.BB_CRM1_TENANT!;
    } else if (instanceId === 'ventas') {
      bbKey = process.env.BB_CRM2_KEY!;
      botId = process.env.BB_CRM2_TENANT!;
    } else {
      return res.status(400).json({ error: 'Instancia no reconocida' });
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-builderbot': bbKey
    };

    let telefonoReal = contactPhone;

    // Si el teléfono es un ID (empieza con letras o tiene más de 15 caracteres)
    if (!telefonoReal.startsWith('+') && telefonoReal.length > 15) {
      try {
        // 1. Preguntamos a BuilderBot por los datos del contacto (usando API v1)
        const contactRes = await fetch(`https://app.builderbot.cloud/api/v1/contacts/${contactPhone}`, {
          method: 'GET',
          headers
        });

        if (contactRes.ok) {
          const contactData = await contactRes.json();
          
          // 🔍 ESTO IMPRIMIRÁ EN LOS LOGS DE VERCEL LO QUE DEVUELVE BUILDERBOT
          console.log('--- DATOS DEL CONTACTO ---', JSON.stringify(contactData));

          // Buscamos el número en todas las posibles respuestas
          telefonoReal = 
            contactData.phone || 
            contactData.number || 
            contactData.data?.phone || 
            contactData.data?.number || 
            contactData.data?.id || 
            contactPhone;
        }
      } catch (e) {
        console.error('Error buscando contacto:', e);
      }
    }

    // Limpiamos el número (quitamos +, espacios y @s.whatsapp.net)
    const formattedPhone = telefonoReal.replace('+', '').replace(/\s/g, '').replace('@s.whatsapp.net', '');

    console.log('--- ENVIANDO A NÚMERO ---', formattedPhone);

    // 2. Enviamos el mensaje con el número correcto
    const bbResponse = await fetch(`https://app.builderbot.cloud/api/v2/${botId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        messages: { content: text },
        number: formattedPhone,
        checkIfExists: false
      }),
      signal: AbortSignal.timeout(8000) // 8 segundos máximo de espera
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
