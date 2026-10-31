import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { producto, precioIdeal, precioPromedio, margen } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Falta la API KEY de OpenAI en Vercel' });
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content: 'Eres un experto en marketing para ecommerce en El Salvador. Escribes textos persuasivos para WhatsApp y Meta Ads. Usa un tono amigable, directo y salvadoreño. Usa emojis.'
          },
          {
            role: 'user',
            content: `Genera una estrategia de venta y un copy para el producto "${producto}". 
            Mi precio ideal es $${precioIdeal} y el mercado lo vende en promedio a $${precioPromedio}. 
            Quiero mantener un margen de ${margen}%. 
            Dame 3 opciones de copy diferentes, cortos y directos, que generen urgencia.`
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error?.message || 'Error consultando OpenAI');
    }

    return res.status(200).json({ copy: data.choices[0].message.content });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
