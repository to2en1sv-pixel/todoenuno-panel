import { supabase } from '@/lib/supabase';
import { emitOsEvent } from '@/lib/osEvents';
import type {
  CashAccount,
  MoneyTransaction,
  Budget,
  TransactionType,
} from '@/types/finance';

const DEFAULT_ACCOUNTS: CashAccount[] = [
  {
    id: 'caja_efectivo',
    nombre: 'Efectivo Repartidores (Contraentrega)',
    tipo: 'cash',
    saldo_actual: 0,
    moneda: 'USD',
    activo: true,
    color: '#10b981',
  },
  {
    id: 'banco_principal',
    nombre: 'Banco Agrícola (Cuenta Principal)',
    tipo: 'bank',
    saldo_actual: 0,
    moneda: 'USD',
    activo: true,
    color: '#3b82f6',
  },
  {
    id: 'caja_chica',
    nombre: 'Caja Chica de Oficina',
    tipo: 'cash',
    saldo_actual: 0,
    moneda: 'USD',
    activo: true,
    color: '#f59e0b',
  },
  {
    id: 'tarjeta_pauta',
    nombre: 'Tarjeta Débito Meta Ads',
    tipo: 'credit_card',
    saldo_actual: 0,
    moneda: 'USD',
    activo: true,
    color: '#8b5cf6',
  },
];

const currentMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const DEFAULT_BUDGETS: Budget[] = [
  {
    id: `${currentMonth()}-marketing`,
    periodo: currentMonth(),
    categoria: 'Marketing & Pauta Meta',
    monto_presupuestado: 1200.0,
    monto_gastado: 0,
    notas: 'Presupuesto mensual para campañas de conversión en Meta y TikTok',
  },
  {
    id: `${currentMonth()}-envios`,
    periodo: currentMonth(),
    categoria: 'Envíos y Logística',
    monto_presupuestado: 500.0,
    monto_gastado: 0,
    notas: 'Fletes y pagos a mensajeros por entrega de paquetes',
  },
  {
    id: `${currentMonth()}-empaque`,
    periodo: currentMonth(),
    categoria: 'Suministros y Empaque',
    monto_presupuestado: 250.0,
    monto_gastado: 0,
    notas: 'Bolsas Kraft, cinta adhesiva y etiquetas térmicas',
  },
  {
    id: `${currentMonth()}-operativo`,
    periodo: currentMonth(),
    categoria: 'Nómina y Operaciones',
    monto_presupuestado: 800.0,
    monto_gastado: 0,
    notas: 'Ayudante de empaque y servicios básicos',
  },
];

let localAccounts = [...DEFAULT_ACCOUNTS];
let localBudgets = [...DEFAULT_BUDGETS];
let localTransactions: MoneyTransaction[] = [];

/* ========================================================================== */
/* NORMALIZACIÓN UNIFICADA DE ESTADOS Y COBROS EN CALLE (FUENTE ÚNICA)         */
/* ========================================================================== */

export type NormalizedOrderStatus =
  | 'nuevo'
  | 'programado'
  | 'por_empacar'
  | 'en_camino'
  | 'entregado'
  | 'cancelado';

const CANONICAL_STATUSES = new Set<NormalizedOrderStatus>([
  'nuevo',
  'programado',
  'por_empacar',
  'en_camino',
  'entregado',
  'cancelado',
]);

export const IN_ROUTE_DB_STATUSES = [
  'en_camino',
  'en_ruta',
  'en ruta',
  'despachado',
  'enviado',
  'ruta',
] as const;

export const DELIVERED_DB_STATUSES = [
  'entregado',
  'entregada',
  'completado',
  'completada',
] as const;

export const STREET_COLLECTION_DB_STATUSES = [
  ...IN_ROUTE_DB_STATUSES,
  ...DELIVERED_DB_STATUSES,
] as const;

export function normalizeOrderStatus(rawEstado: string | null | undefined): NormalizedOrderStatus {
  const raw = String(rawEstado || '').trim().toLowerCase();
  if (!raw) return 'nuevo';
  if (CANONICAL_STATUSES.has(raw as NormalizedOrderStatus)) {
    return raw as NormalizedOrderStatus;
  }
  if (
    raw === 'en_ruta' ||
    raw === 'en ruta' ||
    raw === 'despachado' ||
    raw === 'enviado' ||
    raw === 'ruta' ||
    raw === 'en camino'
  ) {
    return 'en_camino';
  }
  if (
    raw === 'empacado' ||
    raw === 'confirmado' ||
    raw === 'en_empaque' ||
    raw === 'por empacar'
  ) {
    return 'por_empacar';
  }
  if (raw === 'entregada' || raw === 'completado' || raw === 'completada') {
    return 'entregado';
  }
  if (raw === 'cancelada' || raw === 'rechazado' || raw === 'devuelto') {
    return 'cancelado';
  }
  if (raw === 'encargo' || raw === 'agendado') {
    return 'programado';
  }
  return 'nuevo';
}

