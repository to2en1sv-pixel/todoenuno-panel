import { useState, useMemo, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search,
  AlertTriangle,
  X,
  Code,
  Boxes,
  Layers,
  History,
  CheckCircle2,
  RefreshCw,
  Database,
  CreditCard,
  PackagePlus,
  ExternalLink,
  SlidersHorizontal,
  Truck
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  fetchStockItems,
  fetchKardexMovements,
  fetchProductVariants,
  recordStockEntry,
  adjustStock,
  quickAddStockDelta,
  resolveOrderInventoryLines
} from '@/lib/inventory';
import { ProductImg } from '@/components/inventory/ProductImg';
import { Sprint10SqlModal } from '@/components/inventory/Sprint10SqlModal';
import type { StockItem, KardexMovement, ProductVariant } from '@/types/inventory';

function getVariantDotColor(colorName: string): string {
  const c = (colorName || '').toLowerCase().trim();
  if (c.includes('negro') || c.includes('black')) return '#18181b';
  if (c.includes('blanco') || c.includes('white')) return '#f8fafc';
  if (c.includes('gris') || c.includes('plomo') || c.includes('gray')) return '#71717a';
  if (c.includes('azul') && (c.includes('marino') || c.includes('oscuro') || c.includes('navy'))) return '#1e3a8a';
  if (c.includes('azul') || c.includes('celeste') || c.includes('blue')) return '#3b82f6';
  if (c.includes('rojo') || c.includes('vino') || c.includes('red')) return '#dc2626';
  if (c.includes('rosa') || c.includes('rosado') || c.includes('pink')) return '#ec4899';
  if (c.includes('verde') && (c.includes('menta') || c.includes('claro'))) return '#34d399';
  if (c.includes('verde') || c.includes('oliva') || c.includes('green')) return '#16a34a';
  if (c.includes('amarillo') || c.includes('mostaza')) return '#eab308';
  if (c.includes('naranja') || c.includes('orange')) return '#f97316';
  if (c.includes('morado') || c.includes('lila') || c.includes('violeta') || c.includes('purple')) return '#9333ea';
  if (c.includes('beige') || c.includes('crema') || c.includes('arena') || c.includes('khaki')) return '#d6c3a5';
  if (c.includes('cafe') || c.includes('café') || c.includes('marron') || c.includes('marrón')) return '#78350f';
  return '#6366f1';
}

