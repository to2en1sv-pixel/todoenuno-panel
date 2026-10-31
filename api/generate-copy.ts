import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { 
    productName, // <--- NUEVO
    marketLow, marketHigh, marketAvg, 
    productCost, shippingCost, cpa, totalCost, 
    marginPct, idealPrice, profit 
  } = req.body;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Falta la API KEY de OpenAI en Vercel' });
  }

  const prompt = `Actúa como un estratega senior de ecommerce y copywriter de direct response.
  
PRODUCTO: "${productName}" // <--- LA IA YA SABE QUÉ ES

DATOS DEL MERCADO:
- Precio más bajo: $${marketLow}
- Precio más alto: $${marketHigh}
- Precio promedio: $${marketAvg.toFixed(2)}

ESTRUCTURA DE COSTOS:
- Costo producto: $${productCost}
- Costo envío: $${shippingCost}
- CPA estimado: $${cpa}
- Costo total: $${totalCost.toFixed(2)}
- Margen deseado: ${marginPct}%
- Precio ideal: $${idealPrice.toFixed(2)}
- Utilidad neta: $${profit.toFixed(2)}

TAREA:
1) Sugiere UNA oferta irresistible para vender "${productName}" (combo, bundle, descuento por tiempo limitado, etc.). Justifícala en 2 líneas.
2) Escribe un copy publicitario corto y persuasivo (máximo 60 palabras) para Meta Ads y WhatsApp, con emojis y llamado a la acción. Menciona el producto.
3) Añade 3 viñetas con los ángulos psicológicos usados.
Responde en español, texto plano.`;

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
        max_tokens: 700,
        messages: [
          { role: 'system', content: 'Eres un estratega de pricing y copywriter de respuesta directa. Respondes en español, concreto y accionable.' },
          { role: 'user', content: prompt }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'Error consultando OpenAI');

    return res.status(200).json({ copy: data.choices[0].message.content });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}
