import { supabase } from '@/lib/supabase';
import {
  fetchToddBusinessSettings,
  formatSaturationDaysLabel,
  getCachedToddBusinessSettings,
  type OperationalSaturationDays,
} from '@/lib/toddSettings';

export interface DispatchSlaSettings {
  bodegaHours: number;
  rutaHours: number;
  operationalSaturationEnabled?: boolean;
  operationalSaturationDays?: OperationalSaturationDays;
}

export interface EffectiveSlaLimits {
  bodegaHours: number;
  bodegaWarnHours: number;
  rutaHours: number;
  rutaWarnHours: number;
  saturationActive: boolean;
  saturationDays: OperationalSaturationDays;
  saturationLabel: string | null;
}

export const DEFAULT_DISPATCH_SLA: DispatchSlaSettings = {
  bodegaHours: 24,
  rutaHours: 36,
};

const STORAGE_KEY = 'todoenuno_dispatch_sla_settings_v1';
const DOC_TITLE = '__SYSTEM_DISPATCH_SLA_SETTINGS_V1__';

export function resolveEffectiveSlaLimits(settings: DispatchSlaSettings): EffectiveSlaLimits {
  const baseBodega = Math.max(4, Math.min(168, Number(settings?.bodegaHours) || 24));
  const baseRuta = Math.max(6, Math.min(240, Number(settings?.rutaHours) || 36));
  const saturationDays: OperationalSaturationDays =
    settings?.operationalSaturationDays === '3-4' ? '3-4' : '2-3';
  const saturationActive = Boolean(settings?.operationalSaturationEnabled);

  if (saturationActive) {
    // 2 - 3 días: Bodega máx 48h (aviso 36h), Entrega/Ruta total máx 72h (aviso desde 48h = día 2)
    // 3 - 4 días: Bodega máx 72h (aviso 54h), Entrega/Ruta total máx 96h (aviso desde 72h = día 3)
    const bodegaHours = saturationDays === '3-4' ? 72 : 48;
    const bodegaWarnHours = saturationDays === '3-4' ? 54 : 36;
    const rutaHours = saturationDays === '3-4' ? 96 : 72;
    const rutaWarnHours = saturationDays === '3-4' ? 72 : 48;

    return {
      bodegaHours,
      bodegaWarnHours,
      rutaHours,
      rutaWarnHours,
      saturationActive: true,
      saturationDays,
      saturationLabel: formatSaturationDaysLabel(saturationDays),
    };
  }

  return {
    bodegaHours: baseBodega,
    bodegaWarnHours: baseBodega * 0.72,
    rutaHours: baseRuta,
    rutaWarnHours: baseRuta * 0.72,
    saturationActive: false,
    saturationDays,
    saturationLabel: null,
  };
}

export function getCachedDispatchSlaSettings(): DispatchSlaSettings {
  const toddBiz = getCachedToddBusinessSettings();
  let base: DispatchSlaSettings = { ...DEFAULT_DISPATCH_SLA };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      base = {
        bodegaHours: Math.max(4, Math.min(168, Number(parsed?.bodegaHours) || 24)),
        rutaHours: Math.max(6, Math.min(240, Number(parsed?.rutaHours) || 36)),
      };
    }
  } catch {}
  return {
    ...base,
    operationalSaturationEnabled: toddBiz.operationalSaturationEnabled,
    operationalSaturationDays: toddBiz.operationalSaturationDays,
  };
}

export async function fetchDispatchSlaSettings(): Promise<DispatchSlaSettings> {
  const [slaDocRes, toddBizRes] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await supabase
          .from('panel_docs')
          .select('contenido')
          .eq('titulo', DOC_TITLE)
          .maybeSingle();
        if (!error && data?.contenido) {
          const parsed = JSON.parse(data.contenido);
          const merged = {
            bodegaHours: Math.max(4, Math.min(168, Number(parsed?.bodegaHours) || 24)),
            rutaHours: Math.max(6, Math.min(240, Number(parsed?.rutaHours) || 36)),
          };
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          } catch {}
          return merged;
        }
      } catch {}
      const cached = getCachedDispatchSlaSettings();
      return { bodegaHours: cached.bodegaHours, rutaHours: cached.rutaHours };
    })(),
    fetchToddBusinessSettings().catch(() => ({
      settings: getCachedToddBusinessSettings(),
      source: 'local' as const,
    })),
  ]);

  return {
    ...slaDocRes,
    operationalSaturationEnabled: toddBizRes.settings.operationalSaturationEnabled,
    operationalSaturationDays: toddBizRes.settings.operationalSaturationDays,
  };
}

