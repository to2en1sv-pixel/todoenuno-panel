import { useState, useEffect } from 'react';
import { EventStreamViewer } from '@/components/events/EventStreamViewer';
import { OsBrainGraph } from '@/components/events/OsBrainGraph';
import { fetchOsEvents, subscribeToOsEvents } from '@/lib/osEvents';
import type { OsEvent } from '@/types/events';

export function EventStreamPage() {
  const [activeTab, setActiveTab] = useState<'brain' | 'feed'>('brain');
  const [events, setEvents] = useState<OsEvent[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);

  useEffect(() => {
    fetchOsEvents(120).then((res) => {
      setEvents(res.events);
      setTotalCount(res.totalCount);
    });

    const handleSynced = (e: Event) => {
      const detail = (e as CustomEvent<{ totalCount?: number; events?: OsEvent[] }>).detail;
      if (typeof detail?.totalCount === 'number') {
        setTotalCount(detail.totalCount);
      }
      if (Array.isArray(detail?.events)) {
        setEvents(detail.events.slice(0, 120));
      }
    };
    window.addEventListener('os-events-synced', handleSynced);

    const unsubscribe = subscribeToOsEvents((newEvent) => {
      setEvents((prev) => {
        if (
          prev.some(
            (e) =>
              e.id === newEvent.id ||
              (newEvent.idempotency_key && e.idempotency_key === newEvent.idempotency_key)
          )
        ) {
          return prev;
        }
        setTotalCount((c) => Math.max(c + 1, prev.length + 1));
        return [newEvent, ...prev.slice(0, 149)];
      });
    });

    return () => {
      window.removeEventListener('os-events-synced', handleSynced);
      unsubscribe();
    };
  }, []);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            OS Brain &amp; Eventos
          </h1>
          <p className="text-xs text-[var(--mu)] mt-1">
            Flujo en vivo de pedidos COD, antifraude, logística y fidelización ·{' '}
            <span className="font-mono tabular-nums">
              {totalCount.toLocaleString()} eventos históricos · {events.length} en vivo
            </span>
          </p>
        </div>
      </header>

      <nav className="flex items-center gap-6 border-b border-[var(--bd)] overflow-x-auto">
        {[
          { id: 'brain', label: 'OS Brain (Red Neuronal)' },
          { id: 'feed', label: 'Feed de eventos en vivo' },
        ].map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as 'brain' | 'feed')}
              className={`pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                active
                  ? 'border-[var(--tx)] text-[var(--tx)]'
                  : 'border-transparent text-[var(--mu)] hover:text-[var(--tx)]'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {activeTab === 'brain' ? (
        <div className="flex flex-col gap-6">
          <OsBrainGraph recentEvents={events} />

          <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--bd)]">
            <div className="p-5 text-xs">
              <div className="font-semibold text-[var(--tx)]">Nodos interactivos</div>
              <p className="text-[var(--mu)] mt-1 leading-relaxed">
                Haz clic y arrastra cualquier nodo para reorganizar el mapa o selecciona uno para inspeccionar sus eventos recientes.
              </p>
            </div>
            <div className="p-5 text-xs">
              <div className="font-semibold text-[var(--tx)]">Simulador de flujo COD</div>
              <p className="text-[var(--mu)] mt-1 leading-relaxed">
                Usa el simulador superior para recorrer un pedido desde Meta Ads hasta el cobro en caja y oferta LTV.
              </p>
            </div>
            <div className="p-5 text-xs">
              <div className="font-semibold text-[var(--tx)]">Filtro por línea de negocio</div>
              <p className="text-[var(--mu)] mt-1 leading-relaxed">
                Aísla sinapsis de Venta &amp; Despacho, Retención &amp; LTV o Cadena de Suministro desde el selector.
              </p>
            </div>
          </section>
        </div>
      ) : (
        <EventStreamViewer />
      )}
    </div>
  );
}
