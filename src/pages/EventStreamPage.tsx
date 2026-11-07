import React from 'react';
import { EventStreamViewer } from '@/components/events/EventStreamViewer';
import { Radio, Sparkles } from 'lucide-react';

export function EventStreamPage() {
  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Radio className="text-emerald-500 animate-pulse" size={20} />
            <h1 className="text-xl font-black">OS Event Stream</h1>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              Sprint 1 Core
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1">
            Núcleo central de eventos inmutables de TodoEnUno OS. Flujo vivo de pedidos, chat, marketing y logística.
          </p>
        </div>
      </div>

      <EventStreamViewer />
    </div>
  );
}
