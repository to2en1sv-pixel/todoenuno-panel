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
  Filter,
  Building2,
  Compass
} from 'lucide-react';
import { 
  DEPARTAMENTOS_EL_SALVADOR, 
  REGIONES_CONFIG, 
  RegionElSalvador, 
  normalizarDepartamento,
  extraerMunicipio,
  MUNICIPIOS_POR_DEPTO
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

export interface MunicipioStat {
  municipio: string;
  departamento: string;
  pedidos: number;
  ventas: number;
  entregados: number;
  cancelados: number;
  tasaEntrega: number;
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
  const [vistaRanking, setVistaRanking] = useState<'deptos' | 'municipios'>('deptos');

  // Procesamiento de datos por los 14 departamentos y municipios
  const { statsPorDepto, maximos, totalesNacionales, statsPorRegion, statsPorMunicipio } = useMemo(() => {
    const map = new Map<string, EstadisticasDepto>();
    const muniMap = new Map<string, MunicipioStat>();

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
      const muniNombre = extraerMunicipio(p.direccion, deptoNormalizado);

      stats.pedidos += 1;
      stats.ventas += monto;
      totalPedidos += 1;
      totalVentas += monto;

      // Desglose de municipios
      const muniKey = `${deptoNormalizado}__${muniNombre}`;
      if (!muniMap.has(muniKey)) {
        muniMap.set(muniKey, {
          municipio: muniNombre,
          departamento: deptoNormalizado,
          pedidos: 0,
          ventas: 0,
          entregados: 0,
          cancelados: 0,
          tasaEntrega: 0
        });
      }
      const mStat = muniMap.get(muniKey)!;
      mStat.pedidos += 1;
      mStat.ventas += monto;

      if (estado === 'entregado') {
        stats.entregados += 1;
        totalEntregados += 1;
        mStat.entregados += 1;
      } else if (estado === 'cancelado') {
        stats.cancelados += 1;
        totalCancelados += 1;
        mStat.cancelados += 1;
      } else if (estado === 'en_camino' || estado === 'por_empacar' || estado === 'nuevo' || estado === 'programado') {
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

    // Calcular tasas en municipios
    muniMap.forEach(m => {
      const totCerrados = m.entregados + m.cancelados;
      m.tasaEntrega = totCerrados > 0 ? (m.entregados / totCerrados) * 100 : 85;
    });

    const tasaEntregaNacional = (totalEntregados + totalCancelados) > 0 
      ? (totalEntregados / (totalEntregados + totalCancelados)) * 100 
      : 0;

    return {
      statsPorDepto: map,
      statsPorMunicipio: Array.from(muniMap.values()).sort((a, b) => b.pedidos - a.pedidos),
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

  // Color de calor seguro para SVG (nunca devuelve clases Tailwind como string de color)
  const getDeptoFillColor = (deptoNombre: string) => {
    const stats = statsPorDepto.get(deptoNombre);
    if (!stats || stats.pedidos === 0) {
      // Color neutral sutil y elegante para departamentos sin actividad (evita la pantalla negra)
      return 'rgba(148, 163, 184, 0.22)';
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

    // Clamp ratio 0.15 - 1
    const clamped = Math.min(Math.max(ratio, 0.15), 1);

    if (metrica === 'tasaEntrega') {
      if (stats.tasaEntrega >= 80) return `rgba(16, 185, 129, ${0.45 + clamped * 0.55})`;
      if (stats.tasaEntrega >= 60) return `rgba(245, 158, 11, ${0.45 + clamped * 0.55})`;
      return `rgba(244, 63, 94, ${0.45 + clamped * 0.55})`;
    }

    // Escala Violeta / Índigo corporativo (alta visibilidad tanto en tema claro como oscuro)
    return `rgba(99, 102, 241, ${0.30 + clamped * 0.70})`;
  };

  // Top ranking de departamentos
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

  // Municipios específicos del departamento enfocado
  const municipiosDelDeptoActivo = useMemo(() => {
    if (!deptoActivoInfo) return [];
    return statsPorMunicipio.filter(m => m.departamento === deptoActivoInfo.nombre);
  }, [deptoActivoInfo, statsPorMunicipio]);

  return (
    <div className="bg-cd rounded-xl border border-[var(--bd)] p-4 sm:p-5 space-y-5">
      {/* Header del Mapa con Selector de Métrica */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-lg bg-sf border border-[var(--bd)] tx-mu shrink-0">
              <MapPin size={18} />
            </span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base font-bold text-[var(--tx)] tracking-tight">
                  Mapa de Calor Demográfico: El Salvador
                </h3>
                <span className="text-[10px] font-mono uppercase font-medium px-2 py-0.5 rounded bg-sf tx-mu border border-[var(--bd)] shrink-0">
                  14 Deptos + Municipios
                </span>
              </div>
              <p className="text-xs tx-mu mt-0.5">
                Distribución geográfica, efectividad de entrega contra entrega y concentración por municipio.
              </p>
            </div>
          </div>
        </div>

        {/* Selector de Métrica del Mapa */}
        <div className="flex flex-wrap items-center bg-sf p-0.5 rounded-lg border border-[var(--bd)] text-xs font-medium gap-1 w-full xl:w-auto">
          {[
            { id: 'pedidos', label: 'Pedidos' },
            { id: 'ventas', label: 'Ventas ($)' },
            { id: 'tasaEntrega', label: 'Tasa Entrega' },
            { id: 'ticketPromedio', label: 'Ticket Prom.' },
          ].map(m => (
            <button
              key={m.id}
              onClick={() => setMetrica(m.id as MetricaCalor)}
              className={`flex-1 xl:flex-none px-3 py-1.5 rounded-md transition-colors whitespace-nowrap text-center ${
                metrica === m.id
                  ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                  : 'tx-mu hover:text-[var(--tx)]'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Franja de Regiones (Occidente, Centro, Paracentro, Oriente) */}
      <div className="bg-sf rounded-xl border border-[var(--bd)] grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[var(--bd)]">
        {(['Occidental', 'Central', 'Paracentral', 'Oriental'] as RegionElSalvador[]).map(r => {
          const cfg = REGIONES_CONFIG[r];
          const st = statsPorRegion[r];
          const pctPedidos = totalesNacionales.pedidos > 0 
            ? ((st.pedidos / totalesNacionales.pedidos) * 100).toFixed(0) 
            : '0';

          return (
            <div key={r} className="p-3.5 flex items-center justify-between gap-2">
              <div>
                <span className={`text-[10px] font-semibold uppercase ${cfg.color} block`}>
                  {cfg.nombre}
                </span>
                <span className="text-base font-bold font-mono tabular-nums text-[var(--tx)] block mt-0.5">
                  {formatCurrency(st.ventas)}
                </span>
                <span className="text-[11px] tx-mu font-mono tabular-nums block">
                  {st.pedidos} ped. ({pctPedidos}%)
                </span>
              </div>
              <div className="w-10 h-10 rounded-lg bg-cd border border-[var(--bd)] flex items-center justify-center font-mono tabular-nums font-bold text-xs shrink-0">
                {pctPedidos}%
              </div>
            </div>
          );
        })}
      </div>

      {/* ÁREA PRINCIPAL: MAPA VECTORIAL + PANEL LATERAL */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* MAPA SVG VECTORIAL DE EL SALVADOR */}
        <div className="lg:col-span-8 bg-sf rounded-xl border border-[var(--bd)] p-4 relative overflow-hidden flex flex-col justify-between min-h-[420px]">
          {/* Badge de Filtro Activo */}
          {deptoSeleccionado && (
            <div className="absolute top-3 left-3 z-10 flex items-center gap-2 bg-indigo-600 text-white px-3 py-1.5 rounded-xl text-xs font-bold shadow-lg animate-in fade-in">
              <Filter size={13} />
              <span>Filtrando: {deptoSeleccionado}</span>
              <button
                onClick={() => onSeleccionarDepto(null)}
                className="ml-1 hover:bg-white/20 p-0.5 rounded-md"
                title="Quitar filtro"
              >
                ✕
              </button>
            </div>
          )}

          {/* SVG Map con geometría geográfica real de El Salvador (CNR) */}
          <div className="w-full flex-1 flex items-center justify-center p-1 sm:p-2">
            <svg
              viewBox="0 0 960 515"
              className="w-full h-auto max-h-[430px] select-none"
            >
              {/* Referencias marítimas limpias */}
              <text
                x="220"
                y="455"
                textAnchor="middle"
                fill="currentColor"
                opacity="0.32"
                fontSize="10"
                fontFamily="sans-serif"
                fontWeight="700"
                letterSpacing="2.5"
              >
                OCÉANO PACÍFICO
              </text>
              <text
                x="845"
                y="500"
                textAnchor="middle"
                fill="currentColor"
                opacity="0.3"
                fontSize="9"
                fontFamily="sans-serif"
                fontWeight="700"
                letterSpacing="1.6"
              >
                GOLFO DE FONSECA
              </text>

              {/* Renders de los 14 Departamentos (el activo/hover se dibuja al final para resaltar su borde) */}
              {[...DEPARTAMENTOS_EL_SALVADOR]
                .sort((a, b) => {
                  const score = (n: string) =>
                    deptoSeleccionado === n ? 2 : hoveredDepto === n ? 1 : 0;
                  return score(a.nombre) - score(b.nombre);
                })
                .map(depto => {
                  const stats = statsPorDepto.get(depto.nombre);
                  const isSelected = deptoSeleccionado === depto.nombre;
                  const isHovered = hoveredDepto === depto.nombre;
                  const fillColor = getDeptoFillColor(depto.nombre);
                  const isCompactDepto =
                    depto.nombre === 'San Salvador' ||
                    depto.nombre === 'Cuscatlán' ||
                    depto.nombre === 'Cabañas';
                  const hasOrders = Boolean(stats && stats.pedidos > 0);

                  return (
                    <g
                      key={depto.id}
                      onClick={() => onSeleccionarDepto(isSelected ? null : depto.nombre)}
                      onMouseEnter={() => setHoveredDepto(depto.nombre)}
                      onMouseLeave={() => setHoveredDepto(null)}
                      className="cursor-pointer transition-all duration-150"
                    >
                      <path
                        d={depto.path}
                        fill={fillColor}
                        fillRule="evenodd"
                        stroke={
                          isSelected
                            ? '#4f46e5'
                            : isHovered
                            ? '#6366f1'
                            : 'var(--cd)'
                        }
                        strokeWidth={isSelected ? 2.8 : isHovered ? 2.2 : 1.35}
                        strokeLinejoin="round"
                        className="transition-all duration-150 hover:brightness-105"
                        style={{
                          filter: isSelected
                            ? 'drop-shadow(0 0 8px rgba(79, 70, 229, 0.45))'
                            : undefined,
                        }}
                      />

                      {/* Etiqueta con Nombre del Departamento */}
                      <text
                        x={depto.labelX}
                        y={depto.labelY - 4}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#ffffff"
                        stroke="rgba(15, 23, 42, 0.85)"
                        strokeWidth="2.8"
                        strokeLinejoin="round"
                        style={{ paintOrder: 'stroke fill' }}
                        fontSize={isCompactDepto ? '9.5' : '11'}
                        fontWeight="700"
                        className="pointer-events-none select-none tracking-tight"
                      >
                        {depto.nombre}
                      </text>

                      {/* Indicador numérico de volumen */}
                      <text
                        x={depto.labelX}
                        y={depto.labelY + 9}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill={hasOrders ? '#e0e7ff' : '#e2e8f0'}
                        stroke="rgba(15, 23, 42, 0.88)"
                        strokeWidth="2.4"
                        strokeLinejoin="round"
                        style={{ paintOrder: 'stroke fill' }}
                        fontSize={isCompactDepto ? '8.5' : '9.5'}
                        fontFamily="monospace"
                        fontWeight="700"
                        className="pointer-events-none select-none"
                      >
                        {hasOrders && stats ? (
                          metrica === 'pedidos' ? `${stats.pedidos} ord` :
                          metrica === 'ventas' ? formatCurrency(stats.ventas) :
                          metrica === 'tasaEntrega' ? `${stats.tasaEntrega.toFixed(0)}%` :
                          formatCurrency(stats.ticketPromedio)
                        ) : (
                          '0 ord'
                        )}
                      </text>
                    </g>
                  );
                })}
            </svg>
          </div>

          {/* Barra de Leyenda de Calor */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--bd)] text-[10px] tx-mu">
            <div className="flex items-center gap-2">
              <span className="font-bold">Baja Actividad</span>
              <div className="w-28 h-2 rounded-full bg-gradient-to-r from-indigo-500/25 via-indigo-500/60 to-indigo-600" />
              <span className="font-bold">Alta Concentración</span>
            </div>

            <div className="hidden sm:flex items-center gap-1 opacity-70">
              <Info size={12} /> Clic en cualquier departamento para ver sus municipios y filtrar
            </div>
          </div>
        </div>

        {/* PANEL LATERAL: DETALLES, MUNICIPIOS Y RANKING */}
        <div className="lg:col-span-4 space-y-4">
          {/* Card Detalle del Departamento Activo */}
          {deptoActivoInfo ? (
            <div className="p-4 rounded-xl bg-sf border border-[var(--bd)] space-y-3.5 animate-in fade-in">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-semibold uppercase text-indigo-600 dark:text-indigo-400 block">
                    {deptoActivoInfo.region} · Cabecera: {deptoActivoInfo.cabecera}
                  </span>
                  <h4 className="text-lg font-bold text-[var(--tx)]">
                    {deptoActivoInfo.nombre}
                  </h4>
                </div>

                <button
                  onClick={() => onSeleccionarDepto(deptoSeleccionado === deptoActivoInfo.nombre ? null : deptoActivoInfo.nombre)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                    deptoSeleccionado === deptoActivoInfo.nombre
                      ? 'bg-rose-600 text-white'
                      : 'bg-[var(--tx)] text-[var(--cd)] hover:opacity-90'
                  }`}
                >
                  {deptoSeleccionado === deptoActivoInfo.nombre ? 'Quitar Filtro' : 'Filtrar Depto'}
                </button>
              </div>

              {/* Cuadrícula de Métricas */}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-2 rounded-lg bg-cd border border-[var(--bd)]">
                  <span className="text-[9px] uppercase font-semibold tx-mu block">Pedidos</span>
                  <span className="text-base font-bold font-mono tabular-nums text-[var(--tx)] block mt-0.5">
                    {deptoActivoInfo.pedidos}
                  </span>
                  <span className="text-[9px] tx-mu font-mono block">
                    {totalesNacionales.pedidos > 0 
                      ? `${((deptoActivoInfo.pedidos / totalesNacionales.pedidos) * 100).toFixed(1)}% país` 
                      : '0%'}
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-cd border border-[var(--bd)]">
                  <span className="text-[9px] uppercase font-semibold tx-mu block">Ventas</span>
                  <span className="text-base font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 block mt-0.5">
                    {formatCurrency(deptoActivoInfo.ventas)}
                  </span>
                  <span className="text-[9px] tx-mu font-mono block">
                    Ticket: {formatCurrency(deptoActivoInfo.ticketPromedio)}
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-cd border border-[var(--bd)]">
                  <span className="text-[9px] uppercase font-semibold tx-mu block">Efectividad COD</span>
                  <span className={`text-sm font-bold font-mono tabular-nums block mt-0.5 ${
                    deptoActivoInfo.tasaEntrega >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
                    deptoActivoInfo.tasaEntrega >= 60 ? 'text-amber-600 dark:text-amber-400' :
                    'text-rose-600 dark:text-rose-400'
                  }`}>
                    {deptoActivoInfo.tasaEntrega.toFixed(1)}%
                  </span>
                  <span className="text-[9px] tx-mu font-mono block">
                    {deptoActivoInfo.entregados} entregados
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-cd border border-[var(--bd)]">
                  <span className="text-[9px] uppercase font-semibold tx-mu block">Cancelaciones</span>
                  <span className="text-sm font-bold font-mono tabular-nums text-rose-600 dark:text-rose-400 block mt-0.5">
                    {deptoActivoInfo.cancelados}
                  </span>
                  <span className="text-[9px] tx-mu font-mono block">
                    {deptoActivoInfo.enCamino} en ruta
                  </span>
                </div>
              </div>

              {/* DESGLOSE DE MUNICIPIOS DEL DEPARTAMENTO */}
              <div className="pt-2 border-t border-[var(--bd)]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tx-mu flex items-center gap-1">
                    <Building2 size={12} className="tx-mu" />
                    Municipios / Zonas en {deptoActivoInfo.nombre}:
                  </span>
                  <span className="text-[10px] font-mono tabular-nums tx-mu font-semibold">
                    {municipiosDelDeptoActivo.length} detectados
                  </span>
                </div>

                {municipiosDelDeptoActivo.length > 0 ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {municipiosDelDeptoActivo.map(m => {
                      const pct = deptoActivoInfo.pedidos > 0 
                        ? ((m.pedidos / deptoActivoInfo.pedidos) * 100).toFixed(0) 
                        : '0';

                      return (
                        <div key={m.municipio} className="p-2 rounded-lg bg-cd border border-[var(--bd)] text-xs flex items-center justify-between">
                          <div className="min-w-0 pr-2">
                            <span className="font-semibold text-[var(--tx)] truncate block">
                              {m.municipio}
                            </span>
                            <span className="text-[10px] tx-mu font-mono tabular-nums block">
                              Efectividad: {m.tasaEntrega.toFixed(0)}% · {formatCurrency(m.ventas)}
                            </span>
                          </div>
                          <div className="text-right shrink-0 font-mono tabular-nums">
                            <span className="font-bold text-xs text-[var(--tx)] block">
                              {m.pedidos} ord
                            </span>
                            <span className="text-[9px] tx-mu block">
                              ({pct}%)
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-2.5 rounded-lg bg-cd border border-[var(--bd)] text-center text-[11px] tx-mu">
                    Sin pedidos registrados en este departamento para el rango actual.
                  </div>
                )}
              </div>

              {/* Top Productos en el Departamento */}
              {deptoActivoInfo.topProductos.length > 0 && (
                <div className="pt-2 border-t border-[var(--bd)]">
                  <span className="text-[10px] font-semibold uppercase tx-mu block mb-1.5">
                    Top Productos más vendidos:
                  </span>
                  <div className="space-y-1">
                    {deptoActivoInfo.topProductos.map((p, idx) => (
                      <div key={p.nombre} className="flex items-center justify-between text-xs py-1 px-2 rounded-lg bg-cd border border-[var(--bd)]">
                        <span className="truncate flex-1 pr-2">
                          <strong className="font-mono tx-mu">0{idx + 1}</strong> {p.nombre}
                        </span>
                        <span className="font-mono tabular-nums font-semibold text-[10px] tx-mu shrink-0">
                          {p.cantidad} uds
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="p-5 rounded-xl bg-sf border border-[var(--bd)] text-center text-xs tx-mu flex flex-col items-center justify-center py-10">
              <Compass size={26} className="tx-mu opacity-60 mb-2" />
              <span className="font-semibold text-[var(--tx)]">Explora la Geografía de El Salvador</span>
              <span className="text-[11px] mt-1">Pasa el cursor o haz clic en cualquier departamento para desglosar sus municipios y métricas de entrega.</span>
            </div>
          )}

          {/* Ranking Top 5: Departamentos vs Municipios */}
          <div className="p-4 rounded-xl bg-sf border border-[var(--bd)] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[var(--tx)] flex items-center gap-1.5">
                <TrendingUp size={13} className="tx-mu" /> Ranking Nacional
              </span>

              {/* Toggle Departamentos vs Municipios */}
              <div className="flex bg-cd p-0.5 rounded-lg border border-[var(--bd)] text-[10px] font-semibold">
                <button
                  onClick={() => setVistaRanking('deptos')}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    vistaRanking === 'deptos' ? 'bg-[var(--tx)] text-[var(--cd)]' : 'tx-mu'
                  }`}
                >
                  Deptos
                </button>
                <button
                  onClick={() => setVistaRanking('municipios')}
                  className={`px-2 py-1 rounded-md transition-colors ${
                    vistaRanking === 'municipios' ? 'bg-[var(--tx)] text-[var(--cd)]' : 'tx-mu'
                  }`}
                >
                  Municipios
                </button>
              </div>
            </div>

            {vistaRanking === 'deptos' ? (
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
                            index === 1 ? 'bg-slate-400 text-white' :
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
            ) : (
              /* Ranking por Municipios / Zonas */
              <div className="space-y-2">
                {statsPorMunicipio.slice(0, 5).map((m, index) => {
                  const maxMuni = statsPorMunicipio[0]?.pedidos || 1;
                  const pctMuni = Math.min(Math.round((m.pedidos / maxMuni) * 100), 100);

                  return (
                    <div
                      key={`${m.departamento}_${m.municipio}`}
                      onClick={() => onSeleccionarDepto(deptoSeleccionado === m.departamento ? null : m.departamento)}
                      className="p-2 rounded-xl border border-[var(--bd)] bg-cd hover:border-[var(--ac)] cursor-pointer transition-all"
                    >
                      <div className="flex items-center justify-between text-xs mb-1">
                        <div className="min-w-0 pr-2">
                          <span className="font-bold text-[var(--tx)] flex items-center gap-1.5 truncate">
                            <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-600 flex items-center justify-center text-[9px] font-black shrink-0">
                              {index + 1}
                            </span>
                            <span className="truncate">{m.municipio}</span>
                          </span>
                          <span className="text-[9px] tx-mu pl-5 block">
                            {m.departamento}
                          </span>
                        </div>
                        <span className="font-mono font-bold text-xs text-indigo-600 shrink-0">
                          {m.pedidos} ord
                        </span>
                      </div>

                      <div className="w-full h-1.5 bg-sf rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-600 rounded-full transition-all"
                          style={{ width: `${pctMuni}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