export async function saveDispatchSlaSettings(settings: DispatchSlaSettings): Promise<DispatchSlaSettings> {
  const cleanBase = {
    bodegaHours: Math.max(4, Math.min(168, Math.round(Number(settings.bodegaHours) || 24))),
    rutaHours: Math.max(6, Math.min(240, Math.round(Number(settings.rutaHours) || 36))),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanBase));
  } catch {}

  try {
    const serialized = JSON.stringify(cleanBase);
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

  const toddBiz = getCachedToddBusinessSettings();
  return {
    ...cleanBase,
    operationalSaturationEnabled:
      settings.operationalSaturationEnabled !== undefined
        ? settings.operationalSaturationEnabled
        : toddBiz.operationalSaturationEnabled,
    operationalSaturationDays:
      settings.operationalSaturationDays || toddBiz.operationalSaturationDays,
  };
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
  saturationActive: boolean;
  saturationLabel: string | null;
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
  const effective = resolveEffectiveSlaLimits(settings);

  if (estado === 'entregado' || estado === 'cancelado') {
    return {
      severity: 'finalizado',
      stageGroup: 'finalizado',
      elapsedHours: 0,
      limitHours: effective.bodegaHours,
      remainingHours: 0,
      overdueHours: 0,
      durationLabel: '—',
      reasonLabel: estado === 'entregado' ? 'Entregado' : 'Cancelado',
      yaNotificado: Boolean(avisoEnviadoFecha),
      reprogramadoPara,
      avisoEnviadoFecha,
      saturationActive: effective.saturationActive,
      saturationLabel: effective.saturationLabel,
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
        limitHours: effective.bodegaHours,
        remainingHours: effective.bodegaHours,
        overdueHours: 0,
        durationLabel: formatDurationCompact(elapsedFromCreated),
        reasonLabel: fechaProgClean ? `Programado ${fechaProgClean}` : 'Encargo programado',
        yaNotificado: Boolean(avisoEnviadoFecha),
        reprogramadoPara: reprogramadoPara || fechaProgClean,
        avisoEnviadoFecha,
        saturationActive: effective.saturationActive,
        saturationLabel: effective.saturationLabel,
      };
    }

    // Encargo cuya fecha programada ya venció
    const progStartMs = new Date(`${fechaProgClean}T14:00:00Z`).getTime(); // 8am SV de ese día
    const elapsedSinceProg = Math.max(0, (nowMs - progStartMs) / (1000 * 60 * 60));
    const isRescheduledAhead = Boolean(reprogramadoPara && reprogramadoPara >= svToday);
    const encargoLimit = Math.max(4, Number(settings.bodegaHours) || 24);
    const severity: SlaSeverity = isRescheduledAhead
      ? 'ok'
      : elapsedSinceProg >= encargoLimit
      ? 'delayed'
      : 'warning';

    return {
      severity,
      stageGroup: 'programado',
      elapsedHours: elapsedSinceProg,
      limitHours: encargoLimit,
      remainingHours: Math.max(0, encargoLimit - elapsedSinceProg),
      overdueHours: Math.max(0, elapsedSinceProg - encargoLimit),
      durationLabel: formatDurationCompact(elapsedSinceProg),
      reasonLabel: 'Encargo vencido sin pasar a bodega',
      yaNotificado: Boolean(avisoEnviadoFecha && (!reprogramadoPara || reprogramadoPara >= svToday)),
      reprogramadoPara,
      avisoEnviadoFecha,
      saturationActive: effective.saturationActive,
      saturationLabel: effective.saturationLabel,
    };
  }

  // Pedido en ruta vs en bodega (aplicando límites efectivos según saturación operativa)
  const isRuta = estado === 'en_camino';
  const limitHours = isRuta ? effective.rutaHours : effective.bodegaHours;
  const warnStart = isRuta ? effective.rutaWarnHours : effective.bodegaWarnHours;

  // Si ya fue reprogramado a una fecha >= hoy, lo consideramos notificado hasta que venza la nueva fecha
  const isRescheduledActive = Boolean(reprogramadoPara && reprogramadoPara >= svToday);
  const yaNotificado = Boolean(avisoEnviadoFecha && (!reprogramadoPara || reprogramadoPara >= svToday));

  let severity: SlaSeverity = 'ok';
  if (elapsedFromCreated >= limitHours) {
    severity = 'delayed';
  } else if (elapsedFromCreated >= warnStart) {
    severity = 'warning';
  }

  const satSuffix = effective.saturationActive && effective.saturationLabel
    ? ` · saturación ${effective.saturationLabel}`
    : '';

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
      ? `En ruta hace ${formatDurationCompact(elapsedFromCreated)} (límite ${limitHours}h${satSuffix})`
      : `En bodega hace ${formatDurationCompact(elapsedFromCreated)} (límite ${limitHours}h${satSuffix})`,
    yaNotificado,
    reprogramadoPara,
    avisoEnviadoFecha,
    saturationActive: effective.saturationActive,
    saturationLabel: effective.saturationLabel,
  };
}
