import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { 
  MessageSquare, 
  Wallet, 
  Menu, 
  X, 
  Moon, 
  Sun, 
  Store, 
  FileText, 
  ClipboardList,
  TrendingUp, // Rentabilidad
  PieChart,   // Analítica
  Megaphone,  // Pricing & Promo Studio
  Inbox,      // <-- NUEVO ICONO PARA SOCIAL INBOX
  Activity,   // <-- OS Event Stream (Sprint 1)
  Server,
  Tag,
  Boxes,
  Zap
} from 'lucide-react';
import { PWAInstallButton } from '@/components/pwa/PWAComponents';

const links = [
  { to: '/', label: 'Hoy' },
  { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
  { to: '/event-stream', label: 'OS Brain & Events', icon: Activity, isNew: true },
  { to: '/finanzas', label: 'Finanzas & Budget', icon: Wallet },
  { to: '/rentabilidad', label: 'Rentabilidad', icon: TrendingUp },
  { to: '/analitica', label: 'Analítica', icon: PieChart },
  { to: '/ltv', label: 'Fidelización & LTV', icon: Zap },
  { to: '/marketing', label: 'Pricing & Promo', icon: Megaphone },
  { to: '/unichat', label: 'UniChat', icon: MessageSquare }, 
  { to: '/social-inbox', label: 'Social Inbox', icon: Inbox },
  { to: '/catalogo', label: 'Catálogo Visual', icon: Tag }, 
  { to: '/inventario', label: 'Inventario & Kárdex', icon: Boxes }, 
  { to: '/cola', label: 'Cola' }, 
  { to: '/proveedores', label: 'Proveedores', icon: Store },
  { to: '/docs', label: 'Docs & Roadmap', icon: FileText }, 
  { to: '/sistema', label: 'Sistema', icon: Server }
];

export function Layout() {
  const { pathname } = useLocation();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');
  
  return (
    <div className="flex h-full bg-[var(--bg)] transition-colors duration-300">
      
      {/* Header para Móvil */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-cd border-b border-[var(--bd)] flex items-center justify-between px-4 z-50">
        <div className="font-bold">TODOENUNO OS</div>
        <div className="flex items-center gap-2">
          <PWAInstallButton compact />
          <button onClick={toggleTheme} className="p-2 bg-sf rounded-lg">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button onClick={() => setIsMobileOpen(!isMobileOpen)} className="p-2 bg-sf rounded-lg">
            {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Menú Lateral (Sidebar) */}
      <aside className={`
        fixed lg:static top-14 lg:top-0 left-0 bottom-0 z-40
        w-[220px] shrink-0 bg-cd border-r border-[var(--bd)] p-4 flex flex-col gap-1.5
        transition-transform duration-300 ease-in-out overflow-y-auto
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="flex items-center justify-between mb-4 px-1">
          <div className="font-bold text-sm tracking-tight hidden lg:block">TODOENUNO OS</div>
          <button onClick={toggleTheme} className="hidden lg:flex p-2 bg-sf rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

        {links.map(l => (
          <Link 
            key={l.to} 
            to={l.to} 
            onClick={() => setIsMobileOpen(false)}
            className="p-2 rounded-lg text-sm flex items-center justify-between transition-colors" 
            style={{ 
              background: pathname === l.to ? 'var(--tx)' : 'transparent', 
              color: pathname === l.to ? 'var(--cd)' : 'var(--mu)' 
            }}
          >
            <div className="flex items-center gap-2">
              {l.icon && <l.icon size={16} />}
              <span>{l.label}</span>
            </div>
            {l.isNew && (
              <span className="text-[9px] font-black px-1.5 py-0.2 rounded-full bg-emerald-500 text-white animate-pulse">
                LIVE
              </span>
            )}
          </Link>
        ))}

        <div className="mt-auto pt-3 border-t border-[var(--bd)]">
          <PWAInstallButton />
        </div>
      </aside>

      {isMobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden top-14" onClick={() => setIsMobileOpen(false)} />
      )}

      <main className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-6 pt-20 lg:pt-6 w-full text-[var(--tx)]">
        <Outlet />
      </main>
    </div>
  );
}
