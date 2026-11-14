import { createClient } from '@supabase/supabase-js';

function resolveEvolutionTarget(rawPhone?: string | null, rawConvId?: string | null): {
  sendTarget: string;
  cleanPhone: string;
} {
  const phoneStr = String(rawPhone || '').trim();
  const convStr = String(rawConvId || '').trim();

  if (convStr.endsWith('@lid')) {
    const lidDigits = convStr.split('@')[0];
    const phoneDigits = phoneStr.replace(/\D/g, '');
    if (!phoneStr || phoneStr.includes('@lid') || phoneDigits === lidDigits) {
      return {
        sendTarget: convStr,
        cleanPhone: convStr,
      };
    }
  }

  const candidates = [phoneStr, convStr].filter(Boolean);

  for (const cand of candidates) {
    if (cand.includes('@lid')) {
      return {
        sendTarget: cand,
        cleanPhone: cand,
      };
    }

    if (cand.includes('@s.whatsapp.net')) {
      const digits = cand.split('@')[0].replace(/\D/g, '');
      return {
        sendTarget: cand,
        cleanPhone: digits || cand,
      };
    }

    const digits = cand.replace(/\D/g, '');

    if (digits.length === 8) {
      return {
        sendTarget: `503${digits}`,
        cleanPhone: `503${digits}`,
      };
    }

    if (digits.length >= 9 && digits.length <= 13) {
      return {
        sendTarget: digits,
        cleanPhone: digits,
      };
    }

    if (digits.length >= 14 && convStr.includes('@lid')) {
      return {
        sendTarget: convStr,
        cleanPhone: convStr,
      };
    }
  }

  const fallback = candidates[0] || '';
  return {
    sendTarget: fallback,
    cleanPhone: fallback,
  };
}

