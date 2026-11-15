import { createClient } from '@supabase/supabase-js';

const GRAPH_VERSION = 'v19.0';
const VAULT_DOC_TITLE = '__SYSTEM_CONTENT_VAULT_V1__';
const DIST_CONFIG_DOC_TITLE = '__SYSTEM_SOCIAL_DIST_CONFIG_V1__';
const CATALOG_CFG_DOC_TITLE = '__SYSTEM_TODD_CATALOG_SETTINGS_V1__';
const STORAGE_BUCKET = 'content-vault';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Faltan credenciales de Supabase en el servidor');
  }

  return createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });
}

async function readDocJson<T>(supabase: any, titulo: string, fallback: T): Promise<{ id?: string; data: T }> {
  const { data } = await supabase
    .from('panel_docs')
    .select('id,contenido')
    .eq('titulo', titulo)
    .maybeSingle();

  if (data?.contenido) {
    try {
      return { id: data.id, data: JSON.parse(data.contenido) as T };
    } catch {}
  }
  return { id: data?.id, data: fallback };
}

async function writeDocJson(supabase: any, titulo: string, payload: unknown, existingId?: string) {
  const serialized = JSON.stringify(payload);
  const nowIso = new Date().toISOString();

  if (existingId) {
    await supabase
      .from('panel_docs')
      .update({
        contenido: serialized,
        categoria: 'Sistema',
        estado: 'Completado',
        updated_at: nowIso,
      })
      .eq('id', existingId);
    return;
  }

  const { data: found } = await supabase
    .from('panel_docs')
    .select('id')
    .eq('titulo', titulo)
    .maybeSingle();

  if (found?.id) {
    await supabase
      .from('panel_docs')
      .update({
        contenido: serialized,
        categoria: 'Sistema',
        estado: 'Completado',
        updated_at: nowIso,
      })
      .eq('id', found.id);
  } else {
    await supabase.from('panel_docs').insert({
      titulo,
      contenido: serialized,
      categoria: 'Sistema',
      estado: 'Completado',
      updated_at: nowIso,
    });
  }
}

async function ensureStorageBucket(supabase: any): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: existing, error: getErr } = await supabase.storage.getBucket(STORAGE_BUCKET);
    if (existing && !getErr) {
      return { ok: true };
    }

    const { data: buckets, error: listErr } = await supabase.storage.listBuckets();
    if (!listErr && Array.isArray(buckets)) {
      const exists = buckets.some((b: any) => b.name === STORAGE_BUCKET || b.id === STORAGE_BUCKET);
      if (exists) return { ok: true };
    }

    const { error: createErr } = await supabase.storage.createBucket(STORAGE_BUCKET, {
      public: true,
    });

    if (!createErr || /already exists/i.test(createErr.message || '')) {
      return { ok: true };
    }

    return { ok: false, error: createErr.message || 'No se pudo crear el bucket' };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error verificando Storage' };
  }
}