export function isPrepaidOrTransferOrder(order: {
  metodo_pago?: string | null;
  notas?: string | null;
}): boolean {
  const mp = String(order?.metodo_pago || '').toLowerCase();
  const notas = String(order?.notas || '').toLowerCase();
  if (
    mp.includes('transfer') ||
    mp.includes('prepag') ||
    mp.includes('pagado') ||
    mp.includes('tarjeta') ||
    mp.includes('deposito') ||
    mp.includes('depósito') ||
    mp.includes('chivo') ||
    mp.includes('wompi') ||
    mp.includes('link')
  ) {
    return true;
  }
  if (
    notas.includes('cobro: transferencia') ||
    notas.includes('cobro: prepagado') ||
    notas.includes('transferencia bancaria')
  ) {
    return true;
  }
  return false;
}

export interface PendingStreetOrder {
  id: string;
  pedido_codigo?: string | null;
  nombre_cliente?: string | null;
  telefono?: string | null;
  sku?: string | null;
  catalogo_sku?: string | null;
  items?: any;
  total: number | null;
  estado: string | null;
  estadoNormalizado: NormalizedOrderStatus;
  liquidado?: boolean | null;
  liquidado_at?: string | null;
  cuenta_liquidacion?: string | null;
  courier?: string | null;
  metodo_pago?: string | null;
  notas?: string | null;
  created_at?: string | null;
  esTransferenciaOPrepagado: boolean;
}

export interface CourierStreetBreakdown {
  courier: string;
  entregadosCount: number;
  entregadosTotal: number;
  enCaminoCount: number;
  enCaminoTotal: number;
  total: number;
  count: number;
  efectivoTotal: number;
  transferenciaTotal: number;
}

export interface StreetCollectionsSummary {
  entregados: PendingStreetOrder[];
  enCamino: PendingStreetOrder[];
  entregadosTotal: number;
  entregadosCount: number;
  entregadosEfectivoTotal: number;
  entregadosTransferenciaTotal: number;
  enCaminoTotal: number;
  enCaminoCount: number;
  enCaminoEfectivoTotal: number;
  enCaminoTransferenciaTotal: number;
  totalAfuera: number;
  totalCount: number;
  totalEfectivoEnCalle: number;
  totalTransferenciaEnCalle: number;
  courierBreakdown: CourierStreetBreakdown[];
}

/**
 * Obtiene TODOS los pedidos activos en calle o entregados pendientes de liquidar,
 * paginando en lotes para no amputar pedidos antiguos por historial ya liquidado
 * y normalizando variantes de estado.
 */
export async function fetchPendingStreetOrders(): Promise<{
  orders: PendingStreetOrder[];
  error?: string;
}> {
  const PAGE_SIZE = 1000;
  const MAX_PAGES = 6;
  const collected: any[] = [];

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('whatsapp_orders')
        .select(
          'id, pedido_codigo, nombre_cliente, telefono, sku, catalogo_sku, items, total, estado, liquidado, liquidado_at, cuenta_liquidacion, courier, metodo_pago, notas, created_at'
        )
        .or('liquidado.is.null,liquidado.eq.false')
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) {
        return { orders: [], error: error.message };
      }

      const rows = Array.isArray(data) ? data : [];
      collected.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }

    const mapped: PendingStreetOrder[] = [];
    for (const row of collected) {
      if (row.liquidado === true) continue;
      const estadoNormalizado = normalizeOrderStatus(row.estado);
      if (estadoNormalizado !== 'en_camino' && estadoNormalizado !== 'entregado') continue;
      mapped.push({
        ...row,
        estadoNormalizado,
        esTransferenciaOPrepagado: isPrepaidOrTransferOrder(row),
      });
    }

    return { orders: mapped };
  } catch (err: any) {
    return {
      orders: [],
      error: err?.message || 'Error consultando pedidos pendientes en calle',
    };
  }
}

