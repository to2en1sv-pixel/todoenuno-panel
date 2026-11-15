import { supabase } from '@/lib/supabase';

export type ContentPilar =
  | 'producto'
  | 'demostracion'
  | 'testimonio'
  | 'educativo'
  | 'oferta'
  | 'marca';

export type ContentStatus =
  | 'borrador'
  | 'listo'
  | 'programado'
  | 'publicado'
  | 'pausado_stock'
  | 'error';

export type ContentOrigin = 'manual' | 'catalogo';

export interface ContentTargets {
  facebook: boolean;
  instagram: boolean;
  youtube: boolean;
  tiktok: boolean;
}

export interface ContentCopies {
  fb: string;
  ig: string;
  short: string;
}

export interface ContentPublishResults {
  fb_post_id?: string;
  fb_posts_by_page?: Record<string, string>;
  page_id?: string;
  page_name?: string;
  ig_media_id?: string;
  yt_video_id?: string;
  published_at?: string;
  error?: string;
}

export interface ContentVaultItem {
  id: string;
  origen: ContentOrigin;
  pilar: ContentPilar;
  titulo: string;
  sku?: string | null;
  mediaType: 'imagen' | 'video';
  mediaUrl: string;
  videoEditadoUrl?: string | null;
  evergreen: boolean;
  cooldownDays: number;
  status: ContentStatus;
  targetPageIds?: string[];
  targets: ContentTargets;
  copies: ContentCopies;
  publishResults?: ContentPublishResults;
  legacyQueueId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageNicheProfile {
  pageId: string;
  enabled: boolean;
  niche: string;
  tone: string;
  ctaKeyword?: string;
  autoCategories?: string[];
  lastPublishedAt?: string | null;
}

export interface SocialDistConfig {
  defaultPageId: string;
  igAccountIdOverride: string;
  autoSkipOutOfStock: boolean;
  cronStrategy: 'round_robin' | 'default_only';
  pageProfiles: Record<string, PageNicheProfile>;
  defaultTargets: ContentTargets;
  n8nWorkerWebhookUrl?: string;
}

export interface MetaConnectedPage {
  page_id: string;
  page_name: string;
  has_token: boolean;
  instagram_business_account: {
    id: string;
    username?: string;
    profile_picture_url?: string;
  } | null;
  igError?: string | null;
}

export const VAULT_DOC_TITLE = '__SYSTEM_CONTENT_VAULT_V1__';
export const DIST_CFG_DOC_TITLE = '__SYSTEM_SOCIAL_DIST_CONFIG_V1__';
const LOCAL_VAULT_KEY = 'todoenuno_content_vault_v1';
const LOCAL_CFG_KEY = 'todoenuno_social_dist_cfg_v1';
const STORAGE_BUCKET = 'content-vault';

export const DEFAULT_DIST_CONFIG: SocialDistConfig = {
  defaultPageId: '',
  igAccountIdOverride: '',
  autoSkipOutOfStock: true,
  cronStrategy: 'round_robin',
  pageProfiles: {},
  defaultTargets: {
    facebook: true,
    instagram: false,
    youtube: false,
    tiktok: false,
  },
  n8nWorkerWebhookUrl: '',
};

export function resolvePagesForCategory(
  categoria: string | null | undefined,
  cfg: SocialDistConfig
): string[] {
  const cat = String(categoria || '').trim().toLowerCase();
  if (!cat) return cfg.defaultPageId ? [cfg.defaultPageId] : [];
  const matched: string[] = [];
  for (const [pageId, prof] of Object.entries(cfg.pageProfiles || {})) {
    if (!prof || prof.enabled === false) continue;
    const cats = Array.isArray(prof.autoCategories) ? prof.autoCategories : [];
    if (cats.some((c) => c.trim().toLowerCase() === cat || cat.includes(c.trim().toLowerCase()))) {
      matched.push(pageId);
    }
  }
  if (matched.length > 0) return matched;
  return cfg.defaultPageId ? [cfg.defaultPageId] : [];
}

export const CONTENT_PILARS: Array<{
  id: ContentPilar;
  label: string;
  emoji: string;
  hint: string;
}> = [
  { id: 'producto', label: 'Producto', emoji: '📦', hint: 'Ficha comercial directa del catálogo' },
  { id: 'demostracion', label: 'Demostración', emoji: '🎥', hint: 'Video mostrando uso real o unboxing' },
  { id: 'testimonio', label: 'Testimonio', emoji: '⭐', hint: 'Prueba social y clientes felices' },
  { id: 'oferta', label: 'Oferta / Promo', emoji: '🔥', hint: 'Combos 2x1, descuentos o envío gratis' },
  { id: 'educativo', label: 'Educativo / Tip', emoji: '💡', hint: 'Consejos de uso que generan alcance' },
  { id: 'marca', label: 'Marca / Confianza', emoji: '✨', hint: 'Contra entrega SV, despachos reales' },
];

export async function fetchContentVault(): Promise<ContentVaultItem[]> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('contenido')
      .eq('titulo', VAULT_DOC_TITLE)
      .maybeSingle();

