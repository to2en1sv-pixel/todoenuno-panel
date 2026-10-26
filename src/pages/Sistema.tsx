import { useState, useEffect } from 'react';
import { useProductos } from '@/hooks/useCatalog';
import { CheckCircle2, XCircle, RefreshCw, ShieldCheck, Database, Activity, Clock, Server } from 'lucide-react';

type CronJob = {
  id: string;
  title: string;
  url: string;
  lastStatus: number;
  lastExecution: number;
  nextExecution: number;
};

export function SistemaPage() {
  const productos = useProductos();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState('');

  const checkCrons = async () => {
    setIsChecking(true);
    setError('');
    try {
      const res = await fetch('/api/cron-status');
      
      // Leer como texto para evitar errores si Vercel devuelve un 404 en HTML
      const textResponse = await res.text();
      let data;
      
      try {
        data = JSON.parse(textResponse);
      } catch (e) {
        throw new Error(`Vercel devolvió HTML en lugar de JSON. Revisa que la ruta /api/cron-status exista.`);
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
    checkCrons();
  }, []);

  const fmtTime = (ts: number) => {
    if (!ts) return '—';
    return new Date(ts * 1000).toLocaleString('es-SV', { dateStyle: 'short', timeStyle: 'short' });
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
      
      <div className="flex flex-col sm:flex-row justify-between items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Server size={20} className="text-[var(--ac)]"/> Estado del Sistema</h1>
          <p className="text-xs text-[var(--mu)] mt-1">Monitoreo real desde cron-job.org.</p>
        </div>
        <button 
          onClick={checkCrons}
          disabled={isChecking}
          className="w-full sm:w-auto px-5 py-2.5 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-80 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={isChecking ? 'animate-spin' : ''} /> 
          {isChecking ? 'Consultando...' : 'Actualizar Estado'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* COLUMNA IZQUIERDA: Crons */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <section className="bg-cd border border-[var(--bd)] rounded-2xl p-5">
            <h2 className="text-xs font-bold tx-mu uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity size={14} /> Tareas Programadas (cron-job.org)
            </h2>
            
            {error && <div className="p-3 bg-red-50 text-red-700 text-sm rounded-lg mb-4 border border-red-200">{error}</div>}
            
            <div className="flex flex-col gap-3">
              {jobs.map(job => (
                <div key={job.id} className="p-4 bg-sf rounded-xl border border-[var(--bd)] flex flex-col sm:flex-row justify-between gap-4">
                  <div>
                    <div className="font-bold text-sm text-[var(--tx)]">{job.title}</div>
                    <div className="text-[10px] tx-mu mono truncate max-w-xs mt-1">{job.url}</div>
                  </div>
                  <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-2">
                    {job.lastStatus >= 200 && job.lastStatus < 300 ? (
                      <span className="text-[10px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><CheckCircle2 size={10}/> ÉXITO ({job.lastStatus})</span>
                    ) : (
                      <span className="text-[10px] text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><XCircle size={10}/> FALLÓ ({job.lastStatus})</span>
                    )}
                    <div className="text-[10px] tx-mu flex items-center gap-1">
                      <Clock size={10} /> Última: {fmtTime(job.lastExecution)}
                    </div>
                  </div>
                </div>
              ))}
              {jobs.length === 0 && !isChecking && !error && (
                <div className="text-sm tx-mu text-center py-4">No se encontraron tareas. Revisa los IDs en Vercel.</div>
              )}
            </div>
          </section>
        </div>

        {/* COLUMNA DERECHA: Base de Datos y Seguridad */}
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
                  <div className="text-[9px] tx-mu mt-1">{productos.data?.length} registros</div>
                </div>
              )}
            </div>
          </section>

          <div className="rounded-2xl p-5" style={{ background: 'var(--kb)', border: '1px solid color-mix(in srgb, var(--ac) 40%, transparent)' }}>
            <h3 className="font-bold text-sm mb-2 flex items-center gap-2" style={{ color: 'var(--ac)' }}>
              <ShieldCheck size={18} /> Monitoreo Seguro
            </h3>
            <p className="text-[11px] tx-mu leading-relaxed">
              Este panel lee el estado directamente desde la API de cron-job.org. No se ejecutan peticiones a tus endpoints reales, por lo que es 100% seguro y no generará publicaciones ni sincronizaciones accidentales.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
