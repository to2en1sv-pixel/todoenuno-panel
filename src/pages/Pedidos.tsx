import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Search,
  Printer,
  MessageCircle,
  Eye,
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
} from "lucide-react";
import { supabase } from "../lib/supabase";
import PedidoModal from "../components/PedidoModal";
import GuiaEnvio from "../components/GuiaEnvio";

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

const normalizarEstado = (e: string | null | undefined): Estado =>
  ESTADOS.includes((e ?? "") as Estado) ? ((e as Estado) ?? "nuevo") : "nuevo";

const dinero = (n: number | null | undefined) => `$${Number(n ?? 0).toLocaleString("es-CO")}`;

const fechaCorta = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
};

/* ------------------------------------------------------------------ */
/* Página principal                                                    */
/* ------------------------------------------------------------------ */

export default function Pedidos() {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  const [modalNuevo, setModalNuevo] = useState(false);
  const [pedidoGuia, setPedidoGuia] = useState<Pedido | null>(null);
  const [pedidoDetalle, setPedidoDetalle] = useState<Pedido | null>(null);
  const [moviendoId, setMoviendoId] = useState<string | null>(null);

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

  /* --------------------------- Mover entre columnas --------------------------- */
  const moverPedido = async (pedido: Pedido, dir: -1 | 1) => {
    const actual = ESTADOS.indexOf(normalizarEstado(pedido.estado));
    const destino = ESTADOS[actual + dir];
    if (!destino) return;

    setMoviendoId(pedido.id);
    const previos = pedidos;

    // Optimistic update
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
      await cargarPedidos(true);
    }
    setMoviendoId(null);
  };

  /* --------------------------- Filtro + agrupación --------------------------- */
  const porEstado = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const base = q
      ? pedidos.filter(
          (p) =>
            (p.nombre_cliente ?? "").toLowerCase().includes(q) ||
            (p.sku ?? "").toLowerCase().includes(q) ||
            (p.telefono ?? "").toLowerCase().includes(q) ||
            (p.codigo_anuncio ?? "").toLowerCase().includes(q)
        )
      : pedidos;

    const map: Record<Estado, Pedido[]> = {
      nuevo: [],
      por_empacar: [],
      en_camino: [],
      entregado: [],
      cancelado: [],
    };
    for (const p of base) map[normalizarEstado(p.estado)].push(p);
    return map;
  }, [pedidos, busqueda]);

  const totalFiltrados = useMemo(
    () => Object.values(porEstado).reduce((acc, arr) => acc + arr.length, 0),
    [porEstado]
  );

  /* --------------------------- Render --------------------------- */
  return (
    <div className="min-h-screen bg-[var(--cd)] text-[var(--tx)] p-4 md:p-6">
      {/* ------------------------------ HEADER ------------------------------ */}
      <header className="flex flex-col lg:flex-row lg:items-center gap-4 mb-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-black tracking-tight">Pedidos</h1>
          <p className="text-xs md:text-sm opacity-60 mt-1">
            Tablero Kanban · {totalFiltrados} pedido{totalFiltrados === 1 ? "" : "s"}
            {busqueda && " (filtrados)"}
          </p>
        </div>

        <div className="flex items-center gap-2 w-full lg:w-auto">
          <div className="relative flex-1 lg:w-72">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por nombre, SKU, teléfono..."
              className="w-full rounded-xl border border-[var(--bd)] bg-[var(--cd)] pl-9 pr-9 py-2.5 text-sm text-[var(--tx)] outline-none focus:ring-2 focus:ring-indigo-500/60 placeholder:opacity-40"
            />
            {busqueda && (
              <button
                onClick={() => setBusqueda("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-black/10 opacity-60"
                title="Limpiar búsqueda"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => cargarPedidos(true)}
            disabled={refrescando}
            className="p-2.5 rounded-xl border border-[var(--bd)] bg-[var(--cd)] hover:bg-black/5 transition-colors disabled:opacity-50"
            title="Recargar"
          >
            <RefreshCw className={`w-4 h-4 ${refrescando ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={() => setModalNuevo(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-colors whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Nuevo Pedido
          </button>
        </div>
      </header>

      {/* ------------------------------ ERROR ------------------------------ */}
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-500">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ------------------------------ LOADING ------------------------------ */}
      {cargando ? (
        <div className="flex flex-col items-center justify-center py-24 opacity-60">
          <Loader2 className="w-8 h-8 animate-spin mb-3" />
          <p className="text-sm">Cargando pedidos...</p>
        </div>
      ) : (
        /* ------------------------------ KANBAN ------------------------------ */
        <div className="flex gap-4 overflow-x-auto pb-4 -mx-1 px-1">
          {COLUMNAS.map((col) => (
            <section
              key={col.key}
              className={`flex flex-col shrink-0 min-w-[290px] w-[290px] xl:w-auto xl:flex-1 rounded-2xl border border-[var(--bd)] border-t-4 ${col.accent} bg-[var(--cd)]`}
            >
              <header className="flex items-center justify-between px-4 py-3 border-b border-[var(--bd)]">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--tx)]">
                  <span aria-hidden>{col.emoji}</span>
                  {col.titulo}
                </h2>
                <span className="text-xs font-black px-2 py-0.5 rounded-full bg-black/5">
                  {porEstado[col.key].length}
                </span>
              </header>

              <div className="p-3 space-y-3 overflow-y-auto min-h-[140px] max-h-[calc(100vh-300px)]">
                {porEstado[col.key].length === 0 ? (
                  <p className="text-center text-xs opacity-40 py-8">Sin pedidos</p>
                ) : (
                  porEstado[col.key].map((pedido) => (
                    <PedidoCard
                      key={pedido.id}
                      pedido={pedido}
                      moviendo={moviendoId === pedido.id}
                      onGuia={setPedidoGuia}
                      onDetalle={setPedidoDetalle}
                      onMover={moverPedido}
                    />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ------------------------------ MODAL: NUEVO PEDIDO ------------------------------ */}
      {modalNuevo && (
        <PedidoModal
          onClose={() => setModalNuevo(false)}
          onSaved={() => cargarPedidos(true)}
        />
      )}

      {/* ------------------------------ MODAL: GUÍA DE ENVÍO ------------------------------ */}
      {pedidoGuia && (
        <GuiaEnvio pedido={pedidoGuia} onClose={() => setPedidoGuia(null)} />
      )}

      {/* ------------------------------ MODAL: DETALLE ------------------------------ */}
      {pedidoDetalle && (
        <DetallePedido pedido={pedidoDetalle} onClose={() => setPedidoDetalle(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tarjeta de pedido                                                   */
/* ------------------------------------------------------------------ */

function PedidoCard({
  pedido,
  moviendo,
  onGuia,
  onDetalle,
  onMover,
}: {
  pedido: Pedido;
  moviendo: boolean;
  onGuia: (p: Pedido) => void;
  onDetalle: (p: Pedido) => void;
  onMover: (p: Pedido, dir: -1 | 1) => void;
}) {
  const estado = normalizarEstado(pedido.estado);
  const idx = ESTADOS.indexOf(estado);
  const telefonoLimpio = (pedido.telefono ?? "").replace(/\D/g, "");

  const btnBase =
    "flex items-center justify-center rounded-lg border border-[var(--bd)] bg-[var(--cd)] py-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed";

  return (
    <article className="rounded-xl border border-[var(--bd)] bg-[var(--cd)] p-3 shadow-sm hover:shadow-md transition-shadow">
      {/* Nombre + fecha */}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold leading-tight text-[var(--tx)] truncate">
          {pedido.nombre_cliente || "Sin nombre"}
        </h3>
        <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-60">
          {fechaCorta(pedido.created_at)}
        </span>
      </div>

      {/* SKU + Total */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-xs opacity-80 truncate">
          <Package className="w-3.5 h-3.5 shrink-0" />
          {pedido.sku || "—"}
        </span>
        <span className="text-sm font-black text-[var(--tx)] whitespace-nowrap">
          {dinero(pedido.total)}
        </span>
      </div>

      {/* Badge código de anuncio */}
      {pedido.codigo_anuncio && (
        <div className="mt-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-indigo-500">
            <Hash className="w-3 h-3" />
            {pedido.codigo_anuncio}
          </span>
        </div>
      )}

      {/* Acciones */}
      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <button
          onClick={() => onGuia(pedido)}
          className={`${btnBase} text-[var(--tx)] hover:bg-black/5`}
          title="Generar guía de envío"
        >
          <Printer className="w-4 h-4" />
        </button>

        <a
          href={telefonoLimpio ? `https://wa.me/${telefonoLimpio}` : undefined}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            if (!telefonoLimpio) e.preventDefault();
          }}
          className={`${btnBase} text-emerald-500 hover:bg-emerald-500/10 ${
            !telefonoLimpio ? "pointer-events-none opacity-30" : ""
          }`}
          title="Escribir por WhatsApp"
        >
          <MessageCircle className="w-4 h-4" />
        </a>

        <button
          onClick={() => onDetalle(pedido)}
          className={`${btnBase} text-[var(--tx)] hover:bg-black/5`}
          title="Ver detalle"
        >
          <Eye className="w-4 h-4" />
        </button>
      </div>

      {/* Mover entre columnas */}
      <div className="mt-2 flex items-center justify-between gap-1.5">
        <button
          onClick={() => onMover(pedido, -1)}
          disabled={idx === 0 || moviendo}
          className={`${btnBase} flex-1 text-[var(--tx)] hover:bg-black/5`}
          title="Mover a la columna anterior"
        >
          {moviendo ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ChevronLeft className="w-4 h-4" />
          )}
        </button>

        <span className="text-[9px] font-bold uppercase tracking-wider opacity-50 whitespace-nowrap px-1">
          {ETIQUETA_ESTADO[estado]}
        </span>

        <button
          onClick={() => onMover(pedido, 1)}
          disabled={idx === ESTADOS.length - 1 || moviendo}
          className={`${btnBase} flex-1 text-[var(--tx)] hover:bg-black/5`}
          title="Mover a la columna siguiente"
        >
          {moviendo ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
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
    { icon: <Package className="w-4 h-4" />, label: "SKU / Producto", valor: pedido.sku || "—" },
    { icon: <CreditCard className="w-4 h-4" />, label: "Método de pago", valor: pedido.metodo_pago || "—" },
    { icon: <Hash className="w-4 h-4" />, label: "Código anuncio", valor: pedido.codigo_anuncio || "—" },
    { icon: <StickyNote className="w-4 h-4" />, label: "Notas", valor: pedido.notas || "Sin notas" },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-[var(--bd)] bg-[var(--cd)] text-[var(--tx)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--bd)] px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-50">
              Detalle del pedido
            </p>
            <h3 className="text-lg font-black truncate">
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
                <p className="text-sm break-words">{f.valor}</p>
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between rounded-xl border border-[var(--bd)] bg-black/5 px-4 py-3">
            <span className="text-xs font-bold uppercase tracking-wider opacity-60">Total</span>
            <span className="text-xl font-black">{dinero(pedido.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
