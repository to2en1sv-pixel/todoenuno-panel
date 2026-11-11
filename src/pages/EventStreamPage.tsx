import React, { useState, useEffect } from 'react';
import { EventStreamViewer } from '@/components/events/EventStreamViewer';
import { OsBrainGraph } from '@/components/events/OsBrainGraph';
import { Radio, Brain, Activity, Code, Layers, Sparkles } from 'lucide-react';
import { fetchOsEvents, subscribeToOsEvents } from '@/lib/osEvents';
import type { OsEvent } from '@/types/events';

export function EventStreamPage() {
  const [activeTab, setActiveTab] = useState<'brain' | 'feed' | 'sql'>('brain');
  const [events, setEvents] = useState<OsEvent[]>([]);

  useEffect(() => {
    // Carga inicial de eventos para alimentar OS Brain
    fetchOsEvents(40).then((res) => {
      setEvents(res.events);
    });

    const unsubscribe = subscribeToOsEvents((newEvent) => {
      setEvents((prev) => [newEvent, ...prev.slice(0, 50)]);
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="max-w-7xl mx-auto flex flex-col gap-6 pb-16">
      
      {/* Header Principal con Selector de Modo (OS Brain vs Feed) */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Radio className="text-emerald-500 animate-pulse shrink-0" size={20} />
            <h1 className="text-lg sm:text-xl font-black tracking-tight whitespace-normal sm:whitespace-nowrap">
              OS Event Stream & Brain
            </h1>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/30 shrink-0">
              Gemelo Digital v1.2
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1 max-w-2xl">
            Red neuronal operativa y sistema nervioso inmutable de TODOENUNO OS. Visualiza en vivo cómo interactúan los bots de venta, pedidos COD, antifraude, logística y fidelización en El Salvador.
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 p-1 bg-sf border border-[var(--bd)] rounded-xl shrink-0 w-full sm:w-auto">
          <button
            onClick={() => setActiveTab('brain')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'brain'
                ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm'
                : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <Brain size={14} /> OS Brain (Red Neuronal)
          </button>

          <button
            onClick={() => setActiveTab('feed')}
            className={`flex-1 sm:flex-none px-3.5 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'feed'
                ? 'bg-[var(--tx)] text-[var(--cd)] shadow-sm'
                : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <Activity size={14} /> Feed en Vivo
          </button>
        </div>
      </div>

      {/* Contenido según la pestaña activa */}
      {activeTab === 'brain' ? (
        <div className="flex flex-col gap-6">
          <OsBrainGraph recentEvents={events} />

          {/* Guía Rápida de Interacción con OS Brain */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center shrink-0 mt-0.5">
                <Brain size={16} />
              </div>
              <div className="text-xs">
                <span className="font-bold block text-[var(--tx)]">Nodos Arrastrables e Interactivos</span>
                <span className="text-[var(--mu)] mt-0.5 block leading-relaxed">
                  Haz clic y arrastra cualquier nodo para reorganizar tu mapa mental o haz clic para inspeccionar sus sub-acciones y eventos recientes.
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles size={16} />
              </div>
              <div className="text-xs">
                <span className="font-bold block text-[var(--tx)]">Simulador de Flujo COD El Salvador</span>
                <span className="text-[var(--mu)] mt-0.5 block leading-relaxed">
                  Pulsa el botón "Simular Flujo Pedido COD" para ver en tiempo real cómo viaja un pedido desde Meta Ads hasta el cobro en efectivo y la oferta LTV.
                </span>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] flex items-start gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                <Layers size={16} />
              </div>
              <div className="text-xs">
                <span className="font-bold block text-[var(--tx)]">Filtrado por Línea de Negocio</span>
                <span className="text-[var(--mu)] mt-0.5 block leading-relaxed">
                  Aísla las sinapsis de Venta & Despacho, Retención & LTV o Cadena de Suministro desde el selector superior.
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <EventStreamViewer />
      )}
    </div>
  );
}
