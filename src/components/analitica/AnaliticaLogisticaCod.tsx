import { useMemo } from 'react';
import { 
  Truck, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  TrendingUp, 
  AlertTriangle,
  UserCheck,
  DollarSign,
  Package
} from 'lucide-react';
import { formatCurrency } from '@/lib/rentabilidad';

interface Props {
  pedidosData: any[];
}

export function AnaliticaLogisticaCod({ pedidosData }: Props) {
  // Desglose de estados y couriers
  const { 
    totales, 
    funnel, 
    statsCouriers, 
    tasaEntregaGlobal, 
    montoEnCalle 
  } = useMemo(() => {
    let nuevos = 0;
    let programados = 0;
    let porEmpacar = 0;
    let enCamino = 0;
    let entregados = 0;
    let cancelados = 0;

    let montoEntregado = 0;
    let montoEnCalle = 0;
    let montoCancelado = 0;

    const courierMap = new Map<string, {
      nombre: string;
      pedidos: number;
      entregados: number;
      cancelados: number;
      enCamino: number;
      montoRecaudado: number;
      montoEnCalle: number;
    }>();

    pedidosData.forEach(p => {
      const estado = String(p.estado || '').toLowerCase();
      const monto = Number(p.total) || 0;
      const courier = (p.courier || 'Sin Asignar').trim();

      if (!courierMap.has(courier)) {
        courierMap.set(courier, {
          nombre: courier,
          pedidos: 0,
          entregados: 0,
          cancelados: 0,
          enCamino: 0,
          montoRecaudado: 0,
          montoEnCalle: 0
        });
      }
      const cStat = courierMap.get(courier)!;
      cStat.pedidos += 1;

      switch (estado) {
        case 'nuevo':
          nuevos++;
          break;
        case 'programado':
          programados++;
          break;
        case 'por_empacar':
          porEmpacar++;
          break;
        case 'en_camino':
          enCamino++;
          montoEnCalle += monto;
          cStat.enCamino += 1;
          cStat.montoEnCalle += monto;
          break;
        case 'entregado':
          entregados++;
          montoEntregado += monto;
          cStat.entregados += 1;
          cStat.montoRecaudado += monto;
          break;
        case 'cancelado':
          cancelados++;
          montoCancelado += monto;
          cStat.cancelados += 1;
          break;
      }
    });

    const totalPedidos = pedidosData.length;
    const cerrados = entregados + cancelados;
    const tasaEntregaGlobal = cerrados > 0 ? (entregados / cerrados) * 100 : 0;

    const listaCouriers = Array.from(courierMap.values())
      .filter(c => c.pedidos > 0)
      .map(c => {
        const cerradosC = c.entregados + c.cancelados;
        const efectividad = cerradosC > 0 ? (c.entregados / cerradosC) * 100 : 0;
        return {
          ...c,
          efectividad
        };
      })
      .sort((a, b) => b.pedidos - a.pedidos);

    return {
      totales: {
        total: totalPedidos,
        nuevos,
        programados,
        porEmpacar,
        enCamino,
        entregados,
        cancelados,
        montoEntregado,
        montoCancelado
      },
      montoEnCalle,
      tasaEntregaGlobal,
      funnel: [
        { label: 'Generados (WhatsApp)', cantidad: totalPedidos, color: 'bg-sky-500' },
        { label: 'Procesados / Empacados', cantidad: totalPedidos - nuevos - programados, color: 'bg-amber-500' },
        { label: 'En Ruta / En Calle', cantidad: enCamino + entregados + cancelados, color: 'bg-indigo-500' },
        { label: 'Cobrados con Éxito (COD)', cantidad: entregados, color: 'bg-emerald-500' }
      ],
      statsCouriers: listaCouriers
    };
  }, [pedidosData]);

  return (
    <div className="bg-cd rounded-2xl border border-[var(--bd)] p-5 space-y-6 shadow-sm">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-xl bg-emerald-500/10 text-emerald-500">
            <Truck size={20} />
          </span>
          <div>
            <h3 className="text-base font-bold text-[var(--tx)]">
              Operativa Logística COD & Cobro en Calle
            </h3>
            <p className="text-xs tx-mu">
              Efectividad de entrega contra entrega, control de paquetes en ruta y rendimiento por courier.
            </p>
          </div>
        </div>

        {/* Badge Tasa de Entrega COD */}
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 font-bold text-xs">
          <CheckCircle2 size={15} />
          <span>Efectividad Nacional COD: {tasaEntregaGlobal.toFixed(1)}%</span>
        </div>
      </div>

      {/* Métricas Rápidas de Operativa */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-xl bg-sf border border-[var(--bd)]">
          <span className="text-[10px] uppercase font-bold tx-mu block">Entregados & Cobrados</span>
          <div className="text-xl font-black font-mono text-emerald-600 mt-1">
            {totales.entregados} <span className="text-xs font-normal tx-mu">pedidos</span>
          </div>
          <span className="text-[10px] tx-mu block mt-0.5">
            Monto: <strong>{formatCurrency(totales.montoEntregado)}</strong>
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-sf border border-[var(--bd)]">
          <span className="text-[10px] uppercase font-bold tx-mu block">En Ruta (Efectivo en Calle)</span>
          <div className="text-xl font-black font-mono text-indigo-500 mt-1">
            {totales.enCamino} <span className="text-xs font-normal tx-mu">guías</span>
          </div>
          <span className="text-[10px] tx-mu block mt-0.5">
            Por cobrar: <strong className="text-indigo-600">{formatCurrency(montoEnCalle)}</strong>
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-sf border border-[var(--bd)]">
          <span className="text-[10px] uppercase font-bold tx-mu block">Por Empacar / Bodega</span>
          <div className="text-xl font-black font-mono text-amber-500 mt-1">
            {totales.porEmpacar + totales.nuevos} <span className="text-xs font-normal tx-mu">pendientes</span>
          </div>
          <span className="text-[10px] tx-mu block mt-0.5">
            {totales.nuevos} nuevos · {totales.porEmpacar} en bodega
          </span>
        </div>

        <div className="p-3.5 rounded-xl bg-sf border border-[var(--bd)]">
          <span className="text-[10px] uppercase font-bold tx-mu block">Cancelados / Rechazados</span>
          <div className="text-xl font-black font-mono text-rose-500 mt-1">
            {totales.cancelados} <span className="text-xs font-normal tx-mu">fallidos</span>
          </div>
          <span className="text-[10px] tx-mu block mt-0.5">
            Pérdida flete: {formatCurrency(totales.montoCancelado)}
          </span>
        </div>
      </div>

      {/* TABLA DE RENDIMIENTO POR COURIER / MOTORISTAS */}
      <div className="space-y-3">
        <h4 className="text-xs font-bold uppercase tx-mu flex items-center gap-1.5">
          <UserCheck size={14} className="text-indigo-500" /> Comparativa de Rendimiento por Courier / Transportista
        </h4>

        <div className="bg-sf rounded-2xl border border-[var(--bd)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-cd border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                <tr>
                  <th className="p-3">Courier / Flota</th>
                  <th className="p-3 text-center">Total Asignados</th>
                  <th className="p-3 text-center">Entregados</th>
                  <th className="p-3 text-center">En Ruta</th>
                  <th className="p-3 text-center">Cancelados</th>
                  <th className="p-3 text-right">Tasa Efectividad</th>
                  <th className="p-3 text-right">Monto Cobrado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {statsCouriers.map(c => (
                  <tr key={c.nombre} className="hover:bg-cd/50 transition-colors">
                    <td className="p-3 font-bold text-[var(--tx)] flex items-center gap-2">
                      <Truck size={14} className="text-indigo-500" />
                      {c.nombre}
                    </td>
                    <td className="p-3 text-center font-mono font-semibold">
                      {c.pedidos}
                    </td>
                    <td className="p-3 text-center font-mono font-bold text-emerald-600">
                      {c.entregados}
                    </td>
                    <td className="p-3 text-center font-mono text-indigo-500">
                      {c.enCamino}
                    </td>
                    <td className="p-3 text-center font-mono text-rose-500">
                      {c.cancelados}
                    </td>
                    <td className="p-3 text-right">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                        c.efectividad >= 80 ? 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20' :
                        c.efectividad >= 65 ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20' :
                        'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                      }`}>
                        {c.efectividad > 0 ? `${c.efectividad.toFixed(1)}%` : '—'}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono font-black text-emerald-600">
                      {formatCurrency(c.montoRecaudado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
