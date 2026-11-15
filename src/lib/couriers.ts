import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export type CourierTipo = 'motorista' | 'encomienda' | 'externo' | 'oficina';

export interface CourierItem {
  id: string;
  nombre: string;
  tipo: CourierTipo;
  zonas?: string;
  telefono?: string;
  activo: boolean;
}

export const SYSTEM_COURIERS_DOC_TITLE = '__SYSTEM_COURIERS_V1__';
const LOCAL_COURIERS_KEY = 'todoenuno_couriers_v1';
const COURIERS_UPDATED_EVENT = 'todoenuno:couriers-updated';

export const DEFAULT_COURIERS: CourierItem[] = [
  {
    id: 'motorista-1',
    nombre: 'Motorista Central 1',
    tipo: 'motorista',
    zonas: 'San Salvador / AMSS',
    activo: true,
  },
  {
    id: 'motorista-2',
    nombre: 'Motorista Central 2',
    tipo: 'motorista',
    zonas: 'Santa Tecla / La Libertad',
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

    clean.push({
      id: String((item as any).id || `cour_${Date.now()}_${clean.length}`),
      nombre,
      tipo,
      zonas: String((item as any).zonas || '').trim(),
      telefono: String((item as any).telefono || '').trim(),
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