    if (!error && data?.contenido) {
      const parsed = JSON.parse(data.contenido);
      if (Array.isArray(parsed)) {
        try {
          localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(parsed));
        } catch {}
        return parsed as ContentVaultItem[];
      }
    }
  } catch {}

  try {
    const raw = localStorage.getItem(LOCAL_VAULT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as ContentVaultItem[];
    }
  } catch {}
  return [];
}

export async function saveContentVault(items: ContentVaultItem[]): Promise<boolean> {
  try {
    localStorage.setItem(LOCAL_VAULT_KEY, JSON.stringify(items));
  } catch {}

  try {
    const serialized = JSON.stringify(items);
    const nowIso = new Date().toISOString();
    const { data: existing } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', VAULT_DOC_TITLE)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from('panel_docs')
        .update({
          contenido: serialized,
          categoria: 'Sistema',
          estado: 'Completado',
          updated_at: nowIso,
        })
        .eq('id', existing.id);
      return !error;
    }

    const { error } = await supabase.from('panel_docs').insert({
      titulo: VAULT_DOC_TITLE,
      contenido: serialized,
      categoria: 'Sistema',
      estado: 'Completado',
      updated_at: nowIso,
    });
    return !error;
  } catch {
    return false;
  }
}

export async function fetchSocialDistConfig(): Promise<SocialDistConfig> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('contenido')
      .eq('titulo', DIST_CFG_DOC_TITLE)
      .maybeSingle();

    if (!error && data?.contenido) {
      const parsed = JSON.parse(data.contenido);
      const merged: SocialDistConfig = {
        ...DEFAULT_DIST_CONFIG,
        ...parsed,
        cronStrategy: parsed?.cronStrategy === 'default_only' ? 'default_only' : 'round_robin',
        pageProfiles: parsed?.pageProfiles && typeof parsed.pageProfiles === 'object' ? parsed.pageProfiles : {},
        defaultTargets: {
          ...DEFAULT_DIST_CONFIG.defaultTargets,
          ...(parsed?.defaultTargets || {}),
        },
      };
      try {
        localStorage.setItem(LOCAL_CFG_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    }
  } catch {}

  try {
    const raw = localStorage.getItem(LOCAL_CFG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_DIST_CONFIG,
        ...parsed,
        cronStrategy: parsed?.cronStrategy === 'default_only' ? 'default_only' : 'round_robin',
        pageProfiles: parsed?.pageProfiles && typeof parsed.pageProfiles === 'object' ? parsed.pageProfiles : {},
        defaultTargets: {
          ...DEFAULT_DIST_CONFIG.defaultTargets,
          ...(parsed?.defaultTargets || {}),
        },
      };
    }
  } catch {}
  return { ...DEFAULT_DIST_CONFIG };
}

export async function saveSocialDistConfig(cfg: SocialDistConfig): Promise<boolean> {
  try {
    localStorage.setItem(LOCAL_CFG_KEY, JSON.stringify(cfg));
  } catch {}

  try {
    const serialized = JSON.stringify(cfg);
    const nowIso = new Date().toISOString();
    const { data: existing } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', DIST_CFG_DOC_TITLE)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from('panel_docs')
        .update({
          contenido: serialized,
          categoria: 'Sistema',
          estado: 'Completado',
          updated_at: nowIso,
        })
        .eq('id', existing.id);
      return !error;
    }

    const { error } = await supabase.from('panel_docs').insert({
      titulo: DIST_CFG_DOC_TITLE,
      contenido: serialized,
      categoria: 'Sistema',
      estado: 'Completado',
      updated_at: nowIso,
    });
    return !error;
  } catch {
    return false;
  }
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.readAsDataURL(file);
  });
}

