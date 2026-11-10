import { useEffect, useState, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { 
  CheckCircle2, 
  Loader2, 
  ArrowLeft, 
  MapPin, 
  User, 
  Phone, 
  MessageCircle,
  Package,
  AlertTriangle,
  Navigation,
  Compass,
  Camera,
  Edit3,
  DollarSign,
  Calculator,
  Truck,
  RotateCcw,
  Clock,
  ChevronRight,
  X,
  Check,
  Send,
  FileText,
  ShieldAlert
} from "lucide-react";
import { compressImageFile } from "@/lib/inventory";
import { addOrUpdateBlacklist, evaluateCustomerRisk } from "@/lib/blacklist";

export function ConfirmarEntregaPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  // Estados de carga
  const [cargando, setCargando] = useState(true);
  const [pedido, setPedido] = useState<any>(null);
  const [todosLosPedidos, setTodosLosPedidos] = useState<any[]>([]);
  const [actualizando, setActualizando] = useState(false);
  const [exito, setExito] = useState(false);

  // Vista de Hoja de Ruta vs Entrega Individual
  const [modoRuta, setModoRuta] = useState(!id);
  const [courierSeleccionado, setCourierSeleccionado] = useState("Todos los Couriers");

  // Calculadora de Vuelto
  const [pagaCon, setPagaCon] = useState<string>("");
  const [mostrarCalculadora, setMostrarCalculadora] = useState(false);

  // Novedades y Lista Negra
  const [mostrarNovedadModal, setMostrarNovedadModal] = useState(false);
  const [tipoNovedad, setTipoNovedad] = useState("Cliente no contestó llamadas/mensajes");
  const [notaNovedad, setNotaNovedad] = useState("");
  const [boletinarEnListaNegra, setBoletinarEnListaNegra] = useState(true);
  const [enviandoNovedad, setEnviandoNovedad] = useState(false);

  // Prueba de Entrega (Foto y Firma)
  const [fotoEntrega, setFotoEntrega] = useState<string | null>(null);
  const [mostrarFirma, setMostrarFirma] = useState(false);
  const [hayFirma, setHayFirma] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  // Cargar pedidos y pedido activo
  const cargarDatos = async () => {
    setCargando(true);

    // Cargar todos los pedidos activos para la ruta
    const { data: todos } = await supabase
      .from("whatsapp_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (todos) {
      setTodosLosPedidos(todos);
    }

    if (id) {
      const p = todos?.find(item => item.id === id);
      if (p) {
        setPedido(p);
      } else {
        const { data: individual } = await supabase
          .from("whatsapp_orders")
          .select("*")
          .eq("id", id)
          .single();
        setPedido(individual);
      }
      setModoRuta(false);
    } else {
      setModoRuta(true);
    }

    setCargando(false);
  };

  useEffect(() => {
    cargarDatos();
  }, [id]);

  // Manejo de canvas de firma táctil
  useEffect(() => {
    if (mostrarFirma && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
      }
    }
  }, [mostrarFirma]);

  const startDrawing = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    ctx?.beginPath();
    ctx?.moveTo(clientX - rect.left, clientY - rect.top);
  };

  const draw = (e: any) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    ctx?.lineTo(clientX - rect.left, clientY - rect.top);
    ctx?.stroke();
    setHayFirma(true);
  };

  const stopDrawing = () => {
    isDrawing.current = false;
  };

  const limpiarFirma = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
    setHayFirma(false);
  };

  // Manejo de captura de foto con cámara
  const handleFotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 800, 800, 0.75);
      setFotoEntrega(compressed);
    } catch (err) {
      console.error("Error al capturar foto:", err);
    }
  };

  // Acción: Confirmar Entrega
  const handleEntregar = async () => {
    if (!pedido?.id) return;
    setActualizando(true);

    try {
      await supabase
        .from("whatsapp_orders")
        .update({
          estado: "entregado",
          notas: pedido.notas ? `${pedido.notas} • [Entregado en ruta con app móvil]` : "[Entregado en ruta con app móvil]"
        })
        .eq("id", pedido.id);

      // Emitir evento al OS Event Store
      try {
        const { emitOsEvent } = await import('@/lib/osEvents');
        emitOsEvent({
          type: 'order.delivered',
          source_table: 'whatsapp_orders',
          source_id: pedido.id,
          payload: {
            order_id: pedido.id,
            total: pedido.total,
            cliente: pedido.nombre_cliente,
            repartidor: pedido.courier || 'Motorista Móvil',
            foto_entrega: fotoEntrega ? 'capturada' : 'sin_foto',
            con_firma: hayFirma
          }
        });
      } catch {}

      setExito(true);
    } catch (err) {
      console.error("Error confirmando entrega:", err);
    } finally {
      setActualizando(false);
    }
  };

  // Acción: Reportar Novedad
  const handleReportarNovedad = async () => {
    if (!pedido?.id) return;
    setEnviandoNovedad(true);

    try {
      const notaFinal = `[NOVEDAD REPARTIDOR]: ${tipoNovedad}. ${notaNovedad}`.trim();

      await supabase
        .from("whatsapp_orders")
        .update({
          motivo_cancelacion: tipoNovedad,
          notas: pedido.notas ? `${pedido.notas} • ${notaFinal}` : notaFinal
        })
        .eq("id", pedido.id);

      // Boletinar cliente en la Lista Negra / DICOM interno si el motorista lo marcó
      if (boletinarEnListaNegra && pedido.telefono) {
        const prod = pedido.producto || (pedido.items && pedido.items.length > 0 ? pedido.items.map((i: any) => `${i.cantidad || 1}x ${i.nombre}`).join(', ') : pedido.sku) || '';
        const dir = [pedido.direccion, pedido.municipio, pedido.departamento].filter(Boolean).join(', ') || '';

        addOrUpdateBlacklist({
          telefono: pedido.telefono,
          nombreCliente: pedido.nombre_cliente || 'Cliente en Ruta',
          aliasNombres: pedido.nombre_cliente ? [pedido.nombre_cliente] : [],
          motivo: `[Reporte Motorista ${pedido.courier || 'Móvil'}]: ${tipoNovedad}. ${notaNovedad}`.trim(),
          severidad: 'alta',
          reportadoPor: pedido.courier || 'Motorista en Ruta',
          fecha: new Date().toISOString(),
          pedidoId: pedido.id,
          producto: prod,
          direccion: dir
        });
      }

      // Emitir evento de alerta
      try {
        const { emitOsEvent } = await import('@/lib/osEvents');
        emitOsEvent({
          type: 'order.delivery_issue',
          source_table: 'whatsapp_orders',
          source_id: pedido.id,
          payload: {
            order_id: pedido.id,
            cliente: pedido.nombre_cliente,
            tipo_novedad: tipoNovedad,
            notas: notaNovedad,
            boletinado: boletinarEnListaNegra
          }
        });
      } catch {}

      setMostrarNovedadModal(false);
      const msgExtra = boletinarEnListaNegra ? " y el cliente ha sido boletinado en la Lista Negra interna" : "";
      alert(`Novedad registrada${msgExtra}. La oficina y el Bot Todd han sido notificados.`);
      navigate("/repartidor");
      await cargarDatos();
    } catch (err) {
      console.error("Error registrando novedad:", err);
    } finally {
      setEnviandoNovedad(false);
    }
  };

  // Cálculo de cambio / vuelto
  const totalNum = Number(pedido?.total || 0);
  const pagaConNum = parseFloat(pagaCon || "0");
  const cambio = pagaConNum >= totalNum ? pagaConNum - totalNum : 0;

  // KPIs de la Ruta
  const pedidosRuta = useMemo(() => {
    let list = todosLosPedidos;
    if (courierSeleccionado !== "Todos los Couriers") {
      list = list.filter(p => (p.courier || "Motorista Central 1") === courierSeleccionado);
    }
    return list;
  }, [todosLosPedidos, courierSeleccionado]);

  const kpisRuta = useMemo(() => {
    let entregados = 0;
    let pendientes = 0;
    let efectivoRecaudado = 0;

    pedidosRuta.forEach(p => {
      if (p.estado === "entregado") {
        entregados++;
        efectivoRecaudado += Number(p.total || 0);
      } else if (p.estado === "en_camino" || p.estado === "nuevo" || p.estado === "por_empacar") {
        pendientes++;
      }
    });

    return { total: pedidosRuta.length, entregados, pendientes, efectivoRecaudado };
  }, [pedidosRuta]);

  const telefonoLimpio = (pedido?.telefono ?? "").replace(/\D/g, "");
  const direccionCodificada = encodeURIComponent(`${pedido?.direccion || ""}, El Salvador`);
  const urlWaze = `https://waze.com/ul?q=${direccionCodificada}`;
  const urlMaps = `https://www.google.com/maps/search/?api=1&query=${direccionCodificada}`;
  const mensajeWa = `Hola ${pedido?.nombre_cliente || ""}, soy el repartidor de To2en1.app. Estoy llegando a tu dirección con tu pedido de *${pedido?.sku || "tu producto"}*. ¿Te encuentras disponible para recibir? 🛵`;
  const urlWa = telefonoLimpio ? `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(mensajeWa)}` : undefined;

  if (cargando) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin mb-4 text-emerald-500" />
        <p className="font-bold text-sm tracking-wide">Cargando panel de repartidor...</p>
      </div>
    );
  }

  /* ========================================================================= */
  /* VISTA 1: MI HOJA DE RUTA DE HOY                                           */
  /* ========================================================================= */
  if (modoRuta) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col p-4 sm:p-6 max-w-lg mx-auto">
        {/* Cabecera */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="text-emerald-400" size={20} />
              <h1 className="text-lg font-black tracking-tight uppercase">Mi Ruta de Hoy</h1>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Gestión de entregas y recaudación en El Salvador</p>
          </div>

          <button
            onClick={() => cargarDatos()}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300"
            title="Recargar ruta"
          >
            <RotateCcw size={15} />
          </button>
        </div>

        {/* Selector de Courier */}
        <div className="mt-4">
          <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">Filtrar por Motorista:</label>
          <select
            value={courierSeleccionado}
            onChange={e => setCourierSeleccionado(e.target.value)}
            className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-900 text-xs font-bold outline-none text-white focus:border-emerald-500"
          >
            <option value="Todos los Couriers">Todos los Motoristas ({todosLosPedidos.length})</option>
            <option value="Motorista Central 1">Motorista Central 1</option>
            <option value="Motorista Central 2">Motorista Central 2</option>
            <option value="Cargo Expreso El Salvador">Cargo Expreso</option>
            <option value="Urbano Express">Urbano Express</option>
            <option value="C807 Xpress">C807 Xpress</option>
          </select>
        </div>

        {/* Tarjetas de Resumen en Calle */}
        <div className="grid grid-cols-3 gap-2.5 mt-4">
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">Pendientes</span>
            <span className="text-xl font-black text-amber-400 mt-0.5 block">{kpisRuta.pendientes}</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">Entregados</span>
            <span className="text-xl font-black text-emerald-400 mt-0.5 block">{kpisRuta.entregados}</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">En Mano ($)</span>
            <span className="text-base font-black text-emerald-400 font-mono mt-1 block">
              ${kpisRuta.efectivoRecaudado.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Lista de Paquetes en Ruta */}
        <div className="mt-5 space-y-3 flex-1 pb-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Paquetes de la Ruta ({pedidosRuta.length})
            </h2>
            <button
              onClick={() => navigate("/pedidos")}
              className="text-[11px] text-emerald-400 font-bold hover:underline"
            >
              Ir a Pedidos OS →
            </button>
          </div>

          {pedidosRuta.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-900/60 rounded-2xl border border-slate-800">
              No hay paquetes asignados para este motorista hoy.
            </div>
          ) : (
            pedidosRuta.map(p => {
              const entregado = p.estado === "entregado";

              return (
                <div
                  key={p.id}
                  onClick={() => {
                    setPedido(p);
                    setModoRuta(false);
                    setExito(false);
                  }}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    entregado 
                      ? 'bg-slate-900/40 border-slate-800 opacity-60' 
                      : 'bg-slate-900 border-slate-800 hover:border-emerald-500/50 shadow-lg'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[10px] font-mono font-bold text-slate-400">#{p.id.slice(0, 8).toUpperCase()}</span>
                      <h3 className="font-bold text-sm text-white leading-tight mt-0.5">{p.nombre_cliente || "Sin nombre"}</h3>
                    </div>

                    <span className="text-base font-black font-mono text-emerald-400">
                      ${Number(p.total || 0).toFixed(2)}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300 mt-2 flex items-start gap-1.5 leading-snug">
                    <MapPin size={13} className="text-slate-400 shrink-0 mt-0.5" />
                    <span>{p.direccion || "Sin dirección"}</span>
                  </p>

                  <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                      <Package size={12} /> {p.sku || "Producto"}
                    </span>

                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      entregado 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}>
                      {entregado ? "✓ Entregado" : "Pendiente"}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  /* ========================================================================= */
  /* VISTA 2: ENTREGA INDIVIDUAL DEL PEDIDO (Vía QR o selección de ruta)       */
  /* ========================================================================= */
  if (!pedido) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-rose-500 p-6 text-center max-w-md mx-auto">
        <AlertTriangle className="w-14 h-14 mb-3" />
        <h1 className="text-xl font-black">Pedido no encontrado</h1>
        <p className="text-xs mt-1 text-slate-400">El código escaneado puede ser inválido o el pedido ya fue retirado.</p>
        <button onClick={() => setModoRuta(true)} className="mt-5 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-xs font-bold">
          Ver Mi Ruta del Día
        </button>
      </div>
    );
  }

  const esContraEntrega = (pedido.metodo_pago ?? "").toLowerCase().includes("contra");
  const yaEntregado = pedido.estado === "entregado";

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-start p-4 sm:p-6 pb-20">
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        capture="environment"
        onChange={handleFotoCapture}
        className="hidden"
      />

      {/* Contenedor Móvil */}
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Cabecera Móvil */}
        <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <button
            onClick={() => setModoRuta(true)}
            className="p-1.5 rounded-xl hover:bg-slate-900 text-slate-400 flex items-center gap-1 text-xs font-bold"
          >
            <ArrowLeft size={16} /> Volver a Ruta
          </button>

          <span className="font-mono font-bold text-xs text-slate-400">#{pedido.id.slice(0, 8).toUpperCase()}</span>
        </div>

        {/* PANTALLA DE ÉXITO */}
        {exito || yaEntregado ? (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-20 h-20 bg-emerald-500/10 border border-emerald-500/30 rounded-full flex items-center justify-center mb-5">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-black text-white">
              {exito ? "¡Entrega Confirmada!" : "Pedido Ya Entregado"}
            </h2>
            <p className="text-xs text-slate-400 mt-2 mb-6 max-w-xs">
              {exito 
                ? "El paquete se marcó como entregado y el cobro ha sido registrado en el sistema." 
                : "Este pedido ya fue completado previamente."}
            </p>

            {fotoEntrega && (
              <div className="w-24 h-24 rounded-xl border border-slate-800 overflow-hidden mb-6">
                <img src={fotoEntrega} alt="Foto de entrega" className="w-full h-full object-cover" />
              </div>
            )}

            <button 
              onClick={() => setModoRuta(true)} 
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-2xl transition-colors text-xs uppercase tracking-wider"
            >
              Ir al Siguiente Paquete →
            </button>
          </div>
        ) : (
          /* FORMULARIO DE ACCIÓN EN CALLE */
          <div className="p-5 space-y-4">
            {/* Recuadro de Cobro Destacado */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center">
              <span className={`text-[10px] font-bold uppercase tracking-widest ${esContraEntrega ? 'text-amber-400' : 'text-emerald-400'}`}>
                {esContraEntrega ? "💰 Cobrar al Entregar en Efectivo" : "✓ Pedido Ya Pagado"}
              </span>
              <div className="text-3xl font-black font-mono mt-1 text-white">
                ${Number(pedido.total || 0).toFixed(2)} <span className="text-xs font-normal text-slate-500">USD</span>
              </div>

              {/* Botón de Calculadora de Cambio */}
              {esContraEntrega && (
                <button
                  type="button"
                  onClick={() => setMostrarCalculadora(!mostrarCalculadora)}
                  className="mt-2 text-xs font-bold text-emerald-400 hover:underline flex items-center justify-center gap-1 mx-auto"
                >
                  <Calculator size={13} /> {mostrarCalculadora ? "Ocultar Calculadora" : "Calcular Cambio / Vuelto"}
                </button>
              )}
            </div>

            {/* Calculadora de Vuelto Desplegable */}
            {mostrarCalculadora && esContraEntrega && (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-2 animate-in slide-in-from-top duration-150">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">¿Con cuánto paga el cliente?</span>
                <div className="grid grid-cols-4 gap-1.5">
                  {[20, 25, 30, 50].map(monto => (
                    <button
                      key={monto}
                      type="button"
                      onClick={() => setPagaCon(String(monto))}
                      className={`py-1.5 rounded-lg text-xs font-mono font-bold border ${
                        pagaCon === String(monto) 
                          ? 'bg-emerald-600 border-emerald-500 text-white' 
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      ${monto}
                    </button>
                  ))}
                </div>

                <div className="flex gap-2 pt-1">
                  <input
                    type="number"
                    step="0.50"
                    placeholder="Otro valor (ej. 100)"
                    value={pagaCon}
                    onChange={e => setPagaCon(e.target.value)}
                    className="flex-1 p-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold outline-none text-white focus:border-emerald-500"
                  />
                </div>

                {pagaConNum > 0 && (
                  <div className="p-2.5 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-center">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 block">Dar de Cambio / Vuelto:</span>
                    <span className="text-2xl font-black font-mono text-emerald-400">
                      ${cambio.toFixed(2)} USD
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Datos del Cliente y Dirección */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-slate-900 text-slate-400 mt-0.5">
                  <User size={16} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Cliente</span>
                  <p className="text-sm font-bold text-white truncate">{pedido.nombre_cliente || "Sin nombre"}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-slate-900 text-slate-400 mt-0.5">
                  <MapPin size={16} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Dirección de Entrega</span>
                  <p className="text-xs text-slate-200 leading-snug">{pedido.direccion || "Sin dirección registrada"}</p>
                  {pedido.departamento && (
                    <span className="text-[10px] text-emerald-400 font-semibold block mt-0.5">📍 {pedido.departamento}</span>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-slate-900 text-slate-400 mt-0.5">
                  <Package size={16} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Producto / SKU</span>
                  <p className="text-xs font-mono font-bold text-white truncate">{pedido.sku || "Sin SKU"}</p>
                </div>
              </div>

              {pedido.notas && (
                <div className="p-2 bg-slate-900 rounded-xl border border-slate-800 text-xs text-slate-300">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Nota del pedido:</span>
                  <p className="text-[11px] mt-0.5 italic">{pedido.notas}</p>
                </div>
              )}
            </div>

            {/* BOTONES DE NAVEGACIÓN GPS (WAZE & GOOGLE MAPS) */}
            <div className="grid grid-cols-2 gap-2">
              <a
                href={urlWaze}
                target="_blank"
                rel="noreferrer"
                className="py-3 px-3 rounded-2xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow transition-colors"
              >
                <Compass size={16} /> Abrir en Waze
              </a>

              <a
                href={urlMaps}
                target="_blank"
                rel="noreferrer"
                className="py-3 px-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow transition-colors"
              >
                <Navigation size={16} /> Google Maps
              </a>
            </div>

            {/* BOTONES DE COMUNICACIÓN (LLAMADA Y WHATSAPP) */}
            <div className="grid grid-cols-2 gap-2">
              {telefonoLimpio ? (
                <a
                  href={`tel:${telefonoLimpio}`}
                  className="py-3 px-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center gap-2 border border-slate-700 transition-colors"
                >
                  <Phone size={16} className="text-emerald-400" /> Llamar Cliente
                </a>
              ) : (
                <div className="py-3 px-3 rounded-2xl bg-slate-800/50 text-slate-500 font-bold text-xs text-center border border-slate-800">
                  Sin Teléfono
                </div>
              )}

              {urlWa ? (
                <a
                  href={urlWa}
                  target="_blank"
                  rel="noreferrer"
                  className="py-3 px-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow transition-colors"
                >
                  <MessageCircle size={16} /> WhatsApp
                </a>
              ) : (
                <div className="py-3 px-3 rounded-2xl bg-slate-800/50 text-slate-500 font-bold text-xs text-center border border-slate-800">
                  Sin WhatsApp
                </div>
              )}
            </div>

            {/* PRUEBA DE ENTREGA: FOTO Y FIRMA */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Prueba de Entrega (Opcional):</span>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-bold text-slate-200 flex items-center justify-center gap-1.5"
                >
                  <Camera size={14} className="text-emerald-400" /> {fotoEntrega ? "Foto Tomada ✓" : "Tomar Foto"}
                </button>

                <button
                  type="button"
                  onClick={() => setMostrarFirma(!mostrarFirma)}
                  className="flex-1 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-bold text-slate-200 flex items-center justify-center gap-1.5"
                >
                  <Edit3 size={14} className="text-indigo-400" /> {hayFirma ? "Firma Lista ✓" : "Firma en Pantalla"}
                </button>
              </div>

              {fotoEntrega && (
                <div className="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-800">
                  <img src={fotoEntrega} alt="Preview" className="w-full h-full object-cover" />
                  <button
                    onClick={() => setFotoEntrega(null)}
                    className="absolute top-1 right-1 p-1 bg-black/70 rounded-full text-white"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}

              {mostrarFirma && (
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                    <span>El cliente firma aquí con el dedo:</span>
                    <button onClick={limpiarFirma} className="text-rose-400 hover:underline">Borrar trazo</button>
                  </div>
                  <canvas
                    ref={canvasRef}
                    width={340}
                    height={130}
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                    onTouchStart={startDrawing}
                    onTouchMove={draw}
                    onTouchEnd={stopDrawing}
                    className="w-full bg-white rounded-xl touch-none border border-slate-700 cursor-crosshair"
                  />
                </div>
              )}
            </div>

            {/* BOTÓN PRINCIPAL: CONFIRMAR ENTREGA Y COBRO */}
            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={handleEntregar}
                disabled={actualizando}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-black py-4 rounded-2xl shadow-xl shadow-emerald-600/30 transition-all text-sm uppercase tracking-wider"
              >
                {actualizando ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    Confirmar Entrega y Cobro
                  </>
                )}
              </button>

              {/* BOTÓN DE NOVEDAD / NO ENTREGADO */}
              <button
                type="button"
                onClick={() => setMostrarNovedadModal(true)}
                className="w-full py-2.5 rounded-xl border border-rose-500/30 hover:bg-rose-500/10 text-rose-400 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <AlertTriangle size={14} /> Reportar Novedad / Reintento de Entrega
              </button>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: REPORTAR NOVEDAD EN RUTA */}
      {mostrarNovedadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setMostrarNovedadModal(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 text-white shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle size={18} />
                <h3 className="font-bold text-sm">Reportar Novedad en Ruta</h3>
              </div>
              <button onClick={() => setMostrarNovedadModal(false)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5">
                  ¿Por qué no se pudo entregar?
                </label>
                <select
                  value={tipoNovedad}
                  onChange={e => setTipoNovedad(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs font-semibold outline-none text-white focus:border-rose-500"
                >
                  <option value="Cliente no contestó llamadas/mensajes">Cliente no contestó llamadas/mensajes</option>
                  <option value="Cliente pide reprogramar entrega">Cliente pide reprogramar entrega</option>
                  <option value="Cliente sin efectivo completo">Cliente sin efectivo completo</option>
                  <option value="Dirección incorrecta o inaccesible">Dirección incorrecta o inaccesible</option>
                  <option value="Cliente canceló / rechaza producto">Cliente canceló / rechaza producto</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5">
                  Nota del repartidor (Opcional):
                </label>
                <textarea
                  rows={2}
                  value={notaNovedad}
                  onChange={e => setNotaNovedad(e.target.value)}
                  placeholder="Ej. Estuve 15 minutos en el portón pero no salió nadie..."
                  className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs outline-none text-white focus:border-rose-500 resize-none"
                />
              </div>

              {/* Checkbox para boletinar en la Lista Negra / DICOM */}
              <div 
                onClick={() => setBoletinarEnListaNegra(!boletinarEnListaNegra)}
                className={`p-3 rounded-2xl border cursor-pointer transition-all flex items-start gap-2.5 select-none ${
                  boletinarEnListaNegra 
                    ? 'border-rose-500/50 bg-rose-500/10 text-rose-300' 
                    : 'border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <input
                  type="checkbox"
                  checked={boletinarEnListaNegra}
                  onChange={e => setBoletinarEnListaNegra(e.target.checked)}
                  className="mt-0.5 rounded text-rose-600 focus:ring-0 accent-rose-600 cursor-pointer"
                />
                <div>
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <ShieldAlert size={14} className="text-rose-500" /> Boletinar en Lista Negra (DICOM Interno)
                  </span>
                  <span className="text-[10px] text-slate-400 block mt-0.5 leading-snug">
                    Alerta a la oficina para bloquear futuros pedidos o exigir flete anticipado a este número de WhatsApp.
                  </span>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setMostrarNovedadModal(false)}
                  className="px-4 py-2 border border-slate-800 rounded-xl text-xs font-semibold text-slate-400"
                >
                  Volver
                </button>
                <button
                  type="button"
                  disabled={enviandoNovedad}
                  onClick={handleReportarNovedad}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5"
                >
                  {enviandoNovedad ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                  {enviandoNovedad ? "Enviando..." : "Enviar Reporte"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
