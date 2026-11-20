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
  Truck,
  Bot,
  RotateCcw,
  ExternalLink,
} from 'lucide-react';
import { PWAInstallButton } from '@/components/pwa/PWAComponents';
import {
  ChatNotificationProvider,
  NotificationSettingsButton,
  useChatNotifications,
} from '@/components/notifications/ChatNotificationCenter';
import { isDemoMode } from '@/lib/demoMode';
import { resetDemoStore } from '@/lib/demoSupabase';
import { TelegramCopilotSimulator } from '@/components/demo/TelegramCopilotSimulator';

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
      { to: '/repartidor', label: 'Portal Repartidor', icon: Truck },
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
  const demoActive = isDemoMode();
  const brandLabel = demoActive ? 'NEXO COD OS' : 'TODOENUNO OS';
  const [copilotOpen, setCopilotOpen] = useState(false);
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
    <div className="flex h-full bg-[var(--bg)] transition-colors duration-200">
      {/* Header para Móvil */}
      <div className="lg:hidden fixed top-0 left-0 right-0 h-14 bg-cd/95 backdrop-blur-md border-b border-[var(--bd)] flex items-center justify-between px-4 z-50">
        <Link to="/" className="font-bold text-sm tracking-tight text-[var(--tx)] flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[var(--ac)]" aria-hidden="true" />
          {brandLabel}
        </Link>
        <div className="flex items-center gap-1.5">
          <PWAInstallButton compact />
          <NotificationSettingsButton compact />
          <button
            type="button"
            onClick={toggleTheme}
            className="p-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
            aria-label="Cambiar tema"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button
            type="button"
            onClick={() => setIsMobileOpen(!isMobileOpen)}
            className="p-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-[var(--tx)] transition-colors"
            aria-label="Abrir menú"
          >
            {isMobileOpen ? <X size={16} /> : <Menu size={16} />}
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
          ${isCollapsed ? 'p-3 lg:px-2 lg:py-4' : 'p-4'}
          ${isMobileOpen ? 'translate-x-0 pb-20 lg:pb-4' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* Cabecera Desktop */}
        <div
          className={`hidden lg:flex items-center mb-4 pb-3 border-b border-[var(--bd)] ${
            isCollapsed ? 'flex-col gap-2' : 'justify-between px-1'
          }`}
        >
          {!isCollapsed && (
            <Link to="/" className="font-bold text-[13px] tracking-tight text-[var(--tx)] truncate flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[var(--ac)] shrink-0" aria-hidden="true" />
              {brandLabel}
            </Link>
          )}

          <div className={`flex items-center gap-1 ${isCollapsed ? 'flex-col' : ''}`}>
            <button
              type="button"
              onClick={toggleTheme}
              className="p-1.5 rounded-lg text-[var(--mu)] hover:text-[var(--tx)] hover:bg-sf transition-colors"
              title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              type="button"
              onClick={() => setIsCollapsed(c => !c)}
              className="p-1.5 rounded-lg text-[var(--mu)] hover:text-[var(--tx)] hover:bg-sf transition-colors"
              title={isCollapsed ? 'Expandir menú lateral' : 'Colapsar menú a íconos'}
            >
              {isCollapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
            </button>
          </div>
        </div>

        {/* Navegación Agrupada */}
        <nav className="flex-1 flex flex-col gap-4">
          {navGroups.map((group, gIdx) => (
            <div key={group.title} className="flex flex-col gap-0.5">
              {isCollapsed ? (
                gIdx > 0 && <div className="hidden lg:block h-px bg-[var(--bd)] mx-1.5 my-1" />
              ) : null}

              <div
                className={`px-2.5 pb-1 text-[11px] font-semibold tracking-tight tx-mu ${
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
                    className={`relative rounded-lg text-[13px] flex items-center transition-colors ${
                      isCollapsed
                        ? 'px-2.5 py-2 lg:justify-center lg:px-0 lg:py-2.5 gap-2.5 lg:gap-0'
                        : 'px-2.5 py-1.5 gap-2.5'
                    } ${
                      active
                        ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                        : 'text-[var(--mu)] font-medium hover:bg-sf hover:text-[var(--tx)]'
                    }`}
                  >
                    <Icon size={15} className="shrink-0" />
                    <span className={`truncate flex-1 ${isCollapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                    {badgeCount > 0 && (
                      <span
                        className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold mono tabular-nums flex items-center justify-center leading-none shrink-0 ${
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
      <main className="flex-1 min-w-0 overflow-y-auto px-4 py-5 lg:px-8 lg:py-6 pt-20 pb-24 lg:pt-6 lg:pb-8 w-full text-[var(--tx)]">
        {demoActive && (
          <div className="mb-5 px-4 py-2.5 rounded-xl bg-cd border border-[var(--bd)] flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-[var(--tx)] flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
              <span className="font-semibold">Entorno Demo Sandbox</span>
              <span className="tx-mu" aria-hidden="true">·</span>
              <span className="tx-mu truncate">Nexo Store LATAM (datos sintéticos aislados)</span>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <button
                type="button"
                onClick={() => setCopilotOpen(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 transition-opacity inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <Bot size={13} />
                Copiloto Telegram IA
              </button>
              <Link
                to="/demo"
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-sf border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--tx)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
              >
                <ExternalLink size={12} />
                Presentación
              </Link>
              <button
                type="button"
                onClick={() => {
                  resetDemoStore();
                  window.location.reload();
                }}
                className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-sf border border-[var(--bd)] text-[var(--tx)] hover:border-[var(--tx)] transition-colors inline-flex items-center gap-1.5 whitespace-nowrap"
                title="Restaurar datos iniciales de la demo"
              >
                <RotateCcw size={12} />
                Reiniciar
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>

      {demoActive && (
        <TelegramCopilotSimulator open={copilotOpen} onClose={() => setCopilotOpen(false)} />
      )}

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
                  active ? 'text-[var(--tx)] font-semibold' : 'tx-mu hover:text-[var(--tx)] font-medium'
                }`}
              >
                {active && (
                  <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[var(--tx)]" />
                )}
                <span className="relative">
                  <Icon size={18} />
                  {badgeCount > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2.5 min-w-[15px] h-[15px] px-1 rounded-full text-[9px] font-bold mono tabular-nums flex items-center justify-center leading-none"
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
                ? 'text-[var(--tx)] font-semibold'
                : 'tx-mu hover:text-[var(--tx)] font-medium'
            }`}
          >
            {(isMobileOpen || isMobileExtraActive) && (
              <span className="absolute top-0 w-7 h-0.5 rounded-full bg-[var(--tx)]" />
            )}
            <Menu size={18} />
            <span>Más</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
