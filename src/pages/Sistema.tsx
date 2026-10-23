import { useState, useEffect } from 'react';
import { useProductos } from '@/hooks/useCatalog';
import { CheckCircle2, XCircle, RefreshCw, AlertCircle, MessageSquare } from 'lucide-react';

type EndpointStatus = 'idle' | 'loading' | 'ok' | 'error';

interface EndpointState {
  status: EndpointStatus;
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

  const checkEndpoints = async () => {
    // Inicializar todos en "cargando"
    const initialState: Record<string, EndpointState> = {};
    Object.keys(endpoints).forEach(k => initialState[k] = { status: 'loading' });
    setEndpoints(initialState);

    // Definición de URLs (Ajusta los dominios si es necesario)
    const urls = {
      // Endpoints de todoenuno-feed (Vercel)
      odoo_feed: 'https://todoenuno-feed.vercel.app/api/sync-odoo-to-supabase?secret=123456',
      post_feed: 'https://todoenuno-feed.vercel.app/api/post-auto?secret=123456',
      cron_feed: 'https://todoenuno-feed.vercel.app/api/cron?secret=123456',
      
      // Endpoints de todoenuno-os (Storefront en Vercel)
      // NOTA: Si tu dominio es diferente, cámbialo aquí.
      odoo_storefront: 'https://www.to2en1.app/api/sync-odoo-supabase',
      whatsapp_webhook: 'https://www.to2en1.app/api/webhook/whatsapp',
    };

    // Revisar todos en paralelo para que sea rápido
    const promises = Object.entries(urls).map(async ([key, url]) => {
      try {
        const res = await fetch(url, { method: 'GET' }); // Algunos endpoints pueden requerir POST, pero un GET nos dice si están vivos
        const text = await res.text();
        
        let data;
        try { data = JSON.parse(text); } catch (e) { data = {}; }

        // Si el endpoint devuelve error, lo marcamos en rojo
        if (!res.ok || data.error) {
          return { key, state: { status: 'error' as const, errorMsg: data.error?.message || data.error || 'Error en la respuesta' } };
        }
        return { key, state: { status: 'ok' as const } };

      } catch (err) {
        return { key, state: { status: 'error' as const, errorMsg: 'No se pudo conectar (CORS o red)' } };
      }
    });

    const results = await Promise.all(promises);
    
    const newState: Record<string, EndpointState> = {};
    results.forEach(res => {
      newState[res.key] = res.state;
    });
    setEndpoints(newState);
  };

  useEffect(() => {
    checkEndpoints();
  }, []);

  const renderLight = (state: EndpointState) => {
    if (state.status === 'loading') return <span className="text-[11px] text-yellow-500 animate-pulse">Revisando...</span>;
    if (state.status === 'idle') return <span className="text-[11px] text-gray-500">En espera</span>;
    if (state.status === 'ok') return <span className="text-[11px] text-green-500 flex items-center gap-1"><CheckCircle2 size={14}/> Online</span>;
    return <span className="text-[11px] text-red-500 flex items-center gap-1"><XCircle size={14}/> Falló</span>;
  };

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 pb-10">
      
      <div className="bg-cd bd rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Semáforo de Endpoints</h2>
          <button 
            onClick={checkEndpoints}
            className="px-3 py-1.5 bg-sf border border-[var(--bd)] rounded-lg text-sm font-semibold flex items-center gap-2 hover:bg-gray-100 transition-colors"
          >
            <RefreshCw size={14} /> Revisar ahora
          </button>
        </div>
        
        <div className="flex flex-col gap-3">
          {/* SECCIÓN 1: TODOENUNO-FEED */}
          <div className="text-[10px] font-bold tx-mu uppercase tracking-wider mt-2 mb-1">TodoEnUno-Feed (Vercel)</div>
          
