import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { 
  BarChart3, 
  MapPin, 
  Truck, 
  Calendar, 
  RefreshCw, 
  TrendingUp, 
  CheckCircle2, 
  DollarSign, 
  Percent,
  Filter,
  X,
  Sparkles,
  Layers,
  Zap
} from 'lucide-react';
import { VentasLineChart } from '@/components/charts/VentasLineChart';
import { MapaElSalvadorCalor } from '@/components/analitica/MapaElSalvadorCalor';
import { AnaliticaLogisticaCod } from '@/components/analitica/AnaliticaLogisticaCod';
import { AnaliticaHorariaProductos } from '@/components/analitica/AnaliticaHorariaProductos';
import {
  etiquetaMes,
  formatCurrency,
  formatNumber,
  formatPorcentaje,
  formatRoas,
  mesActual,
  mesAnterior,
  rangoMes,
  roasColorClass,
  serieDiaria,
} from '@/lib/rentabilidad';
import { normalizarDepartamento } from '@/data/elSalvadorDeptos';
import type { GastoPublicidad } from '@/types/rentabilidad';

type RangoTiempo = 'este_mes' | 'mes_anterior' | 'ultimos_7_dias' | 'historico';
type TabAnalitica = 'mapa' | 'logistica' | 'ventas';

