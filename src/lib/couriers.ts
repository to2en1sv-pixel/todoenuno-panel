import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type CourierTipo = 'motorista' | 'encomienda' | 'externo' | 'oficina';

export interface CourierItem {
  id: string;
  nombre: string;
  tipo: CourierTipo;
  zonas?: string;
  telefono?: string;
  pin?: string;
  activo: boolean;
}

export interface DriverAccessConfig {
  requirePin: boolean;
  adminPin: string;
}

export interface DriverPortalSession {
  role: 'courier' | 'admin';
  courierId?: string;
  courierName?: string;
  loggedInAt: number;
}

export const SYSTEM_COURIERS_DOC_TITLE = '__SYSTEM_COURIERS_V1__';
export const SYSTEM_DRIVER_ACCESS_DOC_TITLE = '__SYSTEM_DRIVER_ACCESS_V1__';
const LOCAL_COURIERS_KEY = 'todoenuno_couriers_v1';
const LOCAL_DRIVER_ACCESS_KEY = 'todoenuno_driver_access_v1';
const LOCAL_DRIVER_SESSION_KEY = 'todoenuno_driver_session_v1';
const COURIERS_UPDATED_EVENT = 'todoenuno:couriers-updated';
const DRIVER_SESSION_TTL_MS = 1000 * 60 * 60 * 24;

export const DEFAULT_DRIVER_ACCESS_CONFIG: DriverAccessConfig = {
  requirePin: true,
  adminPin: '2026',
};

export const DEFAULT_COURIERS: CourierItem[] = [
  {
    id: 'motorista-1',
    nombre: 'Motorista Central 1',
    tipo: 'motorista',
    zonas: 'San Salvador / AMSS',
    pin: '1001',
    activo: true,
  },
  {
    id: 'motorista-2',
    nombre: 'Motorista Central 2',
    tipo: 'motorista',
    zonas: 'Santa Tecla / La Libertad',
    pin: '1002',
    activo: true,
  },
  {
    id: 'cargo-expreso',
    nombre: 'Cargo Expreso El Salvador',
    tipo: 'externo',
    zonas: 'Todo el país',
    activo: true,
  },
  {
    id: 'urbano-express',
    nombre: 'Urbano Express',
    tipo: 'externo',
    zonas: 'Departamentos e interior',
    activo: true,
  },
  {
    id: 'c807-xpress',
    nombre: 'C807 Xpress',
    tipo: 'encomienda',
    zonas: 'Interior / Encomiendas',
    activo: true,
  },
  {
    id: 'retiro-oficina',
    nombre: 'Retiro en Oficina',
    tipo: 'oficina',
    zonas: 'Entrega en local / punto fijo',
    activo: true,
  },
];

function sanitizePin(raw: unknown): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 6);
}

function sanitizeCouriers(raw: unknown): CourierItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return DEFAULT_COURIERS.map((c) => ({ ...c }));
  }

  const seenNames = new Set<string>();
  const clean: CourierItem[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const nombre = String((item as any).nombre || '').trim();
    if (!nombre) continue;
    const lower = nombre.toLowerCase();
    if (seenNames.has(lower)) continue;
    seenNames.add(lower);

    const rawTipo = String((item as any).tipo || 'motorista');
    const tipo: CourierTipo =
      rawTipo === 'encomienda' || rawTipo === 'externo' || rawTipo === 'oficina'
        ? rawTipo
        : 'motorista';

    const id = String((item as any).id || `cour_${Date.now()}_${clean.length}`);
    const defaultPin =
      id === 'motorista-1' ? '1001' : id === 'motorista-2' ? '1002' : '';
    const pin = sanitizePin((item as any).pin) || defaultPin;

    clean.push({
      id,
      nombre,
      tipo,
      zonas: String((item as any).zonas || '').trim(),
      telefono: String((item as any).telefono || '').trim(),
      pin,
      activo: (item as any).activo !== false,
    });
  }

  return clean.length > 0 ? clean : DEFAULT_COURIERS.map((c) => ({ ...c }));
}

export function getCachedCouriers(): CourierItem[] {
  try {
    const raw = localStorage.getItem(LOCAL_COURIERS_KEY);
    if (raw) {
      return sanitizeCouriers(JSON.parse(raw));
    }
  } catch {}
  return DEFAULT_COURIERS.map((c) => ({ ...c }));
}

function writeLocalCouriers(couriers: CourierItem[]) {
  try {
    localStorage.setItem(LOCAL_COURIERS_KEY, JSON.stringify(couriers));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(COURIERS_UPDATED_EVENT, { detail: couriers }));
    }
  } catch {}
}

export async function fetchCouriers(): Promise<{
  couriers: CourierItem[];
  source: 'supabase' | 'local';
}> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('contenido')
      .eq('titulo', SYSTEM_COURIERS_DOC_TITLE)
      .maybeSingle();

    if (!error && data?.contenido) {
      const clean = sanitizeCouriers(JSON.parse(data.contenido));
      try {
        localStorage.setItem(LOCAL_COURIERS_KEY, JSON.stringify(clean));
      } catch {}
      return { couriers: clean, source: 'supabase' };
    }
  } catch {}

  return { couriers: getCachedCouriers(), source: 'local' };
}