          <div className="flex items-start justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm">Sync Odoo → Supabase</div>
              <div className="text-[11px] tx-mu mono mt-1">/api/sync-odoo-to-supabase</div>
            </div>
            <div className="text-right">
              {renderLight(endpoints.odoo_feed)}
              {endpoints.odoo_feed.errorMsg && <div className="text-[10px] text-red-400 mt-1 max-w-[200px] truncate">{endpoints.odoo_feed.errorMsg}</div>}
            </div>
          </div>

          <div className="flex items-start justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm">Auto-Post Facebook</div>
              <div className="text-[11px] tx-mu mono mt-1">/api/post-auto</div>
            </div>
            <div className="text-right">
              {renderLight(endpoints.post_feed)}
              {endpoints.post_feed.errorMsg && <div className="text-[10px] text-red-400 mt-1 max-w-[200px] truncate">{endpoints.post_feed.errorMsg}</div>}
            </div>
          </div>

          <div className="flex items-start justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm">Feed Catálogo Meta</div>
              <div className="text-[11px] tx-mu mono mt-1">/api/cron</div>
            </div>
            <div className="text-right">
              {renderLight(endpoints.cron_feed)}
              {endpoints.cron_feed.errorMsg && <div className="text-[10px] text-red-400 mt-1 max-w-[250px] truncate" title={endpoints.cron_feed.errorMsg}>{endpoints.cron_feed.errorMsg}</div>}
            </div>
          </div>

          {/* SECCIÓN 2: TODOENUNO-OS */}
          <div className="text-[10px] font-bold tx-mu uppercase tracking-wider mt-4 mb-1">TodoEnUno-OS (Storefront)</div>

          <div className="flex items-start justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm">Sync Odoo (Storefront)</div>
              <div className="text-[11px] tx-mu mono mt-1">/api/sync-odoo-supabase</div>
            </div>
            <div className="text-right">
              {renderLight(endpoints.odoo_storefront)}
              {endpoints.odoo_storefront.errorMsg && <div className="text-[10px] text-red-400 mt-1 max-w-[200px] truncate">{endpoints.odoo_storefront.errorMsg}</div>}
            </div>
          </div>

          <div className="flex items-start justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm flex items-center gap-1">
                <MessageSquare size={14} /> Webhook WhatsApp
              </div>
              <div className="text-[11px] tx-mu mono mt-1">/api/webhook/whatsapp</div>
            </div>
            <div className="text-right">
              {renderLight(endpoints.whatsapp_webhook)}
              {endpoints.whatsapp_webhook.errorMsg && <div className="text-[10px] text-red-400 mt-1 max-w-[200px] truncate">{endpoints.whatsapp_webhook.errorMsg}</div>}
            </div>
          </div>

        </div>
      </div>

      {/* Tarjeta de Supabase */}
      <div className="bg-cd bd rounded-2xl p-6">
        <h2 className="text-lg font-bold mb-4">Estado de Supabase (Frontend)</h2>
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm">Conexión y Variables</div>
            </div>
            {productos.isLoading ? (
              <span className="text-[11px] tx-mu animate-pulse">Probando...</span>
            ) : productos.error ? (
              <span className="text-[11px] text-red-500 flex items-center gap-1"><XCircle size={14}/> Error</span>
            ) : (
              <span className="text-[11px] text-green-500 flex items-center gap-1"><CheckCircle2 size={14}/> OK ({productos.data?.length} rows)</span>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl p-5" style={{ background: 'var(--kb)', border: '1px solid color-mix(in srgb, var(--ac) 40%, transparent)' }}>
        <h3 className="font-bold text-sm mb-1 flex items-center gap-2" style={{ color: 'var(--ac)' }}>
          <AlertCircle size={16} /> Nota sobre los endpoints de OS
        </h3>
        <p className="text-xs tx-mu leading-relaxed">
          Los endpoints del storefront pueden requerir el método <b>POST</b> y no <b>GET</b>. Si ves un error de método, el semáforo igual confirmará que el servidor está vivo y respondiendo.
        </p>
      </div>

    </div>
  );
}