export function AnaliticaPage() {
  const [mes, setMes] = useState<string>(mesActual());
  const [rangoTiempo, setRangoTiempo] = useState<RangoTiempo>('este_mes');
  const [tabActiva, setTabActiva] = useState<TabAnalitica>('mapa');

  // Filtro activo por departamento de El Salvador
  const [deptoSeleccionado, setDeptoSeleccionado] = useState<string | null>(null);

  const [ordenes, setOrdenes] = useState<any[]>([]);
  const [gastos, setGastos] = useState<GastoPublicidad[]>([]);
  const [ventasMesAnterior, setVentasMesAnterior] = useState<number>(0);
  const [cargando, setCargando] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);

    try {
      const actual = rangoMes(mes);
      const anterior = rangoMes(mesAnterior(mes));

      let queryOrdenes = supabase
        .from('whatsapp_orders')
        .select('id,total,sku,catalogo_sku,codigo_anuncio,created_at,estado,departamento,courier,metodo_pago')
        .order('created_at', { ascending: false });

      let queryGastos = supabase
        .from('gastos_publicidad')
        .select('id,fecha,codigo_anuncio,plataforma,monto,notas,created_at')
        .order('fecha', { ascending: false });

      // Aplicar filtros de fecha según el rango seleccionado
      if (rangoTiempo === 'este_mes') {
        queryOrdenes = queryOrdenes
          .gte('created_at', actual.isoInicio)
          .lt('created_at', actual.isoFinExclusivo);
        queryGastos = queryGastos
          .gte('fecha', actual.fechaInicio)
          .lte('fecha', actual.fechaFin);
      } else if (rangoTiempo === 'mes_anterior') {
        queryOrdenes = queryOrdenes
          .gte('created_at', anterior.isoInicio)
          .lt('created_at', anterior.isoFinExclusivo);
        queryGastos = queryGastos
          .gte('fecha', anterior.fechaInicio)
          .lte('fecha', anterior.fechaFin);
      } else if (rangoTiempo === 'ultimos_7_dias') {
        const hace7Dias = new Date();
        hace7Dias.setDate(hace7Dias.getDate() - 7);
        const iso7 = hace7Dias.toISOString();
        const ymd7 = hace7Dias.toISOString().slice(0, 10);
        queryOrdenes = queryOrdenes.gte('created_at', iso7);
        queryGastos = queryGastos.gte('fecha', ymd7);
      }
      // 'historico' no aplica filtro de fecha

      const [resOrdenes, resGastos, resOrdenesAnterior] = await Promise.all([
        queryOrdenes,
        queryGastos,
        supabase
          .from('whatsapp_orders')
          .select('total')
          .gte('created_at', anterior.isoInicio)
          .lt('created_at', anterior.isoFinExclusivo),
      ]);

      if (resOrdenes.error || resGastos.error || resOrdenesAnterior.error) {
        throw new Error(
          resOrdenes.error?.message ??
          resGastos.error?.message ??
          resOrdenesAnterior.error?.message ??
          'Error cargando datos de analítica.'
        );
      }

      setOrdenes(resOrdenes.data || []);
      setGastos(resGastos.data || []);
      setVentasMesAnterior(
        (resOrdenesAnterior.data || []).reduce(
          (acc, orden) => acc + (Number(orden.total) || 0),
          0
        )
      );
    } catch (err: any) {
      console.error('Error cargando analítica:', err);
      setError(err.message || 'Error cargando datos de analítica.');
    } finally {
      setCargando(false);
    }
  }, [mes, rangoTiempo]);

  useEffect(() => {
    void cargarDatos();
  }, [cargarDatos]);

  // Órdenes filtradas por departamento si el usuario seleccionó uno en el mapa
  const ordenesFiltradas = useMemo(() => {
    if (!deptoSeleccionado) return ordenes;
    return ordenes.filter(o => normalizarDepartamento(o.departamento) === deptoSeleccionado);
  }, [ordenes, deptoSeleccionado]);

  // Serie diaria para el gráfico de ingresos
  const serie = useMemo(() => {
    return serieDiaria(ordenesFiltradas, mes);
  }, [ordenesFiltradas, mes]);

  // KPIs Generales del período
  const kpis = useMemo(() => {
    const totalPedidos = ordenesFiltradas.length;
    const ventas = ordenesFiltradas.reduce((acc, o) => acc + (Number(o.total) || 0), 0);
    const gasto = deptoSeleccionado ? 0 : gastos.reduce((acc, g) => acc + (Number(g.monto) || 0), 0);

    let entregados = 0;
    let cancelados = 0;
    let enRuta = 0;

    ordenesFiltradas.forEach(o => {
      const est = String(o.estado || '').toLowerCase();
      if (est === 'entregado') entregados++;
      else if (est === 'cancelado') cancelados++;
      else if (est === 'en_camino' || est === 'por_empacar' || est === 'nuevo') enRuta++;
    });

    const cerrados = entregados + cancelados;
    const tasaEntrega = cerrados > 0 ? (entregados / cerrados) * 100 : (totalPedidos > 0 ? 80 : 0);
    const ticketPromedio = totalPedidos > 0 ? ventas / totalPedidos : 0;

    const variacion =
      ventasMesAnterior > 0 && !deptoSeleccionado
        ? ((ventas - ventasMesAnterior) / ventasMesAnterior) * 100
        : null;

    return {
      ventas,
      pedidos: totalPedidos,
      entregados,
      cancelados,
      enRuta,
      tasaEntrega,
      ticketPromedio,
      gasto,
      roasGlobal: gasto > 0 ? ventas / gasto : null,
      variacion,
    };
  }, [ordenesFiltradas, gastos, ventasMesAnterior, deptoSeleccionado]);

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-7xl mx-auto">
      {/* HEADER DE ANALÍTICA & FILTROS */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4 shadow-sm">
        <div className="min-w-0 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500 shrink-0">
              <BarChart3 size={22} />
            </span>
            <h1 className="text-lg sm:text-xl font-black text-[var(--tx)] tracking-tight whitespace-normal sm:whitespace-nowrap">
              Centro de Analítica & Mapa Demográfico COD
            </h1>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1 max-w-xl">
            Inteligencia territorial en los 14 departamentos de El Salvador, efectividad de entrega contra entrega y comportamiento de compra.
          </p>
        </div>

        {/* SELECTOR DE RANGOS TEMPORALES & REFRESH */}
        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <div className="flex bg-sf p-1 rounded-xl border border-[var(--bd)] text-xs font-semibold">
            {[
              { id: 'este_mes', label: 'Este Mes' },
              { id: 'mes_anterior', label: 'Mes Ant.' },
              { id: 'ultimos_7_dias', label: '7 Días' },
              { id: 'historico', label: 'Todo' }
            ].map(r => (
              <button
                key={r.id}
                onClick={() => setRangoTiempo(r.id as RangoTiempo)}
                className={`px-3 py-1 rounded-lg transition-colors whitespace-nowrap ${
                  rangoTiempo === r.id
                    ? 'bg-cd shadow-sm text-[var(--tx)] font-bold'
                    : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {/* Selector de Mes Específico si es Este Mes o Mes Anterior */}
          {(rangoTiempo === 'este_mes' || rangoTiempo === 'mes_anterior') && (
            <input
              id="mes"
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value || mesActual())}
              className="rounded-xl border border-[var(--bd)] bg-sf px-2.5 py-1 text-xs font-semibold outline-none focus:border-[var(--ac)]"
            />
          )}

          <button
            onClick={() => void cargarDatos()}
            disabled={cargando}
            className="p-2 border border-[var(--bd)] bg-sf hover:bg-cd rounded-xl text-xs font-bold transition-colors"
            title="Actualizar analítica"
          >
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* ERROR BANNER */}
      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3.5 text-xs text-rose-600 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold ml-2">✕</button>
        </div>
      )}

      {/* FILTRO DE DEPARTAMENTO ACTIVO (CHIP FLOTANTE) */}
      {deptoSeleccionado && (
        <div className="flex items-center justify-between bg-indigo-500/10 border border-indigo-500/30 text-indigo-600 px-4 py-2 rounded-xl text-xs font-semibold">
          <div className="flex items-center gap-2">
            <MapPin size={16} />
            <span>
              Filtrando métricas exclusivamente para: <strong>{deptoSeleccionado}</strong> ({kpis.pedidos} pedidos)
            </span>
          </div>
          <button
            onClick={() => setDeptoSeleccionado(null)}
            className="flex items-center gap-1 font-bold text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg hover:bg-indigo-700 transition-colors"
          >
            <X size={13} /> Ver Todo El Salvador
          </button>
        </div>
      )}

      {/* TARJETAS KPI PRINCIPALES */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Facturación Total</span>
          <div className="text-2xl font-black mt-1 font-mono text-emerald-600">
            {formatCurrency(kpis.ventas)}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">
            {kpis.variacion !== null ? `vs mes anterior: ${formatPorcentaje(kpis.variacion)}` : `${kpis.pedidos} pedidos`}
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Volumen de Pedidos</span>
          <div className="text-2xl font-black mt-1 font-mono text-[var(--tx)]">
            {kpis.pedidos} <span className="text-xs font-normal tx-mu">guías</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">
            {kpis.entregados} cobrados · {kpis.enRuta} en ruta
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Efectividad COD</span>
          <div className={`text-2xl font-black mt-1 font-mono ${
            kpis.tasaEntrega >= 80 ? 'text-emerald-500' :
            kpis.tasaEntrega >= 65 ? 'text-amber-500' :
            'text-rose-500'
          }`}>
            {kpis.tasaEntrega.toFixed(1)}%
          </div>
          <span className="text-[10px] tx-mu mt-1 block">
            {kpis.cancelados} cancelados / devueltos
          </span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Ticket Promedio</span>
          <div className="text-2xl font-black mt-1 font-mono text-indigo-500">
            {formatCurrency(kpis.ticketPromedio)}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Promedio por orden</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm col-span-2 sm:col-span-1">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">ROAS Global Ads</span>
          <div className={`text-2xl font-black mt-1 font-mono ${roasColorClass(kpis.roasGlobal)}`}>
            {formatRoas(kpis.roasGlobal)}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">
            Inversión: {formatCurrency(kpis.gasto)}
          </span>
        </div>
      </div>

      {/* PESTAÑAS DE VISTA ANALÍTICA */}
      <div className="flex bg-sf p-1.5 rounded-2xl border border-[var(--bd)] text-xs font-semibold gap-1">
        <button
          onClick={() => setTabActiva('mapa')}
          className={`flex-1 py-2 rounded-xl transition-all flex items-center justify-center gap-2 ${
            tabActiva === 'mapa'
              ? 'bg-cd shadow text-indigo-600 font-bold border border-[var(--bd)]'
              : 'tx-mu hover:text-[var(--tx)]'
          }`}
        >
          <MapPin size={16} /> Mapa Demográfico El Salvador (14 Deptos)
        </button>

        <button
          onClick={() => setTabActiva('logistica')}
          className={`flex-1 py-2 rounded-xl transition-all flex items-center justify-center gap-2 ${
            tabActiva === 'logistica'
              ? 'bg-cd shadow text-indigo-600 font-bold border border-[var(--bd)]'
              : 'tx-mu hover:text-[var(--tx)]'
          }`}
        >
          <Truck size={16} /> Rendimiento Logístico & Couriers COD
        </button>

        <button
          onClick={() => setTabActiva('ventas')}
          className={`flex-1 py-2 rounded-xl transition-all flex items-center justify-center gap-2 ${
            tabActiva === 'ventas'
              ? 'bg-cd shadow text-indigo-600 font-bold border border-[var(--bd)]'
              : 'tx-mu hover:text-[var(--tx)]'
          }`}
        >
          <BarChart3 size={16} /> Tendencias & Productos
        </button>

        <Link
          to="/ltv"
          className="flex-1 py-2 rounded-xl transition-all flex items-center justify-center gap-2 tx-mu hover:text-indigo-600 hover:bg-cd hover:shadow-sm"
          title="Ir al módulo de Fidelización, LTV & Ofertas Flash"
        >
          <Zap size={16} className="text-amber-500" /> Fidelización & LTV
        </Link>
      </div>

      {/* CONTENIDO SEGÚN LA PESTAÑA */}
      {cargando ? (
        <div className="text-center py-20 bg-cd rounded-2xl border border-[var(--bd)] tx-mu text-xs">
          Cargando y procesando analítica territorial y de pedidos...
        </div>
      ) : (
        <div className="space-y-6">
          {tabActiva === 'mapa' && (
            <MapaElSalvadorCalor
              pedidosData={ordenes}
              deptoSeleccionado={deptoSeleccionado}
              onSeleccionarDepto={setDeptoSeleccionado}
            />
          )}

          {tabActiva === 'logistica' && (
            <AnaliticaLogisticaCod
              pedidosData={ordenesFiltradas}
            />
          )}

          {tabActiva === 'ventas' && (
            <div className="space-y-6">
              {/* Gráfico de Ingresos Diarios */}
              <section className="rounded-2xl border border-[var(--bd)] bg-cd p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-[var(--tx)]">
                      Facturación Diaria en el Período
                    </h3>
                    <p className="text-xs tx-mu">
                      Evolución diaria de ventas en dólares americanos (USD).
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-sf border border-[var(--bd)]">
                    {etiquetaMes(mes)}
                  </span>
                </div>

                <div className="pt-2">
                  <VentasLineChart data={serie} />
                </div>
              </section>

              {/* Días de la semana y Productos */}
              <AnaliticaHorariaProductos
                pedidosData={ordenesFiltradas}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
