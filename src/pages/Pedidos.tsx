import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Printer,
  MessageCircle,
  Eye,
  EyeOff,
  ChevronLeft,
  ChevronRight,
  X,
  MapPin,
  Phone,
  StickyNote,
  Package,
  Loader2,
  RefreshCw,
  AlertCircle,
  Hash,
  CreditCard,
  User,
  Edit,
  TrendingUp,
  Clock,
  BarChart3,
  Trash2,
  Truck,
  FileSpreadsheet,
  CheckCircle2,
  LayoutGrid,
  Table as TableIcon,
  Download,
  CheckSquare,
  Square,
  DollarSign,
  AlertTriangle,
  RotateCcw,
  Bot,
  Layers,
  Send,
  ExternalLink
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import PedidoModal from "@/components/PedidoModal";
import GuiaEnvio, { type GuiaPedido } from "@/components/GuiaEnvio";
import ManifiestoDespacho from "@/components/ManifiestoDespacho";
import { addManualTransaction } from "@/lib/finance";

/* ------------------------------------------------------------------ */
/* Tipos y constantes                                                  */
/* ------------------------------------------------------------------ */

export interface Pedido {
  id: string;
  nombre_cliente: string | null;
  total: number | null;
  estado: string | null;
  created_at: string | null;
  sku: string | null;
  telefono: string | null;
  direccion: string | null;
  metodo_pago: string | null;
  codigo_anuncio: string | null;
  notas: string | null;
  courier?: string | null;
  departamento?: string | null;
  motivo_cancelacion?: string | null;
  liquidado?: boolean | null;
  origen?: string | null;
}

const ESTADOS = ["nuevo", "por_empacar", "en_camino", "entregado", "cancelado"] as const;
type Estado = (typeof ESTADOS)[number];

const COLUMNAS: { key: Estado; titulo: string; emoji: string; accent: string }[] = [
  { key: "nuevo", titulo: "Nuevos", emoji: "📥", accent: "border-t-sky-500" },
  { key: "por_empacar", titulo: "Por Empacar", emoji: "📦", accent: "border-t-amber-500" },
  { key: "en_camino", titulo: "En Camino", emoji: "🛵", accent: "border-t-violet-500" },
  { key: "entregado", titulo: "Entregados", emoji: "✅", accent: "border-t-emerald-500" },
  { key: "cancelado", titulo: "Cancelados", emoji: "❌", accent: "border-t-rose-500" },
];

