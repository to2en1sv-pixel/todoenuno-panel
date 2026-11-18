import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { emitOsEvent } from '@/lib/osEvents'
import { BovedaProductosRoas } from '@/components/BovedaProductosRoas'
import { MetaAdsLiveView } from '@/components/rentabilidad/MetaAdsLiveView'
import { RefreshCw, Trash2, X } from 'lucide-react'
import { fetchStockItems, fetchProductVariants, identifyDuplicateVariantStockRows } from '@/lib/inventory'
import { buildCatalogResolutionIndex } from '@/lib/catalogAliases'
import {
  construirRoas,
  etiquetaMes,
  fetchRoasStartDate,
  formatCurrency,
  formatNumber,
  formatRoas,
  formatRoasDateLabel,
  getLocalRoasStartDate,
  hoyLocal,
  mesActual,
  rangoMes,
  roasColorClass,
  saveRoasStartDate,
} from '@/lib/rentabilidad'
import type { GastoPublicidad, OrdenWhatsapp } from '@/types/rentabilidad'
import type { StockItem, ProductVariant } from '@/types/inventory'

const PLATAFORMAS = ['Meta', 'TikTok', 'Google', 'WhatsApp', 'Otro'] as const

const FORM_INICIAL = {
  fecha: hoyLocal(),
  codigo_anuncio: '',
  plataforma: 'Meta',
  monto: '',
  notas: '',
}

