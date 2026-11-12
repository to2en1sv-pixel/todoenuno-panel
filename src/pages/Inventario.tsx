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
  SlidersHorizontal
} from 'lucide-react';
import {
  fetchStockItems,
  fetchKardexMovements,
  recordStockEntry,
  adjustStock,
  quickAddStockDelta
} from '@/lib/inventory';
import { ProductImg } from '@/components/inventory/ProductImg';
import { Sprint10SqlModal } from '@/components/inventory/Sprint10SqlModal';
import type { StockItem, KardexMovement } from '@/types/inventory';

export function InventarioPage() {
  const [searchParams] = useSearchParams();

  const [tab, setTab] = useState<'stock' | 'kardex'>('stock');
  const [search, setSearch] = useState(() => searchParams.get('sku') || '');
  const [filterCriticos, setFilterCriticos] = useState(() => searchParams.get('filter') === 'criticos');
  const [kardexFilter, setKardexFilter] = useState<'all' | 'entradas' | 'salidas' | 'ajustes'>('all');

  const [stockItems, setStockItems] = useState<StockItem[]>([]);
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
    const [stockRes, kardexRes] = await Promise.all([
      fetchStockItems(),
      fetchKardexMovements()
    ]);
    setStockItems(stockRes.items);
    setIsRealDb(stockRes.isRealDb);
    setDbError(stockRes.error || null);
    setKardexList(kardexRes.movements);
    setLoadingNative(false);
  };

  useEffect(() => {
    loadNativeInventory();
  }, []);

  // Sincronizar si el usuario llega desde Catálogo Visual con ?sku=...
  useEffect(() => {
    const skuParam = searchParams.get('sku');
    if (skuParam) setSearch(skuParam);
    const filterParam = searchParams.get('filter');
    if (filterParam === 'criticos') setFilterCriticos(true);
  }, [searchParams]);

  // KPIs de Bodega
  const metrics = useMemo(() => {
    let totalFisico = 0;
    let totalReservado = 0;
    let totalDisponible = 0;
    let valorizacionTotal = 0;
    let skusCriticos = 0;

    stockItems.forEach(item => {
      if (item.sku.toLowerCase().includes('fee')) return;
      totalFisico += item.stock_fisico || 0;
      totalReservado += item.stock_reservado || 0;
      totalDisponible += item.stock_disponible || 0;
      valorizacionTotal += (item.stock_fisico || 0) * (item.costo_unitario || 0);
      if (item.stock_disponible <= (item.stock_minimo_alerta || 5)) {
        skusCriticos++;
      }
    });

    return { totalFisico, totalReservado, totalDisponible, valorizacionTotal, skusCriticos };
  }, [stockItems]);

  // Filtrado de Stock
  const filteredInventory = useMemo(() => {
    let list = stockItems.filter(i => !i.sku.toLowerCase().includes('fee'));

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
        ['inventario_inicial', 'compra_entrada', 'devolucion_entrada'].includes(k.tipo_movimiento)
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
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
            📥 Inventario Inicial
          </span>
        );
      case 'compra_entrada':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            📦 Entrada Compra
          </span>
        );
      case 'venta_salida':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
            🚚 Venta Entregada
          </span>
        );
      case 'reserva_pedido':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
            ⏳ Reserva Pedido
          </span>
        );
      case 'devolucion_entrada':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20">
            ↩️ Devolución Bodega
          </span>
        );
      case 'ajuste_positivo':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-500/10 text-teal-600 border border-teal-500/20">
            ➕ Ajuste Conteo (+)
          </span>
        );
      case 'ajuste_negativo':
      case 'merma_dano':
        return (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
            ⚠️ Merma / Ajuste (-)
          </span>
        );
      default:
        return <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-sf tx-mu">{tipo}</span>;
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-5 pb-14 h-full">
      {/* Toast flotante */}
      {toastMsg && (
        <div
          className={`fixed bottom-5 right-5 z-[60] max-w-md px-4 py-3 rounded-2xl shadow-2xl border flex items-center gap-2.5 text-xs font-bold animate-in fade-in slide-in-from-bottom-4 ${
            toastMsg.type === 'ok'
              ? 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/95 border-rose-500/50 text-rose-200'
          }`}
        >
          {toastMsg.type === 'ok' ? (
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle size={16} className="text-rose-400 shrink-0" />
          )}
          <span className="flex-1">{toastMsg.text}</span>
          <button onClick={() => setToastMsg(null)} className="opacity-70 hover:opacity-100">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Alerta SQL Supabase */}
      {(!isRealDb || dbError) && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-xs">
            <Database size={18} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-amber-600 dark:text-amber-400 block">
                Conexión con Supabase pendiente de actualizar (Sprint 10)
              </span>
              <span className="tx-mu block mt-0.5">
                {dbError ||
                  'Ejecuta el script SQL Sprint 10 en Supabase para habilitar ingresos sin compra, Kárdex atómico y eliminación en cascada.'}
              </span>
            </div>
          </div>
          <button
            onClick={() => setShowSqlModal(true)}
            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-xl text-xs font-black flex items-center gap-1.5 shrink-0 transition-colors"
          >
            <Code size={14} /> Copiar SQL Reparador
          </button>
        </div>
      )}

      {/* Encabezado Principal de Bodega */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div className="min-w-0 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <Boxes className="text-emerald-500 shrink-0" size={24} />
            <h1 className="text-xl sm:text-2xl font-black tracking-tight whitespace-normal sm:whitespace-nowrap">
              Inventario & Kárdex
            </h1>
            <span
              className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full border shrink-0 flex items-center gap-1 ${
                isRealDb
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30'
              }`}
            >
              <Database size={10} /> {isRealDb ? 'Supabase Conectado' : 'Modo Respaldo'}
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1 max-w-xl">
            Control físico de bodega: existencias reales, unidades reservadas por pedidos, carga directa sin compra y Kárdex inmutable.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
          <Link
            to="/catalogo"
            className="px-3.5 py-2 border border-[var(--bd)] bg-sf hover:bg-cd rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
          >
            Catálogo Visual <ExternalLink size={13} />
          </Link>

          <button
            onClick={() => {
              setEntradaTipo('inventario_inicial');
              setEntradaAsentarFinanzas(false);
              setShowEntradaModal(true);
            }}
            className="flex-1 sm:flex-none px-3.5 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 hover:opacity-90 shadow-sm"
          >
            <PackagePlus size={15} /> + Ingresar Stock
          </button>

          <button
            onClick={() => {
              setAjusteSku(stockItems[0]?.sku || '');
              setAjusteNuevoStock(stockItems[0] ? String(stockItems[0].stock_fisico) : '');
              setShowAjusteModal(true);
            }}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <SlidersHorizontal size={14} /> Conteo Físico
          </button>

          <button
            onClick={loadNativeInventory}
            className="p-2 border border-[var(--bd)] rounded-xl text-xs font-bold hover:bg-sf transition-colors"
            title="Recargar inventario desde Supabase"
          >
            <RefreshCw size={16} className={loadingNative ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setShowSqlModal(true)}
            className="p-2 border border-[var(--bd)] rounded-xl text-xs font-bold hover:bg-sf transition-colors"
            title="Script SQL Sprint 10 (Supabase)"
          >
            <Code size={16} />
          </button>
        </div>
      </div>

      {/* Tarjetas KPI de Inventario */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Stock Físico (Bodega)
          </span>
          <div className="text-2xl font-black mt-1 text-[var(--tx)]">
            {metrics.totalFisico} <span className="text-xs font-normal tx-mu">unidades</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">En {stockItems.length} SKUs registrados</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Stock Reservado
          </span>
          <div className="text-2xl font-black mt-1 text-amber-500">
            {metrics.totalReservado} <span className="text-xs font-normal tx-mu">en camino</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Comprometido en pedidos activos</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Stock Disponible Real
          </span>
          <div className="text-2xl font-black mt-1 text-emerald-500">
            {metrics.totalDisponible} <span className="text-xs font-normal tx-mu">para venta</span>
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Físico − Reservado</span>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
          <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">
            Valorización Inventario
          </span>
          <div className="text-2xl font-black mt-1 text-[var(--ac)]">
            ${metrics.valorizacionTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <span className="text-[10px] tx-mu mt-1 block">Costo de mercadería en bodega</span>
        </div>
      </div>

      {/* Selector de Pestañas & Buscador */}
      <div className="flex flex-col md:flex-row justify-between items-stretch md:items-center gap-3 bg-cd p-3 rounded-2xl border border-[var(--bd)]">
        <div className="flex bg-sf p-1 rounded-xl overflow-x-auto">
          <button
            onClick={() => setTab('stock')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'stock' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <Layers size={14} /> Control de Stock ({filteredInventory.length})
          </button>
          <button
            onClick={() => setTab('kardex')}
            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap flex items-center gap-1.5 ${
              tab === 'kardex' ? 'bg-cd shadow-sm text-[var(--tx)]' : 'text-[var(--mu)] hover:text-[var(--tx)]'
            }`}
          >
            <History size={14} /> Kárdex de Movimientos ({filteredKardex.length})
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
            <input
              type="text"
              placeholder={tab === 'stock' ? 'Buscar por SKU, nombre o ubicación...' : 'Buscar por SKU, motivo o tipo...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-9 pr-7 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs outline-none focus:border-[var(--ac)]"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 tx-mu hover:text-[var(--tx)]"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {tab === 'stock' ? (
            <button
              onClick={() => setFilterCriticos(!filterCriticos)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors whitespace-nowrap ${
                filterCriticos
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-600'
                  : 'bg-sf border-[var(--bd)] text-[var(--mu)] hover:bg-cd'
              }`}
            >
              <AlertTriangle size={14} /> Críticos ({metrics.skusCriticos})
            </button>
          ) : (
            <div className="flex bg-sf p-1 rounded-xl border border-[var(--bd)] text-[11px] font-bold">
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
                  onClick={() => setKardexFilter(val)}
                  className={`px-2.5 py-1 rounded-lg transition-colors ${
                    kardexFilter === val ? 'bg-cd text-[var(--tx)] shadow-sm' : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* PESTAÑA 1: TABLA OPERATIVA DE CONTROL DE STOCK */}
      {tab === 'stock' && (
        <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                <tr>
                  <th className="px-4 py-3">Producto / SKU</th>
                  <th className="px-4 py-3">Ubicación</th>
                  <th className="px-4 py-3 text-center">Stock Físico</th>
                  <th className="px-4 py-3 text-center">Reservado</th>
                  <th className="px-4 py-3 text-center">Disponible</th>
                  <th className="px-4 py-3 text-right">Costo / Val.</th>
                  <th className="px-4 py-3 text-right">Movimientos Rápidos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {loadingNative && filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center tx-mu">
                      Cargando inventario real desde Supabase...
                    </td>
                  </tr>
                ) : filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center tx-mu space-y-2">
                      <div>No hay SKUs en inventario con estos filtros.</div>
                      <Link
                        to="/catalogo"
                        className="inline-flex items-center gap-1 text-xs font-bold text-[var(--ac)] hover:underline"
                      >
                        Ir a Catálogo Visual para crear un producto →
                      </Link>
                    </td>
                  </tr>
                ) : (
                  filteredInventory.map(item => {
                    const valorizado = (item.stock_fisico || 0) * (item.costo_unitario || 0);
                    const esBajo = item.stock_disponible <= (item.stock_minimo_alerta || 5);

                    return (
                      <tr key={item.sku} className="hover:bg-sf/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl overflow-hidden bg-sf border border-[var(--bd)] shrink-0">
                              <ProductImg src={item.image_url} className="w-full h-full object-cover" />
                            </div>
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-[var(--tx)] text-[11px] flex items-center gap-1.5">
                                {item.sku}
                                <Link
                                  to={`/catalogo?sku=${encodeURIComponent(item.sku)}`}
                                  className="text-[var(--mu)] hover:text-[var(--ac)]"
                                  title="Ver ficha en Catálogo Visual"
                                >
                                  <ExternalLink size={11} />
                                </Link>
                              </div>
                              <div className="font-medium text-[var(--tx)] truncate max-w-[230px]">
                                {item.nombre}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 tx-mu whitespace-nowrap">
                          {item.ubicacion || 'Bodega Central'}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold text-sm">
                          {item.stock_fisico}
                        </td>
                        <td className="px-4 py-3 text-center font-mono text-amber-500 font-bold">
                          {item.stock_reservado > 0 ? `-${item.stock_reservado}` : '0'}
                        </td>
                        <td className="px-4 py-3 text-center font-mono font-bold">
                          <span
                            className={`px-2.5 py-0.5 rounded-full ${
                              item.stock_disponible <= 0
                                ? 'bg-rose-500/10 text-rose-600'
                                : esBajo
                                ? 'bg-amber-500/10 text-amber-600'
                                : 'bg-emerald-500/10 text-emerald-600'
                            }`}
                          >
                            {item.stock_disponible}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono whitespace-nowrap">
                          <div className="font-bold text-[var(--tx)]">${valorizado.toFixed(2)}</div>
                          <div className="text-[10px] tx-mu">c/u ${(item.costo_unitario || 0).toFixed(2)}</div>
                        </td>
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleQuickDelta(item.sku, -1)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 rounded-lg text-[11px] font-bold"
                              title="Restar 1 unidad"
                            >
                              -1
                            </button>
                            <button
                              onClick={() => handleQuickDelta(item.sku, 1)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 rounded-lg text-[11px] font-bold"
                              title="Sumar 1 unidad sin compra"
                            >
                              +1
                            </button>
                            <button
                              onClick={() => handleQuickDelta(item.sku, 5)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 rounded-lg text-[11px] font-bold"
                              title="Sumar 5 unidades sin compra"
                            >
                              +5
                            </button>
                            <button
                              onClick={() => handleQuickDelta(item.sku, 10)}
                              disabled={isAdjustingQuick}
                              className="px-2 py-1 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 rounded-lg text-[11px] font-bold"
                              title="Sumar 10 unidades sin compra"
                            >
                              +10
                            </button>
                            <button
                              onClick={() => {
                                setEntradaTipo('inventario_inicial');
                                setEntradaAsentarFinanzas(false);
                                setEntradaSku(item.sku);
                                setEntradaCosto(String(item.costo_unitario || ''));
                                setShowEntradaModal(true);
                              }}
                              className="px-2.5 py-1 bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-500/20 rounded-lg text-[11px] font-bold"
                              title="Ingresar lote (sin compra o con compra)"
                            >
                              + Lote
                            </button>
                            <button
                              onClick={() => {
                                setAjusteSku(item.sku);
                                setAjusteNuevoStock(String(item.stock_fisico));
                                setShowAjusteModal(true);
                              }}
                              className="px-2.5 py-1 border border-[var(--bd)] hover:bg-sf rounded-lg text-[11px] font-semibold"
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
        <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-sf border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                <tr>
                  <th className="px-4 py-3">Fecha y Hora</th>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Tipo de Movimiento</th>
                  <th className="px-4 py-3 text-center">Cantidad</th>
                  <th className="px-4 py-3 text-center">Saldo Bodega</th>
                  <th className="px-4 py-3">Motivo / Concepto</th>
                  <th className="px-4 py-3">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {filteredKardex.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center tx-mu">
                      No hay movimientos en el Kárdex para estos filtros.
                    </td>
                  </tr>
                ) : (
                  filteredKardex.map(k => (
                    <tr key={k.id} className="hover:bg-sf/50 transition-colors">
                      <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap tx-mu">
                        {new Date(k.created_at).toLocaleString('es-SV', {
                          dateStyle: 'short',
                          timeStyle: 'short'
                        })}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-[var(--tx)]">{k.sku}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{getTipoBadge(k.tipo_movimiento)}</td>
                      <td
                        className={`px-4 py-3 text-center font-mono font-bold ${
                          k.cantidad > 0 ? 'text-emerald-500' : 'text-rose-500'
                        }`}
                      >
                        {k.cantidad > 0 ? `+${k.cantidad}` : k.cantidad}
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-[var(--tx)]">
                        {k.saldo_fisico}
                      </td>
                      <td className="px-4 py-3 max-w-sm truncate text-[var(--tx)]">{k.motivo}</td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-[10px] tx-mu">
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

      {/* MODAL 1: INGRESAR STOCK (SIN COMPRA O CON COMPRA) */}
      {showEntradaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowEntradaModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <PackagePlus size={18} className="text-emerald-500" />
                <h3 className="font-bold text-sm">Ingresar Unidades a Bodega</h3>
              </div>
              <button onClick={() => setShowEntradaModal(false)} className="p-1 rounded-lg hover:bg-black/10">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveEntrada} className="p-5 space-y-4">
              {/* Selector de Tipo de Entrada */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-sf rounded-xl border border-[var(--bd)]">
                <button
                  type="button"
                  onClick={() => {
                    setEntradaTipo('inventario_inicial');
                    setEntradaAsentarFinanzas(false);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    entradaTipo === 'inventario_inicial'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  <Boxes size={14} /> Stock Real / Sin Compra
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEntradaTipo('compra_entrada');
                    setEntradaAsentarFinanzas(true);
                  }}
                  className={`py-2 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    entradaTipo === 'compra_entrada'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  <CreditCard size={14} /> Compra a Proveedor
                </button>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">SKU del Producto *</label>
                <input
                  type="text"
                  list="skus-existentes-inv"
                  value={entradaSku}
                  onChange={e => setEntradaSku(e.target.value.toUpperCase())}
                  placeholder="Escribe o selecciona un SKU"
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs uppercase font-mono font-bold outline-none focus:border-[var(--ac)]"
                  required
                />
                <datalist id="skus-existentes-inv">
                  {stockItems.map(s => (
                    <option key={s.sku} value={s.sku}>
                      {s.nombre} ({s.stock_fisico} uds)
                    </option>
                  ))}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Unidades a Sumar *</label>
                  <input
                    type="number"
                    min="1"
                    value={entradaCantidad}
                    onChange={e => setEntradaCantidad(e.target.value)}
                    placeholder="Ej. 25"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-base font-bold outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                    {entradaTipo === 'compra_entrada' ? 'Costo Unitario ($)' : 'Costo Ref. ($ Opcional)'}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={entradaCosto}
                    onChange={e => setEntradaCosto(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-base font-bold outline-none"
                  />
                </div>
              </div>

              {entradaTipo === 'compra_entrada' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Proveedor</label>
                      <input
                        type="text"
                        value={entradaProveedor}
                        onChange={e => setEntradaProveedor(e.target.value)}
                        placeholder="Ej. Importadora Central"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Notas / Factura</label>
                      <input
                        type="text"
                        value={entradaNotas}
                        onChange={e => setEntradaNotas(e.target.value)}
                        placeholder="Factura #1234"
                        className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                      />
                    </div>
                  </div>

                  <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="asentarFinanzasInv"
                      checked={entradaAsentarFinanzas}
                      onChange={e => setEntradaAsentarFinanzas(e.target.checked)}
                      className="mt-0.5 rounded text-emerald-600 focus:ring-0"
                    />
                    <label htmlFor="asentarFinanzasInv" className="text-xs cursor-pointer">
                      <span className="font-bold text-[var(--tx)] block">
                        Asentar egreso automático en Finanzas
                      </span>
                      <span className="text-[10px] tx-mu block">
                        Registrará el pago de $
                        {(parseInt(entradaCantidad || '0', 10) * parseFloat(entradaCosto || '0')).toFixed(2)} en
                        Banco Principal.
                      </span>
                    </label>
                  </div>
                </>
              ) : (
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">
                    Motivo / Nota (Opcional)
                  </label>
                  <input
                    type="text"
                    value={entradaNotas}
                    onChange={e => setEntradaNotas(e.target.value)}
                    placeholder="Ej. Existencia física actual en bodega"
                    className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  />
                  <p className="text-[10px] text-indigo-500 mt-1.5 font-medium">
                    ✓ Suma las unidades directamente a tu inventario real sin crear egresos ni deudas en Finanzas.
                  </p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEntradaModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingEntrada}
                  className={`px-5 py-2 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm ${
                    entradaTipo === 'compra_entrada'
                      ? 'bg-emerald-600 hover:bg-emerald-500'
                      : 'bg-indigo-600 hover:bg-indigo-500'
                  }`}
                >
                  {isSavingEntrada
                    ? 'Guardando...'
                    : entradaTipo === 'compra_entrada'
                    ? 'Registrar Compra'
                    : 'Sumar a Bodega'}
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
            className="w-full max-w-sm rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-bold text-sm">Conteo Físico Real</h3>
              <button onClick={() => setShowAjusteModal(false)} className="p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveAjuste} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">SKU a Ajustar *</label>
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
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-mono font-bold uppercase outline-none"
                  required
                />
                <datalist id="skus-existentes-ajuste">
                  {stockItems.map(s => (
                    <option key={s.sku} value={s.sku}>
                      {s.nombre} ({s.stock_fisico} uds)
                    </option>
                  ))}
                </datalist>
                <span className="text-[10px] tx-mu mt-1 block">
                  Define cuántas unidades físicas existen exactamente hoy en bodega.
                </span>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Stock Físico Real *</label>
                <input
                  type="number"
                  min="0"
                  value={ajusteNuevoStock}
                  onChange={e => setAjusteNuevoStock(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xl font-bold outline-none"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Motivo *</label>
                <select
                  value={ajusteMotivo}
                  onChange={e => setAjusteMotivo(e.target.value)}
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
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
                  className="px-3 py-1.5 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingAjuste}
                  className="px-4 py-1.5 bg-[var(--ac)] text-white font-bold rounded-xl text-xs"
                >
                  {isSavingAjuste ? 'Guardando...' : 'Aplicar Conteo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: SCRIPT SQL SPRINT 10 */}
      <Sprint10SqlModal open={showSqlModal} onClose={() => setShowSqlModal(false)} />
    </div>
  );
}
