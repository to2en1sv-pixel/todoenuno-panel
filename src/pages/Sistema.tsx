import { useProductos } from '@/hooks/useCatalog';
import { CheckCircle2, XCircle } from 'lucide-react';

export function SistemaPage() {
  const productos = useProductos();

  const envUrl = import.meta.env.VITE_SUPABASE_URL;
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4 pb-10">
      
      <div className="bg-cd bd rounded-2xl p-6">
        <h2 className="text-lg font-bold mb-4">Estado de Conexión</h2>
        
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm">Supabase URL</div>
              <div className="text-[11px] tx-mu mono mt-1">{envUrl ? envUrl.slice(0, 30) + '...' : 'No configurada'}</div>
            </div>
            {envUrl ? <CheckCircle2 className="text-green-500" size={20} /> : <XCircle className="text-red-500" size={20} />}
          </div>

          <div className="flex items-center justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm">Supabase Anon Key</div>
              <div className="text-[11px] tx-mu mono mt-1">{envKey ? '••••••••••••••••' : 'No configurada'}</div>
            </div>
            {envKey ? <CheckCircle2 className="text-green-500" size={20} /> : <XCircle className="text-red-500" size={20} />}
          </div>

          <div className="flex items-center justify-between p-3 bg-sf rounded-xl border border-[var(--bd)]">
            <div>
              <div className="font-semibold text-sm">Consulta a Base de Datos</div>
              <div className="text-[11px] tx-mu mt-1">Leyendo tabla 'productos'</div>
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
        <h3 className="font-bold text-sm mb-1" style={{ color: 'var(--ac)' }}>Siguiente paso: Webhook de Comentarios</h3>
        <p className="text-xs tx-mu">
          Para ver los leads y comentarios en este panel, debemos crear el endpoint en Vercel y la tabla <code>fb_leads</code> en Supabase (Fase 3).
        </p>
      </div>

    </div>
  );
}
