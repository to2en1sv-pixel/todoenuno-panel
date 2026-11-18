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
import { fetchStockItems, fetchProductVariants, identifyDuplicateVariantStockRows } from '@/lib/inventory';
import { buildCatalogResolutionIndex } from '@/lib/catalogAliases';
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
  toElSalvadorDateKey,
} from '@/lib/rentabilidad';
import { normalizarDepartamento } from '@/data/elSalvadorDeptos';
import type { GastoPublicidad } from '@/types/rentabilidad';
import type { StockItem, ProductVariant } from '@/types/inventory';

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
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [variantsDb, setVariantsDb] = useState<ProductVariant[]>([]);
  const [productosDb, setProductosDb] = useState<any[]>([]);
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
        .select('id,total,sku,catalogo_sku,items,codigo_anuncio,created_at,estado,departamento,courier,metodo_pago')
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
        const ymd7 = toElSalvadorDateKey(hace7Dias);
        queryOrdenes = queryOrdenes.gte('created_at', iso7);
        queryGastos = queryGastos.gte('fecha', ymd7);
      }
      // 'historico' no aplica filtro de fecha

      const [resOrdenes, resGastos, resOrdenesAnterior, stockRes, variantsRes, prodRes] = await Promise.all([
        queryOrdenes,
        queryGastos,
        supabase
          .from('whatsapp_orders')
          .select('total,estado')
          .neq('estado', 'cancelado')
          .gte('created_at', anterior.isoInicio)
          .lt('created_at', anterior.isoFinExclusivo),
        fetchStockItems(),
        fetchProductVariants(),
        supabase.from('productos').select('*'),
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
      setStockItems(stockRes.items || []);
      setVariantsDb(variantsRes || []);
      setProductosDb(prodRes.data || []);
      setVentasMesAnterior(
        (resOrdenesAnterior.data || [])
          .filter((orden: any) => String(orden.estado || '').toLowerCase() !== 'cancelado')
          .reduce((acc, orden: any) => acc + (Number(orden.total) || 0), 0)
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

  const catalogIndex = useMemo(() => {
    const { duplicateChildSkuSet } = identifyDuplicateVariantStockRows(stockItems, variantsDb);
    return buildCatalogResolutionIndex({
      stockItems,
      variants: variantsDb,
      productosDb,
      duplicateChildSkuSet,
    });
  }, [stockItems, variantsDb, productosDb]);

  // Órdenes filtradas por departamento si el usuario seleccionó uno en el mapa
  const ordenesFiltradas = useMemo(() => {
    if (!deptoSeleccionado) return ordenes;
    return ordenes.filter(o => normalizarDepartamento(o.departamento) === deptoSeleccionado);
  }, [ordenes, deptoSeleccionado]);

  // Serie diaria para el gráfico de ingresos (ya excluye cancelados internamente)
  const serie = useMemo(() => {
    return serieDiaria(ordenesFiltradas, mes);
  }, [ordenesFiltradas, mes]);

  // KPIs Generales del período (ventas, ticket y ROAS excluyen pedidos cancelados; efectividad COD usa solo cerrados reales)
  const kpis = useMemo(() => {
    const totalPedidos = ordenesFiltradas.length;
    const gasto = deptoSeleccionado ? 0 : gastos.reduce((acc, g) => acc + (Number(g.monto) || 0), 0);

    let ventas = 0;
    let pedidosActivos = 0;
    let entregados = 0;
    let cancelados = 0;
    let enRuta = 0;

    ordenesFiltradas.forEach(o => {
      const est = String(o.estado || '').toLowerCase();
      if (est === 'cancelado') {
        cancelados++;
      } else {
        ventas += Number(o.total) || 0;
        pedidosActivos++;
        if (est === 'entregado') entregados++;
        else if (est === 'en_camino' || est === 'por_empacar' || est === 'nuevo' || est === 'programado') enRuta++;
      }
    });

    const cerrados = entregados + cancelados;
    const tasaEntrega: number | null = cerrados > 0 ? (entregados / cerrados) * 100 : null;
    const ticketPromedio = pedidosActivos > 0 ? ventas / pedidosActivos : 0;

    const variacion =
      ventasMesAnterior > 0 && !deptoSeleccionado
        ? ((ventas - ventasMesAnterior) / ventasMesAnterior) * 100
        : null;

    return {
      ventas,
      pedidos: totalPedidos,
      pedidosActivos,
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
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16">
      {/* Encabezado */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Analítica
          </h1>
          <p className="text-xs text-[var(--mu)] mt-1">
            Inteligencia territorial en 14 departamentos, efectividad COD y comportamiento de ventas
          </p>
        </div>

        {/* Selector de rango temporal y actualizar */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex bg-sf p-1 rounded-lg border border-[var(--bd)] text-xs font-medium">
            {[
              { id: 'este_mes', label: 'Este mes' },
              { id: 'mes_anterior', label: 'Mes ant.' },
              { id: 'ultimos_7_dias', label: '7 días' },
              { id: 'historico', label: 'Todo' },
            ].map(r => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRangoTiempo(r.id as RangoTiempo)}
                className={`px-3 py-1 rounded-md transition-colors whitespace-nowrap ${
                  rangoTiempo === r.id
                    ? 'bg-cd text-[var(--tx)] font-semibold border border-[var(--bd)]'
                    : 'text-[var(--mu)] hover:text-[var(--tx)]'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {(rangoTiempo === 'este_mes' || rangoTiempo === 'mes_anterior') && (
            <input
              id="mes"
              type="month"
              value={mes}
              onChange={(e) => setMes(e.target.value || mesActual())}
              className="rounded-lg border border-[var(--bd)] bg-cd px-3 py-1.5 text-xs font-medium text-[var(--tx)] outline-none focus:border-[var(--tx)]"
            />
          )}

          <button
            type="button"
            onClick={() => void cargarDatos()}
            disabled={cargando}
            className="p-2 border border-[var(--bd)] bg-cd hover:bg-sf rounded-lg text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
            title="Actualizar analítica"
          >
            <RefreshCw size={14} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-600 dark:text-rose-400 flex items-center justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filtro de departamento activo */}
      {deptoSeleccionado && (
        <div className="flex items-center justify-between bg-cd border border-[var(--bd)] px-4 py-2.5 rounded-xl text-xs">
          <div className="flex items-center gap-2 text-[var(--tx)]">
            <MapPin size={14} className="text-[var(--ac)] shrink-0" />
            <span>
              Filtrando por departamento: <strong className="font-semibold">{deptoSeleccionado}</strong>{' '}
              <span className="text-[var(--mu)] tabular-nums">({kpis.pedidos} pedidos)</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setDeptoSeleccionado(null)}
            className="flex items-center gap-1 font-semibold text-xs px-2.5 py-1 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 transition-opacity"
          >
            <X size={12} /> Ver todo El Salvador
          </button>
        </div>
      )}

      {/* Franja unificada de 5 KPIs */}
      <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-[var(--bd)]">
        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Facturación total</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1.5">
            {formatCurrency(kpis.ventas)}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
            {kpis.variacion !== null ? `vs mes ant.: ${formatPorcentaje(kpis.variacion)}` : `${kpis.pedidosActivos} órdenes activas`}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Volumen de pedidos</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
            {kpis.pedidos} <span className="text-xs font-normal font-sans text-[var(--mu)]">guías</span>
          </div>
          <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
            {kpis.entregados} cobrados · {kpis.enRuta} en ruta
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Efectividad COD</div>
          <div
            className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${
              kpis.tasaEntrega === null
                ? 'text-[var(--mu)]'
                : kpis.tasaEntrega >= 80
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : kpis.tasaEntrega >= 65
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {kpis.tasaEntrega !== null ? `${kpis.tasaEntrega.toFixed(1)}%` : '—'}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
            {kpis.entregados + kpis.cancelados > 0
              ? `${kpis.cancelados} cancelados / dev.`
              : 'Sin pedidos cerrados aún'}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Ticket promedio</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
            {formatCurrency(kpis.ticketPromedio)}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1">Sobre pedidos no cancelados</div>
        </div>

        <div className="p-5 col-span-2 md:col-span-1">
          <div className="text-xs font-medium text-[var(--mu)]">ROAS global ads</div>
          <div className={`text-2xl font-bold font-mono tabular-nums mt-1.5 ${roasColorClass(kpis.roasGlobal)}`}>
            {formatRoas(kpis.roasGlobal)}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
            Inversión: {formatCurrency(kpis.gasto)}
          </div>
        </div>
      </section>

      {/* Navegación por pestañas con línea inferior */}
      <nav className="flex items-center gap-6 border-b border-[var(--bd)] overflow-x-auto">
        {[
          { id: 'mapa', label: 'Mapa El Salvador (14 Deptos)' },
          { id: 'logistica', label: 'Rendimiento Logístico COD' },
          { id: 'ventas', label: 'Tendencias & Productos' },
        ].map(t => {
          const active = tabActiva === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTabActiva(t.id as TabAnalitica)}
              className={`pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                active
                  ? 'border-[var(--tx)] text-[var(--tx)]'
                  : 'border-transparent text-[var(--mu)] hover:text-[var(--tx)]'
              }`}
            >
              {t.label}
            </button>
          );
        })}

        <Link
          to="/ltv"
          className="pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 border-transparent text-[var(--mu)] hover:text-[var(--tx)] transition-colors ml-auto"
          title="Ir al módulo de Fidelización, LTV & Ofertas Flash"
        >
          Fidelización &amp; LTV →
        </Link>
      </nav>

      {/* Contenido según pestaña */}
      {cargando ? (
        <div className="text-center py-16 bg-cd rounded-xl border border-[var(--bd)] text-[var(--mu)] text-xs">
          Cargando analítica territorial y de pedidos...
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {tabActiva === 'mapa' && (
            <MapaElSalvadorCalor
              pedidosData={ordenes}
              deptoSeleccionado={deptoSeleccionado}
              onSeleccionarDepto={setDeptoSeleccionado}
              catalogIndex={catalogIndex}
            />
          )}

          {tabActiva === 'logistica' && (
            <AnaliticaLogisticaCod pedidosData={ordenesFiltradas} />
          )}

          {tabActiva === 'ventas' && (
            <div className="flex flex-col gap-6">
              <section className="rounded-xl border border-[var(--bd)] bg-cd overflow-hidden">
                <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--tx)]">
                      Facturación diaria en el período
                    </h3>
                    <p className="text-xs text-[var(--mu)] mt-0.5">
                      Evolución diaria de ventas en USD (excluye cancelados)
                    </p>
                  </div>
                  <span className="text-xs font-medium text-[var(--mu)] tabular-nums">
                    {etiquetaMes(mes)}
                  </span>
                </div>

                <div className="p-5">
                  <VentasLineChart data={serie} />
                </div>
              </section>

              <AnaliticaHorariaProductos pedidosData={ordenesFiltradas} catalogIndex={catalogIndex} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