export function computeStreetCollectionsSummary(
  orders: Array<
    Partial<PendingStreetOrder> & {
      id: string;
      total?: number | null;
      estado?: string | null;
      liquidado?: boolean | null;
      courier?: string | null;
      metodo_pago?: string | null;
      notas?: string | null;
    }
  >
): StreetCollectionsSummary {
  const entregados: PendingStreetOrder[] = [];
  const enCamino: PendingStreetOrder[] = [];

  let entregadosTotal = 0;
  let entregadosEfectivoTotal = 0;
  let entregadosTransferenciaTotal = 0;

  let enCaminoTotal = 0;
  let enCaminoEfectivoTotal = 0;
  let enCaminoTransferenciaTotal = 0;

  const byCourierMap = new Map<string, CourierStreetBreakdown>();

  for (const raw of orders) {
    if (raw.liquidado === true) continue;
    const st = raw.estadoNormalizado || normalizeOrderStatus(raw.estado);
    if (st !== 'entregado' && st !== 'en_camino') continue;

    const esTransf =
      typeof raw.esTransferenciaOPrepagado === 'boolean'
        ? raw.esTransferenciaOPrepagado
        : isPrepaidOrTransferOrder(raw);
    const monto = Number(raw.total || 0);
    const courierName = String(raw.courier || '').trim() || 'Sin asignar';

    const enriched: PendingStreetOrder = {
      ...(raw as any),
      total: monto,
      estadoNormalizado: st,
      esTransferenciaOPrepagado: esTransf,
    };

    const prev = byCourierMap.get(courierName) || {
      courier: courierName,
      entregadosCount: 0,
      entregadosTotal: 0,
      enCaminoCount: 0,
      enCaminoTotal: 0,
      total: 0,
      count: 0,
      efectivoTotal: 0,
      transferenciaTotal: 0,
    };

    prev.total += monto;
    prev.count += 1;
    if (esTransf) prev.transferenciaTotal += monto;
    else prev.efectivoTotal += monto;

    if (st === 'entregado') {
      entregados.push(enriched);
      entregadosTotal += monto;
      if (esTransf) entregadosTransferenciaTotal += monto;
      else entregadosEfectivoTotal += monto;

      prev.entregadosCount += 1;
      prev.entregadosTotal += monto;
    } else {
      enCamino.push(enriched);
      enCaminoTotal += monto;
      if (esTransf) enCaminoTransferenciaTotal += monto;
      else enCaminoEfectivoTotal += monto;

      prev.enCaminoCount += 1;
      prev.enCaminoTotal += monto;
    }

    byCourierMap.set(courierName, prev);
  }

  const courierBreakdown = Array.from(byCourierMap.values()).sort((a, b) => b.total - a.total);

  return {
    entregados,
    enCamino,
    entregadosTotal,
    entregadosCount: entregados.length,
    entregadosEfectivoTotal,
    entregadosTransferenciaTotal,
    enCaminoTotal,
    enCaminoCount: enCamino.length,
    enCaminoEfectivoTotal,
    enCaminoTransferenciaTotal,
    totalAfuera: entregadosTotal + enCaminoTotal,
    totalCount: entregados.length + enCamino.length,
    totalEfectivoEnCalle: entregadosEfectivoTotal + enCaminoEfectivoTotal,
    totalTransferenciaEnCalle: entregadosTransferenciaTotal + enCaminoTransferenciaTotal,
    courierBreakdown,
  };
}

/* ========================================================================== */
/* CUENTAS, PRESUPUESTOS Y LIBRO DIARIO                                       */
/* ========================================================================== */

/**
 * Obtener Cuentas de Dinero
 */
export async function fetchCashAccounts(): Promise<{ accounts: CashAccount[]; isRealDb: boolean }> {
  try {
    const res = await supabase.from('finance_cash_accounts').select('*').order('nombre');
    if (!res.error && res.data) {
      localAccounts = res.data as CashAccount[];
      return { accounts: res.data as CashAccount[], isRealDb: true };
    }

    const schemaRes = await (supabase as any)
      .schema('finance')
      .from('cash_accounts')
      .select('*')
      .order('nombre');
    if (!schemaRes.error && schemaRes.data) {
      localAccounts = schemaRes.data as CashAccount[];
      return { accounts: schemaRes.data as CashAccount[], isRealDb: true };
    }
  } catch {
    // fallback local
  }
  return { accounts: localAccounts, isRealDb: false };
}

/**
 * Helper interno para actualizar saldo en DB con respaldo si RPC falla
 */
async function applyBalanceDeltaInDb(accountId: string, delta: number, freshAccounts: CashAccount[]) {
  try {
    const rpcRes = await (supabase as any).rpc('update_account_balance', {
      p_account_id: accountId,
      p_delta: delta,
    });
    if (!rpcRes?.error) return;
  } catch {
    // fallback directo
  }

  const target = freshAccounts.find(a => a.id === accountId);
  const currentSaldo = Number(target?.saldo_actual ?? 0);
  const nextSaldo = Math.round((currentSaldo + delta) * 100) / 100;

  const upd = await supabase
    .from('finance_cash_accounts')
    .update({ saldo_actual: nextSaldo })
    .eq('id', accountId);

  if (upd.error) {
    await (supabase as any)
      .schema('finance')
      .from('cash_accounts')
      .update({ saldo_actual: nextSaldo })
      .eq('id', accountId);
  }
}

/**
 * Obtener Presupuestos del mes
 */
