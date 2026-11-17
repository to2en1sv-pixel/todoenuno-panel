import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

function unwrapMessageContent(rawMsg: any): any {
  let msg = rawMsg;
  for (let i = 0; i < 4; i++) {
    if (!msg || typeof msg !== 'object') break;
    if (msg.ephemeralMessage?.message) {
      msg = msg.ephemeralMessage.message;
      continue;
    }
    if (msg.viewOnceMessage?.message) {
      msg = msg.viewOnceMessage.message;
      continue;
    }
    if (msg.viewOnceMessageV2?.message) {
      msg = msg.viewOnceMessageV2.message;
      continue;
    }
    if (msg.documentWithCaptionMessage?.message) {
      msg = msg.documentWithCaptionMessage.message;
      continue;
    }
    if (msg.editedMessage?.message) {
      msg = msg.editedMessage.message;
      continue;
    }
    break;
  }
  return msg;
}

function extractTextFromEvolutionMessage(rawMsg: any): string {
  const msg = unwrapMessageContent(rawMsg);
  if (!msg || typeof msg !== 'object') return '';

  if (typeof msg.conversation === 'string' && msg.conversation.trim()) {
    return msg.conversation.trim();
  }
  if (msg.extendedTextMessage?.text) {
    return String(msg.extendedTextMessage.text).trim();
  }
  if (msg.buttonsResponseMessage?.selectedDisplayText) {
    return String(msg.buttonsResponseMessage.selectedDisplayText).trim();
  }
  if (msg.templateButtonReplyMessage?.selectedDisplayText) {
    return String(msg.templateButtonReplyMessage.selectedDisplayText).trim();
  }
  if (msg.listResponseMessage?.title) {
    return String(msg.listResponseMessage.title).trim();
  }
  if (msg.interactiveResponseMessage?.body?.text) {
    return String(msg.interactiveResponseMessage.body.text).trim();
  }
  if (msg.imageMessage) {
    const cap = msg.imageMessage.caption ? ` ${String(msg.imageMessage.caption).trim()}` : '';
    return `📷 [Imagen]${cap}`;
  }
  if (msg.videoMessage) {
    const cap = msg.videoMessage.caption ? ` ${String(msg.videoMessage.caption).trim()}` : '';
    return `🎥 [Video]${cap}`;
  }
  if (msg.audioMessage) {
    return '🎤 [Nota de voz]';
  }
  if (msg.stickerMessage) {
    return '🎭 [Sticker]';
  }
  if (msg.locationMessage) {
    return '📍 [Ubicación compartida]';
  }
  if (msg.documentMessage) {
    return `📄 ${msg.documentMessage.fileName || '[Documento]'}`;
  }
  return '';
}

function stripBase64DataUrl(raw?: string | null): string {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const idx = trimmed.indexOf(';base64,');
  if (idx !== -1) return trimmed.slice(idx + 8);
  return trimmed.replace(/^data:[^,]+,/, '');
}

function normalizeMimeType(rawMime: string | undefined, fallback: string): string {
  const base = String(rawMime || fallback).split(';')[0].trim().toLowerCase();
  return base || fallback;
}

function audioExtensionForMime(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a') || mimeType.includes('aac')) return 'm4a';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('webm')) return 'webm';
  return 'ogg';
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function getEvolutionMediaBase64(params: {
  messageId: string;
  remoteJid: string;
  fromMe: boolean;
  instanceId: string;
  inlineBase64?: string;
  fallbackMime: string;
}): Promise<{ base64: string; mimetype: string } | null> {
  const inlineClean = stripBase64DataUrl(params.inlineBase64);
  if (inlineClean.length > 64) {
    return { base64: inlineClean, mimetype: normalizeMimeType(undefined, params.fallbackMime) };
  }

  const evolutionUrl = (process.env.EVOLUTION_API_URL || '').replace(/\/+$/, '');
  const evolutionKey = process.env.EVOLUTION_API_KEY || '';
  if (!evolutionUrl || !evolutionKey) return null;

  const legacyInstances = new Set(['builderbot-principal', 'ventas', 'builderbot']);
  const targetInstance =
    params.instanceId && !legacyInstances.has(params.instanceId.toLowerCase())
      ? params.instanceId
      : process.env.EVOLUTION_INSTANCE || 'eee';

  try {
    const evoRes = await fetchWithTimeout(
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
              id: params.messageId,
              remoteJid: params.remoteJid,
              fromMe: params.fromMe,
            },
          },
          convertToMp4: false,
        }),
      },
      3800
    );

    if (!evoRes.ok) return null;
    const json: any = await evoRes.json().catch(() => ({}));
    const rawB64 = json?.base64 || json?.media?.base64 || json?.data?.base64 || '';
    const cleanB64 = stripBase64DataUrl(rawB64);
    if (!cleanB64) return null;

    const mime = normalizeMimeType(
      json?.mimetype || json?.media?.mimetype || params.fallbackMime,
      params.fallbackMime
    );
    return { base64: cleanB64, mimetype: mime };
  } catch {
    return null;
  }
}