const ETIQUETA_ESTADO: Record<Estado, string> = {
  nuevo: "Nuevo",
  por_empacar: "Por empacar",
  en_camino: "En camino",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

const COURIERS = [
  "Todos los Couriers",
  "Motorista Central 1",
  "Motorista Central 2",
  "Cargo Expreso El Salvador",
  "Urbano Express",
  "C807 Xpress",
  "Retiro en Oficina"
];

const DEPARTAMENTOS = [
  "Todas las Zonas",
  "San Salvador",
  "La Libertad",
  "Santa Ana",
  "San Miguel",
  "Sonsonate",
  "Ahuachapán",
  "Usulután",
  "La Paz",
  "Chalatenango",
  "Cuscatlán",
  "Cabañas",
  "San Vicente",
  "Morazán",
  "La Unión"
];

const normalizarEstado = (e: string | null | undefined): Estado =>
  ESTADOS.includes((e ?? "") as Estado) ? ((e as Estado) ?? "nuevo") : "nuevo";

const dinero = (n: number | null | undefined) => `$${Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const fechaCorta = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-SV", { day: "2-digit", month: "short" });
};

/* ------------------------------------------------------------------ */
/* Página principal                                                    */
/* ------------------------------------------------------------------ */

export function PedidosPage() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [mostrarHistorial, setMostrarHistorial] = useState(false);

  // Vistas y Filtros Pro
  const [vista, setVista] = useState<'kanban' | 'tabla'>('kanban');
  const [filtroCourier, setFiltroCourier] = useState("Todos los Couriers");
  const [filtroDepto, setFiltroDepto] = useState("Todas las Zonas");

  // Selección múltiple para acciones en lote
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set());

  // Modales
  const [modalNuevo, setModalNuevo] = useState(false);
  const [pedidoAEditar, setPedidoAEditar] = useState<Pedido | null>(null);
  const [pedidosGuia, setPedidosGuia] = useState<GuiaPedido[] | null>(null);
  const [pedidoDetalle, setPedidoDetalle] = useState<Pedido | null>(null);
  const [moviendoId, setMoviendoId] = useState<string | null>(null);
  const [mostrarManifiesto, setMostrarManifiesto] = useState(false);
  const [manifiestoPedidos, setManifiestoPedidos] = useState<Pedido[]>([]);

  // Modal Liquidación Finanzas
  const [pedidoALiquidar, setPedidoALiquidar] = useState<Pedido | null>(null);
  const [cuentaLiquidacion, setCuentaLiquidacion] = useState("caja_efectivo");
  const [liquidando, setLiquidando] = useState(false);

  // Modal Cancelación y Logística Inversa
  const [pedidoACancelar, setPedidoACancelar] = useState<Pedido | null>(null);
  const [motivoCancelacion, setMotivoCancelacion] = useState("Cliente no contestó llamadas");
  const [reingresarKardex, setReingresarKardex] = useState(true);
  const [cancelando, setCancelando] = useState(false);

  // Modal WhatsApp con Plantillas
  const [pedidoWhatsapp, setPedidoWhatsapp] = useState<Pedido | null>(null);

  /* --------------------------- Carga de datos --------------------------- */
  const cargarPedidos = useCallback(async (silencioso = false) => {
    if (silencioso) setRefrescando(true);
    else setCargando(true);
    setError(null);

    const { data, error } = await supabase
      .from("whatsapp_orders")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      setError(error.message);
    } else {
      setPedidos((data ?? []) as Pedido[]);
    }

    if (silencioso) setRefrescando(false);
    else setCargando(false);
  }, []);

  useEffect(() => {
    cargarPedidos();
  }, [cargarPedidos]);

  /* --------------------------- Detección de duplicados --------------------------- */
  const telefonosDuplicados = useMemo(() => {
    const mapa = new Map<string, number>();
    pedidos.forEach(p => {
      if (p.estado !== 'cancelado') {
        const tel = (p.telefono || '').replace(/\D/g, '');
        if (tel.length >= 7) {
          mapa.set(tel, (mapa.get(tel) || 0) + 1);
        }
      }
    });

    const duplicados = new Set<string>();
    mapa.forEach((count, tel) => {
      if (count > 1) duplicados.add(tel);
    });
    return duplicados;
  }, [pedidos]);

  /* --------------------------- KPIs --------------------------- */
  const kpis = useMemo(() => {
    let ventasHoy = 0;
    let porDespachar = 0;
    let totalHistorico = 0;
    let pendientesLiquidacion = 0;
    
    const hoy = new Date();
    const hoyStr = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

    pedidos.forEach((p) => {
      const total = Number(p.total) || 0;
      const esCancelado = p.estado === "cancelado";

      if (!esCancelado) {
        totalHistorico += total;
        if (p.created_at && p.created_at.startsWith(hoyStr)) {
          ventasHoy += total;
        }
      }

      if (p.estado === "nuevo" || p.estado === "por_empacar") {
        porDespachar++;
      }

      if ((p.estado === "en_camino" || p.estado === "entregado") && !p.liquidado) {
        pendientesLiquidacion += total;
      }
    });

    return {
      ventasHoy,
      porDespachar,
      ticketPromedio: pedidos.length > 0 ? totalHistorico / pedidos.length : 0,
      pendientesLiquidacion
    };
  }, [pedidos]);

  /* --------------------------- Filtro y Agrupación --------------------------- */
  const pedidosFiltrados = useMemo(() => {
    let list = pedidos;

    // Filtro texto
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      list = list.filter(p =>
        (p.nombre_cliente ?? "").toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.telefono ?? "").toLowerCase().includes(q) ||
        (p.codigo_anuncio ?? "").toLowerCase().includes(q) ||
        (p.direccion ?? "").toLowerCase().includes(q)
      );
    }

    // Filtro courier
    if (filtroCourier !== "Todos los Couriers") {
      list = list.filter(p => (p.courier || "Motorista Central 1") === filtroCourier);
    }

    // Filtro departamento
    if (filtroDepto !== "Todas las Zonas") {
      list = list.filter(p => (p.departamento || "San Salvador") === filtroDepto);
    }

    return list;
  }, [pedidos, busqueda, filtroCourier, filtroDepto]);

  const porEstado = useMemo(() => {
    const map: Record<Estado, Pedido[]> = {
      nuevo: [],
      por_empacar: [],
      en_camino: [],
      entregado: [],
      cancelado: [],
    };
    for (const p of pedidosFiltrados) map[normalizarEstado(p.estado)].push(p);
    return map;
  }, [pedidosFiltrados]);

  const totalFiltrados = pedidosFiltrados.length;
  const columnasVisibles = mostrarHistorial
    ? COLUMNAS
    : COLUMNAS.filter((c) => c.key !== "entregado" && c.key !== "cancelado");

  /* --------------------------- Mover entre columnas --------------------------- */
  const moverPedido = async (pedido: Pedido, dir: -1 | 1) => {
    const actual = ESTADOS.indexOf(normalizarEstado(pedido.estado));
    const destino = ESTADOS[actual + dir];
    if (!destino) return;

    // Si el destino es cancelado, abrir modal de motivo y devolución
    if (destino === 'cancelado') {
      setPedidoACancelar(pedido);
      return;
    }

    setMoviendoId(pedido.id);
    const previos = pedidos;

    setPedidos((prev) =>
      prev.map((p) => (p.id === pedido.id ? { ...p, estado: destino } : p))
    );

    const { error } = await supabase
      .from("whatsapp_orders")
      .update({ estado: destino })
      .eq("id", pedido.id);

    if (error) {
      setPedidos(previos);
      setError(`No se pudo mover el pedido: ${error.message}`);
    } else {
      // Emitir evento al OS Event Store
      try {
        const { emitOsEvent } = await import('@/lib/osEvents');
        const eventMap: Record<string, string> = {
          nuevo: 'order.created',
          por_empacar: 'order.confirmed',
          en_camino: 'order.shipped',
          entregado: 'order.delivered',
          cancelado: 'order.cancelled'
        };
        const eventType = eventMap[destino] || 'order.confirmed';

        emitOsEvent({
          type: eventType,
          source_table: 'whatsapp_orders',
          source_id: pedido.id,
          payload: {
            order_id: pedido.id,
            nombre_cliente: pedido.nombre_cliente,
            telefono: pedido.telefono,
            sku: pedido.sku,
            total: pedido.total,
            estado_anterior: pedido.estado,
            estado: destino,
            codigo_anuncio: pedido.codigo_anuncio
          }
        });
      } catch {
        // Ignorar error en emisión secundaria
      }

      await cargarPedidos(true);
    }
    setMoviendoId(null);
  };

  /* --------------------------- Confirmar Cancelación y Devolución --------------------------- */
  const confirmarCancelacion = async () => {
    if (!pedidoACancelar) return;
    setCancelando(true);

    try {
      // 1. Actualizar estado y motivo en whatsapp_orders
      await supabase
        .from("whatsapp_orders")
        .update({ 
          estado: 'cancelado',
          motivo_cancelacion: motivoCancelacion
        })
        .eq("id", pedidoACancelar.id);

      // 2. Si reingresarKardex está activo y tiene SKU, hacer devolución al stock
      if (reingresarKardex && pedidoACancelar.sku) {
        try {
          await (supabase as any).rpc('record_movement', {
            p_sku: pedidoACancelar.sku,
            p_tipo_movimiento: 'devolucion_entrada',
            p_cantidad: 1,
            p_costo_unitario: 0,
            p_motivo: `Devolución pedido #${pedidoACancelar.id.slice(0, 8)} (${motivoCancelacion})`,
            p_source_table: 'whatsapp_orders',
            p_source_id: pedidoACancelar.id,
            p_usuario: 'Panel Logística'
          });
        } catch (err) {
          console.warn('Error reingresando a kárdex:', err);
        }
      }

      // 3. Emitir evento cancelado
      const { emitOsEvent } = await import('@/lib/osEvents');
      emitOsEvent({
        type: 'order.cancelled',
        source_table: 'whatsapp_orders',
        source_id: pedidoACancelar.id,
        payload: {
          order_id: pedidoACancelar.id,
          motivo: motivoCancelacion,
          reingresado_stock: reingresarKardex
        }
      });

      await cargarPedidos(true);
    } finally {
      setCancelando(false);
      setPedidoACancelar(null);
    }
  };

  /* --------------------------- Liquidar Pedido en Finanzas --------------------------- */
  const confirmarLiquidacion = async () => {
    if (!pedidoALiquidar) return;
    setLiquidando(true);

    try {
      const monto = Number(pedidoALiquidar.total || 0);

      // 1. Asentar ingreso en el Money Engine
      await addManualTransaction({
        account_id: cuentaLiquidacion,
        tipo: 'income',
        categoria: 'venta_contraentrega',
        monto,
        descripcion: `Liquidación contra entrega #${pedidoALiquidar.id.slice(0, 8).toUpperCase()} (${pedidoALiquidar.nombre_cliente || 'Cliente'})`,
        fecha: new Date().toISOString().slice(0, 10)
      });

      // 2. Marcar como liquidado en DB
      await supabase
        .from("whatsapp_orders")
        .update({
          liquidado: true,
          liquidado_at: new Date().toISOString(),
          cuenta_liquidacion: cuentaLiquidacion,
          estado: 'entregado'
        })
        .eq("id", pedidoALiquidar.id);

      await cargarPedidos(true);
    } catch (err) {
      console.error('Error al liquidar cobro:', err);
    } finally {
      setLiquidando(false);
      setPedidoALiquidar(null);
    }
  };

  /* --------------------------- Acciones en Lote --------------------------- */
  const toggleSeleccionar = (id: string) => {
    setSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const seleccionarTodos = () => {
    if (seleccionados.size === pedidosFiltrados.length) {
      setSeleccionados(new Set());
    } else {
      setSeleccionados(new Set(pedidosFiltrados.map(p => p.id)));
    }
  };

  const moverSeleccionados = async (nuevoEstado: Estado) => {
    if (seleccionados.size === 0) return;
    setCargando(true);

    const ids = Array.from(seleccionados);
    await supabase
      .from("whatsapp_orders")
      .update({ estado: nuevoEstado })
      .in("id", ids);

    setSeleccionados(new Set());
    await cargarPedidos(true);
  };

  const imprimirGuiasSeleccionadas = () => {
    const seleccionadosList = pedidos.filter(p => seleccionados.has(p.id));
    if (seleccionadosList.length > 0) {
      setPedidosGuia(seleccionadosList as GuiaPedido[]);
    }
  };

  const generarManifiestoSeleccionados = () => {
    const seleccionadosList = pedidos.filter(p => seleccionados.has(p.id));
    if (seleccionadosList.length > 0) {
      setManifiestoPedidos(seleccionadosList);
      setMostrarManifiesto(true);
    }
  };

  /* --------------------------- Exportar CSV --------------------------- */
  const exportarCSV = () => {
    const headers = ["ID", "Fecha", "Cliente", "Telefono", "Direccion", "Departamento", "Courier", "SKU", "Total_USD", "Estado", "Liquidado"];
    const rows = pedidosFiltrados.map(p => [
      p.id.slice(0, 8),
      p.created_at ? p.created_at.slice(0, 10) : "",
      `"${(p.nombre_cliente || "").replace(/"/g, '""')}"`,
      p.telefono || "",
      `"${(p.direccion || "").replace(/"/g, '""')}"`,
      p.departamento || "San Salvador",
      p.courier || "Motorista Central 1",
      p.sku || "",
      Number(p.total || 0).toFixed(2),
      p.estado || "nuevo",
      p.liquidado ? "SI" : "NO"
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `pedidos_todoenuno_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* --------------------------- Borrar Pedido --------------------------- */
  const borrarPedido = async (pedido: Pedido) => {
    const confirmar = window.confirm(
      `¿Estás seguro de que deseas eliminar permanentemente el pedido de ${pedido.nombre_cliente}?`
    );
    if (!confirmar) return;

    const { error } = await supabase
      .from("whatsapp_orders")
      .delete()
      .eq("id", pedido.id);

    if (error) {
      setError(`No se pudo eliminar el pedido: ${error.message}`);
    } else {
      await cargarPedidos(true);
    }
  };

  return (
    <div className="min-h-screen bg-[var(--cd)] text-[var(--tx)] p-4 md:p-6 flex flex-col relative pb-28">
      {/* Encabezado Principal */}
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-5">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-black tracking-tight">Centro de Pedidos & Logística</h1>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              COD Engine
            </span>
          </div>
          <p className="text-xs md:text-sm opacity-60 mt-0.5">
            Despachos, rutas de motoristas, guías en lote y cuadre de efectivo contra entrega en El Salvador.
          </p>
        </div>

        {/* Acciones Superiores */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de Vista: Kanban vs Tabla */}
          <div className="flex bg-sf p-1 rounded-xl border border-[var(--bd)] text-xs font-bold">
            <button
              onClick={() => setVista('kanban')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                vista === 'kanban' ? 'bg-cd shadow text-[var(--tx)]' : 'tx-mu hover:text-[var(--tx)]'
              }`}
            >
              <LayoutGrid size={14} /> Kanban
            </button>
            <button
              onClick={() => setVista('tabla')}
              className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors ${
                vista === 'tabla' ? 'bg-cd shadow text-[var(--tx)]' : 'tx-mu hover:text-[var(--tx)]'
              }`}
            >
              <TableIcon size={14} /> Tabla ({pedidosFiltrados.length})
            </button>
          </div>

          <button
            onClick={exportarCSV}
            className="px-3 py-2 border border-[var(--bd)] hover:bg-sf rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
            title="Exportar a Excel / CSV"
          >
            <Download size={14} /> Exportar CSV
          </button>

          <button
            onClick={() => cargarPedidos(true)}
            disabled={refrescando}
            className="p-2.5 rounded-xl border border-[var(--bd)] bg-cd hover:bg-sf transition-colors"
            title="Recargar"
          >
            <RefreshCw className={`w-4 h-4 ${refrescando ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={() => setMostrarHistorial(!mostrarHistorial)}
            className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors whitespace-nowrap ${
              mostrarHistorial
                ? "border-indigo-500 bg-indigo-500/10 text-indigo-500"
                : "border-[var(--bd)] bg-cd text-[var(--tx)] hover:bg-sf"
            }`}
          >
            {mostrarHistorial ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            <span>{mostrarHistorial ? "Ocultar Historial" : "Ver Historial"}</span>
          </button>

          <button
            onClick={() => setModalNuevo(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-xs font-bold text-white shadow-md transition-colors"
          >
            <Plus className="w-4 h-4" /> Nuevo Pedido
          </button>
        </div>
      </header>

      {/* Barra de Filtros Avanzados (Búsqueda + Courier + Departamento) */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 bg-cd p-3 rounded-2xl border border-[var(--bd)] mb-5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
          <input
            type="text"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por cliente, SKU, teléfono, dirección o anuncio..."
            className="w-full rounded-xl border border-[var(--bd)] bg-sf pl-9 pr-8 py-2 text-xs outline-none focus:border-indigo-500"
          />
          {busqueda && (
            <button
              onClick={() => setBusqueda("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-md hover:bg-black/10 opacity-60"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Selector Courier */}
          <select
            value={filtroCourier}
            onChange={e => setFiltroCourier(e.target.value)}
            className="p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-semibold outline-none focus:border-indigo-500"
          >
            {COURIERS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Selector Departamento */}
          <select
            value={filtroDepto}
            onChange={e => setFiltroDepto(e.target.value)}
            className="p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs font-semibold outline-none focus:border-indigo-500"
          >
            {DEPARTAMENTOS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Tarjetas KPI Operativas */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="flex items-center gap-3.5 rounded-2xl border border-[var(--bd)] bg-cd p-4 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
            <TrendingUp className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Ventas de Hoy</p>
            <p className="text-xl font-black">{dinero(kpis.ventasHoy)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-2xl border border-[var(--bd)] bg-cd p-4 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500">
            <Clock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Por Despachar</p>
            <p className="text-xl font-black">{kpis.porDespachar} <span className="text-xs font-normal opacity-60">pedidos</span></p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-2xl border border-[var(--bd)] bg-cd p-4 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-500/10 text-purple-500">
            <DollarSign className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Cobros en Calle</p>
            <p className="text-xl font-black text-purple-600 dark:text-purple-400">{dinero(kpis.pendientesLiquidacion)}</p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 rounded-2xl border border-[var(--bd)] bg-cd p-4 shadow-sm">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider opacity-60">Ticket Promedio</p>
            <p className="text-xl font-black">{dinero(kpis.ticketPromedio)}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* CONTENIDO VISTA 1: TABLERO KANBAN */}
      {cargando ? (
        <div className="flex flex-col items-center justify-center py-24 opacity-60 flex-1">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">Cargando pedidos logísticos...</p>
        </div>
      ) : vista === 'kanban' ? (
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1 flex-1 items-start">
          {columnasVisibles.map((col) => (
            <section
              key={col.key}
              className={`flex flex-col shrink-0 min-w-[300px] w-[300px] xl:w-auto xl:flex-1 rounded-2xl border border-[var(--bd)] border-t-4 ${col.accent} bg-cd shadow-sm`}
            >
              <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--bd)] bg-sf/40">
                <h2 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-[var(--tx)]">
                  <span aria-hidden>{col.emoji}</span>
                  {col.titulo}
                </h2>
                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-cd border border-[var(--bd)]">
                  {porEstado[col.key].length}
                </span>
              </header>

              <div className="p-3 space-y-3 overflow-y-auto min-h-[160px] max-h-[calc(100vh-380px)]">
                {porEstado[col.key].length === 0 ? (
                  <p className="text-center text-xs opacity-40 py-8">Sin pedidos en esta fase</p>
                ) : (
                  porEstado[col.key].map((pedido) => (
                    <PedidoCard
                      key={pedido.id}
                      pedido={pedido}
                      moviendo={moviendoId === pedido.id}
                      esDuplicado={telefonosDuplicados.has((pedido.telefono || '').replace(/\D/g, ''))}
                      seleccionado={seleccionados.has(pedido.id)}
                      onToggleSelect={() => toggleSeleccionar(pedido.id)}
                      onGuia={(p) => setPedidosGuia([p as GuiaPedido])}
                      onDetalle={setPedidoDetalle}
                      onMover={moverPedido}
                      onEditar={setPedidoAEditar}
                      onBorrar={borrarPedido}
                      onLiquidar={setPedidoALiquidar}
                      onOpenWhatsapp={setPedidoWhatsapp}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        /* CONTENIDO VISTA 2: TABLA DETALLADA */
        <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                <tr>
                  <th className="p-3 text-center w-10">
                    <input
                      type="checkbox"
                      checked={seleccionados.size > 0 && seleccionados.size === pedidosFiltrados.length}
                      onChange={seleccionarTodos}
                      className="rounded"
                    />
                  </th>
                  <th className="p-3">ID / Fecha</th>
                  <th className="p-3">Destinatario</th>
                  <th className="p-3">Zona / Courier</th>
                  <th className="p-3">SKU / Producto</th>
                  <th className="p-3 text-right">Monto</th>
                  <th className="p-3 text-center">Estado</th>
                  <th className="p-3 text-center">Liquidación</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {pedidosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center tx-mu">
                      No se encontraron pedidos con los filtros aplicados.
                    </td>
                  </tr>
                ) : (
                  pedidosFiltrados.map((p) => {
                    const isDup = telefonosDuplicados.has((p.telefono || '').replace(/\D/g, ''));
                    const isSel = seleccionados.has(p.id);

                    return (
                      <tr key={p.id} className={`hover:bg-sf/50 transition-colors ${isSel ? 'bg-indigo-500/5' : ''}`}>
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSel}
                            onChange={() => toggleSeleccionar(p.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="p-3 font-mono">
                          <span className="font-bold text-[var(--tx)]">#{p.id.slice(0, 8).toUpperCase()}</span>
                          <span className="text-[10px] tx-mu block">{fechaCorta(p.created_at)}</span>
                        </td>
                        <td className="p-3">
                          <div className="font-bold text-[var(--tx)] flex items-center gap-1.5">
                            {p.nombre_cliente || "—"}
                            {isDup && (
                              <span className="text-[9px] bg-amber-500/10 text-amber-600 px-1.5 py-0.2 rounded font-bold" title="Mismo teléfono en otro pedido">
                                ⚠️ Duplicado
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] tx-mu font-mono">{p.telefono || "—"}</span>
                          <span className="text-[10px] tx-mu block truncate max-w-xs">{p.direccion || "—"}</span>
                        </td>
                        <td className="p-3">
                          <span className="text-xs font-semibold block">{p.departamento || "San Salvador"}</span>
                          <span className="text-[10px] tx-mu flex items-center gap-1">
                            <Truck size={10} /> {p.courier || "Motorista Central 1"}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-semibold">
                          {p.sku || "—"}
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-sm text-emerald-600">
                          {dinero(p.total)}
                        </td>
                        <td className="p-3 text-center">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sf border border-[var(--bd)] uppercase">
                            {ETIQUETA_ESTADO[normalizarEstado(p.estado)]}
                          </span>
                        </td>
                        <td className="p-3 text-center">
                          {p.liquidado ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                              ✓ En Caja
                            </span>
                          ) : (
                            <button
                              onClick={() => setPedidoALiquidar(p)}
                              className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                            >
                              $ Liquidar
                            </button>
                          )}
                        </td>
                        <td className="p-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => setPedidoWhatsapp(p)}
                              className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-500/10"
                              title="Plantillas de WhatsApp"
                            >
                              <MessageCircle size={15} />
                            </button>
                            <button
                              onClick={() => setPedidosGuia([p as GuiaPedido])}
                              className="p-1.5 rounded-lg hover:bg-sf"
                              title="Imprimir Guía"
                            >
                              <Printer size={15} />
                            </button>
                            <button
                              onClick={() => setPedidoDetalle(p)}
                              className="p-1.5 rounded-lg hover:bg-sf"
                              title="Ver Detalle"
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              onClick={() => setPedidoAEditar(p)}
                              className="p-1.5 rounded-lg text-indigo-500 hover:bg-indigo-500/10"
                              title="Editar"
                            >
                              <Edit size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* BARRA FLOTANTE DE ACCIONES EN LOTE */}
      {seleccionados.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-zinc-950 text-white px-5 py-3 rounded-2xl shadow-2xl border border-zinc-800 flex items-center gap-4 animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full bg-indigo-600 text-[11px] font-bold">
              {seleccionados.size}
            </span>
            <span className="text-xs font-semibold">seleccionados</span>
          </div>

          <div className="h-4 w-px bg-zinc-800" />

          <div className="flex items-center gap-2">
            <button
              onClick={() => moverSeleccionados('por_empacar')}
              className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-bold flex items-center gap-1 transition-colors"
            >
              <Package size={13} /> Empacar
            </button>

            <button
              onClick={() => moverSeleccionados('en_camino')}
              className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-xs font-bold flex items-center gap-1 transition-colors"
            >
              <Truck size={13} /> En Camino
            </button>

            <button
              onClick={imprimirGuiasSeleccionadas}
              className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-bold flex items-center gap-1 transition-colors"
            >
              <Printer size={13} /> Guías en Lote
            </button>

            <button
              onClick={generarManifiestoSeleccionados}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold flex items-center gap-1 transition-colors"
            >
              <FileSpreadsheet size={13} /> Manifiesto Despacho
            </button>

            <button
              onClick={() => setSeleccionados(new Set())}
              className="p-1.5 text-zinc-400 hover:text-white rounded-lg"
              title="Cancelar Selección"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* MODAL 1: NUEVO O EDITAR PEDIDO */}
      {(modalNuevo || pedidoAEditar) && (
        <PedidoModal
          pedido={pedidoAEditar}
          onClose={() => {
            setModalNuevo(false);
            setPedidoAEditar(null);
          }}
          onSaved={() => cargarPedidos(true)}
        />
      )}

      {/* MODAL 2: GUÍA DE ENVÍO (INDIVIDUAL O EN LOTE) */}
      {pedidosGuia && (
        <GuiaEnvio 
          pedidos={pedidosGuia} 
          onClose={() => setPedidosGuia(null)} 
        />
      )}

      {/* MODAL 3: MANIFIESTO DE DESPACHO PARA MOTORISTA */}
      {mostrarManifiesto && (
        <ManifiestoDespacho
          pedidos={manifiestoPedidos}
          courierInicial={filtroCourier !== "Todos los Couriers" ? filtroCourier : undefined}
          onClose={() => {
            setMostrarManifiesto(false);
            setManifiestoPedidos([]);
          }}
        />
      )}

      {/* MODAL 4: DETALLE DE PEDIDO */}
      {pedidoDetalle && (
        <DetallePedido pedido={pedidoDetalle} onClose={() => setPedidoDetalle(null)} />
      )}

      {/* MODAL 5: LIQUIDACIÓN DE COBRO EN FINANZAS */}
      {pedidoALiquidar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPedidoALiquidar(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2 text-emerald-600">
                <DollarSign size={18} />
                <h3 className="font-bold text-sm">Liquidar Cobro Contra Entrega</h3>
              </div>
              <button onClick={() => setPedidoALiquidar(null)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-4">
              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)]">
                <span className="text-[10px] uppercase font-bold tx-mu block">Pedido #{pedidoALiquidar.id.slice(0, 8).toUpperCase()}</span>
                <span className="text-sm font-bold block">{pedidoALiquidar.nombre_cliente}</span>
                <span className="text-2xl font-black text-emerald-600 font-mono mt-1 block">
                  {dinero(pedidoALiquidar.total)} USD
                </span>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1.5">
                  ¿A qué cuenta de Finanzas ingresa el dinero recaudado?
                </label>
                <select
                  value={cuentaLiquidacion}
                  onChange={e => setCuentaLiquidacion(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-bold outline-none"
                >
                  <option value="caja_efectivo">Efectivo Repartidores (Contraentrega)</option>
                  <option value="banco_principal">Banco Agrícola (Cuenta Principal)</option>
                  <option value="caja_chica">Caja Chica de Oficina</option>
                </select>
                <span className="text-[10px] tx-mu block mt-1">
                  Se creará un asiento de ingreso automático en el Money Engine y el saldo de la cuenta aumentará de inmediato.
                </span>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setPedidoALiquidar(null)} 
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={liquidando}
                  onClick={confirmarLiquidacion}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
                >
                  {liquidando ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  {liquidando ? "Asentando..." : "Asentar en Finanzas"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: CANCELACIÓN Y DEVOLUCIÓN A KÁRDEX (LOGÍSTICA INVERSA) */}
      {pedidoACancelar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPedidoACancelar(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2 text-rose-500">
                <AlertTriangle size={18} />
                <h3 className="font-bold text-sm">Registrar Novedad / Cancelación</h3>
              </div>
              <button onClick={() => setPedidoACancelar(null)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <span className="text-xs font-bold block">{pedidoACancelar.nombre_cliente} (#{pedidoACancelar.id.slice(0, 8)})</span>
                <span className="text-[10px] tx-mu">Producto: {pedidoACancelar.sku || 'Sin SKU'}</span>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1.5">
                  Motivo de la Novedad / Rechazo
                </label>
                <select
                  value={motivoCancelacion}
                  onChange={e => setMotivoCancelacion(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                >
                  <option value="Cliente no contestó llamadas/mensajes">Cliente no contestó llamadas/mensajes</option>
                  <option value="Cliente sin efectivo en el momento">Cliente sin efectivo en el momento</option>
                  <option value="Dirección errónea o fuera de cobertura">Dirección errónea o fuera de cobertura</option>
                  <option value="Rechazó el producto / Se arrepintió">Rechazó el producto / Se arrepintió</option>
                  <option value="Pedido duplicado o de prueba">Pedido duplicado o de prueba</option>
                </select>
              </div>

              {/* Checkbox de Reingreso al Inventario Nativo */}
              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="reingresarKardex"
                  checked={reingresarKardex}
                  onChange={e => setReingresarKardex(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-0"
                />
                <label htmlFor="reingresarKardex" className="text-xs cursor-pointer">
                  <span className="font-bold text-[var(--tx)] block flex items-center gap-1">
                    <RotateCcw size={12} className="text-emerald-500" /> Reingresar unidad a Bodega Central
                  </span>
                  <span className="text-[10px] tx-mu block">
                    Registrará automáticamente una entrada por devolución en el Kárdex de inventario para que la unidad esté disponible para la venta de nuevo.
                  </span>
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setPedidoACancelar(null)} 
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Volver
                </button>
                <button
                  type="button"
                  disabled={cancelando}
                  onClick={confirmarCancelacion}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
                >
                  {cancelando ? "Procesando..." : "Confirmar Cancelación"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 7: PLANTILLAS INTELIGENTES DE WHATSAPP */}
      {pedidoWhatsapp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setPedidoWhatsapp(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2 text-emerald-600">
                <MessageCircle size={18} />
                <h3 className="font-bold text-sm">Enviar WhatsApp a {pedidoWhatsapp.nombre_cliente}</h3>
              </div>
              <button onClick={() => setPedidoWhatsapp(null)} className="p-1 rounded-lg"><X size={16} /></button>
            </div>

            <div className="p-5 space-y-3">
              <span className="text-[10px] uppercase font-bold tx-mu block">Selecciona una plantilla rápida:</span>

              {/* Plantilla 1: Confirmación de Pedido */}
              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] space-y-1.5">
                <span className="text-xs font-bold text-[var(--tx)] block">1. 📦 Confirmar Pedido y Dirección</span>
                <p className="text-[11px] tx-mu italic bg-cd p-2 rounded-lg border border-[var(--bd)]">
                  "¡Hola {pedidoWhatsapp.nombre_cliente}! 👋 Confirmamos tu pedido de *{pedidoWhatsapp.sku || 'tu producto'}* por un total de *{dinero(pedidoWhatsapp.total)}*. ¿Nos confirmas que recibirás en 📍 {pedidoWhatsapp.direccion || 'tu dirección'}?"
                </p>
                <a
                  href={`https://wa.me/${(pedidoWhatsapp.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(
                    `¡Hola ${pedidoWhatsapp.nombre_cliente || ''}! 👋 Confirmamos tu pedido de *${pedidoWhatsapp.sku || 'tu producto'}* por un total de *${dinero(pedidoWhatsapp.total)}*. ¿Nos confirmas si recibirás en 📍 ${pedidoWhatsapp.direccion || 'tu dirección'}?`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setPedidoWhatsapp(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold"
                >
                  <Send size={12} /> Enviar Confirmación
                </a>
              </div>

              {/* Plantilla 2: En Camino */}
              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] space-y-1.5">
                <span className="text-xs font-bold text-[var(--tx)] block">2. 🛵 Paquete en Camino con Motorista</span>
                <p className="text-[11px] tx-mu italic bg-cd p-2 rounded-lg border border-[var(--bd)]">
                  "¡Buenas noticias {pedidoWhatsapp.nombre_cliente}! 🛵 Tu pedido va en camino hoy con nuestro repartidor ({pedidoWhatsapp.courier || 'Motorista'}). Recuerda tener listo *{dinero(pedidoWhatsapp.total)}* en efectivo contra entrega."
                </p>
                <a
                  href={`https://wa.me/${(pedidoWhatsapp.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(
                    `¡Buenas noticias ${pedidoWhatsapp.nombre_cliente || ''}! 🛵 Tu pedido va en camino hoy con nuestro repartidor (${pedidoWhatsapp.courier || 'Motorista'}). Recuerda tener listo *${dinero(pedidoWhatsapp.total)}* en efectivo contra entrega.`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setPedidoWhatsapp(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold"
                >
                  <Send size={12} /> Enviar Aviso de Ruta
                </a>
              </div>

              {/* Plantilla 3: Novedad / Reintento */}
              <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] space-y-1.5">
                <span className="text-xs font-bold text-[var(--tx)] block">3. ⚠️ No Contesta / Reprogramar Entrega</span>
                <p className="text-[11px] tx-mu italic bg-cd p-2 rounded-lg border border-[var(--bd)]">
                  "Hola {pedidoWhatsapp.nombre_cliente}, nuestro repartidor estuvo en tu zona pero no logramos comunicarnos. ¿Nos confirmas si te queda bien reprogramar la entrega para mañana?"
                </p>
                <a
                  href={`https://wa.me/${(pedidoWhatsapp.telefono || '').replace(/\D/g, '')}?text=${encodeURIComponent(
                    `Hola ${pedidoWhatsapp.nombre_cliente || ''}, nuestro repartidor estuvo en tu zona pero no logramos comunicarnos. ¿Nos confirmas si te queda bien reprogramar la entrega para mañana?`
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setPedidoWhatsapp(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-bold"
                >
                  <Send size={12} /> Enviar Reprogramación
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta de pedido en Kanban                                         */
/* ------------------------------------------------------------------ */

function PedidoCard({
  pedido,
  moviendo,
  esDuplicado,
  seleccionado,
  onToggleSelect,
  onGuia,
  onDetalle,
  onMover,
  onEditar,
  onBorrar,
  onLiquidar,
  onOpenWhatsapp,
}: {
  pedido: Pedido;
  moviendo: boolean;
  esDuplicado: boolean;
  seleccionado: boolean;
  onToggleSelect: () => void;
  onGuia: (p: Pedido) => void;
  onDetalle: (p: Pedido) => void;
  onMover: (p: Pedido, dir: -1 | 1) => void;
  onEditar: (p: Pedido) => void;
  onBorrar: (p: Pedido) => void;
  onLiquidar: (p: Pedido) => void;
  onOpenWhatsapp: (p: Pedido) => void;
}) {
  const estado = normalizarEstado(pedido.estado);
  const idx = ESTADOS.indexOf(estado);

  const btnBase =
    "flex items-center justify-center rounded-lg border border-[var(--bd)] bg-sf py-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cd";

  return (
    <article className={`rounded-xl border border-[var(--bd)] bg-cd p-3 shadow-sm hover:shadow-md transition-shadow relative ${
      seleccionado ? 'ring-2 ring-indigo-500 bg-indigo-500/5' : ''
    }`}>
      {/* Cabecera de la tarjeta con Checkbox de selección */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <input
            type="checkbox"
            checked={seleccionado}
            onChange={onToggleSelect}
            className="rounded"
          />
          <h3 className="text-xs font-bold leading-tight text-[var(--tx)] truncate">
            {pedido.nombre_cliente || "Sin nombre"}
          </h3>
        </div>

        <span className="shrink-0 text-[10px] font-mono opacity-50">
          {fechaCorta(pedido.created_at)}
        </span>
      </div>

      {/* Alerta de teléfono duplicado */}
      {esDuplicado && (
        <div className="mt-1.5 flex items-center gap-1 text-[9px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
          <AlertTriangle size={11} /> Mismo teléfono en otro pedido
        </div>
      )}

      {/* Producto y Precio */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs opacity-80 truncate">
          <Package className="w-3.5 h-3.5 shrink-0" />
          {pedido.sku || "—"}
        </span>
        <span className="text-base font-black text-emerald-600 font-mono">
          {dinero(pedido.total)}
        </span>
      </div>

      {/* Badges de Zona y Courier */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="inline-flex items-center gap-0.5 rounded-md border border-[var(--bd)] bg-sf px-1.5 py-0.5 text-[9px] font-semibold">
          <MapPin size={9} /> {pedido.departamento || "San Salvador"}
        </span>

        <span className="inline-flex items-center gap-0.5 rounded-md border border-[var(--bd)] bg-sf px-1.5 py-0.5 text-[9px] font-semibold text-neutral-600 dark:text-neutral-300">
          <Truck size={9} /> {pedido.courier || "Motorista Central 1"}
        </span>

        {pedido.liquidado && (
          <span className="inline-flex items-center gap-0.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600">
            ✓ Liquidado
          </span>
        )}
      </div>

      {/* Botones de acción */}
      <div className="mt-3 grid grid-cols-5 gap-1">
        <button
          onClick={() => onGuia(pedido)}
          className={`${btnBase} text-[var(--tx)]`}
          title="Generar guía de envío"
        >
          <Printer className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onOpenWhatsapp(pedido)}
          className={`${btnBase} text-emerald-600 hover:bg-emerald-500/10`}
          title="Plantillas de WhatsApp"
        >
          <MessageCircle className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onDetalle(pedido)}
          className={`${btnBase} text-[var(--tx)]`}
          title="Ver detalle"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onEditar(pedido)}
          className={`${btnBase} text-indigo-500 hover:bg-indigo-500/10`}
          title="Editar pedido"
        >
          <Edit className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={() => onBorrar(pedido)}
          className={`${btnBase} text-rose-500 hover:bg-rose-500/10`}
          title="Eliminar pedido"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Botón rápido de Liquidar en Finanzas si está en camino o entregado */}
      {(estado === "en_camino" || estado === "entregado") && !pedido.liquidado && (
        <button
          onClick={() => onLiquidar(pedido)}
          className="mt-2 w-full py-1 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition-colors border border-emerald-500/20"
        >
          <DollarSign size={12} /> Liquidar {dinero(pedido.total)} en Finanzas
        </button>
      )}

      {/* Mover entre columnas */}
      <div className="mt-2 flex items-center justify-between gap-1.5 pt-1 border-t border-[var(--bd)]">
        <button
          onClick={() => onMover(pedido, -1)}
          disabled={idx === 0 || moviendo}
          className={`${btnBase} flex-1 text-[var(--tx)]`}
          title="Mover a columna anterior"
        >
          {moviendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronLeft className="w-3.5 h-3.5" />}
        </button>

        <span className="text-[9px] font-bold uppercase tracking-wider opacity-60 px-1 truncate">
          {ETIQUETA_ESTADO[estado]}
        </span>

        <button
          onClick={() => onMover(pedido, 1)}
          disabled={idx === ESTADOS.length - 1 || moviendo}
          className={`${btnBase} flex-1 text-[var(--tx)]`}
          title="Mover a columna siguiente"
        >
          {moviendo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Modal de detalle                                                    */
/* ------------------------------------------------------------------ */

function DetallePedido({ pedido, onClose }: { pedido: Pedido; onClose: () => void }) {
  const filas: { icon: React.ReactNode; label: string; valor: string }[] = [
    { icon: <User className="w-4 h-4" />, label: "Cliente", valor: pedido.nombre_cliente || "—" },
    { icon: <Phone className="w-4 h-4" />, label: "Teléfono", valor: pedido.telefono || "—" },
    { icon: <MapPin className="w-4 h-4" />, label: "Dirección", valor: pedido.direccion || "—" },
    { icon: <Truck className="w-4 h-4" />, label: "Courier / Transportista", valor: pedido.courier || "Motorista Central 1" },
    { icon: <MapPin className="w-4 h-4" />, label: "Zona / Departamento", valor: pedido.departamento || "San Salvador" },
    { icon: <Package className="w-4 h-4" />, label: "SKU / Producto", valor: pedido.sku || "—" },
    { icon: <CreditCard className="w-4 h-4" />, label: "Método de pago", valor: pedido.metodo_pago || "Contra entrega" },
    { icon: <Hash className="w-4 h-4" />, label: "Código anuncio", valor: pedido.codigo_anuncio || "—" },
    { icon: <StickyNote className="w-4 h-4" />, label: "Notas", valor: pedido.notas || "Sin notas" },
  ];

  if (pedido.motivo_cancelacion) {
    filas.push({
      icon: <AlertTriangle className="w-4 h-4 text-rose-500" />,
      label: "Motivo de Cancelación",
      valor: pedido.motivo_cancelacion
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--bd)] px-5 py-4 bg-sf">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-50">
              Detalle del pedido
            </p>
            <h3 className="text-base font-black truncate">
              #{pedido.id.slice(0, 8).toUpperCase()}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-black/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="px-5 py-4 space-y-3">
          {filas.map((f) => (
            <div key={f.label} className="flex items-start gap-3">
              <span className="mt-0.5 opacity-50">{f.icon}</span>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-50">
                  {f.label}
                </p>
                <p className="text-xs break-words font-medium">{f.valor}</p>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-xl border border-[var(--bd)] bg-sf px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wider opacity-60">Total Contra Entrega</span>
            <span className="text-xl font-black text-emerald-600 font-mono">{dinero(pedido.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
