export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { messageId, remoteJid, fromMe = false, instanceId } = req.body || {};
  if (!messageId || !remoteJid) {
    return res.status(400).json({ error: 'messageId y remoteJid son obligatorios' });
  }

  const evolutionUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const evolutionKey = process.env.EVOLUTION_API_KEY || '';
  const defaultInstance = process.env.EVOLUTION_INSTANCE || 'eee';

  if (!evolutionUrl || !evolutionKey) {
    return res.status(500).json({ error: 'Faltan credenciales de Evolution API en Vercel' });
  }

  const legacyInstances = new Set(['builderbot-principal', 'ventas', 'builderbot']);
  const targetInstance =
    instanceId && !legacyInstances.has(String(instanceId).toLowerCase())
      ? String(instanceId).trim()
      : defaultInstance;

  try {
    const evoRes = await fetch(
      `${evolutionUrl}/chat/getBase64FromMediaMessage/${encodeURIComponent(targetInstance)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: evolutionKey,
        },
        body: JSON.stringify({
          message: {
            key: {
              id: String(messageId),
              remoteJid: String(remoteJid),
              fromMe: Boolean(fromMe),
            },
          },
          convertToMp4: false,
        }),
      }
    );

    const raw = await evoRes.text();
    let json: any = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = {};
    }

    if (!evoRes.ok) {
      return res.status(evoRes.status).json({
        error: 'No se pudo descargar el archivo desde Evolution',
        details: json?.message || json?.error || raw || `HTTP ${evoRes.status}`,
      });
    }

    const base64 = json?.base64 || json?.media?.base64 || json?.data?.base64 || '';
    const mimetype = json?.mimetype || json?.media?.mimetype || 'application/octet-stream';

    if (!base64) {
      return res.status(404).json({ error: 'Evolution no devolvió contenido multimedia para este mensaje' });
    }

    return res.status(200).json({ ok: true, base64, mimetype });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'Error obteniendo multimedia' });
  }
}
