import { supabase } from '@/lib/supabase';
import { emitOsEvent } from '@/lib/osEvents';
import type { 
  CashAccount, 
  MoneyTransaction, 
  Budget, 
  DailyMetric,
  TransactionType 
} from '@/types/finance';

const DEFAULT_ACCOUNTS: CashAccount[] = [
  {
    id: 'caja_efectivo',
    nombre: 'Efectivo Repartidores (Contraentrega)',
    tipo: 'cash',
    saldo_actual: 0,
    moneda: 'USD',
    activo: true,
    color: '#10b981'
  },
  {
    id: 'banco_principal',
    nombre: 'Banco Agrícola (Cuenta Principal)',
    tipo: 'bank',
    saldo_actual: 0,
    moneda: 'USD',
    activo: true,
    color: '#3b82f6'
  },
  {
    id: 'caja_chica',
    nombre: 'Caja Chica de Oficina',
    tipo: 'cash',
    saldo_actual: 0,
    moneda: 'USD',
    activo: true,
    color: '#f59e0b'
  },
  {
    id: 'tarjeta_pauta',
    nombre: 'Tarjeta Débito Meta Ads',
    tipo: 'credit_card',
    saldo_actual: 0,
    moneda: 'USD',
    activo: true,
    color: '#8b5cf6'
  }
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
    notas: 'Presupuesto mensual para campañas de conversión en Meta y TikTok'
  },
  {
    id: `${currentMonth()}-envios`,
    periodo: currentMonth(),
    categoria: 'Envíos y Logística',
    monto_presupuestado: 500.0,
    monto_gastado: 0,
    notas: 'Fletes y pagos a mensajeros por entrega de paquetes'
  },
  {
    id: `${currentMonth()}-empaque`,
    periodo: currentMonth(),
    categoria: 'Suministros y Empaque',
    monto_presupuestado: 250.0,
    monto_gastado: 0,
    notas: 'Bolsas Kraft, cinta adhesiva y etiquetas térmicas'
  },
  {
    id: `${currentMonth()}-operativo`,
    periodo: currentMonth(),
    categoria: 'Nómina y Operaciones',
    monto_presupuestado: 800.0,
    monto_gastado: 0,
    notas: 'Ayudante de empaque y servicios básicos'
  }
];

const DEFAULT_TRANSACTIONS: MoneyTransaction[] = [];

let localAccounts = [...DEFAULT_ACCOUNTS];
let localBudgets = [...DEFAULT_BUDGETS];
let localTransactions: MoneyTransaction[] = [...DEFAULT_TRANSACTIONS];

/**
 * Obtener Cuentas de Dinero
 */
export async function fetchCashAccounts(): Promise<{ accounts: CashAccount[]; isRealDb: boolean }> {
  try {
    const res = await supabase.from('finance_cash_accounts').select('*').order('nombre');
    if (!res.error && res.data) {
      return { accounts: res.data as CashAccount[], isRealDb: true };
    }

    const schemaRes = await (supabase as any).schema('finance').from('cash_accounts').select('*').order('nombre');
    if (!schemaRes.error && schemaRes.data) {
      return { accounts: schemaRes.data as CashAccount[], isRealDb: true };
    }
  } catch {
    // fallback local
  }
  return { accounts: localAccounts, isRealDb: false };
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
 * Obtener Transacciones del libro diario
 */
export async function fetchMoneyTransactions(limit = 100): Promise<{ transactions: MoneyTransaction[]; isRealDb: boolean }> {
  try {
    const res = await supabase
      .from('finance_money_transactions')
      .select('*')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!res.error && res.data) {
      return { transactions: res.data as MoneyTransaction[], isRealDb: true };
    }

    const schemaRes = await (supabase as any)
      .schema('finance')
      .from('money_transactions')
      .select('*')
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (!schemaRes.error && schemaRes.data) {
      return { transactions: schemaRes.data as MoneyTransaction[], isRealDb: true };
    }
  } catch {
    // fallback
  }
  return { transactions: localTransactions.slice(0, limit), isRealDb: false };
}

/**
 * Ajustar saldo de una cuenta manualmente
 */
export async function updateCashAccountBalance(id: string, nuevoSaldo: number): Promise<boolean> {
  try {
    await supabase.from('finance_cash_accounts').update({ saldo_actual: nuevoSaldo }).eq('id', id);
  } catch {
    // fallback
  }
  localAccounts = localAccounts.map(a => a.id === id ? { ...a, saldo_actual: nuevoSaldo } : a);
  return true;
}

