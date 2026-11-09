import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X, Truck, FileText, CheckCircle2 } from "lucide-react";
import type { Pedido } from "@/pages/Pedidos";

interface Props {
  pedidos: Pedido[];
  onClose: () => void;
  courierInicial?: string;
}

const COURIERS_COMUNES = [
  "Motorista Central 1",
  "Motorista Central 2",
  "Cargo Expreso El Salvador",
  "Urbano Express",
  "C807 Xpress",
  "Retiro en Oficina / Local"
];

const PRINT_CSS = `
@media print {
  @page { size: letter portrait; margin: 12mm; }
  html, body { background: #ffffff !important; margin: 0 !important; padding: 0 !important; width: 100% !important; }
  body > *:not(.manifiesto-portal) { display: none !important; }
  .manifiesto-portal { position: static !important; display: block !important; width: 100% !important; margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
  .manifiesto-portal .no-print { display: none !important; }
  #manifiesto-print {
    width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important;
    border: none !important; box-shadow: none !important; color: #000000 !important;
  }
}
`;

export default function ManifiestoDespacho({ pedidos, onClose, courierInicial }: Props) {
  const [courier, setCourier] = useState(courierInicial || COURIERS_COMUNES[0]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const totalCobro = pedidos.reduce((sum, p) => sum + (Number(p.total) || 0), 0);
  const fechaStr = new Date().toLocaleDateString("es-SV", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
  const horaStr = new Date().toLocaleTimeString("es-SV", { hour: "2-digit", minute: "2-digit" });

  const contenido = (
    <>
      <style>{PRINT_CSS}</style>
      <div className="manifiesto-portal fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
        <div className="w-full max-w-4xl my-6 bg-white rounded-2xl shadow-2xl p-6 text-black flex flex-col gap-5" onClick={e => e.stopPropagation()}>
          {/* Barra de control no imprimible */}
          <div className="no-print flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-4 border-b border-neutral-200">
            <div className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-indigo-600" />
              <div>
                <h2 className="text-base font-bold text-neutral-900">Manifiesto de Despacho Logístico</h2>
                <p className="text-xs text-neutral-500">Hoja de salida y liquidación para motoristas ({pedidos.length} paquetes)</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span>Transportista:</span>
                <select
                  value={courier}
                  onChange={e => setCourier(e.target.value)}
                  className="p-1.5 border border-neutral-300 rounded-lg text-xs font-bold outline-none focus:border-indigo-500 bg-neutral-50"
                >
                  {COURIERS_COMUNES.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>

              <button
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-md transition-colors"
              >
                <Printer className="w-4 h-4" /> Imprimir Manifiesto
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-xl border border-neutral-300 hover:bg-neutral-100 text-neutral-600 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* DOCUMENTO IMPRIMIBLE */}
          <div id="manifiesto-print" className="flex flex-col gap-4 text-xs font-sans">
            {/* Cabecera */}
            <div className="flex items-start justify-between border-b-2 border-black pb-3">
              <div>
                <h1 className="text-2xl font-black tracking-tight uppercase leading-none">TODOENUNO OS</h1>
                <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600 mt-0.5">Control de Envíos y Liquidación Contra Entrega</p>
                <div className="mt-2 text-xs">
                  <span className="font-bold">Transportista / Motorista: </span>
                  <span className="font-mono font-black text-sm bg-neutral-100 px-2 py-0.5 rounded border border-neutral-300">{courier}</span>
                </div>
              </div>

              <div className="text-right">
                <span className="inline-block px-2.5 py-1 bg-black text-white text-[10px] font-bold uppercase rounded tracking-wider">
                  Manifiesto de Salida
                </span>
                <p className="text-[11px] font-bold mt-1 text-neutral-800 capitalize">{fechaStr}</p>
                <p className="text-[10px] text-neutral-500 font-mono">Hora: {horaStr}</p>
              </div>
            </div>

            {/* Resumen KPIs */}
            <div className="grid grid-cols-3 gap-3 p-3 bg-neutral-50 border border-neutral-300 rounded-lg text-center">
              <div>
                <span className="text-[9px] uppercase font-bold text-neutral-500 block">Total Paquetes</span>
                <span className="text-lg font-black">{pedidos.length} unidades</span>
              </div>
              <div>
                <span className="text-[9px] uppercase font-bold text-neutral-500 block">Total a Cobrar en Calle</span>
                <span className="text-lg font-black text-emerald-700 font-mono">
                  ${totalCobro.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </span>
              </div>
              <div>
                <span className="text-[9px] uppercase font-bold text-neutral-500 block">Método Promedio</span>
                <span className="text-xs font-bold text-neutral-700">100% Contra Entrega</span>
              </div>
            </div>

            {/* Tabla de Envíos */}
            <div className="border border-neutral-400 rounded-lg overflow-hidden mt-1">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-neutral-200 border-b border-neutral-400 font-black uppercase text-[10px]">
                    <th className="p-2 text-center w-8">#</th>
                    <th className="p-2 text-left w-20">Guía / ID</th>
                    <th className="p-2 text-left">Cliente & Teléfono</th>
                    <th className="p-2 text-left">Dirección de Entrega</th>
                    <th className="p-2 text-left">Producto / SKU</th>
                    <th className="p-2 text-right w-24">Cobro ($)</th>
                    <th className="p-2 text-center w-24">Estado / Firma</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-300">
                  {pedidos.map((p, idx) => (
                    <tr key={p.id} className="hover:bg-neutral-50">
                      <td className="p-2 text-center font-bold text-neutral-500">{idx + 1}</td>
                      <td className="p-2 font-mono font-bold">{p.id.slice(0, 8).toUpperCase()}</td>
                      <td className="p-2">
                        <div className="font-bold text-neutral-900 leading-tight">{p.nombre_cliente || "—"}</div>
                        <div className="text-[10px] text-neutral-600 font-mono">{p.telefono || "—"}</div>
                      </td>
                      <td className="p-2 max-w-xs leading-snug">
                        <div className="text-[11px]">{p.direccion || "—"}</div>
                        {p.notas && <div className="text-[9px] text-neutral-500 italic mt-0.5">Nota: {p.notas}</div>}
                      </td>
                      <td className="p-2 font-mono text-[10px] font-semibold">{p.sku || "—"}</td>
                      <td className="p-2 text-right font-mono font-black text-sm">
                        ${Number(p.total || 0).toFixed(2)}
                      </td>
                      <td className="p-2 text-center">
                        <div className="w-16 h-6 border border-dashed border-neutral-400 rounded mx-auto flex items-center justify-center text-[8px] text-neutral-400 uppercase">
                          Recibido
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-neutral-100 font-black border-t-2 border-neutral-400">
                    <td colSpan={5} className="p-2 text-right uppercase text-xs">Total Efectivo a Entregar al Regreso:</td>
                    <td className="p-2 text-right font-mono text-base text-emerald-800">
                      ${totalCobro.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Firmas de Control */}
            <div className="grid grid-cols-3 gap-6 pt-10 mt-6 border-t border-neutral-300">
              <div className="text-center">
                <div className="border-b border-black mb-1.5 h-10"></div>
                <span className="text-[10px] font-bold uppercase tracking-wider block">Despachado por (Bodega)</span>
                <span className="text-[9px] text-neutral-500">Firma y Sello</span>
              </div>

              <div className="text-center">
                <div className="border-b border-black mb-1.5 h-10"></div>
                <span className="text-[10px] font-bold uppercase tracking-wider block">Recibido por Motorista</span>
                <span className="text-[9px] text-neutral-500">{courier}</span>
              </div>

              <div className="text-center">
                <div className="border-b border-black mb-1.5 h-10"></div>
                <span className="text-[10px] font-bold uppercase tracking-wider block">Liquidación en Finanzas</span>
                <span className="text-[9px] text-neutral-500">Efectivo Ingresado a Caja</span>
              </div>
            </div>

            {/* Pie de página */}
            <div className="flex justify-between items-center text-[9px] text-neutral-400 pt-3 border-t border-neutral-200">
              <span>TODOENUNO OS · Módulo Logístico Contra Entrega</span>
              <span>Generado el {fechaStr} a las {horaStr}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  return createPortal(contenido, document.body);
}
