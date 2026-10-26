import { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { MessageSquare, Wallet, Menu, X } from 'lucide-react';

const links = [
  { to: '/', label: 'Hoy' },
  { to: '/unichat', label: 'UniChat', icon: MessageSquare }, 
  { to: '/catalogo', label: 'Catálogo' }, 
  { to: '/cola', label: 'Cola' }, 
  { to: '/pagos', label: 'Pagos', icon: Wallet },
  { to: '/sistema', label: 'Sistema' }
];

export function Layout() {
  const { pathname } = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  
  return (
    <div className="flex h-full bg-[var(--bg)]">
      
      {/* Header para Móvil */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-cd border-b border-[var(--bd)] flex items-center justify-between px-4 z-50">
        <div className="font-bold">TODOENUNO OS</div>
        <button onClick={() => setIsMobileOpen(!isMobileOpen)} className="p-2 bg-sf rounded-lg">
          {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Menú Lateral (Sidebar) */}
      <aside className={`
        fixed lg:static top-14 lg:top-0 left-0 bottom-0 z-40
        w-[200px] shrink-0 bg-cd border-r border-[var(--bd)] p-4 flex flex-col gap-2
        transition-transform duration-300 ease-in-out
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="font-bold mb-4 hidden lg:block">TODOENUNO OS</div>
        {links.map(l => (
          <Link 
            key={l.to} 
            to={l.to} 
            onClick={() => setIsMobileOpen(false)}
            className="p-2 rounded-lg text-sm flex items-center gap-2 transition-colors" 
            style={{ 
              background: pathname === l.to ? 'var(--tx)' : 'transparent', 
              color: pathname === l.to ? 'var(--cd)' : 'var(--mu)' 
            }}
          >
            {l.icon && <l.icon size={16} />}
            {l.label}
          </Link>
        ))}
      </aside>

      {/* Overlay oscuro en móvil */}
      {isMobileOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-30 lg:hidden top-14" 
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Contenido de la página */}
      <main className="flex-1 overflow-y-auto p-4 lg:p-6 pt-20 lg:pt-6 w-full">
        <Outlet />
      </main>
    </div>
  );
}
