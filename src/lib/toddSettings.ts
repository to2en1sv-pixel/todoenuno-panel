import { supabase } from '@/lib/supabase';

export interface ToddCatalogSettings {
  allowBackorderGlobal: boolean;
  backorderSkus: string[];
  hideExactStockCounts: boolean;
  productVideos: Record<string, string>;
}

export const SYSTEM_TODD_SETTINGS_DOC_TITLE = '__SYSTEM_TODD_CATALOG_SETTINGS_V1__';
const LOCAL_TODD_SETTINGS_KEY = 'todoenuno_todd_catalog_settings_v1';

export const DEFAULT_TODD_SETTINGS: ToddCatalogSettings = {
  allowBackorderGlobal: false,
  backorderSkus: [],
  hideExactStockCounts: true,
  productVideos: {},
};

export function extractYouTubeVideoId(rawUrl?: string | null): string | null {
  const raw = String(rawUrl || '').trim();
  if (!raw) return null;
  const patterns = [
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/live\/)([A-Za-z0-9_-]{11})/i,
    /[?&]v=([A-Za-z0-9_-]{11})/i,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

export function getYouTubeThumbnailUrl(rawUrl?: string | null): string | null {
  const id = extractYouTubeVideoId(rawUrl);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

export function buildHowToVideoMessage(productName: string, videoUrl: string): string {
  const cleanName = String(productName || 'este producto').trim();
  return `🎥 Mira cómo se usa *${cleanName}* paso a paso:\n${videoUrl.trim()}`;
}

function normalizeSettings(raw: any): ToddCatalogSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TODD_SETTINGS, productVideos: {} };
  }
  const skus = Array.isArray(raw.backorderSkus)
    ? Array.from(
        new Set(
          raw.backorderSkus
            .map((s: any) => String(s || '').trim().toUpperCase())
            .filter(Boolean)
        )
      )
    : [];

  const productVideos: Record<string, string> = {};
  if (raw.productVideos && typeof raw.productVideos === 'object') {
    for (const [k, v] of Object.entries(raw.productVideos)) {
      const skuKey = String(k || '').trim().toUpperCase();
      const urlVal = String(v || '').trim();
      if (skuKey && urlVal) {
        productVideos[skuKey] = urlVal;
      }
    }
  }

  return {
    allowBackorderGlobal: Boolean(raw.allowBackorderGlobal),
    backorderSkus: skus as string[],
    hideExactStockCounts: raw.hideExactStockCounts !== false,
    productVideos,
  };
}

export function getCachedToddCatalogSettings(): ToddCatalogSettings {
  try {
    const raw = localStorage.getItem(LOCAL_TODD_SETTINGS_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {}
  return { ...DEFAULT_TODD_SETTINGS, productVideos: {} };
}

function writeLocalToddSettings(settings: ToddCatalogSettings) {
  try {
    localStorage.setItem(LOCAL_TODD_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export async function fetchToddCatalogSettings(): Promise<{
  settings: ToddCatalogSettings;
  source: 'supabase' | 'local';
}> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('id,contenido')
      .eq('titulo', SYSTEM_TODD_SETTINGS_DOC_TITLE)
      .maybeSingle();

    if (!error && data?.contenido) {
      const normalized = normalizeSettings(JSON.parse(data.contenido));
      writeLocalToddSettings(normalized);
      return { settings: normalized, source: 'supabase' };
    }
  } catch {}

  return {
    settings: getCachedToddCatalogSettings(),
    source: 'local',
  };
}

export async function saveToddCatalogSettings(
  next: ToddCatalogSettings
): Promise<{
  ok: boolean;
  settings: ToddCatalogSettings;
  source: 'supabase' | 'local';
  error?: string;
}> {
  const clean = normalizeSettings(next);
  writeLocalToddSettings(clean);

  try {
    const serialized = JSON.stringify(clean);
    const { data: existing, error: selErr } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', SYSTEM_TODD_SETTINGS_DOC_TITLE)
      .maybeSingle();

    if (selErr) {
      return { ok: true, settings: clean, source: 'local', error: selErr.message };
    }

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from('panel_docs')
        .update({
          contenido: serialized,
          categoria: 'Sistema',
          estado: 'Completado',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updErr) {
        return { ok: true, settings: clean, source: 'local', error: updErr.message };
      }
      return { ok: true, settings: clean, source: 'supabase' };
    }

    const { error: insErr } = await supabase.from('panel_docs').insert({
      titulo: SYSTEM_TODD_SETTINGS_DOC_TITLE,
      contenido: serialized,
      categoria: 'Sistema',
      estado: 'Completado',
      updated_at: new Date().toISOString(),
    });

    if (insErr) {
      return { ok: true, settings: clean, source: 'local', error: insErr.message };
    }
    return { ok: true, settings: clean, source: 'supabase' };
  } catch (err: any) {
    return { ok: true, settings: clean, source: 'local', error: err?.message };
  }
}
