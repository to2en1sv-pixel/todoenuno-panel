import { supabase } from '@/lib/supabase';

export interface ToddCatalogSettings {
  allowBackorderGlobal: boolean;
  backorderSkus: string[];
  hideExactStockCounts: boolean;
  productVideos: Record<string, string>;
}

export interface ToddCourierRule {
  id: string;
  name: string;
  zones: string;
  active: boolean;
}

export interface ToddBusinessSettings {
  deliverySanSalvador: string;
  deliveryDepartments: string;
  cutoffTimeNote: string;
  shippingCostNote: string;
  humanSupportHours: string;
  couriers: ToddCourierRule[];
  holidayModeEnabled: boolean;
  holidayStartDate: string;
  holidayEndDate: string;
  holidayMessage: string;
  paymentMethodsNote: string;
  bankTransferInfo: string;
  warrantyNote: string;
  extraRules: string;
}

export const SYSTEM_TODD_SETTINGS_DOC_TITLE = '__SYSTEM_TODD_CATALOG_SETTINGS_V1__';
const LOCAL_TODD_SETTINGS_KEY = 'todoenuno_todd_catalog_settings_v1';

export const SYSTEM_TODD_BUSINESS_DOC_TITLE = '__SYSTEM_TODD_BUSINESS_SETTINGS_V1__';
const LOCAL_TODD_BUSINESS_KEY = 'todoenuno_todd_business_settings_v1';

export const DEFAULT_TODD_SETTINGS: ToddCatalogSettings = {
  allowBackorderGlobal: false,
  backorderSkus: [],
  hideExactStockCounts: true,
  productVideos: {},
};

