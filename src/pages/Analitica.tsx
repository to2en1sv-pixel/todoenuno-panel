import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { KpiCard } from '@/components/KpiCard'
import { VentasLineChart } from '@/components/charts/VentasLineChart'
import {
  etiquetaMes,
  formatCurrency,
  formatNumber,
  formatPorcentaje,
  formatRoas,
  mesActual,
  mesAnterior,
  rangoMes,
  roasColorClass,
  serieDiaria,
} from '@/lib/rentabilidad'
import type { GastoPublicidad, OrdenWhatsapp } from '@/types/rentabilidad'

interface OrdenTotal {
  total: number
}

export function Analitica() {
  const [mes, setMes] = useState<string>(mesActual())
  const [ordenes, setOrdenes] = useState<OrdenWhatsapp[]>([])
  const [gastos, setGastos] = useState<GastoPublicidad[]>([])
  const [ventasMesAnterior, setVentasMesAnterior] = useState<number>(0)
  const [cargando, setCargando] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const cargarDatos = useCallback(async () => {
    setCargando(true)
    setError(null)

    const actual = rangoMes(mes)
    const anterior = rangoMes(mesAnterior(mes))

    const [resOrdenes, resGastos, resOrdenesAnterior] = await Promise.all([
      supabase
        .from('whatsapp_orders')
        .select('id,total,codigo_anuncio,created_at')
        .gte('created_at', actual.isoInicio)
        .lt('created_at', actual.isoFinExclusivo),
      supabase
        .from('gastos_publicidad')
        .select('id,fecha,codigo_anuncio,plataforma,monto,notas,created_at')
        .gte('fecha', actual.fechaInicio)
        .lte('fecha', actual.fechaFin),
      supabase
        .from('whatsapp_orders')
        .select('total')
        .gte('created_at', anterior.isoInicio)
        .lt('created_at', anterior.isoFinExclusivo),
    ])

    if (resOrdenes.error || resGastos.error || resOrdenesAnterior.error) {
      setError(
        resOrdenes.error?.message ??
          resGastos.error?.message ??
          resOrdenesAnterior.error?.message ??
          'No se pudieron cargar los datos.',
      )
      setCargando(false)
      return
    }

    setOrdenes((resOrdenes.data ?? []) as OrdenWhatsapp[])
    setGastos((resGastos.data ?? []) as GastoPublicidad[])
    setVentasMesAnterior(
      ((resOrdenesAnterior.data ?? []) as OrdenTotal[]).reduce(
        (acc, orden) => acc + (Number(orden.total) || 0),
        0,
      ),
    )
    setCargando(false)
  }, [mes])

  useEffect(() => {
    void cargarDatos()
  }, [cargarDatos])

  const serie = useMemo(() => serieDiaria(ordenes, mes), [ordenes, mes])

  const kpis = useMemo(() => {
    const ventas = ordenes.reduce((acc, o) => acc + (Number(o.total) || 0), 0)
    const gasto = gastos.reduce((acc, g) => acc + (Number(g.monto) || 0), 0)
    const variacion =
      ventasMesAnterior > 0
        ? ((ventas - ventasMesAnterior) / ventasMesAnterior) * 100
        : null

    return {
      ventas,
      pedidos: ordenes.length,
      gasto,
      roasGlobal: gasto > 0 ? ventas / gasto : null,
      variacion,
    }
  }, [ordenes, gastos, ventasMesAnterior])

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Analítica</h1>
          <p className="mt-1 text-sm text-slate-500">
            KPIs mensuales de ventas, inversión y ROAS.
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600" htmlFor="mes">
            Mes
          </label>
          <input
            id="mes"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value || mesActual())}
            className="mt-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Ventas del mes"
          value={formatCurrency(kpis.ventas)}
          hint={`vs. mes anterior: ${formatPorcentaje(kpis.variacion)}`}
        />
        <KpiCard label="Pedidos" value={formatNumber(kpis.pedidos)} />
        <KpiCard label="Gasto en Ads" value={formatCurrency(kpis.gasto)} />
        <KpiCard
          label="ROAS global"
          value={formatRoas(kpis.roasGlobal)}
          valueClassName={roasColorClass(kpis.roasGlobal)}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Ingresos diarios</h2>
          <span className="text-xs text-slate-500">{etiquetaMes(mes)}</span>
        </div>

        {cargando ? (
          <p className="py-12 text-center text-sm text-slate-500">Cargando…</p>
        ) : (
          <VentasLineChart data={serie} />
        )}
      </section>
    </div>
  )
}
