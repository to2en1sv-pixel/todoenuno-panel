import { identifyDuplicateVariantStockRows } from '@/lib/inventory';
import type { PendingStreetOrder, StreetCollectionsSummary } from '@/lib/finance';
import type { Budget, CashAccount, MoneyTransaction } from '@/types/finance';
import type { ProductVariant, StockItem } from '@/types/inventory';

export type FinancePeriodPreset =
  | 'hoy'
  | '7d'
  | 'mes_actual'
  | 'mes_anterior'
  | 'todo'
  | 'custom';

export interface ResolvedPeriodRange {
  preset: FinancePeriodPreset;
  startDate: string | null; // YYYY-MM-DD inclusive
  endDate: string | null;   // YYYY-MM-DD inclusive
  prevStartDate: string | null;
  prevEndDate: string | null;
  label: string;
  comparisonLabel: string | null;
  daysCount: number;
}

export interface CategoryBreakdownItem {
  categoria: string;
  label: string;
  monto: number;
  pct: number;
  count: number;
  bucket: 'operativo' | 'inventario';
}

export interface DuplicateAdGroup {
  fecha: string;
  descripcion: string;
  count: number;
  totalRegistrado: number;
  excedenteEstimado: number;
}

export interface PeriodFinanceMetrics {
  ingresos: number;
  ingresosCobros: number;
  ingresosManuales: number;
  egresosOperativos: number;
  comprasInventario: number;
  egresosTotalesCaja: number;
  ajustesPositivos: number;
  ajustesNegativos: number;
  ajustesNetos: number;
  transferenciasTotal: number;
  transferenciasCount: number;
  utilidadOperativa: number;
  flujoNetoCaja: number;
  margenOperativoPct: number;
  ingresosDeltaPct: number | null;
  egresosOperativosDeltaPct: number | null;
  prevIngresos: number | null;
  prevEgresosOperativos: number | null;
  categoryBreakdown: CategoryBreakdownItem[];
  duplicateAdGroups: DuplicateAdGroup[];
  duplicateAdExcessTotal: number;
  transactionsCount: number;
  daysCount: number;
}

export interface RealBusinessValueSummary {
  valorTotalReal: number;
  liquidezNeta: number;
  liquidezPositiva: number;
  deudaTarjetaPauta: number;
  inventarioCosto: number;
  inventarioPrecioVenta: number;
  entregadosSinLiquidar: number;
  enRutaPotencial: number;
  skusActivosCount: number;
  skusSinCostoCount: number;
  unidadesFisicas: number;
  pctLiquidez: number;
  pctInventario: number;
  pctEntregados: number;
}

export interface HealthPillar {
  id: 'margen' | 'liquidez' | 'calle' | 'presupuesto';
  label: string;
  score: number;
  maxScore: number;
  summary: string;
  status: 'ok' | 'warn' | 'risk';
}

export interface HealthActionItem {
  id: string;
  severity: 'warn' | 'risk' | 'info';
  title: string;
  detail: string;
  actionType: 'liquidate_street' | 'open_planning' | 'go_inventory' | 'open_ledger_ads';
  actionLabel: string;
}

export interface LiquidationSimulation {
  montoPorLiquidar: number;
  nuevaLiquidezNeta: number;
  nuevoScore: number;
  nuevoEstado: 'Saludable' | 'Atención' | 'Riesgo';
  mejoraPuntos: number;
}

export interface FinancialHealthReport {
  score: number;
  estado: 'Saludable' | 'Atención' | 'Riesgo';
  runwayDias: number | null;
  gastoDiarioPromedio: number;
  compromisos15dTotal: number;
  compromisos15dCount: number;
  pagosVencidosCount: number;
  pctCapitalAtrapado: number;
  pillars: HealthPillar[];
  findings: HealthActionItem[];
  simulation: LiquidationSimulation | null;
}

const SV_TZ = 'America/El_Salvador';

const MONTH_SHORT_ES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

const CATEGORY_LABELS: Record<string, string> = {
  pauta_publicidad: 'Pauta publicitaria',
  pago_proveedor: 'Compra inventario / Proveedor',
  compra_inventario: 'Compra inventario',
  flete_envio: 'Fletes y envíos',
  empaque_suministros: 'Empaque y suministros',
  nomina_sueldos: 'Nómina y ayudantes',
  suscripciones: 'Suscripciones y software',
  alquiler_servicios: 'Servicios y alquiler',
  gasto_manual: 'Gastos generales',
  venta_contraentrega: 'Cobros contra entrega',
  venta_pedido: 'Ventas liquidadas',
  abono_manual: 'Abonos de clientes',
  devolucion_proveedor: 'Devolución de proveedor',
  otro_ingreso: 'Otros ingresos',
  ajuste_saldo: 'Ajustes de conciliación',
};

