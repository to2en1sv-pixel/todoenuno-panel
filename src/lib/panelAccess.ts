import { supabase } from '@/lib/supabase';

export interface PanelAccessConfig {
  requirePin: boolean;
  pin: string;
}

export const SYSTEM_PANEL_ACCESS_DOC_TITLE = '__SYSTEM_PANEL_ACCESS_V1__';
const LOCAL_CONFIG_KEY = 'nexo_panel_access_cfg_v1';
const LOCAL_UNLOCK_KEY = 'nexo_panel_unlocked_until_v1';
const SESSION_UNLOCK_KEY = 'nexo_panel_session_unlocked_v1';
const REMEMBER_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

export const DEFAULT_PANEL_ACCESS_CONFIG: PanelAccessConfig = {
  requirePin: true,
  pin: '2026',
};

export function sanitizePanelPin(raw: unknown): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 8);
}

export function getEnvOverridePin(): string {
  const raw = (import.meta as any).env?.VITE_PANEL_PIN;
  const clean = sanitizePanelPin(raw);
  return clean.length >= 4 ? clean : '';
}

export function getCachedPanelAccessConfig(): PanelAccessConfig {
  const envPin = getEnvOverridePin();
  try {
    const raw = localStorage.getItem(LOCAL_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const pin = sanitizePanelPin(parsed?.pin) || DEFAULT_PANEL_ACCESS_CONFIG.pin;
      return {
        requirePin: envPin ? true : parsed?.requirePin !== false,
        pin: envPin || pin,
      };
    }
  } catch {
    // ignore storage errors
  }
  return {
    requirePin: true,
    pin: envPin || DEFAULT_PANEL_ACCESS_CONFIG.pin,
  };
}

function cachePanelAccessConfig(config: PanelAccessConfig): void {
  try {
    localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(config));
  } catch {
    // ignore storage errors
  }
}

export async function fetchPanelAccessConfig(): Promise<PanelAccessConfig> {
  const fallback = getCachedPanelAccessConfig();
  const envPin = getEnvOverridePin();
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('id, contenido, updated_at')
      .eq('titulo', SYSTEM_PANEL_ACCESS_DOC_TITLE)
      .order('updated_at', { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data.length > 0 && data[0]?.contenido) {
      const parsed = JSON.parse(String(data[0].contenido));
      const cleanPin = sanitizePanelPin(parsed?.pin) || DEFAULT_PANEL_ACCESS_CONFIG.pin;
      const cfg: PanelAccessConfig = {
        requirePin: envPin ? true : parsed?.requirePin !== false,
        pin: envPin || cleanPin,
      };
      cachePanelAccessConfig(cfg);
      return cfg;
    }
  } catch {
    // fallback silently
  }
  return fallback;
}

export async function savePanelAccessConfig(
  next: PanelAccessConfig
): Promise<{ config: PanelAccessConfig; savedToCloud: boolean }> {
  const cleanPin = sanitizePanelPin(next.pin);
  const normalized: PanelAccessConfig = {
    requirePin: Boolean(next.requirePin),
    pin: cleanPin.length >= 4 ? cleanPin : DEFAULT_PANEL_ACCESS_CONFIG.pin,
  };
  cachePanelAccessConfig(normalized);

  try {
    const payload = JSON.stringify(normalized);
    const { data: existing } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', SYSTEM_PANEL_ACCESS_DOC_TITLE)
      .limit(1);

    if (Array.isArray(existing) && existing.length > 0 && existing[0]?.id) {
      const { error } = await supabase
        .from('panel_docs')
        .update({ contenido: payload, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id);
      return { config: normalized, savedToCloud: !error };
    }

    const { error } = await supabase.from('panel_docs').insert({
      titulo: SYSTEM_PANEL_ACCESS_DOC_TITLE,
      categoria: 'Sistema',
      contenido: payload,
    });
    return { config: normalized, savedToCloud: !error };
  } catch {
    return { config: normalized, savedToCloud: false };
  }
}

export function isPanelSessionUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.sessionStorage.getItem(SESSION_UNLOCK_KEY) === '1') {
      return true;
    }
    const untilRaw = window.localStorage.getItem(LOCAL_UNLOCK_KEY);
    if (untilRaw) {
      const until = Number(untilRaw);
      if (Number.isFinite(until) && until > Date.now()) {
        return true;
      }
      window.localStorage.removeItem(LOCAL_UNLOCK_KEY);
    }
  } catch {
    // ignore storage errors
  }
  return false;
}

export function unlockPanelSession(rememberDevice: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_UNLOCK_KEY, '1');
    if (rememberDevice) {
      window.localStorage.setItem(LOCAL_UNLOCK_KEY, String(Date.now() + REMEMBER_TTL_MS));
    } else {
      window.localStorage.removeItem(LOCAL_UNLOCK_KEY);
    }
  } catch {
    // ignore
  }
}

export function lockPanelSession(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(SESSION_UNLOCK_KEY);
    window.localStorage.removeItem(LOCAL_UNLOCK_KEY);
  } catch {
    // ignore
  }
}

export function verifyPanelPin(input: string, config: PanelAccessConfig): boolean {
  const cleanInput = sanitizePanelPin(input);
  const expected = getEnvOverridePin() || sanitizePanelPin(config.pin) || DEFAULT_PANEL_ACCESS_CONFIG.pin;
  return cleanInput.length >= 4 && cleanInput === expected;
}