async function compressLargeImageIfNeeded(file: File): Promise<{ dataUrl: string; mimeType: string }> {
  const raw = await readFileAsDataUrl(file);
  if (file.size <= 3 * 1024 * 1024) {
    return { dataUrl: raw, mimeType: file.type || 'image/jpeg' };
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxDim = 1600;
      let w = img.width;
      let h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve({ dataUrl: raw, mimeType: file.type || 'image/jpeg' });
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      resolve({
        dataUrl: canvas.toDataURL('image/jpeg', 0.88),
        mimeType: 'image/jpeg',
      });
    };
    img.onerror = () => resolve({ dataUrl: raw, mimeType: file.type || 'image/jpeg' });
    img.src = raw;
  });
}

export async function uploadMediaToVault(file: File): Promise<{
  ok: boolean;
  publicUrl?: string;
  mediaType: 'imagen' | 'video';
  error?: string;
}> {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
  const mediaType: 'imagen' | 'video' = isVideo ? 'video' : 'imagen';

  // 1. Asegurar bucket en backend (usa service role)
  let ensureError = '';
  let apiReachable = false;
  try {
    const ensureResp = await fetch('/api/content-distribute?action=ensure_bucket', { method: 'POST' });
    const ct = ensureResp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      apiReachable = true;
      const ensureJson = await ensureResp.json().catch(() => ({}));
      if (!ensureResp.ok && ensureJson?.error) {
        ensureError = String(ensureJson.error);
      }
    }
  } catch {}

  // 2. Intentar subida directa a Supabase Storage (permite videos grandes > 4MB)
  let directError = '';
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `uploads/${Date.now()}-${safeName}`;
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
      contentType: file.type || undefined,
      upsert: true,
    });
    if (!upErr) {
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      if (pub?.publicUrl) {
        return { ok: true, publicUrl: pub.publicUrl, mediaType };
      }
    } else {
      directError = upErr.message || '';
    }
  } catch (err: any) {
    directError = err?.message || '';
  }

  // 3. Respaldo via servidor (si es imagen grande se optimiza para caber en <= 4MB)
  if (isVideo && file.size > 4 * 1024 * 1024) {
    return {
      ok: false,
      mediaType,
      error:
        ensureError ||
        (directError.toLowerCase().includes('bucket')
          ? 'No existe el bucket "content-vault" en Supabase Storage. Créalo en Supabase → Storage como público (Public = ON) o despliega en Vercel con SUPABASE_SERVICE_ROLE_KEY.'
          : 'Video > 4 MB y Storage directo bloqueado por políticas RLS. Habilita INSERT público en el bucket "content-vault" o pega la URL directa del MP4.'),
    };
  }

  try {
    const prepared = isVideo
      ? { dataUrl: await readFileAsDataUrl(file), mimeType: file.type || 'video/mp4' }
      : await compressLargeImageIfNeeded(file);

    const resp = await fetch('/api/content-distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upload_base64',
        fileName: file.name,
        mimeType: prepared.mimeType,
        base64Data: prepared.dataUrl,
      }),
    });

    const ct = resp.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return {
        ok: false,
        mediaType,
        error: !apiReachable
          ? 'El bucket "content-vault" aún no existe en Supabase Storage y este preview local no ejecuta /api/*. Créalo manualmente en Supabase → Storage (Public = ON) o prueba desde tu dominio en Vercel.'
          : ensureError || directError || 'Respuesta inválida del servidor al subir',
      };
    }

    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.publicUrl) {
      return { ok: true, publicUrl: data.publicUrl, mediaType };
    }
    return {
      ok: false,
      mediaType,
      error: data?.error || ensureError || directError || 'No se pudo subir el archivo',
    };
  } catch (err: any) {
    return { ok: false, mediaType, error: err?.message || directError || 'Error subiendo archivo' };
  }
}
