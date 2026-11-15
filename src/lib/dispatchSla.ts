import { supabase } from '@/lib/supabase';

export interface DispatchSlaSettings {
  bodegaHours: number;
  rutaHours: number;
}

export const DEFAULT_DISPATCH_SLA: DispatchSlaSettings = {
  bodegaHours: 24,
  rutaHours: 36,
};

const STORAGE_KEY = 'todoenuno_dispatch_sla_settings_v1';
const DOC_TITLE = '__SYSTEM_DISPATCH_SLA_SETTINGS_V1__';

export function getCachedDispatchSlaSettings(): DispatchSlaSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        bodegaHours: Math.max(4, Math.min(168, Number(parsed?.bodegaHours) || 24)),
        rutaHours: Math.max(6, Math.min(240, Number(parsed?.rutaHours) || 36)),
      };
    }
  } catch {}
  return { ...DEFAULT_DISPATCH_SLA };
}

export async function fetchDispatchSlaSettings(): Promise<DispatchSlaSettings> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('contenido')
      .eq('titulo', DOC_TITLE)
      .maybeSingle();
    if (!error && data?.contenido) {
      const parsed = JSON.parse(data.contenido);
      const merged: DispatchSlaSettings = {
        bodegaHours: Math.max(4, Math.min(168, Number(parsed?.bodegaHours) || 24)),
        rutaHours: Math.max(6, Math.min(240, Number(parsed?.rutaHours) || 36)),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    }
  } catch {}
  return getCachedDispatchSlaSettings();
}

export async function saveDispatchSlaSettings(settings: DispatchSlaSettings): Promise<DispatchSlaSettings> {
  const clean: DispatchSlaSettings = {
    bodegaHours: Math.max(4, Math.min(168, Math.round(Number(settings.bodegaHours) || 24))),
    rutaHours: Math.max(6, Math.min(240, Math.round(Number(settings.rutaHours) || 36))),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch {}

  try {
    const serialized = JSON.stringify(clean);
    const { data: existing } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', DOC_TITLE)
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
        titulo: DOC_TITLE,
        contenido: serialized,
        categoria: 'Sistema',
        estado: 'Completado',
        updated_at: new Date().toISOString(),
      });
    }
  } catch {}

  return clean;
}

export type SlaSeverity = 'ok' | 'warning' | 'delayed' | 'scheduled_future' | 'finalizado';

export interface OrderSlaEvaluation {
  severity: SlaSeverity;
  stageGroup: 'bodega' | 'ruta' | 'programado' | 'finalizado';
  elapsedHours: number;
  limitHours: number;
  remainingHours: number;
  overdueHours: number;
  durationLabel: string;
  reasonLabel: string;
  yaNotificado: boolean;
  reprogramadoPara: string | null;
  avisoEnviadoFecha: string | null;
}