async function fetchMetaPagesWithIg(supabase: any) {
  const { data: pages, error } = await supabase
    .from('fb_pages')
    .select('page_id, page_name, access_token');

  if (error) {
    throw new Error(`Error leyendo fb_pages: ${error.message}`);
  }

  const enriched = await Promise.all(
    (pages || []).map(async (p: any) => {
      let igAccount: { id: string; username?: string; profile_picture_url?: string } | null = null;
      let igError: string | null = null;
      if (p.access_token) {
        try {
          const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
            p.page_id
          )}?fields=name,instagram_business_account{id,username,profile_picture_url}&access_token=${encodeURIComponent(
            p.access_token
          )}`;
          const res = await fetch(url);
          const json = await res.json().catch(() => ({}));
          if (res.ok && json?.instagram_business_account?.id) {
            igAccount = json.instagram_business_account;
          } else if (!res.ok) {
            igError = json?.error?.message || `Meta HTTP ${res.status}`;
          }
        } catch (err: any) {
          igError = err?.message || 'Error consultando IG vinculado';
        }
      }

      return {
        page_id: p.page_id,
        page_name: p.page_name || `Página ${p.page_id}`,
        has_token: Boolean(p.access_token),
        access_token: p.access_token || '',
        instagram_business_account: igAccount,
        igError,
      };
    })
  );

  return enriched;
}

async function publishToFacebook(params: {
  pageId: string;
  accessToken: string;
  caption: string;
  mediaType: 'imagen' | 'video';
  mediaUrl?: string | null;
}): Promise<{ ok: boolean; postId?: string; error?: string }> {
  const { pageId, accessToken, caption, mediaType, mediaUrl } = params;
  const cleanUrl = String(mediaUrl || '').trim();

  if (cleanUrl && mediaType === 'video') {
    const endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/videos`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_url: cleanUrl,
        description: caption,
        access_token: accessToken,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      return { ok: false, error: data?.error?.message || `Facebook Video HTTP ${res.status}` };
    }
    return { ok: true, postId: String(data.id || '') };
  }

  if (cleanUrl) {
    const endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/photos`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: cleanUrl,
        caption,
        published: true,
        access_token: accessToken,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.error) {
      return { ok: false, error: data?.error?.message || `Facebook Photo HTTP ${res.status}` };
    }
    return { ok: true, postId: String(data.post_id || data.id || '') };
  }

  const endpoint = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(pageId)}/feed`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: caption,
      access_token: accessToken,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) {
    return { ok: false, error: data?.error?.message || `Facebook Feed HTTP ${res.status}` };
  }
  return { ok: true, postId: String(data.id || '') };
}

async function waitForIgContainerReady(containerId: string, accessToken: string, maxTries = 12) {
  for (let i = 0; i < maxTries; i++) {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(
        containerId
      )}?fields=status_code,status&access_token=${encodeURIComponent(accessToken)}`
    );
    const data = await res.json().catch(() => ({}));
    const code = String(data?.status_code || '').toUpperCase();
    if (code === 'FINISHED' || code === 'PUBLISHED') {
      return { ready: true };
    }
    if (code === 'ERROR' || code === 'EXPIRED') {
      return { ready: false, error: data?.status || 'Instagram rechazó el procesamiento del archivo' };
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return { ready: false, error: 'Tiempo de espera agotado procesando el media en Instagram' };
}

async function publishToInstagram(params: {
  igUserId: string;
  accessToken: string;
  caption: string;
  mediaType: 'imagen' | 'video';
  mediaUrl?: string | null;
}): Promise<{ ok: boolean; mediaId?: string; error?: string }> {
  const { igUserId, accessToken, caption, mediaType, mediaUrl } = params;
  const cleanUrl = String(mediaUrl || '').trim();

  if (!cleanUrl) {
    return { ok: false, error: 'Instagram requiere una imagen o video con URL pública directa' };
  }

  const createPayload: Record<string, any> =
    mediaType === 'video'
      ? {
          media_type: 'REELS',
          video_url: cleanUrl,
          caption,
          share_to_feed: true,
          access_token: accessToken,
        }
      : {
          image_url: cleanUrl,
          caption,
          access_token: accessToken,
        };

  const createRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igUserId)}/media`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(createPayload),
    }
  );
  const createJson = await createRes.json().catch(() => ({}));

  if (!createRes.ok || createJson?.error || !createJson?.id) {
    return {
      ok: false,
      error: createJson?.error?.message || `Error creando contenedor IG (${createRes.status})`,
    };
  }

  const containerId = String(createJson.id);
  const check = await waitForIgContainerReady(containerId, accessToken, mediaType === 'video' ? 14 : 6);
  if (!check.ready) {
    return { ok: false, error: check.error };
  }

  const pubRes = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(igUserId)}/media_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: containerId,
        access_token: accessToken,
      }),
    }
  );
  const pubJson = await pubRes.json().catch(() => ({}));
  if (!pubRes.ok || pubJson?.error || !pubJson?.id) {
    return {
      ok: false,
      error: pubJson?.error?.message || `Error publicando en IG (${pubRes.status})`,
    };
  }

  return { ok: true, mediaId: String(pubJson.id) };
}

