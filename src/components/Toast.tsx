import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
type Kind = 'success' | 'error' | 'info' | 'warning';
type Toast = { id: number; kind: Kind; msg: string };
const Ctx = createContext<{ push: (k: Kind, m: string) => void }>({ push: () => {} });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, msg: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="px-4 py-2.5 rounded-lg shadow-lg text-sm text-white max-w-sm"
            style={{ background: t.kind === 'error' ? 'var(--er)' : t.kind === 'success' ? 'var(--ok)' : t.kind === 'warning' ? 'var(--ac)' : 'var(--tx)' }}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
export function useToast() { return useContext(Ctx); }