export function getSvTodayIso(nowMs = Date.now()): string {
  // El Salvador UTC-6 todo el año
  return new Date(nowMs - 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function getSvOffsetIso(daysFromToday: number, nowMs = Date.now()): string {
  return new Date(nowMs - 6 * 60 * 60 * 1000 + daysFromToday * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export function formatDurationCompact(hours: number): string {
  const safe = Math.max(0, Math.floor(hours));
  if (safe < 24) return `${safe}h`;
  const days = Math.floor(safe / 24);
  const rem = safe % 24;
  return rem > 0 ? `${days}d ${rem}h` : `${days}d`;
}

export function parseRescheduleNote(notas?: string | null): {
  avisoEnviadoFecha: string | null;
  reprogramadoPara: string | null;
} {
  const txt = String(notas || '');
  // Formato guardado por el modal: [Aviso demora enviado 2026-11-15 -> Reprogramado 2026-11-17]
  const matches = Array.from(
    txt.matchAll(/\[Aviso demora enviado (\d{4}-\d{2}-\d{2})\s*->\s*Reprogramado (\d{4}-\d{2}-\d{2})\]/gi)
  );
  if (matches.length > 0) {
    const last = matches[matches.length - 1];
    return {
      avisoEnviadoFecha: last[1],
      reprogramadoPara: last[2],
    };
  }
  return {
    avisoEnviadoFecha: null,
    reprogramadoPara: null,
  };
}

export function evaluateOrderSla(
  pedido: {
    estado?: string | null;
    es_encargo?: boolean | null;
    fecha_programada?: string | null;
    notas?: string | null;
    created_at?: string | null;
  },
  settings: DispatchSlaSettings,
  nowMs = Date.now()
): OrderSlaEvaluation {
  const estado = String(pedido.estado || 'nuevo').toLowerCase();
  const svToday = getSvTodayIso(nowMs);
  const { avisoEnviadoFecha, reprogramadoPara } = parseRescheduleNote(pedido.notas);

  if (estado === 'entregado' || estado === 'cancelado') {
    return {
      severity: 'finalizado',
      stageGroup: 'finalizado',
      elapsedHours: 0,
      limitHours: settings.bodegaHours,
      remainingHours: 0,
      overdueHours: 0,
      durationLabel: '—',
      reasonLabel: estado === 'entregado' ? 'Entregado' : 'Cancelado',
      yaNotificado: Boolean(avisoEnviadoFecha),
      reprogramadoPara,
      avisoEnviadoFecha,
    };
  }

  const createdMs = pedido.created_at ? new Date(pedido.created_at).getTime() : nowMs;
  const baseMs = Number.isNaN(createdMs) ? nowMs : createdMs;
  const elapsedFromCreated = Math.max(0, (nowMs - baseMs) / (1000 * 60 * 60));

  const fechaProgClean = pedido.fecha_programada ? String(pedido.fecha_programada).slice(0, 10) : null;
  const esEncargoFuturo =
    estado === 'programado' ||
    (Boolean(pedido.es_encargo) && estado !== 'en_camino' && estado !== 'por_empacar');

  // Si es encargo futuro con fecha hoy o posterior, no cuenta como atrasado
  if (esEncargoFuturo) {
    if (!fechaProgClean || fechaProgClean >= svToday) {
      return {
        severity: 'scheduled_future',
        stageGroup: 'programado',
        elapsedHours: elapsedFromCreated,
        limitHours: settings.bodegaHours,
        remainingHours: settings.bodegaHours,
        overdueHours: 0,
        durationLabel: formatDurationCompact(elapsedFromCreated),
        reasonLabel: fechaProgClean ? `Programado ${fechaProgClean}` : 'Encargo programado',
        yaNotificado: Boolean(avisoEnviadoFecha),
        reprogramadoPara: reprogramadoPara || fechaProgClean,
        avisoEnviadoFecha,
      };
    }

    // Encargo cuya fecha programada ya venció
    const progStartMs = new Date(`${fechaProgClean}T14:00:00Z`).getTime(); // 8am SV de ese día
    const elapsedSinceProg = Math.max(0, (nowMs - progStartMs) / (1000 * 60 * 60));
    const isRescheduledAhead = Boolean(reprogramadoPara && reprogramadoPara >= svToday);
    const severity: SlaSeverity = isRescheduledAhead
      ? 'ok'
      : elapsedSinceProg >= settings.bodegaHours
      ? 'delayed'
      : 'warning';

    return {
      severity,
      stageGroup: 'programado',
      elapsedHours: elapsedSinceProg,
      limitHours: settings.bodegaHours,
      remainingHours: Math.max(0, settings.bodegaHours - elapsedSinceProg),
      overdueHours: Math.max(0, elapsedSinceProg - settings.bodegaHours),
      durationLabel: formatDurationCompact(elapsedSinceProg),
      reasonLabel: 'Encargo vencido sin pasar a bodega',
      yaNotificado: Boolean(avisoEnviadoFecha && (!reprogramadoPara || reprogramadoPara >= svToday)),
      reprogramadoPara,
      avisoEnviadoFecha,
    };
  }

  // Pedido en ruta vs en bodega
  const isRuta = estado === 'en_camino';
  const limitHours = isRuta ? settings.rutaHours : settings.bodegaHours;
  const warnStart = limitHours * 0.72;

  // Si ya fue reprogramado a una fecha >= hoy, lo consideramos notificado hasta que venza la nueva fecha
  const isRescheduledActive = Boolean(reprogramadoPara && reprogramadoPara >= svToday);
  const yaNotificado = Boolean(avisoEnviadoFecha && (!reprogramadoPara || reprogramadoPara >= svToday));

  let severity: SlaSeverity = 'ok';
  if (elapsedFromCreated >= limitHours) {
    severity = 'delayed';
  } else if (elapsedFromCreated >= warnStart) {
    severity = 'warning';
  }

  return {
    severity,
    stageGroup: isRuta ? 'ruta' : 'bodega',
    elapsedHours: elapsedFromCreated,
    limitHours,
    remainingHours: Math.max(0, limitHours - elapsedFromCreated),
    overdueHours: Math.max(0, elapsedFromCreated - limitHours),
    durationLabel: formatDurationCompact(elapsedFromCreated),
    reasonLabel: isRescheduledActive
      ? `Reprogramado para ${reprogramadoPara}`
      : isRuta
      ? `En ruta hace ${formatDurationCompact(elapsedFromCreated)} (límite ${limitHours}h)`
      : `En bodega hace ${formatDurationCompact(elapsedFromCreated)} (límite ${limitHours}h)`,
    yaNotificado,
    reprogramadoPara,
    avisoEnviadoFecha,
  };
}
