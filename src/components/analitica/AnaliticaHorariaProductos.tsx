import { useMemo } from 'react';
import { 
  Clock, 
  Calendar, 
  CreditCard, 
  Package, 
  TrendingUp,
  DollarSign
} from 'lucide-react';
import { formatCurrency } from '@/lib/rentabilidad';

interface Props {
  pedidosData: any[];
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function AnaliticaHorariaProductos({ pedidosData }: Props) {
  const { diasData, maxDiaPedidos, metodosPago, topProductos } = useMemo(() => {
    const conteoDias = [0, 0, 0, 0, 0, 0, 0]; // 0=Dom, 1=Lun, ..., 6=Sab
    const ventasDias = [0, 0, 0, 0, 0, 0, 0];
    const metodosMap = new Map<string, { cantidad: number; monto: number }>();
    const prodMap = new Map<string, { cantidad: number; monto: number }>();

    pedidosData.forEach(p => {
      const fecha = p.created_at ? new Date(p.created_at) : new Date();
      const diaIdx = isNaN(fecha.getDay()) ? 0 : fecha.getDay();
      const monto = Number(p.total) || 0;
      const metodo = (p.metodo_pago || 'Contra entrega').trim();
      const prodNombre = (p.catalogo_sku || p.sku || 'Producto General').trim();

      conteoDias[diaIdx] += 1;
      ventasDias[diaIdx] += monto;

      // Métodos de pago
      if (!metodosMap.has(metodo)) {
        metodosMap.set(metodo, { cantidad: 0, monto: 0 });
      }
      const mStat = metodosMap.get(metodo)!;
      mStat.cantidad += 1;
      mStat.monto += monto;

      // Productos
      if (!prodMap.has(prodNombre)) {
        prodMap.set(prodNombre, { cantidad: 0, monto: 0 });
      }
      const pStat = prodMap.get(prodNombre)!;
      pStat.cantidad += 1;
      pStat.monto += monto;
    });

    // Reordenar días empezando por Lunes (1, 2, 3, 4, 5, 6, 0)
    const ordenLunes = [1, 2, 3, 4, 5, 6, 0];
    const diasOrdenados = ordenLunes.map(idx => ({
      dia: DIAS_SEMANA[idx],
      pedidos: conteoDias[idx],
      ventas: ventasDias[idx]
    }));

    let maxPedidos = 0;
    diasOrdenados.forEach(d => {
      if (d.pedidos > maxPedidos) maxPedidos = d.pedidos;
    });

    const listaProductos = Array.from(prodMap.entries())
      .map(([nombre, stat]) => ({ nombre, ...stat }))
      .sort((a, b) => b.cantidad - a.cantidad)
      .slice(0, 5);

    const listaMetodos = Array.from(metodosMap.entries())
      .map(([nombre, stat]) => ({ nombre, ...stat }))
      .sort((a, b) => b.cantidad - a.cantidad);

    return {
      diasData: diasOrdenados,
      maxDiaPedidos: maxPedidos || 1,
      metodosPago: listaMetodos,
      topProductos: listaProductos
    };
  }, [pedidosData]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {/* DISTRIBUCIÓN POR DÍAS DE LA SEMANA */}
      <div className="bg-cd rounded-2xl border border-[var(--bd)] p-5 space-y-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
            <Calendar size={18} />
          </span>
          <div>
            <h4 className="text-sm font-bold text-[var(--tx)]">
              Días de Mayor Conversión (Semana)
            </h4>
            <p className="text-[11px] tx-mu">
              Volumen de pedidos por día para sincronizar campañas de anuncios y repartidores.
            </p>
          </div>
        </div>

        <div className="space-y-2 pt-1">
          {diasData.map(d => {
            const pct = Math.min(Math.round((d.pedidos / maxDiaPedidos) * 100), 100);
            const esPico = d.pedidos === maxDiaPedidos && maxDiaPedidos > 0;

            return (
              <div key={d.dia} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-semibold flex items-center gap-1.5 ${esPico ? 'text-indigo-600 font-bold' : 'text-[var(--tx)]'}`}>
                    {d.dia} {esPico && <span className="text-[9px] bg-indigo-500/10 text-indigo-500 px-1 rounded font-bold">Pico</span>}
                  </span>
                  <div className="flex items-center gap-3 font-mono text-[11px]">
                    <span className="tx-mu">{formatCurrency(d.ventas)}</span>
                    <strong className="text-[var(--tx)]">{d.pedidos} pedidos</strong>
                  </div>
                </div>

                <div className="w-full h-2 bg-sf rounded-full overflow-hidden">
                  <div 
                    className={`h-full rounded-full transition-all ${
                      esPico ? 'bg-indigo-600' : 'bg-indigo-400/60'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* TOP PRODUCTOS Y MÉTODOS DE PAGO */}
      <div className="bg-cd rounded-2xl border border-[var(--bd)] p-5 space-y-5 shadow-sm flex flex-col justify-between">
        {/* Top 5 Productos */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-500">
              <Package size={18} />
            </span>
            <div>
              <h4 className="text-sm font-bold text-[var(--tx)]">
                Top Productos Más Demandados
              </h4>
              <p className="text-[11px] tx-mu">
                Unidades generadas en el período seleccionado.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {topProductos.map((p, idx) => (
              <div key={p.nombre} className="flex items-center justify-between p-2 rounded-xl bg-sf border border-[var(--bd)] text-xs">
                <span className="font-semibold truncate max-w-[200px] text-[var(--tx)]">
                  <strong className="text-amber-500 mr-1.5">#{idx + 1}</strong>
                  {p.nombre}
                </span>
                <div className="flex items-center gap-3 font-mono text-xs shrink-0">
                  <span className="tx-mu">{p.cantidad} uds</span>
                  <strong className="text-emerald-600">{formatCurrency(p.monto)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Métodos de Pago */}
        <div className="pt-3 border-t border-[var(--bd)]">
          <div className="flex items-center gap-2 mb-2">
            <CreditCard size={14} className="text-indigo-500" />
            <h5 className="text-xs font-bold text-[var(--tx)]">Preferencia de Métodos de Pago</h5>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {metodosPago.map(m => (
              <div key={m.nombre} className="p-2.5 rounded-xl bg-sf border border-[var(--bd)] text-xs">
                <span className="text-[10px] tx-mu uppercase font-bold block truncate">{m.nombre}</span>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="font-mono font-bold text-[var(--tx)]">{m.cantidad} pedidos</span>
                  <span className="font-mono font-bold text-[10px] text-emerald-600">{formatCurrency(m.monto)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
