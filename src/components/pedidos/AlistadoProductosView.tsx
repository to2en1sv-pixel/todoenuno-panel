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
  Loader2,
  MapPin,
  Package,
  Printer,
  RotateCcw,
  Search,
  Square,
  Truck,
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
  onAssignCourierToOrders?: (orderIds: string[], newCourier: string) => Promise<void> | void;
}

type PickingGroupMode = 'producto' | 'departamento';
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

interface DepartmentOrderEntry {
  order: PickingOrderItem;
  estadoNormalizado: 'nuevo' | 'programado' | 'por_empacar' | 'en_camino' | 'entregado' | 'cancelado';
  unidades: number;
  productosResumen: string;
  courierActual: string;
}

interface DepartmentGroup {
  key: string;
  departamento: string;
  inferredCount: number;
  totalPedidos: number;
  totalUnidades: number;
  totalCod: number;
  sinAsignarCount: number;
  couriersResumen: Array<{ courier: string; pedidos: number; unidades: number }>;
  productosResumen: Array<{ nombre: string; unidades: number }>;
  pedidos: DepartmentOrderEntry[];
}

interface CourierSummaryBucket {
  courier: string;
  isUnassigned: boolean;
  pedidos: number;
  unidades: number;
  totalCod: number;
  departamentos: string[];
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

const SV_DEPARTMENT_RULES: Array<{ canonical: string; patterns: string[] }> = [
  {
    canonical: 'San Salvador',
    patterns: [
      'san salvador',
      'soyapango',
      'mejicanos',
      'apopa',
      'ilopango',
      'san marcos',
      'ciudad delgado',
      'cuscatancingo',
      'ayutuxtepeque',
      'tonacatepeque',
      'san martin',
      'nejapa',
      'aguilares',
      'panchimalco',
      'santo tomas',
      'el paisnal',
      'guazapa',
      'rosario de mora',
      'santiago texacuangos',
    ],
  },
  {
    canonical: 'La Libertad',
    patterns: [
      'la libertad',
      'santa tecla',
      'antiguo cuscatlan',
      'nuevo cuscatlan',
      'lourdes',
      'colon',
      'quezaltepeque',
      'san juan opico',
      'zaragoza',
      'san jose villanueva',
      'puerto de la libertad',
      'el tunco',
      'el zonte',
      'ciudad arce',
      'huizucar',
      'tamanique',
      'teotepeque',
      'sacacoyo',
      'talnique',
    ],
  },
  {
    canonical: 'Santa Ana',
    patterns: ['santa ana', 'metapan', 'chalchuapa', 'coatepeque', 'el congo', 'texistepeque', 'candelaria de la frontera'],
  },
  {
    canonical: 'San Miguel',
    patterns: ['san miguel', 'ciudad barrios', 'chinameca', 'el transito', 'moncagua', 'lolotique', 'chapeltique', 'sesori'],
  },
  {
    canonical: 'Sonsonate',
    patterns: ['sonsonate', 'acajutla', 'izalco', 'nahuizalco', 'juayua', 'armenia', 'sonzacate', 'san antonio del monte'],
  },
  {
    canonical: 'Usulután',
    patterns: ['usulutan', 'santiago de maria', 'jiquilisco', 'berlin', 'jucuapa', 'alegria', 'puerto el triunfo', 'santa elena'],
  },
  {
    canonical: 'Ahuachapán',
    patterns: ['ahuachapan', 'atiquizaya', 'apaneca', 'concepcion de ataco', 'ataco', 'jujutla', 'tacuba', 'san francisco menendez'],
  },
  {
    canonical: 'La Paz',
    patterns: ['la paz', 'zacatecoluca', 'olocuilta', 'san luis talpa', 'santiago nonualco', 'san pedro masahuat', 'el rosario', 'cuyultitan'],
  },
  {
    canonical: 'Cuscatlán',
    patterns: ['cuscatlan', 'cojutepeque', 'suchitoto', 'san pedro perulapan', 'san bartolome perulapia', 'tenancingo', 'san rafael cedros'],
  },
  {
    canonical: 'Chalatenango',
    patterns: ['chalatenango', 'nueva concepcion', 'la palma', 'tejutla', 'san ignacio', 'el paraiso', 'concepcion quezaltepeque'],
  },
  {
    canonical: 'La Unión',
    patterns: ['la union', 'santa rosa de lima', 'anamoros', 'pasaquina', 'conchagua', 'el carmen', 'intipuca'],
  },
  {
    canonical: 'San Vicente',
    patterns: ['san vicente', 'san sebastian', 'apastepeque', 'tecoluca', 'verapaz', 'guadalupe', 'santo domingo'],
  },
  {
    canonical: 'Morazán',
    patterns: ['morazan', 'san francisco gotera', 'gotera', 'jocoro', 'corinto', 'perquin', 'sociedad', 'osicala'],
  },
  {
    canonical: 'Cabañas',
    patterns: ['cabanas', 'sensuntepeque', 'ilobasco', 'tejutepeque', 'victoria', 'dolores', 'jutiapa'],
  },
];

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

function resolveOrderDepartment(order: PickingOrderItem): { name: string; inferred: boolean } {
  const rawDept = String(order.departamento || '').trim();
  const normDept = normalizeTextKey(rawDept);

  if (normDept && normDept !== 'sin asignar' && normDept !== 'pendiente' && normDept !== 'n a' && normDept !== 'na') {
    for (const rule of SV_DEPARTMENT_RULES) {
      if (rule.patterns.some((p) => normDept === p || normDept.includes(p))) {
        return { name: rule.canonical, inferred: false };
      }
    }
    // Conservar departamento personalizado si no coincide con tabla estándar
    return { name: rawDept, inferred: false };
  }

  const addrNorm = normalizeTextKey(String(order.direccion || ''));
  if (addrNorm) {
    for (const rule of SV_DEPARTMENT_RULES) {
      for (const pat of rule.patterns) {
        const re = new RegExp(`(?:^|\\s)${pat.replace(/\s+/g, '\\s+')}(?:\\s|$)`, 'i');
        if (re.test(addrNorm)) {
          return { name: rule.canonical, inferred: true };
        }
      }
    }
  }

  return { name: 'Sin departamento', inferred: false };
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

function resolveOrderProductsBreakdown(
  order: PickingOrderItem,
  stockItems: StockItem[]
): Array<{ nombre: string; unidades: number }> {
  const byName = new Map<string, number>();
  const push = (name: string, qty: number) => {
    const clean = name.trim() || 'Producto sin especificar';
    byName.set(clean, (byName.get(clean) || 0) + Math.max(1, Math.round(qty)));
  };

  if (Array.isArray(order.items) && order.items.length > 0) {
    for (const it of order.items) {
      const qty = Math.min(Math.max(Math.round(Number(it?.cantidad ?? it?.qty ?? 1) || 1), 1), 100);
      const resolved = resolveOrderInventoryLines({ ...order, items: [it], cantidad: undefined }, stockItems);
      if (resolved.length > 0) {
        push(resolved[0].itemStock.nombre || resolved[0].sku, qty);
      } else {
        push(cleanProductLabel(it?.nombre || it?.sku || order.sku), qty);
      }
    }
  } else {
    const resolved = resolveOrderInventoryLines(order, stockItems);
    if (resolved.length > 0) {
      for (const line of resolved) {
        push(line.itemStock.nombre || line.sku, line.cantidad);
      }
    } else {
      push(cleanProductLabel(order.sku), extractOrderQuantity(order));
    }
  }

  return Array.from(byName.entries()).map(([nombre, unidades]) => ({ nombre, unidades }));
}

export function AlistadoProductosView({
  pedidos,
  stockItems,
  couriers,
  onOpenPedido,
  onCambiarEstadoDirecto,
  onAssignCourierToOrders,
}: AlistadoProductosViewProps) {
  const [groupMode, setGroupMode] = useState<PickingGroupMode>('producto');
  const [stageFilter, setStageFilter] = useState<PickingStageFilter>('por_preparar');
  const [courierFilter, setCourierFilter] = useState<string>('todos');
  const [search, setSearch] = useState('');
  const [hideChecked, setHideChecked] = useState(false);
  const [sortBy, setSortBy] = useState<'cantidad' | 'nombre' | 'faltante'>('cantidad');
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({});
  const [checkedKeys, setCheckedKeys] = useState<Record<string, boolean>>(() => loadCheckedKeys());
  const [copied, setCopied] = useState(false);
  const [showPrintSheet, setShowPrintSheet] = useState(false);
  const [advancingOrderId, setAdvancingOrderId] = useState<string | null>(null);

  // Estado para asignación de couriers por departamento o pedido
  const [deptCourierDraft, setDeptCourierDraft] = useState<Record<string, string>>({});
  const [assigningDeptKey, setAssigningDeptKey] = useState<string | null>(null);
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null);
  const [assignFeedback, setAssignFeedback] = useState<string | null>(null);

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

  // Pedidos de la etapa seleccionada (antes del filtro de courier, para armar el resumen por courier)
  const stageOrders = useMemo(() => {
    return pedidos.filter((p) => {
      const st = normalizeOrderStatus(p.estado);
      return stageFilter === 'por_preparar'
        ? st === 'nuevo' || st === 'por_empacar'
        : st === stageFilter;
    });
  }, [pedidos, stageFilter]);

  // Pedidos filtrados también por courier
  const filteredOrders = useMemo(() => {
    if (courierFilter === 'todos') return stageOrders;
    return stageOrders.filter((p) => {
      const orderCourier = String(p.courier || '').trim() || 'Sin asignar';
      return orderCourier === courierFilter;
    });
  }, [stageOrders, courierFilter]);

  // Resumen global de distribución por courier en la etapa activa
  const courierSummaryBuckets = useMemo<CourierSummaryBucket[]>(() => {
    const map = new Map<
      string,
      {
        courier: string;
        isUnassigned: boolean;
        pedidos: number;
        unidades: number;
        totalCod: number;
        depts: Set<string>;
      }
    >();

    for (const order of stageOrders) {
      const rawCourier = String(order.courier || '').trim();
      const label = rawCourier || 'Sin asignar';
      const isUnassigned = !rawCourier;
      const lines = resolveOrderProductsBreakdown(order, stockItems);
      const units = lines.reduce((acc, l) => acc + l.unidades, 0);
      const dept = resolveOrderDepartment(order).name;

      let bucket = map.get(label);
      if (!bucket) {
        bucket = {
          courier: label,
          isUnassigned,
          pedidos: 0,
          unidades: 0,
          totalCod: 0,
          depts: new Set<string>(),
        };
        map.set(label, bucket);
      }

      bucket.pedidos += 1;
      bucket.unidades += units;
      bucket.totalCod += Number(order.total || 0);
      bucket.depts.add(dept);
    }

    return Array.from(map.values())
      .map((b) => ({
        courier: b.courier,
        isUnassigned: b.isUnassigned,
        pedidos: b.pedidos,
        unidades: b.unidades,
        totalCod: b.totalCod,
        departamentos: Array.from(b.depts).sort((a, bName) => a.localeCompare(bName, 'es')),
      }))
      .sort((a, b) => {
        if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? -1 : 1;
        return b.pedidos - a.pedidos;
      });
  }, [stageOrders, stockItems]);

  // Agregación por PRODUCTO
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

    return Array.from(map.values()).map((g) => {
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
  }, [filteredOrders, stockItems]);

  // Agregación por DEPARTAMENTO
  const allDepartmentGroups = useMemo<DepartmentGroup[]>(() => {
    const map = new Map<
      string,
      {
        departamento: string;
        inferredCount: number;
        totalPedidos: number;
        totalUnidades: number;
        totalCod: number;
        sinAsignarCount: number;
        couriersMap: Map<string, { pedidos: number; unidades: number }>;
        productosMap: Map<string, number>;
        pedidos: DepartmentOrderEntry[];
      }
    >();

    for (const order of filteredOrders) {
      const deptRes = resolveOrderDepartment(order);
      const deptKey = deptRes.name;
      const estadoNorm = normalizeOrderStatus(order.estado);
      const courierActual = String(order.courier || '').trim() || 'Sin asignar';
      const lines = resolveOrderProductsBreakdown(order, stockItems);
      const unidades = lines.reduce((acc, l) => acc + l.unidades, 0);
      const productosResumen = lines.map((l) => `${l.nombre} ×${l.unidades}`).join(', ');

      let bucket = map.get(deptKey);
      if (!bucket) {
        bucket = {
          departamento: deptKey,
          inferredCount: 0,
          totalPedidos: 0,
          totalUnidades: 0,
          totalCod: 0,
          sinAsignarCount: 0,
          couriersMap: new Map(),
          productosMap: new Map(),
          pedidos: [],
        };
        map.set(deptKey, bucket);
      }

      if (deptRes.inferred) bucket.inferredCount += 1;
      bucket.totalPedidos += 1;
      bucket.totalUnidades += unidades;
      bucket.totalCod += Number(order.total || 0);
      if (courierActual === 'Sin asignar') bucket.sinAsignarCount += 1;

      const cEntry = bucket.couriersMap.get(courierActual) || { pedidos: 0, unidades: 0 };
      cEntry.pedidos += 1;
      cEntry.unidades += unidades;
      bucket.couriersMap.set(courierActual, cEntry);

      for (const l of lines) {
        bucket.productosMap.set(l.nombre, (bucket.productosMap.get(l.nombre) || 0) + l.unidades);
      }

      bucket.pedidos.push({
        order,
        estadoNormalizado: estadoNorm,
        unidades,
        productosResumen,
        courierActual,
      });
    }

    return Array.from(map.values())
      .map((b) => ({
        key: `DEPT::${normalizeTextKey(b.departamento) || 'sin-departamento'}`,
        departamento: b.departamento,
        inferredCount: b.inferredCount,
        totalPedidos: b.totalPedidos,
        totalUnidades: b.totalUnidades,
        totalCod: b.totalCod,
        sinAsignarCount: b.sinAsignarCount,
        couriersResumen: Array.from(b.couriersMap.entries())
          .map(([courier, stats]) => ({ courier, pedidos: stats.pedidos, unidades: stats.unidades }))
          .sort((a, bC) => {
            if (a.courier === 'Sin asignar') return -1;
            if (bC.courier === 'Sin asignar') return 1;
            return bC.pedidos - a.pedidos;
          }),
        productosResumen: Array.from(b.productosMap.entries())
          .map(([nombre, unidades]) => ({ nombre, unidades }))
          .sort((a, bP) => bP.unidades - a.unidades),
        pedidos: b.pedidos.sort((a, bO) => {
          if (a.courierActual === 'Sin asignar' && bO.courierActual !== 'Sin asignar') return -1;
          if (a.courierActual !== 'Sin asignar' && bO.courierActual === 'Sin asignar') return 1;
          const ta = a.order.created_at ? new Date(a.order.created_at).getTime() : 0;
          const tb = bO.order.created_at ? new Date(bO.order.created_at).getTime() : 0;
          return ta - tb;
        }),
      }))
      .sort((a, b) => {
        if (a.departamento === 'Sin departamento' && b.departamento !== 'Sin departamento') return 1;
        if (b.departamento === 'Sin departamento' && a.departamento !== 'Sin departamento') return -1;
        if (b.totalPedidos !== a.totalPedidos) return b.totalPedidos - a.totalPedidos;
        return a.departamento.localeCompare(b.departamento, 'es');
      });
  }, [filteredOrders, stockItems]);

  // Filtro de búsqueda + ocultar listos + ordenamiento (modo Producto)
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

  // Filtro de búsqueda + ordenamiento (modo Departamento)
  const visibleDepartmentGroups = useMemo(() => {
    const q = normalizeTextKey(search);
    const filtered = allDepartmentGroups.filter((d) => {
      if (!q) return true;
      const hay = normalizeTextKey(
        `${d.departamento} ${d.couriersResumen.map((c) => c.courier).join(' ')} ${d.productosResumen
          .map((p) => p.nombre)
          .join(' ')} ${d.pedidos
          .map((p) => `${p.order.nombre_cliente || ''} ${p.order.direccion || ''} ${p.order.pedido_codigo || ''}`)
          .join(' ')}`
      );
      return hay.includes(q);
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === 'faltante') {
        if (b.sinAsignarCount !== a.sinAsignarCount) return b.sinAsignarCount - a.sinAsignarCount;
        return b.totalPedidos - a.totalPedidos;
      }
      if (sortBy === 'nombre') {
        return a.departamento.localeCompare(b.departamento, 'es');
      }
      if (b.totalPedidos !== a.totalPedidos) return b.totalPedidos - a.totalPedidos;
      return a.departamento.localeCompare(b.departamento, 'es');
    });
  }, [allDepartmentGroups, search, sortBy]);

