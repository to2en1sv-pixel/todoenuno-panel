import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Wallet,
  Menu,
  X,
  Moon,
  Sun,
  Store,
  FileText,
  ClipboardList,
  TrendingUp,
  PieChart,
  Megaphone,
  Inbox,
  Activity,
  Server,
  Tag,
  Boxes,
  Zap,
  ListChecks,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { PWAInstallButton } from '@/components/pwa/PWAComponents';
import {
  ChatNotificationProvider,
  NotificationSettingsButton,
  useChatNotifications,
} from '@/components/notifications/ChatNotificationCenter';

type NavItem = {
  to: string;
  matchPaths?: string[];
  label: string;
  icon: typeof LayoutDashboard;
};

type NavGroup = {
  title: string;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    title: 'Operación',
    items: [
      { to: '/', label: 'Hoy', icon: LayoutDashboard },
      { to: '/unichat', label: 'UniChat', icon: MessageSquare },
      { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
      { to: '/social-inbox', label: 'Social Inbox', icon: Inbox },
      { to: '/cola', label: 'Cola', icon: ListChecks },
    ],
  },
  {
    title: 'Producto & Bodega',
    items: [
      { to: '/catalogo', label: 'Catálogo Visual', icon: Tag },
      { to: '/inventario', label: 'Inventario & Kárdex', icon: Boxes },
      { to: '/proveedores', label: 'Proveedores', icon: Store },
    ],
  },
  {
    title: 'Finanzas & Ventas',
    items: [
      { to: '/finanzas', matchPaths: ['/finanzas', '/pagos'], label: 'Finanzas & Budget', icon: Wallet },
      { to: '/rentabilidad', label: 'Rentabilidad', icon: TrendingUp },
      { to: '/analitica', label: 'Analítica', icon: PieChart },
      { to: '/ltv', label: 'Fidelización & LTV', icon: Zap },
      { to: '/marketing', label: 'Pricing & Promo', icon: Megaphone },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { to: '/event-stream', matchPaths: ['/event-stream', '/os-brain'], label: 'OS Brain & Events', icon: Activity },
      { to: '/sistema', label: 'Sistema', icon: Server },
      { to: '/docs', label: 'Docs & Roadmap', icon: FileText },
    ],
  },
];

const mobileQuickTabs = [
  { to: '/', label: 'Hoy', icon: LayoutDashboard },
  { to: '/unichat', label: 'UniChat', icon: MessageSquare },
  { to: '/pedidos', label: 'Pedidos', icon: ClipboardList },
  { to: '/catalogo', label: 'Catálogo', icon: Tag },
];

export function Layout() {
  return (
    <ChatNotificationProvider>
      <LayoutShell />
    </ChatNotificationProvider>
  );
}

