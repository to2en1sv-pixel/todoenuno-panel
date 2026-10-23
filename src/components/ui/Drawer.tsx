import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function Drawer({
  open, onClose, title, children, actions,
}: {
  open: boolean; onClose: () => void; title: string;
  children: ReactNode; actions?: ReactNode;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40 transition-opacity"
        style={{
          background: open ? 'rgba(0,0,0,.45)' : 'transparent',
          pointerEvents: open ? 'auto' : 'none',
          opacity: open ? 1 : 0,
        }}
        onClick={onClose}
      />
      <div
        className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-md bg-cd flex flex-col transition-transform"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          borderLeft: '1px solid var(--bd)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--bd)' }}>
          <h3 className="font-semibold text-sm truncate">{title}</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-sf" aria-label="Cerrar">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
        {actions && (
          <div className="px-4 py-3 border-t flex gap-2 justify-end" style={{ borderColor: 'var(--bd)' }}>
            {actions}
          </div>
        )}
      </div>
    </>
  );
}
