import { useMemo } from 'react';
import { 
  Clock, 
  Calendar, 
  CreditCard, 
  Package, 
  TrendingUp,
  DollarSign
} from 'lucide-react';
import { formatCurrency, toElSalvadorDateKey } from '@/lib/rentabilidad';
import {
  extractOrderUnits,
  resolveCatalogSku,
  stripQtyAndVariantParens,
  type CatalogResolutionIndex,
} from '@/lib/catalogAliases';

interface Props {
  pedidosData: any[];
  catalogIndex?: CatalogResolutionIndex;
}

const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function AnaliticaHorariaProductos({ pedidosData, catalogIndex }: Props) {
  const { diasData, maxDiaPedidos, metodosPago, topProductos } = useMemo(() => {
    const conteoDias = [0, 0, 0, 0, 0, 0, 0]; // 0=Dom, 1=Lun, ..., 6=Sab
    const ventasDias = [0, 0, 0, 0, 0, 0, 0];
    const metodosMap = new Map<string, { cantidad: number; monto: number }>();
    const prodMap = new Map<string, { cantidad: number; monto: number }>();

    pedidosData.forEach(p => {
      if (String(p.estado || '').toLowerCase() === 'cancelado') return;
      const svKey = p.created_at ? toElSalvadorDateKey(p.created_at) : '';
      const fecha = svKey ? new Date(`${svKey}T12:00:00`) : new Date();
      const diaIdx = isNaN(fecha.getDay()) ? 0 : fecha.getDay();
      const monto = Number(p.total) || 0;
      const metodo = (p.metodo_pago || 'Contra entrega').trim();
      const resolvedSku = resolveCatalogSku(
        p.sku,
        p.codigo_anuncio,
        p.catalogo_sku,
        catalogIndex?.masterSkus || [],
        { items: p.items, index: catalogIndex }
      );
      const prodNombre =
        (resolvedSku && catalogIndex?.masterNameBySku[resolvedSku]) ||
        stripQtyAndVariantParens(p.sku) ||
        p.catalogo_sku ||
        p.sku ||
        'Producto General';
      const unidades = extractOrderUnits({ items: p.items, sku: p.sku });

      conteoDias[diaIdx] += 1;
      ventasDias[diaIdx] += monto;

      // Métodos de pago
      if (!metodosMap.has(metodo)) {
        metodosMap.set(metodo, { cantidad: 0, monto: 0 });
      }
      const mStat = metodosMap.get(metodo)!;
      mStat.cantidad += 1;
      mStat.monto += monto;

      // Productos consolidados por producto maestro y unidades reales
      if (!prodMap.has(prodNombre)) {
        prodMap.set(prodNombre, { cantidad: 0, monto: 0 });
      }
      const pStat = prodMap.get(prodNombre)!;
      pStat.cantidad += unidades;
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
  }, [pedidosData, catalogIndex]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* DISTRIBUCIÓN POR DÍAS DE LA SEMANA */}
      <div className="bg-cd rounded-xl border border-[var(--bd)] p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-[var(--bd)]">
          <div>
            <h4 className="text-sm font-semibold text-[var(--tx)] flex items-center gap-2">
              <Calendar size={15} className="tx-mu" />
              Días de Mayor Conversión
            </h4>
            <p className="text-[11px] tx-mu mt-0.5">
              Volumen de pedidos por día para sincronizar campañas de anuncios y repartidores.
            </p>
          </div>
          <span className="text-[10px] font-mono uppercase tracking-wider tx-mu">7 días</span>
        </div>

        <div className="space-y-3">
          {diasData.map(d => {
            const pct = Math.min(Math.round((d.pedidos / maxDiaPedidos) * 100), 100);
            const esPico = d.pedidos === maxDiaPedidos && maxDiaPedidos > 0;

            return (
              <div key={d.dia} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className={`font-medium flex items-center gap-1.5 ${esPico ? 'text-[var(--tx)] font-semibold' : 'text-[var(--tx)]'}`}>
                    {d.dia}
                    {esPico && (
                      <span className="text-[10px] bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-medium">
                        Pico
                      </span>
                    )}
                  </span>
                  <div className="flex items-center gap-3 font-mono tabular-nums text-[11px]">
                    <span className="tx-mu">{formatCurrency(d.ventas)}</span>
                    <strong className="text-[var(--tx)]">{d.pedidos} ped.</strong>
                  </div>
                </div>

                <div className="w-full h-1.5 bg-sf rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      esPico ? 'bg-[var(--tx)]' : 'bg-indigo-500/60'
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
      <div className="bg-cd rounded-xl border border-[var(--bd)] p-5 space-y-5 flex flex-col justify-between">
        {/* Top 5 Productos */}
        <div>
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-[var(--bd)] mb-3">
            <div>
              <h4 className="text-sm font-semibold text-[var(--tx)] flex items-center gap-2">
                <Package size={15} className="tx-mu" />
                Top Productos Más Demandados
              </h4>
              <p className="text-[11px] tx-mu mt-0.5">
                Unidades generadas en el período seleccionado.
              </p>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider tx-mu">Top 5</span>
          </div>

          <div className="divide-y divide-[var(--bd)] border border-[var(--bd)] rounded-lg bg-sf/40 overflow-hidden">
            {topProductos.map((p, idx) => (
              <div key={p.nombre} className="flex items-center justify-between px-3 py-2.5 text-xs">
                <span className="font-medium truncate max-w-[210px] text-[var(--tx)] flex items-center gap-2">
                  <span className="font-mono text-[11px] tx-mu w-5">#{idx + 1}</span>
                  <span className="truncate">{p.nombre}</span>
                </span>
                <div className="flex items-center gap-3 font-mono tabular-nums text-xs shrink-0">
                  <span className="tx-mu">{p.cantidad} uds</span>
                  <strong className="text-emerald-600 dark:text-emerald-400">{formatCurrency(p.monto)}</strong>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Métodos de Pago */}
        <div className="pt-3 border-t border-[var(--bd)]">
          <div className="flex items-center gap-2 mb-2.5">
            <CreditCard size={14} className="tx-mu" />
            <h5 className="text-xs font-semibold text-[var(--tx)]">Preferencia de Métodos de Pago</h5>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            {metodosPago.map(m => (
              <div key={m.nombre} className="p-2.5 rounded-lg bg-sf border border-[var(--bd)] text-xs">
                <span className="text-[10px] tx-mu uppercase tracking-wider font-semibold block truncate">{m.nombre}</span>
                <div className="flex items-baseline justify-between mt-1 gap-2">
                  <span className="font-mono tabular-nums font-semibold text-[var(--tx)]">{m.cantidad} ped.</span>
                  <span className="font-mono tabular-nums font-semibold text-[11px] text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(m.monto)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
