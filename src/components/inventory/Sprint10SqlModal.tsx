import { useState } from 'react';
import { Code, Copy, Check, X } from 'lucide-react';
import { SPRINT10_INVENTORY_SQL } from '@/lib/inventorySql';

export function Sprint10SqlModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const copySql = () => {
    navigator.clipboard.writeText(SPRINT10_INVENTORY_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col"
      >
        <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
          <div className="flex items-center gap-2">
            <Code size={18} className="text-emerald-500" />
            <h3 className="font-bold text-sm">
              Script SQL Sprint 10 — Catálogo, Inventario y Eliminación en Cascada
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/10">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          <div className="p-4 bg-sf rounded-xl border border-[var(--bd)] text-xs tx-mu space-y-1.5">
            <p className="font-semibold text-[var(--tx)]">
              Instrucciones para Supabase (ejecutar 1 sola vez):
            </p>
            <p>
              1. Copia el script de abajo y pégalo en tu <strong>Supabase SQL Editor</strong>.
            </p>
            <p>
              2. Presiona <strong>Run</strong>. Esto expone{' '}
              <code className="font-mono bg-cd px-1 rounded">public.record_movement</code>, repara{' '}
              <code className="font-mono bg-cd px-1 rounded">productos_variantes_template_id_fkey</code>{' '}
              con <code className="font-mono bg-cd px-1 rounded">ON DELETE CASCADE</code>, crea el RPC{' '}
              <code className="font-mono bg-cd px-1 rounded">delete_inventory_product</code> y habilita{' '}
              <code className="font-mono bg-cd px-1 rounded">inventario_inicial</code> sin compra previa.
            </p>
          </div>

          <div className="relative">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-mono tx-mu">
                docs/20261112_sprint10_catalog_inventory_fix.sql
              </span>
              <button
                onClick={copySql}
                className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '¡Copiado!' : 'Copiar Script SQL'}
              </button>
            </div>
            <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800 leading-relaxed">
              {SPRINT10_INVENTORY_SQL}
            </pre>
          </div>
        </div>

        <div className="p-4 border-t border-[var(--bd)] bg-sf flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
