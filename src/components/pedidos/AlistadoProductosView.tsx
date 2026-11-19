import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Edit,
  Eye,
  EyeOff,
  Package,
  Printer,
  RotateCcw,
  Search,
  Square,
  X,
} from 'lucide-react';
import {
  extractOrderQuantity,
  resolveOrderInventoryLines,
  type OrderForInventory,
} from '@/lib/inventory';
import { normalizeOrderStatus } from '@/lib/finance';
import type { StockItem } from '@/types/inventory';

export interface PickingOrderItem extends OrderForInventory {
  id: string;
  pedido_codigo?: string | null;
  nombre_cliente: string | null;
  total: number | null;
  estado: string | null;
  created_at: string | null;
  sku: string | null;
  catalogo_sku?: string | null;
  codigo_anuncio?: string | null;
  items?: any;
  cantidad?: number | null;
  telefono: string | null;
  direccion: string | null;
  metodo_pago: string | null;
  courier?: string | null;
  departamento?: string | null;
  fecha_programada?: string | null;
  notas: string | null;
}

interface AlistadoProductosViewProps {
  pedidos: PickingOrderItem[];
  stockItems: StockItem[];
  couriers: string[];
  onOpenPedido: (pedido: PickingOrderItem) => void;
  onCambiarEstadoDirecto: (
    pedido: PickingOrderItem,
    destino: 'nuevo' | 'programado' | 'por_empacar' | 'en_camino' | 'entregado' | 'cancelado'
  ) => Promise<void> | void;
}

type PickingStageFilter = 'por_preparar' | 'por_empacar' | 'nuevo' | 'programado' | 'en_camino';

interface PickingOrderRef {
  order: PickingOrderItem;
  cantidad: number;
  detalleTexto: string;
  estadoNormalizado: 'nuevo' | 'programado' | 'por_empacar' | 'en_camino' | 'entregado' | 'cancelado';
}

interface PickingProductGroup {
  key: string;
  sku: string | null;
  nombre: string;
  isMapped: boolean;
  imageUrl: string | null;
  ubicacion: string;
  totalUnidades: number;
  totalPedidos: number;
  unidadesPorEstado: Record<'nuevo' | 'por_empacar' | 'programado' | 'en_camino', number>;
  variantes: Array<{ label: string; unidades: number }>;
  stockFisico: number | null;
  stockDisponible: number | null;
  faltante: number;
  pedidos: PickingOrderRef[];
}

const PICKING_CHECKED_STORAGE_KEY = 'todoenuno_pedidos_picking_checked_v1';

const STAGE_LABEL: Record<PickingStageFilter, string> = {
  por_preparar: 'Por preparar',
  por_empacar: 'Por empacar',
  nuevo: 'Nuevos',
  programado: 'Encargos',
  en_camino: 'En camino',
};

