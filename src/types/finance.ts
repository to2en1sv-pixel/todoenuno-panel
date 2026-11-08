export type AccountType = 'cash' | 'bank' | 'wallet' | 'credit_card';

export interface CashAccount {
  id: string;
  nombre: string;
  tipo: AccountType;
  saldo_actual: number;
  moneda: string;
  activo: boolean;
  color?: string;
  created_at?: string;
}

export type TransactionType = 'income' | 'expense' | 'transfer';

export type IncomeCategory = 
  | 'venta_pedido' 
  | 'abono_manual' 
  | 'devolucion_proveedor' 
  | 'otro_ingreso';

export type ExpenseCategory = 
  | 'pauta_publicidad' 
  | 'pago_proveedor' 
  | 'flete_envio' 
  | 'nomina_sueldos' 
  | 'empaque_suministros' 
  | 'suscripciones' 
  | 'alquiler_servicios' 
  | 'comision_pasarela' 
  | 'gasto_manual'
  | 'otro_gasto';

export interface MoneyTransaction {
  id: number | string;
  account_id: string;
  account_nombre?: string;
  tipo: TransactionType;
  categoria: IncomeCategory | ExpenseCategory | string;
  monto: number;
  descripcion: string;
  fecha: string;
  source_event_id?: number | null;
  source_table?: string | null;
  source_id?: string | null;
  comprobante_url?: string | null;
  es_manual: boolean;
  created_at?: string;
}

export interface Budget {
  id: string;
  periodo: string; // '2026-11'
  categoria: string;
  monto_presupuestado: number;
  monto_gastado?: number;
  notas?: string | null;
  created_at?: string;
}

export interface DailyMetric {
  fecha: string;
  total_ingresos: number;
  total_egresos: number;
  utilidad_neta: number;
  pedidos_entregados_count: number;
  gasto_pauta: number;
  gasto_operativo: number;
  updated_at?: string;
}
