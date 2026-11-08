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
    saldo_actual: 640.0,
    moneda: 'USD',
    activo: true,
    color: '#10b981'
  },
  {
    id: 'banco_principal',
    nombre: 'Banco Agrícola (Cuenta Principal)',
    tipo: 'bank',
    saldo_actual: 2850.5,
    moneda: 'USD',
    activo: true,
    color: '#3b82f6'
  },
  {
    id: 'caja_chica',
    nombre: 'Caja Chica de Oficina',
    tipo: 'cash',
    saldo_actual: 125.0,
    moneda: 'USD',
    activo: true,
    color: '#f59e0b'
  },
  {
    id: 'tarjeta_pauta',
    nombre: 'Tarjeta Débito Meta Ads',
    tipo: 'credit_card',
    saldo_actual: 450.0,
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
    monto_gastado: 450.0,
    notas: 'Presupuesto mensual para campañas de conversión en Meta y TikTok'
  },
  {
    id: `${currentMonth()}-envios`,
    periodo: currentMonth(),
    categoria: 'Envíos y Logística',
    monto_presupuestado: 500.0,
    monto_gastado: 195.0,
    notas: 'Fletes y pagos a mensajeros por entrega de paquetes'
  },
  {
    id: `${currentMonth()}-empaque`,
    periodo: currentMonth(),
    categoria: 'Suministros y Empaque',
    monto_presupuestado: 250.0,
    monto_gastado: 95.0,
    notas: 'Bolsas Kraft, cinta adhesiva y etiquetas térmicas'
  },
  {
    id: `${currentMonth()}-operativo`,
    periodo: currentMonth(),
    categoria: 'Nómina y Operaciones',
    monto_presupuestado: 800.0,
    monto_gastado: 400.0,
    notas: 'Ayudante de empaque y servicios básicos'
  }
];

const DEFAULT_TRANSACTIONS: MoneyTransaction[] = [
  {
    id: 1001,
    account_id: 'caja_efectivo',
    account_nombre: 'Efectivo Repartidores (Contraentrega)',
    tipo: 'income',
    categoria: 'venta_pedido',
    monto: 35.0,
    descripcion: 'Cobro liquidado pedido PED-8831 (Carlos Méndez)',
    fecha: new Date().toISOString().slice(0, 10),
    source_table: 'whatsapp_orders',
    source_id: 'ord-8831',
    es_manual: false
  },
  {
    id: 1002,
    account_id: 'tarjeta_pauta',
    account_nombre: 'Tarjeta Débito Meta Ads',
    tipo: 'expense',
    categoria: 'pauta_publicidad',
    monto: 45.0,
    descripcion: 'Pauta publicitaria diaria Meta Ads (CAMP-EMS-PROMO)',
    fecha: new Date().toISOString().slice(0, 10),
    source_table: 'gastos_publicidad',
    source_id: 'adexp-20261107',
    es_manual: false
  },
  {
    id: 1003,
    account_id: 'caja_chica',
    account_nombre: 'Caja Chica de Oficina',
    tipo: 'expense',
    categoria: 'empaque_suministros',
    monto: 45.0,
    descripcion: 'Compra 500 bolsas Kraft y rollo de cinta de seguridad',
    fecha: new Date().toISOString().slice(0, 10),
    es_manual: true
  },
  {
    id: 1004,
    account_id: 'banco_principal',
    account_nombre: 'Banco Agrícola (Cuenta Principal)',
    tipo: 'income',
    categoria: 'abono_manual',
    monto: 250.0,
    descripcion: 'Abono cliente mayorista tienda San Salvador',
    fecha: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    es_manual: true
  },
  {
    id: 1005,
    account_id: 'caja_efectivo',
    account_nombre: 'Efectivo Repartidores (Contraentrega)',
    tipo: 'expense',
    categoria: 'flete_envio',
    monto: 25.0,
    descripcion: 'Combustible y viático mensajero ruta occidente',
    fecha: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
    es_manual: true
  }
];

let localAccounts = [...DEFAULT_ACCOUNTS];
let localBudgets = [...DEFAULT_BUDGETS];
let localTransactions = [...DEFAULT_TRANSACTIONS];

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
    //    Si era gasto (-), revertir suma (+). Si era ingreso (+), revertir resta (-).
    if (txToDelete) {
      const montoNum = Number(txToDelete.monto) || 0;
      const deltaReversion = txToDelete.tipo === 'income' ? -montoNum : montoNum;

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
