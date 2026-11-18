import type {
  GastoPublicidad,
  OrdenWhatsapp,
  PuntoVentas,
  RoasRow,
} from '@/types/rentabilidad'
import { resolveCatalogSku, type CatalogResolutionIndex } from './catalogAliases'

/** Cambiá acá la moneda si no usás USD. */
export const MONEDA = 'USD'

/* ----------------------------- Fechas ----------------------------- */

export function toElSalvadorDateKey(isoOrDate: string | Date): string {
  try {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
    if (Number.isNaN(d.getTime())) return ''
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/El_Salvador',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  } catch {
    const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate)
    if (Number.isNaN(d.getTime())) return ''
    const sv = new Date(d.getTime() - 6 * 3600_000)
    return sv.toISOString().slice(0, 10)
  }
}

export function toFechaLocal(fecha: Date): string {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function hoyLocal(): string {
  return toElSalvadorDateKey(new Date())
}

export function mesActual(): string {
  return hoyLocal().slice(0, 7)
}

export interface RangoMes {
  anio: number
  mesNumero: number
  diasDelMes: number
  fechaInicio: string      // para columnas `date` (inclusive)
  fechaFin: string         // para columnas `date` (inclusive)
  isoInicio: string        // para columnas `timestamptz` (inclusive)
  isoFinExclusivo: string  // para columnas `timestamptz` (exclusivo)
}

export function rangoMes(mes: string): RangoMes {
  const [anio, mesNumero] = mes.split('-').map(Number)
  const mm = String(mesNumero).padStart(2, '0')
  const ultimoDia = new Date(anio, mesNumero, 0)
  const lastDd = String(ultimoDia.getDate()).padStart(2, '0')
  const nextYear = mesNumero === 12 ? anio + 1 : anio
  const nextMonth = mesNumero === 12 ? 1 : mesNumero + 1
  const nextMm = String(nextMonth).padStart(2, '0')

  // El Salvador UTC-6 todo el año (sin DST)
  const isoInicio = new Date(`${anio}-${mm}-01T00:00:00-06:00`).toISOString()
  const isoFinExclusivo = new Date(`${nextYear}-${nextMm}-01T00:00:00-06:00`).toISOString()

  return {
    anio,
    mesNumero,
    diasDelMes: ultimoDia.getDate(),
    fechaInicio: `${anio}-${mm}-01`,
    fechaFin: `${anio}-${mm}-${lastDd}`,
    isoInicio,
    isoFinExclusivo,
  }
}

export function mesAnterior(mes: string): string {
  const [anio, mesNumero] = mes.split('-').map(Number)
  const anterior = new Date(anio, mesNumero - 2, 1)
  return `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}`
}

export function etiquetaMes(mes: string): string {
  const [anio, mesNumero] = mes.split('-').map(Number)
  const fecha = new Date(anio, mesNumero - 1, 1)
  const texto = fecha.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/* --------------------------- Formatters --------------------------- */

export function formatCurrency(valor: number): string {
  const seguro = Number.isFinite(valor) ? valor : 0
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: MONEDA,
    maximumFractionDigits: 2,
  }).format(seguro)
}

export function formatNumber(valor: number): string {
  const seguro = Number.isFinite(valor) ? valor : 0
  return new Intl.NumberFormat('es-AR').format(seguro)
}

export function formatRoas(valor: number | null): string {
  return valor === null ? '—' : `${valor.toFixed(2)}x`
}

export function formatPorcentaje(valor: number | null): string {
  if (valor === null) return '—'
  const signo = valor > 0 ? '+' : ''
  return `${signo}${valor.toFixed(1)}%`
}

/** Verde si ROAS >= 3, rojo si < 1, ámbar en el medio. */
export function roasColorClass(roas: number | null): string {
  if (roas === null) return 'text-slate-400'
  if (roas >= 3) return 'text-emerald-600'
  if (roas < 1) return 'text-rose-600'
  return 'text-amber-600'
}

/* ---------------------------- Cálculos ---------------------------- */

function normalizarCodigo(valor: string | null | undefined): string {
  return (valor ?? '').trim().toUpperCase()
}

function redondear(valor: number, decimales = 2): number {
  const factor = 10 ** decimales
  return Math.round(valor * factor) / factor
}

/**
 * JOIN lógico entre whatsapp_orders (excluyendo cancelados) y gastos_publicidad agrupado por codigo_anuncio,
 * vinculando automáticamente con el producto maestro del catálogo.
 */
export function construirRoas(
  ordenes: OrdenWhatsapp[],
  gastos: GastoPublicidad[],
  catalogIndex?: CatalogResolutionIndex,
): RoasRow[] {
  const mapa = new Map<string, RoasRow>()
  const masterSkus = catalogIndex?.masterSkus || []

  const obtener = (codigo: string): RoasRow => {
    const existente = mapa.get(codigo)
    if (existente) return existente
    const nueva: RoasRow = {
      codigo_anuncio: codigo,
      producto_catalogo: resolveCatalogSku(null, codigo, null, masterSkus, { index: catalogIndex }),
      ventas: 0,
      gasto: 0,
      pedidos: 0,
      roas: null,
      cpa: null,
    }
    mapa.set(codigo, nueva)
    return nueva
  }

  for (const orden of ordenes) {
    if (String(orden.estado || '').toLowerCase() === 'cancelado') continue
    const codigo = normalizarCodigo(orden.codigo_anuncio)
    if (!codigo) continue
    const fila = obtener(codigo)
    fila.ventas += Number(orden.total) || 0
    fila.pedidos += 1
    if (!fila.producto_catalogo) {
      fila.producto_catalogo = resolveCatalogSku(
        orden.sku,
        orden.codigo_anuncio,
        orden.catalogo_sku,
        masterSkus,
        { items: orden.items, index: catalogIndex },
      )
    }
  }

  for (const gasto of gastos) {
    const codigo = normalizarCodigo(gasto.codigo_anuncio)
    if (!codigo) continue
    obtener(codigo).gasto += Number(gasto.monto) || 0
  }

  return Array.from(mapa.values())
    .map((fila) => ({
      ...fila,
      ventas: redondear(fila.ventas),
      gasto: redondear(fila.gasto),
      roas: fila.gasto > 0 ? redondear(fila.ventas / fila.gasto) : null,
      cpa: fila.pedidos > 0 ? redondear(fila.gasto / fila.pedidos) : null,
    }))
    .sort((a, b) => b.ventas - a.ventas)
}