  // Métricas globales del lote actual
  const summary = useMemo(() => {
    const totalUnidades = allGroups.reduce((acc, g) => acc + g.totalUnidades, 0);
    const totalProductos = allGroups.length;
    const totalPedidos = filteredOrders.length;
    const totalCod = filteredOrders.reduce((acc, o) => acc + Number(o.total || 0), 0);
    const sinCourier = filteredOrders.filter((o) => !String(o.courier || '').trim()).length;
    const totalDepartamentos = allDepartmentGroups.length;
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
      totalCod,
      sinCourier,
      totalDepartamentos,
      productosConFaltante,
      unidadesFaltantes,
      productosListos,
      unidadesListas,
    };
  }, [allGroups, allDepartmentGroups.length, filteredOrders, checkedKeys]);

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

  const toggleExpandedDept = (key: string) => {
    setExpandedDepts((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleResetChecked = () => {
    setCheckedKeys({});
  };

  const showTempFeedback = (msg: string) => {
    setAssignFeedback(msg);
    setTimeout(() => {
      setAssignFeedback((curr) => (curr === msg ? null : curr));
    }, 3200);
  };

  const handleBulkAssignDepartment = async (dept: DepartmentGroup, onlyUnassigned: boolean) => {
    if (!onAssignCourierToOrders) return;
    const selectedCourier = deptCourierDraft[dept.key] || '';
    if (!selectedCourier) return;

    const targetOrders = onlyUnassigned
      ? dept.pedidos.filter((p) => p.courierActual === 'Sin asignar')
      : dept.pedidos;
    if (targetOrders.length === 0) return;

    setAssigningDeptKey(dept.key);
    try {
      await onAssignCourierToOrders(
        targetOrders.map((t) => t.order.id),
        selectedCourier
      );
      showTempFeedback(
        `${targetOrders.length} pedido(s) de ${dept.departamento} asignados a ${selectedCourier}.`
      );
    } finally {
      setAssigningDeptKey(null);
    }
  };

  const handleAssignSingleOrderCourier = async (orderId: string, newCourier: string) => {
    if (!onAssignCourierToOrders) return;
    setAssigningOrderId(orderId);
    try {
      await onAssignCourierToOrders([orderId], newCourier);
    } finally {
      setAssigningOrderId(null);
    }
  };

  const handleCopyPickingList = async () => {
    const fechaHoy = new Intl.DateTimeFormat('es-SV', {
      timeZone: 'America/El_Salvador',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date());

    const lines: string[] = [];

    if (groupMode === 'departamento') {
      if (allDepartmentGroups.length === 0) return;

      lines.push(`CONSOLIDADO POR DEPARTAMENTO — ${STAGE_LABEL[stageFilter].toUpperCase()}`);
      lines.push(
        `Fecha: ${fechaHoy} · ${summary.totalPedidos} pedidos · ${summary.totalUnidades} uds · ${formatMoney(summary.totalCod)}`
      );
      if (courierFilter !== 'todos') {
        lines.push(`Filtro courier: ${courierFilter}`);
      }

      if (courierSummaryBuckets.length > 0 && courierFilter === 'todos') {
        lines.push('');
        lines.push('RESUMEN POR COURIER:');
        for (const c of courierSummaryBuckets) {
          lines.push(`• ${c.courier}: ${c.pedidos} ped. (${c.unidades} uds · ${formatMoney(c.totalCod)})`);
        }
      }

      lines.push('');
      lines.push('DETALLE POR DEPARTAMENTO:');
      for (const d of allDepartmentGroups) {
        const couriersTxt = d.couriersResumen.map((c) => `${c.courier} ×${c.pedidos}`).join(' · ');
        const prodsTxt = d.productosResumen.map((p) => `${p.nombre} ×${p.unidades}`).join(', ');
        lines.push(
          `• ${d.departamento}: ${d.totalPedidos} ped. (${d.totalUnidades} uds · ${formatMoney(d.totalCod)})`
        );
        lines.push(`    Couriers: ${couriersTxt}`);
        lines.push(`    Productos: ${prodsTxt}`);
      }
    } else {
      if (allGroups.length === 0) return;

      lines.push(`LISTA DE ALISTADO — ${STAGE_LABEL[stageFilter].toUpperCase()}`);
      lines.push(`Fecha: ${fechaHoy} · ${summary.totalPedidos} pedidos · ${summary.totalUnidades} uds`);
      if (courierFilter !== 'todos') {
        lines.push(`Courier: ${courierFilter}`);
      }
      lines.push('');

      const sortedForCopy = [...allGroups].sort((a, b) => b.totalUnidades - a.totalUnidades);
      for (const g of sortedForCopy) {
        const checkMark = checkedKeys[g.key] ? '[x]' : '[ ]';
        const skuTag = g.sku ? ` (${g.sku})` : '';
        const faltanteTag = g.faltante > 0 ? ` — FALTAN ${g.faltante}` : '';
        lines.push(
          `${checkMark} ${g.nombre}${skuTag}: ${g.totalUnidades} uds (${g.totalPedidos} ped.)${faltanteTag}`
        );
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
        {groupMode === 'producto' ? (
          <>
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
                {summary.totalDepartamentos} deptos · {STAGE_LABEL[stageFilter]}
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
          </>
        ) : (
          <>
            <div className="p-4">
              <p className="text-xs font-medium tx-mu">Departamentos activos</p>
              <p className="text-2xl font-bold font-mono tabular-nums mt-1 text-[var(--tx)]">
                {summary.totalDepartamentos}
              </p>
              <p className="text-xs tx-mu mt-0.5 tabular-nums">
                {summary.totalPedidos} pedidos · {summary.totalUnidades} uds
              </p>
            </div>

            <div className="p-4">
              <p className="text-xs font-medium tx-mu">Sin courier asignado</p>
              <p
                className={`text-2xl font-bold font-mono tabular-nums mt-1 ${
                  summary.sinCourier > 0
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-emerald-600 dark:text-emerald-400'
                }`}
              >
                {summary.sinCourier}
              </p>
              <p className="text-xs tx-mu mt-0.5">
                {summary.sinCourier > 0
                  ? 'Pendientes de atribuir repartidor'
                  : 'Todos los paquetes tienen courier'}
              </p>
            </div>

            <div className="p-4">
              <p className="text-xs font-medium tx-mu">Couriers con carga</p>
              <p className="text-2xl font-bold font-mono tabular-nums mt-1 text-[var(--tx)]">
                {courierSummaryBuckets.filter((c) => !c.isUnassigned).length}
              </p>
              <p className="text-xs tx-mu mt-0.5">
                Etapa: {STAGE_LABEL[stageFilter]}
              </p>
            </div>

            <div className="p-4">
              <p className="text-xs font-medium tx-mu">Monto COD del lote</p>
              <p className="text-2xl font-bold font-mono tabular-nums mt-1 text-emerald-600 dark:text-emerald-400">
                {formatMoney(summary.totalCod)}
              </p>
              <p className="text-xs tx-mu mt-0.5 tabular-nums">
                {summary.totalPedidos} paquetes por cobrar
              </p>
            </div>
          </>
        )}
      </section>

      {/* Barra de controles: Modo (Producto / Departamento), Etapas y Acciones */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Selector de agrupación: Por producto vs Por departamento */}
            <div className="flex items-center gap-1 p-1 bg-sf border border-[var(--bd)] rounded-lg shrink-0">
              <button
                type="button"
                onClick={() => setGroupMode('producto')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
                  groupMode === 'producto'
                    ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                    : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                <Package className="w-3.5 h-3.5" />
                <span>Por producto</span>
              </button>
              <button
                type="button"
                onClick={() => setGroupMode('departamento')}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer inline-flex items-center gap-1.5 ${
                  groupMode === 'departamento'
                    ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                    : 'tx-mu hover:text-[var(--tx)]'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                <span>Por departamento</span>
              </button>
            </div>

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
                        ? 'bg-cd text-[var(--tx)] font-semibold border border-[var(--bd)]'
                        : 'tx-mu hover:text-[var(--tx)] border border-transparent'
                    }`}
                  >
                    <span>{opt.label}</span>
                    <span className="font-mono tabular-nums text-[11px] opacity-75">
                      {opt.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Acciones principales */}
          <div className="flex flex-wrap items-center gap-2">
            {groupMode === 'producto' && summary.productosListos > 0 && (
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
              disabled={filteredOrders.length === 0}
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
                  <span>
                    {groupMode === 'departamento' ? 'Copiar reparto' : 'Copiar para bodega'}
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowPrintSheet(true)}
              disabled={filteredOrders.length === 0}
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
              placeholder={
                groupMode === 'departamento'
                  ? 'Buscar departamento, dirección, courier o cliente...'
                  : 'Buscar producto, SKU, color o cliente...'
              }
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--bd)] bg-cd text-xs text-[var(--tx)] placeholder:tx-mu focus:outline-none focus:border-[var(--tx)]"
            />
          </div>

          <select
            value={courierFilter}
            onChange={(e) => setCourierFilter(e.target.value)}
            aria-label="Filtrar por courier"
            className="px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd text-xs text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          >
            <option value="todos">Todos los couriers ({stageOrders.length})</option>
            <option value="Sin asignar">
              Sin asignar ({stageOrders.filter((o) => !String(o.courier || '').trim()).length})
            </option>
            {couriers.map((c) => {
              const count = stageOrders.filter((o) => String(o.courier || '').trim() === c).length;
              return (
                <option key={c} value={c}>
                  {c} ({count})
                </option>
              );
            })}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'cantidad' | 'nombre' | 'faltante')}
            aria-label="Ordenar lista"
            className="px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd text-xs text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
          >
            <option value="cantidad">
              {groupMode === 'departamento' ? 'Orden: Más pedidos' : 'Orden: Mayor cantidad'}
            </option>
            <option value="faltante">
              {groupMode === 'departamento' ? 'Orden: Sin asignar primero' : 'Orden: Faltantes primero'}
            </option>
            <option value="nombre">Orden: Alfabético (A-Z)</option>
          </select>

          {groupMode === 'producto' && (
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
          )}
        </div>

        {/* Feedback inline tras asignación masiva */}
        {assignFeedback && (
          <div className="flex items-center justify-between gap-2 px-3.5 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 text-xs">
            <span className="font-medium">{assignFeedback}</span>
            <button
              type="button"
              onClick={() => setAssignFeedback(null)}
              aria-label="Cerrar aviso"
              className="opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Barra delgada de progreso de alistado (solo modo Producto) */}
        {groupMode === 'producto' && summary.totalUnidades > 0 && (
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

        {/* Distribución interactiva por courier (modo Departamento): saber cuántos y cuáles se van con quién */}
        {groupMode === 'departamento' && courierSummaryBuckets.length > 0 && (
          <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--bd)] flex items-center justify-between gap-2 bg-sf/40">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--tx)]">
                <Truck className="w-3.5 h-3.5 tx-mu" />
                <span>Reparto por courier ({STAGE_LABEL[stageFilter]})</span>
              </div>
              {courierFilter !== 'todos' && (
                <button
                  type="button"
                  onClick={() => setCourierFilter('todos')}
                  className="text-xs tx-mu hover:text-[var(--tx)] underline cursor-pointer"
                >
                  Ver todos los couriers
                </button>
              )}
            </div>

            <div className="flex items-stretch overflow-x-auto divide-x divide-[var(--bd)]">
              {courierSummaryBuckets.map((b) => {
                const isActive = courierFilter === b.courier;
                return (
                  <button
                    key={b.courier}
                    type="button"
                    onClick={() => setCourierFilter(isActive ? 'todos' : b.courier)}
                    className={`px-4 py-3 text-left transition-colors min-w-[180px] shrink-0 cursor-pointer ${
                      isActive ? 'bg-sf' : 'hover:bg-sf/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs font-semibold truncate ${
                          b.isUnassigned
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-[var(--tx)]'
                        }`}
                      >
                        {b.courier}
                      </span>
                      <span className="font-mono tabular-nums text-sm font-bold text-[var(--tx)]">
                        {b.pedidos}
                      </span>
                    </div>
                    <div className="text-[11px] tx-mu font-mono tabular-nums mt-0.5">
                      {b.unidades} uds · {formatMoney(b.totalCod)}
                    </div>
                    <div className="text-[11px] tx-mu truncate mt-1 max-w-[200px]">
                      {b.departamentos.slice(0, 2).join(', ')}
                      {b.departamentos.length > 2 ? ` +${b.departamentos.length - 2}` : ''}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* CONTENIDO PRINCIPAL: TABLA POR PRODUCTO O TABLA POR DEPARTAMENTO */}
      {groupMode === 'producto' ? (
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
                      <ProductRow
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
      ) : (
        <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
          {visibleDepartmentGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <MapPin className="w-9 h-9 tx-mu opacity-40 mb-3" />
              <p className="text-sm font-semibold text-[var(--tx)]">
                {allDepartmentGroups.length === 0
                  ? `No hay pedidos por consolidar en "${STAGE_LABEL[stageFilter]}"`
                  : 'Ningún departamento coincide con los filtros actuales'}
              </p>
              <p className="text-xs tx-mu mt-1 max-w-md">
                {allDepartmentGroups.length === 0
                  ? 'Aquí verás tus pedidos agrupados por departamento para asignar couriers en lote y verificar qué paquetes se van con cada repartidor.'
                  : 'Prueba limpiando la búsqueda o seleccionando todos los couriers.'}
              </p>
              {(search || courierFilter !== 'todos') && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch('');
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
                    <th className="py-3 pl-4 pr-3">Departamento, couriers y productos</th>
                    <th className="py-3 px-3 text-right w-32">Paquetes</th>
                    <th className="py-3 px-3 w-72">Atribuir courier</th>
                    <th className="py-3 pl-3 pr-4 text-right w-32">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]">
                  {visibleDepartmentGroups.map((dept) => (
                    <DepartmentRow
                      key={dept.key}
                      dept={dept}
                      couriers={couriers}
                      isExpanded={Boolean(expandedDepts[dept.key])}
                      draftCourier={deptCourierDraft[dept.key] || ''}
                      isAssigningDept={assigningDeptKey === dept.key}
                      assigningOrderId={assigningOrderId}
                      advancingOrderId={advancingOrderId}
                      canAssign={Boolean(onAssignCourierToOrders)}
                      onToggleExpand={() => toggleExpandedDept(dept.key)}
                      onChangeDraftCourier={(val) =>
                        setDeptCourierDraft((prev) => ({ ...prev, [dept.key]: val }))
                      }
                      onBulkAssign={(onlyUnassigned) =>
                        handleBulkAssignDepartment(dept, onlyUnassigned)
                      }
                      onChangeOrderCourier={handleAssignSingleOrderCourier}
                      onOpenPedido={onOpenPedido}
                      onAdvanceOrderToPack={handleAdvanceOrderToPack}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Modal Hoja Imprimible de Alistado / Reparto (sin window.open, usando window.print) */}
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
                  {groupMode === 'departamento'
                    ? 'Hoja Consolidada por Departamento y Courier'
                    : 'Hoja de Alistado de Bodega'}
                </h3>
                <p className="text-xs tx-mu mt-0.5">
                  {groupMode === 'departamento'
                    ? 'Distribución por zona geográfica y repartidor lista para imprimir.'
                    : 'Lista consolidada por producto lista para imprimir y bajar mercadería.'}
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
                    {groupMode === 'departamento'
                      ? `Reparto por Departamento — ${STAGE_LABEL[stageFilter]}`
                      : `Hoja de Alistado — ${STAGE_LABEL[stageFilter]}`}
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
                  <div className="font-bold text-sm">
                    {groupMode === 'departamento'
                      ? `${summary.totalPedidos} pedidos (${formatMoney(summary.totalCod)})`
                      : `${summary.totalUnidades} uds totales`}
                  </div>
                  <div className="tx-mu">
                    {groupMode === 'departamento'
                      ? `${summary.totalDepartamentos} deptos · ${summary.totalUnidades} uds`
                      : `${summary.totalProductos} productos · ${summary.totalPedidos} pedidos`}
                  </div>
                </div>
              </div>

              {groupMode === 'departamento' ? (
                <>
                  {courierSummaryBuckets.length > 0 && courierFilter === 'todos' && (
                    <div className="text-xs pb-2 border-b border-[var(--bd)]">
                      <div className="font-semibold mb-1">Resumen por courier</div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono tabular-nums">
                        {courierSummaryBuckets.map((c) => (
                          <span key={c.courier}>
                            {c.courier}: <strong>{c.pedidos}</strong> ped. ({c.unidades} uds ·{' '}
                            {formatMoney(c.totalCod)})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-[var(--bd)]">
                        <th className="py-2 pr-2">Departamento</th>
                        <th className="py-2 px-2">Couriers asignados</th>
                        <th className="py-2 px-2">Productos</th>
                        <th className="py-2 px-2 text-right">Ped.</th>
                        <th className="py-2 pl-2 text-right">COD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--bd)]">
                      {allDepartmentGroups.map((d) => (
                        <tr key={d.key}>
                          <td className="py-2.5 pr-2 align-top font-semibold">{d.departamento}</td>
                          <td className="py-2.5 px-2 align-top text-[11px]">
                            {d.couriersResumen.map((c) => `${c.courier} ×${c.pedidos}`).join(' · ')}
                          </td>
                          <td className="py-2.5 px-2 align-top text-[11px] tx-mu">
                            {d.productosResumen.map((p) => `${p.nombre} ×${p.unidades}`).join(', ')}
                          </td>
                          <td className="py-2.5 px-2 align-top text-right font-mono tabular-nums font-bold">
                            {d.totalPedidos}
                          </td>
                          <td className="py-2.5 pl-2 align-top text-right font-mono tabular-nums">
                            {formatMoney(d.totalCod)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
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
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fila de PRODUCTO + desglose expandible de pedidos                   */
/* ------------------------------------------------------------------ */

function ProductRow({
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
      <tr className={`transition-colors ${isChecked ? 'bg-sf/40 opacity-65' : 'hover:bg-sf/40'}`}>
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

        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
          <span className="text-xl font-bold font-mono tabular-nums text-[var(--tx)]">
            {group.totalUnidades}
          </span>
          <span className="text-xs tx-mu ml-1">{group.totalUnidades === 1 ? 'ud' : 'uds'}</span>
        </td>

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
                          <span className="text-[var(--tx)]/90 block truncate">{ref.detalleTexto}</span>
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

/* ------------------------------------------------------------------ */
/* Fila de DEPARTAMENTO + asignación de courier masiva e individual    */
/* ------------------------------------------------------------------ */

function DepartmentRow({
  dept,
  couriers,
  isExpanded,
  draftCourier,
  isAssigningDept,
  assigningOrderId,
  advancingOrderId,
  canAssign,
  onToggleExpand,
  onChangeDraftCourier,
  onBulkAssign,
  onChangeOrderCourier,
  onOpenPedido,
  onAdvanceOrderToPack,
}: {
  dept: DepartmentGroup;
  couriers: string[];
  isExpanded: boolean;
  draftCourier: string;
  isAssigningDept: boolean;
  assigningOrderId: string | null;
  advancingOrderId: string | null;
  canAssign: boolean;
  onToggleExpand: () => void;
  onChangeDraftCourier: (val: string) => void;
  onBulkAssign: (onlyUnassigned: boolean) => void;
  onChangeOrderCourier: (orderId: string, newCourier: string) => void;
  onOpenPedido: (pedido: PickingOrderItem) => void;
  onAdvanceOrderToPack: (pedido: PickingOrderItem) => void;
}) {
  const hasMixedAssignment =
    dept.sinAsignarCount > 0 && dept.sinAsignarCount < dept.totalPedidos;

  return (
    <>
      <tr className="hover:bg-sf/40 transition-colors">
        {/* Departamento + resumen de couriers + resumen de productos */}
        <td className="py-3.5 pl-4 pr-3 align-middle">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <button
                type="button"
                onClick={onToggleExpand}
                className="text-left text-sm font-semibold text-[var(--tx)] hover:underline cursor-pointer"
              >
                {dept.departamento}
              </button>
              <span className="text-xs font-mono tabular-nums tx-mu">
                {formatMoney(dept.totalCod)}
              </span>
              {dept.inferredCount > 0 && (
                <span className="text-[11px] tx-mu">
                  · {dept.inferredCount} detectado(s) por dirección
                </span>
              )}
            </div>

            {/* Desglose de couriers (sin pills, texto limpio con separadores) */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-1 tabular-nums">
              {dept.couriersResumen.map((c, idx) => (
                <span key={c.courier} className="inline-flex items-center gap-2">
                  {idx > 0 && (
                    <span className="tx-mu" aria-hidden="true">
                      ·
                    </span>
                  )}
                  <span
                    className={
                      c.courier === 'Sin asignar'
                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                        : 'text-[var(--tx)] font-medium'
                    }
                  >
                    {c.courier} ×{c.pedidos}
                  </span>
                </span>
              ))}
            </div>

            {/* Productos consolidados que van hacia este departamento */}
            <p className="text-xs tx-mu mt-1 tabular-nums line-clamp-2">
              {dept.productosResumen.map((p) => `${p.nombre} ×${p.unidades}`).join(' · ')}
            </p>
          </div>
        </td>

        {/* Paquetes y unidades */}
        <td className="py-3.5 px-3 text-right align-middle whitespace-nowrap">
          <div>
            <span className="text-xl font-bold font-mono tabular-nums text-[var(--tx)]">
              {dept.totalPedidos}
            </span>
            <span className="text-xs tx-mu ml-1">
              {dept.totalPedidos === 1 ? 'ped.' : 'peds.'}
            </span>
          </div>
          <div className="text-xs font-mono tabular-nums tx-mu mt-0.5">
            {dept.totalUnidades} {dept.totalUnidades === 1 ? 'ud' : 'uds'}
          </div>
        </td>

        {/* Control de atribución de courier en bloque */}
        <td className="py-3.5 px-3 align-middle">
          {canAssign ? (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5">
                <select
                  value={draftCourier}
                  onChange={(e) => onChangeDraftCourier(e.target.value)}
                  disabled={isAssigningDept}
                  aria-label={`Seleccionar courier para ${dept.departamento}`}
                  className="flex-1 min-w-[130px] px-2.5 py-1.5 rounded-lg border border-[var(--bd)] bg-sf text-xs text-[var(--tx)] focus:outline-none focus:border-[var(--tx)]"
                >
                  <option value="">Elegir courier...</option>
                  {couriers.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  disabled={!draftCourier || isAssigningDept}
                  onClick={() => onBulkAssign(false)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 disabled:opacity-35 text-xs font-semibold transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
                  title={`Asignar este courier a los ${dept.totalPedidos} pedidos de ${dept.departamento}`}
                >
                  {isAssigningDept ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span>Todos ({dept.totalPedidos})</span>
                  )}
                </button>
              </div>

              {hasMixedAssignment && draftCourier && (
                <button
                  type="button"
                  disabled={isAssigningDept}
                  onClick={() => onBulkAssign(true)}
                  className="self-start text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:underline cursor-pointer"
                >
                  Asignar solo a los {dept.sinAsignarCount} sin courier
                </button>
              )}
            </div>
          ) : (
            <span className="text-xs tx-mu">—</span>
          )}
        </td>

        {/* Desplegar pedidos del departamento */}
        <td className="py-3.5 pl-3 pr-4 text-right align-middle whitespace-nowrap">
          <button
            type="button"
            onClick={onToggleExpand}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--bd)] bg-sf hover:border-[var(--tx)] text-xs font-medium text-[var(--tx)] transition-colors cursor-pointer"
          >
            <span>{isExpanded ? 'Ocultar' : 'Ver lista'}</span>
            {isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 tx-mu" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 tx-mu" />
            )}
          </button>
        </td>
      </tr>

      {/* Sub-tabla con todos los pedidos del departamento y selector individual de courier */}
      {isExpanded && (
        <tr className="bg-sf/35">
          <td colSpan={4} className="px-4 sm:px-6 py-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[var(--bd)] tx-mu text-[11px]">
                    <th className="py-1.5 pr-3 font-medium">Cliente / Dirección</th>
                    <th className="py-1.5 px-2 font-medium">Productos</th>
                    <th className="py-1.5 px-2 font-medium">Etapa</th>
                    <th className="py-1.5 px-2 font-medium">Courier asignado</th>
                    <th className="py-1.5 pl-2 text-right font-medium">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]/60">
                  {dept.pedidos.map((entry) => {
                    const o = entry.order;
                    const code = o.pedido_codigo || `#${String(o.id).slice(0, 6)}`;
                    const currentVal = String(o.courier || '').trim();
                    const courierOptions =
                      currentVal && !couriers.includes(currentVal)
                        ? [currentVal, ...couriers]
                        : couriers;

                    return (
                      <tr key={o.id} className="hover:bg-cd/50">
                        <td className="py-2 pr-3 align-middle max-w-[280px]">
                          <span className="font-medium text-[var(--tx)] block truncate">
                            {o.nombre_cliente || 'Sin nombre'}
                          </span>
                          <span className="text-[11px] tx-mu font-mono tabular-nums block">
                            {code} · {formatMoney(o.total)}
                          </span>
                          {o.direccion && (
                            <span className="text-[11px] tx-mu block truncate">{o.direccion}</span>
                          )}
                        </td>

                        <td className="py-2 px-2 align-middle max-w-[240px]">
                          <span className="text-[var(--tx)]/90 block truncate tabular-nums">
                            {entry.productosResumen}
                          </span>
                          {o.notas && (
                            <span className="text-[11px] tx-mu block truncate">{o.notas}</span>
                          )}
                        </td>

                        <td className="py-2 px-2 align-middle whitespace-nowrap text-[11px] text-[var(--tx)] font-medium">
                          {ORDER_STATE_LABEL[entry.estadoNormalizado] || entry.estadoNormalizado}
                        </td>

                        <td className="py-2 px-2 align-middle whitespace-nowrap">
                          {canAssign ? (
                            <select
                              value={currentVal}
                              disabled={assigningOrderId === o.id}
                              onChange={(e) => onChangeOrderCourier(o.id, e.target.value)}
                              aria-label={`Courier para pedido ${code}`}
                              className={`px-2 py-1 rounded-md border text-xs bg-cd focus:outline-none focus:border-[var(--tx)] ${
                                !currentVal
                                  ? 'border-amber-500/40 text-amber-600 dark:text-amber-400 font-medium'
                                  : 'border-[var(--bd)] text-[var(--tx)]'
                              }`}
                            >
                              <option value="">Sin asignar</option>
                              {courierOptions.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-xs tx-mu">{currentVal || 'Sin asignar'}</span>
                          )}
                        </td>

                        <td className="py-2 pl-2 text-right align-middle whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            {entry.estadoNormalizado === 'nuevo' && (
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
