import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Boxes,
  ClipboardList,
  MessageSquare,
  Moon,
  PieChart,
  Store,
  Sun,
  TrendingUp,
  Wallet,
  Activity,
  Zap,
} from 'lucide-react';
import { enterDemoMode } from '@/lib/demoMode';
import { DEMO_BRAND } from '@/lib/demoDataset';
import { TelegramCopilotSimulator } from '@/components/demo/TelegramCopilotSimulator';

const PILLARS = [
  {
    index: '01.',
    title: 'Ventas Conversacionales en WhatsApp (Todd)',
    goal: 'Convertir tráfico de Meta/TikTok Ads sin saturar agentes humanos.',
    mechanism: 'Catálogo conectado a stock físico real, variantes, reglas de upsell y captura estructurada de pedidos COD.',
    outcome: 'Cierres 24/7 con trazabilidad de anuncio origen y traspaso instantáneo a humano en UniChat.',
    route: '/unichat',
    cta: 'Ver UniChat',
  },
  {
    index: '02.',
    title: 'Logística COD, Alistado y Auditoría',
    goal: 'Eliminar errores de empaque, fugas de guías y analítica contaminada.',
    mechanism: 'Consolidación automática por producto y por departamento/courier, portal móvil para repartidores y archivo histórico tras auditoría de 3 puntos.',
    outcome: 'Despacho más rápido, control exacto del dinero en calle y métricas limpias.',
    route: '/pedidos',
    cta: 'Ver Pedidos y Alistado',
  },
  {
    index: '03.',
    title: 'Licitación Masiva de Proveedores (Klaus)',
    goal: 'Reducir el costo de reposición sin negociar proveedor por proveedor.',
    mechanism: 'Subastas simultáneas por WhatsApp con comparación automática de pujas, tiempos de entrega y adjudicación conectada al Kárdex.',
    outcome: 'Ahorro directo en COGS y reposición coordinada con días reales de cobertura.',
    route: '/proveedores',
    cta: 'Ver Licitaciones',
  },
  {
    index: '04.',
    title: 'OS Brain y Copiloto Ejecutivo en Telegram',
    goal: 'Tomar decisiones diarias con inferencia real, no con reportes tardíos.',
    mechanism: 'Bus de eventos auditable, memoria operativa diaria y 6 motores estadísticos + contrafactuales accesibles desde Telegram por texto o voz.',
    outcome: 'Detección temprana de anuncios engañosos, rechazos COD y quiebres de stock.',
    route: '/event-stream',
    cta: 'Ver OS Brain',
  },
];

const INFERENCE_ENGINES = [
  {
    name: 'ROAS Real Post-Entrega',
    detail: 'Descuenta cancelaciones y COGS por SKU para distinguir ganadores reales de anuncios con alto rechazo.',
  },
  {
    name: 'Scoring de Riesgo Pre-Despacho',
    detail: 'Suavizado bayesiano por departamento, courier, producto e historial del teléfono antes de empacar.',
  },
  {
    name: 'Diagnóstico Causal del Día',
    detail: 'Compara el ritmo por hora frente al mismo día de la semana separando caída de tráfico vs. cierre.',
  },
  {
    name: 'Quiebre de Stock × Caja',
    detail: 'Cruza velocidad ponderada (7d/14d) y encargos contra liquidez real y compromisos a 15 días.',
  },
  {
    name: 'Simulador Contrafactual',
    detail: 'Calcula escenarios hipotéticos de pauta o metas usando ticket, margen y quema real del negocio.',
  },
  {
    name: 'Minería de Objeciones',
    detail: 'Analiza conversaciones no cerradas para descubrir fricciones de flete, horarios y demanda de combos.',
  },
];

const MODULE_SHORTCUTS = [
  { label: 'Resumen Diario', desc: 'Pulso operativo y alertas del día', route: '/', icon: Zap },
  { label: 'Pedidos & Alistado', desc: 'Kanban, picking, couriers y auditoría', route: '/pedidos', icon: ClipboardList },
  { label: 'Rentabilidad & ROAS', desc: 'Atribución por anuncio y margen neto', route: '/rentabilidad', icon: TrendingUp },
  { label: 'Finanzas & Liquidez', desc: 'Cuentas, dinero en calle y presupuestos', route: '/finanzas', icon: Wallet },
  { label: 'Proveedores & Klaus', desc: 'Subastas masivas y comparativo de pujas', route: '/proveedores', icon: Store },
  { label: 'UniChat WhatsApp IA', desc: 'Hilos de Todd y toma de control', route: '/unichat', icon: MessageSquare },
  { label: 'Inventario & Kárdex', desc: 'Stock físico, reservado y trazabilidad', route: '/inventario', icon: Boxes },
  { label: 'OS Brain & Analítica', desc: 'Event stream, memoria y cohortes LTV', route: '/analitica', icon: PieChart },
];

