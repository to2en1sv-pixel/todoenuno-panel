export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { conversationId, text, instanceId } = req.body;

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

    // Usamos el endpoint de V1 que toma el conversationId
    const bbResponse = await fetch(`https://app.builderbot.cloud/api/v1/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-builderbot': bbKey
      },
      body: JSON.stringify({ 
        content: text,
        message_type: 'TEXT', 
        sender: 'AGENT'
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
