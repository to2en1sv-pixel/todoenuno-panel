import { useEffect, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, Save, AlertCircle, Plus, Edit, Package, Search, Check, RefreshCw, Sparkles, Tag, ChevronDown, CheckCircle2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Pedido } from "@/pages/Pedidos";
import { fetchStockItems } from "@/lib/inventory";
import type { StockItem } from "@/types/inventory";
import { resolveCatalogSku, linkRawSkuToProduct, linkAdCodeToProduct } from "@/lib/catalogAliases";

interface Props {
  onClose: () => void;
  onSaved: () => void;
  pedido?: Pedido | null; // Si existe, editamos
}

const FORM_INICIAL = {
  nombre_cliente: "",
  telefono: "",
  sku: "",
  catalogo_sku: "",
  total: "",
  direccion: "",
  metodo_pago: "Contra entrega",
  codigo_anuncio: "",
  notas: "",
  courier: "Motorista Central 1",
  departamento: "San Salvador",
};

type FormKey = keyof typeof FORM_INICIAL;

const inputCls =
  "w-full rounded-lg border border-[var(--bd)] bg-[var(--cd)] px-3 py-2.5 text-sm text-[var(--tx)] outline-none transition-colors focus:ring-2 focus:ring-indigo-500/60 placeholder:opacity-40";

const labelCls =
  "mb-1 block text-[10px] font-bold uppercase tracking-wider opacity-60";

