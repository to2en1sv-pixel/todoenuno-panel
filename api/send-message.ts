export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { conversationId, text, instanceId, contactPhone } = req.body; // Volvemos a usar contactPhone (que contiene el LID)

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

    // PASO 1: Preguntarle a BuilderBot el número real usando el LID (contactPhone)
    const contactRes = await fetch(`https://app.builderbot.cloud/api/v2/${botId}/contacts/${contactPhone}`, {
      headers: { 'x-api-builderbot': bbKey }
    });
    
    let realPhone = contactPhone; // Si falla, usamos el LID por defecto
    if (contactRes.ok) {
      const contactData = await contactRes.json();
      // BuilderBot devuelve el número en 'phone' o 'wa_id'
      realPhone = contactData.phone || contactData.wa_id || contactData.data?.phone || contactPhone;
    }

    // PASO 2: Enviar el mensaje al número real
    const bbResponse = await fetch(`https://app.builderbot.cloud/api/v2/${botId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-builderbot': bbKey
      },
      body: JSON.stringify({ 
        messages: { content: text },
        number: realPhone, 
        checkIfExists: false
      })
    });

    const responseText = await bbResponse.text();

    if (!bbResponse.ok) {
      return res.status(bbResponse.status).json({ error: 'BuilderBot rechazó el mensaje', details: responseText });
    }

    return res.status(200).json({ success: true });

  } catch (error: any) {
    return res.status(500).json({ error: 'Error interno', details: error.message });
  }
}
