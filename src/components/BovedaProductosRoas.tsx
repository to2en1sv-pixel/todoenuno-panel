import { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Sparkles, 
  Search, 
  TrendingUp, 
  Calendar, 
  Flame, 
  Snowflake, 
  FlaskConical, 
  Ban, 
  Package, 
  ArrowUpRight, 
  DollarSign, 
  Tag, 
  Eye, 
  X, 
  Save, 
  Filter, 
  CheckCircle2, 
  AlertCircle,
  Clock,
  Layers,
  ChevronRight,
  RefreshCw,
  BarChart3
} from 'lucide-react';
import { formatCurrency, formatRoas, roasColorClass } from '@/lib/rentabilidad';
import type { 
  ProductoBovedaRoas, 
  CicloVidaProducto, 
  RendimientoMesProducto,
  GastoPublicidad 
} from '@/types/rentabilidad';

const MESES_NOMBRES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function BovedaProductosRoas() {
  const [cargando, setCargando] = useState(true);
  const [ordenes, setOrdenes] = useState<any[]>([]);
  const [gastos, setGastos] = useState<GastoPublicidad[]>([]);
  const [productosDb, setProductosDb] = useState<any[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroCiclo, setFiltroCiclo] = useState<string>('todos');
  const [ordenarPor, setOrdenarPor] = useState<'roas' | 'ventas' | 'gasto'>('roas');

  // Modal / Drawer de detalle de producto
  const [productoSeleccionado, setProductoSeleccionado] = useState<ProductoBovedaRoas | null>(null);
  const [notaEdicion, setNotaEdicion] = useState('');
  const [estadoEdicion, setEstadoEdicion] = useState<CicloVidaProducto>('escala');
  const [guardadoOk, setGuardadoOk] = useState(false);

  // Cargar todos los datos históricos
  const cargarHistorico = async () => {
    setCargando(true);
    try {
      const [resOrdenes, resGastos, resProd] = await Promise.all([
        supabase
          .from('whatsapp_orders')
          .select('id,total,sku,codigo_anuncio,created_at,estado')
          .neq('estado', 'cancelado'),
        supabase
          .from('gastos_publicidad')
          .select('*')
          .order('fecha', { ascending: false }),
        supabase
          .from('productos')
          .select('*')
      ]);

      setOrdenes(resOrdenes.data || []);
      setGastos(resGastos.data || []);
      setProductosDb(resProd.data || []);
    } catch (err) {
      console.error('Error cargando histórico para bóveda de ROAS:', err);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarHistorico();
  }, []);

  // Construcción de la Bóveda de Productos cruzando Orders + Ads Spend por SKU
  const boveda = useMemo<ProductoBovedaRoas[]>(() => {
    if (ordenes.length === 0 && gastos.length === 0) return [];

    // 1. Mapa de productos base
    const prodInfo = new Map<string, { nombre: string; image_url: string | null }>();
    productosDb.forEach(p => {
      const templateId = String(p.template_id || '').toUpperCase();
      prodInfo.set(templateId, {
        nombre: p.nombre_base || templateId,
        image_url: p.image_url || null
      });
    });

    // 2. Mapa de SKU a Anuncios y Ventas
    const skusMap = new Map<string, {
      sku: string;
      ventasTotales: number;
      pedidosTotales: number;
      anuncios: Set<string>;
      mesesVentas: { ventas: number; pedidos: number }[]; // 12 meses
    }>();

    // Inicializar helper para 12 meses
    const initMeses = () => Array.from({ length: 12 }, () => ({ ventas: 0, pedidos: 0, gasto: 0 }));

    ordenes.forEach(o => {
      const sku = (o.sku || 'SIN_SKU').trim().toUpperCase();
      const monto = Number(o.total || 0);
      const codigo = (o.codigo_anuncio || '').trim().toUpperCase();
      const fecha = o.created_at ? new Date(o.created_at) : new Date();
      const mesIdx = isNaN(fecha.getMonth()) ? 0 : fecha.getMonth(); // 0 a 11

      if (!skusMap.has(sku)) {
        skusMap.set(sku, {
          sku,
          ventasTotales: 0,
          pedidosTotales: 0,
          anuncios: new Set(),
          mesesVentas: initMeses()
        });
      }

      const item = skusMap.get(sku)!;
      item.ventasTotales += monto;
      item.pedidosTotales += 1;
      if (codigo) item.anuncios.add(codigo);
      if (item.mesesVentas[mesIdx]) {
        item.mesesVentas[mesIdx].ventas += monto;
        item.mesesVentas[mesIdx].pedidos += 1;
      }
    });

    // 3. Mapear Gastos de Anuncios a SKUs
    // Si el gasto tiene un codigo_anuncio, buscar a qué SKU pertenece
    const gastoPorSku = new Map<string, { totalGasto: number; mesesGasto: number[] }>();

    gastos.forEach(g => {
      const codGasto = (g.codigo_anuncio || '').trim().toUpperCase();
      const montoGasto = Number(g.monto || 0);
      const fechaGasto = g.fecha ? new Date(g.fecha) : new Date();
      const mesGastoIdx = isNaN(fechaGasto.getMonth()) ? 0 : fechaGasto.getMonth();

      // Buscar si el código coincide directamente con algún SKU o si algún SKU tiene este anuncio
      let skuEncontrado: string | null = null;

      for (const [s, data] of skusMap.entries()) {
        if (data.anuncios.has(codGasto) || codGasto.includes(s) || s.includes(codGasto)) {
          skuEncontrado = s;
          break;
        }
      }

      // Si no se encontró por orden, buscar si coincide con el SKU de algún producto
      if (!skuEncontrado) {
        skuEncontrado = codGasto || 'GENERAL';
      }

      if (!gastoPorSku.has(skuEncontrado)) {
        gastoPorSku.set(skuEncontrado, {
          totalGasto: 0,
          mesesGasto: Array.from({ length: 12 }, () => 0)
        });
      }

      const gItem = gastoPorSku.get(skuEncontrado)!;
      gItem.totalGasto += montoGasto;
      if (gItem.mesesGasto[mesGastoIdx] !== undefined) {
        gItem.mesesGasto[mesGastoIdx] += montoGasto;
      }
    });

    // 4. Consolidar la lista de productos de la bóveda
    const listaConsolidada: ProductoBovedaRoas[] = [];
    const skusProcesados = new Set<string>();

    skusMap.forEach((vData, sku) => {
      skusProcesados.add(sku);
      const gData = gastoPorSku.get(sku) || { totalGasto: 0, mesesGasto: Array(12).fill(0) };
      const info = prodInfo.get(sku);

      // Calcular desempeño de los 12 meses
      const mesesDesempeno: RendimientoMesProducto[] = MESES_NOMBRES.map((nombreMes, idx) => {
        const vMes = vData.mesesVentas[idx]?.ventas || 0;
        const pMes = vData.mesesVentas[idx]?.pedidos || 0;
        const gMes = gData.mesesGasto[idx] || 0;
        const roasMes = gMes > 0 ? vMes / gMes : (vMes > 0 ? 99 : null);

        return {
          mesNumero: idx + 1,
          nombreMes,
          ventas: vMes,
          gasto: gMes,
          pedidos: pMes,
          roas: roasMes
        };
      });

      // Encontrar mejor y peor mes con actividad de pauta
      let mejorMes: { nombre: string; roas: number } | null = null;
      let peorMes: { nombre: string; roas: number } | null = null;

      mesesDesempeno.forEach(m => {
        if (m.gasto > 0 && m.roas !== null) {
          if (!mejorMes || m.roas > mejorMes.roas) {
            mejorMes = { nombre: m.nombreMes, roas: m.roas };
          }
          if (!peorMes || m.roas < peorMes.roas) {
            peorMes = { nombre: m.nombreMes, roas: m.roas };
          }
        }
      });

      const gastoTotal = gData.totalGasto;
      const ventasTotales = vData.ventasTotales;
      const pedidosTotales = vData.pedidosTotales;
      const roasHistorico = gastoTotal > 0 ? ventasTotales / gastoTotal : null;
      const cpaHistorico = pedidosTotales > 0 && gastoTotal > 0 ? gastoTotal / pedidosTotales : null;
      const ticketPromedio = pedidosTotales > 0 ? ventasTotales / pedidosTotales : 0;

      // Leer estado personalizado de localStorage
      let estadoCiclo: CicloVidaProducto = 'escala';
      let notasEstrategicas = '';
      try {
        const guardado = localStorage.getItem(`roas_vault_${sku}`);
        if (guardado) {
          const parsed = JSON.parse(guardado);
          if (parsed.estadoCiclo) estadoCiclo = parsed.estadoCiclo;
          if (parsed.notasEstrategicas) notasEstrategicas = parsed.notasEstrategicas;
        } else {
          // Clasificación heurística automática
          if (gastoTotal === 0 && ventasTotales > 0) estadoCiclo = 'hibernacion';
          else if (gastoTotal < 50) estadoCiclo = 'testeo';
          else if (roasHistorico && roasHistorico >= 2.0) estadoCiclo = 'escala';
          else if (roasHistorico && roasHistorico < 1.2) estadoCiclo = 'quemado';
          else estadoCiclo = 'hibernacion';
        }
      } catch {}

      listaConsolidada.push({
        sku,
        nombre: info?.nombre || sku,
        image_url: info?.image_url || null,
        ventasTotales,
        gastoTotal,
        pedidosTotales,
        roasHistorico,
        cpaHistorico,
        ticketPromedio,
        estadoCiclo,
        mesesDesempeno,
        mejorMes,
        peorMes,
        anunciosAsociados: Array.from(vData.anuncios),
        activo: true,
        notasEstrategicas
      });
    });

    // Agregar gastos que no se asociaron a un SKU conocido
    gastoPorSku.forEach((gData, codigo) => {
      if (!skusProcesados.has(codigo) && gData.totalGasto > 0) {
        listaConsolidada.push({
          sku: codigo,
          nombre: `Campaña ${codigo}`,
          image_url: null,
          ventasTotales: 0,
          gastoTotal: gData.totalGasto,
          pedidosTotales: 0,
          roasHistorico: 0,
          cpaHistorico: null,
          ticketPromedio: 0,
          estadoCiclo: 'testeo',
          mesesDesempeno: MESES_NOMBRES.map((nombreMes, idx) => ({
            mesNumero: idx + 1,
            nombreMes,
            ventas: 0,
            gasto: gData.mesesGasto[idx] || 0,
            pedidos: 0,
            roas: 0
          })),
          mejorMes: null,
          peorMes: null,
          anunciosAsociados: [codigo],
          activo: false
        });
      }
    });

    return listaConsolidada;
  }, [ordenes, gastos, productosDb]);

  // Filtros y ordenamiento
  const productosFiltrados = useMemo(() => {
    let list = boveda;

    // Filtro texto
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      list = list.filter(p => 
        p.sku.toLowerCase().includes(q) || 
        p.nombre.toLowerCase().includes(q) ||
        p.anunciosAsociados.some(a => a.toLowerCase().includes(q))
      );
    }

    // Filtro por ciclo de vida
    if (filtroCiclo !== 'todos') {
      list = list.filter(p => p.estadoCiclo === filtroCiclo);
    }

    // Ordenamiento
    return [...list].sort((a, b) => {
      if (ordenarPor === 'roas') {
        return (b.roasHistorico || 0) - (a.roasHistorico || 0);
      }
      if (ordenarPor === 'ventas') {
        return b.ventasTotales - a.ventasTotales;
      }
      return b.gastoTotal - a.gastoTotal;
    });
  }, [boveda, busqueda, filtroCiclo, ordenarPor]);

  // KPIs de la Bóveda
  const kpisBoveda = useMemo(() => {
    let gastoTotal = 0;
    let ventasTotales = 0;
    let ganadores = 0;
    let hibernando = 0;

    boveda.forEach(p => {
      gastoTotal += p.gastoTotal;
      ventasTotales += p.ventasTotales;
      if (p.roasHistorico && p.roasHistorico >= 2.5) ganadores++;
      if (p.estadoCiclo === 'hibernacion') hibernando++;
    });

    return {
      totalProductos: boveda.length,
      gastoTotal,
      ventasTotales,
      roasGlobal: gastoTotal > 0 ? ventasTotales / gastoTotal : 0,
      ganadores,
      hibernando
    };
  }, [boveda]);

  // Mes actual para alerta de temporada
  const mesActualNombre = useMemo(() => {
    const idx = new Date().getMonth();
    return MESES_NOMBRES[idx];
  }, []);

  // Abrir detalle
  const handleAbrirDetalle = (p: ProductoBovedaRoas) => {
    setProductoSeleccionado(p);
    setNotaEdicion(p.notasEstrategicas || '');
    setEstadoEdicion(p.estadoCiclo);
    setGuardadoOk(false);
  };

  // Guardar estado y notas del producto en la Bóveda
  const handleGuardarConfig = () => {
    if (!productoSeleccionado) return;
    const key = `roas_vault_${productoSeleccionado.sku}`;
    localStorage.setItem(key, JSON.stringify({
      estadoCiclo: estadoEdicion,
      notasEstrategicas: notaEdicion
    }));

    setProductoSeleccionado(prev => prev ? ({
      ...prev,
      estadoCiclo: estadoEdicion,
      notasEstrategicas: notaEdicion
    }) : null);

    setGuardadoOk(true);
    setTimeout(() => setGuardadoOk(false), 2000);
  };

  const getBadgeCiclo = (ciclo: CicloVidaProducto) => {
    switch (ciclo) {
      case 'escala':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/30 flex items-center gap-1">
            <Flame size={11} className="text-emerald-500" /> Escala Activa
          </span>
        );
      case 'hibernacion':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/10 text-sky-600 border border-sky-500/30 flex items-center gap-1">
            <Snowflake size={11} className="text-sky-500" /> En Hibernación (Cíclico)
          </span>
        );
      case 'testeo':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/30 flex items-center gap-1">
            <FlaskConical size={11} className="text-amber-500" /> En Testeo
          </span>
        );
      case 'quemado':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/30 flex items-center gap-1">
            <Ban size={11} className="text-rose-500" /> Quemado / Pausado
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Encabezado de la Bóveda */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="text-amber-500" size={24} />
            <h2 className="text-xl font-black">Bóveda de Productos Ganadores & Ciclos de Pauta</h2>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">
              Memoria Histórica
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1">
            Inteligencia acumulativa a largo plazo: descubre qué productos son estacionales, qué meses rinden más y reactiva campañas ganadoras sin reinventar la rueda.
          </p>
        </div>

        <button
          onClick={cargarHistorico}
          disabled={cargando}
          className="p-2 border border-[var(--bd)] bg-sf hover:bg-cd rounded-xl text-xs font-bold transition-colors"
          title="Actualizar datos"
        >
          <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Tarjetas KPI de la Bóveda */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Productos Pautados</span>
          <div className="text-2xl font-black mt-1 text-[var(--tx)]">
            {kpisBoveda.totalProductos} <span className="text-xs font-normal tx-mu">SKUs</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Con inversión registrada</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Ganadores Comprobados</span>
          <div className="text-2xl font-black mt-1 text-emerald-500">
            {kpisBoveda.ganadores} <span className="text-xs font-normal tx-mu">productos</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">ROAS histórico &gt; 2.5x</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">En Hibernación (Cíclicos)</span>
          <div className="text-2xl font-black mt-1 text-sky-500">
            {kpisBoveda.hibernando} <span className="text-xs font-normal tx-mu">listos</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Listos para relanzar en su temporada</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">ROAS Acumulado Global</span>
          <div className="text-2xl font-black mt-1 text-[var(--ac)]">
            {formatRoas(kpisBoveda.roasGlobal)}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Facturado: {formatCurrency(kpisBoveda.ventasTotales)}</span>
        </div>
      </div>

      {/* Barra de Búsqueda y Filtros de Ciclo de Vida */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-cd p-3 rounded-2xl border border-[var(--bd)]">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
          <input
            type="text"
            placeholder="Buscar por SKU, producto o anuncio..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-[var(--ac)]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Selector de Ciclo de Vida */}
          <div className="flex bg-sf p-1 rounded-xl text-xs font-semibold overflow-x-auto">
            {[
              { id: 'todos', label: 'Todos' },
              { id: 'escala', label: '🔥 Escala' },
              { id: 'hibernacion', label: '❄️ Hibernando' },
              { id: 'testeo', label: '🧪 Testeo' },
              { id: 'quemado', label: '🛑 Pausados' }
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setFiltroCiclo(f.id)}
                className={`px-3 py-1 rounded-lg transition-colors whitespace-nowrap ${
                  filtroCiclo === f.id ? 'bg-cd shadow-sm text-[var(--tx)] font-bold' : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Selector de Ordenamiento */}
          <select
            value={ordenarPor}
            onChange={e => setOrdenarPor(e.target.value as any)}
            className="p-1.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-semibold outline-none"
          >
            <option value="roas">Mayor ROAS Histórico</option>
            <option value="ventas">Mayor Facturación ($)</option>
            <option value="gasto">Mayor Inversión en Ads ($)</option>
          </select>
        </div>
      </div>

      {/* LISTA / GRID DE PRODUCTOS EN LA BÓVEDA */}
      {cargando ? (
        <div className="text-center py-16 tx-mu bg-cd rounded-2xl border border-[var(--bd)]">
          Cargando expediente histórico de la bóveda...
        </div>
      ) : productosFiltrados.length === 0 ? (
        <div className="text-center py-16 tx-mu bg-cd rounded-2xl border border-[var(--bd)]">
          No se encontraron productos con los filtros seleccionados.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {productosFiltrados.map(prod => {
            const esTemporadaAlta = prod.mejorMes && prod.mejorMes.nombre === mesActualNombre;

            return (
              <div
                key={prod.sku}
                onClick={() => handleAbrirDetalle(prod)}
                className="bg-cd border border-[var(--bd)] rounded-2xl p-4 flex flex-col justify-between hover:border-[var(--ac)] hover:shadow-md transition-all cursor-pointer group relative overflow-hidden"
              >
                {/* Alerta de Temporada Alta en Vivo */}
                {esTemporadaAlta && (
                  <div className="absolute top-0 right-0 bg-gradient-to-l from-amber-500 to-orange-500 text-white text-[9px] font-black uppercase px-3 py-0.5 rounded-bl-xl shadow flex items-center gap-1">
                    <Flame size={11} /> ¡Temporada Alta ({mesActualNombre})!
                  </div>
                )}

                <div>
                  {/* Cabecera del Producto */}
                  <div className="flex items-start gap-3">
                    <div className="w-14 h-14 rounded-xl bg-sf border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                      {prod.image_url ? (
                        <img src={prod.image_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-2xl select-none">📦</span>
                      )}
                    </div>

                    <div className="flex-1 min-w-0 pr-4">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono tx-mu uppercase">#{prod.sku}</span>
                      </div>
                      <h3 className="font-bold text-xs text-[var(--tx)] truncate leading-tight mt-0.5">
                        {prod.nombre}
                      </h3>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {getBadgeCiclo(prod.estadoCiclo)}
                      </div>
                    </div>
                  </div>

                  {/* Métricas Financieras Acumuladas */}
                  <div className="grid grid-cols-3 gap-2 mt-4 p-2.5 bg-sf rounded-xl border border-[var(--bd)] text-center">
                    <div>
                      <span className="text-[9px] uppercase font-bold tx-mu block">Invertido</span>
                      <span className="text-xs font-mono font-bold text-[var(--tx)] mt-0.5 block">
                        {formatCurrency(prod.gastoTotal)}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] uppercase font-bold tx-mu block">Ventas</span>
                      <span className="text-xs font-mono font-bold text-emerald-600 mt-0.5 block">
                        {formatCurrency(prod.ventasTotales)}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] uppercase font-bold tx-mu block">ROAS Acum.</span>
                      <span className={`text-sm font-mono font-black mt-0.5 block ${roasColorClass(prod.roasHistorico)}`}>
                        {formatRoas(prod.roasHistorico)}
                      </span>
                    </div>
                  </div>

                  {/* CALENDARIO CÍCLICO / MINIMAPA DE 12 MESES */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] tx-mu mb-1 font-semibold">
                      <span>Ciclo de Estacionalidad Anual:</span>
                      {prod.mejorMes && (
                        <span className="text-emerald-600 font-bold">
                          Mejor: {prod.mejorMes.nombre} ({formatRoas(prod.mejorMes.roas)})
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-12 gap-1 bg-sf p-1.5 rounded-lg border border-[var(--bd)]">
                      {prod.mesesDesempeno.map(m => {
                        const esMesActual = m.nombreMes === mesActualNombre;
                        let bgBar = 'bg-black/5 dark:bg-white/5';
                        if (m.gasto > 0) {
                          if (m.roas && m.roas >= 2.5) bgBar = 'bg-emerald-500 text-white font-bold';
                          else if (m.roas && m.roas >= 1.5) bgBar = 'bg-amber-500 text-white font-bold';
                          else bgBar = 'bg-rose-500 text-white font-bold';
                        }

                        return (
                          <div
                            key={m.mesNumero}
                            title={`${m.nombreMes}: Ventas ${formatCurrency(m.ventas)}, Gasto ${formatCurrency(m.gasto)}, ROAS ${formatRoas(m.roas)}`}
                            className={`flex flex-col items-center justify-center py-1 rounded text-[8px] font-mono transition-transform hover:scale-110 ${bgBar} ${
                              esMesActual ? 'ring-1 ring-[var(--tx)] font-black' : ''
                            }`}
                          >
                            <span>{m.nombreMes.slice(0, 1)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Footer de la Tarjeta */}
                <div className="mt-3 pt-2.5 border-t border-[var(--bd)] flex items-center justify-between text-[11px]">
                  <span className="tx-mu text-[10px]">
                    {prod.pedidosTotales} pedidos · {prod.anunciosAsociados.length} anuncios
                  </span>
                  <span className="text-[var(--ac)] font-bold group-hover:underline flex items-center gap-0.5">
                    Ver Expediente →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* DRAWER / MODAL: EXPEDIENTE HISTÓRICO DEL PRODUCTO */}
      {productoSeleccionado && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setProductoSeleccionado(null)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col">
            {/* Header del Expediente */}
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-cd border border-[var(--bd)] overflow-hidden shrink-0 flex items-center justify-center">
                  {productoSeleccionado.image_url ? (
                    <img src={productoSeleccionado.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xl">📦</span>
                  )}
                </div>
                <div>
                  <span className="text-[10px] font-mono tx-mu uppercase">Expediente de Pauta #{productoSeleccionado.sku}</span>
                  <h3 className="font-bold text-sm text-[var(--tx)]">{productoSeleccionado.nombre}</h3>
                </div>
              </div>

              <button onClick={() => setProductoSeleccionado(null)} className="p-1 rounded-lg hover:bg-black/10">
                <X size={18} />
              </button>
            </div>

            {/* Contenido Scrollable */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* KPIs Resumen */}
              <div className="grid grid-cols-4 gap-3 p-4 bg-sf rounded-2xl border border-[var(--bd)] text-center">
                <div>
                  <span className="text-[9px] uppercase font-bold tx-mu block">Gasto Total Ads</span>
                  <span className="text-base font-black font-mono text-[var(--tx)] mt-1 block">
                    {formatCurrency(productoSeleccionado.gastoTotal)}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-bold tx-mu block">Ventas Generadas</span>
                  <span className="text-base font-black font-mono text-emerald-600 mt-1 block">
                    {formatCurrency(productoSeleccionado.ventasTotales)}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-bold tx-mu block">ROAS Acumulado</span>
                  <span className={`text-lg font-black font-mono mt-0.5 block ${roasColorClass(productoSeleccionado.roasHistorico)}`}>
                    {formatRoas(productoSeleccionado.roasHistorico)}
                  </span>
                </div>
                <div>
                  <span className="text-[9px] uppercase font-bold tx-mu block">CPA Promedio</span>
                  <span className="text-base font-black font-mono text-[var(--tx)] mt-1 block">
                    {productoSeleccionado.cpaHistorico ? formatCurrency(productoSeleccionado.cpaHistorico) : '—'}
                  </span>
                </div>
              </div>

              {/* Selector de Estado del Ciclo de Vida */}
              <div className="p-4 bg-sf rounded-2xl border border-[var(--bd)] space-y-2">
                <span className="text-xs font-bold text-[var(--tx)] block">Estado en el Ciclo de Vida del E-commerce:</span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { id: 'escala', label: '🔥 Escala Activa', desc: 'Pautándose con buen ROAS' },
                    { id: 'hibernacion', label: '❄️ Hibernando', desc: 'Esperando temporada' },
                    { id: 'testeo', label: '🧪 En Testeo', desc: 'Fase de validación' },
                    { id: 'quemado', label: '🛑 Quemado', desc: 'Pausado / Agotado' }
                  ].map(c => (
                    <div
                      key={c.id}
                      onClick={() => setEstadoEdicion(c.id as any)}
                      className={`p-2.5 rounded-xl border cursor-pointer text-center transition-all ${
                        estadoEdicion === c.id 
                          ? 'border-[var(--ac)] bg-[var(--ac)]/10 text-[var(--ac)] font-bold' 
                          : 'border-[var(--bd)] bg-cd tx-mu hover:text-[var(--tx)]'
                      }`}
                    >
                      <span className="text-xs block">{c.label}</span>
                      <span className="text-[9px] opacity-70 block mt-0.5">{c.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Desglose Mes a Mes del Año */}
              <div>
                <h4 className="text-xs font-bold uppercase tx-mu mb-2 flex items-center gap-1.5">
                  <Calendar size={14} /> Desempeño Histórico por Mes (Calendario Anual)
                </h4>
                <div className="bg-sf rounded-2xl border border-[var(--bd)] overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-cd border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                        <tr>
                          <th className="p-2.5">Mes</th>
                          <th className="p-2.5 text-right">Inversión Ads</th>
                          <th className="p-2.5 text-right">Ventas</th>
                          <th className="p-2.5 text-center">Pedidos</th>
                          <th className="p-2.5 text-right">ROAS</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--bd)]">
                        {productoSeleccionado.mesesDesempeno.map(m => (
                          <tr key={m.mesNumero} className={m.nombreMes === mesActualNombre ? 'bg-[var(--ac)]/5 font-semibold' : ''}>
                            <td className="p-2.5 font-bold">
                              {m.nombreMes} {m.nombreMes === mesActualNombre ? '📍' : ''}
                            </td>
                            <td className="p-2.5 text-right font-mono tx-mu">
                              {m.gasto > 0 ? formatCurrency(m.gasto) : '—'}
                            </td>
                            <td className="p-2.5 text-right font-mono font-bold text-emerald-600">
                              {m.ventas > 0 ? formatCurrency(m.ventas) : '—'}
                            </td>
                            <td className="p-2.5 text-center font-mono">
                              {m.pedidos > 0 ? m.pedidos : '—'}
                            </td>
                            <td className={`p-2.5 text-right font-mono font-bold ${roasColorClass(m.roas)}`}>
                              {formatRoas(m.roas)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              {/* Códigos de Anuncio Ganadores */}
              <div>
                <h4 className="text-xs font-bold uppercase tx-mu mb-2 flex items-center gap-1.5">
                  <Tag size={14} /> Códigos de Anuncio Asociados ({productoSeleccionado.anunciosAsociados.length})
                </h4>
                <div className="flex flex-wrap gap-1.5 p-3 bg-sf rounded-2xl border border-[var(--bd)]">
                  {productoSeleccionado.anunciosAsociados.length === 0 ? (
                    <span className="text-xs tx-mu">No se detectaron códigos específicos de anuncio.</span>
                  ) : (
                    productoSeleccionado.anunciosAsociados.map(cod => (
                      <span key={cod} className="px-2.5 py-1 rounded-lg bg-cd border border-[var(--bd)] text-xs font-mono font-bold text-[var(--tx)]">
                        {cod}
                      </span>
                    ))
                  )}
                </div>
              </div>

              {/* Notas Estratégicas del Producto */}
              <div>
                <label className="block text-xs font-bold uppercase tx-mu mb-1.5">
                  Notas Estratégicas y Aprendizajes (Ángulos de venta, creativos que pegaron):
                </label>
                <textarea
                  rows={3}
                  value={notaEdicion}
                  onChange={e => setNotaEdicion(e.target.value)}
                  placeholder="Ej. Funcionó brutal con ángulo de alivio rápido en video de TikTok. Mejor época: antes de Navidad y día de la madre..."
                  className="w-full p-3 rounded-xl border border-[var(--bd)] bg-sf text-xs leading-relaxed outline-none focus:border-[var(--ac)] resize-none"
                />
              </div>
            </div>

            {/* Footer del Modal */}
            <div className="p-4 border-t border-[var(--bd)] bg-sf flex items-center justify-between">
              {guardadoOk && (
                <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 size={15} /> ¡Guardado en la Bóveda!
                </span>
              )}
              {!guardadoOk && <div />}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setProductoSeleccionado(null)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cerrar
                </button>
                <button
                  type="button"
                  onClick={handleGuardarConfig}
                  className="px-5 py-2 bg-[var(--ac)] hover:opacity-90 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow"
                >
                  <Save size={14} /> Guardar Estrategia
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
