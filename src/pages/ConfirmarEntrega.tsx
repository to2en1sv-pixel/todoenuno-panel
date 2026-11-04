import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { CheckCircle2, Loader2, ArrowLeft } from "lucide-react";

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

  if (cargando) return <div className="p-10 text-center">Cargando pedido...</div>;
  if (!pedido) return <div className="p-10 text-center">Pedido no encontrado.</div>;

  return (
    <div className="min-h-screen bg-[var(--cd)] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-2xl p-6 shadow-xl text-center">
        {exito ? (
          <div className="flex flex-col items-center text-emerald-500">
            <CheckCircle2 className="w-20 h-20 mb-4" />
            <h2 className="text-2xl font-black">¡Pedido Entregado!</h2>
            <p className="text-sm opacity-70 mt-2">El estado se ha actualizado en el sistema.</p>
            <button onClick={() => navigate("/pedidos")} className="mt-6 text-indigo-500 font-bold hover:underline">
              Volver al panel
            </button>
          </div>
        ) : (
          <>
            <h2 className="text-xl font-black mb-4">Confirmar Entrega</h2>
            <div className="text-left bg-black/5 p-4 rounded-xl mb-6 space-y-2 text-sm">
              <p><strong>Cliente:</strong> {pedido.nombre_cliente}</p>
              <p><strong>Dirección:</strong> {pedido.direccion}</p>
              <p><strong>Total a cobrar:</strong> ${pedido.total}</p>
            </div>
            <button
              onClick={handleEntregar}
              disabled={actualizando}
              className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-4 rounded-xl transition-colors disabled:opacity-50"
            >
              {actualizando ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sí, marcar como ENTREGADO"}
            </button>
            <button onClick={() => navigate("/pedidos")} className="mt-4 text-xs opacity-50 hover:opacity-100 flex items-center justify-center gap-1 w-full">
              <ArrowLeft className="w-3 h-3" /> Cancelar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
