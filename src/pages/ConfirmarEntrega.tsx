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
  Calculator,
  Truck,
  RotateCcw,
  X,
  Send,
  ShieldAlert,
  Search,
  Calendar,
  Wallet,
  Landmark,
  Copy,
  Check,
  ClipboardList,
  Lock,
  LogOut,
  KeyRound,
  Eye,
  EyeOff,
  Clock,
} from "lucide-react";
import { compressImageFile, syncOrderInventoryOnStatusChange } from "@/lib/inventory";
import { hydrateCutoffsFromOsEvents } from "@/lib/catalogAliases";
import { addOrUpdateBlacklist, evaluateCustomerRisk } from "@/lib/blacklist";
import {
  fetchOrderWhatsappTemplates,
  getCachedOrderWhatsappTemplates,
  renderWhatsappTemplate,
} from "@/lib/whatsappTemplates";
import {
  useCouriers,
  fetchDriverAccessConfig,
  getCachedDriverAccessConfig,
  getDriverSession,
  setDriverSession,
  clearDriverSession,
  type DriverAccessConfig,
  type DriverPortalSession,
} from "@/lib/couriers";
import { uploadOrderDataUrlToBucket, saveOrderEvidence } from "@/lib/orderStorage";

const DRIVER_COURIER_STORAGE_KEY = "todoenuno_driver_courier_v1";

const DRIVER_TIME_PRESETS: Array<{ label: string; value: string }> = [
  { label: "Ya estoy afuera", value: "menos de 2 minutos (¡ya estoy afuera!)" },
  { label: "15 min", value: "15 minutos" },
  { label: "30 min", value: "30 minutos" },
  { label: "1 hora", value: "1 hora" },
  { label: "2 horas", value: "2 horas" },
];

type CobroTipo = "efectivo" | "transferencia";