/** Serie diaria (todos los días del mes, con 0 donde no hubo ventas; excluye cancelados y usa hora El Salvador). */
export function serieDiaria(ordenes: OrdenWhatsapp[], mes: string): PuntoVentas[] {
  const { anio, mesNumero, diasDelMes } = rangoMes(mes)
  const porDia = new Map<number, PuntoVentas>()

  for (let dia = 1; dia <= diasDelMes; dia += 1) {
    const dd = String(dia).padStart(2, '0')
    const mm = String(mesNumero).padStart(2, '0')
    porDia.set(dia, {
      fecha: `${anio}-${mm}-${dd}`,
      etiqueta: `${dd}/${mm}`,
      ventas: 0,
      pedidos: 0,
    })
  }

  for (const orden of ordenes) {
    if (String(orden.estado || '').toLowerCase() === 'cancelado') continue
    const svKey = toElSalvadorDateKey(orden.created_at)
    if (!svKey) continue
    const [y, m, d] = svKey.split('-').map(Number)
    if (y !== anio || m !== mesNumero) continue

    const punto = porDia.get(d)
    if (!punto) continue

    punto.ventas += Number(orden.total) || 0
    punto.pedidos += 1
  }

  return Array.from(porDia.values()).map((punto) => ({
    ...punto,
    ventas: redondear(punto.ventas),
  }))
}

/* ------------------ Arranque de medición ROAS ------------------ */

export const ROAS_START_DOC_TITLE = '__SYSTEM_ROAS_START_V1__'
export const DEFAULT_ROAS_START_DATE = '2026-11-19'
const ROAS_START_LOCAL_KEY = 'todoenuno_roas_start_v1'
const ROAS_START_NONE_SENTINEL = '__NONE__'

export function getLocalRoasStartDate(): string | null {
  try {
    const raw = localStorage.getItem(ROAS_START_LOCAL_KEY)
    if (raw === ROAS_START_NONE_SENTINEL) return null
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    return DEFAULT_ROAS_START_DATE
  } catch {
    return DEFAULT_ROAS_START_DATE
  }
}

export function setLocalRoasStartDate(startDate: string | null): void {
  try {
    if (startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      localStorage.setItem(ROAS_START_LOCAL_KEY, startDate)
    } else if (startDate === null) {
      localStorage.setItem(ROAS_START_LOCAL_KEY, ROAS_START_NONE_SENTINEL)
    }
  } catch {
    // ignore storage errors
  }
}

export async function fetchRoasStartDate(supabaseClient: any): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient
      .from('panel_docs')
      .select('id,contenido')
      .eq('titulo', ROAS_START_DOC_TITLE)
      .maybeSingle()

    if (!error && data?.contenido) {
      const parsed = JSON.parse(data.contenido)
      if (parsed && 'startDate' in parsed) {
        const val = typeof parsed.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.startDate)
          ? parsed.startDate
          : null
        setLocalRoasStartDate(val)
        return val
      }
    }
  } catch {
    // fallback to local/default
  }
  return getLocalRoasStartDate()
}

export async function saveRoasStartDate(
  supabaseClient: any,
  startDate: string | null,
): Promise<{ startDate: string | null; error?: string }> {
  const clean = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : null
  setLocalRoasStartDate(clean)
  const payload = JSON.stringify({
    startDate: clean,
    updatedAt: new Date().toISOString(),
  })
  const nowIso = new Date().toISOString()

  try {
    const { data: existing } = await supabaseClient
      .from('panel_docs')
      .select('id')
      .eq('titulo', ROAS_START_DOC_TITLE)
      .maybeSingle()

    if (existing?.id) {
      const { error } = await supabaseClient
        .from('panel_docs')
        .update({
          contenido: payload,
          categoria: 'Sistema',
          estado: 'Completado',
          updated_at: nowIso,
        })
        .eq('id', existing.id)
      if (error) return { startDate: clean, error: error.message }
    } else {
      const { error } = await supabaseClient
        .from('panel_docs')
        .insert({
          titulo: ROAS_START_DOC_TITLE,
          contenido: payload,
          categoria: 'Sistema',
          estado: 'Completado',
          updated_at: nowIso,
        })
      if (error) return { startDate: clean, error: error.message }
    }
    return { startDate: clean }
  } catch (err: any) {
    return { startDate: clean, error: err?.message || 'Error guardando arranque ROAS' }
  }
}

export function formatRoasDateLabel(ymd: string | null): string {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 'Sin corte'
  try {
    return new Date(`${ymd}T12:00:00-06:00`).toLocaleDateString('es-SV', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  } catch {
    return ymd
  }
}

