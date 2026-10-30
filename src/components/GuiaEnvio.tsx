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

const pagoLegible = (m?: string | null): string => {
  const v = (m ?? "").toLowerCase().trim();
  if (!v) return "PAGO CONTRA ENTREGA";
  if (v.includes("contra")) return "PAGO CONTRA ENTREGA";
  if (v.includes("transfer") || v.includes("pagado")) return "YA PAGADO";
  return (m ?? "").toUpperCase();
};

const dinero = (n?: number | null) => `$${Number(n ?? 0).toLocaleString("es-CO")}`;

const fechaCorta = (iso?: string | null) => {
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
/* CSS Modificado para Etiquetas 4x6 / 6x4 (Térmicas)                  */
/* ------------------------------------------------------------------ */
const PRINT_CSS = `
@media print {
  @page {
    /* Configurado para etiquetas estándar de 4x6 pulgadas (o 6x4) */
    size: 4in 6in; 
    margin: 0; /* Las térmicas no necesitan márgenes */
  }

  html, body {
    background: #ffffff !important;
    margin: 0 !important;
    padding: 0 !important;
    width: 100% !important;
    height: 100% !important;
  }

  body > *:not(.guia-portal) {
    display: none !important;
  }

  .guia-portal {
    position: static !important;
    display: block !important;
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
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

  /* Ajustes específicos para que quepa en 4x6 */
  #guia-print {
    width: 100% !important;
    height: 100% !important;
    max-width: none !important;
    margin: 0 !important;
    padding: 10px !important; /* Margen interno pequeño */
    border: none !important;
    box-shadow: none !important;
    background: #ffffff !important;
    color: #000000 !important;
    box-sizing: border-box !important;
    display: flex;
    flex-direction: column;
  }
}
`;

export default function GuiaEnvio({
  pedido,
  onClose,
}: {
  pedido: GuiaPedido;
  onClose: () => void;
}) {
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
          className="guia-wrapper w-full max-w-[450px] my-6"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Barra de acciones */}
          <div className="no-print mb-3 flex items-center justify-end gap-2">
            <button
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Imprimir Etiqueta
            </button>
            <button
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 bg-white/10 hover:bg-white/20 px-4 py-2.5 text-sm font-bold text-white transition-colors"
            >
              <X className="w-4 h-4" />
              Cerrar
            </button>
          </div>

          {/* GUÍA COMPACTA (Diseño 4x6) */}
          <div
            id="guia-print"
            className="rounded-xl bg-white p-5 text-black shadow-2xl flex flex-col gap-3"
          >
            {/* Encabezado */}
            <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-2">
              <div>
                <h1 className="text-xl font-black tracking-tight leading-none">
                  TODOENUNO
                </h1>
                <p className="mt-0.5 text-[9px] font-bold uppercase tracking-widest">
                  Guía de entrega
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-sm font-black leading-none">#{idCorto}</p>
                <p className="mt-0.5 text-[9px] text-neutral-600">{fechaCorta(pedido.created_at)}</p>
              </div>
            </div>

            {/* Datos del cliente */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">
                Destinatario
              </p>
              <p className="text-sm font-bold leading-tight">
                {pedido.nombre_cliente || "—"}
              </p>
              <p className="text-xs font-semibold">
                Tel: {pedido.telefono || "—"}
              </p>
              <p className="text-xs leading-tight mt-1">
                {pedido.direccion || "—"}
              </p>
            </div>

            {/* Contenido */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">
                Contenido
              </p>
              <table className="w-full border-collapse text-xs mt-1">
                <thead>
                  <tr className="border-y-2 border-black">
                    <th className="py-1 text-left font-bold uppercase">SKU / Producto</th>
                    <th className="w-12 py-1 text-center font-bold uppercase">Cant.</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-neutral-300">
                    <td className="py-1.5 font-semibold truncate max-w-[200px]">
                      {pedido.sku || "—"}
                    </td>
                    <td className="py-1.5 text-center font-black">1</td>
                  </tr>
                </tbody>
              </table>
              {pedido.codigo_anuncio && (
                <p className="mt-1 text-[9px] text-neutral-600">
                  Ref: <span className="font-bold">{pedido.codigo_anuncio}</span>
                </p>
              )}
            </div>

            {/* Recuadro de pago (Destacado) */}
            <div className="border-[3px] border-black px-2 py-2 text-center">
              <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-600">
                Pago
              </p>
              <p className="text-lg font-black uppercase leading-tight">
                {pago}
              </p>
              <p className="text-xs font-bold mt-0.5">
                Total: <span className="text-sm">{dinero(pedido.total)}</span>
              </p>
            </div>

            {/* Notas */}
            {pedido.notas && (
              <div className="border-l-2 border-neutral-400 pl-2">
                <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-500">
                  Notas
                </p>
                <p className="text-[10px] leading-tight line-clamp-2">{pedido.notas}</p>
              </div>
            )}

            {/* Firma (Más compacta) */}
            <div className="mt-auto pt-6">
              <div className="border-t border-black pt-1">
                <p className="text-[9px] font-bold uppercase tracking-widest text-neutral-600">
                  Firma de recibido
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(contenido, document.body);
}