/**
 * Registrar un Gasto o Pago Manual
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
}): Promise<{ success: boolean; transaction: MoneyTransaction; isRealDb: boolean }> {
  const account = localAccounts.find(a => a.id === params.account_id) || localAccounts[0];
  
  const newTx: MoneyTransaction = {
    id: Date.now(),
    account_id: params.account_id,
    account_nombre: account?.nombre,
    tipo: params.tipo,
    categoria: params.categoria,
    monto: Math.abs(params.monto),
    descripcion: params.descripcion.trim(),
    fecha: params.fecha,
    comprobante_url: params.comprobante_url || null,
    es_manual: true,
    created_at: new Date().toISOString()
  };

  let isRealDb = false;

  // Intentar guardar en Supabase
  try {
    const res = await supabase
      .from('finance_money_transactions')
      .insert({
        account_id: newTx.account_id,
        tipo: newTx.tipo,
        categoria: newTx.categoria,
        monto: newTx.monto,
        descripcion: newTx.descripcion,
        fecha: newTx.fecha,
        es_manual: true
      })
      .select()
      .single();

    if (!res.error && res.data) {
      newTx.id = res.data.id;
      isRealDb = true;

      // Actualizar saldo en cuenta en Supabase
      const delta = newTx.tipo === 'income' ? newTx.monto : -newTx.monto;
      await (supabase as any).rpc('update_account_balance', {
        p_account_id: newTx.account_id,
        p_delta: delta
      });
    }
  } catch {
    // local fallback
  }

  // Actualizar store en memoria
  localTransactions = [newTx, ...localTransactions];

  // Actualizar saldo de la cuenta local
  localAccounts = localAccounts.map(acc => {
    if (acc.id === params.account_id) {
      const nuevoSaldo = acc.saldo_actual + (params.tipo === 'income' ? newTx.monto : -newTx.monto);
      return { ...acc, saldo_actual: nuevoSaldo };
    }
    return acc;
  });

  // Si es un gasto, actualizar monto gastado del presupuesto
  if (params.tipo === 'expense') {
    localBudgets = localBudgets.map(b => {
      if (b.categoria.toLowerCase().includes(params.categoria.toLowerCase()) || params.categoria === 'pauta_publicidad') {
        return { ...b, monto_gastado: (b.monto_gastado || 0) + newTx.monto };
      }
      return b;
    });
  }

  // Emitir evento al OS Event Store para trazabilidad total
  try {
    await emitOsEvent({
      type: params.tipo === 'income' ? 'finance.income.created' : 'finance.expense.created',
      source_table: 'manual_transactions',
      source_id: String(newTx.id),
      payload: {
        transaction_id: newTx.id,
        account_id: newTx.account_id,
        categoria: newTx.categoria,
        monto: newTx.monto,
        descripcion: newTx.descripcion,
        fecha: newTx.fecha,
        es_manual: true
      }
    });
  } catch {
    // ignorar
  }

  return { success: true, transaction: newTx, isRealDb };
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
      error: 'La cuenta de origen y destino no pueden ser la misma.'
    };
  }

  const monto = Math.abs(Number(params.monto) || 0);
  if (monto <= 0) {
    return {
      success: false,
      error: 'El monto a transferir debe ser mayor a 0.'
    };
  }

  const origenAcc = localAccounts.find(a => a.id === params.origen_id);
  const destinoAcc = localAccounts.find(a => a.id === params.destino_id);

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
    created_at: new Date().toISOString()
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
    created_at: new Date().toISOString()
  };

  let isRealDb = false;

  // 1. Guardar en Supabase si está disponible
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
          es_manual: true
        },
        {
          account_id: destinoTx.account_id,
          tipo: 'transfer',
          categoria: 'transferencia_entrada',
          monto: destinoTx.monto,
          descripcion: destinoTx.descripcion,
          fecha: destinoTx.fecha,
          es_manual: true
        }
      ])
      .select();

    if (!insertErr && insertedData && insertedData.length >= 2) {
      origenTx.id = insertedData[0].id;
      destinoTx.id = insertedData[1].id;
      isRealDb = true;

      // Actualizar saldos en Supabase vía RPC o update directo
      try {
        await Promise.all([
          (supabase as any).rpc('update_account_balance', {
            p_account_id: origenTx.account_id,
            p_delta: -monto
          }),
          (supabase as any).rpc('update_account_balance', {
            p_account_id: destinoTx.account_id,
            p_delta: monto
          })
        ]);
      } catch {
        // Fallback update directo
        await Promise.all([
          supabase.from('finance_cash_accounts').update({ saldo_actual: (origenAcc?.saldo_actual || 0) - monto }).eq('id', origenTx.account_id),
          supabase.from('finance_cash_accounts').update({ saldo_actual: (destinoAcc?.saldo_actual || 0) + monto }).eq('id', destinoTx.account_id)
        ]);
      }
    }
  } catch {
    // fallback local
  }

  // 2. Actualizar memoria local
  localTransactions = [destinoTx, origenTx, ...localTransactions];

  localAccounts = localAccounts.map(acc => {
    if (acc.id === params.origen_id) {
      return { ...acc, saldo_actual: acc.saldo_actual - monto };
    }
    if (acc.id === params.destino_id) {
      return { ...acc, saldo_actual: acc.saldo_actual + monto };
    }
    return acc;
  });

  // 3. Emitir evento OS
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
        descripcion: params.descripcion || ''
      }
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
    monto_gastado: budget.monto_gastado || 0
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
    // 1. Obtener los datos de la transacción antes de eliminarla para conocer el monto y la cuenta
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

    // 2. Eliminar de Supabase
    try {
      await supabase.from('finance_money_transactions').delete().eq('id', id);
    } catch {
      // continuar
    }

    // 3. Revertir saldo de la cuenta:
    //    Si era gasto (-) o transferencia de salida (-), revertir suma (+).
    //    Si era ingreso (+) o transferencia de entrada (+), revertir resta (-).
    if (txToDelete) {
      const montoNum = Number(txToDelete.monto) || 0;
      const esEntrada = txToDelete.tipo === 'income' || txToDelete.categoria === 'transferencia_entrada';
      const deltaReversion = esEntrada ? -montoNum : montoNum;

      try {
        await (supabase as any).rpc('update_account_balance', {
          p_account_id: txToDelete.account_id,
          p_delta: deltaReversion
        });
      } catch {
        // fallback
      }

      // Revertir localmente
      localAccounts = localAccounts.map(acc => {
        if (acc.id === txToDelete!.account_id) {
          return { ...acc, saldo_actual: acc.saldo_actual + deltaReversion };
        }
        return acc;
      });

      // Si estaba enlazada a un gasto de publicidad, opcionalmente limpiar de gastos_publicidad
      if (txToDelete.source_table === 'gastos_publicidad' && txToDelete.source_id) {
        try {
          await supabase.from('gastos_publicidad').delete().eq('id', txToDelete.source_id);
        } catch {
          // continuar
        }
      }
    }

    // 4. Actualizar store en memoria
    localTransactions = localTransactions.filter(t => String(t.id) !== String(id));

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error al eliminar transacción' };
  }
}

/* ========================================================================== */
/* CORTE LIMPIO DESDE AHORA (BORRADO DE LEGACY FINANCIERO)                    */
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

