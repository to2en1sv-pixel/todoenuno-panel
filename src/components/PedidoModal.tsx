import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Save, AlertCircle, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

const FORM_INICIAL = {
  nombre_cliente: "",
  telefono: "",
  sku: "",
  total: "",
  direccion: "",
  metodo_pago: "Contra entrega",
  codigo_anuncio: "",
  notas: "",
};

type FormKey = keyof typeof FORM_INICIAL;

const inputCls =
  "w-full rounded-lg border border-[var(--bd)] bg-[var(--cd)] px-3 py-2.5 text-sm text-[var(--tx)] outline-none transition-colors focus:ring-2 focus:ring-indigo-500/60 placeholder:opacity-40";

const labelCls =
  "mb-1 block text-[10px] font-bold uppercase tracking-wider opacity-60";

export default function PedidoModal({ onClose, onSaved }: Props) {
  const [form, setForm] = useState({ ...FORM_INICIAL });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Escape + bloqueo de scroll */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !guardando) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, guardando]);

  const set = (key: FormKey) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    /* ---------- Validaciones ---------- */
    if (!form.nombre_cliente.trim()) return setError("El nombre del cliente es obligatorio.");
    if (!form.telefono.trim()) return setError("El teléfono es obligatorio.");
    if (!form.sku.trim()) return setError("El SKU / producto es obligatorio.");
    if (!form.direccion.trim()) return setError("La dirección es obligatoria.");
    if (!form.metodo_pago) return setError("Selecciona un método de pago.");

    const totalNum = Number(String(form.total).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      return setError("El total debe ser un número mayor a 0.");
    }

    /* ---------- Insert ---------- */
    setGuardando(true);
    const { error: dbError } = await supabase.from("whatsapp_orders").insert({
      nombre_cliente: form.nombre_cliente.trim(),
      telefono: form.telefono.trim(),
      sku: form.sku.trim(),
      total: totalNum,
      direccion: form.direccion.trim(),
      metodo_pago: form.metodo_pago,
      codigo_anuncio: form.codigo_anuncio.trim() || null,
      notas: form.notas.trim() || null,
      estado: "nuevo",
    });
    setGuardando(false);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    onSaved();
    onClose();
  };

  const contenido = (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4"
      onClick={() => !guardando && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="my-6 w-full max-w-xl rounded-2xl border border-[var(--bd)] bg-[var(--cd)] text-[var(--tx)] shadow-2xl"
      >
        {/* Header */}
        <header className="flex items-start justify-between gap-3 border-b border-[var(--bd)] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-50">
              Alta manual
            </p>
            <h2 className="flex items-center gap-2 text-lg font-black">
              <Plus className="h-5 w-5 text-indigo-500" />
              Nuevo Pedido
            </h2>
          </div>
          <button
            onClick={() => !guardando && onClose()}
            disabled={guardando}
            className="rounded-lg p-1.5 transition-colors hover:bg-black/10 disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Formulario */}
        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-500">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {/* Nombre */}
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="nombre_cliente">
                Nombre del cliente *
              </label>
              <input
                id="nombre_cliente"
                type="text"
                value={form.nombre_cliente}
                onChange={set("nombre_cliente")}
                placeholder="Ej. María González"
                className={inputCls}
                autoFocus
              />
            </div>

            {/* Teléfono */}
            <div>
              <label className={labelCls} htmlFor="telefono">
                Teléfono *
              </label>
              <input
                id="telefono"
                type="tel"
                value={form.telefono}
                onChange={set("telefono")}
                placeholder="Ej. 3001234567"
                className={inputCls}
              />
            </div>

            {/* Total */}
            <div>
              <label className={labelCls} htmlFor="total">
                Total ($) *
              </label>
              <input
                id="total"
                type="number"
                min="0"
                step="1"
                value={form.total}
                onChange={set("total")}
                placeholder="Ej. 85000"
                className={inputCls}
              />
            </div>

            {/* SKU */}
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="sku">
                SKU / Producto *
              </label>
              <input
                id="sku"
                type="text"
                value={form.sku}
                onChange={set("sku")}
                placeholder="Ej. TENIS-RUN-NEG-42"
                className={inputCls}
              />
            </div>

            {/* Dirección */}
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="direccion">
                Dirección *
              </label>
              <input
                id="direccion"
                type="text"
                value={form.direccion}
                onChange={set("direccion")}
                placeholder="Ej. Cra 45 #12-34, Barrio Centro, Apto 201"
                className={inputCls}
              />
            </div>

            {/* Método de pago */}
            <div>
              <label className={labelCls} htmlFor="metodo_pago">
                Método de pago *
              </label>
              <select
                id="metodo_pago"
                value={form.metodo_pago}
                onChange={set("metodo_pago")}
                className={inputCls}
              >
                <option value="Contra entrega">Contra entrega</option>
                <option value="Transferencia">Transferencia</option>
              </select>
            </div>

            {/* Código de anuncio */}
            <div>
              <label className={labelCls} htmlFor="codigo_anuncio">
                Código de anuncio
              </label>
              <input
                id="codigo_anuncio"
                type="text"
                value={form.codigo_anuncio}
                onChange={set("codigo_anuncio")}
                placeholder="Opcional"
                className={inputCls}
              />
            </div>

            {/* Notas */}
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="notas">
                Notas
              </label>
              <textarea
                id="notas"
                rows={3}
                value={form.notas}
                onChange={set("notas")}
                placeholder="Instrucciones de entrega, referencias, horarios..."
                className={`${inputCls} resize-none`}
              />
            </div>
          </div>

          {/* Acciones */}
          <div className="flex flex-col-reverse gap-2 border-t border-[var(--bd)] pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={guardando}
              className="rounded-xl border border-[var(--bd)] bg-[var(--cd)] px-4 py-2.5 text-sm font-bold text-[var(--tx)] transition-colors hover:bg-black/5 disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {guardando ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Guardando...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4" />
                  Crear Pedido
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(contenido, document.body);
}
