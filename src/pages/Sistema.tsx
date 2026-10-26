import { useState } from 'react';
import { useProductos } from '@/hooks/useCatalog';
import { 
  CheckCircle2, 
  XCircle, 
  RefreshCw, 
  ShieldCheck, 
  MessageSquare, 
  Database, 
  Activity, 
  Globe, 
  Facebook,
  Server
} from 'lucide-react';

type EndpointStatus = 'idle' | 'loading' | 'ok' | 'error';

interface EndpointState {
  status: EndpointStatus;
  latency?: number;
  errorMsg?: string;
}

export function SistemaPage() {
  const productos = useProductos();
  
  const [endpoints, setEndpoints] = useState<Record<string, EndpointState>>({
    odoo_feed: { status: 'idle' },
    post_feed: { status: 'idle' },
    cron_feed: { status: 'idle' },
    odoo_storefront: { status: 'idle' },
    whatsapp_webhook: { status: 'idle' },
  });

  const [isChecking, setIsChecking] = useState(false);

  const checkEndpoints = async () => {
    setIsChecking(true);
    const initialState: Record<string, EndpointState> = {};
    Object.keys(endpoints).forEach(k => initialState[k] = { status: 'loading' });
    setEndpoints(initialState);

    // 🔥 PING SEGURO: Sin el secret para evitar ejecutar acciones
    const urls = {
      odoo_feed: 'https://todoenuno-feed.vercel.app/api/sync-odoo-to-supabase',
      post_feed: 'https://todoenuno-feed.vercel.app/api/post-auto',
      cron_feed: 'https://todoenuno-feed.vercel.app/api/cron',
      odoo_storefront: 'https://www.to2en1.app/api/sync-odoo-supabase',
      whatsapp_webhook: 'https://www.to2en1.app/api/webhook/whatsapp',
    };

    const promises = Object.entries(urls).map(async ([key, url]) => {
      const start = performance.now();
      try {
        const res = await fetch(url, { method: 'GET' });
        const latency = Math.round(performance.now() - start);

        if (res.status === 401 || res.status === 403 || res.ok) {
          return { key, state: { status: 'ok' as const, latency } };
        }

        return { key, state: { status: 'error' as const, latency, errorMsg: `HTTP ${res.status}` } };
      } catch (err) {
        return { key, state: { status: 'error' as const, errorMsg: 'Sin conexión' } };
      }
    });

    const results = await Promise.all(promises);
    const newState: Record<string, EndpointState> = {};
    results.forEach(res => { newState[res.key] = res.state; });
    
    setEndpoints(newState);
    setIsChecking(false);
  };

  // Componente visual para cada Endpoint
  const EndpointRow = ({ name, path, icon: Icon, state }: { name: string, path: string, icon: any, state: EndpointState }) => (
    <div className="flex items-center justify-between p-3 bg-sf rounded-xl border border-[var(--bd)] hover:border-[var(--ac)] transition-colors group">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-cd border border-[var(--bd)] rounded-lg text-[var(--mu)] group-hover:text-[var(--ac)] transition-colors">
          <Icon size={16} />
        </div>
        <div>
          <div className="font-semibold text-sm text-[var(--tx)]">{name}</div>
          <div className="text-[10px] tx-mu mono">{path}</div>
        </div>
      </div>
      
      <div className="text-right flex flex-col items-end">
        {state.status === 'loading' && <span className="text-[10px] text-yellow-500 animate-pulse font-medium">Ping...</span>}
        {state.status === 'idle' && <span className="text-[10px] text-gray-500 font-medium">En espera</span>}
        {state.status === 'ok' && (
          <>
            <span className="text-[10px] text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><CheckCircle2 size={10}/> ONLINE</span>
            <span className="text-[9px] text-[var(--mu)] mt-1">{state.latency}ms</span>
          </>
        )}
        {state.status === 'error' && (
          <>
            <span className="text-[10px] text-red-700 bg-red-100 px-2 py-0.5 rounded-full font-bold flex items-center gap-1"><XCircle size={10}/> FALLÓ</span>
            <span className="text-[9px] text-red-500 mt-1 max-w-[80px] truncate">{state.errorMsg}</span>
          </>
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4 pb-10">
      
      {/* Header del Panel */}
      <div className="flex flex-col sm:flex-row justify-between items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2"><Server size={20} className="text-[var(--ac)]"/> Estado del Sistema</h1>
          <p className="text-xs text-[var(--mu)] mt-1">Monitoreo de infraestructura y endpoints seguros.</p>
        </div>
        <button 
          onClick={checkEndpoints}
          disabled={isChecking}
          className="w-full sm:w-auto px-5 py-2.5 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-sm font-semibold flex items-center justify-center gap-2 hover:opacity-80 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={16} className={isChecking ? 'animate-spin' : ''} /> 
          {isChecking ? 'Probando...' : 'Probar Conexiones'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        
        {/* COLUMNA IZQUIERDA (Endpoints) */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          
          <section className="bg-cd border border-[var(--bd)] rounded-2xl p-5">
            <h2 className="text-xs font-bold tx-mu uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity size={14} /> TodoEnUno-Feed (Vercel)
            </h2>
            <div className="flex flex-col gap-2">
              <EndpointRow name="Sync Odoo → Supabase" path="/api/sync-odoo-to-supabase" icon={RefreshCw} state={endpoints.odoo_feed} />
              <EndpointRow name="Auto-Post Facebook" path="/api/post-auto" icon={Facebook} state={endpoints.post_feed} />
              <EndpointRow name="Feed Catálogo Meta" path="/api/cron" icon={Globe} state={endpoints.cron_feed} />
            </div>
          </section>

          <section className="bg-cd border border-[var(--bd)] rounded-2xl p-5">
            <h2 className="text-xs font-bold tx-mu uppercase tracking-wider mb-4 flex items-center gap-2">
              <Activity size={14} /> TodoEnUno-OS (Storefront)
            </h2>
            <div className="flex flex-col gap-2">
              <EndpointRow name="Sync Odoo (Storefront)" path="/api/sync-odoo-supabase" icon={RefreshCw} state={endpoints.odoo_storefront} />
              <EndpointRow name="Webhook WhatsApp" path="/api/webhook/whatsapp" icon={MessageSquare} state={endpoints.whatsapp_webhook} />
            </div>
          </section>

        </div>

        {/* COLUMNA DERECHA (Base de datos e Info) */}
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
              <ShieldCheck size={18} /> Ping Seguro Activado
            </h3>
            <p className="text-[11px] tx-mu leading-relaxed">
              Para evitar publicaciones o sincronizaciones accidentales, este panel consulta los endpoints <b>sin la clave secreta</b>. Un error <b>401 o 403</b> confirma que el servidor está en línea y protegido.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