function LayoutShell() {
  const { pathname } = useLocation();
  const { unreadCount } = useChatNotifications();
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', String(isCollapsed));
  }, [isCollapsed]);

  const toggleTheme = () => setTheme(theme === 'light' ? 'dark' : 'light');

  const isRouteActive = (item: NavItem) => {
    if (item.matchPaths) return item.matchPaths.includes(pathname);
    return pathname === item.to;
  };

  const isMobileExtraActive = !mobileQuickTabs.some(t => t.to === pathname);

  return (
    <div className="flex h-full bg-[var(--bg)] transition-colors duration-300">
      {/* Header para Móvil */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-cd/95 backdrop-blur-md border-b border-[var(--bd)] flex items-center justify-between px-4 z-50">
        <Link to="/" className="font-black text-sm tracking-tight text-[var(--tx)]">
          TODOENUNO OS
        </Link>
        <div className="flex items-center gap-2">
          <PWAInstallButton compact />
          <NotificationSettingsButton compact />
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 bg-sf rounded-lg text-[var(--tx)]"
            aria-label="Cambiar tema"
          >
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button
            type="button"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="p-2 bg-sf rounded-lg text-[var(--tx)]"
            aria-label="Abrir menú"
          >
            {isMobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Menú Lateral (Sidebar) */}
      <aside
        className={`
          fixed lg:static top-14 lg:top-0 left-0 bottom-0 z-40
          w-[248px] ${isCollapsed ? 'lg:w-[68px]' : 'lg:w-[228px]'}
          shrink-0 bg-cd border-r border-[var(--bd)] flex flex-col
          transition-all duration-200 ease-in-out overflow-y-auto overflow-x-hidden
          ${isCollapsed ? 'p-3 lg:px-2 lg:py-3.5' : 'p-3.5'}
          ${isMobileOpen ? 'translate-x-0 pb-20 lg:pb-3.5' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Cabecera Desktop */}
        <div
          className={`hidden lg:flex items-center mb-3 ${
            isCollapsed ? 'flex-col gap-2' : 'justify-between px-1'
          }`}
        >
          {!isCollapsed && (
            <Link to="/" className="font-black text-sm tracking-tight text-[var(--tx)] truncate">
              TODOENUNO OS
            </Link>
          )}

          <div className={`flex items-center gap-1 ${isCollapsed ? 'flex-col' : ''}`}>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 bg-sf rounded-lg text-[var(--tx)] hover:opacity-80 transition-opacity"
              title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setIsCollapsed(c => !c)}
              className="p-1.5 bg-sf rounded-lg tx-mu hover:text-[var(--tx)] transition-colors"
              title={isCollapsed ? 'Expandir menú lateral' : 'Colapsar menú a íconos'}
            >
              {isCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </div>
        </div>

        {/* Navegación Agrupada */}
        <nav className="flex-1 flex flex-col gap-3">
          {navGroups.map((group, gIdx) => (
            <div key={group.title} className="flex flex-col gap-1">
              {isCollapsed ? (
                gIdx > 0 && <div className="hidden lg:block h-px bg-[var(--bd)] mx-1.5 my-0.5" />
              ) : null}

              <div
                className={`px-2 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider tx-mu ${
                  isCollapsed ? 'lg:hidden' : ''
                }`}
              >
                {group.title}
              </div>

              {group.items.map(item => {
                const active = isRouteActive(item);
                const Icon = item.icon;
                const badgeCount = item.to === '/unichat' ? unreadCount : 0;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setIsMobileOpen(false)}
                    title={isCollapsed ? item.label : undefined}
                    className={`relative rounded-xl text-[13px] flex items-center transition-colors ${
                      isCollapsed
                        ? 'px-2.5 py-2 lg:justify-center lg:px-0 lg:py-2.5 gap-2.5 lg:gap-0'
                        : 'px-2.5 py-2 gap-2.5'
                    } ${active ? 'font-bold shadow-sm' : 'font-medium hover:bg-sf'}`}
                    style={{
                      background: active ? 'var(--tx)' : undefined,
                      color: active ? 'var(--cd)' : 'var(--mu)',
                    }}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span className={`truncate flex-1 ${isCollapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                    {badgeCount > 0 && (
                      <span
                        className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold flex items-center justify-center leading-none shrink-0 ${
                          isCollapsed ? 'lg:absolute lg:top-1 lg:right-1 lg:min-w-[15px] lg:h-[15px] lg:text-[9px]' : ''
                        }`}
                        style={{
                          background: 'var(--ac)',
                          color: '#ffffff',
                        }}
                      >
                        {badgeCount > 99 ? '99+' : badgeCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div
          className={`mt-4 pt-3 border-t border-[var(--bd)] flex flex-col gap-2 ${
            isCollapsed ? 'lg:items-center' : ''
          }`}
        >
          <NotificationSettingsButton sidebarRow iconOnly={isCollapsed} />
          <PWAInstallButton iconOnly={isCollapsed} />
        </div>
      </aside>

      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden top-14"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      {/* Contenido Principal */}
      <main className="flex-1 min-w-0 overflow-y-auto p-4 lg:p-6 pt-20 pb-20 lg:pt-6 lg:pb-6 w-full text-[var(--tx)]">
        <Outlet />
      </main>

      {/* Barra Inferior Rápida para Móvil / PWA */}
      <nav
        aria-label="Navegación rápida móvil"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-cd/95 backdrop-blur-md border-t border-[var(--bd)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5 h-[60px]">
          {mobileQuickTabs.map(tab => {
            const active = pathname === tab.to;
            const Icon = tab.icon;
            const badgeCount = tab.to === '/unichat' ? unreadCount : 0;
            return (
              <Link
                key={tab.to}
                to={tab.to}
                onClick={() => setIsMobileOpen(false)}
                className={`flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors relative ${
                  active ? 'text-[var(--ac)] font-bold' : 'tx-mu hover:text-[var(--tx)] font-medium'
                }`}
              >
                {active && (
                  <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[var(--ac)]" />
                )}
                <span className="relative">
                  <Icon size={18} />
                  {badgeCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-extrabold flex items-center justify-center leading-none"
                      style={{ background: 'var(--ac)', color: '#ffffff' }}
                    >
                      {badgeCount > 99 ? '99+' : badgeCount}
                    </span>
                  )}
                </span>
                <span className="truncate max-w-full px-1">{tab.label}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setIsMobileOpen(prev => !prev)}
            className={`flex flex-col items-center justify-center gap-0.5 text-[10px] transition-colors relative ${
              isMobileOpen || isMobileExtraActive
                ? 'text-[var(--ac)] font-bold'
                : 'tx-mu hover:text-[var(--tx)] font-medium'
            }`}
          >
            {(isMobileOpen || isMobileExtraActive) && (
              <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[var(--ac)]" />
            )}
            <Menu size={18} />
            <span>Más</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
