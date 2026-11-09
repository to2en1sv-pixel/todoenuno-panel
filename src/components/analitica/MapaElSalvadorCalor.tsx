import { useState, useMemo } from 'react';
import { 
  MapPin, 
  TrendingUp, 
  CheckCircle2, 
  XCircle, 
  Package, 
  DollarSign, 
  Percent, 
  Layers, 
  Sparkles,
  Info,
  ChevronRight,
  Filter
} from 'lucide-react';
import { 
  DEPARTAMENTOS_EL_SALVADOR, 
  REGIONES_CONFIG, 
  RegionElSalvador, 
  normalizarDepartamento 
} from '@/data/elSalvadorDeptos';
import { formatCurrency } from '@/lib/rentabilidad';

export type MetricaCalor = 'pedidos' | 'ventas' | 'tasaEntrega' | 'ticketPromedio';

export interface EstadisticasDepto {
  id: string;
  nombre: string;
  region: RegionElSalvador;
  cabecera: string;
  pedidos: number;
  ventas: number;
  entregados: number;
  cancelados: number;
  enCamino: number;
  tasaEntrega: number; // 0 - 100%
  ticketPromedio: number;
  topProductos: { nombre: string; cantidad: number }[];
}

interface Props {
  pedidosData: any[];
  deptoSeleccionado: string | null;
  onSeleccionarDepto: (deptoNombre: string | null) => void;
}