export async function fetchBudgets(periodo = currentMonth()): Promise<{ budgets: Budget[]; isRealDb: boolean }> {
  try {
    const res = await supabase.from('finance_budgets').select('*').eq('periodo', periodo);
    if (!res.error && res.data) {
      return { budgets: res.data as Budget[], isRealDb: true };
    }

    const schemaRes = await (supabase as any).schema('finance').from('budgets').select('*').eq('periodo', periodo);
    if (!schemaRes.error && schemaRes.data) {
      return { budgets: schemaRes.data as Budget[], isRealDb: true };
    }
  } catch {
    // fallback
  }
  return { budgets: localBudgets.filter(b => b.periodo === periodo), isRealDb: false };
}

/**
 * Obtener Transacciones del libro diario (paginando para no topar en 1,000)
 */
export async function fetchMoneyTransactions(
  limit = 5000
): Promise<{ transactions: MoneyTransaction[]; isRealDb: boolean }> {
  const PAGE_SIZE = 1000;
  try {
    const allPublic: MoneyTransaction[] = [];
    let publicFailed = false;

    for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
      const batchEnd = Math.min(offset + PAGE_SIZE - 1, limit - 1);
      const res = await supabase
        .from('finance_money_transactions')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, batchEnd);

      if (res.error) {
        publicFailed = true;
        break;
      }
      const rows = (res.data || []) as MoneyTransaction[];
      allPublic.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }

    if (!publicFailed) {
      localTransactions = allPublic;
      return { transactions: allPublic, isRealDb: true };
    }

    const allSchema: MoneyTransaction[] = [];
    for (let offset = 0; offset < limit; offset += PAGE_SIZE) {
      const batchEnd = Math.min(offset + PAGE_SIZE - 1, limit - 1);
      const schemaRes = await (supabase as any)
        .schema('finance')
        .from('money_transactions')
        .select('*')
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false })
        .range(offset, batchEnd);

      if (schemaRes.error) break;
      const rows = (schemaRes.data || []) as MoneyTransaction[];
      allSchema.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }

    if (allSchema.length > 0) {
      localTransactions = allSchema;
      return { transactions: allSchema, isRealDb: true };
    }
  } catch {
    // fallback
  }
  return { transactions: localTransactions.slice(0, limit), isRealDb: false };
}

/**
 * Ajustar saldo de una cuenta manualmente (con asiento opcional de conciliación)
 */
export async function updateCashAccountBalance(
  id: string,
  nuevoSaldo: number,
  options?: { recordAdjustmentTx?: boolean; motivo?: string }
): Promise<boolean> {
  const { accounts: freshAccounts, isRealDb } = await fetchCashAccounts();
  const targetAcc = freshAccounts.find(a => a.id === id);
  const previousSaldo = Number(targetAcc?.saldo_actual ?? 0);
  const cleanNuevoSaldo = Math.round((Number(nuevoSaldo) || 0) * 100) / 100;
  const delta = Math.round((cleanNuevoSaldo - previousSaldo) * 100) / 100;

  try {
    const upd1 = await supabase
      .from('finance_cash_accounts')
      .update({ saldo_actual: cleanNuevoSaldo })
      .eq('id', id);

    if (upd1.error) {
      await (supabase as any)
        .schema('finance')
        .from('cash_accounts')
        .update({ saldo_actual: cleanNuevoSaldo })
        .eq('id', id);
    }

    if (options?.recordAdjustmentTx !== false && Math.abs(delta) >= 0.01 && isRealDb) {
      const tipo: TransactionType = delta > 0 ? 'income' : 'expense';
      const today = new Date().toISOString().slice(0, 10);
      const motivo = options?.motivo?.trim();
      const desc = motivo
        ? `Conciliación ${targetAcc?.nombre || id}: ${motivo}`
        : `Ajuste de saldo (${targetAcc?.nombre || id}: ${previousSaldo.toFixed(2)} → ${cleanNuevoSaldo.toFixed(2)})`;

      const ins = await supabase
        .from('finance_money_transactions')
        .insert({
          account_id: id,
          tipo,
          categoria: 'ajuste_saldo',
          monto: Math.abs(delta),
          descripcion: desc,
          fecha: today,
          es_manual: true,
        })
        .select()
        .single();

      if (!ins.error && ins.data) {
        try {
          await emitOsEvent({
            type: delta > 0 ? 'finance.income.created' : 'finance.expense.created',
            source_table: 'finance_money_transactions',
            source_id: String(ins.data.id),
            payload: {
              transaction_id: ins.data.id,
              account_id: id,
              categoria: 'ajuste_saldo',
              monto: Math.abs(delta),
              saldo_anterior: previousSaldo,
              saldo_nuevo: cleanNuevoSaldo,
            },
          });
        } catch {}
      }
    }
  } catch {
    // fallback
  }

  localAccounts = localAccounts.map(a =>
    a.id === id ? { ...a, saldo_actual: cleanNuevoSaldo } : a
  );
  return true;
}

/**
 * Registrar un Ingreso o Gasto Manual (o liquidación vinculada a pedido)
 */
