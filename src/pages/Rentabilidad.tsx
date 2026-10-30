import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { KpiCard } from '@/components/KpiCard'
import {
  construirRoas,
  etiquetaMes,
  formatCurrency,
  formatNumber,
  formatRoas,
  hoyLocal,
  mesActual,
  rangoMes,
  roasColorClass,
} from '@/lib/rentabilidad'
import type { GastoPublicidad, OrdenWhatsapp } from '@/types/rentabilidad'

const PLATAFORMAS = ['Meta', 'TikTok', 'Google', 'WhatsApp', 'Otro'] as const

const FORM_INICIAL = {
  fecha: hoyLocal(),
  codigo_anuncio: '',
  plataforma: 'Meta',
  monto: '',
  notas: '',
}

// AQUÍ ESTÁ EL CAMBIO: export function RentabilidadPage
export function RentabilidadPage() {
  const [mes, setMes] = useState<string>(mesActual())
  const [gastos, setGastos] = useState<GastoPublicidad[]>([])
  const [ordenes, setOrdenes] = useState<OrdenWhatsapp[]>([])
  const [cargando, setCargando] = useState<boolean>(true)
  const [guardando, setGuardando] = useState<boolean>(false)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [form, setForm] = useState(FORM_INICIAL)

  const rango = useMemo(() => rangoMes(mes), [mes])

  /* ------------------------------ Carga ------------------------------ */

  const cargarDatos = useCallback(async () => {
    setCargando(true)
    setError(null)

    const [resGastos, resOrdenes] = await Promise.all([
      supabase
        .from('gastos_publicidad')
        .select('id,fecha,codigo_anuncio,plataforma,monto,notas,created_at')
        .gte('fecha', rango.fechaInicio)
        .lte('fecha', rango.fechaFin)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('whatsapp_orders')
        .select('id,total,codigo_anuncio,created_at')
        .gte('created_at', rango.isoInicio)
        .lt('created_at', rango.isoFinExclusivo),
    ])

    if (resGastos.error || resOrdenes.error) {
      setError(
        resGastos.error?.message ??
          resOrdenes.error?.message ??
          'No se pudieron cargar los datos.',
      )
      setGastos([])
      setOrdenes([])
    } else {
      setGastos((resGastos.data ?? []) as GastoPublicidad[])
      setOrdenes((resOrdenes.data ?? []) as OrdenWhatsapp[])
    }

    setCargando(false)
  }, [rango])

  useEffect(() => {
    void cargarDatos()
  }, [cargarDatos])

  /* ----------------------------- Acciones ---------------------------- */

  const actualizarCampo = (campo: keyof typeof FORM_INICIAL, valor: string) => {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const codigo = form.codigo_anuncio.trim().toUpperCase()
    const monto = Number(form.monto)

    if (!form.fecha) {
      setError('Seleccioná una fecha.')
      return
    }
    if (!codigo) {
      setError('Ingresá el código de anuncio (ej. PROMO1).')
      return
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      setError('El monto debe ser un número mayor a 0.')
      return
    }

    setGuardando(true)
    setError(null)
    setExito(null)

    const { error: insertError } = await supabase
      .from('gastos_publicidad')
      .insert({
        fecha: form.fecha,
        codigo_anuncio: codigo,
        plataforma: form.plataforma,
        monto,
        notas: form.notas.trim() || null,
      })

    if (insertError) {
      setError(insertError.message)
    } else {
      setExito(`Gasto de ${formatCurrency(monto)} registrado para ${codigo}.`)
      setForm({ ...FORM_INICIAL, fecha: form.fecha })
      await cargarDatos()
    }

    setGuardando(false)
  }

  const handleEliminar = async (gasto: GastoPublicidad) => {
    const confirmado = window.confirm(
      `¿Eliminar el gasto de ${formatCurrency(Number(gasto.monto))} (${gasto.codigo_anuncio})?`,
    )
    if (!confirmado) return

    setEliminandoId(gasto.id)
    setError(null)
    setExito(null)

    const { error: deleteError } = await supabase
      .from('gastos_publicidad')
      .delete()
      .eq('id', gasto.id)

    if (deleteError) {
      setError(deleteError.message)
    } else {
      setGastos((prev) => prev.filter((item) => item.id !== gasto.id))
    }

    setEliminandoId(null)
  }

  /* ---------------------------- Derivados ---------------------------- */

  const filasRoas = useMemo(
    () => construirRoas(ordenes, gastos),
    [ordenes, gastos],
  )

  const totales = useMemo(() => {
    const ventas = filasRoas.reduce((acc, fila) => acc + fila.ventas, 0)
    const gasto = filasRoas.reduce((acc, fila) => acc + fila.gasto, 0)
    const pedidos = filasRoas.reduce((acc, fila) => acc + fila.pedidos, 0)

    return {
      ventas,
      gasto,
      pedidos,
      roasGlobal: gasto > 0 ? ventas / gasto : null,
    }
  }, [filasRoas])

  /* ------------------------------- UI -------------------------------- */

  return (
    <div className="space-y-8 p-4 md:p-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-900">
          Rentabilidad y ROAS
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Cargá tu inversión publicitaria y cruzala con las ventas de WhatsApp.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {exito ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {exito}
        </div>
      ) : null}

      {/* A. Formulario de gasto manual */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">
          Registrar gasto manual
        </h2>

        <form onSubmit={handleSubmit} className="mt-4 grid gap-4 md:grid-cols-6">
          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="fecha">
              Fecha
            </label>
            <input
              id="fecha"
              type="date"
              value={form.fecha}
              onChange={(e) => actualizarCampo('fecha', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600" htmlFor="codigo">
              Código de anuncio
            </label>
            <input
              id="codigo"
              type="text"
              placeholder="PROMO1"
              value={form.codigo_anuncio}
              onChange={(e) => actualizarCampo('codigo_anuncio', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="plataforma">
              Plataforma
            </label>
            <select
              id="plataforma"
              value={form.plataforma}
              onChange={(e) => actualizarCampo('plataforma', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {PLATAFORMAS.map((plataforma) => (
                <option key={plataforma} value={plataforma}>
                  {plataforma}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="monto">
              Monto
            </label>
            <input
              id="monto"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={form.monto}
              onChange={(e) => actualizarCampo('monto', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-1">
            <label className="block text-xs font-medium text-slate-600" htmlFor="notas">
              Notas
            </label>
            <input
              id="notas"
              type="text"
              placeholder="Opcional"
              value={form.notas}
              onChange={(e) => actualizarCampo('notas', e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="md:col-span-6">
            <button
              type="submit"
              disabled={guardando}
              className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {guardando ? 'Guardando…' : 'Guardar gasto'}
            </button>
          </div>
        </form>
      </section>

      {/* B. Tabla de gastos registrados */}
      <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Gastos registrados
            </h2>
            <p className="text-xs text-slate-500">{etiquetaMes(mes)}</p>
          </div>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value || mesActual())}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {cargando ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">Cargando…</p>
        ) : gastos.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-slate-500">
            Todavía no hay gastos cargados en este mes.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Fecha</th>
                  <th className="px-6 py-3 text-left font-medium">Anuncio</th>
                  <th className="px-6 py-3 text-left font-medium">Plataforma</th>
                  <th className="px-6 py-3 text-right font-medium">Monto</th>
                  <th className="px-6 py-3 text-right font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {gastos.map((gasto) => (
                  <tr key={gasto.id} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-6 py-3 text-slate-700">
                      {new Date(`${gasto.fecha}T00:00:00`).toLocaleDateString('es-AR')}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 font-medium text-slate-900">
                      {gasto.codigo_anuncio}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-slate-600">
                      {gasto.plataforma}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right font-semibold text-slate-900">
                      {formatCurrency(Number(gasto.monto))}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleEliminar(gasto)}
                        disabled={eliminandoId === gasto.id}
                        className="rounded-md px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        {eliminandoId === gasto.id ? 'Eliminando…' : 'Eliminar'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* C. Dashboard de ROAS */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">ROAS por anuncio</h2>
          <p className="text-xs text-slate-500">
            Ventas de WhatsApp ÷ inversión publicitaria · {etiquetaMes(mes)}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label="Ventas" value={formatCurrency(totales.ventas)} />
          <KpiCard label="Gasto en Ads" value={formatCurrency(totales.gasto)} />
          <KpiCard label="Pedidos" value={formatNumber(totales.pedidos)} />
          <KpiCard
            label="ROAS global"
            value={formatRoas(totales.roasGlobal)}
            valueClassName={roasColorClass(totales.roasGlobal)}
          />
        </div>

        {cargando ? (
          <p className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            Cargando…
          </p>
        ) : filasRoas.length === 0 ? (
          <p className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
            Sin datos todavía. Cargá un gasto y asegurate de que las órdenes tengan
            <span className="mx-1 font-mono text-xs">codigo_anuncio</span>.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-6 py-3 text-left font-medium">Anuncio</th>
                  <th className="px-6 py-3 text-right font-medium">Pedidos</th>
                  <th className="px-6 py-3 text-right font-medium">Ventas</th>
                  <th className="px-6 py-3 text-right font-medium">Gasto</th>
                  <th className="px-6 py-3 text-right font-medium">ROAS</th>
                  <th className="px-6 py-3 text-right font-medium">CPA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filasRoas.map((fila) => (
                  <tr key={fila.codigo_anuncio} className="hover:bg-slate-50">
                    <td className="whitespace-nowrap px-6 py-3 font-medium text-slate-900">
                      {fila.codigo_anuncio}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-slate-700">
                      {formatNumber(fila.pedidos)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-slate-900">
                      {formatCurrency(fila.ventas)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-slate-700">
                      {formatCurrency(fila.gasto)}
                    </td>
                    <td
                      className={`whitespace-nowrap px-6 py-3 text-right font-semibold ${roasColorClass(fila.roas)}`}
                    >
                      {formatRoas(fila.roas)}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-slate-700">
                      {fila.cpa === null ? '—' : formatCurrency(fila.cpa)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