async function checkSkuHasStock(supabase: any, sku?: string | null): Promise<{ ok: boolean; stock: number; backorder: boolean }> {
  const skuClean = String(sku || '').trim().toUpperCase();
  if (!skuClean) return { ok: true, stock: 999, backorder: false };

  const [stockRes, cfgDoc] = await Promise.all([
    supabase
      .from('inventory_stock')
      .select('stock_disponible, activo')
      .eq('sku', skuClean)
      .maybeSingle(),
    readDocJson<any>(supabase, CATALOG_CFG_DOC_TITLE, {}),
  ]);

  if (!stockRes?.data) return { ok: true, stock: 999, backorder: false };
  const allowBackorder = Boolean(cfgDoc.data?.allowBackorderGlobal);
  const disp = Number(stockRes.data.stock_disponible || 0);
  const activo = stockRes.data.activo !== false;

  return {
    ok: activo && (disp > 0 || allowBackorder),
    stock: disp,
    backorder: allowBackorder,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const action = String(req.query?.action || req.body?.action || 'accounts').trim().toLowerCase();

  try {
    const supabase = getSupabaseAdmin();

    /* 1. LISTAR PÁGINAS DE FB + IG BUSINESS VINCULADO */
    if (action === 'accounts') {
      const [pages, cfgDoc] = await Promise.all([
        fetchMetaPagesWithIg(supabase),
        readDocJson<any>(supabase, DIST_CONFIG_DOC_TITLE, {}),
      ]);

      return res.status(200).json({
        ok: true,
        pages: pages.map(({ access_token: _tok, ...safe }) => safe),
        config: cfgDoc.data || {},
      });
    }

    /* 2. ASEGURAR BUCKET DE SUPABASE STORAGE */
    if (action === 'ensure_bucket') {
      const bucketRes = await ensureStorageBucket(supabase);
      if (!bucketRes.ok) {
        return res.status(400).json({
          ok: false,
          bucket: STORAGE_BUCKET,
          error: `No se pudo inicializar el bucket "${STORAGE_BUCKET}": ${bucketRes.error}. Verifica SUPABASE_SERVICE_ROLE_KEY en Vercel o créalo como público en Supabase → Storage.`,
        });
      }
      return res.status(200).json({ ok: true, bucket: STORAGE_BUCKET });
    }

    /* 3. SUBIDA SEGURA DESDE BASE64 (< 4MB) A SUPABASE STORAGE */
    if (action === 'upload_base64') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      const { fileName, mimeType, base64Data } = req.body || {};
      if (!base64Data) {
        return res.status(400).json({ error: 'Falta base64Data' });
      }
      const bucketCheck = await ensureStorageBucket(supabase);
      const rawB64 = String(base64Data).includes('base64,')
        ? String(base64Data).split('base64,')[1]
        : String(base64Data);
      const buffer = Buffer.from(rawB64, 'base64');
      const safeName = String(fileName || `pieza-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `uploads/${Date.now()}-${safeName}`;

      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
        contentType: mimeType || 'application/octet-stream',
        upsert: true,
      });

      if (upErr) {
        const extraHint = !bucketCheck.ok
          ? ` (${bucketCheck.error}). Verifica SUPABASE_SERVICE_ROLE_KEY o crea el bucket público "${STORAGE_BUCKET}" en Supabase → Storage.`
          : '';
        return res.status(500).json({ error: `Error subiendo archivo: ${upErr.message}${extraHint}` });
      }

      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return res.status(200).json({ ok: true, path, publicUrl: pub.publicUrl });
    }

    /* 4. GENERADOR DE COPYS OMNICANAL (FB + IG + SHORTS/TIKTOK) */
    if (action === 'generate_copy') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'POST required' });
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'Falta OPENAI_API_KEY en Vercel' });
      }

      const { titulo, pilar, sku, precio, mediaType, contexto } = req.body || {};
      const prompt = `Eres estratega de contenido y ventas contra entrega (COD) en El Salvador para la tienda TODOENUNO (to2en1.app).
Genera 3 versiones listas para publicar para esta pieza de contenido:

- Título / Tema: "${titulo || 'Pieza de marca TODOENUNO'}"
- Pilar: "${pilar || 'producto'}"
- Media: "${mediaType || 'imagen'}"
- SKU / Producto vinculado: "${sku || 'Contenido general / Marca'}"
- Precio referencial: ${precio ? `$${Number(precio).toFixed(2)}` : 'No especificado (contenido general)'}
- Contexto adicional: "${contexto || 'Envíos rápidos contra entrega a todo El Salvador'}"

Devuelve EXCLUSIVAMENTE un JSON válido con esta estructura exacta (sin markdown):
{
  "fb": "Copy persuasivo para Facebook Page (2-4 líneas, emojis moderados, CTA claro pidiendo comentar INFO o escribir por WhatsApp/Inbox)",
  "ig": "Caption optimizado para Instagram/Reels (primera línea gancho fuerte, cuerpo breve, CTA y 6 hashtags relevantes de El Salvador)",
  "short": "Título gancho ultra corto menor a 90 caracteres con #Shorts para YouTube Shorts y TikTok"
}`;

      const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.75,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Respondes siempre con JSON válido.' },
            { role: 'user', content: prompt },
          ],
        }),
      });

      const aiJson = await aiRes.json().catch(() => ({}));
      if (!aiRes.ok) {
        return res.status(aiRes.status).json({ error: aiJson?.error?.message || 'Error consultando OpenAI' });
      }

      const contentStr = aiJson?.choices?.[0]?.message?.content || '{}';
      const parsed = JSON.parse(contentStr);
      return res.status(200).json({
        ok: true,
        copies: {
          fb: String(parsed.fb || ''),
          ig: String(parsed.ig || ''),
          short: String(parsed.short || ''),
        },
      });
    }

    /* 5. PUBLICAR PIEZA ESPECÍFICA O SIGUIENTE EN COLA (RUN_NEXT) */
    if (action === 'publish' || action === 'run_next') {
      const [vaultDoc, cfgDoc, pages] = await Promise.all([
        readDocJson<any[]>(supabase, VAULT_DOC_TITLE, []),
        readDocJson<any>(supabase, DIST_CONFIG_DOC_TITLE, {}),
        fetchMetaPagesWithIg(supabase),
      ]);

      const vaultItems = Array.isArray(vaultDoc.data) ? vaultDoc.data : [];
      const cfg = cfgDoc.data || {};
      const requestedItem = req.body?.item;
      const requestedId = String(req.body?.itemId || requestedItem?.id || '').trim();

      let targetItem: any = requestedItem || vaultItems.find((x: any) => x.id === requestedId);

      // Si es run_next (cron / automático), elegimos la primera pieza apta con stock > 0
      if (action === 'run_next' && !targetItem) {
        const candidates = vaultItems.filter(
          (x: any) => x.status === 'programado' || x.status === 'listo'
        );

        for (const cand of candidates) {
          if (cand.sku && cfg.autoSkipOutOfStock !== false) {
            const st = await checkSkuHasStock(supabase, cand.sku);
            if (!st.ok) {
              cand.status = 'pausado_stock';
              cand.updatedAt = new Date().toISOString();
              continue;
            }
          }
          targetItem = cand;
          break;
        }

        if (!targetItem) {
          await writeDocJson(supabase, VAULT_DOC_TITLE, vaultItems, vaultDoc.id);
          return res.status(200).json({
            ok: true,
            published: false,
            reason: 'No hay piezas listas/programadas con stock disponible en este momento.',
          });
        }
      }

      if (!targetItem) {
        return res.status(404).json({ error: 'Pieza de contenido no encontrada' });
      }

      // Guardián de stock (evita publicar agotados)
      if (targetItem.sku && !req.body?.forcePublish && cfg.autoSkipOutOfStock !== false) {
        const st = await checkSkuHasStock(supabase, targetItem.sku);
        if (!st.ok) {
          const idx = vaultItems.findIndex((x: any) => x.id === targetItem.id);
          if (idx !== -1) {
            vaultItems[idx].status = 'pausado_stock';
            vaultItems[idx].updatedAt = new Date().toISOString();
            await writeDocJson(supabase, VAULT_DOC_TITLE, vaultItems, vaultDoc.id);
          }
          return res.status(200).json({
            ok: false,
            skippedOutOfStock: true,
            stock: st.stock,
            error: `El SKU #${targetItem.sku} tiene stock ${st.stock}. Pausado automáticamente para no pautar agotados.`,
          });
        }
      }

      const selectedPageId = String(req.body?.pageId || cfg.defaultPageId || '').trim();
      const page =
        pages.find((p: any) => p.page_id === selectedPageId && p.access_token) ||
        pages.find((p: any) => p.access_token);

      if (!page) {
        return res.status(400).json({
          error: 'No se encontró ninguna página de Facebook con access_token en fb_pages.',
        });
      }

      const targetsInput = req.body?.targets || targetItem.targets || { facebook: true, instagram: false };
      const wantFb = Boolean(targetsInput.facebook);
      const wantIg = Boolean(targetsInput.instagram);

      if (!wantFb && !wantIg) {
        return res.status(400).json({ error: 'Selecciona al menos Facebook o Instagram como destino.' });
      }

      const mediaType: 'imagen' | 'video' = targetItem.mediaType === 'video' ? 'video' : 'imagen';
      const mediaUrl = String(targetItem.videoEditadoUrl || targetItem.mediaUrl || '').trim();
      const fbCaption = String(targetItem.copies?.fb || targetItem.titulo || 'Disponible en TODOENUNO').trim();
      const igCaption = String(targetItem.copies?.ig || fbCaption).trim();

      const results: {
        fb?: { ok: boolean; postId?: string; error?: string };
        ig?: { ok: boolean; mediaId?: string; error?: string };
      } = {};

      if (wantFb) {
        results.fb = await publishToFacebook({
          pageId: page.page_id,
          accessToken: page.access_token,
          caption: fbCaption,
          mediaType,
          mediaUrl,
        });
      }

      if (wantIg) {
        const igUserId = String(
          req.body?.igUserId || cfg.igAccountIdOverride || page.instagram_business_account?.id || ''
        ).trim();

        if (!igUserId) {
          results.ig = {
            ok: false,
            error: 'Esta Facebook Page no tiene una cuenta de Instagram Business vinculada (o falta ID manual).',
          };
        } else {
          results.ig = await publishToInstagram({
            igUserId,
            accessToken: page.access_token,
            caption: igCaption,
            mediaType,
            mediaUrl,
          });
        }
      }

      const nowIso = new Date().toISOString();
      const anySuccess = Boolean(results.fb?.ok || results.ig?.ok);
      const errorsList = [
        results.fb && !results.fb.ok ? `FB: ${results.fb.error}` : null,
        results.ig && !results.ig.ok ? `IG: ${results.ig.error}` : null,
      ].filter(Boolean);

      const idx = vaultItems.findIndex((x: any) => x.id === targetItem.id);
      const updatedItem = {
        ...targetItem,
        status: anySuccess ? 'publicado' : 'error',
        updatedAt: nowIso,
        publishResults: {
          ...(targetItem.publishResults || {}),
          ...(results.fb?.postId ? { fb_post_id: results.fb.postId } : {}),
          ...(results.ig?.mediaId ? { ig_media_id: results.ig.mediaId } : {}),
          published_at: anySuccess ? nowIso : targetItem.publishResults?.published_at,
          error: errorsList.length > 0 ? errorsList.join(' | ') : undefined,
        },
      };

      if (idx !== -1) {
        vaultItems[idx] = updatedItem;
      } else {
        vaultItems.unshift(updatedItem);
      }
      await writeDocJson(supabase, VAULT_DOC_TITLE, vaultItems, vaultDoc.id);

      // Si vino vinculado a post_queue clásica, sincronizamos también esa tabla
      if (targetItem.legacyQueueId && anySuccess) {
        await supabase
          .from('post_queue')
          .update({
            status: 'posted',
            posted_at: nowIso,
            ...(results.fb?.postId ? { fb_post_id: results.fb.postId } : {}),
          })
          .eq('id', targetItem.legacyQueueId);
      }

      return res.status(anySuccess ? 200 : 400).json({
        ok: anySuccess,
        results,
        item: updatedItem,
        error: !anySuccess ? errorsList.join(' | ') || 'Falló la publicación en Meta' : undefined,
      });
    }

    return res.status(400).json({ error: `Acción no soportada: ${action}` });
  } catch (err: any) {
    console.error('Error en /api/content-distribute:', err);
    return res.status(500).json({ error: err?.message || 'Error interno en distribuidora' });
  }
}
