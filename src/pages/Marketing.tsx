import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Calculator,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  Megaphone,
  MousePointerClick,
  Package,
  Percent,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Truck,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)

const num = (v: string) => {
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/* ------------------------------------------------------------------ */
/* Sub-componentes internos                                            */
/* ------------------------------------------------------------------ */

function SectionCard({
  step,
  title,
  subtitle,
  icon,
  children,
}: {
  step: string
  title: string
  subtitle: string
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-[var(--bd)] bg-[var(--cd)] p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-indigo-500">
            {step}
          </p>
          <h2 className="text-base font-semibold text-[var(--tx)]">{title}</h2>
          <p className="mt-0.5 text-xs text-[var(--tx)] opacity-60">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

function NumberField({
  label,
  icon,
  value,
  onChange,
  suffix,
  placeholder,
}: {
  label: string
  icon: ReactNode
  value: string
  onChange: (v: string) => void
  suffix?: string
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--tx)] opacity-60">
        {icon}
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--bd)] bg-[var(--cd)] px-3 py-2 transition focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
        <input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={value}
          placeholder={placeholder ?? '0.00'}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-sm font-semibold text-[var(--tx)] outline-none placeholder:font-normal placeholder:text-[var(--tx)] placeholder:opacity-30"
        />
        {suffix && (
          <span className="shrink-0 text-[11px] font-medium text-[var(--tx)] opacity-50">
            {suffix}
          </span>
        )}
      </div>
    </label>
  )
}

/* ------------------------------------------------------------------ */
/* Página                                                              */
/* ------------------------------------------------------------------ */

