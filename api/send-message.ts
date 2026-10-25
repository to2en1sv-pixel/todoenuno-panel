import { createClient } from '@supabase/supabase-js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Ahora también recibimos el número de teléfono (contactPhone)
  const { conversationId, text, instanceId, contactPhone } = req.body;

  if (!conversationId || !text || !instanceId || !contactPhone) {
    return res.status(400).json({ error: 'Faltan parámetros requeridos' });
  }

  let bbKey = '';
  let bbPhoneId = ''; // Algunos CRMs requieren un ID de teléfono específico

  if (instanceId === 'builderbot-principal') {
    bbKey = process.env.BB_CRM1_KEY!;
    // Si BuilderBot te dio un ID de teléfono para la instancia 1, ponlo aquí:
    bbPhoneId = process.env.BB_CRM1_PHONE_ID || ''; 
  } else if (instanceId === 'ventas') {
    bbKey = process.env.BB_CRM2_KEY!;
    // Si BuilderBot te dio un ID de teléfono para la instancia 2, ponlo aquí:
    bbPhoneId = process.env.BB_CRM2_PHONE_ID || '';
  } else {
    return res.status(400).json({ error: 'Instancia no reconocida' });
  }

  try {
    // Usamos la API oficial de WhatsApp de BuilderBot para que el mensaje salga de verdad
    const bbResponse = await fetch(`https://wa-api.builderbot.app/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bbKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        number: contactPhone,      // El teléfono del cliente
        message: text,             // El texto a enviar
        // Si BuilderBot requiere el phone_id en el body, lo agregamos aquí:
        ...(bbPhoneId ? { phone_id: bbPhoneId } : {})
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
