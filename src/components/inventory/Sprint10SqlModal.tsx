import { useState } from 'react';
import { Code, Copy, Check, X, Trash2, Wrench } from 'lucide-react';
import { SPRINT10_INVENTORY_SQL, SPRINT11_RESET_CERO_SQL } from '@/lib/inventorySql';

export function Sprint10SqlModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'reset' | 'repair'>('reset');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const activeSql = mode === 'reset' ? SPRINT11_RESET_CERO_SQL : SPRINT10_INVENTORY_SQL;
  const fileLabel =
    mode === 'reset'
      ? 'docs/20261112_sprint11_reset_cero_odoo.sql'
      : 'docs/20261112_sprint10_catalog_inventory_fix.sql';

  const copySql = () => {
    navigator.clipboard.writeText(activeSql);
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
              Scripts SQL Supabase — Reinicio Limpio & Sincronización Nativa
            </h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/10">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {/* Selector de Modo */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 bg-sf rounded-xl border border-[var(--bd)]">
            <button
              type="button"
              onClick={() => {
                setMode('reset');
                setCopied(false);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'reset' ? 'bg-rose-600 text-white shadow-sm' : 'tx-mu hover:text-[var(--tx)]'
              }`}
            >
              <Trash2 size={14} /> Reiniciar desde 0 (Borrar Odoo)
            </button>

            <button
              type="button"
              onClick={() => {
                setMode('repair');
                setCopied(false);
              }}
              className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                mode === 'repair' ? 'bg-[var(--tx)] text-[var(--cd)] shadow-sm' : 'tx-mu hover:text-[var(--tx)]'
              }`}
            >
              <Wrench size={14} /> Solo Reparar (Sin Borrar)
            </button>
          </div>

          {mode === 'reset' ? (
            <div className="p-4 bg-rose-500/10 rounded-xl border border-rose-500/30 text-xs space-y-1.5">
              <p className="font-bold text-rose-600 dark:text-rose-400">
                Reinicio Total de Catálogo e Inventario (Recomendado para iniciar desde 0):
              </p>
              <p className="tx-mu leading-relaxed">
                Elimina por completo los productos heredados de Odoo (<code className="font-mono">productos</code>,{' '}
                <code className="font-mono">productos_variantes</code>,{' '}
                <code className="font-mono">inventory_cache</code>,{' '}
                <code className="font-mono">inventory.stock</code>,{' '}
                <code className="font-mono">inventory.kardex</code>) y deja configuradas todas las funciones y
                permisos RLS para empezar a cargar tu inventario real desde cero.{' '}
                <strong className="text-[var(--tx)]">
                  Tus pedidos, finanzas, eventos y clientes DICOM NO se borran.
                </strong>
              </p>
            </div>
          ) : (
            <div className="p-4 bg-sf rounded-xl border border-[var(--bd)] text-xs tx-mu space-y-1.5">
              <p className="font-semibold text-[var(--tx)]">
                Solo reparación de permisos, Kárdex y eliminación en cascada (conserva productos actuales):
              </p>
              <p>
                Copia y ejecuta en tu <strong>Supabase SQL Editor</strong> para exponer{' '}
                <code className="font-mono bg-cd px-1 rounded">public.record_movement</code>,{' '}
                <code className="font-mono bg-cd px-1 rounded">delete_inventory_product</code> y{' '}
                <code className="font-mono bg-cd px-1 rounded">ON DELETE CASCADE</code>.
              </p>
            </div>
          )}

          <div className="relative">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-mono tx-mu">{fileLabel}</span>
              <button
                onClick={copySql}
                className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? '¡Copiado!' : 'Copiar Script SQL'}
              </button>
            </div>
            <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800 leading-relaxed">
              {activeSql}
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