export async function addManualTransaction(params: {
  account_id: string;
  tipo: TransactionType;
  categoria: string;
  monto: number;
  descripcion: string;
  fecha: string;
  codigo_anuncio?: string;
  comprobante_url?: string;
  source_table?: string;
  source_id?: string;
}): Promise<{ success: boolean; transaction: MoneyTransaction; isRealDb: boolean }> {
  const { accounts: freshAccounts } = await fetchCashAccounts();
  const account = freshAccounts.find(a => a.id === params.account_id) || freshAccounts[0];

  const newTx: MoneyTransaction = {
    id: Date.now(),
    account_id: params.account_id,
    account_nombre: account?.nombre,
    tipo: params.tipo,
    categoria: params.categoria,
    monto: Math.abs(params.monto),
    descripcion: params.descripcion.trim(),
    fecha: params.fecha,
    source_table: params.source_table || null,
    source_id: params.source_id || null,
    comprobante_url: params.comprobante_url || null,
    es_manual: true,
    created_at: new Date().toISOString(),
  };

  let isRealDb = false;

  try {
    const insertPayload: Record<string, any> = {
      account_id: newTx.account_id,
      tipo: newTx.tipo,
      categoria: newTx.categoria,
      monto: newTx.monto,
      descripcion: newTx.descripcion,
      fecha: newTx.fecha,
      es_manual: true,
    };
    if (params.source_table) insertPayload.source_table = params.source_table;
    if (params.source_id) insertPayload.source_id = params.source_id;

    let res = await supabase
      .from('finance_money_transactions')
      .insert(insertPayload)
      .select()
      .single();

    if (res.error) {
      res = await (supabase as any)
        .schema('finance')
        .from('money_transactions')
        .insert(insertPayload)
        .select()
        .single();
    }

    if (!res.error && res.data) {
      newTx.id = res.data.id;
      isRealDb = true;

      const delta = newTx.tipo === 'income' ? newTx.monto : -newTx.monto;
      await applyBalanceDeltaInDb(newTx.account_id, delta, freshAccounts);
    }
  } catch {
    // local fallback
  }

  localTransactions = [newTx, ...localTransactions];
  localAccounts = freshAccounts.map(acc => {
    if (acc.id === params.account_id) {
      const nuevoSaldo = acc.saldo_actual + (params.tipo === 'income' ? newTx.monto : -newTx.monto);
      return { ...acc, saldo_actual: nuevoSaldo };
    }
    return acc;
  });

  if (params.tipo === 'expense') {
    localBudgets = localBudgets.map(b => {
      if (b.categoria.toLowerCase().includes(params.categoria.toLowerCase()) || params.categoria === 'pauta_publicidad') {
        return { ...b, monto_gastado: (b.monto_gastado || 0) + newTx.monto };
      }
      return b;
    });
  }

  try {
    await emitOsEvent({
      type: params.tipo === 'income' ? 'finance.income.created' : 'finance.expense.created',
      source_table: params.source_table || 'manual_transactions',
      source_id: params.source_id || String(newTx.id),
      payload: {
        transaction_id: newTx.id,
        account_id: newTx.account_id,
        categoria: newTx.categoria,
        monto: newTx.monto,
        descripcion: newTx.descripcion,
        fecha: newTx.fecha,
        es_manual: true,
      },
    });
  } catch {
    // ignorar
  }

  return { success: true, transaction: newTx, isRealDb };
}

/**
 * Liquidación unificada e idempotente de un pedido (usada desde Pedidos y Finanzas).
 */
export async function liquidateOrderInFinances(params: {
  order: {
    id: string;
    pedido_codigo?: string | null;
    nombre_cliente?: string | null;
    total?: number | null;
    estado?: string | null;
    liquidado?: boolean | null;
  };
  accountId: string;
  onSyncInventory?: (prevEstado: NormalizedOrderStatus) => Promise<void>;
}): Promise<{ success: boolean; alreadyLiquidated?: boolean; error?: string }> {
  const { order, accountId, onSyncInventory } = params;
  if (!order?.id) return { success: false, error: 'Pedido inválido' };

  try {
    // Verificar estado real en DB para evitar doble cobro
    const { data: freshOrder, error: readErr } = await supabase
      .from('whatsapp_orders')
      .select('id, pedido_codigo, nombre_cliente, total, estado, liquidado')
      .eq('id', order.id)
      .maybeSingle();

    if (readErr) {
      return { success: false, error: readErr.message };
    }
    if (freshOrder?.liquidado === true) {
      return { success: true, alreadyLiquidated: true };
    }

    const prevEstado = normalizeOrderStatus(freshOrder?.estado ?? order.estado);
    const monto = Number(freshOrder?.total ?? order.total ?? 0);
    const codigo =
      freshOrder?.pedido_codigo ||
      order.pedido_codigo ||
      `#${order.id.slice(0, 8).toUpperCase()}`;
    const cliente = freshOrder?.nombre_cliente || order.nombre_cliente || 'Cliente';

    const { error: updErr } = await supabase
      .from('whatsapp_orders')
      .update({
        liquidado: true,
        liquidado_at: new Date().toISOString(),
        cuenta_liquidacion: accountId,
        estado: 'entregado',
      })
      .eq('id', order.id);

    if (updErr) {
      return { success: false, error: updErr.message };
    }

    if (monto > 0) {
      await addManualTransaction({
        account_id: accountId,
        tipo: 'income',
        categoria: 'venta_contraentrega',
        monto,
        descripcion: `Liquidación pedido ${codigo} (${cliente})`,
        fecha: new Date().toISOString().slice(0, 10),
        source_table: 'whatsapp_orders',
        source_id: order.id,
      });
    }

    if (prevEstado !== 'entregado' && onSyncInventory) {
      await onSyncInventory(prevEstado);
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Error al liquidar el pedido',
    };
  }
}

