export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { conversationId, text, instanceId } = req.body;

    if (!conversationId || !text || !instanceId) {
      return res.status(400).json({ error: 'Faltan parámetros' });
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

    // Usamos el conversationId (que es el LID) como "number" en la API V2
    const bbResponse = await fetch(`https://app.builderbot.cloud/api/v2/${botId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-builderbot': bbKey
      },
      body: JSON.stringify({ 
        messages: { content: text },
        number: conversationId, 
        checkIfExists: false
      }),
      // Esto evita que Vercel tire el error de Timeout
      signal: AbortSignal.timeout(8000) 
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
