import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Package, FileText, LayoutDashboard, BarChart3, ShoppingCart, Clock, Settings } from 'lucide-react';
import { useProductos } from '@/hooks/useCatalog';
import { usePostQueue } from '@/hooks/usePostQueue';

const ROUTES = [
  { path: '/', label: 'Resumen', icon: LayoutDashboard },
  { path: '/catalogo', label: 'Catálogo', icon: Package },
  { path: '/cola', label: 'Cola de posts', icon: FileText },
  { path: '/feed', label: 'Feed / Ads', icon: BarChart3 },
  { path: '/crons', label: 'Crons', icon: Clock },
  { path: '/pedidos', label: 'Pedidos', icon: ShoppingCart },
  { path: '/sistema', label: 'Sistema', icon: Settings },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const productos = useProductos();
  const queue = usePostQueue();

  useEffect(() => { if (!open) setQ(''); }, [open]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const query = q.trim().toLowerCase();
  const routes = ROUTES.filter((r) => !query || r.label.toLowerCase().includes(query));
  const prodMatches = query
    ? (productos.data ?? []).filter((p) =>
        (p.nombre_base ?? '').toLowerCase().includes(query) || String(p.template_id).includes(query)
      ).slice(0, 5)
    : [];
  const queueMatches = query
    ? (queue.data ?? []).filter((x) =>
        [x.nombre, x.sku].filter(Boolean).some((s) => (s as string).toLowerCase().includes(query))
      ).slice(0, 5)
    : [];

  function go(path: string) { nav(path); onClose(); }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center pt-[10vh] px-4 animate-fade-in"
      style={{ background: 'rgba(0,0,0,.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-cd rounded-xl overflow-hidden"
        style={{ boxShadow: '0 25px 60px rgba(0,0,0,.3)', border: '1px solid var(--bd)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--bd)' }}>
          <Search size={16} className="tx-mu" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar rutas, productos, SKU…"
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <span className="chip mono">ESC</span>
        </div>
        <div className="max-h-[60vh] overflow-y-auto py-1">
          {routes.length > 0 && (
            <div className="px-2 py-1">
              <div className="text-[10px] tx-mu uppercase tracking-wider px-2 py-1.5">Navegar</div>
              {routes.map((r) => (
                <button key={r.path} onClick={() => go(r.path)}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-sf text-sm">
                  <r.icon size={14} className="tx-mu" />{r.label}
                </button>
              ))}
            </div>
          )}
          {prodMatches.length > 0 && (
            <div className="px-2 py-1 border-t" style={{ borderColor: 'var(--bd)' }}>
              <div className="text-[10px] tx-mu uppercase tracking-wider px-2 py-1.5">Productos</div>
              {prodMatches.map((p) => (
                <button key={p.template_id} onClick={() => go('/catalogo')}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-sf text-sm">
                  <Package size={14} className="tx-mu" />
                  <span className="truncate">{p.nombre_base}</span>
                  <span className="ml-auto mono text-[10px] tx-mu">#{p.template_id}</span>
                </button>
              ))}
            </div>
          )}
          {queueMatches.length > 0 && (
            <div className="px-2 py-1 border-t" style={{ borderColor: 'var(--bd)' }}>
              <div className="text-[10px] tx-mu uppercase tracking-wider px-2 py-1.5">Cola de posts</div>
              {queueMatches.map((x) => (
                <button key={x.id} onClick={() => go('/cola')}
                  className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-sf text-sm">
                  <FileText size={14} className="tx-mu" />
                  <span className="truncate">{x.nombre ?? x.sku ?? '—'}</span>
                  <span className="ml-auto chip">{x.status}</span>
                </button>
              ))}
            </div>
          )}
          {!query && (
            <div className="px-4 py-6 text-center tx-mu text-xs">Escribe para buscar en el panel</div>
          )}
        </div>
      </div>
    </div>
  );
}