/**
 * Registrar una Transferencia Interna entre Billeteras / Cuentas
 */
export async function addAccountTransfer(params: {
  origen_id: string;
  destino_id: string;
  monto: number;
  fecha: string;
  descripcion?: string;
}): Promise<{
  success: boolean;
  origenTx?: MoneyTransaction;
  destinoTx?: MoneyTransaction;
  isRealDb?: boolean;
  error?: string;
}> {
  if (params.origen_id === params.destino_id) {
    return {
      success: false,
      error: 'La cuenta de origen y destino no pueden ser la misma.',
    };
  }

  const monto = Math.abs(Number(params.monto) || 0);
  if (monto <= 0) {
    return {
      success: false,
      error: 'El monto a transferir debe ser mayor a 0.',
    };
  }

  const { accounts: freshAccounts } = await fetchCashAccounts();
  const origenAcc = freshAccounts.find(a => a.id === params.origen_id);
  const destinoAcc = freshAccounts.find(a => a.id === params.destino_id);

  const descBase = params.descripcion?.trim() ? `${params.descripcion.trim()} ` : '';
  const descSalida = `${descBase}⇄ Transferencia hacia ${destinoAcc?.nombre || params.destino_id}`.trim();
  const descEntrada = `${descBase}⇄ Transferencia desde ${origenAcc?.nombre || params.origen_id}`.trim();

  const nowId = Date.now();

  const origenTx: MoneyTransaction = {
    id: nowId,
    account_id: params.origen_id,
    account_nombre: origenAcc?.nombre,
    tipo: 'transfer',
    categoria: 'transferencia_salida',
    monto,
    descripcion: descSalida,
    fecha: params.fecha,
    es_manual: true,
    created_at: new Date().toISOString(),
  };

  const destinoTx: MoneyTransaction = {
    id: nowId + 1,
    account_id: params.destino_id,
    account_nombre: destinoAcc?.nombre,
    tipo: 'transfer',
    categoria: 'transferencia_entrada',
    monto,
    descripcion: descEntrada,
    fecha: params.fecha,
    es_manual: true,
    created_at: new Date().toISOString(),
  };

  let isRealDb = false;

  try {
    const { data: insertedData, error: insertErr } = await supabase
      .from('finance_money_transactions')
      .insert([
        {
          account_id: origenTx.account_id,
          tipo: 'transfer',
          categoria: 'transferencia_salida',
          monto: origenTx.monto,
          descripcion: origenTx.descripcion,
          fecha: origenTx.fecha,
          es_manual: true,
        },
        {
          account_id: destinoTx.account_id,
          tipo: 'transfer',
          categoria: 'transferencia_entrada',
          monto: destinoTx.monto,
          descripcion: destinoTx.descripcion,
          fecha: destinoTx.fecha,
          es_manual: true,
        },
      ])
      .select();

    if (!insertErr && insertedData && insertedData.length >= 2) {
      origenTx.id = insertedData[0].id;
      destinoTx.id = insertedData[1].id;
      isRealDb = true;

      await Promise.all([
        applyBalanceDeltaInDb(origenTx.account_id, -monto, freshAccounts),
        applyBalanceDeltaInDb(destinoTx.account_id, monto, freshAccounts),
      ]);
    }
  } catch {
    // fallback local
  }

  localTransactions = [destinoTx, origenTx, ...localTransactions];
  localAccounts = freshAccounts.map(acc => {
    if (acc.id === params.origen_id) {
      return { ...acc, saldo_actual: acc.saldo_actual - monto };
    }
    if (acc.id === params.destino_id) {
      return { ...acc, saldo_actual: acc.saldo_actual + monto };
    }
    return acc;
  });

  try {
    await emitOsEvent({
      type: 'finance.transfer.created',
      source_table: 'finance_money_transactions',
      source_id: `${origenTx.id}->${destinoTx.id}`,
      payload: {
        origen_id: params.origen_id,
        destino_id: params.destino_id,
        monto,
        fecha: params.fecha,
        descripcion: params.descripcion || '',
      },
    });
  } catch {}

  return { success: true, origenTx, destinoTx, isRealDb };
}

