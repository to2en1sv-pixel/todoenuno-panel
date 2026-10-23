import { NavLink } from 'react-router-dom';

const items = [
  { to: '/',           label: 'Resumen',       icon: '📊', end: true },
  { to: '/catalogo',   label: 'Catálogo',      icon: '📦' },
  { to: '/cola',       label: 'Cola de posts', icon: '🗂️' },
  { to: '/feed',       label: 'Feed / Ads',    icon: '📈' },
  { to: '/crons',      label: 'Crons',         icon: '⏱️' },
  { to: '/pedidos',    label: 'Pedidos',       icon: '🧾', soon: true },
  { to: '/chats',      label: 'Chats',         icon: '💬', soon: true },
  { to: '/sistema',    label: 'Sistema',       icon: '⚙️' },
];

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="w-[240px] shrink-0 bg-cd bd h-full flex flex-col p-3 gap-2 overflow-y-auto">
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="w-8 h-8 rounded-lg grid place-items-center text-xs font-bold"
             style={{ background: 'var(--tx)', color: 'var(--cd)' }}>T1</div>
        <div>
          <div className="text-[13px] font-bold tracking-tight">TODOENUNO OS</div>
          <div className="text-[11px] tx-mu mono">v7 • ES</div>
        </div>
      </div>

      <div className="text-[10px] tx-mu font-semibold uppercase tracking-wider px-2 mt-2">Centro de mando</div>
      {items.map((it) => (
        <NavLink
          key={it.to}
          to={it.soon ? '#' : it.to}
          end={(it as any).end}
          onClick={(e) => {
            if (it.soon) { e.preventDefault(); return; }
            onNavigate?.();
          }}
          className={({ isActive }) =>
            `flex items-center gap-2 px-2.5 py-2 rounded-lg text-[13px] font-medium ${
              isActive ? '' : 'hover:bg-sf'
            }`
          }
          style={({ isActive }) =>
            isActive
              ? { background: 'var(--tx)', color: 'var(--cd)' }
              : { color: 'var(--mu)' }
          }
        >
          <span>{it.icon}</span>
          <span>{it.label}</span>
          {it.soon && <span className="chip ml-auto" style={{ fontSize: 9 }}>soon</span>}
        </NavLink>
      ))}

      <div className="mt-auto pt-3 bd border-t px-2 text-[10px] tx-mu mono">
        odoo.todoenuno.sv • evo.todoenuno.sv
      </div>
    </aside>
  );
}