async function transcribeAudioMessage(params: {
  base64: string;
  mimeType: string;
}): Promise<{ transcript: string; provider: string } | null> {
  const openAiKey = (process.env.OPENAI_API_KEY || '').trim();
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

  if (openAiKey) {
    try {
      const ext = audioExtensionForMime(params.mimeType);
      const buffer = Buffer.from(params.base64, 'base64');
      const formData = new FormData();
      formData.append('file', new Blob([buffer], { type: params.mimeType }), `nota-voz.${ext}`);
      formData.append('model', 'whisper-1');
      formData.append('language', 'es');
      formData.append(
        'prompt',
        'Nota de voz en español (El Salvador) de un cliente consultando por productos, precios, colores, tallas, envíos o dando su nombre y dirección para entrega contra entrega.'
      );

      const res = await fetchWithTimeout(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${openAiKey}` },
          body: formData,
        },
        5500
      );

      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const transcript = String(data?.text || '').trim();
        if (transcript) {
          return { transcript, provider: 'openai-whisper' };
        }
      }
    } catch (err) {
      console.warn('Error transcribiendo audio con OpenAI Whisper:', err);
    }
  }

  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            { inlineData: { mimeType: params.mimeType, data: params.base64 } },
            {
              text: 'Transcribe literalmente esta nota de voz de un cliente de WhatsApp en español (El Salvador). Devuelve únicamente la transcripción exacta sin comentarios extra.',
            },
          ],
        },
      });
      const transcript = String(response.text || '').trim();
      if (transcript) {
        return { transcript, provider: 'gemini-transcribe' };
      }
    } catch (err) {
      console.warn('Error transcribiendo audio con Gemini:', err);
    }
  }

  return null;
}

async function analyzeImageMessage(params: {
  base64: string;
  mimeType: string;
  caption: string;
  catalogLines: string;
}): Promise<{ summary: string; provider: string } | null> {
  const openAiKey = (process.env.OPENAI_API_KEY || '').trim();
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();

  const visionPrompt = [
    'Analiza esta imagen enviada por un cliente en WhatsApp a nuestra tienda COD (contra entrega) en El Salvador.',
    params.caption ? `Texto/caption enviado con la imagen: "${params.caption}"` : 'El cliente no escribió texto junto a la imagen.',
    params.catalogLines
      ? `Catálogo activo de la tienda:\n${params.catalogLines}`
      : 'No se pudo cargar el catálogo activo.',
    '',
    'Responde en español en máximo 3 líneas directas (sin markdown pesado):',
    '1) Indica qué muestra la imagen (producto/captura de anuncio, comprobante de transferencia bancaria, dirección/mapa o foto de reclamo/garantía).',
    '2) Si es producto o captura, describe qué artículo/color/modelo busca y menciona el SKU/Nombre del catálogo si coincide claramente.',
    '3) Si es comprobante de transferencia, extrae banco, monto, fecha y referencia. Si es mapa o dirección escrita, transcribe los datos visibles.',
  ].join('\n');

  if (openAiKey) {
    try {
      const res = await fetchWithTimeout(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openAiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            max_tokens: 240,
            messages: [
              {
                role: 'system',
                content:
                  'Eres el módulo de visión comercial de Todd en El Salvador. Sé preciso, breve y útil para cerrar ventas o verificar comprobantes.',
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: visionPrompt },
                  {
                    type: 'image_url',
                    image_url: {
                      url: `data:${params.mimeType};base64,${params.base64}`,
                      detail: 'auto',
                    },
                  },
                ],
              },
            ],
          }),
        },
        5500
      );

      if (res.ok) {
        const data: any = await res.json().catch(() => ({}));
        const summary = String(data?.choices?.[0]?.message?.content || '').trim();
        if (summary) {
          return { summary, provider: 'openai-gpt4o-mini-vision' };
        }
      }
    } catch (err) {
      console.warn('Error analizando imagen con GPT-4o-mini Vision:', err);
    }
  }

  if (geminiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey: geminiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            { inlineData: { mimeType: params.mimeType, data: params.base64 } },
            { text: visionPrompt },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });
      const summary = String(response.text || '').trim();
      if (summary) {
        return { summary, provider: 'gemini-vision' };
      }
    } catch (err) {
      console.warn('Error analizando imagen con Gemini:', err);
    }
  }

  return null;
}

export default async function handler(req: any, res: any) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (req.method === 'GET') {
    const hasOpenAiKey = Boolean((process.env.OPENAI_API_KEY || '').trim());
    const hasGeminiKey = Boolean((process.env.GEMINI_API_KEY || '').trim());
    return res.status(200).json({
      ok: true,
      endpoint: 'evolution-webhook',
      version: '2.3.7-multimodal',
      envCheck: {
        hasSupabaseUrl: Boolean(supabaseUrl),
        hasSupabaseServiceKey: Boolean(
          process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
        ),
        hasEvolutionUrl: Boolean(process.env.EVOLUTION_API_URL),
        hasEvolutionKey: Boolean(process.env.EVOLUTION_API_KEY),
        hasN8nToddWebhook: Boolean(process.env.N8N_TODD_WEBHOOK_URL),
        hasOpenAiKey,
        hasGeminiKey,
        multimodalProvider: hasOpenAiKey ? 'openai-gpt' : hasGeminiKey ? 'gemini' : 'disabled',
        instance: process.env.EVOLUTION_INSTANCE || 'eee',
      },
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const webhookSecret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (webhookSecret) {
    const incomingSecret = req.headers['x-webhook-secret'] || req.query?.secret;
    if (incomingSecret !== webhookSecret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  let parsedBody = req.body;
  if (typeof parsedBody === 'string') {
    try {
      parsedBody = JSON.parse(parsedBody);
    } catch {
      parsedBody = {};
    }
  }
  const body =
    parsedBody && parsedBody.body && (parsedBody.body.data || parsedBody.body.event)
      ? parsedBody.body
      : parsedBody || {};

  const eventNormalized = String(body.event || '')
    .toLowerCase()
    .replace(/_/g, '.');
  if (
    eventNormalized &&
    eventNormalized !== 'messages.upsert' &&
    eventNormalized !== 'send.message'
  ) {
    return res.status(200).json({ ignored: true, reason: `event:${eventNormalized}` });
  }

  let data = body.data;
  if (Array.isArray(data)) data = data[0];
  if (!data || !data.key) {
    return res.status(200).json({ ignored: true, reason: 'empty_payload' });
  }

  const remoteJid = String(data.key.remoteJid || '').trim();
  if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
    return res.status(200).json({ ignored: true, reason: 'group_or_status' });
  }

  const baseBodyText = extractTextFromEvolutionMessage(data.message);
  if (!baseBodyText) {
    return res.status(200).json({ ignored: true, reason: 'no_text_content' });
  }

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: 'Faltan credenciales de Supabase en el servidor' });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  try {
    // Resolver número real en Evolution 2.3.7 (remoteJidAlt / participantAlt / senderPn cuando llega @lid)
    const altJid = String(
      data.key.remoteJidAlt || data.key.participantAlt || data.key.senderPn || ''
    ).trim();
    const hasResolvedPhone =
      !remoteJid.endsWith('@lid') || (altJid.length > 0 && !altJid.endsWith('@lid'));

    const rawNumberSource = remoteJid.endsWith('@lid') && altJid ? altJid : remoteJid;
    const rawDigits = rawNumberSource.split('@')[0].replace(/\D/g, '');
    const cleanPhone = hasResolvedPhone ? rawDigits || remoteJid.split('@')[0] : remoteJid;
    const last8 = hasResolvedPhone && rawDigits.length >= 8 ? rawDigits.slice(-8) : '';

    const instanceId = String(body.instance || process.env.EVOLUTION_INSTANCE || 'eee').trim();
    const fromMe = Boolean(data.key.fromMe) || eventNormalized === 'send.message';
    const pushName = !fromMe && data.pushName ? String(data.pushName).trim() : '';
    const messageId = String(
      data.key.id || `evo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    );
    const nowIso = new Date().toISOString();

    const unwrapped = unwrapMessageContent(data.message);
    const isIncomingImage = !fromMe && Boolean(unwrapped?.imageMessage);
    const isIncomingAudio = !fromMe && Boolean(unwrapped?.audioMessage);
    const hasAiKeys = Boolean(
      (process.env.OPENAI_API_KEY || '').trim() || (process.env.GEMINI_API_KEY || '').trim()
    );

    let storedBody = baseBodyText;
    let toddText = baseBodyText;
    let lastMessagePreview = baseBodyText;
    let mediaAnalyzed = false;
    let mediaType: 'image' | 'audio' | null = null;
    let mediaProvider: string | undefined;

    if ((isIncomingImage || isIncomingAudio) && hasAiKeys) {
      const inlineB64 =
        unwrapped?.base64 ||
        data.message?.base64 ||
        data.base64 ||
        body?.base64 ||
        '';

      if (isIncomingAudio) {
        mediaType = 'audio';
        const fallbackMime = normalizeMimeType(unwrapped.audioMessage?.mimetype, 'audio/ogg');
        const media = await getEvolutionMediaBase64({
          messageId,
          remoteJid,
          fromMe: false,
          instanceId,
          inlineBase64: inlineB64,
          fallbackMime,
        });

        if (media?.base64) {
          const result = await transcribeAudioMessage({
            base64: media.base64,
            mimeType: media.mimetype,
          });
          if (result?.transcript) {
            mediaAnalyzed = true;
            mediaProvider = result.provider;
            storedBody = `🎤 [Nota de voz]\n"${result.transcript}"`;
            lastMessagePreview = `🎤 "${result.transcript.slice(0, 180)}"`;
            toddText = `[El cliente envió una nota de voz de WhatsApp. Transcripción literal: "${result.transcript}"]`;
          }
        }
      } else if (isIncomingImage) {
        mediaType = 'image';
        const caption = unwrapped.imageMessage?.caption
          ? String(unwrapped.imageMessage.caption).trim()
          : '';
        const fallbackMime = normalizeMimeType(unwrapped.imageMessage?.mimetype, 'image/jpeg');

        const [media, stockRes] = await Promise.all([
          getEvolutionMediaBase64({
            messageId,
            remoteJid,
            fromMe: false,
            instanceId,
            inlineBase64: inlineB64,
            fallbackMime,
          }),
          supabase
            .from('inventory_stock')
            .select('sku, nombre, precio_venta, activo, activo_todd, template_id')
            .order('nombre')
            .limit(60),
        ]);

        if (media?.base64) {
          const rawRows = (stockRes.data || []).filter(
            (item: any) => item.activo !== false && item.activo_todd !== false
          );
          const skuSet = new Set(rawRows.map((r: any) => String(r.sku || '').trim().toUpperCase()));
          const seenTpl = new Set<string>();
          const parentRows = rawRows.filter((item: any) => {
            const skuU = String(item.sku || '').trim().toUpperCase();
            const isPrefixedChild = Array.from(skuSet).some(p => p !== skuU && skuU.startsWith(`${p}-`));
            if (isPrefixedChild) return false;
            const tId = item.template_id ? String(item.template_id).trim() : '';
            if (tId) {
              if (seenTpl.has(tId)) return false;
              seenTpl.add(tId);
            }
            return true;
          });

          const catalogLines = parentRows
            .map(
              (item: any) =>
                `- SKU: ${item.sku} | ${item.nombre} ($${Number(item.precio_venta || 0).toFixed(2)})`
            )
            .join('\n');

          const result = await analyzeImageMessage({
            base64: media.base64,
            mimeType: media.mimetype,
            caption,
            catalogLines,
          });
          if (result?.summary) {
            mediaAnalyzed = true;
            mediaProvider = result.provider;
            storedBody = `📷 [Imagen]${caption ? ` ${caption}` : ''}\n[Visión IA]: ${result.summary}`;
            lastMessagePreview = `📷 ${caption ? `${caption} · ` : ''}${result.summary}`.slice(0, 200);
            toddText = `[El cliente envió una imagen${
              caption ? ` con el texto: "${caption}"` : ''
            }. Análisis visual de la imagen: ${result.summary}]`;
          }
        }
      }
    }

    // Buscar conversación existente para no duplicar hilos entre @lid y teléfono real
    let existingConv: any = null;
    const idCandidates = Array.from(new Set([remoteJid, hasResolvedPhone ? cleanPhone : ''].filter(Boolean)));
    const { data: byId, error: byIdErr } = await supabase
      .from('bb_conversations')
      .select('*')
      .in('id', idCandidates)
      .limit(1);

    if (byIdErr) {
      return res.status(500).json({ error: 'Error leyendo bb_conversations', details: byIdErr.message });
    }

    if (byId && byId.length > 0) {
      existingConv = byId[0];
    } else if (last8.length >= 8) {
      const { data: byPhone } = await supabase
        .from('bb_conversations')
        .select('*')
        .ilike('contact_phone', `%${last8}`)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (byPhone && byPhone.length > 0) {
        existingConv = byPhone[0];
      }
    }

    const conversationId = existingConv?.id || remoteJid;

    if (existingConv) {
      const nextPatch: Record<string, any> = {
        last_message: lastMessagePreview,
        updated_at: nowIso,
        instance_id: instanceId,
      };
      if (
        pushName &&
        (!existingConv.contact_name ||
          existingConv.contact_name === existingConv.contact_phone ||
          existingConv.contact_name.includes('@lid'))
      ) {
        nextPatch.contact_name = pushName;
      }
      if (
        hasResolvedPhone &&
        cleanPhone &&
        (!existingConv.contact_phone || String(existingConv.contact_phone).includes('@lid'))
      ) {
        nextPatch.contact_phone = cleanPhone;
      }
      const { error: updErr } = await supabase
        .from('bb_conversations')
        .update(nextPatch)
        .eq('id', conversationId);
      if (updErr) {
        return res.status(500).json({ error: 'Error actualizando bb_conversations', details: updErr.message });
      }
    } else {
      const { error: insErr } = await supabase.from('bb_conversations').insert({
        id: conversationId,
        instance_id: instanceId,
        contact_name: pushName || cleanPhone,
        contact_phone: cleanPhone,
        last_message: lastMessagePreview,
        updated_at: nowIso,
        status: 'bot',
      });
      if (insErr) {
        return res.status(500).json({ error: 'Error insertando en bb_conversations', details: insErr.message });
      }
    }

    const { error: msgErr } = await supabase.from('bb_messages').upsert(
      {
        id: messageId,
        conversation_id: conversationId,
        body: storedBody,
        from_me: fromMe,
        created_at: nowIso,
        telefono_real: cleanPhone,
      },
      { onConflict: 'id', ignoreDuplicates: true }
    );
    if (msgErr) {
      return res.status(500).json({ error: 'Error guardando en bb_messages', details: msgErr.message });
    }

    // Detectar si llegó desde un anuncio de Meta Ads (Click-to-WhatsApp)
    const adReply =
      unwrapped?.extendedTextMessage?.contextInfo?.externalAdReply ||
      data?.contextInfo?.externalAdReply ||
      null;
    const adTag = adReply
      ? String(adReply.title || adReply.sourceId || adReply.ctwaClid || '').trim()
      : '';

    if (adTag && !fromMe) {
      const statePhone = last8 || cleanPhone;
      if (statePhone) {
        try {
          await supabase.from('whatsapp_state').upsert(
            {
              telefono: statePhone,
              last_detalle: `AD:${adTag}`,
              updated_at: nowIso,
            },
            { onConflict: 'telefono' }
          );
        } catch {}
      }
    }

    const convStatus = existingConv?.status ? String(existingConv.status) : 'bot';
    const n8nToddUrl = (process.env.N8N_TODD_WEBHOOK_URL || '').trim();
    const shouldForwardToTodd = Boolean(n8nToddUrl && !fromMe && convStatus !== 'human');
    let toddForwarded = false;
    let toddForwardStatus: number | string | undefined;

    if (shouldForwardToTodd) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (process.env.TODD_INTERNAL_SECRET) {
          headers['x-todd-secret'] = process.env.TODD_INTERNAL_SECRET;
        }
        const fwdRes = await fetch(n8nToddUrl, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            source: 'evolution-panel-bridge',
            instance: instanceId,
            conversationId,
            replyTarget: hasResolvedPhone ? cleanPhone : conversationId,
            phone: last8 || cleanPhone,
            rawPhone: cleanPhone,
            remoteJid,
            hasResolvedPhone,
            pushName: pushName || existingConv?.contact_name || '',
            messageId,
            text: toddText,
            mediaType,
            mediaAnalyzed,
            adTag: adTag || null,
            convStatus,
            timestamp: nowIso,
          }),
        });
        toddForwarded = fwdRes.ok;
        toddForwardStatus = fwdRes.status;
      } catch (fwdErr: any) {
        toddForwarded = false;
        toddForwardStatus = fwdErr?.name === 'AbortError' ? 'timeout' : fwdErr?.message || 'error';
      } finally {
        clearTimeout(timeout);
      }
    }

    return res.status(200).json({
      ok: true,
      conversationId,
      messageId,
      fromMe,
      convStatus,
      mediaType: mediaType || undefined,
      mediaAnalyzed,
      mediaProvider,
      toddForwarded,
      toddForwardStatus,
      adTag: adTag || undefined,
      event: eventNormalized,
    });
  } catch (err: any) {
    console.error('Error en /api/evolution-webhook:', err);
    return res.status(500).json({ error: err?.message || 'Error procesando webhook Evolution' });
  }
}