export function InventarioPage() {
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<'stock' | 'kardex'>('stock');
  const [search, setSearch] = useState(() => searchParams.get('sku') || '');
  const [filterCriticos, setFilterCriticos] = useState(() => searchParams.get('filter') === 'criticos');
  const [kardexFilter, setKardexFilter] = useState<'all' | 'entradas' | 'salidas' | 'ajustes'>('all');

  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [variantsList, setVariantsList] = useState<ProductVariant[]>([]);
  const [kardexList, setKardexList] = useState<KardexMovement[]>([]);
  const [loadingNative, setLoadingNative] = useState(true);
  const [isRealDb, setIsRealDb] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Modales
  const [showEntradaModal, setShowEntradaModal] = useState(false);
  const [showAjusteModal, setShowAjusteModal] = useState(false);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [isAdjustingQuick, setIsAdjustingQuick] = useState(false);

  // Formulario Entrada de Stock (Sin Compra o Con Compra)
  const [entradaTipo, setEntradaTipo] = useState<'inventario_inicial' | 'compra_entrada'>('inventario_inicial');
  const [entradaSku, setEntradaSku] = useState('');
  const [entradaCantidad, setEntradaCantidad] = useState('');
  const [entradaCosto, setEntradaCosto] = useState('');
  const [entradaProveedor, setEntradaProveedor] = useState('');
  const [entradaNotas, setEntradaNotas] = useState('');
  const [entradaAsentarFinanzas, setEntradaAsentarFinanzas] = useState(false);
  const [isSavingEntrada, setIsSavingEntrada] = useState(false);

  // Modal Desglose de Reservas por Pedidos Activos
  const [reservedModalSku, setReservedModalSku] = useState<string | null>(null);
  const [reservedOrders, setReservedOrders] = useState<any[]>([]);
  const [loadingReserved, setLoadingReserved] = useState(false);

  const openReservedBreakdown = async (sku: string) => {
    setReservedModalSku(sku);
    setLoadingReserved(true);
    try {
      const { data } = await supabase
        .from('whatsapp_orders')
        .select('*')
        .in('estado', ['por_empacar', 'en_camino'])
        .order('created_at', { ascending: false });

      const matched = (data || []).filter((ord: any) => {
        const lines = resolveOrderInventoryLines(ord, stockItems);
        return lines.some(l => l.sku === sku);
      });
      setReservedOrders(matched);
    } catch {
      setReservedOrders([]);
    } finally {
      setLoadingReserved(false);
    }
  };

  // Formulario Conteo Físico Real
  const [ajusteSku, setAjusteSku] = useState('');
  const [ajusteNuevoStock, setAjusteNuevoStock] = useState('');
  const [ajusteMotivo, setAjusteMotivo] = useState('Conteo físico periódico');
  const [isSavingAjuste, setIsSavingAjuste] = useState(false);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToastMsg({ type, text });
    setTimeout(() => {
      setToastMsg(prev => (prev?.text === text ? null : prev));
    }, 5000);
  };

  const loadNativeInventory = async () => {
    setLoadingNative(true);
    const [stockRes, kardexRes, varsRes] = await Promise.all([
      fetchStockItems(),
      fetchKardexMovements(),
      fetchProductVariants()
    ]);
    setStockItems(stockRes.items);
    setVariantsList(varsRes);
    setIsRealDb(stockRes.isRealDb);
    setDbError(stockRes.error || null);
    setKardexList(kardexRes.movements);
    setLoadingNative(false);
  };

  useEffect(() => {
    loadNativeInventory();
  }, []);

  const variantsByTemplate = useMemo(() => {
    const map = new Map<string, ProductVariant[]>();
    variantsList.forEach(v => {
      if (v.estado === 'PAUSADO') return;
      const key = String(v.template_id);
      const curr = map.get(key) || [];
      curr.push(v);
      map.set(key, curr);
    });
    return map;
  }, [variantsList]);

  // Sincronizar si el usuario llega desde Catálogo Visual con ?sku=...
  useEffect(() => {
    const skuParam = searchParams.get('sku');
    if (skuParam) setSearch(skuParam);
    const filterParam = searchParams.get('filter');
    if (filterParam === 'criticos') setFilterCriticos(true);
  }, [searchParams]);

  // KPIs de Bodega (excluyen estrictamente productos pausados)
  const metrics = useMemo(() => {
    let activeSkus = 0;
    let pausedSkus = 0;
    let totalFisico = 0;
    let totalReservado = 0;
    let totalDisponible = 0;
    let valorizacionCosto = 0;
    let valorVentaTotal = 0;
    let valorVentaDisponible = 0;
    let skusCriticos = 0;

    stockItems.forEach(item => {
      if (item.sku.toLowerCase().includes('fee')) return;
      if (item.activo === false) {
        pausedSkus++;
        return;
      }

      activeSkus++;
      const fisico = item.stock_fisico || 0;
      const reservado = item.stock_reservado || 0;
      const disponible = item.stock_disponible || 0;
      const costo = item.costo_unitario || 0;
      const precio = item.precio_venta || 0;

      totalFisico += fisico;
      totalReservado += reservado;
      totalDisponible += disponible;
      valorizacionCosto += fisico * costo;
      valorVentaTotal += fisico * precio;
      valorVentaDisponible += disponible * precio;

      if (disponible <= (item.stock_minimo_alerta || 5)) {
        skusCriticos++;
      }
    });

    const utilidadPotencial = valorVentaTotal - valorizacionCosto;

    return {
      activeSkus,
      pausedSkus,
      totalFisico,
      totalReservado,
      totalDisponible,
      valorizacionCosto,
      valorVentaTotal,
      valorVentaDisponible,
      utilidadPotencial,
      skusCriticos
    };
  }, [stockItems]);

  // Filtrado de Stock (oculta productos pausados)
  const filteredInventory = useMemo(() => {
    let list = stockItems.filter(i => !i.sku.toLowerCase().includes('fee') && i.activo !== false);

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        i =>
          i.sku.toLowerCase().includes(q) ||
          i.nombre.toLowerCase().includes(q) ||
          (i.ubicacion || '').toLowerCase().includes(q)
      );
    }

    if (filterCriticos) {
      list = list.filter(i => i.stock_disponible <= (i.stock_minimo_alerta || 5));
    }

    return list;
  }, [stockItems, search, filterCriticos]);

  // Filtrado de Kárdex
  const filteredKardex = useMemo(() => {
    let list = kardexList;

    if (search.trim()) {
      const q = search.toLowerCase().trim();
      list = list.filter(
        k =>
          k.sku.toLowerCase().includes(q) ||
          k.motivo.toLowerCase().includes(q) ||
          k.tipo_movimiento.toLowerCase().includes(q)
      );
    }

    if (kardexFilter === 'entradas') {
      list = list.filter(k =>
        ['inventario_inicial', 'compra_entrada', 'devolucion_entrada', 'liberar_reserva'].includes(k.tipo_movimiento)
      );
    } else if (kardexFilter === 'salidas') {
      list = list.filter(k => ['venta_salida', 'reserva_pedido'].includes(k.tipo_movimiento));
    } else if (kardexFilter === 'ajustes') {
      list = list.filter(k =>
        ['ajuste_positivo', 'ajuste_negativo', 'merma_dano'].includes(k.tipo_movimiento)
      );
    }

    return list;
  }, [kardexList, search, kardexFilter]);

  const handleQuickDelta = async (sku: string, delta: number) => {
    setIsAdjustingQuick(true);
    const res = await quickAddStockDelta(sku, delta, 'Ajuste rápido en Bodega (Inventario)');
    setIsAdjustingQuick(false);

    if (res.success) {
      showToast('ok', `Stock de ${sku} actualizado (${delta > 0 ? `+${delta}` : delta} uds).`);
      await loadNativeInventory();
    } else {
      showToast('err', res.error || 'No se pudo actualizar el stock en Supabase.');
    }
  };

  const handleSaveEntrada = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entradaSku.trim() || !entradaCantidad) return;
    setIsSavingEntrada(true);

    const res = await recordStockEntry({
      sku: entradaSku.toUpperCase().trim(),
      cantidad: parseInt(entradaCantidad, 10),
      costo_unitario: parseFloat(entradaCosto || '0'),
      tipo_entrada: entradaTipo,
      proveedor: entradaTipo === 'compra_entrada' ? entradaProveedor : undefined,
      notas: entradaNotas,
      asentar_en_finanzas: entradaTipo === 'compra_entrada' ? entradaAsentarFinanzas : false,
      cuenta_finanzas_id: 'banco_principal'
    });

    setIsSavingEntrada(false);

    if (res.success) {
      showToast(
        'ok',
        entradaTipo === 'compra_entrada'
          ? `Compra de ${entradaCantidad}x ${entradaSku.toUpperCase()} asentada en bodega.`
          : `Se sumaron +${entradaCantidad} unidades a ${entradaSku.toUpperCase()} (sin afectar Finanzas).`
      );
      setShowEntradaModal(false);
      setEntradaSku('');
      setEntradaCantidad('');
      setEntradaCosto('');
      setEntradaProveedor('');
      setEntradaNotas('');
      await loadNativeInventory();
    } else {
      showToast('err', res.error || 'Error registrando entrada en Supabase.');
    }
  };

  const handleSaveAjuste = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ajusteSku.trim() || ajusteNuevoStock === '') return;
    setIsSavingAjuste(true);

    const isMerma = ajusteMotivo.toLowerCase().includes('merma');
    const res = await adjustStock({
      sku: ajusteSku.toUpperCase().trim(),
      nuevo_stock: parseInt(ajusteNuevoStock, 10),
      motivo: ajusteMotivo,
      tipo: isMerma ? 'merma_dano' : undefined
    });

    setIsSavingAjuste(false);

    if (res.success) {
      showToast('ok', `Stock físico de ${ajusteSku.toUpperCase()} fijado en ${ajusteNuevoStock} unidades.`);
      setShowAjusteModal(false);
      setAjusteSku('');
      setAjusteNuevoStock('');
      await loadNativeInventory();
    } else {
      showToast('err', res.error || 'Error aplicando conteo físico en Supabase.');
    }
  };

  const getTipoBadge = (tipo: string) => {
    switch (tipo) {
      case 'inventario_inicial':
        return (
          <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
            Inventario inicial
          </span>
        );
      case 'compra_entrada':
        return (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Entrada compra
          </span>
        );
      case 'venta_salida':
        return (
          <span className="text-xs font-medium text-sky-600 dark:text-sky-400">
            Venta entregada
          </span>
        );
      case 'reserva_pedido':
        return (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
            Reserva pedido
          </span>
        );
      case 'liberar_reserva':
        return (
          <span className="text-xs font-medium text-[var(--mu)]">
            Reserva liberada
          </span>
        );
      case 'devolucion_entrada':
        return (
          <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
            Devolución bodega
          </span>
        );
      case 'ajuste_positivo':
        return (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
            Ajuste conteo (+)
          </span>
        );
      case 'ajuste_negativo':
      case 'merma_dano':
        return (
          <span className="text-xs font-medium text-rose-600 dark:text-rose-400">
            Merma / Ajuste (-)
          </span>
        );
      default:
        return <span className="text-xs font-mono text-[var(--mu)]">{tipo}</span>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16 h-full">
      {/* Toast flotante */}
      {toastMsg && (
        <div
          className={`fixed bottom-5 right-5 z-[60] max-w-md px-4 py-3 rounded-xl shadow-xl border flex items-center gap-2.5 text-xs font-medium ${
            toastMsg.type === 'ok'
              ? 'bg-emerald-950/95 border-emerald-500/40 text-emerald-200'
              : 'bg-rose-950/95 border-rose-500/40 text-rose-200'
          }`}
        >
          {toastMsg.type === 'ok' ? (
            <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle size={15} className="text-rose-400 shrink-0" />
          )}
          <span className="flex-1">{toastMsg.text}</span>
          <button type="button" onClick={() => setToastMsg(null)} className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Alerta SQL Supabase */}
      {(!isRealDb || dbError) && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs">
            <Database size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-700 dark:text-amber-300 block">
                Conexión con Supabase pendiente de actualizar (Sprint 10)
              </span>
              <span className="text-[var(--mu)] block mt-0.5">
                {dbError ||
                  'Ejecuta el script SQL Sprint 10 en Supabase para habilitar ingresos sin compra y Kárdex atómico.'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowSqlModal(true)}
            className="px-3.5 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] text-xs font-semibold flex items-center gap-1.5 shrink-0 hover:opacity-90 transition-opacity"
          >
            <Code size={13} /> Copiar SQL
          </button>
        </div>
      )}

      {/* Encabezado */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Inventario &amp; Kárdex
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mu)] mt-1">
            <span>{metrics.activeSkus} SKUs activos</span>
            <span aria-hidden="true">·</span>
            <span>{isRealDb ? 'Supabase conectado' : 'Modo respaldo'}</span>
            <span aria-hidden="true">·</span>
            <span>Físico, reservas y Kárdex inmutable</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={loadNativeInventory}
            className="p-2 border border-[var(--bd)] bg-cd hover:bg-sf rounded-lg text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] transition-colors"
            title="Recargar inventario"
          >
            <RefreshCw size={14} className={loadingNative ? 'animate-spin' : ''} />
          </button>

          <button
            type="button"
            onClick={() => setShowSqlModal(true)}
            className="px-3 py-2 border border-[var(--bd)] bg-cd hover:bg-sf rounded-lg text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] flex items-center gap-1.5 transition-colors"
            title="Script SQL Sprint 10"
          >
            <Code size={13} /> SQL
          </button>

          <Link
            to="/catalogo"
            className="px-3 py-2 border border-[var(--bd)] bg-cd hover:bg-sf rounded-lg text-xs font-medium text-[var(--tx)] flex items-center gap-1.5 transition-colors"
          >
            Catálogo <ExternalLink size={12} />
          </Link>

          <button
            type="button"
            onClick={() => {
              const firstActive = stockItems.find(s => s.activo !== false);
              setAjusteSku(firstActive?.sku || '');
              setAjusteNuevoStock(firstActive ? String(firstActive.stock_fisico) : '');
              setShowAjusteModal(true);
            }}
            className="px-3.5 py-2 border border-[var(--bd)] bg-cd hover:bg-sf text-[var(--tx)] rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
          >
            <SlidersHorizontal size={13} /> Conteo físico
          </button>

          <button
            type="button"
            onClick={() => {
              setEntradaTipo('inventario_inicial');
              setEntradaAsentarFinanzas(false);
              setShowEntradaModal(true);
            }}
            className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-lg text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 transition-opacity"
          >
            <PackagePlus size={14} /> Ingresar stock
          </button>
        </div>
      </header>

      {/* Franja unificada de 5 KPIs */}
      <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-[var(--bd)]">
        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Stock físico</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
            {metrics.totalFisico} <span className="text-xs font-normal font-sans text-[var(--mu)]">uds</span>
          </div>
          <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">{metrics.activeSkus} SKUs activos</div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Stock reservado</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1.5">
            {metrics.totalReservado} <span className="text-xs font-normal font-sans text-[var(--mu)]">en ruta</span>
          </div>
          <div className="text-xs text-[var(--mu)] mt-1">En pedidos activos</div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Disponible real</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1.5">
            {metrics.totalDisponible} <span className="text-xs font-normal font-sans text-[var(--mu)]">libre</span>
          </div>
          <div className="text-xs text-[var(--mu)] mt-1">Físico − Reservado</div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-[var(--mu)]">Valoración al costo</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
            ${metrics.valorizacionCosto.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1">Mercadería activa</div>
        </div>

        <div className="p-5 col-span-2 md:col-span-1">
          <div className="text-xs font-medium text-[var(--mu)]">Valor en venta (PVP)</div>
          <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1.5">
            ${metrics.valorVentaTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
            Margen +${metrics.utilidadPotencial.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
      </section>

      {/* Navegación por pestañas */}
      <nav className="flex items-center gap-6 border-b border-[var(--bd)] overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab('stock')}
          className={`pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
            tab === 'stock'
              ? 'border-[var(--tx)] text-[var(--tx)]'
              : 'border-transparent text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          Control de stock ({filteredInventory.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('kardex')}
          className={`pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
            tab === 'kardex'
              ? 'border-[var(--tx)] text-[var(--tx)]'
              : 'border-transparent text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          Kárdex de movimientos ({filteredKardex.length})
        </button>
      </nav>

      {/* Barra de filtros limpia */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 sm:max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mu)]" />
          <input
            type="text"
            placeholder={tab === 'stock' ? 'Buscar por SKU, nombre o ubicación...' : 'Buscar por SKU, motivo o tipo...'}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-cd border border-[var(--bd)] rounded-lg text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--mu)] hover:text-[var(--tx)]"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {tab === 'stock' ? (
          <button
            type="button"
            onClick={() => setFilterCriticos(!filterCriticos)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
              filterCriticos
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                : 'bg-cd border-[var(--bd)] text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <AlertTriangle size={13} /> Críticos ({metrics.skusCriticos})
          </button>
        ) : (
          <div className="inline-flex bg-sf p-1 rounded-lg border border-[var(--bd)] text-xs font-medium">
            {(
              [
                ['all', 'Todos'],
                ['entradas', 'Entradas'],
                ['salidas', 'Ventas'],
                ['ajustes', 'Ajustes']
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setKardexFilter(val)}
                className={`px-3 py-1 rounded-md transition-colors ${
                  kardexFilter === val
                    ? 'bg-cd text-[var(--tx)] font-semibold border border-[var(--bd)]'
                    : 'text-[var(--mu)] hover:text-[var(--tx)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* PESTAÑA 1: TABLA OPERATIVA DE CONTROL DE STOCK */}
      {tab === 'stock' && (
        <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf/50 border-b border-[var(--bd)] text-[var(--mu)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Producto / SKU</th>
                  <th className="px-4 py-3 font-medium">Ubicación</th>
                  <th className="px-4 py-3 text-center font-medium">Físico</th>
                  <th className="px-4 py-3 text-center font-medium">Reservado</th>
                  <th className="px-4 py-3 text-center font-medium">Disponible</th>
                  <th className="px-4 py-3 text-right font-medium">Valoración</th>
                  <th className="px-4 py-3 text-right font-medium">Ajuste rápido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {loadingNative && filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-[var(--mu)]">
                      Cargando inventario desde Supabase...
                    </td>
                  </tr>
                ) : filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-[var(--mu)] space-y-2">
                      <div>No hay SKUs activos en inventario con estos filtros.</div>
                      <Link
                        to="/catalogo"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--tx)] hover:underline"
                      >
                        Ir a Catálogo Visual →
                      </Link>
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map(item => {
                    const valorizadoCosto = (item.stock_fisico || 0) * (item.costo_unitario || 0);
                    const valorizadoVenta = (item.stock_fisico || 0) * (item.precio_venta || 0);
                    const esBajo = item.stock_disponible <= (item.stock_minimo_alerta || 5);
                    const itemVariants = item.template_id
                      ? variantsByTemplate.get(String(item.template_id)) || []
                      : [];

                    return (
                      <tr key={item.sku} className="hover:bg-sf/40 transition-colors">
                        <td className="px-4 py-3.5">
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg overflow-hidden bg-sf border border-[var(--bd)] shrink-0">
                              <ProductImg src={item.image_url} className="w-full h-full object-cover" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-mono font-semibold text-[var(--tx)] text-[11px] flex items-center gap-1.5">
                                {item.sku}
                                <Link
                                  to={`/catalogo?sku=${encodeURIComponent(item.sku)}`}
                                  className="text-[var(--mu)] hover:text-[var(--tx)]"
                                  title="Ver ficha en Catálogo Visual"
                                >
                                  <ExternalLink size={11} />
                                </Link>
                              </div>
                              <div className="font-medium text-[var(--tx)] truncate max-w-[230px]">
                                {item.nombre}
                              </div>
                              {itemVariants.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1 mt-1.5 max-w-[300px]">
                                  {itemVariants.map(v => (
                                    <Link
                                      key={v.variante_id}
                                      to={`/catalogo?sku=${encodeURIComponent(item.sku)}`}
                                      title={`${v.sku}: ${v.stock} unidades disponibles`}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium transition-colors ${
                                        v.stock > 0
                                          ? 'bg-sf border-[var(--bd)] text-[var(--tx)] hover:border-[var(--tx)]'
                                          : 'bg-rose-500/5 border-rose-500/20 text-rose-600 dark:text-rose-400'
                                      }`}
                                    >
                                      <span
                                        className="w-2 h-2 rounded-full border border-black/20 shrink-0"
                                        style={{ backgroundColor: getVariantDotColor(v.color) }}
                                      />
                                      <span className="truncate max-w-[90px]">
                                        {v.color}
                                        {v.talla && v.talla !== 'Única' ? `·${v.talla}` : ''}
                                      </span>
                                      <strong className="font-mono tabular-nums">{v.stock}</strong>
                                    </Link>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-[var(--mu)] whitespace-nowrap">
                          {item.ubicacion || 'Bodega Central'}
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono tabular-nums font-bold text-sm text-[var(--tx)]">
                          {item.stock_fisico}
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono tabular-nums">
                          {item.stock_reservado > 0 ? (
                            <button
                              type="button"
                              onClick={() => openReservedBreakdown(item.sku)}
                              className="px-2 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 font-semibold hover:opacity-80 transition-opacity cursor-pointer"
                              title="Ver pedidos que tienen reservadas estas unidades"
                            >
                              -{item.stock_reservado}
                            </button>
                          ) : (
                            <span className="text-[var(--mu)]">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono tabular-nums font-bold">
                          <span
                            className={
                              item.stock_disponible <= 0
                                ? 'text-rose-600 dark:text-rose-400'
                                : esBajo
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-emerald-600 dark:text-emerald-400'
                            }
                          >
                            {item.stock_disponible}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="font-semibold text-[var(--tx)]">${valorizadoVenta.toFixed(2)}</div>
                          <div className="text-[11px] text-[var(--mu)]">
                            Costo ${valorizadoCosto.toFixed(2)} · PVP ${(item.precio_venta || 0).toFixed(2)}
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(item.sku, -1)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 rounded border border-[var(--bd)] bg-cd hover:bg-sf text-rose-600 dark:text-rose-400 text-[11px] font-mono font-semibold"
                              title="Restar 1 unidad"
                            >
                              -1
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(item.sku, 1)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 rounded border border-[var(--bd)] bg-cd hover:bg-sf text-emerald-600 dark:text-emerald-400 text-[11px] font-mono font-semibold"
                              title="Sumar 1 unidad sin compra"
                            >
                              +1
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(item.sku, 5)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 rounded border border-[var(--bd)] bg-cd hover:bg-sf text-emerald-600 dark:text-emerald-400 text-[11px] font-mono font-semibold"
                              title="Sumar 5 unidades sin compra"
                            >
                              +5
                            </button>
                            <button
                              type="button"
                              onClick={() => handleQuickDelta(item.sku, 10)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 rounded border border-[var(--bd)] bg-cd hover:bg-sf text-emerald-600 dark:text-emerald-400 text-[11px] font-mono font-semibold"
                              title="Sumar 10 unidades sin compra"
                            >
                              +10
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEntradaTipo('inventario_inicial');
                                setEntradaAsentarFinanzas(false);
                                setEntradaSku(item.sku);
                                setEntradaCosto(String(item.costo_unitario || ''));
                                setShowEntradaModal(true);
                              }}
                              className="px-2.5 py-1 rounded border border-[var(--bd)] bg-cd hover:bg-sf text-[var(--tx)] text-[11px] font-semibold"
                              title="Ingresar lote"
                            >
                              + Lote
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAjusteSku(item.sku);
                                setAjusteNuevoStock(String(item.stock_fisico));
                                setShowAjusteModal(true);
                              }}
                              className="px-2.5 py-1 rounded border border-[var(--bd)] bg-cd hover:bg-sf text-[var(--mu)] hover:text-[var(--tx)] text-[11px] font-medium"
                              title="Fijar stock físico exacto"
                            >
                              Conteo
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PESTAÑA 2: KÁRDEX INMUTABLE DE MOVIMIENTOS */}
      {tab === 'kardex' && (
        <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf/50 border-b border-[var(--bd)] text-[var(--mu)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Fecha y hora</th>
                  <th className="px-4 py-3 font-medium">SKU</th>
                  <th className="px-4 py-3 font-medium">Tipo de movimiento</th>
                  <th className="px-4 py-3 text-center font-medium">Cantidad</th>
                  <th className="px-4 py-3 text-center font-medium">Saldo</th>
                  <th className="px-4 py-3 font-medium">Motivo / Concepto</th>
                  <th className="px-4 py-3 font-medium">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {filteredKardex.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-[var(--mu)]">
                      No hay movimientos en el Kárdex para estos filtros.
                    </td>
                  </tr>
                ) : (
                  filteredKardex.map(k => (
                    <tr key={k.id} className="hover:bg-sf/40 transition-colors">
                      <td className="px-4 py-3 font-mono tabular-nums text-[11px] whitespace-nowrap text-[var(--mu)]">
                        {new Date(k.created_at).toLocaleString('es-SV', {
                          dateStyle: 'short',
                          timeStyle: 'short'
                        })}
                      </td>
                      <td className="px-4 py-3 font-mono font-semibold text-[var(--tx)]">{k.sku}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{getTipoBadge(k.tipo_movimiento)}</td>
                      <td
                        className={`px-4 py-3 text-center font-mono tabular-nums font-bold ${
                          k.cantidad > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {k.cantidad > 0 ? `+${k.cantidad}` : k.cantidad}
                      </td>
                      <td className="px-4 py-3 text-center font-mono tabular-nums font-semibold text-[var(--tx)]">
                        {k.saldo_fisico}
                      </td>
                      <td className="px-4 py-3 max-w-sm truncate text-[var(--tx)]">{k.motivo}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-[11px] text-[var(--mu)]">
                        {k.usuario || 'Sistema'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL 1: INGRESAR STOCK */}
      {showEntradaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowEntradaModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
              <h3 className="font-semibold text-sm">Ingresar unidades a bodega</h3>
              <button type="button" onClick={() => setShowEntradaModal(false)} className="p-1 rounded-lg text-[var(--mu)] hover:text-[var(--tx)]">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEntrada} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-1 p-1 bg-sf rounded-lg border border-[var(--bd)]">
                <button
                  type="button"
                  onClick={() => {
                    setEntradaTipo('inventario_inicial');
                    setEntradaAsentarFinanzas(false);
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    entradaTipo === 'inventario_inicial'
                      ? 'bg-[var(--tx)] text-[var(--cd)]'
                      : 'text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  <Boxes size={13} /> Stock real / Sin compra
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEntradaTipo('compra_entrada');
                    setEntradaAsentarFinanzas(true);
                  }}
                  className={`py-2 px-3 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    entradaTipo === 'compra_entrada'
                      ? 'bg-[var(--tx)] text-[var(--cd)]'
                      : 'text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  <CreditCard size={13} /> Compra a proveedor
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">SKU del producto *</label>
                <input
                  type="text"
                  list="skus-existentes-inv"
                  value={entradaSku}
                  onChange={e => setEntradaSku(e.target.value.toUpperCase())}
                  placeholder="Escribe o selecciona un SKU"
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs uppercase font-mono font-semibold text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  required
                />
                <datalist id="skus-existentes-inv">
                  {stockItems
                    .filter(s => s.activo !== false)
                    .map(s => (
                      <option key={s.sku} value={s.sku}>
                        {s.nombre} ({s.stock_fisico} uds)
                      </option>
                    ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">Unidades a sumar *</label>
                  <input
                    type="number"
                    min="1"
                    value={entradaCantidad}
                    onChange={e => setEntradaCantidad(e.target.value)}
                    placeholder="25"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-sm font-mono tabular-nums font-semibold text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                    {entradaTipo === 'compra_entrada' ? 'Costo unitario ($)' : 'Costo ref. ($ opcional)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={entradaCosto}
                    onChange={e => setEntradaCosto(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-sm font-mono tabular-nums font-semibold text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  />
                </div>
              </div>

              {entradaTipo === 'compra_entrada' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--mu)] mb-1">Proveedor</label>
                      <input
                        type="text"
                        value={entradaProveedor}
                        onChange={e => setEntradaProveedor(e.target.value)}
                        placeholder="Importadora Central"
                        className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--mu)] mb-1">Notas / Factura</label>
                      <input
                        type="text"
                        value={entradaNotas}
                        onChange={e => setEntradaNotas(e.target.value)}
                        placeholder="Factura #1234"
                        className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-sf rounded-lg border border-[var(--bd)] flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="asentarFinanzasInv"
                      checked={entradaAsentarFinanzas}
                      onChange={e => setEntradaAsentarFinanzas(e.target.checked)}
                      className="mt-0.5 rounded focus:ring-0"
                    />
                    <label htmlFor="asentarFinanzasInv" className="text-xs cursor-pointer">
                      <span className="font-semibold text-[var(--tx)] block">
                        Asentar egreso automático en Finanzas
                      </span>
                      <span className="text-[11px] text-[var(--mu)] block mt-0.5 tabular-nums">
                        Registrará el pago de $
                        {(parseInt(entradaCantidad || '0', 10) * parseFloat(entradaCosto || '0')).toFixed(2)} en Banco Principal.
                      </span>
                    </label>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                    Motivo / Nota (opcional)
                  </label>
                  <input
                    type="text"
                    value={entradaNotas}
                    onChange={e => setEntradaNotas(e.target.value)}
                    placeholder="Existencia física actual en bodega"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  />
                  <p className="text-[11px] text-[var(--mu)] mt-1.5">
                    Suma las unidades directamente a inventario sin crear egresos en Finanzas.
                  </p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEntradaModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium text-[var(--tx)] hover:bg-sf"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingEntrada}
                  className="px-5 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs hover:opacity-90 disabled:opacity-50"
                >
                  {isSavingEntrada
                    ? 'Guardando...'
                    : entradaTipo === 'compra_entrada'
                      ? 'Registrar compra'
                      : 'Sumar a bodega'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: CONTEO FÍSICO REAL */}
      {showAjusteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowAjusteModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
              <h3 className="font-semibold text-sm">Conteo físico real</h3>
              <button type="button" onClick={() => setShowAjusteModal(false)} className="p-1 rounded-lg text-[var(--mu)] hover:text-[var(--tx)]">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveAjuste} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">SKU a ajustar *</label>
                <input
                  type="text"
                  list="skus-existentes-ajuste"
                  value={ajusteSku}
                  onChange={e => {
                    const nextSku = e.target.value.toUpperCase();
                    setAjusteSku(nextSku);
                    const found = stockItems.find(s => s.sku === nextSku);
                    if (found) setAjusteNuevoStock(String(found.stock_fisico));
                  }}
                  placeholder="Selecciona o escribe el SKU"
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono font-semibold uppercase text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  required
                />
                <datalist id="skus-existentes-ajuste">
                  {stockItems
                    .filter(s => s.activo !== false)
                    .map(s => (
                      <option key={s.sku} value={s.sku}>
                        {s.nombre} ({s.stock_fisico} uds)
                      </option>
                    ))}
                </datalist>
                <span className="text-[11px] text-[var(--mu)] mt-1 block">
                  Define cuántas unidades físicas existen exactamente hoy en bodega.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">Stock físico real *</label>
                <input
                  type="number"
                  min="0"
                  value={ajusteNuevoStock}
                  onChange={e => setAjusteNuevoStock(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-lg font-mono tabular-nums font-bold text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">Motivo *</label>
                <select
                  value={ajusteMotivo}
                  onChange={e => setAjusteMotivo(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs text-[var(--tx)] outline-none focus:border-[var(--tx)]"
                >
                  <option value="Conteo físico periódico">Conteo físico periódico</option>
                  <option value="Carga de inventario real">Carga de inventario real</option>
                  <option value="Merma o producto quebrado">Merma o producto quebrado</option>
                  <option value="Muestra para creador de contenido">Muestra para creador de contenido</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAjusteModal(false)}
                  className="px-3.5 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium text-[var(--tx)] hover:bg-sf"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingAjuste}
                  className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs hover:opacity-90 disabled:opacity-50"
                >
                  {isSavingAjuste ? 'Guardando...' : 'Aplicar conteo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: SCRIPT SQL SPRINT 10 */}
      <Sprint10SqlModal open={showSqlModal} onClose={() => setShowSqlModal(false)} />

      {/* MODAL 4: DESGLOSE DE UNIDADES RESERVADAS */}
      {reservedModalSku && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setReservedModalSku(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm">
                  Pedidos reservando <span className="font-mono">#{reservedModalSku}</span>
                </h3>
                <p className="text-xs text-[var(--mu)] mt-0.5">
                  Órdenes actualmente en fase Empaque o En Camino.
                </p>
              </div>
              <button type="button" onClick={() => setReservedModalSku(null)} className="p-1 rounded-lg text-[var(--mu)] hover:text-[var(--tx)]">
                <X size={16} />
              </button>
            </div>

            <div className="max-h-80 overflow-y-auto divide-y divide-[var(--bd)]">
              {loadingReserved ? (
                <div className="py-10 text-center text-xs text-[var(--mu)]">Buscando pedidos activos...</div>
              ) : reservedOrders.length === 0 ? (
                <div className="py-10 px-5 text-center text-xs text-[var(--mu)]">
                  No se encontraron pedidos activos en Por Empacar / En Camino para #{reservedModalSku}.
                  <span className="block mt-1 opacity-75">
                    Si quedó reserva huérfana de un pedido antiguo borrado, usa Conteo Físico.
                  </span>
                </div>
              ) : (
                reservedOrders.map((ord: any) => {
                  const lines = resolveOrderInventoryLines(ord, stockItems);
                  const qty = lines.find(l => l.sku === reservedModalSku)?.cantidad || 1;
                  return (
                    <div
                      key={ord.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[11px] font-semibold text-[var(--mu)]">
                            #{String(ord.id).slice(0, 8).toUpperCase()}
                          </span>
                          <span className="text-xs font-semibold text-[var(--tx)] truncate">
                            {ord.nombre_cliente || 'Cliente'}
                          </span>
                          <span className="text-[11px] text-[var(--mu)]">
                            · {ord.estado === 'en_camino' ? 'En camino' : 'Por empacar'}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--mu)] mt-0.5 flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1">
                            <Truck size={10} /> {ord.courier || 'Sin asignar'}
                          </span>
                          <span>· {ord.departamento || 'San Salvador'}</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-xs font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 block">
                          {qty} ud(s)
                        </span>
                        <span className="text-[11px] font-mono tabular-nums text-[var(--mu)]">
                          ${Number(ord.total || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-[var(--bd)] bg-sf/40 flex items-center justify-between">
              <Link
                to="/pedidos"
                className="text-xs font-semibold text-[var(--tx)] hover:underline flex items-center gap-1"
              >
                Ver todos en Pedidos <ExternalLink size={12} />
              </Link>
              <button
                type="button"
                onClick={() => setReservedModalSku(null)}
                className="px-4 py-1.5 rounded-lg border border-[var(--bd)] bg-cd text-xs font-medium text-[var(--tx)]"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