/**
 * Guardar o actualizar presupuesto
 */
export async function saveBudget(budget: Omit<Budget, 'id'> & { id?: string }): Promise<boolean> {
  const budgetId = budget.id || `${budget.periodo}-${budget.categoria.toLowerCase().replace(/\s+/g, '-')}`;
  const fullBudget: Budget = {
    ...budget,
    id: budgetId,
    monto_gastado: budget.monto_gastado || 0,
  };

  try {
    await supabase.from('finance_budgets').upsert(fullBudget);
  } catch {
    // fallback
  }

  const existingIdx = localBudgets.findIndex(b => b.id === budgetId);
  if (existingIdx >= 0) {
    localBudgets[existingIdx] = fullBudget;
  } else {
    localBudgets.push(fullBudget);
  }

  return true;
}

/**
 * Eliminar una transacción y revertir el saldo de la cuenta afectada
 */
export async function deleteMoneyTransaction(id: number | string): Promise<{ success: boolean; error?: string }> {
  try {
    let txToDelete: MoneyTransaction | undefined = localTransactions.find(t => String(t.id) === String(id));

    try {
      const { data } = await supabase
        .from('finance_money_transactions')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (data) {
        txToDelete = data as MoneyTransaction;
      }
    } catch {
      // continuar con txToDelete local
    }

    try {
      await supabase.from('finance_money_transactions').delete().eq('id', id);
    } catch {
      // continuar
    }

    if (txToDelete) {
      const { accounts: freshAccounts } = await fetchCashAccounts();
      const montoNum = Number(txToDelete.monto) || 0;
      const esEntrada = txToDelete.tipo === 'income' || txToDelete.categoria === 'transferencia_entrada';
      const deltaReversion = esEntrada ? -montoNum : montoNum;

      await applyBalanceDeltaInDb(txToDelete.account_id, deltaReversion, freshAccounts);

      localAccounts = freshAccounts.map(acc => {
        if (acc.id === txToDelete!.account_id) {
          return { ...acc, saldo_actual: acc.saldo_actual + deltaReversion };
        }
        return acc;
      });

      if (txToDelete.source_table === 'gastos_publicidad' && txToDelete.source_id) {
        try {
          await supabase.from('gastos_publicidad').delete().eq('id', txToDelete.source_id);
        } catch {
          // continuar
        }
      }
    }

    localTransactions = localTransactions.filter(t => String(t.id) !== String(id));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error al eliminar transacción' };
  }
}

/* ========================================================================== */
/* CORTE LIMPIO DEL LIBRO DIARIO Y ARCHIVO LEGACY EXPLÍCITO                   */
/* ========================================================================== */

const FINANCE_CUTOFF_KEY = 'todoenuno_finance_cutoff_v1';

export function getFinanceCutoffDate(): string | null {
  try {
    return localStorage.getItem(FINANCE_CUTOFF_KEY) || null;
  } catch {
    return null;
  }
}

export function setFinanceCutoffDate(iso: string | null): void {
  try {
    if (iso) localStorage.setItem(FINANCE_CUTOFF_KEY, iso);
    else localStorage.removeItem(FINANCE_CUTOFF_KEY);
  } catch {
    // ignorar
  }
}

/**
 * Sincroniza siempre con la base de datos (os_events) para que todos los
 * navegadores/dispositivos compartan el mismo estado de corte financiero.
 */
export async function hydrateFinanceCutoffFromOsEvents(supabaseClient: any = supabase): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient
      .from('os_events')
      .select('type,payload,occurred_at')
      .in('type', ['system.finance_reset', 'system.finance_cutoff_cleared'])
      .order('occurred_at', { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data.length > 0) {
      const latest = data[0];
      if (latest.type === 'system.finance_cutoff_cleared') {
        setFinanceCutoffDate(null);
        return null;
      }
      if (latest.type === 'system.finance_reset') {
        const cutoff = latest.payload?.finance_cutoff || null;
        if (cutoff) {
          setFinanceCutoffDate(cutoff);
          return cutoff;
        }
        setFinanceCutoffDate(null);
        return null;
      }
    }
  } catch {
    // os_events opcional
  }
  return getFinanceCutoffDate();
}

export function isRecordBeforeFinanceCutoff(
  createdAt: string | null | undefined,
  fallbackDate?: string | null | undefined,
  cutoffIso?: string | null
): boolean {
  const cutoff = cutoffIso !== undefined ? cutoffIso : getFinanceCutoffDate();
  if (!cutoff) return false;
  const cutoffMs = new Date(cutoff).getTime();
  if (!Number.isFinite(cutoffMs)) return false;

  if (createdAt) {
    const createdMs = new Date(createdAt).getTime();
    if (Number.isFinite(createdMs)) return createdMs <= cutoffMs;
  }

  if (fallbackDate) {
    const cutoffDay = cutoff.slice(0, 10);
    return fallbackDate.slice(0, 10) < cutoffDay;
  }

  return false;
}

