import type {
  GastoPublicidad,
  OrdenWhatsapp,
  PuntoVentas,
  RoasRow,
} from '@/types/rentabilidad'

/** Cambiá acá la moneda si no usás USD. */
export const MONEDA = 'USD'

/* ----------------------------- Fechas ----------------------------- */

export function toFechaLocal(fecha: Date): string {
  const y = fecha.getFullYear()
  const m = String(fecha.getMonth() + 1).padStart(2, '0')
  const d = String(fecha.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function hoyLocal(): string {
  return toFechaLocal(new Date())
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
  const inicio = new Date(anio, mesNumero - 1, 1, 0, 0, 0, 0)
  const finExclusivo = new Date(anio, mesNumero, 1, 0, 0, 0, 0)
  const ultimoDia = new Date(anio, mesNumero, 0)

  return {
    anio,
    mesNumero,
    diasDelMes: ultimoDia.getDate(),
    fechaInicio: toFechaLocal(inicio),
    fechaFin: toFechaLocal(ultimoDia),
    isoInicio: inicio.toISOString(),
    isoFinExclusivo: finExclusivo.toISOString(),
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
 * JOIN lógico entre whatsapp_orders y gastos_publicidad agrupado por codigo_anuncio.
 */
export function construirRoas(
  ordenes: OrdenWhatsapp[],
  gastos: GastoPublicidad[],
): RoasRow[] {
  const mapa = new Map<string, RoasRow>()

  const obtener = (codigo: string): RoasRow => {
    const existente = mapa.get(codigo)
    if (existente) return existente
    const nueva: RoasRow = {
      codigo_anuncio: codigo,
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
    const codigo = normalizarCodigo(orden.codigo_anuncio)
    if (!codigo) continue
    const fila = obtener(codigo)
    fila.ventas += Number(orden.total) || 0
    fila.pedidos += 1
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

/** Serie diaria (todos los días del mes, con 0 donde no hubo ventas). */
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
    const fecha = new Date(orden.created_at)
    if (Number.isNaN(fecha.getTime())) continue
    if (fecha.getFullYear() !== anio || fecha.getMonth() + 1 !== mesNumero) continue

    const punto = porDia.get(fecha.getDate())
    if (!punto) continue

    punto.ventas += Number(orden.total) || 0
    punto.pedidos += 1
  }

  return Array.from(porDia.values()).map((punto) => ({
    ...punto,
    ventas: redondear(punto.ventas),
  }))
}
