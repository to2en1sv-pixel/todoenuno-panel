import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";

export interface GuiaPedido {
  id: string;
  nombre_cliente?: string | null;
  telefono?: string | null;
  direccion?: string | null;
  sku?: string | null;
  metodo_pago?: string | null;
  notas?: string | null;
  total?: number | null;
  codigo_anuncio?: string | null;
  created_at?: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const pagoLegible = (m?: string | null): string => {
  const v = (m ?? "").toLowerCase().trim();
  if (!v) return "PAGO CONTRA ENTREGA";
  if (v.includes("contra")) return "PAGO CONTRA ENTREGA";
  if (v.includes("transfer") || v.includes("pagado")) return "YA PAGADO";
  return (m ?? "").toUpperCase();
};

const dinero = (n?: number | null) => `$${Number(n ?? 0).toLocaleString("es-CO")}`;

const fechaLarga = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("es-CO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

/* ------------------------------------------------------------------ */
/* CSS de impresión                                                    */
/* ------------------------------------------------------------------ */

const PRINT_CSS = `
@media print {
  html, body {
    background: #ffffff !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  /* Ocultamos TODO lo que no sea el portal de la guía
     (sidebar, header de la app, kanban, toasts, etc.) */
  body > *:not(.guia-portal) {
    display: none !important;
  }

  .guia-portal {
    position: static !important;
    inset: auto !important;
    display: block !important;
    width: 100% !important;
    height: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
    backdrop-filter: none !important;
    -webkit-backdrop-filter: none !important;
    overflow: visible !important;
    z-index: auto !important;
  }

  .guia-portal .guia-wrapper {
    max-width: none !important;
    width: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
  }

  .guia-portal .no-print {
    display: none !important;
  }

  #guia-print {
    position: static !important;
    width: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
    border: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    background: #ffffff !important;
    color: #000000 !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  @page {
    size: A4 portrait;
    margin: 12mm;
  }
}
`;

/* ------------------------------------------------------------------ */
/* Componente                                                          */
/* ------------------------------------------------------------------ */

export default function GuiaEnvio({
  pedido,
  onClose,
}: {
  pedido: GuiaPedido;
  onClose: () => void;
}) {
  /* Cerrar con Escape + bloquear scroll del body */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  const idCorto = pedido.id.slice(0, 8).toUpperCase();
  const pago = pagoLegible(pedido.metodo_pago);

  const contenido = (
    <>
      <style>{PRINT_CSS}</style>

      <div
        className="guia-portal fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <div
          className="guia-wrapper w-full max-w-[820px] my-6"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ---------------- Barra de acciones (no se imprime) ---------------- */}
          <div className="no-print mb-3 flex items-center justify-end gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Imprimir
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 hover:bg-white/20 px-4 py-2.5 text-sm font-bold text-white transition-colors"
            >
              <X className="w-4 h-4" />
              Cerrar
            </button>
          </div>

          {/* ---------------- GUÍA IMPRIMIBLE ---------------- */}
          <div
            id="guia-print"
            className="rounded-xl bg-white p-8 text-black shadow-2xl"
          >
            {/* Encabezado */}
            <div className="flex items-start justify-between gap-4 border-b-4 border-black pb-4">
              <div>
                <h1 className="text-2xl font-black tracking-tight leading-none">
                  TODOENUNO
                </h1>
                <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.3em]">
                  Guía de entrega
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-widest">
                  Pedido
                </p>
                <p className="font-mono text-xl font-black leading-none">#{idCorto}</p>
                <p className="mt-1 text-[10px] text-neutral-600">{fechaLarga(pedido.created_at)}</p>
              </div>
            </div>

            {/* Datos del cliente */}
            <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                  Cliente
                </p>
                <p className="text-base font-bold leading-snug">
                  {pedido.nombre_cliente || "—"}
                </p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                  Teléfono
                </p>
                <p className="text-base font-bold leading-snug">
                  {pedido.telefono || "—"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                  Dirección de entrega
                </p>
                <p className="text-base font-bold leading-snug">
                  {pedido.direccion || "—"}
                </p>
              </div>
            </div>

            {/* Contenido */}
            <div className="mt-6">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Contenido del paquete
              </p>
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-y-2 border-black">
                    <th className="py-2 text-left font-bold uppercase tracking-wide">
                      SKU / Producto
                    </th>
                    <th className="w-24 py-2 text-center font-bold uppercase tracking-wide">
                      Cant.
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-neutral-300">
                    <td className="py-3 font-semibold">{pedido.sku || "—"}</td>
                    <td className="py-3 text-center font-black">1</td>
                  </tr>
                </tbody>
              </table>
              {pedido.codigo_anuncio && (
                <p className="mt-2 text-[11px] text-neutral-600">
                  Ref. anuncio: <span className="font-bold">{pedido.codigo_anuncio}</span>
                </p>
              )}
            </div>

            {/* Recuadro de pago */}
            <div className="mt-6 border-4 border-black px-4 py-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-neutral-600">
                Condición de pago
              </p>
              <p className="mt-1 text-2xl font-black uppercase leading-tight sm:text-3xl">
                {pago}
              </p>
              <p className="mt-2 text-sm font-bold">
                Total a cobrar: <span className="text-lg">{dinero(pedido.total)}</span>
              </p>
            </div>

            {/* Notas */}
            {pedido.notas && (
              <div className="mt-5 border-l-4 border-neutral-400 pl-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                  Notas para el repartidor
                </p>
                <p className="text-sm leading-snug">{pedido.notas}</p>
              </div>
            )}

            {/* Firma */}
            <div className="mt-16">
              <div className="border-t-2 border-black pt-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600">
                  Firma de recibido
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  Nombre y cédula de quien recibe
                </p>
              </div>
            </div>

            {/* Pie */}
            <div className="mt-8 flex items-center justify-between border-t border-neutral-300 pt-3 text-[10px] uppercase tracking-widest text-neutral-500">
              <span>TODOENUNO · Guía de entrega</span>
              <span>#{idCorto}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(contenido, document.body);
}