export function MapaElSalvadorCalor({ 
  pedidosData, 
  deptoSeleccionado, 
  onSeleccionarDepto 
}: Props) {
  const [metrica, setMetrica] = useState<MetricaCalor>('pedidos');
  const [hoveredDepto, setHoveredDepto] = useState<string | null>(null);

  // Procesamiento de datos por los 14 departamentos
  const { statsPorDepto, maximos, totalesNacionales, statsPorRegion } = useMemo(() => {
    const map = new Map<string, EstadisticasDepto>();

    // Inicializar los 14 departamentos
    DEPARTAMENTOS_EL_SALVADOR.forEach(d => {
      map.set(d.nombre, {
        id: d.id,
        nombre: d.nombre,
        region: d.region,
        cabecera: d.cabecera,
        pedidos: 0,
        ventas: 0,
        entregados: 0,
        cancelados: 0,
        enCamino: 0,
        tasaEntrega: 0,
        ticketPromedio: 0,
        topProductos: []
      });
    });

    const productosPorDepto = new Map<string, Map<string, number>>();

    let totalPedidos = 0;
    let totalVentas = 0;
    let totalEntregados = 0;
    let totalCancelados = 0;

    // Procesar cada pedido
    pedidosData.forEach(p => {
      const deptoNormalizado = normalizarDepartamento(p.departamento);
      const stats = map.get(deptoNormalizado);
      if (!stats) return;

      const monto = Number(p.total) || 0;
      const estado = String(p.estado || '').toLowerCase();
      const prodNombre = (p.catalogo_sku || p.sku || 'Producto General').trim();

      stats.pedidos += 1;
      stats.ventas += monto;
      totalPedidos += 1;
      totalVentas += monto;

      if (estado === 'entregado') {
        stats.entregados += 1;
        totalEntregados += 1;
      } else if (estado === 'cancelado') {
        stats.cancelados += 1;
        totalCancelados += 1;
      } else if (estado === 'en_camino' || estado === 'por_empacar' || estado === 'nuevo') {
        stats.enCamino += 1;
      }

      // Conteo de productos más vendidos en el departamento
      if (!productosPorDepto.has(deptoNormalizado)) {
        productosPorDepto.set(deptoNormalizado, new Map());
      }
      const prodMap = productosPorDepto.get(deptoNormalizado)!;
      prodMap.set(prodNombre, (prodMap.get(prodNombre) || 0) + 1);
    });

    // Calcular tasas y top productos
    let maxPedidos = 0;
    let maxVentas = 0;
    let maxTicket = 0;

    const statsRegion: Record<RegionElSalvador, { pedidos: number; ventas: number; entregados: number }> = {
      Occidental: { pedidos: 0, ventas: 0, entregados: 0 },
      Central: { pedidos: 0, ventas: 0, entregados: 0 },
      Paracentral: { pedidos: 0, ventas: 0, entregados: 0 },
      Oriental: { pedidos: 0, ventas: 0, entregados: 0 }
    };

    map.forEach(stats => {
      const cerrados = stats.entregados + stats.cancelados;
      stats.tasaEntrega = cerrados > 0 ? (stats.entregados / cerrados) * 100 : (stats.pedidos > 0 ? 85 : 0);
      stats.ticketPromedio = stats.pedidos > 0 ? stats.ventas / stats.pedidos : 0;

      if (stats.pedidos > maxPedidos) maxPedidos = stats.pedidos;
      if (stats.ventas > maxVentas) maxVentas = stats.ventas;
      if (stats.ticketPromedio > maxTicket) maxTicket = stats.ticketPromedio;

      // Top productos
      const prodMap = productosPorDepto.get(stats.nombre);
      if (prodMap) {
        stats.topProductos = Array.from(prodMap.entries())
          .map(([nombre, cantidad]) => ({ nombre, cantidad }))
          .sort((a, b) => b.cantidad - a.cantidad)
          .slice(0, 3);
      }

      // Regiones
      statsRegion[stats.region].pedidos += stats.pedidos;
      statsRegion[stats.region].ventas += stats.ventas;
      statsRegion[stats.region].entregados += stats.entregados;
    });

    const tasaEntregaNacional = (totalEntregados + totalCancelados) > 0 
      ? (totalEntregados / (totalEntregados + totalCancelados)) * 100 
      : 0;

    return {
      statsPorDepto: map,
      maximos: {
        pedidos: maxPedidos || 1,
        ventas: maxVentas || 1,
        tasaEntrega: 100,
        ticketPromedio: maxTicket || 1
      },
      totalesNacionales: {
        pedidos: totalPedidos,
        ventas: totalVentas,
        tasaEntrega: tasaEntregaNacional,
        ticketPromedio: totalPedidos > 0 ? totalVentas / totalPedidos : 0
      },
      statsPorRegion: statsRegion
    };
  }, [pedidosData]);

  // Función para determinar el color de calor según la métrica
  const getDeptoFillColor = (deptoNombre: string) => {
    const stats = statsPorDepto.get(deptoNombre);
    if (!stats || stats.pedidos === 0) {
      return '#e2e8f0 dark:fill-slate-800'; // Sin datos
    }

    let ratio = 0;
    if (metrica === 'pedidos') {
      ratio = stats.pedidos / maximos.pedidos;
    } else if (metrica === 'ventas') {
      ratio = stats.ventas / maximos.ventas;
    } else if (metrica === 'tasaEntrega') {
      ratio = stats.tasaEntrega / 100;
    } else if (metrica === 'ticketPromedio') {
      ratio = stats.ticketPromedio / maximos.ticketPromedio;
    }

    // Clamp ratio 0 - 1
    const clamped = Math.min(Math.max(ratio, 0.08), 1);

    if (metrica === 'tasaEntrega') {
      // Escala de verde a ámbar / rojo
      if (stats.tasaEntrega >= 80) return `rgba(16, 185, 129, ${0.4 + clamped * 0.6})`;
      if (stats.tasaEntrega >= 60) return `rgba(245, 158, 11, ${0.4 + clamped * 0.6})`;
      return `rgba(244, 63, 94, ${0.4 + clamped * 0.6})`;
    }

    // Escala Indigo / Violeta / Neón para pedidos y ventas
    // Desde violeta suave hasta índigo profundo y vibrante
    return `rgba(99, 102, 241, ${0.15 + clamped * 0.85})`;
  };

  // Top 5 departamentos para el ranking lateral
  const rankingDeptos = useMemo(() => {
    const arr = Array.from(statsPorDepto.values());
    if (metrica === 'pedidos') return arr.sort((a, b) => b.pedidos - a.pedidos);
    if (metrica === 'ventas') return arr.sort((a, b) => b.ventas - a.ventas);
    if (metrica === 'tasaEntrega') return arr.sort((a, b) => b.tasaEntrega - a.tasaEntrega);
    return arr.sort((a, b) => b.ticketPromedio - a.ticketPromedio);
  }, [statsPorDepto, metrica]);

  // Departamento actualmente enfocado (hovered o seleccionado)
  const deptoActivoInfo = useMemo(() => {
    const nombre = hoveredDepto || deptoSeleccionado;
    if (!nombre) return null;
    return statsPorDepto.get(nombre) || null;
  }, [hoveredDepto, deptoSeleccionado, statsPorDepto]);

  return (
    <div className="bg-cd rounded-2xl border border-[var(--bd)] p-5 space-y-6 shadow-sm">
      {/* Header del Mapa con Selector de Métrica */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
              <MapPin size={20} />
            </span>
            <div>
              <h3 className="text-base font-bold text-[var(--tx)]">
                Mapa de Calor Demográfico: El Salvador
              </h3>
              <p className="text-xs tx-mu">
                Distribución geográfica en los 14 departamentos con efectividad de entrega COD y ticket promedio.
              </p>
            </div>
          </div>
        </div>

        {/* Selector de Métrica del Mapa */}
        <div className="flex items-center bg-sf p-1 rounded-xl border border-[var(--bd)] text-xs font-semibold gap-1">
          {[
            { id: 'pedidos', label: '📦 Pedidos' },
            { id: 'ventas', label: '💵 Ventas ($)' },
            { id: 'tasaEntrega', label: '🎯 Tasa Entrega' },
            { id: 'ticketPromedio', label: '🏷️ Ticket Prom.' },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setMetrica(m.id as MetricaCalor)}
              className={`px-3 py-1.5 rounded-lg transition-all whitespace-nowrap ${
                metrica === m.id
                  ? 'bg-indigo-600 text-white font-bold shadow-sm'
                  : 'tx-mu hover:text-[var(--tx)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Franja de Regiones (Occidente, Centro, Paracentro, Oriente) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(['Occidental', 'Central', 'Paracentral', 'Oriental'] as RegionElSalvador[]).map(r => {
          const cfg = REGIONES_CONFIG[r];
          const st = statsPorRegion[r];
          const pctPedidos = totalesNacionales.pedidos > 0 
            ? ((st.pedidos / totalesNacionales.pedidos) * 100).toFixed(0) 
            : '0';

          return (
            <div key={r} className={`p-3 rounded-xl border border-[var(--bd)] bg-sf flex items-center justify-between`}>
              <div>
                <span className={`text-[10px] font-bold uppercase ${cfg.color} block`}>
                  {cfg.nombre}
                </span>
                <span className="text-base font-black font-mono text-[var(--tx)] block mt-0.5">
                  {formatCurrency(st.ventas)}
                </span>
                <span className="text-[10px] tx-mu block">
                  {st.pedidos} pedidos ({pctPedidos}%)
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-cd border border-[var(--bd)] flex items-center justify-center font-mono font-bold text-xs">
                {pctPedidos}%
              </div>
            </div>
          );
        })}
      </div>

      {/* ÁREA PRINCIPAL: MAPA VECTORIAL + PANEL LATERAL */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* MAPA SVG VECTORIAL DE EL SALVADOR */}
        <div className="lg:col-span-8 bg-sf rounded-2xl border border-[var(--bd)] p-4 relative overflow-hidden flex flex-col justify-between min-h-[380px]">
          {/* Badge de Filtro Activo */}
          {deptoSeleccionado && (
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg animate-in fade-in">
              <Filter size={13} />
              <span>Filtrado: {deptoSeleccionado}</span>
              <button
                onClick={() => onSeleccionarDepto(null)}
                className="ml-1 hover:bg-white/20 p-0.5 rounded-md"
                title="Quitar filtro"
              >
                ✕
              </button>
            </div>
          )}

          {/* SVG Map */}
          <div className="w-full flex-1 flex items-center justify-center p-2">
            <svg
              viewBox="0 0 960 520"
              className="w-full h-auto max-h-[360px] drop-shadow-sm select-none"
            >
              {/* Océano Pacífico (Guía sutil inferior) */}
              <path
                d="M 40,490 Q 250,470 500,480 T 940,490"
                stroke="rgba(56, 189, 248, 0.2)"
                strokeWidth="2"
                strokeDasharray="6 4"
                fill="none"
              />
              <text x="50" y="505" fill="rgba(56, 189, 248, 0.4)" fontSize="11" fontFamily="sans-serif" fontWeight="bold">
                🌊 OCÉANO PACÍFICO
              </text>

              {/* Renders de los 14 Departamentos */}
              {DEPARTAMENTOS_EL_SALVADOR.map(depto => {
                const stats = statsPorDepto.get(depto.nombre);
                const isSelected = deptoSeleccionado === depto.nombre;
                const isHovered = hoveredDepto === depto.nombre;
                const fillColor = getDeptoFillColor(depto.nombre);

                return (
                  <g
                    key={depto.id}
                    onClick={() => onSeleccionarDepto(isSelected ? null : depto.nombre)}
                    onMouseEnter={() => setHoveredDepto(depto.nombre)}
                    onMouseLeave={() => setHoveredDepto(null)}
                    className="cursor-pointer transition-all duration-200"
                  >
                    <path
                      d={depto.path}
                      fill={fillColor}
                      stroke={isSelected ? '#4f46e5' : isHovered ? '#6366f1' : 'rgba(255,255,255,0.7)'}
                      strokeWidth={isSelected ? 3.5 : isHovered ? 2.5 : 1.2}
                      strokeLinejoin="round"
                      className="transition-all duration-150 hover:opacity-95"
                      style={{
                        filter: isSelected ? 'drop-shadow(0 4px 12px rgba(79, 70, 229, 0.5))' : undefined
                      }}
                    />

                    {/* Etiqueta con Nombre del Departamento */}
                    <text
                      x={depto.labelX}
                      y={depto.labelY}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill={stats && stats.pedidos > 0 ? '#ffffff' : '#64748b'}
                      fontSize={depto.nombre === 'San Salvador' || depto.nombre === 'Cuscatlán' ? '9' : '10'}
                      fontWeight="bold"
                      className="pointer-events-none select-none drop-shadow"
                      style={{
                        textShadow: '0 1px 3px rgba(0,0,0,0.8)'
                      }}
                    >
                      {depto.nombre}
                    </text>

                    {/* Píldora de volumen si tiene pedidos */}
                    {stats && stats.pedidos > 0 && (
                      <text
                        x={depto.labelX}
                        y={depto.labelY + 12}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="rgba(255,255,255,0.9)"
                        fontSize="8"
                        fontFamily="monospace"
                        fontWeight="bold"
                        className="pointer-events-none select-none"
                      >
                        {metrica === 'pedidos' && `${stats.pedidos} ord`}
                        {metrica === 'ventas' && formatCurrency(stats.ventas)}
                        {metrica === 'tasaEntrega' && `${stats.tasaEntrega.toFixed(0)}%`}
                        {metrica === 'ticketPromedio' && formatCurrency(stats.ticketPromedio)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Barra de Leyenda de Calor */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--bd)] text-[10px] tx-mu">
            <div className="flex items-center gap-2">
              <span className="font-bold">Baja Actividad</span>
              <div className="w-28 h-2.5 rounded-full bg-gradient-to-r from-indigo-500/20 via-indigo-500/60 to-indigo-600" />
              <span className="font-bold">Alta Concentración</span>
            </div>

            <div className="hidden sm:flex items-center gap-1 opacity-70">
              <Info size={12} /> Clic en cualquier departamento para filtrar la analítica
            </div>
          </div>
        </div>

        {/* PANEL LATERAL: DRILLDOWN DEL DEPARTAMENTO O RANKING */}
        <div className="lg:col-span-4 space-y-4">
          {/* Card Detalle del Departamento Activo */}
          {deptoActivoInfo ? (
            <div className="p-4 rounded-2xl bg-sf border border-indigo-500/30 space-y-3 shadow-md animate-in fade-in">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase text-indigo-500 block">
                    {deptoActivoInfo.region} · Cabecera: {deptoActivoInfo.cabecera}
                  </span>
                  <h4 className="text-lg font-black text-[var(--tx)]">
                    {deptoActivoInfo.nombre}
                  </h4>
                </div>

                <button
                  onClick={() => onSeleccionarDepto(deptoSeleccionado === deptoActivoInfo.nombre ? null : deptoActivoInfo.nombre)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-colors ${
                    deptoSeleccionado === deptoActivoInfo.nombre
                      ? 'bg-rose-500 text-white'
                      : 'bg-indigo-600 text-white'
                  }`}
                >
                  {deptoSeleccionado === deptoActivoInfo.nombre ? 'Desfiltrar' : 'Filtrar Este'}
                </button>
              </div>

              {/* Métricas Principales */}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 rounded-xl bg-cd border border-[var(--bd)]">
                  <span className="text-[9px] uppercase font-bold tx-mu block">Pedidos Totales</span>
                  <span className="text-base font-black font-mono text-[var(--tx)] block mt-0.5">
                    {deptoActivoInfo.pedidos}
                  </span>
                  <span className="text-[9px] tx-mu block">
                    {totalesNacionales.pedidos > 0 
                      ? `${((deptoActivoInfo.pedidos / totalesNacionales.pedidos) * 100).toFixed(1)}% del país` 
                      : '0%'}
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-cd border border-[var(--bd)]">
                  <span className="text-[9px] uppercase font-bold tx-mu block">Ventas Cobradas</span>
                  <span className="text-base font-black font-mono text-emerald-600 block mt-0.5">
                    {formatCurrency(deptoActivoInfo.ventas)}
                  </span>
                  <span className="text-[9px] tx-mu block">
                    Ticket: {formatCurrency(deptoActivoInfo.ticketPromedio)}
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-cd border border-[var(--bd)]">
                  <span className="text-[9px] uppercase font-bold tx-mu block">Efectividad COD</span>
                  <span className={`text-sm font-black font-mono block mt-0.5 ${
                    deptoActivoInfo.tasaEntrega >= 80 ? 'text-emerald-600' :
                    deptoActivoInfo.tasaEntrega >= 60 ? 'text-amber-500' :
                    'text-rose-500'
                  }`}>
                    {deptoActivoInfo.tasaEntrega.toFixed(1)}%
                  </span>
                  <span className="text-[9px] tx-mu block">
                    {deptoActivoInfo.entregados} entregados
                  </span>
                </div>

                <div className="p-2 rounded-xl bg-cd border border-[var(--bd)]">
                  <span className="text-[9px] uppercase font-bold tx-mu block">Cancelaciones</span>
                  <span className="text-sm font-black font-mono text-rose-500 block mt-0.5">
                    {deptoActivoInfo.cancelados}
                  </span>
                  <span className="text-[9px] tx-mu block">
                    {deptoActivoInfo.enCamino} en ruta
                  </span>
                </div>
              </div>

              {/* Top Productos en el Departamento */}
              {deptoActivoInfo.topProductos.length > 0 && (
                <div className="pt-2 border-t border-[var(--bd)]">
                  <span className="text-[10px] font-bold uppercase tx-mu block mb-1.5">
                    Top Productos en {deptoActivoInfo.nombre}:
                  </span>
                  <div className="space-y-1">
                    {deptoActivoInfo.topProductos.map((p, idx) => (
                      <div key={p.nombre} className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-cd border border-[var(--bd)]">
                        <span className="truncate flex-1 pr-2">
                          <strong className="text-indigo-500">#{idx + 1}</strong> {p.nombre}
                        </span>
                        <span className="font-mono font-bold text-[10px] tx-mu shrink-0">
                          {p.cantidad} uds
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-sf border border-[var(--bd)] text-center text-xs tx-mu flex flex-col items-center justify-center py-8">
              <MapPin size={24} className="opacity-40 mb-2" />
              <span>Pasa el cursor o haz clic en cualquier departamento para ver su expediente logístico.</span>
            </div>
          )}

          {/* Ranking Top 5 Departamentos */}
          <div className="p-4 rounded-2xl bg-sf border border-[var(--bd)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--tx)] flex items-center gap-1.5">
                <TrendingUp size={14} className="text-indigo-500" /> Ranking por {
                  metrica === 'pedidos' ? 'Volumen de Pedidos' :
                  metrica === 'ventas' ? 'Facturación ($)' :
                  metrica === 'tasaEntrega' ? 'Efectividad COD' : 'Ticket Promedio'
                }
              </span>
            </div>

            <div className="space-y-2">
              {rankingDeptos.slice(0, 5).map((d, index) => {
                const valorActual = metrica === 'pedidos' ? d.pedidos :
                  metrica === 'ventas' ? d.ventas :
                  metrica === 'tasaEntrega' ? d.tasaEntrega : d.ticketPromedio;

                const maxVal = metrica === 'pedidos' ? maximos.pedidos :
                  metrica === 'ventas' ? maximos.ventas :
                  metrica === 'tasaEntrega' ? 100 : maximos.ticketPromedio;

                const porcentajeBarra = Math.min(Math.round((valorActual / (maxVal || 1)) * 100), 100);

                return (
                  <div
                    key={d.id}
                    onClick={() => onSeleccionarDepto(deptoSeleccionado === d.nombre ? null : d.nombre)}
                    className={`p-2 rounded-xl border cursor-pointer transition-all ${
                      deptoSeleccionado === d.nombre
                        ? 'border-indigo-500 bg-indigo-500/10'
                        : 'border-[var(--bd)] bg-cd hover:border-[var(--ac)]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-bold text-[var(--tx)] flex items-center gap-1.5">
                        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black ${
                          index === 0 ? 'bg-amber-500 text-white' :
                          index === 1 ? 'bg-slate-300 text-slate-800' :
                          index === 2 ? 'bg-amber-700 text-white' :
                          'bg-sf text-slate-500'
                        }`}>
                          {index + 1}
                        </span>
                        {d.nombre}
                      </span>
                      <span className="font-mono font-bold text-xs text-indigo-600">
                        {metrica === 'pedidos' && `${d.pedidos} ord`}
                        {metrica === 'ventas' && formatCurrency(d.ventas)}
                        {metrica === 'tasaEntrega' && `${d.tasaEntrega.toFixed(1)}%`}
                        {metrica === 'ticketPromedio' && formatCurrency(d.ticketPromedio)}
                      </span>
                    </div>

                    {/* Barra de Progreso */}
                    <div className="w-full h-1.5 bg-sf rounded-full overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full transition-all"
                        style={{ width: `${porcentajeBarra}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
