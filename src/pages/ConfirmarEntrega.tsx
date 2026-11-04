import { useEffect, useState } from "react";
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
  AlertTriangle
} from "lucide-react";

export function ConfirmarEntregaPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cargando, setCargando] = useState(true);
  const [pedido, setPedido] = useState<any>(null);
  const [actualizando, setActualizando] = useState(false);
  const [exito, setExito] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.from("whatsapp_orders").select("*").eq("id", id).single().then(({ data }) => {
      setPedido(data);
      setCargando(false);
    });
  }, [id]);

  const handleEntregar = async () => {
    if (!id) return;
    setActualizando(true);
    await supabase.from("whatsapp_orders").update({ estado: "entregado" }).eq("id", id);
    setActualizando(false);
    setExito(true);
  };

  const telefonoLimpio = (pedido?.telefono ?? "").replace(/\D/g, "");
  const mensajeWa = `Hola ${pedido?.nombre_cliente || ""}, soy el repartidor de To2en1.app. Estoy llegando a tu dirección para entregar tu pedido.`;
  const urlWa = telefonoLimpio ? `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(mensajeWa)}` : undefined;

  if (cargando) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center text-gray-800">
        <Loader2 className="w-10 h-10 animate-spin mb-4 text-indigo-600" />
        <p className="font-bold">Cargando datos del pedido...</p>
      </div>
    );
  }

  if (!pedido) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center text-red-600 p-6 text-center">
        <AlertTriangle className="w-16 h-16 mb-4" />
        <h1 className="text-2xl font-black">Pedido no encontrado</h1>
        <p className="text-sm mt-2 text-gray-600">El enlace puede ser inválido o el pedido fue eliminado.</p>
        <button onClick={() => navigate("/pedidos")} className="mt-6 text-indigo-600 font-bold hover:underline">
          Volver al panel
        </button>
      </div>
    );
  }

  const esContraEntrega = (pedido.metodo_pago ?? "").toLowerCase().includes("contra");
  const yaEntregado = pedido.estado === "entregado";

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 sm:p-6">
      
      {/* Contenedor Principal (Tipo App Móvil) */}
      <div className="w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">
        
        {/* Header con Branding */}
        <div className="bg-slate-900 p-5 text-white text-center">
          <h1 className="text-xl font-black tracking-widest uppercase">To2en1.app</h1>
          <p className="text-[10px] opacity-70 mt-1 uppercase tracking-widest">Panel de Repartidor</p>
        </div>

        {exito || yaEntregado ? (
          <div className="p-8 flex flex-col items-center text-center">
            <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="w-14 h-14 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-black text-gray-900">
              {exito ? "¡Pedido Entregado!" : "Pedido ya Entregado"}
            </h2>
            <p className="text-sm text-gray-500 mt-2 mb-8">
              {exito 
                ? "El estado se ha actualizado correctamente en el sistema." 
                : "Este pedido ya fue marcado como entregado anteriormente."}
            </p>
            
            <button 
              onClick={() => navigate("/pedidos")} 
              className="w-full bg-slate-900 text-white font-bold py-3 rounded-xl hover:bg-slate-800 transition-colors"
            >
              Volver al panel
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-5">
            
            {/* ID del pedido */}
            <div className="text-center pb-2 border-b border-gray-100">
              <p className="text-xs text-gray-400 font-bold uppercase tracking-wider">Pedido</p>
              <p className="font-mono font-black text-gray-800 text-lg">#{pedido.id.slice(0, 8).toUpperCase()}</p>
            </div>

            {/* Datos del Cliente */}
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="bg-gray-100 p-2 rounded-full mt-0.5">
                  <User className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-bold uppercase">Cliente</p>
                  <p className="text-sm font-semibold text-gray-900">{pedido.nombre_cliente}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="bg-gray-100 p-2 rounded-full mt-0.5">
                  <MapPin className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-bold uppercase">Dirección de entrega</p>
                  <p className="text-sm font-semibold text-gray-900 leading-tight">{pedido.direccion}</p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="bg-gray-100 p-2 rounded-full mt-0.5">
                  <Package className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-bold uppercase">Producto</p>
                  <p className="text-sm font-semibold text-gray-900">{pedido.sku}</p>
                </div>
              </div>
            </div>

            {/* Botón de WhatsApp para el repartidor */}
            {telefonoLimpio && (
              <a
                href={urlWa}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl transition-colors text-sm"
              >
                <MessageCircle className="w-4 h-4 text-emerald-600" />
                Contactar al cliente
              </a>
            )}

            {/* Recuadro de Pago */}
            <div className={`p-4 rounded-xl border-2 text-center ${esContraEntrega ? 'border-amber-400 bg-amber-50' : 'border-emerald-400 bg-emerald-50'}`}>
              <p className={`text-xs font-bold uppercase tracking-widest ${esContraEntrega ? 'text-amber-600' : 'text-emerald-600'}`}>
                {esContraEntrega ? "Cobrar al entregar" : "Ya pagado"}
              </p>
              <p className={`text-3xl font-black mt-1 ${esContraEntrega ? 'text-amber-700' : 'text-emerald-700'}`}>
                ${pedido.total}
              </p>
            </div>

            {/* Botón de Acción Principal */}
            <div className="pt-2">
              <button
                onClick={handleEntregar}
                disabled={actualizando}
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-black py-4 rounded-xl shadow-lg shadow-emerald-600/30 transition-all active:scale-95 disabled:opacity-50"
              >
                {actualizando ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <>
                    <CheckCircle2 className="w-6 h-6" />
                    CONFIRMAR ENTREGA
                  </>
                )}
              </button>
            </div>

          </div>
        )}
      </div>
      
      <p className="text-center text-[10px] text-gray-400 mt-6">
        To2en1.app &copy; {new Date().getFullYear()} - Sistema de logística
      </p>
    </div>
  );
}
