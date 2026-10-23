import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

const TITLES: Record<string, string> = {
  '/': 'Resumen',
  '/catalogo': 'Catálogo',
  '/cola': 'Cola de posts',
  '/feed': 'Feed / Ads',
  '/crons': 'Crons',
  '/pedidos': 'Pedidos',
  '/chats': 'Chats',
  '/sistema': 'Sistema',
};

export function Layout() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const title = TITLES[pathname] ?? 'Panel';

  return (
    <div className="flex h-full">
      {/* Sidebar desktop */}
      <div className="hidden lg:block h-screen sticky top-0">
        <Sidebar />
      </div>

      {/* Sidebar mobile */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <Topbar title={title} onMenu={() => setOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6 max-w-[1500px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
