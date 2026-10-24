import { Outlet, Link, useLocation } from 'react-router-dom';
import { MessageSquare } from 'lucide-react'; // Importamos un icono de chat

// Agregamos UniChat a la lista de enlaces
const links = [
  { to: '/', label: 'Hoy' },
  { to: '/unichat', label: 'UniChat', icon: MessageSquare }, 
  { to: '/catalogo', label: 'Catálogo' }, 
  { to: '/cola', label: 'Cola' }, 
  { to: '/sistema', label: 'Sistema' }
];

export function Layout() {
  const { pathname } = useLocation();
  
  return (
    <div className="flex h-full">
      <aside className="w-[200px] shrink-0 bg-cd bd h-full p-4 flex flex-col gap-2">
        <div className="font-bold mb-4">TODOENUNO OS</div>
        {links.map(l => (
          <Link 
            key={l.to} 
            to={l.to} 
            className="p-2 rounded-lg text-sm flex items-center gap-2" 
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
      <main className="flex-1 overflow-y-auto p-6"><Outlet /></main>
    </div>
  );
}
