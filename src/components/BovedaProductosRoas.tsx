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
  BarChart3,
  Link as LinkIcon,
  Plus,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Check
} from 'lucide-react';
import { formatCurrency, formatRoas, roasColorClass } from '@/lib/rentabilidad';
import type { 
  ProductoBovedaRoas, 
  CicloVidaProducto, 
  RendimientoMesProducto,
  GastoPublicidad 
} from '@/types/rentabilidad';
import { fetchStockItems } from '@/lib/inventory';
import type { StockItem } from '@/types/inventory';
import { 
  resolveCatalogSku, 
  linkRawSkuToProduct, 
  linkAdCodeToProduct, 
  removeAttribution, 
  loadAttributionMap 
} from '@/lib/catalogAliases';

const MESES_NOMBRES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export function BovedaProductosRoas() {
  const [cargando, setCargando] = useState(true);
  const [ordenes, setOrdenes] = useState<any[]>([]);
  const [gastos, setGastos] = useState<GastoPublicidad[]>([]);
  const [productosDb, setProductosDb] = useState<any[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [versionAtribucion, setVersionAtribucion] = useState(0); // Para forzar recálculo tras mapeos

  const [busqueda, setBusqueda] = useState('');
  const [filtroCiclo, setFiltroCiclo] = useState<string>('todos');
  const [ordenarPor, setOrdenarPor] = useState<'roas' | 'utilidad' | 'margen' | 'ventas' | 'gasto'>('roas');

  // Modal / Drawer de detalle de producto
  const [productoSeleccionado, setProductoSeleccionado] = useState<ProductoBovedaRoas | null>(null);
  const [notaEdicion, setNotaEdicion] = useState('');
  const [estadoEdicion, setEstadoEdicion] = useState<CicloVidaProducto>('escala');
  const [costoEdicion, setCostoEdicion] = useState<number>(0);
  const [guardadoOk, setGuardadoOk] = useState(false);

  // Nuevo alias o código de anuncio en el drawer
  const [nuevoAliasTexto, setNuevoAliasTexto] = useState('');
  const [nuevoAdCode, setNuevoAdCode] = useState('');

  // Modal de Mapeo & Unificación de Atribución Global
  const [modalMapeoAbierto, setModalMapeoAbierto] = useState(false);
  const [textoParaVincular, setTextoParaVincular] = useState('');
  const [targetCatalogSku, setTargetCatalogSku] = useState('');

  // Cargar todos los datos históricos
  const cargarHistorico = async () => {
    setCargando(true);
    try {
      const [{ items: itemsStock }, resOrdenes, resGastos, resProd] = await Promise.all([
        fetchStockItems(),
        supabase
          .from('whatsapp_orders')
          .select('id,total,sku,catalogo_sku,codigo_anuncio,created_at,estado')
          .neq('estado', 'cancelado'),
        supabase
          .from('gastos_publicidad')
          .select('*')
          .order('fecha', { ascending: false }),
        supabase
          .from('productos')
          .select('*')
      ]);

      setStockItems(itemsStock || []);
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

  // Construcción de la Bóveda de Productos cruzando Orders + Ads Spend con consolidación por Catálogo Maestro
  const { boveda, textosSinMapear, codigosSinMapear } = useMemo(() => {
    if (ordenes.length === 0 && gastos.length === 0 && stockItems.length === 0) {
      return { boveda: [], textosSinMapear: [], codigosSinMapear: [] };
    }

    // 1. Catálogo Canónico Maestro
    // Usamos stockItems como fuente de productos físicos, complementado por productosDb
    const canonicalMap = new Map<string, {
      sku: string;
      nombre: string;
      image_url: string | null;
      costo_unitario: number;
      precio_venta: number;
      stock_actual: number;
      esOficial: boolean;
      ventasTotales: number;
      pedidosTotales: number;
      gastoTotal: number;
      anuncios: Set<string>;
      aliasTextos: Set<string>;
      mesesVentas: { ventas: number; pedidos: number }[];
      mesesGasto: number[];
    }>();

    const initMeses = () => Array.from({ length: 12 }, () => ({ ventas: 0, pedidos: 0 }));
    const initMesesGasto = () => Array.from({ length: 12 }, () => 0);

    // Registrar productos del inventario/stock
    stockItems.forEach(item => {
      const cSku = item.sku.trim().toUpperCase();
      canonicalMap.set(cSku, {
        sku: cSku,
        nombre: item.nombre || cSku,
        image_url: item.image_url || null,
        costo_unitario: item.costo_unitario || 0,
        precio_venta: item.precio_venta || 0,
        stock_actual: item.stock_disponible ?? item.stock_fisico ?? 0,
        esOficial: true,
        ventasTotales: 0,
        pedidosTotales: 0,
        gastoTotal: 0,
        anuncios: new Set(),
        aliasTextos: new Set(),
        mesesVentas: initMeses(),
        mesesGasto: initMesesGasto()
      });
    });

    // Registrar productos de la tabla productos que no estén aún
    productosDb.forEach(p => {
      const tId = String(p.template_id || '').trim().toUpperCase();
      if (tId && !canonicalMap.has(tId)) {
        canonicalMap.set(tId, {
          sku: tId,
          nombre: p.nombre_base || tId,
          image_url: p.image_url || null,
          costo_unitario: 0,
          precio_venta: 0,
          stock_actual: 0,
          esOficial: true,
          ventasTotales: 0,
          pedidosTotales: 0,
          gastoTotal: 0,
          anuncios: new Set(),
          aliasTextos: new Set(),
          mesesVentas: initMeses(),
          mesesGasto: initMesesGasto()
        });
      }
    });

    const knownSkus = Array.from(canonicalMap.keys());
    const sinMapearTextos = new Set<string>();
    const sinMapearAnuncios = new Set<string>();

    // 2. Procesar y Atribuir Órdenes de WhatsApp
    ordenes.forEach(o => {
      const rawSku = (o.sku || '').trim();
      const catSkuDirecto = (o.catalogo_sku || '').trim();
      const codAnuncio = (o.codigo_anuncio || '').trim();
      const monto = Number(o.total || 0);
      const fecha = o.created_at ? new Date(o.created_at) : new Date();
      const mesIdx = isNaN(fecha.getMonth()) ? 0 : fecha.getMonth();

      // Resolver a qué SKU del Catálogo Maestro pertenece esta orden
      const targetSku = resolveCatalogSku(rawSku, codAnuncio, catSkuDirecto, knownSkus);

      if (targetSku && canonicalMap.has(targetSku.toUpperCase())) {
        const prod = canonicalMap.get(targetSku.toUpperCase())!;
        prod.ventasTotales += monto;
        prod.pedidosTotales += 1;
        if (rawSku) prod.aliasTextos.add(rawSku);
        if (codAnuncio) prod.anuncios.add(codAnuncio.toUpperCase());
        if (prod.mesesVentas[mesIdx]) {
          prod.mesesVentas[mesIdx].ventas += monto;
          prod.mesesVentas[mesIdx].pedidos += 1;
        }
      } else {
        // No está vinculado a un producto canónico conocido: agrupar por rawSku
        const unlinkedKey = (rawSku || 'SIN_PRODUCTO').toUpperCase();
        sinMapearTextos.add(rawSku || 'SIN_PRODUCTO');
        if (codAnuncio) sinMapearAnuncios.add(codAnuncio);

        if (!canonicalMap.has(unlinkedKey)) {
          canonicalMap.set(unlinkedKey, {
            sku: unlinkedKey,
            nombre: rawSku || unlinkedKey,
            image_url: null,
            costo_unitario: 0,
            precio_venta: monto,
            stock_actual: 0,
            esOficial: false,
            ventasTotales: 0,
            pedidosTotales: 0,
            gastoTotal: 0,
            anuncios: new Set(),
            aliasTextos: new Set([rawSku]),
            mesesVentas: initMeses(),
            mesesGasto: initMesesGasto()
          });
        }
        const prod = canonicalMap.get(unlinkedKey)!;
        prod.ventasTotales += monto;
        prod.pedidosTotales += 1;
        if (rawSku) prod.aliasTextos.add(rawSku);
        if (codAnuncio) prod.anuncios.add(codAnuncio.toUpperCase());
        if (prod.mesesVentas[mesIdx]) {
          prod.mesesVentas[mesIdx].ventas += monto;
          prod.mesesVentas[mesIdx].pedidos += 1;
        }
      }
    });

    // 3. Procesar y Atribuir Gastos de Publicidad
    gastos.forEach(g => {
      const codGasto = (g.codigo_anuncio || '').trim();
      const montoGasto = Number(g.monto || 0);
      const fechaGasto = g.fecha ? new Date(g.fecha) : new Date();
      const mesGastoIdx = isNaN(fechaGasto.getMonth()) ? 0 : fechaGasto.getMonth();

      // Resolver producto canónico para este código de anuncio
      let targetSku = resolveCatalogSku(null, codGasto, null, knownSkus);

      // Si no se resolvió directamente, revisar si algún producto ya tiene este anuncio
      if (!targetSku) {
        for (const [skuKey, pData] of canonicalMap.entries()) {
          if (pData.anuncios.has(codGasto.toUpperCase())) {
            targetSku = skuKey;
            break;
          }
        }
      }

      if (targetSku && canonicalMap.has(targetSku.toUpperCase())) {
        const prod = canonicalMap.get(targetSku.toUpperCase())!;
        prod.gastoTotal += montoGasto;
        prod.anuncios.add(codGasto.toUpperCase());
        if (prod.mesesGasto[mesGastoIdx] !== undefined) {
          prod.mesesGasto[mesGastoIdx] += montoGasto;
        }
      } else {
        // Campaña publicitaria independiente o no asignada aún
        const campKey = (codGasto || 'ADS_GENERAL').toUpperCase();
        sinMapearAnuncios.add(codGasto);

        if (!canonicalMap.has(campKey)) {
          canonicalMap.set(campKey, {
            sku: campKey,
            nombre: `Campaña ${campKey}`,
            image_url: null,
            costo_unitario: 0,
            precio_venta: 0,
            stock_actual: 0,
            esOficial: false,
            ventasTotales: 0,
            pedidosTotales: 0,
            gastoTotal: 0,
            anuncios: new Set([campKey]),
            aliasTextos: new Set(),
            mesesVentas: initMeses(),
            mesesGasto: initMesesGasto()
          });
        }
        const prod = canonicalMap.get(campKey)!;
        prod.gastoTotal += montoGasto;
        if (prod.mesesGasto[mesGastoIdx] !== undefined) {
          prod.mesesGasto[mesGastoIdx] += montoGasto;
        }
      }
    });

    // 4. Consolidar la Lista Final de la Bóveda con Rentabilidad Contable Real
    const listaConsolidada: ProductoBovedaRoas[] = [];

    canonicalMap.forEach(prod => {
      // Filtrar productos que no tengan ninguna venta ni ningún gasto registrado
      if (prod.ventasTotales === 0 && prod.gastoTotal === 0 && !prod.esOficial) {
        return;
      }

      const gastoTotal = prod.gastoTotal;
      const ventasTotales = prod.ventasTotales;
      const pedidosTotales = prod.pedidosTotales;

      // Leer personalización y costo de localStorage si existe
      let estadoCiclo: CicloVidaProducto = 'escala';
      let notasEstrategicas = '';
      let costoUnitario = prod.costo_unitario || 0;

      try {
        const guardado = localStorage.getItem(`roas_vault_${prod.sku}`);
        if (guardado) {
          const parsed = JSON.parse(guardado);
          if (parsed.estadoCiclo) estadoCiclo = parsed.estadoCiclo;
          if (parsed.notasEstrategicas) notasEstrategicas = parsed.notasEstrategicas;
          if (parsed.costoUnitario !== undefined && Number(parsed.costoUnitario) >= 0) {
            costoUnitario = Number(parsed.costoUnitario);
          }
        } else {
          // Clasificación heurística automática
          const roasTmp = gastoTotal > 0 ? ventasTotales / gastoTotal : null;
          if (gastoTotal === 0 && ventasTotales > 0) estadoCiclo = 'hibernacion';
          else if (gastoTotal < 50) estadoCiclo = 'testeo';
          else if (roasTmp && roasTmp >= 2.0) estadoCiclo = 'escala';
          else if (roasTmp && roasTmp < 1.2) estadoCiclo = 'quemado';
          else estadoCiclo = 'hibernacion';
        }
      } catch {}

      // Métricas contables reales
      const cogsTotal = costoUnitario * pedidosTotales;
      const gananciaNetaReal = ventasTotales - (cogsTotal + gastoTotal);
      const margenNetoPorcentaje = ventasTotales > 0 ? (gananciaNetaReal / ventasTotales) * 100 : null;
      const utilidadPorUnidad = pedidosTotales > 0 ? gananciaNetaReal / pedidosTotales : 0;
      const roasHistorico = gastoTotal > 0 ? ventasTotales / gastoTotal : null;
      const cpaHistorico = pedidosTotales > 0 && gastoTotal > 0 ? gastoTotal / pedidosTotales : null;
      const ticketPromedio = pedidosTotales > 0 ? ventasTotales / pedidosTotales : 0;

      // Calcular desempeño de los 12 meses incluyendo COGS y Ganancia Neta mensual
      const mesesDesempeno: RendimientoMesProducto[] = MESES_NOMBRES.map((nombreMes, idx) => {
        const vMes = prod.mesesVentas[idx]?.ventas || 0;
        const pMes = prod.mesesVentas[idx]?.pedidos || 0;
        const gMes = prod.mesesGasto[idx] || 0;
        const cogsMes = costoUnitario * pMes;
        const gananciaNetaMes = vMes - (cogsMes + gMes);
        const margenNetoMes = vMes > 0 ? (gananciaNetaMes / vMes) * 100 : null;
        const roasMes = gMes > 0 ? vMes / gMes : (vMes > 0 ? 99 : null);

        return {
          mesNumero: idx + 1,
          nombreMes,
          ventas: vMes,
          gasto: gMes,
          pedidos: pMes,
          cogs: cogsMes,
          gananciaNeta: gananciaNetaMes,
          margenNeto: margenNetoMes,
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

      listaConsolidada.push({
        sku: prod.sku,
        catalogo_sku: prod.sku,
        nombre: prod.nombre,
        image_url: prod.image_url,
        costoUnitario,
        precioVentaSugerido: prod.precio_venta || (pedidosTotales > 0 ? ventasTotales / pedidosTotales : 0),
        stockActual: prod.stock_actual,
        ventasTotales,
        gastoTotal,
        cogsTotal,
        gananciaNetaReal,
        margenNetoPorcentaje,
        utilidadPorUnidad,
        pedidosTotales,
        roasHistorico,
        cpaHistorico,
        ticketPromedio,
        estadoCiclo,
        mesesDesempeno,
        mejorMes,
        peorMes,
        anunciosAsociados: Array.from(prod.anuncios),
        aliasTextos: Array.from(prod.aliasTextos),
        esCatalogoOficial: prod.esOficial,
        activo: true,
        notasEstrategicas
      });
    });

    return {
      boveda: listaConsolidada,
      textosSinMapear: Array.from(sinMapearTextos),
      codigosSinMapear: Array.from(sinMapearAnuncios)
    };
  }, [ordenes, gastos, stockItems, productosDb, versionAtribucion]);

  // Filtros y ordenamiento
  const productosFiltrados = useMemo(() => {
    let list = boveda;

    // Filtro texto
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      list = list.filter(p => 
        p.sku.toLowerCase().includes(q) || 
        p.nombre.toLowerCase().includes(q) ||
        p.anunciosAsociados.some(a => a.toLowerCase().includes(q)) ||
        p.aliasTextos.some(t => t.toLowerCase().includes(q))
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
      if (ordenarPor === 'utilidad') {
        return b.gananciaNetaReal - a.gananciaNetaReal;
      }
      if (ordenarPor === 'margen') {
        return (b.margenNetoPorcentaje ?? -999) - (a.margenNetoPorcentaje ?? -999);
      }
      if (ordenarPor === 'ventas') {
        return b.ventasTotales - a.ventasTotales;
      }
      return b.gastoTotal - a.gastoTotal;
    });
  }, [boveda, busqueda, filtroCiclo, ordenarPor]);

  // KPIs de la Bóveda con Rentabilidad Contable Real
  const kpisBoveda = useMemo(() => {
    let gastoTotal = 0;
    let ventasTotales = 0;
    let cogsTotal = 0;
    let gananciaNetaTotal = 0;
    let ganadores = 0;
    let hibernando = 0;

    boveda.forEach(p => {
      gastoTotal += p.gastoTotal;
      ventasTotales += p.ventasTotales;
      cogsTotal += p.cogsTotal;
      gananciaNetaTotal += p.gananciaNetaReal;
      if (p.roasHistorico && p.roasHistorico >= 2.5) ganadores++;
      if (p.estadoCiclo === 'hibernacion') hibernando++;
    });

    const margenNetoGlobal = ventasTotales > 0 ? (gananciaNetaTotal / ventasTotales) * 100 : 0;

    return {
      totalProductos: boveda.length,
      gastoTotal,
      ventasTotales,
      cogsTotal,
      gananciaNetaTotal,
      margenNetoGlobal,
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
    setCostoEdicion(p.costoUnitario || 0);
    setNuevoAliasTexto('');
    setNuevoAdCode('');
    setGuardadoOk(false);
  };

  // Guardar estado, costo unitario y notas del producto en la Bóveda
  const handleGuardarConfig = () => {
    if (!productoSeleccionado) return;
    const key = `roas_vault_${productoSeleccionado.sku}`;
    localStorage.setItem(key, JSON.stringify({
      estadoCiclo: estadoEdicion,
      notasEstrategicas: notaEdicion,
      costoUnitario: Number(costoEdicion) || 0
    }));

    setProductoSeleccionado(prev => prev ? ({
      ...prev,
      estadoCiclo: estadoEdicion,
      notasEstrategicas: notaEdicion,
      costoUnitario: Number(costoEdicion) || 0
    }) : null);

    setVersionAtribucion(v => v + 1);
    setGuardadoOk(true);
    setTimeout(() => setGuardadoOk(false), 2000);
  };

  // Agregar nuevo alias de texto al producto seleccionado
  const handleAgregarAlias = () => {
    if (!productoSeleccionado || !nuevoAliasTexto.trim()) return;
    linkRawSkuToProduct(nuevoAliasTexto.trim(), productoSeleccionado.sku);
    setNuevoAliasTexto('');
    setVersionAtribucion(v => v + 1);
  };

  // Agregar nuevo código de anuncio al producto seleccionado
  const handleAgregarAdCode = () => {
    if (!productoSeleccionado || !nuevoAdCode.trim()) return;
    linkAdCodeToProduct(nuevoAdCode.trim(), productoSeleccionado.sku);
    setNuevoAdCode('');
    setVersionAtribucion(v => v + 1);
  };

  // Quitar alias o ad code
  const handleEliminarAtribucion = (item: string, type: 'alias' | 'adCode') => {
    if (!productoSeleccionado) return;
    removeAttribution(productoSeleccionado.sku, item, type);
    setVersionAtribucion(v => v + 1);
  };

  // Vincular desde el modal global de unificación
  const handleVincularGlobal = (texto: string, cSku: string) => {
    if (!texto || !cSku) return;
    linkRawSkuToProduct(texto, cSku);
    linkAdCodeToProduct(texto, cSku);
    setTextoParaVincular('');
    setTargetCatalogSku('');
    setVersionAtribucion(v => v + 1);
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
      {/* Encabezado de la Bóveda con Botón de Unificación & Atribución */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="text-amber-500" size={24} />
            <h2 className="text-xl font-black">Bóveda de Productos Ganadores & Ciclos de Pauta</h2>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/30">
              Memoria Histórica & Catálogo Maestro
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1">
            Consolidación inteligente: agrupa pedidos y gastos de anuncios bajo el <strong>Producto del Catálogo</strong>, unificando variantes de texto y códigos de pauta.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setModalMapeoAbierto(true)}
            className="px-3.5 py-2 border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 shadow-sm"
          >
            <LinkIcon size={14} /> Mapeo de Atribución & Alias
          </button>

          <button
            onClick={cargarHistorico}
            disabled={cargando}
            className="p-2 border border-[var(--bd)] bg-sf hover:bg-cd rounded-xl text-xs font-bold transition-colors"
            title="Actualizar datos"
          >
            <RefreshCw size={15} className={cargando ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tarjetas KPI de la Bóveda con Rentabilidad Contable Real */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Catálogo Consolidado</span>
          <div className="text-2xl font-black mt-1 text-[var(--tx)]">
            {kpisBoveda.totalProductos} <span className="text-xs font-normal tx-mu">Maestros</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Pedidos y pauta unificada</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">ROAS Acumulado Global</span>
          <div className="text-2xl font-black mt-1 text-[var(--ac)]">
            {formatRoas(kpisBoveda.roasGlobal)}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Ads: {formatCurrency(kpisBoveda.gastoTotal)} · Venta: {formatCurrency(kpisBoveda.ventasTotales)}</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] shadow-sm col-span-2 sm:col-span-1">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block flex items-center justify-between">
            <span>Utilidad Neta Real</span>
            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded ${kpisBoveda.margenNetoGlobal >= 20 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}`}>
              {kpisBoveda.margenNetoGlobal.toFixed(1)}% Margen
            </span>
          </span>
          <div className={`text-2xl font-black mt-1 font-mono ${kpisBoveda.gananciaNetaTotal >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
            {formatCurrency(kpisBoveda.gananciaNetaTotal)}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">COGS mercadería: {formatCurrency(kpisBoveda.cogsTotal)}</span>
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
      </div>

      {/* Barra de Búsqueda y Filtros de Ciclo de Vida */}
      <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 bg-cd p-3 rounded-2xl border border-[var(--bd)]">
        <div className="relative flex-1 sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
          <input
            type="text"
            placeholder="Buscar por producto, SKU, variante o anuncio..."
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
            <option value="utilidad">💰 Mayor Utilidad Neta Real ($)</option>
            <option value="margen">📈 Mayor Margen Neto (%)</option>
            <option value="ventas">Mayor Facturación ($)</option>
            <option value="gasto">Mayor Inversión en Ads ($)</option>
          </select>
        </div>
      </div>

      {/* LISTA / GRID DE PRODUCTOS EN LA BÓVEDA */}
      {cargando ? (
        <div className="text-center py-16 tx-mu bg-cd rounded-2xl border border-[var(--bd)]">
          Cargando y consolidando expediente histórico de la bóveda...
        </div>
      ) : productosFiltrados.length === 0 ? (
        <div className="text-center py-16 tx-mu bg-cd rounded-2xl border border-[var(--bd)]">
          No se encontraron productos con los filtros seleccionados.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {productosFiltrados.map(prod => {
            const esTemporadaAlta = prod.mejorMes && prod.mejorMes.nombre === mesActualNombre;
            const tieneMultiplesAlias = prod.aliasTextos.length > 1;

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
                        {prod.esCatalogoOficial ? (
                          <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                            Catálogo
                          </span>
                        ) : (
                          <span className="text-[8px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            Sin Catálogo
                          </span>
                        )}
                      </div>
                      <h3 className="font-bold text-xs text-[var(--tx)] truncate leading-tight mt-0.5">
                        {prod.nombre}
                      </h3>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        {getBadgeCiclo(prod.estadoCiclo)}
                      </div>
                    </div>
                  </div>

                  {/* Badge de Variantes / Alias Consolidados */}
                  {tieneMultiplesAlias && (
                    <div className="mt-2.5 px-2 py-1 rounded-lg bg-indigo-500/5 border border-indigo-500/20 text-[9px] text-indigo-600 truncate flex items-center gap-1">
                      <LinkIcon size={10} className="shrink-0 text-indigo-500" />
                      <span className="font-bold shrink-0">{prod.aliasTextos.length} variantes unificadas:</span>
                      <span className="truncate opacity-80">{prod.aliasTextos.slice(0, 3).join(', ')}</span>
                    </div>
                  )}

                  {/* Métricas Financieras Acumuladas */}
                  <div className="grid grid-cols-3 gap-2 mt-3 p-2.5 bg-sf rounded-xl border border-[var(--bd)] text-center">
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

                  {/* Desglose de Rentabilidad Contable Real (COGS + Ganancia Neta) */}
                  <div className="mt-2 p-2 rounded-xl bg-cd/60 border border-[var(--bd)] flex items-center justify-between text-[11px]">
                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase font-bold tx-mu flex items-center gap-1">
                        <DollarSign size={10} className="text-emerald-500" /> Utilidad Real Neta
                      </span>
                      <div className="flex items-baseline gap-1 mt-0.5">
                        <span className={`font-mono font-black text-xs ${prod.gananciaNetaReal >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                          {formatCurrency(prod.gananciaNetaReal)}
                        </span>
                        {prod.margenNetoPorcentaje !== null && (
                          <span className={`text-[9px] font-bold px-1 rounded ${
                            prod.margenNetoPorcentaje >= 20 ? 'bg-emerald-500/10 text-emerald-600' :
                            prod.margenNetoPorcentaje >= 0 ? 'bg-amber-500/10 text-amber-600' :
                            'bg-rose-500/10 text-rose-500'
                          }`}>
                            {prod.margenNetoPorcentaje.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[9px] uppercase font-bold tx-mu block">
                        Costo Mercadería
                      </span>
                      <span className="text-[10px] font-mono text-[var(--tx)] font-semibold mt-0.5 block">
                        {prod.costoUnitario > 0 ? (
                          <>
                            {formatCurrency(prod.costoUnitario)}/u <span className="tx-mu text-[9px]">({formatCurrency(prod.cogsTotal)})</span>
                          </>
                        ) : (
                          <span className="text-amber-500 text-[9px] font-medium italic">Sin costo reg.</span>
                        )}
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
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono tx-mu uppercase">#{productoSeleccionado.sku}</span>
                    {productoSeleccionado.esCatalogoOficial ? (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                        Catálogo Oficial
                      </span>
                    ) : (
                      <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20">
                        Texto Libre Sin Catálogo
                      </span>
                    )}
                  </div>
                  <h3 className="font-bold text-sm text-[var(--tx)]">{productoSeleccionado.nombre}</h3>
                </div>
              </div>

              <button onClick={() => setProductoSeleccionado(null)} className="p-1 rounded-lg hover:bg-black/10">
                <X size={18} />
              </button>
            </div>

            {/* Contenido Scrollable */}
            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              {/* KPIs Resumen: Comercial & Pauta */}
              <div>
                <span className="text-[10px] font-bold uppercase tx-mu tracking-wider block mb-1.5">
                  Métricas Comerciales & Ads (ROAS)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-sf rounded-2xl border border-[var(--bd)] text-center">
                  <div>
                    <span className="text-[9px] uppercase font-bold tx-mu block">Inversión Ads</span>
                    <span className="text-sm sm:text-base font-black font-mono text-[var(--tx)] mt-0.5 block">
                      {formatCurrency(productoSeleccionado.gastoTotal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold tx-mu block">Ventas Brutas</span>
                    <span className="text-sm sm:text-base font-black font-mono text-emerald-600 mt-0.5 block">
                      {formatCurrency(productoSeleccionado.ventasTotales)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold tx-mu block">ROAS Acumulado</span>
                    <span className={`text-sm sm:text-base font-black font-mono mt-0.5 block ${roasColorClass(productoSeleccionado.roasHistorico)}`}>
                      {formatRoas(productoSeleccionado.roasHistorico)}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold tx-mu block">CPA Promedio</span>
                    <span className="text-sm sm:text-base font-black font-mono text-[var(--tx)] mt-0.5 block">
                      {productoSeleccionado.cpaHistorico ? formatCurrency(productoSeleccionado.cpaHistorico) : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* KPIs Resumen: Rentabilidad Contable Real (COGS + Ganancia Neta) */}
              <div>
                <span className="text-[10px] font-bold uppercase text-emerald-600 tracking-wider block mb-1.5 flex items-center gap-1">
                  <DollarSign size={12} /> Rentabilidad Contable Real (Costo Producto + Pauta)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3.5 bg-emerald-500/5 rounded-2xl border border-emerald-500/20 text-center">
                  <div>
                    <span className="text-[9px] uppercase font-bold tx-mu block">Costo Mercadería (COGS)</span>
                    <span className="text-sm sm:text-base font-black font-mono text-[var(--tx)] mt-0.5 block">
                      {formatCurrency(productoSeleccionado.cogsTotal)}
                    </span>
                    <span className="text-[9px] tx-mu block mt-0.5">
                      {productoSeleccionado.costoUnitario > 0 
                        ? `${formatCurrency(productoSeleccionado.costoUnitario)} × ${productoSeleccionado.pedidosTotales} uds` 
                        : 'Sin costo registrado'}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold tx-mu block">Ganancia Neta Real</span>
                    <span className={`text-sm sm:text-base font-black font-mono mt-0.5 block ${productoSeleccionado.gananciaNetaReal >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {formatCurrency(productoSeleccionado.gananciaNetaReal)}
                    </span>
                    <span className="text-[9px] tx-mu block mt-0.5">Venta − (Ads + Costo)</span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold tx-mu block">Margen Neto Real</span>
                    <span className={`text-sm sm:text-base font-black font-mono mt-0.5 block ${
                      productoSeleccionado.margenNetoPorcentaje !== null && productoSeleccionado.margenNetoPorcentaje >= 0 ? 'text-emerald-600' : 'text-rose-500'
                    }`}>
                      {productoSeleccionado.margenNetoPorcentaje !== null ? `${productoSeleccionado.margenNetoPorcentaje.toFixed(1)}%` : '—'}
                    </span>
                    <span className="text-[9px] tx-mu block mt-0.5">Sobre facturación</span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase font-bold tx-mu block">Utilidad por Pedido</span>
                    <span className={`text-sm sm:text-base font-black font-mono mt-0.5 block ${productoSeleccionado.utilidadPorUnidad >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                      {formatCurrency(productoSeleccionado.utilidadPorUnidad)}
                    </span>
                    <span className="text-[9px] tx-mu block mt-0.5">Ganancia líquida / ud</span>
                  </div>
                </div>
              </div>

              {/* SECCIÓN DE ATRIBUCIÓN & VARIANTES UNIFICADAS (Resuelve problema del usuario) */}
              <div className="p-4 bg-indigo-500/5 rounded-2xl border border-indigo-500/20 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase text-indigo-600 flex items-center gap-1.5">
                    <LinkIcon size={14} /> Atribución: Variantes de Pedido & Anuncios Conectados
                  </h4>
                  <span className="text-[10px] tx-mu">
                    {productoSeleccionado.aliasTextos.length} variantes · {productoSeleccionado.anunciosAsociados.length} anuncios
                  </span>
                </div>
                <p className="text-[11px] opacity-70">
                  Cualquier pedido con estas descripciones o anuncios sumará automáticamente sus ventas y ROAS a este producto.
                </p>

                {/* Variantes de Texto en Pedidos */}
                <div>
                  <span className="text-[10px] font-bold uppercase tx-mu block mb-1.5">
                    Variantes de texto en pedidos que se unifican aquí:
                  </span>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {productoSeleccionado.aliasTextos.map(txt => (
                      <span key={txt} className="px-2 py-1 rounded-lg bg-cd border border-[var(--bd)] text-xs font-medium text-[var(--tx)] flex items-center gap-1">
                        {txt}
                        <button
                          type="button"
                          onClick={() => handleEliminarAtribucion(txt, 'alias')}
                          className="opacity-40 hover:opacity-100 text-rose-500 p-0.5"
                          title="Desvincular variante"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ej. PORTA BEBES GRIS o Promo 2x1..."
                      value={nuevoAliasTexto}
                      onChange={e => setNuevoAliasTexto(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleAgregarAlias}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-500 transition-colors flex items-center gap-1"
                    >
                      <Plus size={13} /> Unificar
                    </button>
                  </div>
                </div>

                {/* Códigos de Anuncios Asociados */}
                <div className="pt-2 border-t border-indigo-500/10">
                  <span className="text-[10px] font-bold uppercase tx-mu block mb-1.5">
                    Códigos de anuncios (Meta / TikTok Ads):
                  </span>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {productoSeleccionado.anunciosAsociados.map(cod => (
                      <span key={cod} className="px-2 py-1 rounded-lg bg-cd border border-[var(--bd)] text-xs font-mono font-bold text-indigo-500 flex items-center gap-1">
                        #{cod}
                        <button
                          type="button"
                          onClick={() => handleEliminarAtribucion(cod, 'adCode')}
                          className="opacity-40 hover:opacity-100 text-rose-500 p-0.5"
                          title="Desvincular código de anuncio"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    ))}
                  </div>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      placeholder="Ej. pulmag01 o portabebes-fb..."
                      value={nuevoAdCode}
                      onChange={e => setNuevoAdCode(e.target.value)}
                      className="flex-1 px-3 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs font-mono outline-none focus:border-indigo-500"
                    />
                    <button
                      type="button"
                      onClick={handleAgregarAdCode}
                      className="px-3 py-1.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-500 transition-colors flex items-center gap-1"
                    >
                      <Plus size={13} /> Conectar
                    </button>
                  </div>
                </div>
              </div>

              {/* Costo Unitario de Mercadería y Rentabilidad Contable */}
              <div className="p-4 bg-sf rounded-2xl border border-[var(--bd)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-[var(--tx)] block flex items-center gap-1.5">
                    <DollarSign size={14} className="text-emerald-500" /> Costo Unitario de Proveedor (COGS)
                  </span>
                  <span className="text-[10px] tx-mu block mt-0.5">
                    {productoSeleccionado.esCatalogoOficial 
                      ? 'Base sincronizada con Catálogo / Kárdex. Modifícalo si el proveedor te subió o bajó el precio.'
                      : 'Define el costo unitario de compra para este producto para calcular la ganancia contable real.'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold font-mono tx-mu">USD $</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={costoEdicion}
                    onChange={e => setCostoEdicion(parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    className="w-28 px-3 py-1.5 bg-cd border border-[var(--bd)] rounded-xl text-xs font-mono font-bold outline-none focus:border-emerald-500 text-emerald-600"
                  />
                  <span className="text-[10px] tx-mu">/ unidad</span>
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
                          <th className="p-2.5 text-right">COGS (Costo)</th>
                          <th className="p-2.5 text-right">Ganancia Neta</th>
                          <th className="p-2.5 text-right">Margen</th>
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
                            <td className="p-2.5 text-right font-mono tx-mu">
                              {m.cogs > 0 ? formatCurrency(m.cogs) : (m.pedidos > 0 ? <span className="text-amber-500 text-[10px] italic">Sin costo</span> : '—')}
                            </td>
                            <td className={`p-2.5 text-right font-mono font-bold ${
                              m.ventas > 0 || m.gasto > 0 
                                ? (m.gananciaNeta >= 0 ? 'text-emerald-600' : 'text-rose-500') 
                                : 'tx-mu'
                            }`}>
                              {m.ventas > 0 || m.gasto > 0 ? formatCurrency(m.gananciaNeta) : '—'}
                            </td>
                            <td className={`p-2.5 text-right font-mono text-[11px] font-bold ${
                              m.margenNeto !== null 
                                ? (m.margenNeto >= 0 ? 'text-emerald-600' : 'text-rose-500') 
                                : 'tx-mu'
                            }`}>
                              {m.margenNeto !== null ? `${m.margenNeto.toFixed(0)}%` : '—'}
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

      {/* MODAL GLOBAL: MAPEO DE ATRIBUCIÓN & UNIFICACIÓN DE PRODUCTOS */}
      {modalMapeoAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setModalMapeoAbierto(false)}>
          <div onClick={e => e.stopPropagation()} className="w-full max-w-xl max-h-[85vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col">
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <LinkIcon size={18} className="text-indigo-600" />
                <h3 className="font-bold text-sm">Mapeo & Unificación de Atribución</h3>
              </div>
              <button onClick={() => setModalMapeoAbierto(false)} className="p-1 rounded-lg hover:bg-black/10">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              <p className="opacity-70 leading-relaxed">
                Asigna descripciones de pedidos libres (ej. <em>"PORTA BEBES GRIS"</em>) o códigos de anuncios (ej. <em>"pulmag01"</em>) a su <strong>Producto del Catálogo</strong> para consolidar las métricas de ROAS y facturación en un solo lugar.
              </p>

              {/* Formulario Rápido de Vinculación */}
              <div className="p-3.5 bg-sf rounded-xl border border-[var(--bd)] space-y-2.5">
                <span className="font-bold uppercase tracking-wider text-[10px] tx-mu block">
                  Vincular Variante o Anuncio a un Producto:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] opacity-60 block mb-1">Texto en pedido o Código de anuncio:</label>
                    <input
                      type="text"
                      placeholder="Ej. PORTA BEBES GRIS"
                      value={textoParaVincular}
                      onChange={e => setTextoParaVincular(e.target.value)}
                      className="w-full p-2 bg-cd border border-[var(--bd)] rounded-lg text-xs outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] opacity-60 block mb-1">Producto Maestro del Catálogo:</label>
                    <select
                      value={targetCatalogSku}
                      onChange={e => setTargetCatalogSku(e.target.value)}
                      className="w-full p-2 bg-cd border border-[var(--bd)] rounded-lg text-xs outline-none focus:border-indigo-500 font-semibold"
                    >
                      <option value="">Selecciona un producto...</option>
                      {stockItems.map(item => (
                        <option key={item.sku} value={item.sku}>
                          {item.nombre} (#{item.sku})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={!textoParaVincular.trim() || !targetCatalogSku}
                    onClick={() => handleVincularGlobal(textoParaVincular.trim(), targetCatalogSku)}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-bold rounded-lg text-xs transition-colors shadow-sm flex items-center gap-1.5"
                  >
                    <Check size={14} /> Vincular y Unificar
                  </button>
                </div>
              </div>

              {/* Sugerencias detectadas sin mapear */}
              {textosSinMapear.length > 0 && (
                <div>
                  <span className="font-bold uppercase tracking-wider text-[10px] tx-mu block mb-2">
                    Textos de pedidos detectados (Clic para vincular rápido):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {textosSinMapear.map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTextoParaVincular(t)}
                        className="px-2.5 py-1 rounded-lg border border-[var(--bd)] bg-sf hover:border-indigo-500 text-xs font-mono transition-colors"
                      >
                        {t} ＋
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 border-t border-[var(--bd)] bg-sf flex justify-end">
              <button
                type="button"
                onClick={() => setModalMapeoAbierto(false)}
                className="px-4 py-1.5 bg-[var(--cd)] border border-[var(--bd)] rounded-xl text-xs font-bold"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