export function RentabilidadPage() {
  const [vistaActiva, setVistaActiva] = useState<'mensual' | 'meta_ads' | 'boveda'>('mensual')
  const [mes, setMes] = useState<string>(mesActual())
  const [gastos, setGastos] = useState<GastoPublicidad[]>([])
  const [ordenes, setOrdenes] = useState<OrdenWhatsapp[]>([])
  const [stockItems, setStockItems] = useState<StockItem[]>([])
  const [variantsDb, setVariantsDb] = useState<ProductVariant[]>([])
  const [productosDb, setProductosDb] = useState<any[]>([])
  const [cargando, setCargando] = useState<boolean>(true)
  const [guardando, setGuardando] = useState<boolean>(false)
  const [syncingMeta, setSyncingMeta] = useState<boolean>(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [eliminandoId, setEliminandoId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exito, setExito] = useState<string | null>(null)
  const [form, setForm] = useState(FORM_INICIAL)
  const [roasStartDate, setRoasStartDate] = useState<string | null>(() => getLocalRoasStartDate())
  const [savingRoasStart, setSavingRoasStart] = useState<boolean>(false)

  const rango = useMemo(() => rangoMes(mes), [mes])

  const effectiveRange = useMemo(() => {
    const clippedByStart = Boolean(roasStartDate && roasStartDate > rango.fechaInicio)
    const fechaInicio = clippedByStart ? roasStartDate! : rango.fechaInicio
    const isoInicio = clippedByStart
      ? new Date(`${roasStartDate}T00:00:00-06:00`).toISOString()
      : rango.isoInicio
    return {
      fechaInicio,
      fechaFin: rango.fechaFin,
      isoInicio,
      isoFinExclusivo: rango.isoFinExclusivo,
      clippedByStart,
      emptyRange: fechaInicio > rango.fechaFin,
    }
  }, [rango, roasStartDate])

  useEffect(() => {
    let active = true
    void fetchRoasStartDate(supabase).then((saved) => {
      if (active) setRoasStartDate(saved)
    })
    return () => {
      active = false
    }
  }, [])

  const cargarDatos = useCallback(async () => {
    setCargando(true)
    setError(null)

    const [resGastos, resOrdenes, stockRes, variantsRes, prodRes] = await Promise.all([
      effectiveRange.emptyRange
        ? Promise.resolve({ data: [], error: null as any })
        : supabase
            .from('gastos_publicidad')
            .select('id,fecha,codigo_anuncio,plataforma,monto,notas,created_at')
            .gte('fecha', effectiveRange.fechaInicio)
            .lte('fecha', effectiveRange.fechaFin)
            .order('fecha', { ascending: false })
            .order('created_at', { ascending: false }),
      effectiveRange.emptyRange
        ? Promise.resolve({ data: [], error: null as any })
        : supabase
            .from('whatsapp_orders')
            .select('id,total,sku,catalogo_sku,items,estado,codigo_anuncio,created_at')
            .neq('estado', 'cancelado')
            .gte('created_at', effectiveRange.isoInicio)
            .lt('created_at', effectiveRange.isoFinExclusivo),
      fetchStockItems(),
      fetchProductVariants(),
      supabase.from('productos').select('*'),
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
      setOrdenes(((resOrdenes.data ?? []) as OrdenWhatsapp[]).filter((o) => String(o.estado || '').toLowerCase() !== 'cancelado'))
    }
    setStockItems(stockRes.items || [])
    setVariantsDb(variantsRes || [])
    setProductosDb(prodRes.data || [])

    setCargando(false)
  }, [effectiveRange])

  useEffect(() => {
    void cargarDatos()
  }, [cargarDatos])

  const handleChangeRoasStart = async (nextDate: string | null) => {
    setSavingRoasStart(true)
    setError(null)
    setExito(null)
    const res = await saveRoasStartDate(supabase, nextDate)
    setRoasStartDate(res.startDate)
    if (res.error) {
      setError(res.error)
    } else if (res.startDate) {
      setExito(`Arranque de medición ROAS fijado desde ${formatRoasDateLabel(res.startDate)}.`)
    } else {
      setExito('Corte de arranque ROAS desactivado: mostrando historial completo del mes.')
    }
    setSavingRoasStart(false)
  }

  const handleQuickMetaSync = async () => {
    setSyncingMeta(true)
    setError(null)
    setExito(null)
    try {
      const hoy = hoyLocal()
      const since = effectiveRange.fechaInicio
      const until = effectiveRange.fechaFin < hoy ? effectiveRange.fechaFin : hoy
      if (since > until) {
        if (roasStartDate && hoy < roasStartDate) {
          setExito(
            `Arranque ROAS programado desde ${formatRoasDateLabel(roasStartDate)}. Los días previos están protegidos para no duplicar en Finanzas.`
          )
        } else {
          setError('No se puede sincronizar un mes futuro.')
        }
        return
      }
      const qs = new URLSearchParams({ action: 'sync', since, until })
      const res = await fetch(`/api/meta-ads-sync?${qs.toString()}`, { method: 'POST' })
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        setError('La sincronización con Meta Ads requiere el servidor API desplegado en Vercel.')
        return
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error || 'No se pudo sincronizar con Meta Ads.')
        return
      }
      if (!data.connected) {
        setError(
          data.message ||
            'Falta configurar tus tokens de System User en Supabase (meta_ad_accounts). Revisa la pestaña Meta Ads Live o Sistema.'
        )
        return
      }
      if (data.skippedBeforeStart && data.message) {
        setExito(data.message)
        return
      }
      setExito(
        `Meta Ads sincronizado (${data.since} → ${data.until}): ${data.syncedSpendRows ?? 0} registros en gastos_publicidad.`
      )
      await cargarDatos()
    } catch (err: any) {
      setError(err?.message || 'Error conectando con /api/meta-ads-sync')
    } finally {
      setSyncingMeta(false)
    }
  }

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

    const { data: insertData, error: insertError } = await supabase
      .from('gastos_publicidad')
      .insert({
        fecha: form.fecha,
        codigo_anuncio: codigo,
        plataforma: form.plataforma,
        monto,
        notas: form.notas.trim() || null,
      })
      .select()
      .single()

    if (insertError) {
      setError(insertError.message)
    } else {
      setExito(`Gasto de ${formatCurrency(monto)} registrado para ${codigo}.`)
      setForm({ ...FORM_INICIAL, fecha: form.fecha })

      try {
        await emitOsEvent({
          type: 'marketing.ad.expense',
          source_table: 'gastos_publicidad',
          source_id: String(insertData?.id || codigo),
          payload: {
            gasto_id: insertData?.id,
            campaign_id: codigo,
            codigo_anuncio: codigo,
            platform: form.plataforma.toLowerCase(),
            amount: monto,
            date: form.fecha,
            notas: form.notas.trim() || null,
          },
        })
      } catch (err) {
        console.warn('Error emitiendo evento marketing.ad.expense:', err)
      }

      await cargarDatos()
    }

    setGuardando(false)
  }

  const handleEliminar = async (gasto: GastoPublicidad) => {
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
      setConfirmDeleteId(null)
    }

    setEliminandoId(null)
  }

  const catalogIndex = useMemo(() => {
    const { duplicateChildSkuSet } = identifyDuplicateVariantStockRows(stockItems, variantsDb)
    return buildCatalogResolutionIndex({
      stockItems,
      variants: variantsDb,
      productosDb,
      duplicateChildSkuSet,
    })
  }, [stockItems, variantsDb, productosDb])

  const filasRoas = useMemo(
    () => construirRoas(ordenes, gastos, catalogIndex),
    [ordenes, gastos, catalogIndex],
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

  const periodoLabel = effectiveRange.clippedByStart
    ? `Desde ${formatRoasDateLabel(effectiveRange.fechaInicio)} · ${etiquetaMes(mes)}`
    : etiquetaMes(mes)

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Rentabilidad
          </h1>
          <p className="text-xs text-[var(--mu)] mt-1">
            Cruce de inversión publicitaria, ventas de WhatsApp y ciclos de pauta · {etiquetaMes(mes)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {vistaActiva === 'mensual' && (
            <>
              <input
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value || mesActual())}
                className="rounded-lg border border-[var(--bd)] bg-cd px-3 py-1.5 text-xs font-medium text-[var(--tx)] outline-none focus:border-[var(--tx)]"
              />
              <button
                type="button"
                onClick={() => void handleQuickMetaSync()}
                disabled={syncingMeta}
                className="px-3.5 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-opacity disabled:opacity-50"
              >
                <RefreshCw size={13} className={syncingMeta ? 'animate-spin' : ''} />
                {syncingMeta ? 'Sincronizando...' : 'Sincronizar Meta Ads'}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Navegación por pestañas con línea inferior limpia */}
      <nav className="flex items-center gap-6 border-b border-[var(--bd)] overflow-x-auto">
        {[
          { id: 'mensual', label: 'ROAS mensual' },
          { id: 'meta_ads', label: 'Meta Ads Live' },
          { id: 'boveda', label: 'Bóveda de productos y ciclos' },
        ].map(tab => {
          const active = vistaActiva === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setVistaActiva(tab.id as any)}
              className={`pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                active
                  ? 'border-[var(--tx)] text-[var(--tx)]'
                  : 'border-transparent text-[var(--mu)] hover:text-[var(--tx)]'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </nav>

      {vistaActiva === 'boveda' ? (
        <BovedaProductosRoas />
      ) : vistaActiva === 'meta_ads' ? (
        <MetaAdsLiveView onSynced={cargarDatos} />
      ) : (
        <div className="flex flex-col gap-6">
          {error && (
            <div className="px-4 py-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between gap-3">
              <span>{error}</span>
              <button type="button" onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
                <X size={14} />
              </button>
            </div>
          )}

          {exito && (
            <div className="px-4 py-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-3">
              <span>{exito}</span>
              <button type="button" onClick={() => setExito(null)} className="opacity-70 hover:opacity-100">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Barra de arranque de medición ROAS (protege días previos en Finanzas) */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-[var(--tx)]">Arranque de medición ROAS:</span>
                <span className="font-mono font-medium text-[var(--tx)]">
                  {roasStartDate ? `Desde ${formatRoasDateLabel(roasStartDate)}` : 'Mes completo (sin corte)'}
                </span>
              </div>
              <p className="text-[11px] text-[var(--mu)] mt-0.5">
                {roasStartDate
                  ? 'Cuenta ventas, gastos y sincronización de Meta Ads desde esta fecha sin reingresar pauta previa a Finanzas.'
                  : 'Midiendo todo el mes completo sin fecha de corte.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <input
                type="date"
                value={roasStartDate || ''}
                disabled={savingRoasStart}
                onChange={(e) => void handleChangeRoasStart(e.target.value || null)}
                aria-label="Fecha de arranque ROAS"
                className="rounded-lg border border-[var(--bd)] bg-sf px-2.5 py-1.5 text-xs font-mono text-[var(--tx)] outline-none focus:border-[var(--tx)]"
              />
              <button
                type="button"
                disabled={savingRoasStart}
                onClick={() => void handleChangeRoasStart(hoyLocal())}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--bd)] bg-sf hover:bg-[var(--cd)] text-xs font-medium text-[var(--tx)] whitespace-nowrap transition-colors disabled:opacity-50"
              >
                Desde hoy
              </button>
              {roasStartDate && (
                <button
                  type="button"
                  disabled={savingRoasStart}
                  onClick={() => void handleChangeRoasStart(null)}
                  className="px-2.5 py-1.5 rounded-lg border border-[var(--bd)] hover:border-[var(--tx)] text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] whitespace-nowrap transition-colors disabled:opacity-50"
                >
                  Sin corte
                </button>
              )}
            </div>
          </section>

          {/* Franja unificada de 4 KPIs ROAS */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--bd)]">
            <div className="p-5">
              <div className="text-xs font-medium text-[var(--mu)]">Ventas del período</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
                {formatCurrency(totales.ventas)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1">{periodoLabel}</div>
            </div>
            <div className="p-5">
              <div className="text-xs font-medium text-[var(--mu)]">Gasto en Ads</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
                {formatCurrency(totales.gasto)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">{gastos.length} registros</div>
            </div>
            <div className="p-5">
              <div className="text-xs font-medium text-[var(--mu)]">Pedidos atribuidos</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
                {formatNumber(totales.pedidos)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1">Con código de anuncio</div>
            </div>
            <div className="p-5">
              <div className="text-xs font-medium text-[var(--mu)]">ROAS global</div>
              <div className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${roasColorClass(totales.roasGlobal)}`}>
                {formatRoas(totales.roasGlobal)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1">Retorno sobre pauta</div>
            </div>
          </section>

          {/* Tabla de ROAS por anuncio */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-[var(--tx)]">ROAS por anuncio</h2>
                <p className="text-xs text-[var(--mu)] mt-0.5">
                  Ventas de WhatsApp ÷ inversión publicitaria · {periodoLabel}
                </p>
              </div>
              <span className="text-xs text-[var(--mu)] tabular-nums">{filasRoas.length} campañas</span>
            </div>

            {cargando ? (
              <p className="px-5 py-10 text-center text-xs text-[var(--mu)]">Cargando...</p>
            ) : filasRoas.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-[var(--mu)]">
                Sin datos en este período. Registra un gasto o verifica que las órdenes tengan{' '}
                <code className="font-mono">codigo_anuncio</code>.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--bd)] text-xs">
                  <thead className="bg-sf/50 text-[var(--mu)]">
                    <tr>
                      <th className="px-5 py-3 text-left font-medium">Anuncio</th>
                      <th className="px-5 py-3 text-right font-medium">Pedidos</th>
                      <th className="px-5 py-3 text-right font-medium">Ventas</th>
                      <th className="px-5 py-3 text-right font-medium">Gasto</th>
                      <th className="px-5 py-3 text-right font-medium">ROAS</th>
                      <th className="px-5 py-3 text-right font-medium">CPA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--bd)]">
                    {filasRoas.map((fila) => (
                      <tr key={fila.codigo_anuncio} className="hover:bg-sf/40 transition-colors">
                        <td className="whitespace-nowrap px-5 py-3 font-medium text-[var(--tx)]">
                          <span className="font-mono">{fila.codigo_anuncio}</span>
                          {fila.producto_catalogo && (
                            <span className="block text-[11px] font-mono text-[var(--mu)] mt-0.5">
                              Catálogo #{fila.producto_catalogo}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-mono tabular-nums text-[var(--mu)]">
                          {formatNumber(fila.pedidos)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-mono tabular-nums font-medium text-[var(--tx)]">
                          {formatCurrency(fila.ventas)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-mono tabular-nums text-[var(--mu)]">
                          {formatCurrency(fila.gasto)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-5 py-3 text-right font-mono tabular-nums font-bold ${roasColorClass(fila.roas)}`}
                        >
                          {formatRoas(fila.roas)}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-mono tabular-nums text-[var(--mu)]">
                          {fila.cpa === null ? '—' : formatCurrency(fila.cpa)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Registro de gasto manual + Gastos registrados */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <section className="lg:col-span-5 rounded-xl border border-[var(--bd)] bg-cd overflow-hidden">
              <div className="px-5 py-4 border-b border-[var(--bd)]">
                <h2 className="text-sm font-semibold text-[var(--tx)]">Registrar gasto manual</h2>
                <p className="text-xs text-[var(--mu)] mt-0.5">Para plataformas sin sincronización automática</p>
              </div>

              <form onSubmit={handleSubmit} className="p-5 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1" htmlFor="fecha">
                    Fecha
                  </label>
                  <input
                    id="fecha"
                    type="date"
                    value={form.fecha}
                    onChange={(e) => actualizarCampo('fecha', e.target.value)}
                    className="w-full rounded-lg border border-[var(--bd)] bg-sf px-3 py-2 text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1" htmlFor="plataforma">
                    Plataforma
                  </label>
                  <select
                    id="plataforma"
                    value={form.plataforma}
                    onChange={(e) => actualizarCampo('plataforma', e.target.value)}
                    className="w-full rounded-lg border border-[var(--bd)] bg-sf px-3 py-2 text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  >
                    {PLATAFORMAS.map((plataforma) => (
                      <option key={plataforma} value={plataforma}>
                        {plataforma}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1" htmlFor="codigo">
                    Código de anuncio
                  </label>
                  <input
                    id="codigo"
                    type="text"
                    placeholder="PROMO1"
                    value={form.codigo_anuncio}
                    onChange={(e) => actualizarCampo('codigo_anuncio', e.target.value)}
                    className="w-full rounded-lg border border-[var(--bd)] bg-sf px-3 py-2 text-xs font-mono uppercase text-[var(--tx)] placeholder:normal-case placeholder:text-[var(--mu)] outline-none focus:border-[var(--tx)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1" htmlFor="monto">
                    Monto (USD)
                  </label>
                  <input
                    id="monto"
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={form.monto}
                    onChange={(e) => actualizarCampo('monto', e.target.value)}
                    className="w-full rounded-lg border border-[var(--bd)] bg-sf px-3 py-2 text-xs font-mono tabular-nums text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1" htmlFor="notas">
                    Notas
                  </label>
                  <input
                    id="notas"
                    type="text"
                    placeholder="Opcional"
                    value={form.notas}
                    onChange={(e) => actualizarCampo('notas', e.target.value)}
                    className="w-full rounded-lg border border-[var(--bd)] bg-sf px-3 py-2 text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  />
                </div>

                <div className="sm:col-span-2 pt-1">
                  <button
                    type="submit"
                    disabled={guardando}
                    className="w-full inline-flex items-center justify-center rounded-lg bg-[var(--tx)] px-4 py-2 text-xs font-semibold text-[var(--cd)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {guardando ? 'Guardando...' : 'Guardar gasto'}
                  </button>
                </div>
              </form>
            </section>

            <section className="lg:col-span-7 rounded-xl border border-[var(--bd)] bg-cd overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--bd)] px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--tx)]">Gastos registrados</h2>
                  <p className="text-xs text-[var(--mu)] mt-0.5">{periodoLabel}</p>
                </div>
                <span className="text-xs text-[var(--mu)] font-mono tabular-nums">{gastos.length}</span>
              </div>

              {cargando ? (
                <p className="px-5 py-10 text-center text-xs text-[var(--mu)]">Cargando...</p>
              ) : gastos.length === 0 ? (
                <p className="px-5 py-10 text-center text-xs text-[var(--mu)]">
                  Todavía no hay gastos cargados en este mes.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-[var(--bd)] text-xs">
                    <thead className="bg-sf/50 text-[var(--mu)]">
                      <tr>
                        <th className="px-5 py-3 text-left font-medium">Fecha</th>
                        <th className="px-5 py-3 text-left font-medium">Anuncio</th>
                        <th className="px-5 py-3 text-left font-medium">Plataforma</th>
                        <th className="px-5 py-3 text-right font-medium">Monto</th>
                        <th className="px-5 py-3 text-right font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--bd)]">
                      {gastos.map((gasto) => {
                        const isConfirming = confirmDeleteId === gasto.id
                        return (
                          <tr key={gasto.id} className="hover:bg-sf/40 transition-colors">
                            <td className="whitespace-nowrap px-5 py-3 font-mono tabular-nums text-[var(--mu)]">
                              {new Date(`${gasto.fecha}T00:00:00`).toLocaleDateString('es-SV')}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 font-mono font-medium text-[var(--tx)]">
                              {gasto.codigo_anuncio}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-[var(--mu)]">
                              {gasto.plataforma}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-right font-mono tabular-nums font-semibold text-[var(--tx)]">
                              {formatCurrency(Number(gasto.monto))}
                            </td>
                            <td className="whitespace-nowrap px-5 py-3 text-right">
                              {isConfirming ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    disabled={eliminandoId === gasto.id}
                                    onClick={() => void handleEliminar(gasto)}
                                    className="px-2 py-0.5 rounded bg-rose-600 text-white text-[11px] font-semibold"
                                  >
                                    {eliminandoId === gasto.id ? '...' : 'Eliminar'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="text-[11px] text-[var(--mu)] hover:text-[var(--tx)]"
                                  >
                                    Cancelar
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(gasto.id)}
                                  className="p-1 text-[var(--mu)] hover:text-rose-500 transition-colors"
                                  title="Eliminar gasto"
                                >
                                  <Trash2 size={13} />
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  )
}
