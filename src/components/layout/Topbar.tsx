import { useEffect, useState } from 'react';
import { useHealth } from '@/hooks/useHealth';

export function Topbar({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { data, isLoading } = useHealth();
  const [theme, setTheme] = useState<string>(() => localStorage.getItem('theme') || 'light');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const supOk = data?.supabase.ok === true;
  const allFresh = !!data?.crons.every((c) => c.fresh);

  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b"
            style={{ background: 'color-mix(in srgb, var(--bg) 80%, transparent)', backdropFilter: 'blur(12px)', borderColor: 'var(--bd)' }}>
      <button className="lg:hidden bg-cd bd rounded-lg px-2.5 py-1.5" onClick={onMenu}>☰</button>
      <h1 className="text-lg font-bold tracking-tight">{title}</h1>
      <div className="ml-auto flex items-center gap-2">
        <span className={`chip ${isLoading ? '' : supOk && allFresh ? 'ok' : 'er'}`} title="Estado de conexión">
          <span className={`dot ${isLoading ? '' : supOk && allFresh ? 'ok' : 'er'}`} />
          {isLoading ? 'Conectando…' : supOk ? (allFresh ? 'LIVE' : 'STALE') : 'OFFLINE'}
        </span>
        <button
          className="bg-cd bd rounded-lg px-2.5 py-1.5 text-sm"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          title="Cambiar tema"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  );
}
