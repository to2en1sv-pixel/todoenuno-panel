import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProductos } from '@/hooks/useCatalog';
import { 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  ShieldCheck, 
  Database, 
  Activity, 
  Clock, 
  Server, 
  Radio, 
  Layers, 
  Code,
  Sparkles,
  ExternalLink,
  Copy,
  Check
} from 'lucide-react';
import { EventStreamViewer } from '@/components/events/EventStreamViewer';

type CronJob = {
  id: string;
  title: string;
  url: string;
  lastStatus: number;
  lastStatusText: string;
  lastExecution: number;
  nextExecution: number;
};

export function SistemaPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'stream';
  const [activeTab, setActiveTab] = useState<'stream' | 'crons' | 'architecture'>(
    initialTab === 'crons' || initialTab === 'architecture' ? initialTab : 'stream'
  );

  const productos = useProductos();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState('');
  const [copiedScript, setCopiedScript] = useState(false);

  const handleTabChange = (tab: 'stream' | 'crons' | 'architecture') => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const checkCrons = async () => {
    setIsChecking(true);
    setError('');
    try {
      const res = await fetch('/api/cron-status');
      const textResponse = await res.text();
      let data;
      try {
        data = JSON.parse(textResponse);
      } catch {
        throw new Error('El endpoint /api/cron-status devolvió un formato no esperado.');
      }

      if (!res.ok) throw new Error(data.details || data.error || 'Error en el servidor');
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'crons') {
      checkCrons();
    }
  }, [activeTab]);

  const fmtTime = (ts: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 pb-12">
      {/* Encabezado General */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Server size={22} className="text-[var(--ac)]" />
            <h1 className="text-xl font-bold">Sistema & Arquitectura OS</h1>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1">
            Gestión del núcleo de eventos (Sprint 1), tareas cron programadas e infraestructura de datos.
          </p>
        </div>

        {/* Selector de Pestañas */}
        <div className="flex items-center p-1 bg-sf rounded-xl border border-[var(--bd)] w-full sm:w-auto">
          <button
            onClick={() => handleTabChange('stream')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'stream'
                ? 'bg-[var(--tx)] text-[var(--cd)] shadow-sm'
                : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <Radio size={14} className={activeTab === 'stream' ? 'text-emerald-400' : ''} />
            Event Stream
          </button>
          <button
            onClick={() => handleTabChange('crons')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'crons'
                ? 'bg-[var(--tx)] text-[var(--cd)] shadow-sm'
                : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <Activity size={14} />
            Crons
          </button>
          <button
            onClick={() => handleTabChange('architecture')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'architecture'
                ? 'bg-[var(--tx)] text-[var(--cd)] shadow-sm'
                : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <Layers size={14} />
            Arquitectura
          </button>
        </div>
      </div>

      {/* PESTAÑA 1: EVENT STREAM (PASO 5) */}
      {activeTab === 'stream' && (
        <EventStreamViewer />
      )}

      {/* PESTAÑA 2: CRONS */}
      {activeTab === 'crons' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2 flex flex-col gap-4">
            <section className="bg-cd border border-[var(--bd)] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xs font-bold tx-mu uppercase tracking-wider flex items-center gap-2">
                  <Activity size={14} /> Tareas Programadas (cron-job.org)
                </h2>
                <button 
                  onClick={checkCrons}
                  disabled={isChecking}
                  className="px-3 py-1.5 bg-sf border border-[var(--bd)] text-xs font-semibold rounded-lg flex items-center gap-1.5 hover:bg-black/5 disabled:opacity-50"
                >
                  <RefreshCw size={13} className={isChecking ? 'animate-spin' : ''} />
                  {isChecking ? 'Verificando...' : 'Refrescar'}
                </button>
              </div>
              
              {error && <div className="p-3 bg-red-50 text-red-700 text-xs rounded-xl mb-4 border border-red-200">{error}</div>}
              
              <div className="flex flex-col gap-3">
                {jobs.map(job => (
                  <div key={job.id} className="p-4 bg-sf rounded-xl border border-[var(--bd)] flex flex-col sm:flex-row justify-between gap-4">
                    <div>
                      <div className="font-bold text-sm text-[var(--tx)]">{job.title}</div>
                      <div className="text-[10px] tx-mu mono truncate max-w-xs mt-1">{job.url}</div>
                    </div>
                    <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2">
                      {job.lastStatus >= 200 && job.lastStatus < 300 ? (
                        <span className="text-[10px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <CheckCircle2 size={10}/> ÉXITO
                        </span>
                      ) : (
                        <span className="text-[10px] text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-1">
                          <XCircle size={10}/> {job.lastStatusText}
                        </span>
                      )}
                      <div className="text-[10px] tx-mu flex items-center gap-1">
                        <Clock size={10} /> Ejecutado: {fmtTime(job.lastExecution)}
                      </div>
                    </div>
                  </div>
                ))}
                {jobs.length === 0 && !isChecking && !error && (
                  <div className="text-sm tx-mu text-center py-8">
                    No se encontraron tareas registradas o aún no hay respuesta de cron-job.org.
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="lg:col-span-1 flex flex-col gap-4">
            <section className="bg-cd border border-[var(--bd)] rounded-2xl p-5">
              <h2 className="text-xs font-bold tx-mu uppercase tracking-wider mb-4 flex items-center gap-2">
                <Database size={14} /> Base de Datos
              </h2>
              <div className="flex items-center justify-between p-4 bg-sf rounded-xl border border-[var(--bd)]">
                <div>
                  <div className="font-bold text-sm">Supabase API</div>
                  <div className="text-[10px] tx-mu mt-1">Conexión Frontend</div>
                </div>
                {productos.isLoading ? (
                  <span className="text-[10px] text-yellow-500 animate-pulse font-medium">...</span>
                ) : productos.error ? (
                  <span className="text-[10px] text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><XCircle size={10}/> ERROR</span>
                ) : (
                  <div className="text-right">
                    <span className="text-[10px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><CheckCircle2 size={10}/> OK</span>
                    <div className="text-[9px] tx-mu mt-1">{productos.data?.length} productos</div>
                  </div>
                )}
              </div>
            </section>

            <div className="rounded-2xl p-5" style={{ background: 'var(--kb)', border: '1px solid color-mix(in srgb, var(--ac) 40%, transparent)' }}>
              <h3 className="font-bold text-sm mb-2 flex items-center gap-2" style={{ color: 'var(--ac)' }}>
                <ShieldCheck size={18} /> Monitoreo Seguro
              </h3>
              <p className="text-[11px] tx-mu leading-relaxed">
                Este panel consulta el estado de las tareas programadas sin forzar ejecuciones que generen duplicados ni efectos no deseados.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 3: ARQUITECTURA OS & ROADMAP */}
      {activeTab === 'architecture' && (
        <div className="flex flex-col gap-5">
          <div className="bg-cd border border-[var(--bd)] rounded-2xl p-6">
            <h2 className="text-base font-bold flex items-center gap-2 mb-2">
              <Sparkles size={18} className="text-[var(--ac)]" />
              Arquitectura de TodoEnUno OS — Núcleo de Eventos
            </h2>
            <p className="text-xs text-[var(--mu)] leading-relaxed">
              Basado en el diseño del Arquitecto Principal, TodoEnUno OS deja de ser un conjunto de tablas aisladas para convertirse en un sistema guiado por eventos inmutables.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
              <div className="p-4 rounded-xl bg-sf border border-[var(--bd)]">
                <span className="text-xs font-bold font-mono text-[var(--ac)] block mb-1">Paso 1 & 2: Store</span>
                <h4 className="font-bold text-sm mb-1">Schema 'os' & Events</h4>
                <p className="text-[11px] text-[var(--mu)] leading-relaxed">
                  Tabla inmutable <code className="font-mono">os.events</code> con índice temporal, índice por entidad origen y llave de idempotencia anti-duplicados.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-sf border border-[var(--bd)]">
                <span className="text-xs font-bold font-mono text-emerald-500 block mb-1">Paso 3: Catálogo</span>
                <h4 className="font-bold text-sm mb-1">Event Types & State Map</h4>
                <p className="text-[11px] text-[var(--mu)] leading-relaxed">
                  Normalización de nombres (<code className="font-mono">order.*</code>, <code className="font-mono">chat.*</code>, <code className="font-mono">marketing.*</code>) y mapeo dinámico de estados del tablero Kanban.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-sf border border-[var(--bd)]">
                <span className="text-xs font-bold font-mono text-indigo-500 block mb-1">Paso 4 & 5: Stream</span>
                <h4 className="font-bold text-sm mb-1">Trigger & Visor Realtime</h4>
                <p className="text-[11px] text-[var(--mu)] leading-relaxed">
                  Trigger reactivo en <code className="font-mono">whatsapp_orders</code> que emite eventos instantáneos transmitidos al visor de eventos en tiempo real.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-cd border border-[var(--bd)] rounded-2xl p-5">
              <h3 className="text-xs font-bold tx-mu uppercase tracking-wider mb-3 flex items-center gap-2">
                <Layers size={14} /> Roadmap de Fases (Copilot + Kimi)
              </h3>
              <ul className="space-y-2 text-xs">
                <li className="flex items-center justify-between p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 font-semibold text-emerald-700 dark:text-emerald-300">
                  <span>Sprint 1: Schema OS + Event Store + Trigger Pedidos</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 font-bold">COMPLETO</span>
                </li>
                <li className="flex items-center justify-between p-2.5 rounded-xl bg-sf border border-[var(--bd)]">
                  <span>Fase 2: Normalización exhaustiva de eventos de Chat y Leads</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sf tx-mu font-bold">Preparado</span>
                </li>
                <li className="flex items-center justify-between p-2.5 rounded-xl bg-sf border border-[var(--bd)]">
                  <span>Fase 4: Marketing Event Producer (gastos_publicidad, leads)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sf tx-mu font-bold">Planificado</span>
                </li>
                <li className="flex items-center justify-between p-2.5 rounded-xl bg-sf border border-[var(--bd)]">
                  <span>Fase 5: Supplier Event Producer (licitaciones y cotizaciones)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sf tx-mu font-bold">Planificado</span>
                </li>
                <li className="flex items-center justify-between p-2.5 rounded-xl bg-sf border border-[var(--bd)]">
                  <span>Fase 6: Money Engine (Finance Projector consumidor)</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sf tx-mu font-bold">Planificado</span>
                </li>
                <li className="flex items-center justify-between p-2.5 rounded-xl bg-sf border border-[var(--bd)]">
                  <span>Fase 7 & 8: OS Memory + Agentes e Inteligencia Artificial</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-sf tx-mu font-bold">Planificado</span>
                </li>
              </ul>
            </div>

            <div className="bg-cd border border-[var(--bd)] rounded-2xl p-5 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold tx-mu uppercase tracking-wider mb-3 flex items-center gap-2">
                  <Code size={14} /> Archivos y Documentación en el Repositorio
                </h3>
                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between">
                    <div>
                      <div className="font-mono font-bold text-[var(--tx)]">docs/20261107_sprint1_os_event_store.sql</div>
                      <div className="text-[11px] tx-mu mt-0.5">Script SQL completo para ejecutar en Supabase</div>
                    </div>
                  </div>
                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between">
                    <div>
                      <div className="font-mono font-bold text-[var(--tx)]">docs/os-events-map.md</div>
                      <div className="text-[11px] tx-mu mt-0.5">Matriz de mapeo oficial: tablas → eventos</div>
                    </div>
                  </div>
                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-center justify-between">
                    <div>
                      <div className="font-mono font-bold text-[var(--tx)]">src/lib/osEvents.ts</div>
                      <div className="text-[11px] tx-mu mt-0.5">Cliente TypeScript, bus en tiempo real y emisor</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-[var(--bd)] flex justify-end">
                <button
                  onClick={() => handleTabChange('stream')}
                  className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] text-xs font-bold rounded-xl flex items-center gap-1.5"
                >
                  <Radio size={14} className="text-emerald-400" /> Ir al Event Stream en Vivo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
