import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle, Calculator, Check, CheckCircle2, Copy, Loader2,
  Megaphone, MousePointerClick, Package, Percent, Sparkles, Target,
  TrendingDown, TrendingUp, Truck, Tag
} from 'lucide-react'

// ... (los helpers `usd` y `num` quedan igual) ...
const usd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0)
const num = (v: string) => { const n = Number.parseFloat(v); return Number.isFinite(n) ? n : 0 }

// ... (SectionCard y NumberField quedan igual) ...

export function MarketingPage() {
  // NUEVO: Estado para el nombre del producto
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

  // ... (los useMemo de market, costs y comparison quedan igual) ...
  const market = useMemo(() => { /* ... */ }, [marketLow, marketHigh])
  const costs = useMemo(() => { /* ... */ }, [productCost, shippingCost, cpa, margin])
  const comparison = useMemo(() => { /* ... */ }, [market, costs])

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
          productName, // <--- NUEVO: Enviamos el nombre
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

  // ... (handleCopy queda igual) ...

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
      <header className="flex items-start gap-4">
        {/* ... header ... */}
      </header>

      {/* NUEVO: Tarjeta de Nombre del Producto */}
      <section className="rounded-2xl border border-[var(--bd)] bg-[var(--cd)] p-5 shadow-sm">
        <div className="mb-4 flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
            <Tag className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--tx)]">Producto a Analizar</h2>
            <p className="mt-0.5 text-xs text-[var(--tx)] opacity-60">Dile a la IA qué producto está vendiendo.</p>
          </div>
        </div>
        <label className="block">
          <div className="flex items-center gap-2 rounded-xl border border-[var(--bd)] bg-[var(--cd)] px-3 py-2 transition focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
            <input
              type="text"
              value={productName}
              placeholder="Ej. Pulsera Magnética, Encendedor Recargable..."
              onChange={(e) => setProductName(e.target.value)}
              className="w-full bg-transparent text-sm font-semibold text-[var(--tx)] outline-none placeholder:font-normal placeholder:text-[var(--tx)] placeholder:opacity-30"
            />
          </div>
        </label>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ... Sección 1 ... */}
        {/* ... Sección 2 ... */}
      </div>

      {/* ... Sección 3 ... */}

      {/* SECCIÓN 4 */}
      <section className="rounded-2xl border border-[var(--bd)] bg-[var(--cd)] p-5 shadow-sm">
        {/* ... botón de IA y resultados ... */}
      </section>
    </div>
  )
}
