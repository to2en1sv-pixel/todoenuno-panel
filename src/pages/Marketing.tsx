import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  MousePointerClick,
  Package,
  Percent,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
} from 'lucide-react'

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

function SectionCard({
  step,
  title,
  subtitle,
  children,
}: {
  step: string
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-[var(--bd)] bg-cd overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--bd)] flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--tx)]">{title}</h2>
          <p className="mt-0.5 text-xs text-[var(--mu)]">{subtitle}</p>
        </div>
        <span className="text-xs font-medium text-[var(--mu)] shrink-0">{step}</span>
      </div>
      <div className="p-5">{children}</div>
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
      <span className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--mu)]">
        {icon}
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-lg border border-[var(--bd)] bg-sf px-3 py-2 transition focus-within:border-[var(--tx)]">
        <input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={value}
          placeholder={placeholder ?? '0.00'}
          onChange={(e) => onChange(e.target.value)}
          className="w-full bg-transparent text-sm font-semibold font-mono tabular-nums text-[var(--tx)] outline-none placeholder:font-normal placeholder:text-[var(--mu)]"
        />
        {suffix && (
          <span className="shrink-0 text-xs font-medium text-[var(--mu)]">{suffix}</span>
        )}
      </div>
    </label>
  )
}

export function MarketingPage() {
  const [productName, setProductName] = useState('')
  const [marketLow, setMarketLow] = useState('')
  const [marketHigh, setMarketHigh] = useState('')
  const [productCost, setProductCost] = useState('')
  const [shippingCost, setShippingCost] = useState('')
  const [cpa, setCpa] = useState('')
  const [margin, setMargin] = useState('30')

  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState('')
  const [aiError, setAiError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

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

  const generateStrategy = async () => {
    setAiError(null)
    setCopied(false)

    if (!productName.trim()) {
      setAiError('Escribe el nombre del producto para que la IA sepa qué está vendiendo.')
      return
    }

    if (costs.total <= 0) {
      setAiError('Ingresa al menos un costo para generar una estrategia coherente.')
      return
    }

    setAiLoading(true)
    setAiResult('')

    try {
      const res = await fetch('/api/generate-copy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productName,
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
      if (!res.ok) throw new Error(data.error || 'Error al generar la estrategia.')
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
      setAiError('No se pudo copiar al portapapeles.')
    }
  }

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Pricing &amp; Promo
          </h1>
          <p className="text-xs text-[var(--mu)] mt-1">
            Estudio de mercado, calculadora de precio ideal y generador de ofertas comerciales
          </p>
        </div>

        <button
          type="button"
          onClick={generateStrategy}
          disabled={aiLoading}
          className="px-4 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-opacity disabled:opacity-50"
        >
          {aiLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          {aiLoading ? 'Generando estrategia...' : 'Generar estrategia IA'}
        </button>
      </header>

      {/* Producto a analizar */}
      <SectionCard
        step="Producto"
        title="Producto a analizar"
        subtitle="Define el nombre comercial o categoría del producto"
      >
        <input
          type="text"
          value={productName}
          placeholder="Ej. Pulsera Magnética, Encendedor Recargable..."
          onChange={(e) => setProductName(e.target.value)}
          className="w-full rounded-lg border border-[var(--bd)] bg-sf px-3.5 py-2.5 text-sm font-medium text-[var(--tx)] outline-none focus:border-[var(--tx)] placeholder:text-[var(--mu)]"
        />
      </SectionCard>

      {/* Estudio de mercado y calculadora */}
      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard
          step="Paso 1"
          title="Estudio de mercado"
          subtitle="Precios observados en competencia directa"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Precio más bajo"
              icon={<TrendingDown className="h-3.5 w-3.5" />}
              value={marketLow}
              onChange={setMarketLow}
              suffix="USD"
            />
            <NumberField
              label="Precio más alto"
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              value={marketHigh}
              onChange={setMarketHigh}
              suffix="USD"
            />
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--bd)] flex items-baseline justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--mu)]">Precio promedio de mercado</p>
              {market.hasData && (
                <p className="mt-0.5 text-xs text-[var(--mu)] font-mono tabular-nums">
                  Rango {usd(market.low)} — {usd(market.high)}
                </p>
              )}
            </div>
            <p className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)]">
              {usd(market.avg)}
            </p>
          </div>
        </SectionCard>

        <SectionCard
          step="Paso 2"
          title="Calculadora de costos"
          subtitle="Costos operativos + margen deseado = precio ideal"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <NumberField
              label="Costo del producto"
              icon={<Package className="h-3.5 w-3.5" />}
              value={productCost}
              onChange={setProductCost}
              suffix="USD"
            />
            <NumberField
              label="Costo de envío"
              icon={<Truck className="h-3.5 w-3.5" />}
              value={shippingCost}
              onChange={setShippingCost}
              suffix="USD"
            />
            <NumberField
              label="CPA estimado"
              icon={<MousePointerClick className="h-3.5 w-3.5" />}
              value={cpa}
              onChange={setCpa}
              suffix="USD"
            />
            <NumberField
              label="Margen deseado"
              icon={<Percent className="h-3.5 w-3.5" />}
              value={margin}
              onChange={setMargin}
              suffix="%"
              placeholder="30"
            />
          </div>

          <div className="mt-5 pt-4 border-t border-[var(--bd)] grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-[var(--mu)]">Costo unitario</p>
              <p className="mt-0.5 text-base font-bold font-mono tabular-nums text-[var(--tx)]">
                {usd(costs.total)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--mu)]">Precio ideal</p>
              <p className="mt-0.5 text-base font-bold font-mono tabular-nums text-[var(--tx)]">
                {usd(costs.ideal)}
              </p>
            </div>
            <div>
              <p className="text-xs text-[var(--mu)]">Utilidad neta</p>
              <p className="mt-0.5 text-base font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                {usd(costs.profit)}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Análisis estratégico */}
      <SectionCard
        step="Paso 3"
        title="Análisis estratégico"
        subtitle="Comparación de tu precio ideal contra el promedio de mercado"
      >
        {comparison.status === 'idle' && (
          <div className="flex items-center gap-3 text-xs text-[var(--mu)]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Completa los precios de mercado y los costos para ver el semáforo estratégico.</span>
          </div>
        )}

        {comparison.status === 'risk' && (
          <div className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-4">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <div>
              <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                Riesgo: precio por encima del mercado
              </p>
              <p className="mt-1 text-xs text-[var(--tx)] opacity-85">
                Tu precio ideal ({usd(costs.ideal)}) está{' '}
                <span className="font-semibold font-mono tabular-nums">{usd(Math.abs(comparison.diff))}</span> por encima del
                promedio ({usd(market.avg)}). Sugerencia: arma un bundle o optimiza costos.
              </p>
            </div>
          </div>
        )}

        {comparison.status === 'opportunity' && (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                Oportunidad competitiva
              </p>
              <p className="mt-1 text-xs text-[var(--tx)] opacity-85">
                Tu precio ideal ({usd(costs.ideal)}) está{' '}
                <span className="font-semibold font-mono tabular-nums">{usd(Math.abs(comparison.diff))}</span> por debajo del
                promedio ({usd(market.avg)}). Tienes margen para posicionarte y escalar.
              </p>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Generador IA */}
      <SectionCard
        step="Paso 4"
        title="Generador de ofertas y copy"
        subtitle="Convierte tus números en una propuesta comercial lista para publicar"
      >
        <button
          type="button"
          onClick={generateStrategy}
          disabled={aiLoading}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--tx)] px-5 py-3 text-xs font-semibold text-[var(--cd)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {aiLoading ? 'Generando estrategia...' : 'Generar estrategia de venta'}
        </button>

        {aiError && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <p className="text-xs text-rose-700 dark:text-rose-300">{aiError}</p>
          </div>
        )}

        {aiResult && (
          <div className="mt-4 rounded-lg border border-[var(--bd)] bg-sf p-4">
            <div className="mb-3 pb-2.5 border-b border-[var(--bd)] flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold text-[var(--tx)]">
                Estrategia generada
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--bd)] bg-cd px-3 py-1.5 text-xs font-medium text-[var(--tx)] transition-colors hover:bg-sf"
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
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[var(--tx)]">
              {aiResult}
            </pre>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