export function getCategoryDisplayLabel(cat?: string | null): string {
  const key = String(cat || '').trim().toLowerCase();
  if (!key) return 'Sin categoría';
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  return key.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
}

export function getSvTodayStr(refDate: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: SV_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(refDate);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // fallback
  }
  const svMs = refDate.getTime() - 6 * 60 * 60 * 1000;
  return new Date(svMs).toISOString().slice(0, 10);
}

function addDaysToYmd(ymd: string, deltaDays: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + deltaDays));
  return dt.toISOString().slice(0, 10);
}

function daysBetweenInclusive(startYmd: string, endYmd: string): number {
  const s = Date.parse(`${startYmd}T00:00:00Z`);
  const e = Date.parse(`${endYmd}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 1;
  return Math.max(Math.round((e - s) / 86400000) + 1, 1);
}

export function formatShortDateEs(ymd: string): string {
  const parts = ymd.split('-').map(Number);
  if (parts.length !== 3) return ymd;
  const [y, m, d] = parts;
  const mon = MONTH_SHORT_ES[(m || 1) - 1] || String(m);
  return `${d} ${mon} ${y}`;
}

export function formatRangeLabelEs(startYmd: string, endYmd: string): string {
  if (startYmd === endYmd) return formatShortDateEs(startYmd);
  const [sy, sm, sd] = startYmd.split('-').map(Number);
  const [ey, em, ed] = endYmd.split('-').map(Number);
  if (sy === ey && sm === em) {
    return `Del ${sd} al ${ed} de ${MONTH_SHORT_ES[(sm || 1) - 1]} ${sy}`;
  }
  if (sy === ey) {
    return `${sd} ${MONTH_SHORT_ES[(sm || 1) - 1]} al ${ed} ${MONTH_SHORT_ES[(em || 1) - 1]} ${sy}`;
  }
  return `${formatShortDateEs(startYmd)} – ${formatShortDateEs(endYmd)}`;
}

export function extractTxYmd(tx: Pick<MoneyTransaction, 'fecha' | 'created_at'>): string {
  if (tx.fecha && /^\d{4}-\d{2}-\d{2}/.test(tx.fecha)) {
    return tx.fecha.slice(0, 10);
  }
  if (tx.created_at) {
    const dt = new Date(tx.created_at);
    if (Number.isFinite(dt.getTime())) {
      return getSvTodayStr(dt);
    }
  }
  return getSvTodayStr();
}

export function resolveFinancePeriodRange(
  preset: FinancePeriodPreset,
  customStart?: string,
  customEnd?: string,
  now: Date = new Date()
): ResolvedPeriodRange {
  const today = getSvTodayStr(now);
  const [ty, tm, td] = today.split('-').map(Number);

  if (preset === 'hoy') {
    const yesterday = addDaysToYmd(today, -1);
    return {
      preset,
      startDate: today,
      endDate: today,
      prevStartDate: yesterday,
      prevEndDate: yesterday,
      label: `Hoy (${formatShortDateEs(today)})`,
      comparisonLabel: 'vs ayer',
      daysCount: 1,
    };
  }

  if (preset === '7d') {
    const start = addDaysToYmd(today, -6);
    const prevEnd = addDaysToYmd(start, -1);
    const prevStart = addDaysToYmd(prevEnd, -6);
    return {
      preset,
      startDate: start,
      endDate: today,
      prevStartDate: prevStart,
      prevEndDate: prevEnd,
      label: formatRangeLabelEs(start, today),
      comparisonLabel: 'vs 7 días previos',
      daysCount: 7,
    };
  }

  if (preset === 'mes_anterior') {
    const firstPrev = new Date(Date.UTC(ty, tm - 2, 1));
    const lastPrev = new Date(Date.UTC(ty, tm - 1, 0));
    const start = firstPrev.toISOString().slice(0, 10);
    const end = lastPrev.toISOString().slice(0, 10);

    const firstTwoAgo = new Date(Date.UTC(ty, tm - 3, 1)).toISOString().slice(0, 10);
    const lastTwoAgo = new Date(Date.UTC(ty, tm - 2, 0)).toISOString().slice(0, 10);

    return {
      preset,
      startDate: start,
      endDate: end,
      prevStartDate: firstTwoAgo,
      prevEndDate: lastTwoAgo,
      label: formatRangeLabelEs(start, end),
      comparisonLabel: 'vs mes previo',
      daysCount: daysBetweenInclusive(start, end),
    };
  }

  if (preset === 'custom') {
    const sRaw = customStart && /^\d{4}-\d{2}-\d{2}$/.test(customStart) ? customStart : `${today.slice(0, 8)}01`;
    const eRaw = customEnd && /^\d{4}-\d{2}-\d{2}$/.test(customEnd) ? customEnd : today;
    const start = sRaw <= eRaw ? sRaw : eRaw;
    const end = sRaw <= eRaw ? eRaw : sRaw;
    const span = daysBetweenInclusive(start, end);
    const prevEnd = addDaysToYmd(start, -1);
    const prevStart = addDaysToYmd(prevEnd, -(span - 1));
    return {
      preset,
      startDate: start,
      endDate: end,
      prevStartDate: prevStart,
      prevEndDate: prevEnd,
      label: formatRangeLabelEs(start, end),
      comparisonLabel: `vs ${span}d previos`,
      daysCount: span,
    };
  }

  if (preset === 'todo') {
    return {
      preset,
      startDate: null,
      endDate: null,
      prevStartDate: null,
      prevEndDate: null,
      label: 'Todo el historial disponible',
      comparisonLabel: null,
      daysCount: 30,
    };
  }

  // Default: mes_actual
  const start = `${today.slice(0, 8)}01`;
  const prevMonthDays = new Date(Date.UTC(ty, tm - 1, 0)).getUTCDate();
  const prevEndDay = Math.min(td, prevMonthDays);
  const prevStart = new Date(Date.UTC(ty, tm - 2, 1)).toISOString().slice(0, 10);
  const prevEnd = new Date(Date.UTC(ty, tm - 2, prevEndDay)).toISOString().slice(0, 10);

  return {
    preset: 'mes_actual',
    startDate: start,
    endDate: today,
    prevStartDate: prevStart,
    prevEndDate: prevEnd,
    label: formatRangeLabelEs(start, today),
    comparisonLabel: `vs ${formatRangeLabelEs(prevStart, prevEnd)}`,
    daysCount: daysBetweenInclusive(start, today),
  };
}

export function filterTransactionsByDateRange(
  transactions: MoneyTransaction[],
  startDate: string | null,
  endDate: string | null
): MoneyTransaction[] {
  if (!startDate && !endDate) return transactions;
  return transactions.filter(tx => {
    const ymd = extractTxYmd(tx);
    if (startDate && ymd < startDate) return false;
    if (endDate && ymd > endDate) return false;
    return true;
  });
}

export function isInventoryPurchaseCategory(cat?: string | null): boolean {
  const c = String(cat || '').trim().toLowerCase();
  return (
    c === 'pago_proveedor' ||
    c === 'compra_inventario' ||
    c === 'compra_mercaderia' ||
    c.includes('proveedor')
  );
}

export function isBalanceAdjustmentCategory(cat?: string | null): boolean {
  return String(cat || '').trim().toLowerCase() === 'ajuste_saldo';
}

function calcDeltaPct(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  if (previous === 0) {
    if (current === 0) return 0;
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

function summarizeRawBucket(txs: MoneyTransaction[]) {
  let ingresos = 0;
  let ingresosCobros = 0;
  let ingresosManuales = 0;
  let egresosOperativos = 0;
  let comprasInventario = 0;
  let ajustesPositivos = 0;
  let ajustesNegativos = 0;
  let transferenciasTotal = 0;
  let transferenciasCount = 0;

  txs.forEach(tx => {
    const monto = Number(tx.monto) || 0;
    const cat = String(tx.categoria || '').trim().toLowerCase();

    if (tx.tipo === 'transfer') {
      if (cat === 'transferencia_salida') {
        transferenciasTotal += monto;
        transferenciasCount++;
      }
      return;
    }

    if (isBalanceAdjustmentCategory(cat)) {
      if (tx.tipo === 'income') ajustesPositivos += monto;
      else if (tx.tipo === 'expense') ajustesNegativos += monto;
      return;
    }

    if (tx.tipo === 'income') {
      ingresos += monto;
      if (cat === 'venta_contraentrega' || cat === 'venta_pedido') {
        ingresosCobros += monto;
      } else {
        ingresosManuales += monto;
      }
      return;
    }

    if (tx.tipo === 'expense') {
      if (isInventoryPurchaseCategory(cat)) {
        comprasInventario += monto;
      } else {
        egresosOperativos += monto;
      }
    }
  });

  return {
    ingresos,
    ingresosCobros,
    ingresosManuales,
    egresosOperativos,
    comprasInventario,
    ajustesPositivos,
    ajustesNegativos,
    transferenciasTotal,
    transferenciasCount,
  };
}

export function computePeriodMetrics(
  activeTransactions: MoneyTransaction[],
  periodRange: ResolvedPeriodRange
): PeriodFinanceMetrics {
  const periodTxs = filterTransactionsByDateRange(
    activeTransactions,
    periodRange.startDate,
    periodRange.endDate
  );

  const current = summarizeRawBucket(periodTxs);

  let prevIngresos: number | null = null;
  let prevEgresosOperativos: number | null = null;
  if (periodRange.prevStartDate && periodRange.prevEndDate) {
    const prevTxs = filterTransactionsByDateRange(
      activeTransactions,
      periodRange.prevStartDate,
      periodRange.prevEndDate
    );
    const prevSummary = summarizeRawBucket(prevTxs);
    prevIngresos = prevSummary.ingresos;
    prevEgresosOperativos = prevSummary.egresosOperativos;
  }

  const egresosTotalesCaja = current.egresosOperativos + current.comprasInventario;
  const utilidadOperativa = current.ingresos - current.egresosOperativos;
  const flujoNetoCaja = current.ingresos - egresosTotalesCaja;
  const margenOperativoPct =
    current.ingresos > 0 ? (utilidadOperativa / current.ingresos) * 100 : 0;

  // Desglose por categoría de egresos reales (operativos + compras inventario)
  const catMap = new Map<string, CategoryBreakdownItem>();
  periodTxs.forEach(tx => {
    if (tx.tipo !== 'expense') return;
    const rawCat = String(tx.categoria || 'gasto_manual').trim().toLowerCase();
    if (isBalanceAdjustmentCategory(rawCat)) return;

    const bucket: 'operativo' | 'inventario' = isInventoryPurchaseCategory(rawCat)
      ? 'inventario'
      : 'operativo';
    const existing = catMap.get(rawCat);
    const monto = Number(tx.monto) || 0;
    if (existing) {
      existing.monto += monto;
      existing.count += 1;
    } else {
      catMap.set(rawCat, {
        categoria: rawCat,
        label: getCategoryDisplayLabel(rawCat),
        monto,
        pct: 0,
        count: 1,
        bucket,
      });
    }
  });

  const categoryBreakdown = Array.from(catMap.values())
    .map(item => ({
      ...item,
      pct: egresosTotalesCaja > 0 ? (item.monto / egresosTotalesCaja) * 100 : 0,
    }))
    .sort((a, b) => b.monto - a.monto);

  // Detector de posibles duplicados de pauta automática en un mismo día y campaña
  const adGroupMap = new Map<string, { fecha: string; descripcion: string; montos: number[] }>();
  periodTxs.forEach(tx => {
    if (tx.tipo !== 'expense' || tx.es_manual) return;
    if (String(tx.categoria || '').toLowerCase() !== 'pauta_publicidad') return;
    const fecha = extractTxYmd(tx);
    const desc = (tx.descripcion || 'Pauta automática').trim();
    const key = `${fecha}::${desc.toLowerCase()}`;
    const group = adGroupMap.get(key);
    const monto = Number(tx.monto) || 0;
    if (group) {
      group.montos.push(monto);
    } else {
      adGroupMap.set(key, { fecha, descripcion: desc, montos: [monto] });
    }
  });

  const duplicateAdGroups: DuplicateAdGroup[] = [];
  let duplicateAdExcessTotal = 0;

  adGroupMap.forEach(g => {
    if (g.montos.length > 1) {
      const totalRegistrado = g.montos.reduce((s, m) => s + m, 0);
      const maxSingle = Math.max(...g.montos);
      const excedenteEstimado = Math.max(totalRegistrado - maxSingle, 0);
      if (excedenteEstimado > 0.01) {
        duplicateAdExcessTotal += excedenteEstimado;
        duplicateAdGroups.push({
          fecha: g.fecha,
          descripcion: g.descripcion,
          count: g.montos.length,
          totalRegistrado,
          excedenteEstimado,
        });
      }
    }
  });

  duplicateAdGroups.sort((a, b) => b.fecha.localeCompare(a.fecha));

  return {
    ingresos: current.ingresos,
    ingresosCobros: current.ingresosCobros,
    ingresosManuales: current.ingresosManuales,
    egresosOperativos: current.egresosOperativos,
    comprasInventario: current.comprasInventario,
    egresosTotalesCaja,
    ajustesPositivos: current.ajustesPositivos,
    ajustesNegativos: current.ajustesNegativos,
    ajustesNetos: current.ajustesPositivos - current.ajustesNegativos,
    transferenciasTotal: current.transferenciasTotal,
    transferenciasCount: current.transferenciasCount,
    utilidadOperativa,
    flujoNetoCaja,
    margenOperativoPct,
    ingresosDeltaPct: calcDeltaPct(current.ingresos, prevIngresos),
    egresosOperativosDeltaPct: calcDeltaPct(current.egresosOperativos, prevEgresosOperativos),
    prevIngresos,
    prevEgresosOperativos,
    categoryBreakdown,
    duplicateAdGroups,
    duplicateAdExcessTotal,
    transactionsCount: periodTxs.length,
    daysCount: periodRange.daysCount,
  };
}

export function computeRealBusinessValue(params: {
  accounts: CashAccount[];
  stockItems: StockItem[];
  variantsList: ProductVariant[];
  streetSummary: StreetCollectionsSummary;
}): RealBusinessValueSummary {
  const { accounts, stockItems, variantsList, streetSummary } = params;

  const liquidezNeta = accounts.reduce((sum, a) => sum + (Number(a.saldo_actual) || 0), 0);
  const liquidezPositiva = accounts.reduce(
    (sum, a) => sum + Math.max(Number(a.saldo_actual) || 0, 0),
    0
  );
  const deudaTarjetaPauta = accounts.reduce((sum, a) => {
    const val = Number(a.saldo_actual) || 0;
    return val < 0 ? sum + Math.abs(val) : sum;
  }, 0);

  const { duplicateChildSkuSet } = identifyDuplicateVariantStockRows(stockItems, variantsList);

  let inventarioCosto = 0;
  let inventarioPrecioVenta = 0;
  let skusActivosCount = 0;
  let skusSinCostoCount = 0;
  let unidadesFisicas = 0;

  stockItems.forEach(item => {
    const skuUpper = (item.sku || '').toUpperCase();
    if (skuUpper.includes('FEE') || duplicateChildSkuSet.has(skuUpper)) return;
    if (item.activo === false) return;

    skusActivosCount++;
    const fisico = Math.max(Number(item.stock_fisico) || 0, 0);
    const costo = Math.max(Number(item.costo_unitario) || 0, 0);
    const precio = Math.max(Number(item.precio_venta) || 0, 0);

    unidadesFisicas += fisico;
    inventarioCosto += fisico * costo;
    inventarioPrecioVenta += fisico * precio;

    if (fisico > 0 && costo <= 0) {
      skusSinCostoCount++;
    }
  });

  const entregadosSinLiquidar = Number(streetSummary.entregadosTotal) || 0;
  const enRutaPotencial = Number(streetSummary.enCaminoTotal) || 0;
  const valorTotalReal = liquidezNeta + inventarioCosto + entregadosSinLiquidar;

  const liqShareBase = Math.max(liquidezNeta, 0);
  const shareTotal = liqShareBase + inventarioCosto + entregadosSinLiquidar;

  return {
    valorTotalReal,
    liquidezNeta,
    liquidezPositiva,
    deudaTarjetaPauta,
    inventarioCosto,
    inventarioPrecioVenta,
    entregadosSinLiquidar,
    enRutaPotencial,
    skusActivosCount,
    skusSinCostoCount,
    unidadesFisicas,
    pctLiquidez: shareTotal > 0 ? (liqShareBase / shareTotal) * 100 : 0,
    pctInventario: shareTotal > 0 ? (inventarioCosto / shareTotal) * 100 : 0,
    pctEntregados: shareTotal > 0 ? (entregadosSinLiquidar / shareTotal) * 100 : 0,
  };
}

export interface SimplePagoFijo {
  id: string;
  nombre: string;
  monto: number;
  fecha_vencimiento: string;
  frecuencia?: string;
}

function evaluateCoreHealthScore(params: {
  periodMetrics: PeriodFinanceMetrics;
  liquidezNeta: number;
  liquidezPositiva: number;
  deudaTarjetaPauta: number;
  entregadosSinLiquidar: number;
  inventarioCosto: number;
  compromisos15dTotal: number;
  compromisos15dCount: number;
  pagosVencidosCount: number;
  gastoDiarioPromedio: number;
  budgetPct: number | null;
  hasBudgets: boolean;
}) {
  const {
    periodMetrics,
    liquidezNeta,
    liquidezPositiva,
    deudaTarjetaPauta,
    entregadosSinLiquidar,
    inventarioCosto,
    compromisos15dTotal,
    compromisos15dCount,
    pagosVencidosCount,
    gastoDiarioPromedio,
    budgetPct,
    hasBudgets,
  } = params;

  // Redistribuir pesos si no hay presupuestos configurados (30/35/35 -> 100)
  const wMargen = hasBudgets ? 30 : 35;
  const wLiquidez = hasBudgets ? 30 : 40;
  const wCalle = hasBudgets ? 20 : 25;
  const wPresupuesto = hasBudgets ? 20 : 0;

  // 1. Pilar Margen operativo
  let margenRatio = 0.5;
  let margenSummary = 'Sin movimientos operativos en el período';
  let margenStatus: 'ok' | 'warn' | 'risk' = 'warn';

  if (periodMetrics.ingresos > 0 || periodMetrics.egresosOperativos > 0) {
    if (periodMetrics.ingresos === 0 && periodMetrics.egresosOperativos > 0) {
      margenRatio = 0.15;
      margenStatus = 'risk';
      margenSummary = 'Solo egresos registrados sin cobros liquidados en el período';
    } else {
      const m = periodMetrics.margenOperativoPct;
      if (m >= 25) {
        margenRatio = 1;
        margenStatus = 'ok';
      } else if (m >= 10) {
        margenRatio = 0.72;
        margenStatus = 'ok';
      } else if (m >= 0) {
        margenRatio = 0.48;
        margenStatus = 'warn';
      } else {
        margenRatio = Math.max(0.05, 0.35 + m / 100);
        margenStatus = 'risk';
      }
      margenSummary = `Margen operativo de ${m.toFixed(1)}% (${periodMetrics.utilidadOperativa >= 0 ? '+' : ''}$${periodMetrics.utilidadOperativa.toFixed(2)})`;
    }
  }
  const margenScore = Math.round(wMargen * margenRatio);

  // 2. Pilar Liquidez y compromisos próximos
  const obligacionesCortoPlazo = compromisos15dTotal + deudaTarjetaPauta;
  const coberturaRatio =
    obligacionesCortoPlazo > 0 ? liquidezPositiva / obligacionesCortoPlazo : liquidezPositiva > 0 ? 3 : 1;
  const runwayDias =
    gastoDiarioPromedio > 0.5 ? Math.max(0, Math.round(liquidezPositiva / gastoDiarioPromedio)) : null;

  let liqFactor = 0.7;
  let liqStatus: 'ok' | 'warn' | 'risk' = 'ok';

  if (liquidezNeta <= 0 && obligacionesCortoPlazo > 0) {
    liqFactor = 0.1;
    liqStatus = 'risk';
  } else if (coberturaRatio < 1 || pagosVencidosCount > 0) {
    liqFactor = 0.32;
    liqStatus = 'risk';
  } else if (coberturaRatio < 1.5 || (runwayDias !== null && runwayDias < 7)) {
    liqFactor = 0.62;
    liqStatus = 'warn';
  } else if (runwayDias !== null && runwayDias < 14) {
    liqFactor = 0.8;
    liqStatus = 'ok';
  } else {
    liqFactor = 1;
    liqStatus = 'ok';
  }

  const liqScore = Math.round(wLiquidez * liqFactor);
  const liqSummaryParts: string[] = [];
  if (runwayDias !== null) liqSummaryParts.push(`${runwayDias}d de oxígeno`);
  if (compromisos15dCount > 0) liqSummaryParts.push(`$${compromisos15dTotal.toFixed(2)} por vencer en 15d`);
  else liqSummaryParts.push('Sin vencimientos próximos en 15d');
  if (deudaTarjetaPauta > 0) liqSummaryParts.push(`Tarjeta Pauta -$${deudaTarjetaPauta.toFixed(2)}`);

  // 3. Pilar Retención en calle (COD)
  const baseEfectivoCalle = Math.max(liquidezPositiva, 0) + entregadosSinLiquidar;
  const pctRetenido = baseEfectivoCalle > 0 ? (entregadosSinLiquidar / baseEfectivoCalle) * 100 : 0;
  let calleFactor = 1;
  let calleStatus: 'ok' | 'warn' | 'risk' = 'ok';

  if (entregadosSinLiquidar <= 0) {
    calleFactor = 1;
    calleStatus = 'ok';
  } else if (pctRetenido >= 55) {
    calleFactor = 0.2;
    calleStatus = 'risk';
  } else if (pctRetenido >= 30) {
    calleFactor = 0.55;
    calleStatus = 'warn';
  } else {
    calleFactor = 0.85;
    calleStatus = 'ok';
  }
  const calleScore = Math.round(wCalle * calleFactor);
  const calleSummary =
    entregadosSinLiquidar > 0
      ? `$${entregadosSinLiquidar.toFixed(2)} entregados sin depositar (${pctRetenido.toFixed(0)}% del efectivo)`
      : 'Todo lo entregado está liquidado en caja';

  // 4. Pilar Presupuestos
  const pillars: HealthPillar[] = [
    {
      id: 'margen',
      label: 'Margen operativo',
      score: margenScore,
      maxScore: wMargen,
      summary: margenSummary,
      status: margenStatus,
    },
    {
      id: 'liquidez',
      label: 'Liquidez y vencimientos',
      score: liqScore,
      maxScore: wLiquidez,
      summary: liqSummaryParts.join(' · '),
      status: liqStatus,
    },
    {
      id: 'calle',
      label: 'Cobro en calle (COD)',
      score: calleScore,
      maxScore: wCalle,
      summary: calleSummary,
      status: calleStatus,
    },
  ];

  let totalScore = margenScore + liqScore + calleScore;

  if (hasBudgets && budgetPct !== null) {
    let budFactor = 1;
    let budStatus: 'ok' | 'warn' | 'risk' = 'ok';
    if (budgetPct > 100) {
      budFactor = 0.2;
      budStatus = 'risk';
    } else if (budgetPct > 85) {
      budFactor = 0.6;
      budStatus = 'warn';
    }
    const budScore = Math.round(wPresupuesto * budFactor);
    totalScore += budScore;
    pillars.push({
      id: 'presupuesto',
      label: 'Control de presupuestos',
      score: budScore,
      maxScore: wPresupuesto,
      summary: `${budgetPct.toFixed(0)}% ejecutado en el mes actual`,
      status: budStatus,
    });
  }

  const clampedScore = Math.max(0, Math.min(100, totalScore));
  const estado: 'Saludable' | 'Atención' | 'Riesgo' =
    clampedScore >= 75 ? 'Saludable' : clampedScore >= 45 ? 'Atención' : 'Riesgo';

  const basePatrimonio = Math.max(liquidezPositiva, 0) + inventarioCosto + entregadosSinLiquidar;
  const pctCapitalAtrapado =
    basePatrimonio > 0 ? ((inventarioCosto + entregadosSinLiquidar) / basePatrimonio) * 100 : 0;

  return {
    score: clampedScore,
    estado,
    runwayDias,
    pctCapitalAtrapado,
    pillars,
  };
}

export function computeFinancialHealth(params: {
  periodMetrics: PeriodFinanceMetrics;
  activeTransactions: MoneyTransaction[];
  businessValue: RealBusinessValueSummary;
  pagosFijos: SimplePagoFijo[];
  monthlyBudgetsTotal: { totalPresupuestado: number; totalGastado: number; pct: number };
  streetSummary: StreetCollectionsSummary;
  now?: Date;
}): FinancialHealthReport {
  const {
    periodMetrics,
    activeTransactions,
    businessValue,
    pagosFijos,
    monthlyBudgetsTotal,
    streetSummary,
    now = new Date(),
  } = params;

  const today = getSvTodayStr(now);
  const plus15 = addDaysToYmd(today, 15);
  const minus30 = addDaysToYmd(today, -29);

  // Compromisos fijos en próximos 15 días + vencidos
  let compromisos15dTotal = 0;
  let compromisos15dCount = 0;
  let pagosVencidosCount = 0;

  pagosFijos.forEach(p => {
    const fecha = (p.fecha_vencimiento || '').slice(0, 10);
    if (!fecha) return;
    if (fecha < today) {
      pagosVencidosCount++;
      compromisos15dTotal += Number(p.monto) || 0;
      compromisos15dCount++;
    } else if (fecha <= plus15) {
      compromisos15dTotal += Number(p.monto) || 0;
      compromisos15dCount++;
    }
  });

  // Promedio diario real de egresos operativos en últimos 30 días (fallback: período activo)
  const last30Txs = filterTransactionsByDateRange(activeTransactions, minus30, today);
  const last30Summary = summarizeRawBucket(last30Txs);
  const gastoDiarioPromedio =
    last30Summary.egresosOperativos > 0
      ? last30Summary.egresosOperativos / 30
      : periodMetrics.egresosOperativos / Math.max(periodMetrics.daysCount, 1);

  const hasBudgets = monthlyBudgetsTotal.totalPresupuestado > 0;
  const core = evaluateCoreHealthScore({
    periodMetrics,
    liquidezNeta: businessValue.liquidezNeta,
    liquidezPositiva: businessValue.liquidezPositiva,
    deudaTarjetaPauta: businessValue.deudaTarjetaPauta,
    entregadosSinLiquidar: businessValue.entregadosSinLiquidar,
    inventarioCosto: businessValue.inventarioCosto,
    compromisos15dTotal,
    compromisos15dCount,
    pagosVencidosCount,
    gastoDiarioPromedio,
    budgetPct: hasBudgets ? monthlyBudgetsTotal.pct : null,
    hasBudgets,
  });

  // Simulador rápido: qué pasa si liquidamos hoy lo entregado en calle
  let simulation: LiquidationSimulation | null = null;
  if (businessValue.entregadosSinLiquidar > 0.5) {
    const simMetrics: PeriodFinanceMetrics = {
      ...periodMetrics,
      ingresos: periodMetrics.ingresos + businessValue.entregadosSinLiquidar,
      utilidadOperativa: periodMetrics.utilidadOperativa + businessValue.entregadosSinLiquidar,
      margenOperativoPct:
        periodMetrics.ingresos + businessValue.entregadosSinLiquidar > 0
          ? ((periodMetrics.utilidadOperativa + businessValue.entregadosSinLiquidar) /
              (periodMetrics.ingresos + businessValue.entregadosSinLiquidar)) *
            100
          : 0,
    };
    const simCore = evaluateCoreHealthScore({
      periodMetrics: simMetrics,
      liquidezNeta: businessValue.liquidezNeta + businessValue.entregadosSinLiquidar,
      liquidezPositiva: businessValue.liquidezPositiva + businessValue.entregadosSinLiquidar,
      deudaTarjetaPauta: businessValue.deudaTarjetaPauta,
      entregadosSinLiquidar: 0,
      inventarioCosto: businessValue.inventarioCosto,
      compromisos15dTotal,
      compromisos15dCount,
      pagosVencidosCount,
      gastoDiarioPromedio,
      budgetPct: hasBudgets ? monthlyBudgetsTotal.pct : null,
      hasBudgets,
    });
    simulation = {
      montoPorLiquidar: businessValue.entregadosSinLiquidar,
      nuevaLiquidezNeta: businessValue.liquidezNeta + businessValue.entregadosSinLiquidar,
      nuevoScore: simCore.score,
      nuevoEstado: simCore.estado,
      mejoraPuntos: simCore.score - core.score,
    };
  }

  // Hallazgos accionables concretos (máximo 3)
  const findings: HealthActionItem[] = [];

  if (periodMetrics.duplicateAdExcessTotal > 1) {
    findings.push({
      id: 'dup_ads',
      severity: 'warn',
      title: `Posibles duplicados de pauta automática (~$${periodMetrics.duplicateAdExcessTotal.toFixed(2)})`,
      detail: `Se detectaron múltiples asientos de pauta en un mismo día/anuncio (${periodMetrics.duplicateAdGroups.length} grupo(s)). Revísalos antes de cerrar mes.`,
      actionType: 'open_ledger_ads',
      actionLabel: 'Revisar en libro diario',
    });
  }

  if (businessValue.entregadosSinLiquidar > 0) {
    findings.push({
      id: 'street_cod',
      severity:
        businessValue.entregadosSinLiquidar > Math.max(businessValue.liquidezPositiva * 0.4, 50)
          ? 'warn'
          : 'info',
      title: `${streetSummary.entregadosCount} pedido(s) entregado(s) sin depositar ($${businessValue.entregadosSinLiquidar.toFixed(2)})`,
      detail: 'Dinero ya cobrado al cliente que aún no ingresa a tu caja o banco.',
      actionType: 'liquidate_street',
      actionLabel: 'Liquidar entregas',
    });
  }

  if (pagosVencidosCount > 0 || compromisos15dTotal > businessValue.liquidezPositiva) {
    findings.push({
      id: 'upcoming_bills',
      severity: 'risk',
      title:
        pagosVencidosCount > 0
          ? `${pagosVencidosCount} pago(s) fijo(s) vencido(s) o por cubrir ($${compromisos15dTotal.toFixed(2)})`
          : `Pagos próximos de $${compromisos15dTotal.toFixed(2)} superan tu caja positiva`,
      detail: 'Revisa tus suscripciones y transferencias antes de la fecha de corte.',
      actionType: 'open_planning',
      actionLabel: 'Ver pagos fijos',
    });
  } else if (compromisos15dCount > 0 && findings.length < 3) {
    findings.push({
      id: 'upcoming_bills_ok',
      severity: 'info',
      title: `${compromisos15dCount} pago(s) próximo(s) en los siguientes 15 días ($${compromisos15dTotal.toFixed(2)})`,
      detail: 'Tu liquidez positiva actual cubre estos compromisos sin riesgo.',
      actionType: 'open_planning',
      actionLabel: 'Ver calendario',
    });
  }

  if (businessValue.skusSinCostoCount > 0 && findings.length < 3) {
    findings.push({
      id: 'missing_costs',
      severity: 'warn',
      title: `${businessValue.skusSinCostoCount} producto(s) con stock pero costo en $0.00`,
      detail: 'El valor total real del negocio está subestimando esos productos hasta que registres su costo.',
      actionType: 'go_inventory',
      actionLabel: 'Completar costos',
    });
  }

  return {
    score: core.score,
    estado: core.estado,
    runwayDias: core.runwayDias,
    gastoDiarioPromedio,
    compromisos15dTotal,
    compromisos15dCount,
    pagosVencidosCount,
    pctCapitalAtrapado: core.pctCapitalAtrapado,
    pillars: core.pillars,
    findings: findings.slice(0, 3),
    simulation,
  };
}

export type _UnusedOrderRef = PendingStreetOrder;