export function MarketingPage() {
  /* --- Sección 1: Estudio de mercado --- */
  const [marketLow, setMarketLow] = useState('')
  const [marketHigh, setMarketHigh] = useState('')

  /* --- Sección 2: Costos --- */
  const [productCost, setProductCost] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [cpa, setCpa] = useState('')
  const [margin, setMargin] = useState('30')

  /* --- Sección 4: IA --- */
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState('')
  const [aiError, setAiError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  /* ------------------------- Derivados ------------------------- */

  const market = useMemo(() => {
    const low = num(marketLow)
    const high = num(marketHigh)
    const hasData = marketLow.trim() !== '' && marketHigh.trim() !== ''
    const avg = hasData ? (low + high) / 2 : 0
    return { low, high, avg, hasData }
  }, [marketLow, marketHigh])

  const costs = useMemo(() => {
    const product = num(productCost)
    const shipping = num(shippingCost)
    const cpaValue = num(cpa)
    const total = product + shipping + cpaValue
    const marginPct = Math.min(Math.max(num(margin), 0), 95)
    const ideal = total > 0 ? total / (1 - marginPct / 100) : 0
    const profit = ideal - total
    return { product, shipping, cpa: cpaValue, total, marginPct, ideal, profit }
  }, [productCost, shippingCost, cpa, margin])

  const comparison = useMemo(() => {
    if (!market.hasData || costs.ideal <= 0) return { status: 'idle' as const, diff: 0 }
    const diff = costs.ideal - market.avg
    return {
      status: diff > 0 ? ('risk' as const) : ('opportunity' as const),
      diff,
    }
  }, [market, costs])

  /* --------------------------- IA --------------------------- */

  const generateStrategy = async () => {
    setAiError(null)
    setCopied(false)

    if (costs.total <= 0) {
      setAiError('Ingresa al menos un costo para generar una estrategia coherente.')
      return
    }

    setAiLoading(true)
    setAiResult('')

    try {
      // 🔥 LLAMAMOS A NUESTRA API SEGURA EN VERCEL
      const res = await fetch('/api/generate-copy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          marketLow: market.low,
          marketHigh: market.high,
          marketAvg: market.avg,
          productCost: costs.product,
          shippingCost: costs.shipping,
          cpa: costs.cpa,
          totalCost: costs.total,
          marginPct: costs.marginPct,
          idealPrice: costs.ideal,
          profit: costs.profit,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Error al generar la estrategia.')
      }

      setAiResult(data.copy)
    } catch (err: any) {
      setAiError(err.message || 'Error desconocido al generar la estrategia.')
    } finally {
      setAiLoading(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(aiResult)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setAiError('No se pudo copiar al portapapeles. Copia el texto manualmente.')
    }
  }

  /* --------------------------- Render --------------------------- */

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      {/* Header */}
      <header className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">
          <Megaphone className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Pricing &amp; Promo Studio
          </h1>
          <p className="mt-1 text-sm text-[var(--tx)] opacity-60">
            Estudio de mercado, calculadora de precio ideal y generador de ofertas con IA.
          </p>
        </div>
      </header>

      {/* Secciones 1 y 2 */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* SECCIÓN 1 */}
        <SectionCard
          step="Paso 1"
          title="Estudio de Mercado"
          subtitle="Ingresa los precios que encontraste en la competencia."
          icon={<Target className="h-4 w-4" />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Precio más bajo"
              icon={<TrendingDown className="h-3 w-3" />}
              value={marketLow}
              onChange={setMarketLow}
              suffix="USD"
            />
            <NumberField
              label="Precio más alto"
              icon={<TrendingUp className="h-3 w-3" />}
              value={marketHigh}
              onChange={setMarketHigh}
              suffix="USD"
            />
          </div>

          <div className="mt-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 text-center">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tx)] opacity-60">
              Precio promedio del mercado
            </p>
            <p className="mt-1 text-4xl font-bold tracking-tight text-indigo-500">
              {usd(market.avg)}
            </p>
            {market.hasData && (
              <p className="mt-1 text-xs text-[var(--tx)] opacity-50">
                Rango {usd(market.low)} — {usd(market.high)}
              </p>
            )}
          </div>
        </SectionCard>

        {/* SECCIÓN 2 */}
        <SectionCard
          step="Paso 2"
          title="Calculadora de Costos"
          subtitle="Costos operativos + margen deseado = precio ideal."
          icon={<Calculator className="h-4 w-4" />}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Costo del producto"
              icon={<Package className="h-3 w-3" />}
              value={productCost}
              onChange={setProductCost}
              suffix="USD"
            />
            <NumberField
              label="Costo de envío"
              icon={<Truck className="h-3 w-3" />}
              value={shippingCost}
              onChange={setShippingCost}
              suffix="USD"
            />
            <NumberField
              label="CPA estimado"
              icon={<MousePointerClick className="h-3 w-3" />}
              value={cpa}
              onChange={setCpa}
              suffix="USD"
            />
            <NumberField
              label="Margen deseado"
              icon={<Percent className="h-3 w-3" />}
              value={margin}
              onChange={setMargin}
              suffix="%"
              placeholder="30"
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tx)] opacity-60">
                Precio ideal de venta
              </p>
              <p className="mt-1 text-2xl font-bold text-indigo-500">{usd(costs.ideal)}</p>
            </div>
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--tx)] opacity-60">
                Utilidad neta estimada
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-500">{usd(costs.profit)}</p>
            </div>
          </div>

          <p className="mt-3 text-xs text-[var(--tx)] opacity-50">
            Costo total unitario: <span className="font-semibold">{usd(costs.total)}</span> · Fórmula:
            Costos totales / (1 − margen)
          </p>
        </SectionCard>
      </div>

      {/* SECCIÓN 3 */}
      <SectionCard
        step="Paso 3"
        title="Análisis Estratégico"
        subtitle="Comparamos tu precio ideal contra el promedio del mercado."
        icon={<Target className="h-4 w-4" />}
      >
        {comparison.status === 'idle' && (
          <div className="flex items-start gap-3 rounded-xl border border-[var(--bd)] bg-[var(--cd)] p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--tx)] opacity-40" />
            <p className="text-sm text-[var(--tx)] opacity-60">
              Completa los precios de mercado y los costos para ver el semáforo estratégico.
            </p>
          </div>
        )}

        {comparison.status === 'risk' && (
          <div className="flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-500" />
            <div>
              <p className="font-semibold text-rose-500">Riesgo: precio por encima del mercado</p>
              <p className="mt-1 text-sm text-[var(--tx)] opacity-80">
                Tu precio ideal ({usd(costs.ideal)}) está{' '}
                <span className="font-semibold">{usd(Math.abs(comparison.diff))}</span> por encima del
                promedio del mercado ({usd(market.avg)}). Sugerencia: arma un bundle o reduce costos
                (envío o CPA).
              </p>
            </div>
          </div>
        )}

        {comparison.status === 'opportunity' && (
          <div className="flex items-start gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
            <div>
              <p className="font-semibold text-emerald-500">Oportunidad competitiva</p>
              <p className="mt-1 text-sm text-[var(--tx)] opacity-80">
                Tu precio ideal ({usd(costs.ideal)}) está{' '}
                <span className="font-semibold">{usd(Math.abs(comparison.diff))}</span> por debajo del
                promedio del mercado ({usd(market.avg)}). Tienes margen para posicionarte por encima
                de tu costo y ser competitivo.
              </p>
            </div>
          </div>
        )}
      </SectionCard>

      {/* SECCIÓN 4 */}
      <SectionCard
        step="Paso 4"
        title="Generador de Ofertas con IA"
        subtitle="La IA convierte tus números en una oferta y un copy listos para publicar."
        icon={<Sparkles className="h-4 w-4" />}
      >
        <button
          type="button"
          onClick={generateStrategy}
          disabled={aiLoading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {aiLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {aiLoading ? 'Generando estrategia…' : '✨ Generar Estrategia de Venta con IA'}
        </button>

        {aiError && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
            <p className="text-sm text-rose-500">{aiError}</p>
          </div>
        )}

        {aiResult && (
          <div className="mt-4 rounded-xl border border-[var(--bd)] bg-[var(--cd)] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-indigo-500">
                <Sparkles className="h-3.5 w-3.5" />
                Estrategia generada
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--bd)] px-3 py-1.5 text-xs font-medium text-[var(--tx)] transition hover:bg-indigo-500/10"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" /> Copiado
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copiar texto
                  </>
                )}
              </button>
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-[var(--tx)]">
              {aiResult}
            </pre>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