export default function PedidoModal({ onClose, onSaved, pedido }: Props) {
  const [form, setForm] = useState({ ...FORM_INICIAL });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Catálogo maestro de productos
  const [catalogo, setCatalogo] = useState<StockItem[]>([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);
  const [busquedaProducto, setBusquedaProducto] = useState("");
  const [modoManual, setModoManual] = useState(false);
  const [selectorAbierto, setSelectorAbierto] = useState(false);

  // Cargar catálogo de productos
  useEffect(() => {
    let cancelado = false;
    async function loadCatalog() {
      setCargandoCatalogo(true);
      try {
        const { items } = await fetchStockItems();
        if (!cancelado) {
          setCatalogo(items || []);
        }
      } catch (err) {
        console.warn("No se pudo cargar catálogo para el selector de pedidos:", err);
      } finally {
        if (!cancelado) setCargandoCatalogo(false);
      }
    }
    loadCatalog();
    return () => { cancelado = true; };
  }, []);

  // Inicializar o auto-resolver producto si editamos
  useEffect(() => {
    if (pedido) {
      const knownSkus = catalogo.map(c => c.sku);
      const catSkuResuelto = (pedido as any).catalogo_sku || 
        resolveCatalogSku(pedido.sku, pedido.codigo_anuncio, null, knownSkus) || "";

      setForm({
        nombre_cliente: pedido.nombre_cliente || "",
        telefono: pedido.telefono || "",
        sku: pedido.sku || "",
        catalogo_sku: catSkuResuelto,
        total: pedido.total?.toString() || "",
        direccion: pedido.direccion || "",
        metodo_pago: pedido.metodo_pago || "Contra entrega",
        codigo_anuncio: pedido.codigo_anuncio || "",
        notas: pedido.notas || "",
        courier: (pedido as any).courier || "Motorista Central 1",
        departamento: (pedido as any).departamento || "San Salvador",
      });

      if (!catSkuResuelto && pedido.sku) {
        setModoManual(true);
      }
    }
  }, [pedido, catalogo]);

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

  // Producto seleccionado actualmente del catálogo
  const productoSeleccionado = useMemo(() => {
    if (!form.catalogo_sku) return null;
    return catalogo.find(p => p.sku.toUpperCase() === form.catalogo_sku.toUpperCase()) || null;
  }, [catalogo, form.catalogo_sku]);

  // Lista filtrada para el selector
  const productosFiltrados = useMemo(() => {
    if (!busquedaProducto.trim()) return catalogo;
    const q = busquedaProducto.toLowerCase().trim();
    return catalogo.filter(p => 
      p.sku.toLowerCase().includes(q) || 
      p.nombre.toLowerCase().includes(q)
    );
  }, [catalogo, busquedaProducto]);

  // Seleccionar producto del catálogo
  const handleSeleccionarProducto = (prod: StockItem) => {
    setForm(f => ({
      ...f,
      catalogo_sku: prod.sku,
      sku: f.sku && f.sku !== FORM_INICIAL.sku ? f.sku : prod.nombre,
      total: (!f.total || f.total === "0") && prod.precio_venta ? prod.precio_venta.toString() : f.total
    }));
    setSelectorAbierto(false);
    setModoManual(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    /* ---------- Validaciones ---------- */
    if (!form.nombre_cliente.trim()) return setError("El nombre del cliente es obligatorio.");
    if (!form.telefono.trim()) return setError("El teléfono es obligatorio.");
    if (!form.sku.trim() && !form.catalogo_sku.trim()) return setError("Debes seleccionar un producto del catálogo o ingresar el nombre.");
    if (!form.direccion.trim()) return setError("La dirección es obligatoria.");
    if (!form.metodo_pago) return setError("Selecciona un método de pago.");

    const totalNum = Number(String(form.total).replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(totalNum) || totalNum <= 0) {
      return setError("El total debe ser un número mayor a 0.");
    }

    const skuFinal = form.sku.trim() || form.catalogo_sku.trim();
    const catalogoSkuFinal = form.catalogo_sku.trim() || null;

    /* ---------- Insert o Update ---------- */
    setGuardando(true);
    const basePayload = {
      nombre_cliente: form.nombre_cliente.trim(),
      telefono: form.telefono.trim(),
      sku: skuFinal,
      total: totalNum,
      direccion: form.direccion.trim(),
      metodo_pago: form.metodo_pago,
      codigo_anuncio: form.codigo_anuncio.trim() || null,
      notas: form.notas.trim() || null,
    };

    const fullPayload = {
      ...basePayload,
      catalogo_sku: catalogoSkuFinal,
      courier: form.courier,
      departamento: form.departamento,
    };

    let dbError = null;

    if (pedido) {
      // Actualizar con fallback si columnas no existen en DB
      let res = await supabase
        .from("whatsapp_orders")
        .update(fullPayload)
        .eq("id", pedido.id);
      
      if (res.error && res.error.message?.includes("column")) {
        res = await supabase
          .from("whatsapp_orders")
          .update(basePayload)
          .eq("id", pedido.id);
      }
      dbError = res.error;
    } else {
      // Crear con fallback
      let res = await supabase.from("whatsapp_orders").insert({
        ...fullPayload,
        estado: "nuevo",
      });
      if (res.error && res.error.message?.includes("column")) {
        res = await supabase.from("whatsapp_orders").insert({
          ...basePayload,
          estado: "nuevo",
        });
      }
      dbError = res.error;
    }

    setGuardando(false);

    if (dbError) {
      setError(dbError.message);
      return;
    }

    // Registrar alias y código de anuncio en el motor de atribución
    if (catalogoSkuFinal) {
      try {
        if (skuFinal && skuFinal.toLowerCase() !== catalogoSkuFinal.toLowerCase()) {
          linkRawSkuToProduct(skuFinal, catalogoSkuFinal);
        }
        if (form.codigo_anuncio.trim()) {
          linkAdCodeToProduct(form.codigo_anuncio.trim(), catalogoSkuFinal);
        }
      } catch (err) {
        console.warn("No se pudo registrar alias de atribución:", err);
      }
    }

    // Emitir evento al OS Event Store para trazabilidad en vivo
    try {
      const { emitOsEvent } = await import('@/lib/osEvents');
      emitOsEvent({
        type: pedido ? 'order.confirmed' : 'order.created',
        source_table: 'whatsapp_orders',
        source_id: pedido ? pedido.id : `new-${Date.now()}`,
        payload: {
          ...fullPayload,
          estado: pedido ? (pedido.estado || 'por_empacar') : 'nuevo',
          nombre_cliente: form.nombre_cliente.trim()
        }
      });
    } catch {
      // Ignorar si falla emisión secundaria
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
        <header className="flex items-start justify-between gap-3 border-b border-[var(--bd)] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-50">
              {pedido ? "Editar pedido" : "Alta manual"}
            </p>
            <h2 className="flex items-center gap-2 text-lg font-black">
              {pedido ? (
                <Edit className="h-5 w-5 text-indigo-500" />
              ) : (
                <Plus className="h-5 w-5 text-indigo-500" />
              )}
              {pedido ? "Modificar Pedido" : "Nuevo Pedido"}
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

        <form onSubmit={handleSubmit} className="space-y-4 px-5 py-5">
          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2.5 text-xs text-rose-500">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

            {/* SELECTOR DE PRODUCTO MAESTRO DEL CATÁLOGO */}
            <div className="sm:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <label className={labelCls} htmlFor="sku">
                  Producto del Catálogo (Inventario & ROAS) *
                </label>
                {!modoManual ? (
                  <button
                    type="button"
                    onClick={() => setModoManual(true)}
                    className="text-[10px] font-bold text-indigo-500 hover:underline flex items-center gap-1"
                  >
                    ✏️ Ingresar texto manual
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setModoManual(false);
                      setSelectorAbierto(true);
                    }}
                    className="text-[10px] font-bold text-indigo-500 hover:underline flex items-center gap-1"
                  >
                    🔍 Seleccionar del catálogo
                  </button>
                )}
              </div>

              {/* Si hay un producto del catálogo seleccionado */}
              {!modoManual && productoSeleccionado ? (
                <div className="rounded-xl border border-indigo-500/40 bg-indigo-500/5 p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-lg bg-[var(--cd)] border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                        {productoSeleccionado.image_url ? (
                          <img src={productoSeleccionado.image_url} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-xl">📦</span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                            {productoSeleccionado.sku}
                          </span>
                          <span className="text-[10px] font-bold text-emerald-600">
                            ${Number(productoSeleccionado.precio_venta || 0).toFixed(2)}
                          </span>
                          <span className="text-[10px] opacity-60">
                            · {productoSeleccionado.stock_disponible} disp.
                          </span>
                        </div>
                        <h4 className="font-bold text-xs text-[var(--tx)] truncate mt-0.5">
                          {productoSeleccionado.nombre}
                        </h4>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setForm(f => ({ ...f, catalogo_sku: "" }));
                        setSelectorAbierto(true);
                      }}
                      className="px-2.5 py-1 text-xs font-bold rounded-lg border border-[var(--bd)] bg-[var(--cd)] hover:bg-black/5 text-[var(--tx)] shrink-0 transition-colors"
                    >
                      Cambiar
                    </button>
                  </div>

                  {/* Descripción específica para este pedido / Combo / Variante */}
                  <div className="border-t border-indigo-500/20 pt-2">
                    <label className="text-[9px] font-bold uppercase tracking-wider text-[var(--mu)] block mb-1">
                      Descripción para la Guía / Variante del Pedido:
                    </label>
                    <input
                      type="text"
                      value={form.sku}
                      onChange={set("sku")}
                      placeholder="Ej. Combo 3 unidades - Color Gris"
                      className="w-full rounded-lg border border-[var(--bd)] bg-[var(--cd)] px-2.5 py-1.5 text-xs text-[var(--tx)] outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <span className="text-[9px] opacity-60 mt-0.5 block">
                      💡 La orden se atribuirá a <strong>{productoSeleccionado.nombre} (#{productoSeleccionado.sku})</strong> para ROAS y Kárdex, aunque cambies el texto de la guía.
                    </span>
                  </div>
                </div>
              ) : !modoManual ? (
                /* Combobox Selector desplegable del catálogo */
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-40" />
                    <input
                      type="text"
                      value={busquedaProducto}
                      onChange={(e) => {
                        setBusquedaProducto(e.target.value);
                        setSelectorAbierto(true);
                      }}
                      onFocus={() => setSelectorAbierto(true)}
                      placeholder={cargandoCatalogo ? "Cargando catálogo..." : "Escribe para buscar por nombre o SKU..."}
                      className={`${inputCls} pl-9`}
                    />
                    <button
                      type="button"
                      onClick={() => setSelectorAbierto(!selectorAbierto)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-60 hover:opacity-100"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                  </div>

                  {selectorAbierto && (
                    <div className="absolute z-20 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-xl border border-[var(--bd)] bg-[var(--cd)] shadow-xl p-1 space-y-1">
                      {cargandoCatalogo ? (
                        <div className="p-3 text-center text-xs opacity-50 flex items-center justify-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando productos...
                        </div>
                      ) : productosFiltrados.length === 0 ? (
                        <div className="p-3 text-center text-xs opacity-50">
                          No se encontraron productos coincidentes.
                          <button
                            type="button"
                            onClick={() => {
                              setForm(f => ({ ...f, sku: busquedaProducto }));
                              setModoManual(true);
                              setSelectorAbierto(false);
                            }}
                            className="block mx-auto mt-1 text-indigo-500 font-bold hover:underline"
                          >
                            Usar "{busquedaProducto}" como texto libre
                          </button>
                        </div>
                      ) : (
                        productosFiltrados.map((item) => (
                          <div
                            key={item.sku}
                            onClick={() => handleSeleccionarProducto(item)}
                            className="flex items-center justify-between p-2 rounded-lg hover:bg-indigo-500/10 cursor-pointer transition-colors group"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-lg bg-black/5 dark:bg-white/5 border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                                {item.image_url ? (
                                  <img src={item.image_url} alt="" className="w-full h-full object-cover" />
                                ) : (
                                  <Package className="h-4 w-4 opacity-40" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-[var(--tx)] truncate group-hover:text-indigo-500">
                                  {item.nombre}
                                </p>
                                <span className="text-[10px] font-mono opacity-50 uppercase">
                                  #{item.sku}
                                </span>
                              </div>
                            </div>
                            <div className="text-right shrink-0 pl-2">
                              <span className="text-xs font-bold text-emerald-600 block">
                                ${Number(item.precio_venta || 0).toFixed(2)}
                              </span>
                              <span className="text-[9px] opacity-50 block">
                                {item.stock_disponible} disp.
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Modo manual de texto libre */
                <div className="space-y-1">
                  <input
                    id="sku"
                    type="text"
                    value={form.sku}
                    onChange={set("sku")}
                    placeholder="Ej. TENIS-RUN-NEG-42 o Combo 3 pulseras"
                    className={inputCls}
                  />
                  <span className="text-[10px] opacity-60 block">
                    ⚠️ Ingreso como texto libre no catalogado. Podrás vincularlo luego desde la Bóveda de ROAS.
                  </span>
                </div>
              )}
            </div>

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

            <div>
              <label className={labelCls} htmlFor="courier">
                Transportista / Courier
              </label>
              <select
                id="courier"
                value={form.courier}
                onChange={set("courier")}
                className={inputCls}
              >
                <option value="Motorista Central 1">Motorista Central 1</option>
                <option value="Motorista Central 2">Motorista Central 2</option>
                <option value="Cargo Expreso El Salvador">Cargo Expreso El Salvador</option>
                <option value="Urbano Express">Urbano Express</option>
                <option value="C807 Xpress">C807 Xpress</option>
                <option value="Retiro en Oficina">Retiro en Oficina</option>
              </select>
            </div>

            <div>
              <label className={labelCls} htmlFor="departamento">
                Zona / Departamento
              </label>
              <select
                id="departamento"
                value={form.departamento}
                onChange={set("departamento")}
                className={inputCls}
              >
                <option value="San Salvador">San Salvador</option>
                <option value="La Libertad">La Libertad</option>
                <option value="Santa Ana">Santa Ana</option>
                <option value="San Miguel">San Miguel</option>
                <option value="Sonsonate">Sonsonate</option>
                <option value="Ahuachapán">Ahuachapán</option>
                <option value="Usulután">Usulután</option>
                <option value="La Paz">La Paz</option>
                <option value="Chalatenango">Chalatenango</option>
                <option value="Cuscatlán">Cuscatlán</option>
                <option value="Cabañas">Cabañas</option>
                <option value="San Vicente">San Vicente</option>
                <option value="Morazán">Morazán</option>
                <option value="La Unión">La Unión</option>
              </select>
            </div>

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
                  {pedido ? "Guardar Cambios" : "Crear Pedido"}
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