const ORDER_STATE_LABEL: Record<string, string> = {
  nuevo: 'Nuevo',
  por_empacar: 'Por empacar',
  programado: 'Encargo',
  en_camino: 'En camino',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

function cleanProductLabel(raw?: string | null): string {
  const s = String(raw || '')
    .trim()
    .replace(/^\d+\s*x\s+/i, '')
    .replace(/\s+/g, ' ');
  return s || 'Producto sin especificar';
}

function normalizeTextKey(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractVariantHint(rawText: string | null | undefined, canonicalName: string, itemObj?: any): string {
  const explicitParts = [itemObj?.color, itemObj?.variante, itemObj?.talla]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (explicitParts.length > 0) {
    return explicitParts.join(' / ');
  }

  const cleaned = cleanProductLabel(rawText);
  if (!cleaned || cleaned === 'Producto sin especificar') return '';

  const parenMatch = cleaned.match(/\(([^)]+)\)/);
  if (parenMatch && parenMatch[1]) {
    const inside = parenMatch[1].trim();
    if (inside.length >= 2 && inside.length <= 42 && !/^\$?\d+(\.\d+)?$/.test(inside)) {
      return inside;
    }
  }

  const dashParts = cleaned.split(/\s+[-–—/]\s+/);
  if (dashParts.length >= 2) {
    const tail = dashParts.slice(1).join(' / ').trim();
    if (
      tail.length >= 2 &&
      tail.length <= 42 &&
      normalizeTextKey(tail) !== normalizeTextKey(canonicalName) &&
      !/^\$?\d+(\.\d+)?$/.test(tail)
    ) {
      return tail;
    }
  }

  return '';
}

function formatMoney(v: number | null | undefined): string {
  const n = Number(v || 0);
  return `$${n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function loadCheckedKeys(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(PICKING_CHECKED_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function AlistadoProductosView({
  pedidos,
  stockItems,
  couriers,
  onOpenPedido,
  onCambiarEstadoDirecto,
}: AlistadoProductosViewProps) {
  const [stageFilter, setStageFilter] = useState<PickingStageFilter>('por_preparar');
  const [courierFilter, setCourierFilter] = useState<string>('todos');
  const [search, setSearch] = useState('');
  const [hideChecked, setHideChecked] = useState(false);
  const [sortBy, setSortBy] = useState<'cantidad' | 'nombre' | 'faltante'>('cantidad');
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>(() => loadCheckedKeys());
  const [copied, setCopied] = useState(false);
  const [showPrintSheet, setShowPrintSheet] = useState(false);
  const [advancingOrderId, setAdvancingOrderId] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PICKING_CHECKED_STORAGE_KEY, JSON.stringify(checkedKeys));
    } catch {
      // Ignorar fallo de cuota en localStorage
    }
  }, [checkedKeys]);

  // Contadores por etapa (sobre todos los pedidos recibidos)
  const stageCounts = useMemo(() => {
    let nuevo = 0;
    let por_empacar = 0;
    let programado = 0;
    let en_camino = 0;

    for (const p of pedidos) {
      const st = normalizeOrderStatus(p.estado);
      if (st === 'nuevo') nuevo += 1;
      else if (st === 'por_empacar') por_empacar += 1;
      else if (st === 'programado') programado += 1;
      else if (st === 'en_camino') en_camino += 1;
    }

    return {
      por_preparar: nuevo + por_empacar,
      por_empacar,
      nuevo,
      programado,
      en_camino,
    };
  }, [pedidos]);

  // Pedidos que entran al cálculo de alistado según filtros activos
  const filteredOrders = useMemo(() => {
    return pedidos.filter((p) => {
      const st = normalizeOrderStatus(p.estado);
      const matchesStage =
        stageFilter === 'por_preparar'
          ? st === 'nuevo' || st === 'por_empacar'
          : st === stageFilter;

      if (!matchesStage) return false;

      if (courierFilter !== 'todos') {
        const orderCourier = String(p.courier || '').trim() || 'Sin asignar';
        if (orderCourier !== courierFilter) return false;
      }

      return true;
    });
  }, [pedidos, stageFilter, courierFilter]);

  // Agregación de productos necesarios para armar los paquetes
  const allGroups = useMemo<PickingProductGroup[]>(() => {
    const map = new Map<
      string,
      {
        key: string;
        sku: string | null;
        nombre: string;
        isMapped: boolean;
        imageUrl: string | null;
        ubicacion: string;
        totalUnidades: number;
        orderIds: Set<string>;
        unidadesPorEstado: Record<'nuevo' | 'por_empacar' | 'programado' | 'en_camino', number>;
        variantesMap: Map<string, number>;
        stockFisico: number | null;
        stockDisponible: number | null;
        pedidos: PickingOrderRef[];
      }
    >();

    const addEntry = (params: {
      key: string;
      sku: string | null;
      nombre: string;
      isMapped: boolean;
      stockItem: StockItem | null;
      cantidad: number;
      variantHint: string;
      detalleTexto: string;
      order: PickingOrderItem;
      estadoNorm: 'nuevo' | 'programado' | 'por_empacar' | 'en_camino' | 'entregado' | 'cancelado';
    }) => {
      const qty = Math.max(1, Math.round(Number(params.cantidad) || 1));
      let group = map.get(params.key);
      if (!group) {
        group = {
          key: params.key,
          sku: params.sku,
          nombre: params.nombre,
          isMapped: params.isMapped,
          imageUrl: params.stockItem?.image_url || null,
          ubicacion: String(params.stockItem?.ubicacion || '').trim(),
          totalUnidades: 0,
          orderIds: new Set<string>(),
          unidadesPorEstado: {
            nuevo: 0,
            por_empacar: 0,
            programado: 0,
            en_camino: 0,
          },
          variantesMap: new Map<string, number>(),
          stockFisico:
            params.stockItem !== null && params.stockItem !== undefined
              ? Number(params.stockItem.stock_fisico ?? 0)
              : null,
          stockDisponible:
            params.stockItem !== null && params.stockItem !== undefined
              ? Number(params.stockItem.stock_disponible ?? 0)
              : null,
          pedidos: [],
        };
        map.set(params.key, group);
      }

      group.totalUnidades += qty;
      group.orderIds.add(params.order.id);
      if (
        params.estadoNorm === 'nuevo' ||
        params.estadoNorm === 'por_empacar' ||
        params.estadoNorm === 'programado' ||
        params.estadoNorm === 'en_camino'
      ) {
        group.unidadesPorEstado[params.estadoNorm] += qty;
      }

      if (params.variantHint) {
        const cleanHint = params.variantHint.trim();
        group.variantesMap.set(cleanHint, (group.variantesMap.get(cleanHint) || 0) + qty);
      }

      // Evitar filas duplicadas del mismo pedido si el pedido tiene 2 líneas del mismo SKU: acumular cantidad
      const existingOrderRef = group.pedidos.find(
        (ref) => ref.order.id === params.order.id && ref.detalleTexto === params.detalleTexto
      );
      if (existingOrderRef) {
        existingOrderRef.cantidad += qty;
      } else {
        group.pedidos.push({
          order: params.order,
          cantidad: qty,
          detalleTexto: params.detalleTexto,
          estadoNormalizado: params.estadoNorm,
        });
      }
    };

    for (const order of filteredOrders) {
      const estadoNorm = normalizeOrderStatus(order.estado);

      if (Array.isArray(order.items) && order.items.length > 0) {
        for (const it of order.items) {
          const itemQty = Math.min(
            Math.max(Math.round(Number(it?.cantidad ?? it?.qty ?? 1) || 1), 1),
            100
          );
          const rawLabel = cleanProductLabel(it?.nombre || it?.sku || order.sku);
          const singleResolved = resolveOrderInventoryLines(
            {
              ...order,
              items: [it],
              cantidad: undefined,
            },
            stockItems
          );

          if (singleResolved.length > 0) {
            const line = singleResolved[0];
            const hint = extractVariantHint(it?.nombre || it?.sku || order.sku, line.itemStock.nombre, it);
            addEntry({
              key: `SKU::${line.sku}`,
              sku: line.sku,
              nombre: line.itemStock.nombre || line.sku,
              isMapped: true,
              stockItem: line.itemStock,
              cantidad: itemQty,
              variantHint: hint,
              detalleTexto: hint || rawLabel,
              order,
              estadoNorm,
            });
          } else {
            const unmappedKey = `RAW::${normalizeTextKey(rawLabel) || 'sin-especificar'}`;
            const hint = extractVariantHint(rawLabel, rawLabel, it);
            addEntry({
              key: unmappedKey,
              sku: it?.catalogo_sku || null,
              nombre: rawLabel,
              isMapped: false,
              stockItem: null,
              cantidad: itemQty,
              variantHint: hint,
              detalleTexto: rawLabel,
              order,
              estadoNorm,
            });
          }
        }
      } else {
        const resolvedLines = resolveOrderInventoryLines(order, stockItems);
        const rawLabel = cleanProductLabel(order.sku);

        if (resolvedLines.length > 0) {
          for (const line of resolvedLines) {
            const hint = extractVariantHint(order.sku, line.itemStock.nombre);
            addEntry({
              key: `SKU::${line.sku}`,
              sku: line.sku,
              nombre: line.itemStock.nombre || line.sku,
              isMapped: true,
              stockItem: line.itemStock,
              cantidad: line.cantidad,
              variantHint: hint,
              detalleTexto: hint || rawLabel,
              order,
              estadoNorm,
            });
          }
        } else {
          const qty = extractOrderQuantity(order);
          const unmappedKey = `RAW::${normalizeTextKey(rawLabel) || 'sin-especificar'}`;
          addEntry({
            key: unmappedKey,
            sku: order.catalogo_sku || null,
            nombre: rawLabel,
            isMapped: false,
            stockItem: null,
            cantidad: qty,
            variantHint: '',
            detalleTexto: rawLabel,
            order,
            estadoNorm,
          });
        }
      }
    }

    const result: PickingProductGroup[] = Array.from(map.values()).map((g) => {
      const variantes = Array.from(g.variantesMap.entries())
        .map(([label, unidades]) => ({ label, unidades }))
        .sort((a, b) => b.unidades - a.unidades);

      const faltante = g.stockFisico !== null ? Math.max(0, g.totalUnidades - g.stockFisico) : 0;

      return {
        key: g.key,
        sku: g.sku,
        nombre: g.nombre,
        isMapped: g.isMapped,
        imageUrl: g.imageUrl,
        ubicacion: g.ubicacion,
        totalUnidades: g.totalUnidades,
        totalPedidos: g.orderIds.size,
        unidadesPorEstado: g.unidadesPorEstado,
        variantes,
        stockFisico: g.stockFisico,
        stockDisponible: g.stockDisponible,
        faltante,
        pedidos: g.pedidos.sort((a, b) => {
          const ta = a.order.created_at ? new Date(a.order.created_at).getTime() : 0;
          const tb = b.order.created_at ? new Date(b.order.created_at).getTime() : 0;
          return ta - tb;
        }),
      };
    });

    return result;
  }, [filteredOrders, stockItems]);

  // Filtro de búsqueda + ocultar listos + ordenamiento
  const visibleGroups = useMemo(() => {
    const q = normalizeTextKey(search);
    const filtered = allGroups.filter((g) => {
      if (hideChecked && checkedKeys[g.key]) return false;
      if (!q) return true;
      const hay = normalizeTextKey(
        `${g.nombre} ${g.sku || ''} ${g.ubicacion} ${g.variantes.map((v) => v.label).join(' ')} ${g.pedidos
          .map((p) => `${p.order.nombre_cliente || ''} ${p.order.pedido_codigo || ''}`)
          .join(' ')}`
      );
      return hay.includes(q);
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'faltante') {
        if (b.faltante !== a.faltante) return b.faltante - a.faltante;
        return b.totalUnidades - a.totalUnidades;
      }
      if (sortBy === 'nombre') {
        return a.nombre.localeCompare(b.nombre, 'es');
      }
      if (b.totalUnidades !== a.totalUnidades) return b.totalUnidades - a.totalUnidades;
      return a.nombre.localeCompare(b.nombre, 'es');
    });
  }, [allGroups, search, hideChecked, checkedKeys, sortBy]);

  // Métricas globales del lote actual
  const summary = useMemo(() => {
    const totalUnidades = allGroups.reduce((acc, g) => acc + g.totalUnidades, 0);
    const totalProductos = allGroups.length;
    const totalPedidos = filteredOrders.length;
    const productosConFaltante = allGroups.filter((g) => g.faltante > 0).length;
    const unidadesFaltantes = allGroups.reduce((acc, g) => acc + g.faltante, 0);
    const productosListos = allGroups.filter((g) => checkedKeys[g.key]).length;
    const unidadesListas = allGroups.reduce(
      (acc, g) => acc + (checkedKeys[g.key] ? g.totalUnidades : 0),
      0
    );

    return {
      totalUnidades,
      totalProductos,
      totalPedidos,
      productosConFaltante,
      unidadesFaltantes,
      productosListos,
      unidadesListas,
    };
  }, [allGroups, filteredOrders.length, checkedKeys]);

  const toggleChecked = (key: string) => {
    setCheckedKeys((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const toggleExpanded = (key: string) => {
    setExpandedKeys((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleResetChecked = () => {
    setCheckedKeys({});
  };

  const handleCopyPickingList = async () => {
    if (allGroups.length === 0) return;

    const fechaHoy = new Intl.DateTimeFormat('es-SV', {
      timeZone: 'America/El_Salvador',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

    const lines: string[] = [
      `LISTA DE ALISTADO — ${STAGE_LABEL[stageFilter].toUpperCase()}`,
      `Fecha: ${fechaHoy} · ${summary.totalPedidos} pedidos · ${summary.totalUnidades} uds`,
    ];

    if (courierFilter !== 'todos') {
      lines.push(`Courier: ${courierFilter}`);
    }

    lines.push('');

    const sortedForCopy = [...allGroups].sort((a, b) => b.totalUnidades - a.totalUnidades);
    for (const g of sortedForCopy) {
      const checkMark = checkedKeys[g.key] ? '[x]' : '[ ]';
      const skuTag = g.sku ? ` (${g.sku})` : '';
      const faltanteTag = g.faltante > 0 ? ` — FALTAN ${g.faltante}` : '';
      lines.push(`${checkMark} ${g.nombre}${skuTag}: ${g.totalUnidades} uds (${g.totalPedidos} ped.)${faltanteTag}`);
      if (g.variantes.length > 0) {
        lines.push(`    Detalle: ${g.variantes.map((v) => `${v.label} ×${v.unidades}`).join(' · ')}`);
      }
    }

    if (summary.productosConFaltante > 0) {
      lines.push('');
      lines.push(
        `Alerta de bodega: ${summary.productosConFaltante} producto(s) con faltante (${summary.unidadesFaltantes} uds por reponer).`
      );
    }

    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Fallback silencioso si el portapapeles está bloqueado
    }
  };

  const handleAdvanceOrderToPack = async (order: PickingOrderItem) => {
    setAdvancingOrderId(order.id);
    try {
      await onCambiarEstadoDirecto(order, 'por_empacar');
    } finally {
      setAdvancingOrderId(null);
    }
  };

  const progressPct =
    summary.totalUnidades > 0
      ? Math.min(100, Math.round((summary.unidadesListas / summary.totalUnidades) * 100))
      : 0;

  return (
    <div className="flex flex-col gap-5 flex-1">
      {/* Franja de resumen operativo (4 métricas con divisores hairline, sin cards anidadas) */}
      <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-2 lg:grid-cols-4 divide-y lg:divide-y-0 lg:divide-x divide-[var(--bd)]">
        <div className="p-4">
          <p className="text-xs font-medium tx-mu">Unidades a alistar</p>
          <p className="text-2xl font-bold font-mono tabular-nums mt-1 text-[var(--tx)]">
            {summary.totalUnidades}
          </p>
          <p className="text-xs tx-mu mt-0.5 tabular-nums">
            {summary.unidadesListas} marcadas ({progressPct}%)
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium tx-mu">Productos distintos</p>
          <p className="text-2xl font-bold font-mono tabular-nums mt-1 text-[var(--tx)]">
            {summary.totalProductos}
          </p>
          <p className="text-xs tx-mu mt-0.5 tabular-nums">
            {summary.productosListos} de {summary.totalProductos} listos en mesa
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium tx-mu">Pedidos en este lote</p>
          <p className="text-2xl font-bold font-mono tabular-nums mt-1 text-[var(--tx)]">
            {summary.totalPedidos}
          </p>
          <p className="text-xs tx-mu mt-0.5">
            Etapa: {STAGE_LABEL[stageFilter]}
          </p>
        </div>

        <div className="p-4">
          <p className="text-xs font-medium tx-mu">Cobertura en bodega</p>
          <p
            className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
              summary.productosConFaltante > 0
                ? 'text-rose-600 dark:text-rose-400'
                : 'text-emerald-600 dark:text-emerald-400'
            }`}
          >
            {summary.productosConFaltante > 0
              ? `-${summary.unidadesFaltantes} uds`
              : 'Cubierto'}
          </p>
          <p className="text-xs tx-mu mt-0.5">
            {summary.productosConFaltante > 0
              ? `${summary.productosConFaltante} producto(s) con faltante físico`
              : 'Stock físico suficiente para este lote'}
          </p>
        </div>
      </section>

      {/* Barra de controles: Etapas, Courier, Búsqueda y Acciones */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          {/* Selector segmentado de etapas */}
          <div className="flex items-center gap-1 p-1 bg-sf border border-[var(--bd)] rounded-lg overflow-x-auto">
            {(
              [
                { id: 'por_preparar' as const, label: 'Por preparar', count: stageCounts.por_preparar },
                { id: 'por_empacar' as const, label: 'Por empacar', count: stageCounts.por_empacar },
                { id: 'nuevo' as const, label: 'Nuevos', count: stageCounts.nuevo },
                { id: 'programado' as const, label: 'Encargos', count: stageCounts.programado },
                { id: 'en_camino' as const, label: 'En camino', count: stageCounts.en_camino },
              ] as const
            ).map((opt) => {
              const active = stageFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setStageFilter(opt.id)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5 ${
                    active
                      ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                      : 'tx-mu hover:text-[var(--tx)]'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`font-mono tabular-nums text-[11px] ${
                      active ? 'opacity-85' : 'opacity-70'
                    }`}
                  >
                    {opt.count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Acciones principales */}
          <div className="flex flex-wrap items-center gap-2">
            {summary.productosListos > 0 && (
              <button
                type="button"
                onClick={handleResetChecked}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:border-[var(--tx)] text-xs font-medium text-[var(--tx)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                title="Limpiar todas las marcas de alistado"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reiniciar checks</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyPickingList}
              disabled={allGroups.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:border-[var(--tx)] disabled:opacity-40 text-xs font-medium text-[var(--tx)] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span>Lista copiada</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copiar para bodega</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowPrintSheet(true)}
              disabled={allGroups.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 disabled:opacity-40 text-xs font-semibold transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir hoja</span>
            </button>
          </div>
        </div>

        {/* Fila secundaria: Búsqueda, Courier, Orden y Ocultar listos */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-3.5 h-3.5 tx-mu absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto, SKU, color o cliente..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--bd)] bg-cd text-xs text-[var(--tx)] placeholder:tx-mu focus:outline-none focus:border-[var(--tx)]"
            />
          </div>

          <select
            value={courierFilter}
            onChange={(e) => setCourierFilter(e.target.value)}
            aria-label="Filtrar por courier"
            className="px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd text-xs text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          >
            <option value="todos">Todos los couriers</option>
            <option value="Sin asignar">Sin asignar</option>
            {couriers.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'cantidad' | 'nombre' | 'faltante')}
            aria-label="Ordenar productos"
            className="px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd text-xs text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          >
            <option value="cantidad">Orden: Mayor cantidad</option>
            <option value="faltante">Orden: Faltantes primero</option>
            <option value="nombre">Orden: Alfabético (A-Z)</option>
          </select>

          <button
            type="button"
            onClick={() => setHideChecked((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              hideChecked
                ? 'border-[var(--tx)] bg-sf text-[var(--tx)]'
                : 'border-[var(--bd)] bg-cd tx-mu hover:text-[var(--tx)]'
            }`}
          >
            {hideChecked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            <span>{hideChecked ? 'Mostrar listos' : 'Ocultar listos'}</span>
          </button>
        </div>

        {/* Barra delgada de progreso de alistado */}
        {summary.totalUnidades > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-sf overflow-hidden border border-[var(--bd)]">
              <div
                className="h-full bg-emerald-600 dark:bg-emerald-400 transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs font-mono tabular-nums tx-mu shrink-0">
              {summary.unidadesListas}/{summary.totalUnidades} uds alistadas
            </span>
          </div>
        )}
      </section>

      {/* Tabla de picking de alta densidad */}
      <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
        {visibleGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <ClipboardList className="w-9 h-9 tx-mu opacity-40 mb-3" />
            <p className="text-sm font-semibold text-[var(--tx)]">
              {allGroups.length === 0
                ? `No hay productos pendientes en "${STAGE_LABEL[stageFilter]}"`
                : 'Ningún producto coincide con los filtros actuales'}
            </p>
            <p className="text-xs tx-mu mt-1 max-w-md">
              {allGroups.length === 0
                ? 'Cuando entren pedidos en esta etapa aparecerán agrupados aquí con su cantidad total para facilitar el armado de paquetes.'
                : 'Limpia la búsqueda o muestra los productos ya marcados como listos para ver la lista completa.'}
            </p>
            {(search || hideChecked || courierFilter !== 'todos') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setHideChecked(false);
                  setCourierFilter('todos');
                }}
                className="mt-4 px-3.5 py-2 rounded-lg border border-[var(--bd)] bg-sf hover:border-[var(--tx)] text-xs font-medium text-[var(--tx)] transition-colors cursor-pointer"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--bd)] bg-sf/50 text-[11px] font-semibold tx-mu">
                  <th className="py-3 pl-4 pr-2 w-10" aria-label="Marcar listo" />
                  <th className="py-3 px-3">Producto y detalle</th>
                  <th className="py-3 px-3 text-right w-32">Necesarios</th>
                  <th className="py-3 px-3 text-right w-44">Stock en bodega</th>
                  <th className="py-3 pl-3 pr-4 text-right w-36">Pedidos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--bd)]">
                {visibleGroups.map((group) => {
                  const isChecked = Boolean(checkedKeys[group.key]);
                  const isExpanded = Boolean(expandedKeys[group.key]);
                  const sobrante =
                    group.stockFisico !== null ? group.stockFisico - group.totalUnidades : null;

                  return (
                    <FragmentRow
                      key={group.key}
                      group={group}
                      stageFilter={stageFilter}
                      isChecked={isChecked}
                      isExpanded={isExpanded}
                      sobrante={sobrante}
                      advancingOrderId={advancingOrderId}
                      onToggleCheck={() => toggleChecked(group.key)}
                      onToggleExpand={() => toggleExpanded(group.key)}
                      onOpenPedido={onOpenPedido}
                      onAdvanceOrderToPack={handleAdvanceOrderToPack}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal Hoja Imprimible de Alistado (sin window.open, usando window.print) */}
      {showPrintSheet && (
        <div className="alistado-print-portal fixed inset-0 z-50 bg-black/60 backdrop-blur-[1px] flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
          <style>{`
            @media print {
              body * { visibility: hidden !important; }
              #alistado-print-sheet, #alistado-print-sheet * { visibility: visible !important; }
              #alistado-print-sheet {
                position: fixed !important;
                inset: 0 !important;
                width: 100% !important;
                max-width: 100% !important;
                padding: 20px !important;
                background: #ffffff !important;
                color: #111111 !important;
                border: none !important;
                box-shadow: none !important;
              }
              .no-print-alistado { display: none !important; }
            }
          `}</style>

          <div className="bg-cd border border-[var(--bd)] rounded-xl max-w-3xl w-full p-5 sm:p-6 shadow-2xl my-auto flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
            <div className="no-print-alistado flex items-center justify-between gap-3 pb-3 border-b border-[var(--bd)]">
              <div>
                <h3 className="text-sm font-semibold text-[var(--tx)]">
                  Hoja de Alistado de Bodega
                </h3>
                <p className="text-xs tx-mu mt-0.5">
                  Lista consolidada por producto lista para imprimir y bajar mercadería.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 text-xs font-semibold cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Imprimir</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowPrintSheet(false)}
                  aria-label="Cerrar hoja imprimible"
                  className="p-2 rounded-lg border border-[var(--bd)] bg-sf tx-mu hover:text-[var(--tx)] cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div id="alistado-print-sheet" className="flex flex-col gap-4 text-[var(--tx)]">
              <div className="flex items-start justify-between border-b border-[var(--bd)] pb-3">
                <div>
                  <h2 className="text-base font-bold">
                    Hoja de Alistado — {STAGE_LABEL[stageFilter]}
                  </h2>
                  <p className="text-xs tx-mu mt-0.5">
                    {new Intl.DateTimeFormat('es-SV', {
                      timeZone: 'America/El_Salvador',
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date())}
                    {courierFilter !== 'todos' ? ` · Courier: ${courierFilter}` : ''}
                  </p>
                </div>
                <div className="text-right font-mono tabular-nums text-xs">
                  <div className="font-bold text-sm">{summary.totalUnidades} uds totales</div>
                  <div className="tx-mu">
                    {summary.totalProductos} productos · {summary.totalPedidos} pedidos
                  </div>
                </div>
              </div>

              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--bd)]">
                    <th className="py-2 pr-2 w-8">OK</th>
                    <th className="py-2 px-2">Producto</th>
                    <th className="py-2 px-2">SKU / Ubicación</th>
                    <th className="py-2 px-2 text-right">Cantidad</th>
                    <th className="py-2 pl-2 text-right">Bodega</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]">
                  {[...allGroups]
                    .sort((a, b) => b.totalUnidades - a.totalUnidades)
                    .map((g) => (
                      <tr key={g.key}>
                        <td className="py-2.5 pr-2 align-top font-mono">[ ]</td>
                        <td className="py-2.5 px-2 align-top">
                          <div className="font-semibold">{g.nombre}</div>
                          {g.variantes.length > 0 && (
                            <div className="text-[11px] tx-mu mt-0.5">
                              {g.variantes.map((v) => `${v.label} ×${v.unidades}`).join(' · ')}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 align-top font-mono text-[11px] tx-mu">
                          {g.sku || 'Sin SKU'}
                          {g.ubicacion ? ` · ${g.ubicacion}` : ''}
                        </td>
                        <td className="py-2.5 px-2 align-top text-right font-mono tabular-nums font-bold text-sm">
                          {g.totalUnidades}
                        </td>
                        <td className="py-2.5 pl-2 align-top text-right font-mono tabular-nums text-[11px]">
                          {g.stockFisico !== null
                            ? g.faltante > 0
                              ? `${g.stockFisico} (Faltan ${g.faltante})`
                              : `${g.stockFisico} disp.`
                            : '—'}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fila de producto + desglose expandible de pedidos                   */
/* ------------------------------------------------------------------ */

function FragmentRow({
  group,
  stageFilter,
  isChecked,
  isExpanded,
  sobrante,
  advancingOrderId,
  onToggleCheck,
  onToggleExpand,
  onOpenPedido,
  onAdvanceOrderToPack,
}: {
  group: PickingProductGroup;
  stageFilter: PickingStageFilter;
  isChecked: boolean;
  isExpanded: boolean;
  sobrante: number | null;
  advancingOrderId: string | null;
  onToggleCheck: () => void;
  onToggleExpand: () => void;
  onOpenPedido: (pedido: PickingOrderItem) => void;
  onAdvanceOrderToPack: (pedido: PickingOrderItem) => void;
}) {
  return (
    <>
      <tr
        className={`transition-colors ${
          isChecked ? 'bg-sf/40 opacity-65' : 'hover:bg-sf/40'
        }`}
      >
        {/* Checkbox de alistado */}
        <td className="py-3.5 pl-4 pr-2 align-middle">
          <button
            type="button"
            onClick={onToggleCheck}
            aria-label={isChecked ? `Desmarcar ${group.nombre}` : `Marcar ${group.nombre} como alistado`}
            className="p-1 rounded-md text-[var(--tx)] hover:bg-sf transition-colors cursor-pointer"
          >
            {isChecked ? (
              <CheckSquare className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Square className="w-4 h-4 tx-mu" />
            )}
          </button>
        </td>

        {/* Producto, imagen y metadatos limpios (sin pills) */}
        <td className="py-3.5 px-3 align-middle">
          <div className="flex items-start gap-3">
            {group.imageUrl ? (
              <img
                src={group.imageUrl}
                alt={group.nombre}
                referrerPolicy="no-referrer"
                className="w-10 h-10 rounded-lg object-cover border border-[var(--bd)] shrink-0 bg-sf"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg border border-[var(--bd)] bg-sf flex items-center justify-center shrink-0">
                <Package className="w-4 h-4 tx-mu" />
              </div>
            )}

            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={onToggleExpand}
                className={`text-left text-sm font-semibold text-[var(--tx)] hover:underline cursor-pointer block truncate max-w-full ${
                  isChecked ? 'line-through' : ''
                }`}
              >
                {group.nombre}
              </button>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs tx-mu mt-0.5">
                <span className="font-mono">{group.sku || 'Sin SKU en inventario'}</span>
                {group.ubicacion && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>Ubicación {group.ubicacion}</span>
                  </>
                )}
                {stageFilter === 'por_preparar' &&
                  group.unidadesPorEstado.nuevo > 0 &&
                  group.unidadesPorEstado.por_empacar > 0 && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {group.unidadesPorEstado.por_empacar} por empacar /{' '}
                        {group.unidadesPorEstado.nuevo} nuevos
                      </span>
                    </>
                  )}
              </div>

              {group.variantes.length > 0 && (
                <p className="text-xs text-[var(--tx)]/80 mt-1 tabular-nums">
                  {group.variantes.map((v) => `${v.label} ×${v.unidades}`).join(' · ')}
                </p>
              )}
            </div>
          </div>
        </td>

        {/* Cantidad necesaria (foco principal) */}
        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
          <span className="text-xl font-bold font-mono tabular-nums text-[var(--tx)]">
            {group.totalUnidades}
          </span>
          <span className="text-xs tx-mu ml-1">
            {group.totalUnidades === 1 ? 'ud' : 'uds'}
          </span>
        </td>

        {/* Stock físico y estado de cobertura */}
        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
          {group.stockFisico !== null ? (
            <div className="flex flex-col items-end">
              <span className="text-xs font-mono tabular-nums font-semibold text-[var(--tx)]">
                {group.stockFisico} en bodega
              </span>
              {group.faltante > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 tabular-nums mt-0.5">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>Faltan {group.faltante}</span>
                </span>
              ) : (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 tabular-nums mt-0.5">
                  Stock OK{sobrante !== null && sobrante > 0 ? ` · +${sobrante}` : ''}
                </span>
              )}
            </div>
          ) : (
            <span className="text-xs tx-mu">Sin vincular</span>
          )}
        </td>

        {/* Desplegar pedidos */}
        <td className="py-3.5 pl-3 pr-4 text-right align-middle whitespace-nowrap">
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--bd)] bg-sf hover:border-[var(--tx)] text-xs font-medium text-[var(--tx)] transition-colors cursor-pointer"
          >
            <span className="font-mono tabular-nums">{group.totalPedidos}</span>
            <span>{group.totalPedidos === 1 ? 'pedido' : 'pedidos'}</span>
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 tx-mu" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 tx-mu" />
            )}
          </button>
        </td>
      </tr>

      {/* Sub-tabla limpia con los pedidos que requieren este producto */}
      {isExpanded && (
        <tr className="bg-sf/35">
          <td colSpan={5} className="px-4 sm:px-6 py-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--bd)] tx-mu text-[11px]">
                    <th className="py-1.5 pr-3 font-medium">Pedido / Cliente</th>
                    <th className="py-1.5 px-2 font-medium">Detalle / Nota</th>
                    <th className="py-1.5 px-2 font-medium">Etapa · Courier</th>
                    <th className="py-1.5 px-2 text-right font-medium">Cant.</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]/60">
                  {group.pedidos.map((ref, idx) => {
                    const o = ref.order;
                    const code = o.pedido_codigo || `#${String(o.id).slice(0, 6)}`;
                    return (
                      <tr key={`${o.id}-${idx}`} className="hover:bg-cd/50">
                        <td className="py-2 pr-3 align-middle">
                          <span className="font-medium text-[var(--tx)] block">
                            {o.nombre_cliente || 'Sin nombre'}
                          </span>
                          <span className="text-[11px] tx-mu font-mono tabular-nums">
                            {code} · {formatMoney(o.total)}
                            {o.departamento ? ` · ${o.departamento}` : ''}
                          </span>
                        </td>
                        <td className="py-2 px-2 align-middle max-w-[260px]">
                          <span className="text-[var(--tx)]/90 block truncate">
                            {ref.detalleTexto}
                          </span>
                          {o.notas && (
                            <span className="text-[11px] tx-mu block truncate">{o.notas}</span>
                          )}
                        </td>
                        <td className="py-2 px-2 align-middle whitespace-nowrap text-[11px] tx-mu">
                          <span className="text-[var(--tx)] font-medium">
                            {ORDER_STATE_LABEL[ref.estadoNormalizado] || ref.estadoNormalizado}
                          </span>
                          <span aria-hidden="true"> · </span>
                          <span>{o.courier || 'Sin asignar'}</span>
                        </td>
                        <td className="py-2 px-2 text-right align-middle font-mono tabular-nums font-semibold text-[var(--tx)] whitespace-nowrap">
                          ×{ref.cantidad}
                        </td>
                        <td className="py-2 pl-2 text-right align-middle whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {ref.estadoNormalizado === 'nuevo' && (
                              <button
                                type="button"
                                disabled={advancingOrderId === o.id}
                                onClick={() => onAdvanceOrderToPack(o)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--bd)] bg-cd hover:border-[var(--tx)] text-[11px] font-medium text-[var(--tx)] disabled:opacity-50 cursor-pointer"
                                title="Pasar pedido a Por empacar"
                              >
                                <span>A empacar</span>
                                <ArrowRight className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpenPedido(o)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--bd)] bg-cd hover:border-[var(--tx)] text-[11px] font-medium tx-mu hover:text-[var(--tx)] cursor-pointer"
                              title="Abrir y editar pedido"
                            >
                              <Edit className="w-3 h-3" />
                              <span>Ver</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