export function DemoLandingPage() {
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
    return stored === 'dark' ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--tx)] flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-cd/95 backdrop-blur-md border-b border-[var(--bd)]">
        <div className="max-w-[1200px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
          <a
            href="/demo"
            className="text-base font-bold tracking-tight text-[var(--tx)] whitespace-nowrap shrink-0"
          >
            {DEMO_BRAND.platformName}
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[var(--mu)]">
            <a href="#plataforma" className="hover:text-[var(--tx)] transition-colors whitespace-nowrap shrink-0">
              Plataforma
            </a>
            <a href="#motores" className="hover:text-[var(--tx)] transition-colors whitespace-nowrap shrink-0">
              Motores IA
            </a>
            <a href="#inferencia" className="hover:text-[var(--tx)] transition-colors whitespace-nowrap shrink-0">
              Inferencia
            </a>
            <a href="#modulos" className="hover:text-[var(--tx)] transition-colors whitespace-nowrap shrink-0">
              Módulos
            </a>
          </nav>

          <button
            type="button"
            onClick={() => enterDemoMode('/')}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
          >
            Abrir Demo Interactiva
          </button>
        </div>
      </header>

      {/* Main Editorial Content */}
      <main id="plataforma" className="flex-1">
        {/* Hero Section */}
        <section className="max-w-[1200px] mx-auto px-6 pt-16 pb-14 lg:pt-20 lg:pb-16">
          <div className="max-w-3xl">
            <p className="text-xs font-medium tx-mu mb-4">
              Demo Interactiva Sandbox · Comercio Conversacional y COD en LATAM · Sin registro
            </p>
            <h1
              className="text-3xl sm:text-5xl font-bold tracking-tight text-[var(--tx)] leading-[1.12]"
              style={{ textWrap: 'balance' }}
            >
              El sistema operativo con IA para comercios contra entrega en Latinoamérica.
            </h1>
            <p className="mt-5 text-base sm:text-lg tx-mu leading-relaxed max-w-2xl">
              Unifica ventas por WhatsApp, alistado y couriers, licitación masiva de proveedores,
              liquidez real en calle e inferencia predictiva en Telegram. Validado en producción
              sobre operación propia como Cliente #0 y preparado para escalar multi-empresa.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => enterDemoMode('/')}
                className="px-5 py-3 rounded-lg text-sm font-semibold bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 transition-opacity inline-flex items-center gap-2 whitespace-nowrap"
              >
                Explorar Panel Interactivo
                <ArrowRight size={16} />
              </button>
              <button
                type="button"
                onClick={() => setCopilotOpen(true)}
                className="px-5 py-3 rounded-lg text-sm font-semibold bg-cd border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--tx)] transition-colors inline-flex items-center gap-2 whitespace-nowrap"
              >
                <Bot size={16} />
                Probar Copiloto Telegram IA
              </button>
            </div>
          </div>

          {/* Full-width 4-Column Quantitative Strip */}
          <div className="mt-14 pt-8 border-t border-[var(--bd)] grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            <div>
              <div className="text-2xl sm:text-3xl font-bold mono tabular-nums text-[var(--tx)]">4</div>
              <div className="text-sm font-semibold mt-1">Motores autónomos</div>
              <p className="text-xs tx-mu mt-0.5">Ventas WhatsApp, logística COD, compras y copiloto</p>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-bold mono tabular-nums text-[var(--tx)]">6</div>
              <div className="text-sm font-semibold mt-1">Inferencias predictivas</div>
              <p className="text-xs tx-mu mt-0.5">ROAS post-entrega, riesgo COD, stock y simulador</p>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-bold mono tabular-nums text-[var(--tx)]">100%</div>
              <div className="text-sm font-semibold mt-1">Aislamiento sandbox</div>
              <p className="text-xs tx-mu mt-0.5">Datos sintéticos de Nexo Store LATAM en memoria</p>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-bold mono tabular-nums text-[var(--tx)]">1 clic</div>
              <div className="text-sm font-semibold mt-1">Acceso inmediato</div>
              <p className="text-xs tx-mu mt-0.5">Interactúa con Kanban, Alistado, Finanzas e IA</p>
            </div>
          </div>
        </section>

        {/* Section 1: 4 Automation Pillars */}
        <section id="motores" className="border-t border-[var(--bd)] bg-cd">
          <div className="max-w-[1200px] mx-auto px-6 py-16">
            <div className="max-w-2xl mb-10">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Cuatro motores integrados sobre un mismo núcleo de datos
              </h2>
              <p className="mt-2 text-sm sm:text-base tx-mu">
                Cada módulo comparte el mismo libro de pedidos, inventario, caja y bus de eventos.
                No requiere hojas de cálculo paralelas ni integraciones frágiles.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {PILLARS.map((p) => (
                <div
                  key={p.index}
                  className="p-6 rounded-xl bg-[var(--bg)] border border-[var(--bd)] flex flex-col justify-between gap-5"
                >
                  <div>
                    <div className="text-xs font-semibold mono tx-mu mb-1.5">{p.index}</div>
                    <h3 className="text-lg font-semibold text-[var(--tx)]">{p.title}</h3>
                    <div className="mt-4 space-y-2.5 text-sm">
                      <p className="tx-mu leading-relaxed">
                        <span className="font-semibold text-[var(--tx)]">Problema: </span>
                        {p.goal}
                      </p>
                      <p className="tx-mu leading-relaxed">
                        <span className="font-semibold text-[var(--tx)]">Mecanismo: </span>
                        {p.mechanism}
                      </p>
                      <p className="tx-mu leading-relaxed">
                        <span className="font-semibold text-[var(--tx)]">Resultado: </span>
                        {p.outcome}
                      </p>
                    </div>
                  </div>
                  <div className="pt-3 border-t border-[var(--bd)]">
                    <button
                      type="button"
                      onClick={() => enterDemoMode(p.route)}
                      className="text-xs font-semibold text-[var(--tx)] hover:underline inline-flex items-center gap-1.5"
                    >
                      {p.cta}
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 2: Predictive Inference Layer */}
        <section id="inferencia" className="border-t border-[var(--bd)]">
          <div className="max-w-[1200px] mx-auto px-6 py-16">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
              <div className="max-w-2xl">
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Capa de inferencia estadística y simulador ejecutivo
                </h2>
                <p className="mt-2 text-sm sm:text-base tx-mu">
                  A diferencia de un ERP pasivo, el sistema transforma el historial de entregas,
                  anuncios, chats y caja en decisiones accionables antes de perder margen.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCopilotOpen(true)}
                className="px-4 py-2.5 rounded-lg text-xs font-semibold bg-cd border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--tx)] transition-colors inline-flex items-center gap-2 self-start lg:self-auto whitespace-nowrap shrink-0"
              >
                <Activity size={14} />
                Ejecutar /radar en vivo
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-7 pt-6 border-t border-[var(--bd)]">
              {INFERENCE_ENGINES.map((eng, i) => (
                <div key={eng.name} className="flex flex-col gap-1.5">
                  <div className="text-xs mono tx-mu">0{i + 1}</div>
                  <h3 className="text-sm font-semibold text-[var(--tx)]">{eng.name}</h3>
                  <p className="text-xs tx-mu leading-relaxed">{eng.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Section 3: Direct Module Tour */}
        <section id="modulos" className="border-t border-[var(--bd)] bg-cd">
          <div className="max-w-[1200px] mx-auto px-6 py-16">
            <div className="max-w-2xl mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                Recorrido directo por módulos del sandbox
              </h2>
              <p className="mt-2 text-sm sm:text-base tx-mu">
                Puedes editar pedidos, asignar couriers en Alistado, auditar entregados o simular
                consultas del bot. Todos los cambios viven localmente en tu sesión.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {MODULE_SHORTCUTS.map((mod) => {
                const Icon = mod.icon;
                return (
                  <button
                    key={mod.route}
                    type="button"
                    onClick={() => enterDemoMode(mod.route)}
                    className="p-4 rounded-xl bg-[var(--bg)] border border-[var(--bd)] hover:border-[var(--tx)] transition-colors text-left flex flex-col justify-between gap-4 group"
                  >
                    <div className="flex items-center justify-between">
                      <Icon size={17} className="text-[var(--mu)] group-hover:text-[var(--tx)] transition-colors" />
                      <ArrowRight
                        size={14}
                        className="text-[var(--mu)] group-hover:text-[var(--tx)] transition-transform group-hover:translate-x-0.5"
                      />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-[var(--tx)]">{mod.label}</div>
                      <div className="text-xs tx-mu mt-0.5">{mod.desc}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      </main>

      {/* Quiet Footer */}
      <footer className="border-t border-[var(--bd)] bg-[var(--bg)]">
        <div className="max-w-[1200px] mx-auto px-6 py-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs tx-mu">
          <div>
            {DEMO_BRAND.platformName} · Entorno demostrativo aislado ({DEMO_BRAND.storeName}) · Datos 100% sintéticos sin conexión a producción.
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <button
              type="button"
              onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
              className="inline-flex items-center gap-1.5 text-xs tx-mu hover:text-[var(--tx)] transition-colors"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
            </button>
            <button
              type="button"
              onClick={() => enterDemoMode('/')}
              className="font-semibold text-[var(--tx)] hover:underline"
            >
              Entrar al panel →
            </button>
          </div>
        </div>
      </footer>

      <TelegramCopilotSimulator open={copilotOpen} onClose={() => setCopilotOpen(false)} />
    </div>
  );
}