export async function saveCouriers(
  couriers: CourierItem[]
): Promise<{
  ok: boolean;
  couriers: CourierItem[];
  source: 'supabase' | 'local';
  error?: string;
}> {
  const clean = sanitizeCouriers(couriers);
  writeLocalCouriers(clean);

  try {
    const serialized = JSON.stringify(clean);
    const { data: existing, error: selErr } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', SYSTEM_COURIERS_DOC_TITLE)
      .maybeSingle();

    if (selErr) {
      return { ok: true, couriers: clean, source: 'local', error: selErr.message };
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
        return { ok: true, couriers: clean, source: 'local', error: updErr.message };
      }
      return { ok: true, couriers: clean, source: 'supabase' };
    }

    const { error: insErr } = await supabase.from('panel_docs').insert({
      titulo: SYSTEM_COURIERS_DOC_TITLE,
      contenido: serialized,
      categoria: 'Sistema',
      estado: 'Completado',
      updated_at: new Date().toISOString(),
    });

    if (insErr) {
      return { ok: true, couriers: clean, source: 'local', error: insErr.message };
    }
    return { ok: true, couriers: clean, source: 'supabase' };
  } catch (err: any) {
    return { ok: true, couriers: clean, source: 'local', error: err?.message };
  }
}

export function getCachedDriverAccessConfig(): DriverAccessConfig {
  try {
    const raw = localStorage.getItem(LOCAL_DRIVER_ACCESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        requirePin: parsed?.requirePin !== false,
        adminPin: sanitizePin(parsed?.adminPin) || DEFAULT_DRIVER_ACCESS_CONFIG.adminPin,
      };
    }
  } catch {}
  return { ...DEFAULT_DRIVER_ACCESS_CONFIG };
}

export async function fetchDriverAccessConfig(): Promise<DriverAccessConfig> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('contenido')
      .eq('titulo', SYSTEM_DRIVER_ACCESS_DOC_TITLE)
      .maybeSingle();

    if (!error && data?.contenido) {
      const parsed = JSON.parse(data.contenido);
      const clean: DriverAccessConfig = {
        requirePin: parsed?.requirePin !== false,
        adminPin: sanitizePin(parsed?.adminPin) || DEFAULT_DRIVER_ACCESS_CONFIG.adminPin,
      };
      try {
        localStorage.setItem(LOCAL_DRIVER_ACCESS_KEY, JSON.stringify(clean));
      } catch {}
      return clean;
    }
  } catch {}
  return getCachedDriverAccessConfig();
}

export async function saveDriverAccessConfig(
  cfg: DriverAccessConfig
): Promise<{ ok: boolean; config: DriverAccessConfig }> {
  const clean: DriverAccessConfig = {
    requirePin: cfg.requirePin !== false,
    adminPin: sanitizePin(cfg.adminPin) || DEFAULT_DRIVER_ACCESS_CONFIG.adminPin,
  };
  try {
    localStorage.setItem(LOCAL_DRIVER_ACCESS_KEY, JSON.stringify(clean));
  } catch {}

  try {
    const serialized = JSON.stringify(clean);
    const { data: existing } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', SYSTEM_DRIVER_ACCESS_DOC_TITLE)
      .maybeSingle();

    if (existing?.id) {
      await supabase
        .from('panel_docs')
        .update({
          contenido: serialized,
          categoria: 'Sistema',
          estado: 'Completado',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);
    } else {
      await supabase.from('panel_docs').insert({
        titulo: SYSTEM_DRIVER_ACCESS_DOC_TITLE,
        contenido: serialized,
        categoria: 'Sistema',
        estado: 'Completado',
        updated_at: new Date().toISOString(),
      });
    }
    return { ok: true, config: clean };
  } catch {
    return { ok: false, config: clean };
  }
}

export function getDriverSession(): DriverPortalSession | null {
  try {
    const raw = localStorage.getItem(LOCAL_DRIVER_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DriverPortalSession;
    if (!parsed || (parsed.role !== 'courier' && parsed.role !== 'admin')) return null;
    if (Date.now() - Number(parsed.loggedInAt || 0) > DRIVER_SESSION_TTL_MS) {
      localStorage.removeItem(LOCAL_DRIVER_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setDriverSession(session: DriverPortalSession) {
  try {
    localStorage.setItem(LOCAL_DRIVER_SESSION_KEY, JSON.stringify(session));
  } catch {}
}

export function clearDriverSession() {
  try {
    localStorage.removeItem(LOCAL_DRIVER_SESSION_KEY);
  } catch {}
}

export function getActiveCourierNames(couriers: CourierItem[]): string[] {
  const active = couriers.filter((c) => c.activo !== false).map((c) => c.nombre);
  return active.length > 0 ? active : DEFAULT_COURIERS.map((c) => c.nombre);
}

export function useCouriers() {
  const [couriers, setCouriers] = useState<CourierItem[]>(() => getCachedCouriers());

  useEffect(() => {
    let active = true;
    fetchCouriers().then(({ couriers: loaded }) => {
      if (active) setCouriers(loaded);
    });

    const onUpdated = (e: Event) => {
      const custom = e as CustomEvent<CourierItem[]>;
      if (Array.isArray(custom.detail)) {
        setCouriers(custom.detail);
      } else {
        setCouriers(getCachedCouriers());
      }
    };

    window.addEventListener(COURIERS_UPDATED_EVENT, onUpdated);
    return () => {
      active = false;
      window.removeEventListener(COURIERS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  const activeNames = getActiveCourierNames(couriers);

  return { couriers, activeNames, setCouriers };
}