export async function resetFinancesFromNow(options: {
  wipeTransactions?: boolean;
  resetBalancesToZero?: boolean;
  setOrdersCutoff?: boolean;
} = {}): Promise<{ success: boolean; cutoffIso: string; warning?: string }> {
  const {
    wipeTransactions = true,
    resetBalancesToZero = true,
    setOrdersCutoff = true,
  } = options;

  const nowIso = new Date().toISOString();
  const warnings: string[] = [];

  if (wipeTransactions) {
    localTransactions = [];
    try {
      const res1 = await supabase.from('finance_money_transactions').delete().gte('id', 0);
      if (res1.error) {
        const res2 = await (supabase as any).schema('finance').from('money_transactions').delete().gte('id', 0);
        if (res2.error) warnings.push(res2.error.message);
      }
    } catch (err: any) {
      warnings.push(err?.message || 'No se pudieron borrar movimientos en DB');
    }
  }

  if (resetBalancesToZero) {
    localAccounts = localAccounts.map(acc => ({ ...acc, saldo_actual: 0 }));
    localBudgets = localBudgets.map(b => ({ ...b, monto_gastado: 0 }));
    try {
      const res1 = await supabase.from('finance_cash_accounts').update({ saldo_actual: 0 }).neq('id', '');
      if (res1.error) {
        const res2 = await (supabase as any).schema('finance').from('cash_accounts').update({ saldo_actual: 0 }).neq('id', '');
        if (res2.error) warnings.push(res2.error.message);
      }
    } catch (err: any) {
      warnings.push(err?.message || 'No se pudieron poner las cuentas en $0.00 en DB');
    }
  }

  if (setOrdersCutoff) {
    setFinanceCutoffDate(nowIso);
  }

  try {
    await emitOsEvent({
      type: 'system.finance_reset',
      source_table: 'finance_money_transactions',
      source_id: nowIso,
      payload: {
        finance_cutoff: setOrdersCutoff ? nowIso : null,
        wiped_transactions: wipeTransactions,
        reset_balances: resetBalancesToZero,
      },
    });
  } catch {
    // os_events opcional
  }

  return {
    success: true,
    cutoffIso: nowIso,
    warning: warnings.length > 0 ? warnings.join(' · ') : undefined,
  };
}

export async function clearFinanceCutoff(): Promise<void> {
  setFinanceCutoffDate(null);
  try {
    await emitOsEvent({
      type: 'system.finance_cutoff_cleared',
      source_table: 'finance_money_transactions',
      source_id: new Date().toISOString(),
      payload: {},
    });
  } catch {
    // os_events opcional
  }
}

/**
 * Cierra únicamente los pedidos ya marcados como `entregado` (o variantes equivalentes)
 * que quedaron sin liquidar (legacy) para que no aparezcan como "por liquidar",
 * SIN modificar saldos de cuentas ni borrar movimientos financieros.
 */
export async function clearLegacyDeliveredPending(): Promise<{
  success: boolean;
  clearedCount: number;
  clearedTotal: number;
  error?: string;
}> {
  const nowIso = new Date().toISOString();
  try {
    const { orders: pendingOrders, error: fetchErr } = await fetchPendingStreetOrders();
    if (fetchErr) {
      return { success: false, clearedCount: 0, clearedTotal: 0, error: fetchErr };
    }

    const deliveredRows = pendingOrders.filter(o => o.estadoNormalizado === 'entregado');
    if (deliveredRows.length === 0) {
      return { success: true, clearedCount: 0, clearedTotal: 0 };
    }

    const ids = deliveredRows.map(r => r.id);
    const clearedTotal = deliveredRows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);

    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      const { error: updErr } = await supabase
        .from('whatsapp_orders')
        .update({
          liquidado: true,
          liquidado_at: nowIso,
          cuenta_liquidacion: 'corte_legacy',
        })
        .in('id', chunk);

      if (updErr) {
        return { success: false, clearedCount: 0, clearedTotal: 0, error: updErr.message };
      }
    }

    try {
      await emitOsEvent({
        type: 'system.finance_delivered_legacy_cleared',
        source_table: 'whatsapp_orders',
        source_id: nowIso,
        payload: {
          cleared_count: deliveredRows.length,
          cleared_total: clearedTotal,
        },
      });
    } catch {
      // os_events opcional
    }

    return { success: true, clearedCount: deliveredRows.length, clearedTotal };
  } catch (err: any) {
    return {
      success: false,
      clearedCount: 0,
      clearedTotal: 0,
      error: err?.message || 'Error limpiando pedidos entregados legacy',
    };
  }
}