function getElSalvadorDateKey(iso?: string | null): string {
  try {
    const d = iso ? new Date(iso) : new Date();
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/El_Salvador",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

function getElSalvadorTimeLabel(): string {
  try {
    return new Intl.DateTimeFormat("es-SV", {
      timeZone: "America/El_Salvador",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  } catch {
    return "";
  }
}

function addDaysSv(days: number): string {
  const base = new Date(Date.now() + days * 86_400_000);
  return getElSalvadorDateKey(base.toISOString());
}

function formatSvWaPhone(raw?: string | null): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 8) return `503${digits}`;
  return digits;
}

function formatTelHref(raw?: string | null): string {
  const wa = formatSvWaPhone(raw);
  if (!wa) return "";
  return `tel:+${wa}`;
}

function isOrderPrepaid(pedido: any): boolean {
  const mp = String(pedido?.metodo_pago || "").toLowerCase();
  if (!mp) return false;
  if (mp.includes("contra")) return false;
  return mp.includes("pagado") || mp.includes("anticip") || mp.includes("transfer") || mp.includes("tarjeta");
}

function getOrderCobroKind(pedido: any): "efectivo" | "transferencia" | "prepagado" {
  const notas = String(pedido?.notas || "").toLowerCase();
  if (notas.includes("[cobro: transferencia]")) return "transferencia";
  if (notas.includes("[cobro: efectivo]")) return "efectivo";
  if (isOrderPrepaid(pedido)) return "prepagado";
  return "efectivo";
}

function isDeliveredTodaySv(pedido: any, todaySv: string): boolean {
  if (pedido?.estado !== "entregado") return false;
  const notas = String(pedido?.notas || "");
  const stampMatch = notas.match(/\[Entregado[^\]]*(\d{4}-\d{2}-\d{2})/i);
  if (stampMatch?.[1]) {
    return stampMatch[1] === todaySv;
  }
  const updatedKey = pedido?.updated_at ? getElSalvadorDateKey(pedido.updated_at) : "";
  if (updatedKey) return updatedKey === todaySv;
  return getElSalvadorDateKey(pedido?.created_at) === todaySv;
}

function hasOrderIssue(pedido: any): boolean {
  const notas = String(pedido?.notas || "").toUpperCase();
  return Boolean(pedido?.motivo_cancelacion) || notas.includes("[NOVEDAD");
}

function getOrderProductLabel(pedido: any): string {
  if (pedido?.producto) return String(pedido.producto);
  if (Array.isArray(pedido?.items) && pedido.items.length > 0) {
    return pedido.items
      .map((i: any) => `${i?.cantidad || 1}x ${i?.nombre || i?.sku || "Producto"}`)
      .join(", ");
  }
  return String(pedido?.sku || pedido?.catalogo_sku || "Producto");
}

const MOTIVOS_BOLETINAR_DEFAULT = new Set([
  "Cliente no contestó llamadas/mensajes",
  "Cliente canceló / rechaza producto",
]);

export function ConfirmarEntregaPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { couriers, activeNames: courierOptions } = useCouriers();

  const todaySv = useMemo(() => getElSalvadorDateKey(), []);

  // Seguridad PIN del Portal Repartidor
  const [driverAccess, setDriverAccess] = useState<DriverAccessConfig>(() =>
    getCachedDriverAccessConfig()
  );
  const [driverSession, setDriverSessionState] = useState<DriverPortalSession | null>(() =>
    getDriverSession()
  );
  const [loginTarget, setLoginTarget] = useState<string>("auto");
  const [pinInput, setPinInput] = useState("");
  const [showPin, setShowPin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Estados de carga
  const [cargando, setCargando] = useState(true);
  const [pedido, setPedido] = useState<any>(null);
  const [todosLosPedidos, setTodosLosPedidos] = useState<any[]>([]);
  const [actualizando, setActualizando] = useState(false);
  const [exito, setExito] = useState(false);

  const [driverTemplate, setDriverTemplate] = useState<string>(() => {
    const cached = getCachedOrderWhatsappTemplates().find((t) => t.id === "repartidor_llegando");
    return (
      cached?.mensaje ||
      "Hola {nombre}, soy el repartidor de To2en1.app. Estoy llegando a tu dirección con tu pedido de *{producto}*. ¿Te encuentras disponible para recibir? 🛵"
    );
  });

  useEffect(() => {
    fetchOrderWhatsappTemplates().then(({ templates }) => {
      const tpl = templates.find((t) => t.id === "repartidor_llegando");
      if (tpl?.mensaje) setDriverTemplate(tpl.mensaje);
    });
    fetchDriverAccessConfig().then((cfg) => {
      setDriverAccess(cfg);
    });
  }, []);

  // Vista de Hoja de Ruta vs Entrega Individual
  const [modoRuta, setModoRuta] = useState(!id);
  const [courierSeleccionado, setCourierSeleccionado] = useState<string>(() => {
    const sess = getDriverSession();
    if (sess?.role === "courier" && sess.courierName) {
      return sess.courierName;
    }
    try {
      return localStorage.getItem(DRIVER_COURIER_STORAGE_KEY) || "Todos los Couriers";
    } catch {
      return "Todos los Couriers";
    }
  });
  const [busquedaRuta, setBusquedaRuta] = useState("");
  const [tiempoEstimado, setTiempoEstimado] = useState<string>("30 minutos");
  const autoAssignedOrderIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (driverSession?.role === "courier" && driverSession.courierName) {
      setCourierSeleccionado(driverSession.courierName);
    }
  }, [driverSession]);

  // Notificaciones Evolution en 1 clic (máximo 1 envío por pedido)
  const [sendingWaId, setSendingWaId] = useState<string | null>(null);
  const [notificadosWaIds, setNotificadosWaIds] = useState<Record<string, boolean>>({});
  const evoSentOrInFlightRef = useRef<Set<string>>(new Set());
  const [toastInfo, setToastInfo] = useState<{ tipo: "ok" | "warn" | "err"; texto: string } | null>(null);

  // Modal Cuadre / Cierre del Día
  const [mostrarCuadreModal, setMostrarCuadreModal] = useState(false);
  const [cuadreCopiado, setCuadreCopiado] = useState(false);

  // Cobro y Calculadora de Vuelto
  const [cobroTipo, setCobroTipo] = useState<CobroTipo>("efectivo");
  const [pagaCon, setPagaCon] = useState<string>("");
  const [mostrarCalculadora, setMostrarCalculadora] = useState(false);

  // Novedades y Lista Negra
  const [mostrarNovedadModal, setMostrarNovedadModal] = useState(false);
  const [tipoNovedad, setTipoNovedad] = useState("Cliente no contestó llamadas/mensajes");
  const [notaNovedad, setNotaNovedad] = useState("");
  const [boletinarEnListaNegra, setBoletinarEnListaNegra] = useState(true);
  const [nuevaFechaReprogramar, setNuevaFechaReprogramar] = useState(() => addDaysSv(1));
  const [moverAProgramado, setMoverAProgramado] = useState(true);
  const [cancelarPorRechazo, setCancelarPorRechazo] = useState(false);
  const [enviandoNovedad, setEnviandoNovedad] = useState(false);

  // Prueba de Entrega (Foto y Firma)
  const [fotoEntrega, setFotoEntrega] = useState<string | null>(null);
  const [enviarFotoCliente, setEnviarFotoCliente] = useState(false);
  const [mostrarFirma, setMostrarFirma] = useState(false);
  const [hayFirma, setHayFirma] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);

  const showToast = (tipo: "ok" | "warn" | "err", texto: string) => {
    setToastInfo({ tipo, texto });
    setTimeout(() => {
      setToastInfo((prev) => (prev?.texto === texto ? null : prev));
    }, 5500);
  };

  const handleCourierChange = (value: string) => {
    if (driverSession?.role === "courier" && driverSession.courierName) {
      setCourierSeleccionado(driverSession.courierName);
      return;
    }
    setCourierSeleccionado(value);
    try {
      localStorage.setItem(DRIVER_COURIER_STORAGE_KEY, value);
    } catch {}
  };

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanPin = pinInput.replace(/\D/g, "");
    if (cleanPin.length < 4) {
      setPinError("Ingresa un PIN válido (4 a 6 dígitos).");
      return;
    }

    // 1. Verificar PIN Maestro Admin
    if (cleanPin === driverAccess.adminPin) {
      const sess: DriverPortalSession = {
        role: "admin",
        loggedInAt: Date.now(),
      };
      setDriverSession(sess);
      setDriverSessionState(sess);
      setPinError(null);
      setPinInput("");
      return;
    }

    // 2. Verificar PIN por courier específico o detección automática
    if (loginTarget === "admin") {
      setPinError("PIN Maestro incorrecto.");
      return;
    }

    if (loginTarget !== "auto") {
      const targetCourier = couriers.find((c) => c.id === loginTarget);
      if (!targetCourier) {
        setPinError("Courier no encontrado.");
        return;
      }
      if (!targetCourier.pin) {
        setPinError(
          `El courier "${targetCourier.nombre}" aún no tiene PIN asignado en Sistema → Couriers & Envíos.`
        );
        return;
      }
      if (targetCourier.pin !== cleanPin) {
        setPinError(`PIN incorrecto para ${targetCourier.nombre}.`);
        return;
      }
      const sess: DriverPortalSession = {
        role: "courier",
        courierId: targetCourier.id,
        courierName: targetCourier.nombre,
        loggedInAt: Date.now(),
      };
      setDriverSession(sess);
      setDriverSessionState(sess);
      setCourierSeleccionado(targetCourier.nombre);
      setPinError(null);
      setPinInput("");
      return;
    }

    // Detección automática por PIN de courier activo
    const matched = couriers.find((c) => c.activo !== false && c.pin && c.pin === cleanPin);
    if (matched) {
      const sess: DriverPortalSession = {
        role: "courier",
        courierId: matched.id,
        courierName: matched.nombre,
        loggedInAt: Date.now(),
      };
      setDriverSession(sess);
      setDriverSessionState(sess);
      setCourierSeleccionado(matched.nombre);
      setPinError(null);
      setPinInput("");
      return;
    }

    setPinError("PIN no reconocido. Selecciona tu nombre o verifica con administración.");
  };

  const handleLockPortal = () => {
    clearDriverSession();
    setDriverSessionState(null);
    setPinInput("");
    setPinError(null);
  };

  const resetDeliveryFormState = (targetOrder?: any) => {
    setFotoEntrega(null);
    setEnviarFotoCliente(false);
    setMostrarFirma(false);
    setHayFirma(false);
    setPagaCon("");
    setMostrarCalculadora(false);
    setExito(false);
    setCobroTipo(isOrderPrepaid(targetOrder) ? "transferencia" : "efectivo");
  };

  const openOrderForDelivery = (targetOrder: any) => {
    resetDeliveryFormState(targetOrder);
    setPedido(targetOrder);
    setModoRuta(false);
  };

  // Cargar pedidos y pedido activo
  const cargarDatos = async () => {
    setCargando(true);

    const [, { data: todos }] = await Promise.all([
      hydrateCutoffsFromOsEvents(supabase),
      supabase
        .from("whatsapp_orders")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(450),
    ]);

    if (todos) {
      setTodosLosPedidos(todos);
    }

    if (id) {
      const p = todos?.find((item) => item.id === id);
      if (p) {
        openOrderForDelivery(p);
      } else {
        const { data: individual } = await supabase
          .from("whatsapp_orders")
          .select("*")
          .eq("id", id)
          .single();
        openOrderForDelivery(individual);
      }
    } else {
      setModoRuta(true);
    }

    setCargando(false);
  };

  useEffect(() => {
    cargarDatos();
  }, [id]);

  // Auto-asignar paquete al motorista autenticado cuando escanea un QR (/entregar/:id)
  useEffect(() => {
    if (!id || !pedido?.id) return;
    if (driverAccess.requirePin && !driverSession) return;
    if (driverSession?.role !== "courier" || !driverSession.courierName) return;

    const courierName = driverSession.courierName.trim();
    const estActual = String(pedido.estado || "");
    if (estActual === "entregado" || estActual === "cancelado") return;

    const key = `${pedido.id}:${courierName}`;
    if (autoAssignedOrderIdRef.current === key) return;

    const sameCourier =
      String(pedido.courier || "").trim().toLowerCase() === courierName.toLowerCase();
    const needsRouteState = estActual === "por_empacar" || estActual === "nuevo" || !estActual;

    if (sameCourier && !needsRouteState) {
      autoAssignedOrderIdRef.current = key;
      return;
    }

    autoAssignedOrderIdRef.current = key;

    (async () => {
      try {
        const nextEstado = needsRouteState ? "en_camino" : estActual;
        const assignStamp = `[Asignado por QR a ${courierName} ${getElSalvadorTimeLabel()}]`;
        const nextNotas = pedido.notas ? `${pedido.notas} • ${assignStamp}` : assignStamp;
        const patch: Record<string, any> = {
          courier: courierName,
          notas: nextNotas,
          ...(nextEstado !== estActual ? { estado: nextEstado } : {}),
        };

        const { error: updErr } = await supabase
          .from("whatsapp_orders")
          .update(patch)
          .eq("id", pedido.id);

        if (updErr) throw updErr;

        if (nextEstado !== estActual) {
          try {
            await syncOrderInventoryOnStatusChange({
              order: pedido,
              prevEstado: estActual || "nuevo",
              nextEstado,
              usuario: courierName,
            });
          } catch (invErr) {
            console.warn("Error sincronizando Kárdex al auto-asignar por QR:", invErr);
          }
        }

        const updated = { ...pedido, ...patch };
        setPedido(updated);
        setTodosLosPedidos((prev) =>
          prev.some((item) => item.id === pedido.id)
            ? prev.map((item) => (item.id === pedido.id ? updated : item))
            : [updated, ...prev]
        );
        showToast("ok", `Paquete asignado automáticamente a tu ruta (${courierName}).`);
      } catch (err) {
        console.warn("No se pudo auto-asignar paquete por QR:", err);
      }
    })();
  }, [id, pedido?.id, pedido?.courier, pedido?.estado, driverAccess.requirePin, driverSession]);

  // Manejo de canvas de firma táctil con escalado exacto
  useEffect(() => {
    if (mostrarFirma && canvasRef.current) {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 2.6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
      }
    }
  }, [mostrarFirma]);

  const getScaledCanvasPoint = (e: any, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: any) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    isDrawing.current = true;
    const ctx = canvas.getContext("2d");
    const pt = getScaledCanvasPoint(e, canvas);
    ctx?.beginPath();
    ctx?.moveTo(pt.x, pt.y);
  };

  const draw = (e: any) => {
    if (!isDrawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pt = getScaledCanvasPoint(e, canvas);
    ctx?.lineTo(pt.x, pt.y);
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
      const compressed = await compressImageFile(file, 960, 960, 0.78);
      setFotoEntrega(compressed);
    } catch (err) {
      console.error("Error al capturar foto:", err);
      showToast("err", "No se pudo procesar la foto de entrega.");
    } finally {
      e.target.value = "";
    }
  };

  const buildDriverWaUrl = (targetOrder: any): string | undefined => {
    const waPhone = formatSvWaPhone(targetOrder?.telefono);
    if (!waPhone) return undefined;
    const baseMsg = renderWhatsappTemplate(driverTemplate, targetOrder, {
      tiempo: tiempoEstimado,
    });
    const extraLines: string[] = [];
    if (targetOrder?.direccion && !baseMsg.includes(targetOrder.direccion)) {
      extraLines.push(`📍 Dirección: ${targetOrder.direccion}`);
    }
    const code =
      targetOrder?.pedido_codigo ||
      (targetOrder?.id ? `#${String(targetOrder.id).slice(0, 8).toUpperCase()}` : "");
    if (code && !baseMsg.includes(code)) {
      extraLines.push(`🧾 Pedido: ${code}`);
    }
    const fullMsg = extraLines.length > 0 ? `${baseMsg}\n${extraLines.join("\n")}` : baseMsg;
    return `https://wa.me/${waPhone}?text=${encodeURIComponent(fullMsg)}`;
  };

  // Enviar aviso de llegada directo vía Evolution API (máximo 1 vez por pedido; siempre abre WhatsApp del repartidor)
  const handleAvisarLlegadaEvolution = async (targetOrder: any) => {
    if (!targetOrder?.id) return;
    if (!targetOrder?.telefono) {
      showToast("err", "Este pedido no tiene teléfono registrado.");
      return;
    }

    const alreadySent =
      Boolean(notificadosWaIds[targetOrder.id]) ||
      String(targetOrder.notas || "").includes("[Aviso llegada") ||
      evoSentOrInFlightRef.current.has(targetOrder.id);

    if (alreadySent) {
      showToast(
        "ok",
        `El aviso de tienda para ${targetOrder.nombre_cliente || "el cliente"} ya se envió una vez (sin spam). Se abrió tu WhatsApp.`
      );
      return;
    }

    // Bloqueo síncrono inmediato para evitar envíos duplicados por doble toque
    evoSentOrInFlightRef.current.add(targetOrder.id);

    const waPhone = formatSvWaPhone(targetOrder.telefono);
    const text = renderWhatsappTemplate(driverTemplate, targetOrder, {
      tiempo: tiempoEstimado,
    });
    setSendingWaId(targetOrder.id);

    try {
      const res = await fetch("/api/send-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          contactPhone: waPhone,
          contactName: targetOrder.nombre_cliente || "Cliente",
          text,
          pauseBot: false,
        }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json?.details || json?.error || `HTTP ${res.status}`);
      }

      setNotificadosWaIds((prev) => ({ ...prev, [targetOrder.id]: true }));
      const stamp = `[Aviso llegada ${getElSalvadorTimeLabel()}]`;
      const nextNotas = targetOrder.notas ? `${targetOrder.notas} • ${stamp}` : stamp;

      await supabase.from("whatsapp_orders").update({ notas: nextNotas }).eq("id", targetOrder.id);

      setTodosLosPedidos((prev) =>
        prev.map((item) => (item.id === targetOrder.id ? { ...item, notas: nextNotas } : item))
      );
      if (pedido?.id === targetOrder.id) {
        setPedido((prev: any) => (prev ? { ...prev, notas: nextNotas } : prev));
      }

      showToast("ok", `Aviso de tienda enviado (1/1) y WhatsApp abierto para ${targetOrder.nombre_cliente || "cliente"}.`);
    } catch (err: any) {
      // Si falló la red o Evolution, permitir reintentar luego
      evoSentOrInFlightRef.current.delete(targetOrder.id);
      console.error("Error enviando aviso de llegada:", err);
      showToast(
        "warn",
        `Se abrió tu WhatsApp (Evolution no respondió: ${err?.message || "error"}).`
      );
    } finally {
      setSendingWaId(null);
    }
  };

  // Acción: Confirmar Entrega
  const handleEntregar = async () => {
    if (!pedido?.id) return;
    setActualizando(true);
    const prevEstado = pedido.estado || "en_camino";
    const prepagado = isOrderPrepaid(pedido);
    const cobroEtiqueta = prepagado
      ? "Prepagado"
      : cobroTipo === "transferencia"
      ? "Transferencia"
      : "Efectivo";

    const assignedCourier =
      driverSession?.role === "courier" && driverSession.courierName
        ? driverSession.courierName
        : courierSeleccionado !== "Todos los Couriers"
        ? courierSeleccionado
        : pedido.courier || "Motorista Central 1";

    const hora = getElSalvadorTimeLabel();
    const stampParts = [
      `Entregado en ruta ${todaySv} ${hora}`,
      `Cobro: ${cobroEtiqueta}`,
      fotoEntrega ? "Foto: Sí" : null,
      hayFirma ? "Firma: Sí" : null,
    ]
      .filter(Boolean)
      .join(" • ");
    const notaEntrega = `[${stampParts}]`;
    const nextNotas = pedido.notas ? `${pedido.notas} • ${notaEntrega}` : notaEntrega;

    try {
      const { error: updErr } = await supabase
        .from("whatsapp_orders")
        .update({
          estado: "entregado",
          courier: assignedCourier,
          notas: nextNotas,
        })
        .eq("id", pedido.id);

      if (updErr) throw updErr;

      // Descontar unidad física / consumir reserva en Inventario & Kárdex
      try {
        await syncOrderInventoryOnStatusChange({
          order: { ...pedido, courier: assignedCourier },
          prevEstado,
          nextEstado: "entregado",
          usuario: assignedCourier,
        });
      } catch (invErr) {
        console.warn("Error sincronizando inventario en entrega móvil:", invErr);
      }

      // Guardar foto de entrega y/o firma en Supabase Storage (orders-evidence)
      try {
        const firmaDataUrl =
          hayFirma && canvasRef.current ? canvasRef.current.toDataURL("image/png") : null;
        if (fotoEntrega || firmaDataUrl) {
          const [fotoUp, firmaUp] = await Promise.all([
            fotoEntrega
              ? uploadOrderDataUrlToBucket({
                  orderId: pedido.id,
                  kind: "entrega",
                  dataUrl: fotoEntrega,
                  fileName: `entrega-${String(pedido.id).slice(0, 8)}.jpg`,
                })
              : Promise.resolve(null),
            firmaDataUrl
              ? uploadOrderDataUrlToBucket({
                  orderId: pedido.id,
                  kind: "firma",
                  dataUrl: firmaDataUrl,
                  fileName: `firma-${String(pedido.id).slice(0, 8)}.png`,
                })
              : Promise.resolve(null),
          ]);

          await saveOrderEvidence(pedido.id, {
            ...(fotoUp?.ok && fotoUp.publicUrl ? { entregaUrl: fotoUp.publicUrl } : {}),
            ...(firmaUp?.ok && firmaUp.publicUrl ? { firmaUrl: firmaUp.publicUrl } : {}),
            deliveredAt: new Date().toISOString(),
            deliveredBy:
              driverSession?.courierName || pedido.courier || "Motorista Móvil",
          });
        }
      } catch (evErr) {
        console.warn("No se pudo guardar evidencia en orders-evidence:", evErr);
      }

      // Envío opcional de comprobante fotográfico por WhatsApp (Evolution API)
      if (fotoEntrega && enviarFotoCliente && pedido.telefono) {
        try {
          const waPhone = formatSvWaPhone(pedido.telefono);
          const prodLabel = getOrderProductLabel(pedido);
          await fetch("/api/send-message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contactPhone: waPhone,
              contactName: pedido.nombre_cliente || "Cliente",
              text: `✅ ¡Entrega completada, ${pedido.nombre_cliente || ""}! Tu pedido de *${prodLabel}* ha sido entregado. Adjuntamos tu comprobante fotográfico. ¡Gracias por tu compra! 🙌`,
              mediaBase64: fotoEntrega,
              mediaType: "image",
              fileName: `entrega-${String(pedido.id).slice(0, 8)}.jpg`,
              sendVideoAfterImage: false,
              pauseBot: false,
            }),
          });
        } catch (mediaErr) {
          console.warn("No se pudo enviar comprobante fotográfico por WhatsApp:", mediaErr);
        }
      }

      // Emitir evento al OS Event Store
      try {
        const { emitOsEvent } = await import("@/lib/osEvents");
        emitOsEvent({
          type: "order.delivered",
          source_table: "whatsapp_orders",
          source_id: pedido.id,
          payload: {
            order_id: pedido.id,
            total: pedido.total,
            cliente: pedido.nombre_cliente,
            repartidor: pedido.courier || "Motorista Móvil",
            cobro_tipo: cobroEtiqueta,
            foto_entrega: fotoEntrega ? "capturada" : "sin_foto",
            con_firma: hayFirma,
          },
        });
      } catch {}

      const updatedOrder = { ...pedido, estado: "entregado", courier: assignedCourier, notas: nextNotas };
      setPedido(updatedOrder);
      setTodosLosPedidos((prev) =>
        prev.map((item) => (item.id === pedido.id ? updatedOrder : item))
      );
      setExito(true);
    } catch (err: any) {
      console.error("Error confirmando entrega:", err);
      showToast("err", err?.message || "Error al confirmar la entrega.");
    } finally {
      setActualizando(false);
    }
  };

  // Cambio inteligente de defaults al seleccionar tipo de novedad
  const handleSelectTipoNovedad = (nuevoTipo: string) => {
    setTipoNovedad(nuevoTipo);
    setBoletinarEnListaNegra(MOTIVOS_BOLETINAR_DEFAULT.has(nuevoTipo));
    if (nuevoTipo !== "Cliente canceló / rechaza producto") {
      setCancelarPorRechazo(false);
    }
  };

  // Acción: Reportar Novedad
  const handleReportarNovedad = async () => {
    if (!pedido?.id) return;
    setEnviandoNovedad(true);

    try {
      const esReprogramacion = tipoNovedad === "Cliente pide reprogramar entrega";
      const esRechazo = tipoNovedad === "Cliente canceló / rechaza producto";
      const prevEstado = pedido.estado || "en_camino";

      const extraReprog = esReprogramacion && nuevaFechaReprogramar ? ` (Reprogramar: ${nuevaFechaReprogramar})` : "";
      const notaFinal = `[NOVEDAD REPARTIDOR ${todaySv} ${getElSalvadorTimeLabel()}]: ${tipoNovedad}${extraReprog}. ${notaNovedad}`.trim();
      const nextNotas = pedido.notas ? `${pedido.notas} • ${notaFinal}` : notaFinal;

      let nextEstado = prevEstado;
      if (esReprogramacion && moverAProgramado) {
        nextEstado = "programado";
      } else if (esRechazo && cancelarPorRechazo) {
        nextEstado = "cancelado";
      }

      const updatePayload: Record<string, any> = {
        motivo_cancelacion: tipoNovedad,
        notas: nextNotas,
      };
      if (esReprogramacion && nuevaFechaReprogramar) {
        updatePayload.fecha_programada = nuevaFechaReprogramar;
      }
      if (nextEstado !== prevEstado) {
        updatePayload.estado = nextEstado;
      }

      const { error: updErr } = await supabase
        .from("whatsapp_orders")
        .update(updatePayload)
        .eq("id", pedido.id);

      if (updErr) throw updErr;

      // Sincronizar Kárdex si cambió el estado (ej. cancelado o programado)
      if (nextEstado !== prevEstado) {
        try {
          await syncOrderInventoryOnStatusChange({
            order: pedido,
            prevEstado,
            nextEstado,
            usuario: pedido.courier || "Motorista Móvil",
          });
        } catch (invErr) {
          console.warn("Error sincronizando inventario en novedad:", invErr);
        }
      }

      // Boletinar cliente en la Lista Negra / DICOM interno si el motorista lo marcó
      if (boletinarEnListaNegra && pedido.telefono) {
        const prod = getOrderProductLabel(pedido);
        const dir = [pedido.direccion, pedido.municipio, pedido.departamento].filter(Boolean).join(", ") || "";

        addOrUpdateBlacklist({
          telefono: pedido.telefono,
          nombreCliente: pedido.nombre_cliente || "Cliente en Ruta",
          aliasNombres: pedido.nombre_cliente ? [pedido.nombre_cliente] : [],
          motivo: `[Reporte Motorista ${pedido.courier || "Móvil"}]: ${tipoNovedad}. ${notaNovedad}`.trim(),
          severidad: "alta",
          reportadoPor: pedido.courier || "Motorista en Ruta",
          fecha: new Date().toISOString(),
          pedidoId: pedido.id,
          producto: prod,
          direccion: dir,
        });
      }

      // Emitir evento de alerta
      try {
        const { emitOsEvent } = await import("@/lib/osEvents");
        emitOsEvent({
          type: "order.delivery_issue",
          source_table: "whatsapp_orders",
          source_id: pedido.id,
          payload: {
            order_id: pedido.id,
            cliente: pedido.nombre_cliente,
            tipo_novedad: tipoNovedad,
            notas: notaNovedad,
            nueva_fecha: esReprogramacion ? nuevaFechaReprogramar : null,
            nuevo_estado: nextEstado,
            boletinado: boletinarEnListaNegra,
          },
        });
      } catch {}

      const updatedOrder = { ...pedido, ...updatePayload };
      setTodosLosPedidos((prev) =>
        prev.map((item) => (item.id === pedido.id ? updatedOrder : item))
      );

      setMostrarNovedadModal(false);
      setNotaNovedad("");
      const extras: string[] = [];
      if (esReprogramacion && nuevaFechaReprogramar) extras.push(`reprogramado para ${nuevaFechaReprogramar}`);
      if (nextEstado === "cancelado") extras.push("marcado como cancelado");
      if (boletinarEnListaNegra) extras.push("boletinado en Lista Negra");

      showToast(
        "warn",
        `Novedad registrada${extras.length ? ` (${extras.join(", ")})` : ""}. Oficina notificada.`
      );
      setModoRuta(true);
      if (id) navigate("/repartidor");
    } catch (err: any) {
      console.error("Error registrando novedad:", err);
      showToast("err", err?.message || "No se pudo guardar la novedad.");
    } finally {
      setEnviandoNovedad(false);
    }
  };

  // Cálculo de cambio / vuelto
  const totalNum = Number(pedido?.total || 0);
  const pagaConNum = parseFloat(pagaCon || "0");
  const cambio = pagaConNum >= totalNum ? pagaConNum - totalNum : 0;

  // Filtrado estricto por courier seleccionado / autenticado
  const activeCourierName =
    driverSession?.role === "courier" && driverSession.courierName
      ? driverSession.courierName
      : courierSeleccionado;

  const pedidosDelCourier = useMemo(() => {
    if (activeCourierName === "Todos los Couriers") return todosLosPedidos;
    const target = activeCourierName.trim().toLowerCase();
    return todosLosPedidos.filter((p) => String(p.courier || "").trim().toLowerCase() === target);
  }, [todosLosPedidos, activeCourierName]);

  // Clasificación operativa del día (Tu Ruta = solo en_camino; entregadosHoy y novedades solo para KPIs y Cuadre)
  const { enRutaList, entregadosHoyList, novedadesList } = useMemo(() => {
    const enRuta: any[] = [];
    const entregadosHoy: any[] = [];
    const novedades: any[] = [];

    for (const p of pedidosDelCourier) {
      const est = p.estado || "";
      if (est === "entregado") {
        if (isDeliveredTodaySv(p, todaySv)) {
          entregadosHoy.push(p);
        }
      } else if (est === "en_camino") {
        enRuta.push(p);
        if (hasOrderIssue(p)) novedades.push(p);
      } else if (est === "cancelado") {
        if (getElSalvadorDateKey(p.updated_at || p.created_at) === todaySv && hasOrderIssue(p)) {
          novedades.push(p);
        }
      } else if (est !== "por_empacar" && hasOrderIssue(p)) {
        novedades.push(p);
      }
    }

    return {
      enRutaList: enRuta,
      entregadosHoyList: entregadosHoy,
      novedadesList: novedades,
    };
  }, [pedidosDelCourier, todaySv]);

  const kpisRuta = useMemo(() => {
    let efectivoHoy = 0;
    let transferenciasHoy = 0;

    for (const p of entregadosHoyList) {
      const monto = Number(p.total || 0);
      const kind = getOrderCobroKind(p);
      if (kind === "efectivo") {
        efectivoHoy += monto;
      } else {
        transferenciasHoy += monto;
      }
    }

    return {
      enRuta: enRutaList.length,
      entregadosHoy: entregadosHoyList.length,
      novedades: novedadesList.length,
      efectivoHoy,
      transferenciasHoy,
      totalRecaudadoHoy: efectivoHoy + transferenciasHoy,
    };
  }, [enRutaList, entregadosHoyList, novedadesList]);

  const tuRutaFiltrada = useMemo(() => {
    const q = busquedaRuta.trim().toLowerCase();
    if (!q) return enRutaList;

    return enRutaList.filter((p) => {
      const hay = [
        p.nombre_cliente,
        p.telefono,
        p.direccion,
        p.departamento,
        p.sku,
        p.producto,
        p.pedido_codigo,
        p.id,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [enRutaList, busquedaRuta]);

  const selectCourierOptions = useMemo(() => {
    if (
      courierSeleccionado !== "Todos los Couriers" &&
      !courierOptions.includes(courierSeleccionado)
    ) {
      return [courierSeleccionado, ...courierOptions];
    }
    return courierOptions;
  }, [courierOptions, courierSeleccionado]);

  const handleCopyCuadre = async () => {
    const labelCourier =
      activeCourierName === "Todos los Couriers" ? "Todos los Motoristas" : activeCourierName;
    const lines = [
      `🛵 *CUADRE DE RUTA — ${todaySv}*`,
      `Motorista: *${labelCourier}*`,
      `✅ Entregados hoy: ${kpisRuta.entregadosHoy}`,
      `💵 Efectivo a entregar a caja: *$${kpisRuta.efectivoHoy.toFixed(2)}*`,
      `🏦 Transferencias / Prepagados: *$${kpisRuta.transferenciasHoy.toFixed(2)}*`,
      `📦 Pendientes en ruta: ${kpisRuta.enRuta} | ⚠️ Novedades: ${kpisRuta.novedades}`,
      "",
      ...(entregadosHoyList.length > 0
        ? [
            "*Detalle de entregas:*",
            ...entregadosHoyList.slice(0, 25).map((p, idx) => {
              const kind = getOrderCobroKind(p);
              const tag = kind === "efectivo" ? "Efectivo" : kind === "transferencia" ? "Transfer" : "Pagado";
              return `${idx + 1}. ${p.nombre_cliente || "Cliente"} — $${Number(p.total || 0).toFixed(2)} (${tag})`;
            }),
          ]
        : ["Sin entregas completadas hoy todavía."]),
    ];

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCuadreCopiado(true);
      setTimeout(() => setCuadreCopiado(false), 2500);
    } catch {
      showToast("warn", "No se pudo copiar automáticamente al portapapeles.");
    }
  };

  const telHrefPedido = formatTelHref(pedido?.telefono);
  const direccionCodificada = encodeURIComponent(`${pedido?.direccion || ""}, El Salvador`);
  const urlWaze = `https://waze.com/ul?q=${direccionCodificada}`;
  const urlMaps = `https://www.google.com/maps/search/?api=1&query=${direccionCodificada}`;
  const mensajeWa = renderWhatsappTemplate(driverTemplate, pedido, {
    tiempo: tiempoEstimado,
  });
  const urlWa = buildDriverWaUrl(pedido);

  if (cargando) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-10 h-10 animate-spin mb-4 text-emerald-500" />
        <p className="font-bold text-sm tracking-wide">Cargando panel de repartidor...</p>
      </div>
    );
  }

  /* ========================================================================= */
  /* PANTALLA DE BLOQUEO POR PIN (si requirePin está activo en Sistema)        */
  /* ========================================================================= */
  if (driverAccess.requirePin && !driverSession) {
    const couriersConPin = couriers.filter((c) => c.activo !== false);

    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 sm:p-6">
        <form
          onSubmit={handlePinSubmit}
          className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5"
        >
          <div className="text-center space-y-2">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center mx-auto text-emerald-400">
              <KeyRound size={26} />
            </div>
            <h1 className="text-lg font-black uppercase tracking-tight">Portal Repartidores</h1>
            <p className="text-xs text-slate-400 leading-snug">
              {id
                ? "Ingresa tu PIN de motorista o PIN Maestro para confirmar la entrega del QR escaneado."
                : "Ingresa tu PIN asignado para ver tu hoja de ruta y cobros del día."}
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                ¿Quién ingresa?
              </label>
              <select
                value={loginTarget}
                onChange={(e) => {
                  setLoginTarget(e.target.value);
                  setPinError(null);
                }}
                className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs font-bold outline-none text-white focus:border-emerald-500"
              >
                <option value="auto">Detectar automáticamente por PIN</option>
                <option value="admin">Supervisor / Admin (Ver todos)</option>
                {couriersConPin.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} {c.pin ? "" : "(Sin PIN aún)"}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1">
                PIN Numérico (4 a 6 dígitos)
              </label>
              <div className="relative">
                <input
                  type={showPin ? "text" : "password"}
                  inputMode="numeric"
                  maxLength={6}
                  autoFocus
                  value={pinInput}
                  onChange={(e) => {
                    setPinInput(e.target.value.replace(/\D/g, ""));
                    setPinError(null);
                  }}
                  placeholder="••••"
                  className="w-full p-3 pr-10 rounded-xl border border-slate-800 bg-slate-950 text-center text-xl tracking-[0.45em] font-mono font-black outline-none text-white focus:border-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPin((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
                  tabIndex={-1}
                >
                  {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {pinError && (
              <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs font-semibold text-center">
                {pinError}
              </div>
            )}

            <button
              type="submit"
              className="w-full py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/25 transition-all"
            >
              <Lock size={15} /> Desbloquear Ruta
            </button>
          </div>

          <p className="text-[10px] text-slate-500 text-center leading-snug pt-2 border-t border-slate-800">
            Los PIN se configuran en <strong className="text-slate-300">Sistema → Couriers & Envíos</strong>.
          </p>
        </form>
      </div>
    );
  }

  /* ========================================================================= */
  /* VISTA 1: MI HOJA DE RUTA DE HOY                                           */
  /* ========================================================================= */
  if (modoRuta) {
    const isCourierLocked = driverSession?.role === "courier" && Boolean(driverSession.courierName);

    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col p-4 sm:p-6 max-w-lg mx-auto">
        {/* Cabecera */}
        <div className="flex items-center justify-between gap-2 pb-4 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <Truck className="text-emerald-400" size={20} />
              <h1 className="text-lg font-black tracking-tight uppercase">Mi Ruta de Hoy</h1>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Operación El Salvador · {todaySv}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMostrarCuadreModal(true)}
              className="px-3 py-2 rounded-xl bg-emerald-600/20 border border-emerald-500/40 hover:bg-emerald-600/30 text-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-colors"
              title="Ver resumen de cuadre y efectivo del día"
            >
              <ClipboardList size={14} /> Cuadre
            </button>

            <button
              type="button"
              onClick={() => cargarDatos()}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300"
              title="Recargar ruta"
            >
              <RotateCcw size={15} />
            </button>

            {driverAccess.requirePin && (
              <button
                type="button"
                onClick={handleLockPortal}
                className="p-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-rose-500/20 hover:border-rose-500/40 text-slate-300 hover:text-rose-300"
                title="Cerrar sesión / Cambiar PIN"
              >
                <LogOut size={15} />
              </button>
            )}
          </div>
        </div>

        {/* Toast flotante / inline */}
        {toastInfo && (
          <div
            className={`mt-4 p-3 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
              toastInfo.tipo === "ok"
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                : toastInfo.tipo === "err"
                ? "bg-rose-500/15 border-rose-500/40 text-rose-200"
                : "bg-amber-500/15 border-amber-500/40 text-amber-200"
            }`}
          >
            <span>{toastInfo.texto}</span>
            <button onClick={() => setToastInfo(null)} className="opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Selector de Courier + Buscador */}
        <div className="mt-4 grid grid-cols-1 gap-2.5">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-[10px] uppercase font-bold text-slate-400">
                Motorista / Courier:
              </label>
              {isCourierLocked && (
                <span className="text-[10px] font-bold text-emerald-400 flex items-center gap-1">
                  <Lock size={10} /> Sesión exclusiva
                </span>
              )}
            </div>
            {isCourierLocked ? (
              <div className="w-full p-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-200 flex items-center justify-between">
                <span>{driverSession?.courierName}</span>
                <button
                  type="button"
                  onClick={handleLockPortal}
                  className="text-[10px] underline text-emerald-300 hover:text-white"
                >
                  Cambiar usuario
                </button>
              </div>
            ) : (
              <select
                value={courierSeleccionado}
                onChange={(e) => handleCourierChange(e.target.value)}
                className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-900 text-xs font-bold outline-none text-white focus:border-emerald-500"
              >
                <option value="Todos los Couriers">Todos los Motoristas</option>
                {selectCourierOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              value={busquedaRuta}
              onChange={(e) => setBusquedaRuta(e.target.value)}
              placeholder="Buscar cliente, teléfono, zona o código..."
              className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-slate-800 bg-slate-900 text-xs text-white placeholder:text-slate-500 outline-none focus:border-emerald-500"
            />
            {busquedaRuta && (
              <button
                type="button"
                onClick={() => setBusquedaRuta("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {/* Tarjetas de Resumen del Día */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">En Ruta</span>
            <span className="text-xl font-black text-amber-400 mt-0.5 block">{kpisRuta.enRuta}</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">Entregados Hoy</span>
            <span className="text-xl font-black text-emerald-400 mt-0.5 block">{kpisRuta.entregadosHoy}</span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">Efectivo Mano</span>
            <span className="text-base font-black text-emerald-400 font-mono mt-1 block">
              ${kpisRuta.efectivoHoy.toFixed(2)}
            </span>
          </div>

          <div className="p-3 rounded-2xl bg-slate-900 border border-slate-800 text-center">
            <span className="text-[9px] uppercase font-bold text-slate-400 block">Transfer / Pagado</span>
            <span className="text-base font-black text-sky-400 font-mono mt-1 block">
              ${kpisRuta.transferenciasHoy.toFixed(2)}
            </span>
          </div>
        </div>

        {/* Columna Única: Tu Ruta */}
        <div className="mt-5 space-y-3 flex-1 pb-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-300">
              Tu Ruta ({tuRutaFiltrada.length})
            </h2>
            {!isCourierLocked && (
              <button
                type="button"
                onClick={() => navigate("/pedidos")}
                className="text-[11px] text-emerald-400 font-bold hover:underline"
              >
                Ir a Pedidos OS →
              </button>
            )}
          </div>

          {tuRutaFiltrada.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-900/60 rounded-2xl border border-slate-800">
              {busquedaRuta
                ? "No hay paquetes que coincidan con tu búsqueda."
                : "No tienes paquetes pendientes en tu ruta por ahora."}
            </div>
          ) : (
            tuRutaFiltrada.map((p) => {
              const entregado = p.estado === "entregado";
              const novedad = hasOrderIssue(p);
              const prepagado = isOrderPrepaid(p);
              const cobroKind = getOrderCobroKind(p);
              const risk = evaluateCustomerRisk(p.telefono, todosLosPedidos);
              const avisado =
                notificadosWaIds[p.id] ||
                String(p.notas || "").includes("[Aviso llegada");
              const wazeQuickUrl = `https://waze.com/ul?q=${encodeURIComponent(
                `${p.direccion || ""}, El Salvador`
              )}`;

              return (
                <div
                  key={p.id}
                  onClick={() => openOrderForDelivery(p)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    entregado
                      ? "bg-slate-900/50 border-slate-800/80"
                      : novedad
                      ? "bg-slate-900 border-amber-500/40 shadow-lg"
                      : "bg-slate-900 border-slate-800 hover:border-emerald-500/50 shadow-lg"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-mono font-bold text-slate-400">
                          {p.pedido_codigo || `#${String(p.id).slice(0, 8).toUpperCase()}`}
                        </span>
                        {risk.nivelRiesgo === "rojo" && (
                          <span className="px-1.5 py-0.5 rounded-md bg-rose-500/20 border border-rose-500/40 text-rose-300 text-[9px] font-bold">
                            ⚠️ Riesgo Alto
                          </span>
                        )}
                        {risk.nivelRiesgo === "amarillo" && (
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[9px] font-bold">
                            Precaución
                          </span>
                        )}
                        {novedad && !entregado && (
                          <span className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[9px] font-bold">
                            Novedad
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-sm text-white leading-tight mt-1 truncate">
                        {p.nombre_cliente || "Sin nombre"}
                      </h3>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-base font-black font-mono text-emerald-400 block">
                        ${Number(p.total || 0).toFixed(2)}
                      </span>
                      <span className="text-[9px] font-bold text-slate-400">
                        {entregado
                          ? cobroKind === "efectivo"
                            ? "💵 Efectivo"
                            : cobroKind === "transferencia"
                            ? "🏦 Transfer."
                            : "✓ Prepagado"
                          : prepagado
                          ? "✓ Ya pagado"
                          : "💰 Contra entrega"}
                      </span>
                    </div>
                  </div>

                  <p className="text-xs text-slate-300 mt-2 flex items-start gap-1.5 leading-snug">
                    <MapPin size={13} className="text-slate-400 shrink-0 mt-0.5" />
                    <span>
                      {p.direccion || "Sin dirección"}
                      {p.departamento ? ` · ${p.departamento}` : ""}
                    </span>
                  </p>

                  <div className="mt-3 pt-2.5 border-t border-slate-800 flex items-center justify-between gap-2 text-xs">
                    <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1 truncate">
                      <Package size={12} className="shrink-0" />
                      <span className="truncate">{getOrderProductLabel(p)}</span>
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {!entregado && p.telefono && (
                        <a
                          href={buildDriverWaUrl(p)}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => handleAvisarLlegadaEvolution(p)}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border flex items-center gap-1 transition-colors ${
                            avisado
                              ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-300"
                              : "bg-slate-800 border-slate-700 hover:bg-emerald-600 hover:border-emerald-500 text-slate-200 hover:text-white"
                          }`}
                          title={
                            avisado
                              ? "Aviso por Evolution ya enviado (máx. 1 vez). Toca para abrir tu WhatsApp."
                              : "Notifica 1 vez por Evolution y abre tu WhatsApp listo para enviar"
                          }
                        >
                          {sendingWaId === p.id ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : avisado ? (
                            <Check size={11} />
                          ) : (
                            <Send size={11} />
                          )}
                          {avisado ? "WhatsApp ✓" : "Voy llegando"}
                        </a>
                      )}

                      {!entregado && p.direccion && (
                        <a
                          href={wazeQuickUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded-lg bg-sky-600/20 border border-sky-500/30 text-sky-300 hover:bg-sky-600/30"
                          title="Abrir en Waze"
                        >
                          <Compass size={12} />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* MODAL: CUADRE / CIERRE DEL DÍA */}
        {mostrarCuadreModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
            onClick={() => setMostrarCuadreModal(false)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 text-white shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
              <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
                <div className="flex items-center gap-2 text-emerald-400">
                  <ClipboardList size={18} />
                  <div>
                    <h3 className="font-bold text-sm text-white">Cuadre de Ruta · {todaySv}</h3>
                    <p className="text-[10px] text-slate-400">
                      {courierSeleccionado === "Todos los Couriers"
                        ? "Todos los motoristas"
                        : courierSeleccionado}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarCuadreModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="p-4 space-y-3 overflow-y-auto">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="p-3 rounded-2xl bg-emerald-950/30 border border-emerald-500/30">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 block">
                      💵 Efectivo a Entregar
                    </span>
                    <span className="text-2xl font-black font-mono text-white mt-0.5 block">
                      ${kpisRuta.efectivoHoy.toFixed(2)}
                    </span>
                  </div>

                  <div className="p-3 rounded-2xl bg-sky-950/30 border border-sky-500/30">
                    <span className="text-[10px] uppercase font-bold text-sky-400 block">
                      🏦 Transferencias / Ya Pagado
                    </span>
                    <span className="text-2xl font-black font-mono text-white mt-0.5 block">
                      ${kpisRuta.transferenciasHoy.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center bg-slate-950 p-3 rounded-2xl border border-slate-800">
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Entregados</span>
                    <span className="text-base font-black text-emerald-400">{kpisRuta.entregadosHoy}</span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">En Ruta</span>
                    <span className="text-base font-black text-amber-400">{kpisRuta.enRuta}</span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold text-slate-400 block">Novedades</span>
                    <span className="text-base font-black text-rose-400">{kpisRuta.novedades}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Entregas Completadas Hoy ({entregadosHoyList.length})
                  </span>
                  {entregadosHoyList.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center bg-slate-950 rounded-xl border border-slate-800">
                      Todavía no hay paquetes entregados hoy.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                      {entregadosHoyList.map((p) => {
                        const kind = getOrderCobroKind(p);
                        return (
                          <div
                            key={p.id}
                            className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-bold text-white truncate">
                                {p.nombre_cliente || "Cliente"}
                              </p>
                              <p className="text-[10px] text-slate-400 truncate">
                                {p.pedido_codigo || `#${String(p.id).slice(0, 8)}`} ·{" "}
                                {kind === "efectivo"
                                  ? "Efectivo"
                                  : kind === "transferencia"
                                  ? "Transferencia"
                                  : "Prepagado"}
                              </p>
                            </div>
                            <span className="font-mono font-bold text-emerald-400 shrink-0">
                              ${Number(p.total || 0).toFixed(2)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 border-t border-slate-800 bg-slate-950 flex gap-2">
                <button
                  type="button"
                  onClick={() => setMostrarCuadreModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-800 text-xs font-bold text-slate-400 hover:text-white"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={handleCopyCuadre}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors"
                >
                  {cuadreCopiado ? <Check size={14} /> : <Copy size={14} />}
                  {cuadreCopiado ? "¡Resumen Copiado!" : "Copiar Resumen de Cuadre"}
                </button>
              </div>
            </div>
          </div>
        )}
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
        <p className="text-xs mt-1 text-slate-400">
          El código escaneado puede ser inválido o el pedido ya fue retirado.
        </p>
        <button
          type="button"
          onClick={() => {
            setModoRuta(true);
            if (id) navigate("/repartidor");
          }}
          className="mt-5 px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-xs font-bold"
        >
          Ver Mi Ruta del Día
        </button>
      </div>
    );
  }

  const esPrepagado = isOrderPrepaid(pedido);
  const esContraEntrega = !esPrepagado;
  const yaEntregado = pedido.estado === "entregado";
  const yaAvisado =
    notificadosWaIds[pedido.id] || String(pedido.notas || "").includes("[Aviso llegada");
  const riskPedido = evaluateCustomerRisk(pedido.telefono, todosLosPedidos);

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
            type="button"
            onClick={() => {
              setModoRuta(true);
              if (id) navigate("/repartidor");
            }}
            className="p-1.5 rounded-xl hover:bg-slate-900 text-slate-400 flex items-center gap-1 text-xs font-bold"
          >
            <ArrowLeft size={16} /> Volver a Ruta
          </button>

          <span className="font-mono font-bold text-xs text-slate-400">
            {pedido.pedido_codigo || `#${String(pedido.id).slice(0, 8).toUpperCase()}`}
          </span>
        </div>

        {/* Toast inline en vista de entrega */}
        {toastInfo && (
          <div
            className={`mx-4 mt-4 p-3 rounded-xl border text-xs font-bold flex items-center justify-between gap-2 ${
              toastInfo.tipo === "ok"
                ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-200"
                : toastInfo.tipo === "err"
                ? "bg-rose-500/15 border-rose-500/40 text-rose-200"
                : "bg-amber-500/15 border-amber-500/40 text-amber-200"
            }`}
          >
            <span>{toastInfo.texto}</span>
            <button onClick={() => setToastInfo(null)} className="opacity-70 hover:opacity-100">
              <X size={14} />
            </button>
          </div>
        )}

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
                ? `Entrega registrada (${esPrepagado ? "Prepagado" : cobroTipo === "transferencia" ? "Transferencia" : "Efectivo"}).`
                : "Este pedido ya fue completado previamente."}
            </p>

            {fotoEntrega && (
              <div className="w-24 h-24 rounded-xl border border-slate-800 overflow-hidden mb-6">
                <img src={fotoEntrega} alt="Foto de entrega" className="w-full h-full object-cover" />
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                resetDeliveryFormState();
                setModoRuta(true);
                if (id) navigate("/repartidor");
              }}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 rounded-2xl transition-colors text-xs uppercase tracking-wider"
            >
              Ir al Siguiente Paquete →
            </button>
          </div>
        ) : (
          /* FORMULARIO DE ACCIÓN EN CALLE */
          <div className="p-5 space-y-4">
            {/* Alerta de Riesgo si aplica */}
            {riskPedido.nivelRiesgo === "rojo" && (
              <div className="p-3 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-200 text-xs flex items-start gap-2">
                <ShieldAlert size={16} className="text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold block">Cliente con Alerta / Lista Negra</span>
                  <span className="text-[11px] opacity-90">
                    {riskPedido.motivoListaNegra || "Verifica pago completo antes de entregar el paquete."}
                  </span>
                </div>
              </div>
            )}

            {/* Recuadro de Cobro Destacado */}
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-center">
              <span
                className={`text-[10px] font-bold uppercase tracking-widest ${
                  esContraEntrega ? "text-amber-400" : "text-emerald-400"
                }`}
              >
                {esContraEntrega ? "💰 Cobrar Contra Entrega" : "✓ Pedido Ya Pagado / Transferencia Previa"}
              </span>
              <div className="text-3xl font-black font-mono mt-1 text-white">
                ${Number(pedido.total || 0).toFixed(2)}{" "}
                <span className="text-xs font-normal text-slate-500">USD</span>
              </div>

              {esContraEntrega && (
                <>
                  <div className="grid grid-cols-2 gap-1.5 mt-3">
                    <button
                      type="button"
                      onClick={() => setCobroTipo("efectivo")}
                      className={`py-2 px-2.5 rounded-xl text-[11px] font-bold border flex items-center justify-center gap-1.5 transition-colors ${
                        cobroTipo === "efectivo"
                          ? "bg-emerald-600/20 border-emerald-500 text-emerald-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      <Wallet size={13} /> Efectivo
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCobroTipo("transferencia");
                        setMostrarCalculadora(false);
                      }}
                      className={`py-2 px-2.5 rounded-xl text-[11px] font-bold border flex items-center justify-center gap-1.5 transition-colors ${
                        cobroTipo === "transferencia"
                          ? "bg-sky-600/20 border-sky-500 text-sky-300"
                          : "bg-slate-900 border-slate-800 text-slate-400"
                      }`}
                    >
                      <Landmark size={13} /> Transferencia
                    </button>
                  </div>

                  {cobroTipo === "efectivo" && (
                    <button
                      type="button"
                      onClick={() => setMostrarCalculadora(!mostrarCalculadora)}
                      className="mt-2.5 text-xs font-bold text-emerald-400 hover:underline flex items-center justify-center gap-1 mx-auto"
                    >
                      <Calculator size={13} />{" "}
                      {mostrarCalculadora ? "Ocultar Calculadora" : "Calcular Cambio / Vuelto"}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Calculadora de Vuelto Desplegable */}
            {mostrarCalculadora && esContraEntrega && cobroTipo === "efectivo" && (
              <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-2">
                <span className="text-[10px] uppercase font-bold text-slate-400 block">
                  ¿Con cuánto paga el cliente?
                </span>
                <div className="grid grid-cols-4 gap-1.5">
                  {[5, 10, 20, 50].map((monto) => (
                    <button
                      key={monto}
                      type="button"
                      onClick={() => setPagaCon(String(monto))}
                      className={`py-1.5 rounded-lg text-xs font-mono font-bold border ${
                        pagaCon === String(monto)
                          ? "bg-emerald-600 border-emerald-500 text-white"
                          : "bg-slate-900 border-slate-800 text-slate-300"
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
                    onChange={(e) => setPagaCon(e.target.value)}
                    className="flex-1 p-2 bg-slate-900 border border-slate-800 rounded-xl text-xs font-mono font-bold outline-none text-white focus:border-emerald-500"
                  />
                </div>

                {pagaConNum > 0 && (
                  <div className="p-2.5 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-center">
                    <span className="text-[10px] uppercase font-bold text-emerald-400 block">
                      {pagaConNum >= totalNum ? "Dar de Cambio / Vuelto:" : "Falta por completar:"}
                    </span>
                    <span className="text-2xl font-black font-mono text-emerald-400">
                      ${Math.abs(pagaConNum >= totalNum ? cambio : totalNum - pagaConNum).toFixed(2)} USD
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
                  <p className="text-sm font-bold text-white truncate">
                    {pedido.nombre_cliente || "Sin nombre"}
                  </p>
                  {pedido.telefono && (
                    <span className="text-[11px] font-mono text-slate-400">{pedido.telefono}</span>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-slate-900 text-slate-400 mt-0.5">
                  <MapPin size={16} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Dirección de Entrega
                  </span>
                  <p className="text-xs text-slate-200 leading-snug">
                    {pedido.direccion || "Sin dirección registrada"}
                  </p>
                  {pedido.departamento && (
                    <span className="text-[10px] text-emerald-400 font-semibold block mt-0.5">
                      📍 {pedido.departamento}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="p-2 rounded-xl bg-slate-900 text-slate-400 mt-0.5">
                  <Package size={16} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Producto / SKU
                  </span>
                  <p className="text-xs font-mono font-bold text-white break-words">
                    {getOrderProductLabel(pedido)}
                  </p>
                </div>
              </div>

              {pedido.notas && (
                <div className="p-2.5 bg-slate-900 rounded-xl border border-slate-800 text-xs text-slate-300">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">
                    Nota del pedido:
                  </span>
                  <p className="text-[11px] mt-0.5 italic break-words">{pedido.notas}</p>
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

            {/* SELECTOR RÁPIDO DE TIEMPO + COMUNICACIÓN */}
            <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase font-bold text-slate-400 flex items-center gap-1">
                  <Clock size={12} className="text-emerald-400" /> Tiempo estimado de llegada:
                </span>
                <span className="text-[10px] font-bold text-emerald-400">
                  {DRIVER_TIME_PRESETS.find((t) => t.value === tiempoEstimado)?.label || tiempoEstimado}
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {DRIVER_TIME_PRESETS.map((preset) => {
                  const active = tiempoEstimado === preset.value;
                  return (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setTiempoEstimado(preset.value)}
                      className={`px-2.5 py-2 rounded-xl text-[11px] font-bold border transition-all flex-1 min-w-[72px] text-center ${
                        active
                          ? "bg-emerald-600 border-emerald-500 text-white shadow"
                          : "bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700"
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              <p className="text-[11px] text-slate-400 bg-slate-900/80 border border-slate-800 rounded-xl p-2.5 leading-snug italic">
                “{mensajeWa}”
              </p>

              <div className="grid grid-cols-2 gap-2 pt-0.5">
                {telHrefPedido ? (
                  <a
                    href={telHrefPedido}
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
                    onClick={() => handleAvisarLlegadaEvolution(pedido)}
                    className={`py-3 px-3 rounded-2xl font-bold text-xs flex items-center justify-center gap-1.5 shadow transition-colors ${
                      yaAvisado
                        ? "bg-emerald-600/20 border border-emerald-500/40 text-emerald-300"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    }`}
                  >
                    {sendingWaId === pedido.id ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : yaAvisado ? (
                      <Check size={15} />
                    ) : (
                      <MessageCircle size={15} />
                    )}
                    {yaAvisado ? "Abrir WhatsApp ✓" : "Avisar Llegada"}
                  </a>
                ) : (
                  <div className="py-3 px-3 rounded-2xl bg-slate-800/50 text-slate-500 font-bold text-xs text-center border border-slate-800">
                    Sin WhatsApp
                  </div>
                )}
              </div>

              {urlWa && (
                <p className="text-[10px] text-slate-500 text-center leading-snug">
                  {yaAvisado
                    ? "El aviso automático de tienda ya se envió (solo 1 vez, sin spam). Tocar de nuevo solo abre tu WhatsApp."
                    : "Envía 1 aviso automático desde el número de tienda (Evolution) y abre tu WhatsApp listo con los datos."}
                </p>
              )}
            </div>

            {/* PRUEBA DE ENTREGA: FOTO Y FIRMA */}
            <div className="p-3.5 bg-slate-950 border border-slate-800 rounded-2xl space-y-3">
              <span className="text-[10px] uppercase font-bold text-slate-400 block">
                Prueba de Entrega (Opcional):
              </span>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-bold text-slate-200 flex items-center justify-center gap-1.5"
                >
                  <Camera size={14} className="text-emerald-400" />{" "}
                  {fotoEntrega ? "Foto Tomada ✓" : "Tomar Foto"}
                </button>

                <button
                  type="button"
                  onClick={() => setMostrarFirma(!mostrarFirma)}
                  className="flex-1 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:bg-slate-800 text-xs font-bold text-slate-200 flex items-center justify-center gap-1.5"
                >
                  <Edit3 size={14} className="text-indigo-400" />{" "}
                  {hayFirma ? "Firma Lista ✓" : "Firma en Pantalla"}
                </button>
              </div>

              {fotoEntrega && (
                <div className="flex items-center gap-3 pt-1">
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-800 shrink-0">
                    <img src={fotoEntrega} alt="Preview" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => {
                        setFotoEntrega(null);
                        setEnviarFotoCliente(false);
                      }}
                      className="absolute top-1 right-1 p-1 bg-black/70 rounded-full text-white"
                    >
                      <X size={10} />
                    </button>
                  </div>

                  {pedido.telefono && (
                    <label className="flex items-start gap-2 text-[11px] text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={enviarFotoCliente}
                        onChange={(e) => setEnviarFotoCliente(e.target.checked)}
                        className="mt-0.5 accent-emerald-500 rounded cursor-pointer"
                      />
                      <span>Enviar esta foto como comprobante al cliente por WhatsApp</span>
                    </label>
                  )}
                </div>
              )}

              {mostrarFirma && (
                <div className="space-y-2 pt-1 border-t border-slate-800">
                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-bold">
                    <span>El cliente firma aquí con el dedo:</span>
                    <button type="button" onClick={limpiarFirma} className="text-rose-400 hover:underline">
                      Borrar trazo
                    </button>
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
                    className="w-full h-[130px] bg-white rounded-xl touch-none border border-slate-700 cursor-crosshair"
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
                onClick={() => {
                  handleSelectTipoNovedad("Cliente no contestó llamadas/mensajes");
                  setMostrarNovedadModal(true);
                }}
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
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setMostrarNovedadModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-3xl border border-slate-800 bg-slate-900 text-white shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
          >
            <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
              <div className="flex items-center gap-2 text-rose-400">
                <AlertTriangle size={18} />
                <h3 className="font-bold text-sm">Reportar Novedad en Ruta</h3>
              </div>
              <button type="button" onClick={() => setMostrarNovedadModal(false)} className="p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5">
                  ¿Por qué no se pudo entregar?
                </label>
                <select
                  value={tipoNovedad}
                  onChange={(e) => handleSelectTipoNovedad(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs font-semibold outline-none text-white focus:border-rose-500"
                >
                  <option value="Cliente no contestó llamadas/mensajes">
                    Cliente no contestó llamadas/mensajes
                  </option>
                  <option value="Cliente pide reprogramar entrega">
                    Cliente pide reprogramar entrega
                  </option>
                  <option value="Cliente sin efectivo completo">
                    Cliente sin efectivo completo
                  </option>
                  <option value="Dirección incorrecta o inaccesible">
                    Dirección incorrecta o inaccesible
                  </option>
                  <option value="Cliente canceló / rechaza producto">
                    Cliente canceló / rechaza producto
                  </option>
                </select>
              </div>

              {/* Reprogramar fecha si el cliente lo solicitó */}
              {tipoNovedad === "Cliente pide reprogramar entrega" && (
                <div className="p-3 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 space-y-2.5">
                  <div className="flex items-center gap-1.5 text-indigo-300 text-xs font-bold">
                    <Calendar size={14} /> Nueva fecha acordada
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setNuevaFechaReprogramar(addDaysSv(1))}
                      className={`py-1.5 rounded-lg text-[11px] font-bold border ${
                        nuevaFechaReprogramar === addDaysSv(1)
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "bg-slate-950 border-slate-800 text-slate-300"
                      }`}
                    >
                      Mañana
                    </button>
                    <button
                      type="button"
                      onClick={() => setNuevaFechaReprogramar(addDaysSv(2))}
                      className={`py-1.5 rounded-lg text-[11px] font-bold border ${
                        nuevaFechaReprogramar === addDaysSv(2)
                          ? "bg-indigo-600 border-indigo-500 text-white"
                          : "bg-slate-950 border-slate-800 text-slate-300"
                      }`}
                    >
                      Pasado mañana
                    </button>
                  </div>
                  <input
                    type="date"
                    value={nuevaFechaReprogramar}
                    onChange={(e) => setNuevaFechaReprogramar(e.target.value)}
                    className="w-full p-2 rounded-xl border border-slate-800 bg-slate-950 text-xs text-white outline-none focus:border-indigo-500"
                  />
                  <label className="flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={moverAProgramado}
                      onChange={(e) => setMoverAProgramado(e.target.checked)}
                      className="accent-indigo-500 rounded cursor-pointer"
                    />
                    Mover a columna "Encargos / Programados"
                  </label>
                </div>
              )}

              {/* Opción de cancelar en Kárdex si rechazó en la puerta */}
              {tipoNovedad === "Cliente canceló / rechaza producto" && (
                <label className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-2.5 text-[11px] text-rose-200 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={cancelarPorRechazo}
                    onChange={(e) => setCancelarPorRechazo(e.target.checked)}
                    className="mt-0.5 accent-rose-500 rounded cursor-pointer"
                  />
                  <span>
                    <strong className="block text-white">Marcar pedido como Cancelado ahora</strong>
                    Libera automáticamente las unidades reservadas de vuelta al Kárdex.
                  </span>
                </label>
              )}

              <div>
                <label className="block text-[10px] uppercase font-bold text-slate-400 mb-1.5">
                  Nota del repartidor (Opcional):
                </label>
                <textarea
                  rows={2}
                  value={notaNovedad}
                  onChange={(e) => setNotaNovedad(e.target.value)}
                  placeholder="Ej. Estuve 15 minutos en el portón pero no salió nadie..."
                  className="w-full p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-xs outline-none text-white focus:border-rose-500 resize-none"
                />
              </div>

              {/* Checkbox para boletinar en la Lista Negra / DICOM */}
              <div
                onClick={() => setBoletinarEnListaNegra(!boletinarEnListaNegra)}
                className={`p-3 rounded-2xl border cursor-pointer transition-all flex items-start gap-2.5 select-none ${
                  boletinarEnListaNegra
                    ? "border-rose-500/50 bg-rose-500/10 text-rose-300"
                    : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700"
                }`}
              >
                <input
                  type="checkbox"
                  checked={boletinarEnListaNegra}
                  onChange={(e) => setBoletinarEnListaNegra(e.target.checked)}
                  onClick={(e) => e.stopPropagation()}
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