export const DEFAULT_TODD_BUSINESS_SETTINGS: ToddBusinessSettings = {
  deliverySanSalvador: 'Mismo día o siguiente día hábil',
  deliveryDepartments: '24 a 48 horas hábiles',
  cutoffTimeNote: 'Pedidos confirmados antes de las 2:00 p. m. salen a ruta el mismo día (lunes a sábado).',
  shippingCostNote: 'Envío disponible a todo El Salvador (confirmar cobertura exacta según municipio).',
  humanSupportHours: 'Lunes a sábado de 8:00 a. m. a 6:00 p. m.',
  couriers: [
    {
      id: 'courier-local',
      name: 'Motorista propio',
      zones: 'San Salvador, Santa Tecla, Antiguo Cuscatlán, Soyapango y AMSS',
      active: true,
    },
    {
      id: 'courier-depto',
      name: 'Courier departamental / Encomienda',
      zones: 'Santa Ana, San Miguel, Sonsonate, La Libertad, Usulután y resto del país',
      active: true,
    },
  ],
  holidayModeEnabled: false,
  holidayStartDate: '',
  holidayEndDate: '',
  holidayMessage: '',
  paymentMethodsNote: 'Contra entrega en efectivo al recibir o transferencia bancaria.',
  bankTransferInfo: '',
  warrantyNote: '7 días de garantía por defectos de fábrica.',
  extraRules: '',
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

export function cleanYouTubeUrl(rawUrl?: string | null): string {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';
  const id = extractYouTubeVideoId(raw);
  if (!id) return raw;
  if (/youtube\.com\/shorts\//i.test(raw)) {
    return `https://youtube.com/shorts/${id}`;
  }
  return `https://youtu.be/${id}`;
}

export function getYouTubeThumbnailUrl(rawUrl?: string | null): string | null {
  const id = extractYouTubeVideoId(rawUrl);
  return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
}

export function buildHowToVideoMessage(productName: string, videoUrl: string): string {
  const cleanName = String(productName || 'este producto').trim();
  const cleanLink = cleanYouTubeUrl(videoUrl);
  return `🎥 Mira cómo se usa *${cleanName}* paso a paso:\n${cleanLink}`;
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
      const urlVal = cleanYouTubeUrl(String(v || ''));
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

export function normalizeBusinessSettings(raw: any): ToddBusinessSettings {
  if (!raw || typeof raw !== 'object') {
    return {
      ...DEFAULT_TODD_BUSINESS_SETTINGS,
      couriers: DEFAULT_TODD_BUSINESS_SETTINGS.couriers.map(c => ({ ...c })),
    };
  }

  const couriers: ToddCourierRule[] = Array.isArray(raw.couriers)
    ? raw.couriers
        .map((c: any, idx: number) => ({
          id: String(c?.id || `courier-${idx + 1}`),
          name: String(c?.name || '').trim(),
          zones: String(c?.zones || '').trim(),
          active: c?.active !== false,
        }))
        .filter((c: ToddCourierRule) => c.name.length > 0)
    : DEFAULT_TODD_BUSINESS_SETTINGS.couriers.map(c => ({ ...c }));

  return {
    deliverySanSalvador:
      String(raw.deliverySanSalvador ?? DEFAULT_TODD_BUSINESS_SETTINGS.deliverySanSalvador).trim(),
    deliveryDepartments:
      String(raw.deliveryDepartments ?? DEFAULT_TODD_BUSINESS_SETTINGS.deliveryDepartments).trim(),
    cutoffTimeNote:
      String(raw.cutoffTimeNote ?? DEFAULT_TODD_BUSINESS_SETTINGS.cutoffTimeNote).trim(),
    shippingCostNote:
      String(raw.shippingCostNote ?? DEFAULT_TODD_BUSINESS_SETTINGS.shippingCostNote).trim(),
    humanSupportHours:
      String(raw.humanSupportHours ?? DEFAULT_TODD_BUSINESS_SETTINGS.humanSupportHours).trim(),
    couriers,
    holidayModeEnabled: Boolean(raw.holidayModeEnabled),
    holidayStartDate: String(raw.holidayStartDate || '').trim().slice(0, 10),
    holidayEndDate: String(raw.holidayEndDate || '').trim().slice(0, 10),
    holidayMessage: String(raw.holidayMessage || '').trim(),
    paymentMethodsNote:
      String(raw.paymentMethodsNote ?? DEFAULT_TODD_BUSINESS_SETTINGS.paymentMethodsNote).trim(),
    bankTransferInfo: String(raw.bankTransferInfo || '').trim(),
    warrantyNote:
      String(raw.warrantyNote ?? DEFAULT_TODD_BUSINESS_SETTINGS.warrantyNote).trim(),
    extraRules: String(raw.extraRules || '').trim(),
  };
}

export function getSalvadorTodayISO(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/El_Salvador',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export function isHolidayCurrentlyActive(
  cfg: ToddBusinessSettings,
  todayIso: string = getSalvadorTodayISO()
): boolean {
  if (!cfg.holidayModeEnabled || !cfg.holidayMessage.trim()) return false;
  if (cfg.holidayStartDate && todayIso < cfg.holidayStartDate) return false;
  if (cfg.holidayEndDate && todayIso > cfg.holidayEndDate) return false;
  return true;
}

export function buildBusinessRulesPromptBlock(
  cfg: ToddBusinessSettings,
  todayIso: string = getSalvadorTodayISO()
): string {
  const lines: string[] = [];

  if (isHolidayCurrentlyActive(cfg, todayIso)) {
    const range =
      cfg.holidayStartDate || cfg.holidayEndDate
        ? ` (vigente ${cfg.holidayStartDate || '...'} al ${cfg.holidayEndDate || '...'})`
        : '';
    lines.push(`- AVISO TEMPORAL / DÍA FESTIVO ACTIVO${range}: ${cfg.holidayMessage.trim()}`);
  }

  if (cfg.deliverySanSalvador) {
    lines.push(`- Tiempos en San Salvador / AMSS: ${cfg.deliverySanSalvador}`);
  }
  if (cfg.deliveryDepartments) {
    lines.push(`- Tiempos en Departamentos: ${cfg.deliveryDepartments}`);
  }
  if (cfg.cutoffTimeNote) {
    lines.push(`- Hora de corte / despachos: ${cfg.cutoffTimeNote}`);
  }
  if (cfg.shippingCostNote) {
    lines.push(`- Costo / cobertura de envío: ${cfg.shippingCostNote}`);
  }

  const activeCouriers = cfg.couriers.filter(c => c.active && c.name.trim());
  if (activeCouriers.length > 0) {
    lines.push(
      `- Empresas de envío activas: ${activeCouriers
        .map(c => (c.zones ? `${c.name} (${c.zones})` : c.name))
        .join(' | ')}`
    );
  }

  if (cfg.humanSupportHours) {
    lines.push(`- Horario de atención humana: ${cfg.humanSupportHours}`);
  }
  if (cfg.paymentMethodsNote) {
    lines.push(`- Métodos de pago: ${cfg.paymentMethodsNote}`);
  }
  if (cfg.bankTransferInfo) {
    lines.push(`- Datos para transferencia: ${cfg.bankTransferInfo}`);
  }
  if (cfg.warrantyNote) {
    lines.push(`- Garantía y cambios: ${cfg.warrantyNote}`);
  }
  if (cfg.extraRules) {
    lines.push(`- Reglas adicionales del negocio: ${cfg.extraRules}`);
  }

  return lines.join('\n');
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

export function getCachedToddBusinessSettings(): ToddBusinessSettings {
  try {
    const raw = localStorage.getItem(LOCAL_TODD_BUSINESS_KEY);
    if (raw) return normalizeBusinessSettings(JSON.parse(raw));
  } catch {}
  return normalizeBusinessSettings(null);
}

function writeLocalToddBusinessSettings(settings: ToddBusinessSettings) {
  try {
    localStorage.setItem(LOCAL_TODD_BUSINESS_KEY, JSON.stringify(settings));
  } catch {}
}

export async function fetchToddBusinessSettings(): Promise<{
  settings: ToddBusinessSettings;
  source: 'supabase' | 'local';
}> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('id,contenido')
      .eq('titulo', SYSTEM_TODD_BUSINESS_DOC_TITLE)
      .maybeSingle();

    if (!error && data?.contenido) {
      const normalized = normalizeBusinessSettings(JSON.parse(data.contenido));
      writeLocalToddBusinessSettings(normalized);
      return { settings: normalized, source: 'supabase' };
    }
  } catch {}

  return {
    settings: getCachedToddBusinessSettings(),
    source: 'local',
  };
}

export async function saveToddBusinessSettings(
  next: ToddBusinessSettings
): Promise<{
  ok: boolean;
  settings: ToddBusinessSettings;
  source: 'supabase' | 'local';
  error?: string;
}> {
  const clean = normalizeBusinessSettings(next);
  writeLocalToddBusinessSettings(clean);

  try {
    const serialized = JSON.stringify(clean);
    const { data: existing, error: selErr } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', SYSTEM_TODD_BUSINESS_DOC_TITLE)
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
      titulo: SYSTEM_TODD_BUSINESS_DOC_TITLE,
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
