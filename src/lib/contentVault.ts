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
  targets: ContentTargets;
  copies: ContentCopies;
  publishResults?: ContentPublishResults;
  legacyQueueId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SocialDistConfig {
  defaultPageId: string;
  igAccountIdOverride: string;
  autoSkipOutOfStock: boolean;
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
  defaultTargets: {
    facebook: true,
    instagram: true,
    youtube: false,
    tiktok: false,
  },
  n8nWorkerWebhookUrl: '',
};

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
    if (raw) return { ...DEFAULT_DIST_CONFIG, ...JSON.parse(raw) };
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

export async function uploadMediaToVault(file: File): Promise<{
  ok: boolean;
  publicUrl?: string;
  mediaType: 'imagen' | 'video';
  error?: string;
}> {
  const isVideo = file.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(file.name);
  const mediaType: 'imagen' | 'video' = isVideo ? 'video' : 'imagen';

  // 1. Asegurar bucket en backend (usa service role)
  try {
    await fetch('/api/content-distribute?action=ensure_bucket', { method: 'POST' });
  } catch {}

  // 2. Intentar subida directa a Supabase Storage (permite videos grandes > 4MB)
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
    }
  } catch {}

  // 3. Respaldo via servidor (para archivos <= 4 MB si RLS bloquea subida anon desde navegador)
  if (file.size > 4 * 1024 * 1024) {
    return {
      ok: false,
      mediaType,
      error:
        'Archivo > 4 MB y Storage público bloqueado por políticas RLS. Sube el video a tu Storage/Drive o habilita INSERT público en el bucket "content-vault" y pega la URL directa.',
    };
  }

  try {
    const base64Data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
      reader.readAsDataURL(file);
    });

    const resp = await fetch('/api/content-distribute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upload_base64',
        fileName: file.name,
        mimeType: file.type,
        base64Data,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (resp.ok && data?.publicUrl) {
      return { ok: true, publicUrl: data.publicUrl, mediaType };
    }
    return { ok: false, mediaType, error: data?.error || 'No se pudo subir el archivo' };
  } catch (err: any) {
    return { ok: false, mediaType, error: err?.message || 'Error subiendo archivo' };
  }
}
