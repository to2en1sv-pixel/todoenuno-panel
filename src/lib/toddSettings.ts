import { supabase } from '@/lib/supabase';

export interface ToddCatalogSettings {
  allowBackorderGlobal: boolean;
  backorderSkus: string[];
  hideExactStockCounts: boolean;
}

export const SYSTEM_TODD_SETTINGS_DOC_TITLE = '__SYSTEM_TODD_CATALOG_SETTINGS_V1__';
const LOCAL_TODD_SETTINGS_KEY = 'todoenuno_todd_catalog_settings_v1';

export const DEFAULT_TODD_SETTINGS: ToddCatalogSettings = {
  allowBackorderGlobal: false,
  backorderSkus: [],
  hideExactStockCounts: true,
};

function normalizeSettings(raw: any): ToddCatalogSettings {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TODD_SETTINGS };
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

  return {
    allowBackorderGlobal: Boolean(raw.allowBackorderGlobal),
    backorderSkus: skus as string[],
    hideExactStockCounts: raw.hideExactStockCounts !== false,
  };
}

export function getCachedToddCatalogSettings(): ToddCatalogSettings {
  try {
    const raw = localStorage.getItem(LOCAL_TODD_SETTINGS_KEY);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch {}
  return { ...DEFAULT_TODD_SETTINGS };
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