export async function hydrateFinanceCutoffFromOsEvents(supabaseClient: any = supabase): Promise<string | null> {
  const local = getFinanceCutoffDate();
  if (local) return local;

  try {
    const { data, error } = await supabaseClient
      .from('os_events')
      .select('type,payload,occurred_at')
      .in('type', ['system.finance_reset', 'system.finance_cutoff_cleared'])
      .order('occurred_at', { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data.length > 0) {
      const latest = data[0];
      if (latest.type === 'system.finance_reset') {
        const cutoff = latest.payload?.finance_cutoff || latest.occurred_at || null;
        if (cutoff) setFinanceCutoffDate(cutoff);
        return cutoff;
      }
    }
  } catch {
    // os_events opcional
  }
  return local;
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
    setOrdersCutoff = true
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
        reset_balances: resetBalancesToZero
      }
    });
  } catch {
    // os_events opcional
  }

  return {
    success: true,
    cutoffIso: nowIso,
    warning: warnings.length > 0 ? warnings.join(' · ') : undefined
  };
}

export async function clearFinanceCutoff(): Promise<void> {
  setFinanceCutoffDate(null);
  try {
    await emitOsEvent({
      type: 'system.finance_cutoff_cleared',
      source_table: 'finance_money_transactions',
      source_id: new Date().toISOString(),
      payload: {}
    });
  } catch {
    // os_events opcional
  }
}

/**
 * Cierra únicamente los pedidos ya marcados como `entregado` que quedaron
 * sin liquidar (legacy) para que no aparezcan como "por liquidar",
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
    const { data: legacyRows, error: fetchErr } = await supabase
      .from('whatsapp_orders')
      .select('id, total, liquidado')
      .eq('estado', 'entregado')
      .or('liquidado.is.null,liquidado.eq.false');

    if (fetchErr) {
      return { success: false, clearedCount: 0, clearedTotal: 0, error: fetchErr.message };
    }

    const rows = legacyRows || [];
    if (rows.length === 0) {
      return { success: true, clearedCount: 0, clearedTotal: 0 };
    }

    const ids = rows.map((r: any) => r.id);
    const clearedTotal = rows.reduce((sum: number, r: any) => sum + (Number(r.total) || 0), 0);

    // Actualizar en lotes de 80 para evitar límites de longitud en PostgREST
    for (let i = 0; i < ids.length; i += 80) {
      const chunk = ids.slice(i, i + 80);
      const { error: updErr } = await supabase
        .from('whatsapp_orders')
        .update({
          liquidado: true,
          liquidado_at: nowIso,
          cuenta_liquidacion: 'corte_legacy'
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
          cleared_count: rows.length,
          cleared_total: clearedTotal
        }
      });
    } catch {
      // os_events opcional
    }

    return { success: true, clearedCount: rows.length, clearedTotal };
  } catch (err: any) {
    return {
      success: false,
      clearedCount: 0,
      clearedTotal: 0,
      error: err?.message || 'Error limpiando pedidos entregados legacy'
    };
  }
}