function normalizeEvolutionMedia(
  rawUrl?: string | null,
  rawBase64?: string | null,
  fallbackFileName = 'producto.jpg',
  fallbackMediaType = 'image'
): {
  media: string;
  mimetype?: string;
  fileName: string;
  isPublicUrl: boolean;
} {
  const source = String(rawBase64 || rawUrl || '').trim();
  const dataUriMatch = source.match(/^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([\s\S]+)$/i);

  if (dataUriMatch) {
    const mimetype = dataUriMatch[1].toLowerCase();
    const cleanBase64 = dataUriMatch[2].replace(/\s+/g, '');
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'application/pdf': 'pdf',
    };
    const ext = extMap[mimetype];
    let fileName = String(fallbackFileName || `archivo.${ext || 'jpg'}`);
    if (ext && /\.[a-z0-9]+$/i.test(fileName)) {
      fileName = fileName.replace(/\.[a-z0-9]+$/i, `.${ext}`);
    }
    return {
      media: cleanBase64,
      mimetype,
      fileName,
      isPublicUrl: false,
    };
  }

  if (/^https?:\/\//i.test(source)) {
    return {
      media: source,
      fileName: String(fallbackFileName || 'producto.jpg'),
      isPublicUrl: true,
    };
  }

  const idx = source.indexOf('base64,');
  const rawOnly = (idx !== -1 ? source.slice(idx + 7) : source).replace(/\s+/g, '');
  return {
    media: rawOnly,
    mimetype: fallbackMediaType === 'video' ? 'video/mp4' : 'image/jpeg',
    fileName: String(fallbackFileName || 'imagen.jpg'),
    isPublicUrl: false,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const {
    conversationId,
    text,
    instanceId,
    contactPhone,
    pauseBot = true,
    mediaUrl,
    mediaBase64,
    mediaType = 'image',
    fileName = 'imagen.jpg',
    productSku,
    sendVideoAfterImage = true,
  } = req.body || {};

  const messageText = String(text || '').trim();
  const hasExplicitMedia = Boolean(mediaUrl || mediaBase64);

  if (!conversationId || (!messageText && !hasExplicitMedia && !productSku)) {
    return res.status(400).json({ error: 'conversationId y text o media son obligatorios' });
  }

  const evolutionUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const evolutionKey = process.env.EVOLUTION_API_KEY || '';
  const defaultInstance = process.env.EVOLUTION_INSTANCE || 'eee';

  if (!evolutionUrl || !evolutionKey) {
    return res.status(500).json({
      error: 'Falta configurar EVOLUTION_API_URL o EVOLUTION_API_KEY en las variables de entorno del servidor.',
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Faltan credenciales de Supabase en el servidor' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  try {
    let dbPhone = contactPhone;
    let dbInstance = instanceId;
    if (!dbPhone || !dbInstance) {
      const { data: conv } = await supabase
        .from('bb_conversations')
        .select('contact_phone, instance_id')
        .eq('id', conversationId)
        .maybeSingle();
      if (conv) {
        dbPhone = dbPhone || conv.contact_phone;
        dbInstance = dbInstance || conv.instance_id;
      }
    }

    const legacyInstances = new Set(['builderbot-principal', 'ventas', 'builderbot']);
    const targetInstance =
      dbInstance && !legacyInstances.has(String(dbInstance).toLowerCase())
        ? String(dbInstance).trim()
        : defaultInstance;

    const { sendTarget, cleanPhone } = resolveEvolutionTarget(dbPhone, conversationId);
    if (!sendTarget) {
      return res.status(400).json({ error: 'No se encontró un número o JID de WhatsApp válido para este chat' });
    }

    let resolvedMediaUrl = mediaUrl ? String(mediaUrl).trim() : '';
    let resolvedFileName = String(fileName || 'producto.jpg');
    let resolvedProductName = '';
    let resolvedVideoUrl = '';

    if (productSku) {
      const skuClean = String(productSku).trim().toUpperCase();
      if (skuClean) {
        const [prodRes, cfgRes] = await Promise.all([
          supabase
            .from('inventory_stock')
            .select('image_url, sku, nombre')
            .eq('sku', skuClean)
            .maybeSingle(),
          supabase
            .from('panel_docs')
            .select('contenido')
            .eq('titulo', '__SYSTEM_TODD_CATALOG_SETTINGS_V1__')
            .maybeSingle(),
        ]);

        if (prodRes?.data) {
          resolvedProductName = String(prodRes.data.nombre || '').trim();
          if (!resolvedMediaUrl && !mediaBase64 && prodRes.data.image_url) {
            resolvedMediaUrl = String(prodRes.data.image_url).trim();
            resolvedFileName = `${skuClean}.jpg`;
          }
        }

        try {
          if (cfgRes?.data?.contenido) {
            const parsedCfg = JSON.parse(cfgRes.data.contenido);
            const vids = parsedCfg?.productVideos;
            if (vids && typeof vids === 'object' && vids[skuClean]) {
              resolvedVideoUrl = String(vids[skuClean]).trim();
            }
          }
        } catch {}
      }
    }

    const hasMedia = Boolean(resolvedMediaUrl || mediaBase64);
    const normalizedMedia = hasMedia
      ? normalizeEvolutionMedia(resolvedMediaUrl, mediaBase64, resolvedFileName, mediaType)
      : null;

    if (hasMedia && (!normalizedMedia || !normalizedMedia.media)) {
      return res.status(400).json({ error: 'El archivo multimedia está vacío o tiene un formato inválido.' });
    }

    const endpoint = hasMedia
      ? `${evolutionUrl}/message/sendMedia/${encodeURIComponent(targetInstance)}`
      : `${evolutionUrl}/message/sendText/${encodeURIComponent(targetInstance)}`;

    const hasYouTubeLink = /youtu\.?be/i.test(messageText);

    const payload =
      hasMedia && normalizedMedia
        ? {
            number: sendTarget,
            mediatype: mediaType || 'image',
            ...(normalizedMedia.mimetype ? { mimetype: normalizedMedia.mimetype } : {}),
            media: normalizedMedia.media,
            caption: messageText,
            fileName: normalizedMedia.fileName,
            delay: 250,
          }
        : {
            number: sendTarget,
            text: messageText,
            delay: 250,
            ...(hasYouTubeLink ? { linkPreview: true } : {}),
          };

    const evoRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: evolutionKey,
      },
      body: JSON.stringify(payload),
    });

    const rawResponse = await evoRes.text();
    let evoJson: any = {};
    try {
      evoJson = rawResponse ? JSON.parse(rawResponse) : {};
    } catch {
      evoJson = { raw: rawResponse };
    }

    if (!evoRes.ok) {
      return res.status(evoRes.status).json({
        error: 'Evolution API rechazó el mensaje',
        details: evoJson?.message || evoJson?.response?.message || evoJson?.error || rawResponse || `HTTP ${evoRes.status}`,
        target: sendTarget,
      });
    }

    const messageId =
      evoJson?.key?.id ||
      evoJson?.messageId ||
      `unichat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const nowIso = new Date().toISOString();

    const storedBody =
      normalizedMedia?.isPublicUrl
        ? `[IMG:${normalizedMedia.media}]${messageText ? `\n${messageText}` : ''}`
        : hasMedia
        ? `📷 [Imagen enviada]${messageText ? `\n${messageText}` : ''}`
        : messageText;

    const lastMessagePreview = hasMedia
      ? `📷 ${messageText || 'Imagen enviada'}`
      : messageText;

    await supabase.from('bb_messages').upsert(
      {
        id: String(messageId),
        conversation_id: conversationId,
        body: storedBody,
        from_me: true,
        created_at: nowIso,
        telefono_real: cleanPhone,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );

    const convUpdate: Record<string, any> = {
      last_message: lastMessagePreview,
      updated_at: nowIso,
    };
    if (pauseBot !== false) {
      convUpdate.status = 'human';
    }
    await supabase.from('bb_conversations').update(convUpdate).eq('id', conversationId);

    try {
      await supabase.from('whatsapp_outbound_memory').upsert(
        {
          message_id: String(messageId),
          telefono: cleanPhone,
          texto: messageText || '[MEDIA]',
          created_at: nowIso,
        },
        { onConflict: 'message_id', ignoreDuplicates: true }
      );
    } catch {}

    let followUpVideoMessage: { id: string; body: string; created_at: string } | null = null;

    if (hasMedia && sendVideoAfterImage !== false && resolvedVideoUrl) {
      try {
        const ytIdMatch = resolvedVideoUrl.match(
          /(?:youtu\.be\/|shorts\/|embed\/|live\/|[?&]v=)([A-Za-z0-9_-]{11})/i
        );
        const ytId = ytIdMatch?.[1] || '';

        const { data: recentConvMsgs } = await supabase
          .from('bb_messages')
          .select('body')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false })
          .limit(20);

        const alreadySentVideo = (recentConvMsgs || []).some((m: any) => {
          const b = String(m?.body || '');
          return b.includes(resolvedVideoUrl) || (ytId ? b.includes(ytId) : false);
        });

        if (!alreadySentVideo) {
          const videoText = `🎥 Mira cómo se usa *${resolvedProductName || String(productSku).toUpperCase()}* paso a paso:\n${resolvedVideoUrl}`;
          const textEndpoint = `${evolutionUrl}/message/sendText/${encodeURIComponent(targetInstance)}`;
          const vidRes = await fetch(textEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: evolutionKey,
            },
            body: JSON.stringify({
              number: sendTarget,
              text: videoText,
              delay: 900,
              linkPreview: true,
            }),
          });

          if (vidRes.ok) {
            const vidRaw = await vidRes.text();
            let vidJson: any = {};
            try {
              vidJson = vidRaw ? JSON.parse(vidRaw) : {};
            } catch {}

            const vidMsgId = String(
              vidJson?.key?.id ||
                vidJson?.messageId ||
                `unichat-vid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
            );
            const vidIso = new Date().toISOString();

            await supabase.from('bb_messages').upsert(
              {
                id: vidMsgId,
                conversation_id: conversationId,
                body: videoText,
                from_me: true,
                created_at: vidIso,
                telefono_real: cleanPhone,
              },
              { onConflict: 'id', ignoreDuplicates: true }
            );

            await supabase
              .from('bb_conversations')
              .update({
                last_message: `🎥 Video How-To enviado`,
                updated_at: vidIso,
                ...(pauseBot !== false ? { status: 'human' } : {}),
              })
              .eq('id', conversationId);

            try {
              await supabase.from('whatsapp_outbound_memory').upsert(
                {
                  message_id: vidMsgId,
                  telefono: cleanPhone,
                  texto: videoText,
                  created_at: vidIso,
                },
                { onConflict: 'message_id', ignoreDuplicates: true }
              );
            } catch {}

            followUpVideoMessage = {
              id: vidMsgId,
              body: videoText,
              created_at: vidIso,
            };
          }
        }
      } catch (vidErr) {
        console.error('Error enviando video how-to de seguimiento:', vidErr);
      }
    }

    return res.status(200).json({
      success: true,
      messageId: String(messageId),
      storedBody,
      followUpVideoMessage,
      status: pauseBot !== false ? 'human' : undefined,
      instance: targetInstance,
      target: sendTarget,
    });
  } catch (error: any) {
    console.error('Error en /api/send-message (Evolution):', error);
    return res.status(500).json({ error: 'Error interno', details: error?.message });
  }
}
