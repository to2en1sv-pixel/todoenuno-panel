import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Search,
  Code,
  Copy,
  Check,
  X,
  ArrowRightLeft,
  Pencil,
  Trash2,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
  ExternalLink,
  Calendar,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  CheckCircle2,
  Truck,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import {
  fetchCashAccounts,
  fetchBudgets,
  fetchMoneyTransactions,
  fetchPendingStreetOrders,
  computeStreetCollectionsSummary,
  liquidateOrderInFinances,
  addManualTransaction,
  addAccountTransfer,
  saveBudget,
  updateCashAccountBalance,
  deleteMoneyTransaction,
  getFinanceCutoffDate,
  hydrateFinanceCutoffFromOsEvents,
  isRecordBeforeFinanceCutoff,
  resetFinancesFromNow,
  clearFinanceCutoff,
  clearLegacyDeliveredPending,
  type PendingStreetOrder,
} from '@/lib/finance';
import {
  fetchStockItems,
  fetchProductVariants,
  syncOrderInventoryOnStatusChange,
} from '@/lib/inventory';
import {
  resolveFinancePeriodRange,
  filterTransactionsByDateRange,
  computePeriodMetrics,
  computeRealBusinessValue,
  computeFinancialHealth,
  extractTxYmd,
  getSvTodayStr,
  getCategoryDisplayLabel,
  isBalanceAdjustmentCategory,
  type FinancePeriodPreset,
} from '@/lib/financeAnalytics';
import type {
  CashAccount,
  MoneyTransaction,
  Budget,
  TransactionType,
} from '@/types/finance';
import type { StockItem, ProductVariant } from '@/types/inventory';

type PagoFijo = {
  id: string;
  nombre: string;
  monto: number;
  moneda: string;
  fecha_vencimiento: string;
  frecuencia: string;
  categoria: string;
};

const FINANCE_RESET_AND_PATCH_SQL = `-- ============================================================================
-- CERRAR LEGACY DE ENTREGADOS + TRIGGER SIN AUTO-COBRO AL ENTREGAR
-- No toca saldos de cuentas ni movimientos ya asentados.
-- Ejecutar una sola vez en Supabase -> SQL Editor
-- ============================================================================

-- 1. Archivar pedidos ya entregados antiguos para que no sumen "por liquidar"
update public.whatsapp_orders
   set liquidado = true,
       liquidado_at = now(),
       cuenta_liquidacion = 'corte_legacy'
 where estado = 'entregado'
   and coalesce(liquidado, false) = false;

-- 2. Actualizar trigger: order.delivered NO suma dinero a Finanzas.
--    Los cobros entran únicamente al pulsar "Liquidar Pedido".
create or replace function finance.project_os_event() returns trigger
language plpgsql security definer as $$
declare
  v_amount numeric;
  v_campaign text;
  v_is_backfill boolean;
begin
  v_is_backfill := coalesce((NEW.payload->>'backfill')::boolean, false)
                   or coalesce(NEW.idempotency_key, '') like 'backfill:%';

  if not v_is_backfill and NEW.type = 'marketing.ad.expense' then
    v_amount   := coalesce((NEW.payload->>'amount')::numeric, (NEW.payload->>'monto')::numeric, 0);
    v_campaign := coalesce(NEW.payload->>'codigo_anuncio', NEW.payload->>'campaign_id', 'Campaña');

    if v_amount > 0 and not exists (
      select 1 from finance.money_transactions where source_event_id = NEW.id
    ) then
      insert into finance.money_transactions (
        account_id, tipo, categoria, monto, descripcion, fecha, source_event_id, source_table, source_id, es_manual
      ) values (
        'tarjeta_pauta', 'expense', 'pauta_publicidad', v_amount,
        'Gasto publicitario diario ' || v_campaign,
        coalesce((NEW.payload->>'fecha')::date, current_date),
        NEW.id, NEW.source_table, NEW.source_id, false
      );

      update finance.cash_accounts
         set saldo_actual = saldo_actual - v_amount
       where id = 'tarjeta_pauta';
    end if;
  end if;

  update os.event_consumers
     set last_event_id = NEW.id, updated_at = now()
   where consumer_name = 'finance_projector';

  return NEW;
end;
$$;`;

const SPRINT2_SQL_CODE = `-- ============================================================================
-- TODOENUNO OS — MONEY ENGINE & PRESUPUESTOS (BASE LIMPIA EN $0.00)
-- Ejecutar en: Supabase SQL Editor
-- ============================================================================

create schema if not exists finance;

create table if not exists finance.cash_accounts (
  id           text primary key,
  nombre       text not null,
  tipo         text not null default 'cash',
  saldo_actual numeric(12,2) not null default 0.00,
  moneda       text not null default 'USD',
  activo       boolean not null default true,
  color        text default '#10b981',
  created_at   timestamptz not null default now()
);

insert into finance.cash_accounts (id, nombre, tipo, saldo_actual, moneda, color) values
  ('caja_efectivo',   'Efectivo Repartidores (Contraentrega)', 'cash',        0.00, 'USD', '#10b981'),
  ('banco_principal', 'Banco Agrícola (Cuenta Principal)',    'bank',        0.00, 'USD', '#3b82f6'),
  ('caja_chica',      'Caja Chica de Oficina',                'cash',        0.00, 'USD', '#f59e0b'),
  ('tarjeta_pauta',   'Tarjeta Débito Meta Ads',              'credit_card', 0.00, 'USD', '#8b5cf6')
on conflict (id) do nothing;

create table if not exists finance.money_transactions (
  id              bigint generated always as identity primary key,
  account_id      text not null references finance.cash_accounts(id) on update cascade,
  tipo            text not null check (tipo in ('income', 'expense', 'transfer')),
  categoria       text not null,
  monto           numeric(12,2) not null check (monto > 0),
  descripcion     text not null,
  fecha           date not null default current_date,
  source_event_id bigint,
  source_table    text,
  source_id       text,
  comprobante_url text,
  es_manual       boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists finance_tx_fecha_idx   on finance.money_transactions (fecha desc);
create index if not exists finance_tx_account_idx on finance.money_transactions (account_id);
create index if not exists finance_tx_tipo_idx    on finance.money_transactions (tipo);

create table if not exists finance.budgets (
  id                  text primary key,
  periodo             text not null,
  categoria           text not null,
  monto_presupuestado numeric(12,2) not null check (monto_presupuestado >= 0),
  notas               text,
  created_at          timestamptz not null default now()
);

create table if not exists finance.daily_metrics (
  fecha                    date primary key,
  total_ingresos           numeric(12,2) not null default 0.00,
  total_egresos            numeric(12,2) not null default 0.00,
  utilidad_neta            numeric(12,2) not null default 0.00,
  pedidos_entregados_count integer not null default 0,
  gasto_pauta              numeric(12,2) not null default 0.00,
  gasto_operativo          numeric(12,2) not null default 0.00,
  updated_at               timestamptz not null default now()
);

create or replace function public.update_account_balance(
  p_account_id text,
  p_delta      numeric
) returns numeric
language plpgsql security definer as $$
declare v_nuevo_saldo numeric;
begin
  update finance.cash_accounts
     set saldo_actual = saldo_actual + p_delta
   where id = p_account_id
  returning saldo_actual into v_nuevo_saldo;
  return coalesce(v_nuevo_saldo, 0);
end;
$$;

create or replace function finance.project_os_event() returns trigger
language plpgsql security definer as $$
declare
  v_amount numeric;
  v_campaign text;
  v_is_backfill boolean;
begin
  v_is_backfill := coalesce((NEW.payload->>'backfill')::boolean, false)
                   or coalesce(NEW.idempotency_key, '') like 'backfill:%';

  if not v_is_backfill and NEW.type = 'marketing.ad.expense' then
    v_amount   := coalesce((NEW.payload->>'amount')::numeric, (NEW.payload->>'monto')::numeric, 0);
    v_campaign := coalesce(NEW.payload->>'codigo_anuncio', NEW.payload->>'campaign_id', 'Campaña');

    if v_amount > 0 and not exists (
      select 1 from finance.money_transactions where source_event_id = NEW.id
    ) then
      insert into finance.money_transactions (
        account_id, tipo, categoria, monto, descripcion, fecha, source_event_id, source_table, source_id, es_manual
      ) values (
        'tarjeta_pauta', 'expense', 'pauta_publicidad', v_amount,
        'Gasto publicitario diario ' || v_campaign,
        coalesce((NEW.payload->>'fecha')::date, current_date),
        NEW.id, NEW.source_table, NEW.source_id, false
      );

      update finance.cash_accounts
         set saldo_actual = saldo_actual - v_amount
       where id = 'tarjeta_pauta';
    end if;
  end if;

  update os.event_consumers
     set last_event_id = NEW.id, updated_at = now()
   where consumer_name = 'finance_projector';

  return NEW;
end;
$$;

drop trigger if exists trg_finance_projector on os.events;
create trigger trg_finance_projector
  after insert on os.events
  for each row execute function finance.project_os_event();

create or replace view public.finance_cash_accounts as select * from finance.cash_accounts;
create or replace view public.finance_money_transactions as select * from finance.money_transactions;
create or replace view public.finance_budgets as select * from finance.budgets;
create or replace view public.finance_daily_metrics as select * from finance.daily_metrics;

alter table finance.cash_accounts       enable row level security;
alter table finance.money_transactions  enable row level security;
alter table finance.budgets             enable row level security;
alter table finance.daily_metrics       enable row level security;

grant usage on schema finance to anon, authenticated, service_role;
grant select, insert, update on finance.cash_accounts to anon, authenticated, service_role;
grant select, insert, update, delete on finance.money_transactions to anon, authenticated, service_role;
grant select, insert, update, delete on finance.budgets to anon, authenticated, service_role;
grant select, insert, update on finance.daily_metrics to anon, authenticated, service_role;

grant select, insert, update on public.finance_cash_accounts to anon, authenticated, service_role;
grant select, insert, update, delete on public.finance_money_transactions to anon, authenticated, service_role;
grant select, insert, update, delete on public.finance_budgets to anon, authenticated, service_role;
grant select, insert, update on public.finance_daily_metrics to anon, authenticated, service_role;

drop policy if exists "finance_cash_accounts_all"      on finance.cash_accounts;
drop policy if exists "finance_money_transactions_all" on finance.money_transactions;
drop policy if exists "finance_budgets_all"            on finance.budgets;
drop policy if exists "finance_daily_metrics_all"      on finance.daily_metrics;

create policy "finance_cash_accounts_all"      on finance.cash_accounts      for all using (true) with check (true);
create policy "finance_money_transactions_all" on finance.money_transactions for all using (true) with check (true);
create policy "finance_budgets_all"            on finance.budgets            for all using (true) with check (true);
create policy "finance_daily_metrics_all"      on finance.daily_metrics      for all using (true) with check (true);`;

const fmtMoney = (n: number) =>
  `$${Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtCutoffLabel = (iso: string | null) => {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('es-SV', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
};

const accountTypeLabel = (tipo: string) => {
  switch (tipo) {
    case 'bank':
      return 'Banco';
    case 'credit_card':
      return 'Tarjeta';
    default:
      return 'Efectivo';
  }
};

export function FinanzasPage() {
  const [activeTab, setActiveTab] = useState<'resumen' | 'movimientos' | 'planificacion'>('resumen');

  // Estado financiero
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<MoneyTransaction[]>([]);
  const [pendingOrders, setPendingOrders] = useState<PendingStreetOrder[]>([]);
  const [pagosFijos, setPagosFijos] = useState<PagoFijo[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [variantsList, setVariantsList] = useState<ProductVariant[]>([]);
  const [financeCutoff, setFinanceCutoff] = useState<string | null>(() => getFinanceCutoffDate());
  const [loading, setLoading] = useState(true);
  const [statusNotice, setStatusNotice] = useState<{ tipo: 'ok' | 'warn'; msg: string } | null>(null);

  // Selector de período (por defecto: Mes actual)
  const [periodPreset, setPeriodPreset] = useState<FinancePeriodPreset>('mes_actual');
  const [customStartDate, setCustomStartDate] = useState<string>(() => `${getSvTodayStr().slice(0, 8)}01`);
  const [customEndDate, setCustomEndDate] = useState<string>(() => getSvTodayStr());
  const [syncLedgerWithPeriod, setSyncLedgerWithPeriod] = useState<boolean>(true);
  const [filterCategoria, setFilterCategoria] = useState<string>('all');
  const streetSectionRef = useRef<HTMLDivElement | null>(null);

  // Auditoría y liquidación directa en calle
  const [streetDetailFilter, setStreetDetailFilter] = useState<'none' | 'todos' | 'entregado' | 'en_camino'>('none');
  const [liquidateTargetOrder, setLiquidateTargetOrder] = useState<PendingStreetOrder | null>(null);
  const [liquidateAccountId, setLiquidateAccountId] = useState('caja_efectivo');
  const [liquidatingOrder, setLiquidatingOrder] = useState(false);

  // Confirmación inline de borrado de movimientos
  const [confirmDeleteTxId, setConfirmDeleteTxId] = useState<number | string | null>(null);
  const [deletingTxId, setDeletingTxId] = useState<number | string | null>(null);
  const [confirmCleanPremature, setConfirmCleanPremature] = useState(false);
  const [cleaningPremature, setCleaningPremature] = useState(false);
  const [confirmClearLegacy, setConfirmClearLegacy] = useState(false);
  const [clearingLegacy, setClearingLegacy] = useState(false);

  // Modal: Corte legacy / Reinicio
  const [showResetModal, setShowResetModal] = useState(false);
  const [optLegacyDelivered, setOptLegacyDelivered] = useState(true);
  const [optWipeTx, setOptWipeTx] = useState(false);
  const [optZeroAccounts, setOptZeroAccounts] = useState(false);
  const [optSetCutoff, setOptSetCutoff] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Modal: Registro Manual
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTipo, setManualTipo] = useState<TransactionType>('expense');
  const [manualMonto, setManualMonto] = useState('');
  const [manualDescripcion, setManualDescripcion] = useState('');
  const [manualCategoria, setManualCategoria] = useState('gasto_manual');
  const [manualAccountId, setManualAccountId] = useState('caja_chica');
  const [manualFecha, setManualFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [manualCodigoAnuncio, setManualCodigoAnuncio] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);

  // Modal: Transferencia entre cuentas
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [transferOrigenId, setTransferOrigenId] = useState('banco_principal');
  const [transferDestinoId, setTransferDestinoId] = useState('tarjeta_pauta');
  const [transferMonto, setTransferMonto] = useState('');
  const [transferDescripcion, setTransferDescripcion] = useState('');
  const [transferFecha, setTransferFecha] = useState(() => new Date().toISOString().slice(0, 10));
  const [isSavingTransfer, setIsSavingTransfer] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);

  // Modal: Ajustar saldo
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustAccount, setAdjustAccount] = useState<CashAccount | null>(null);
  const [adjustSaldo, setAdjustSaldo] = useState('');
  const [adjustRecordTx, setAdjustRecordTx] = useState(true);
  const [adjustMotivo, setAdjustMotivo] = useState('');
  const [isSavingAdjust, setIsSavingAdjust] = useState(false);

  // Modal: Presupuesto
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetCategoria, setBudgetCategoria] = useState('');
  const [budgetMonto, setBudgetMonto] = useState('');
  const [budgetNotas, setBudgetNotas] = useState('');
  const [isSavingBudget, setIsSavingBudget] = useState(false);

  // Form: Pagos Recurrentes
  const [showPagoFijoForm, setShowPagoFijoForm] = useState(false);
  const [editingPagoFijoId, setEditingPagoFijoId] = useState<string | null>(null);
  const [pagoFijoNombre, setPagoFijoNombre] = useState('');
  const [pagoFijoMonto, setPagoFijoMonto] = useState('');
  const [pagoFijoFecha, setPagoFijoFecha] = useState('');
  const [pagoFijoCategoria, setPagoFijoCategoria] = useState('software');
  const [pagoFijoFrecuencia, setPagoFijoFrecuencia] = useState('mensual');
  const [confirmDeletePagoId, setConfirmDeletePagoId] = useState<string | null>(null);

  // Modal: SQL
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [sqlTab, setSqlTab] = useState<'reset' | 'schema'>('reset');
  const [copiedSql, setCopiedSql] = useState(false);

  // Filtros de libro diario
  const [filterTipo, setFilterTipo] = useState<'all' | 'income' | 'expense' | 'transfer' | 'manual'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const showNotice = (tipo: 'ok' | 'warn', msg: string) => {
    setStatusNotice({ tipo, msg });
    setTimeout(() => {
      setStatusNotice(prev => (prev?.msg === msg ? null : prev));
    }, 5500);
  };

  const loadFinanceData = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [cutoff, accData, budData, txData, pendingRes, pagosRes, stockRes, varsRes] =
        await Promise.all([
          hydrateFinanceCutoffFromOsEvents(supabase),
          fetchCashAccounts(),
          fetchBudgets(),
          fetchMoneyTransactions(5000),
          fetchPendingStreetOrders(),
          supabase.from('panel_pagos').select('*').order('fecha_vencimiento', { ascending: true }),
          fetchStockItems().catch(() => ({ items: [] as StockItem[], isRealDb: false })),
          fetchProductVariants().catch(() => [] as ProductVariant[]),
        ]);

      setFinanceCutoff(cutoff);
      setAccounts(accData.accounts);
      setBudgets(budData.budgets);
      setTransactions(txData.transactions);
      setStockItems(stockRes.items || []);
      setVariantsList(Array.isArray(varsRes) ? varsRes : []);
      if (!pendingRes.error) {
        setPendingOrders(pendingRes.orders);
      } else {
        showNotice('warn', `No se pudieron cargar los pedidos por liquidar: ${pendingRes.error}`);
      }
      if (!pagosRes.error && pagosRes.data) {
        setPagosFijos(pagosRes.data);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadFinanceData();
  }, []);

  // Transacciones visibles respetando el corte de libro diario si existe
  const activeTransactions = useMemo(() => {
    if (!financeCutoff) return transactions;
    return transactions.filter(
      tx => !isRecordBeforeFinanceCutoff(tx.created_at, tx.fecha, financeCutoff)
    );
  }, [transactions, financeCutoff]);

  const periodRange = useMemo(
    () => resolveFinancePeriodRange(periodPreset, customStartDate, customEndDate),
    [periodPreset, customStartDate, customEndDate]
  );

  const periodTransactions = useMemo(
    () => filterTransactionsByDateRange(activeTransactions, periodRange.startDate, periodRange.endDate),
    [activeTransactions, periodRange]
  );

  const periodMetrics = useMemo(
    () => computePeriodMetrics(activeTransactions, periodRange),
    [activeTransactions, periodRange]
  );

  // Estimado en calle / pendiente de liquidar (fuente única unificada, sin amputar por created_at)
  const estimadoPorEntrar = useMemo(
    () => computeStreetCollectionsSummary(pendingOrders),
    [pendingOrders]
  );

  const businessValue = useMemo(
    () =>
      computeRealBusinessValue({
        accounts,
        stockItems,
        variantsList,
        streetSummary: estimadoPorEntrar,
      }),
    [accounts, stockItems, variantsList, estimadoPorEntrar]
  );

  // Cobros automáticos viejos (venta_pedido) para pedidos todavía sin liquidar
  const prematureAutoTxs = useMemo(() => {
    const orderById = new Map(pendingOrders.map(o => [String(o.id), o]));
    return activeTransactions.filter(t => {
      if (t.categoria !== 'venta_pedido' || t.es_manual || t.source_table !== 'whatsapp_orders') {
        return false;
      }
      if (!t.source_id) return false;
      const ord = orderById.get(String(t.source_id));
      return ord ? !ord.liquidado : false;
    });
  }, [activeTransactions, pendingOrders]);

  const prematureTotal = useMemo(
    () => prematureAutoTxs.reduce((sum, tx) => sum + (Number(tx.monto) || 0), 0),
    [prematureAutoTxs]
  );

  // Presupuestos mensuales calculados sobre el mes del presupuesto (o mes actual) sin ajustes de saldo
  const currentSvMonth = useMemo(() => getSvTodayStr().slice(0, 7), []);

  const budgetsWithRealSpent = useMemo(() => {
    return budgets.map(b => {
      const targetMonth = /^\d{4}-\d{2}/.test(b.periodo || '') ? b.periodo.slice(0, 7) : currentSvMonth;
      const catLower = b.categoria.toLowerCase();
      const isMarketing = catLower.includes('marketing') || catLower.includes('pauta');
      const isEnvios = catLower.includes('envio') || catLower.includes('logist');
      const isEmpaque = catLower.includes('empaque') || catLower.includes('suministro');
      const isOperativo = catLower.includes('operat') || catLower.includes('nomina');

      let gastoReal = 0;
      activeTransactions.forEach(t => {
        if (t.tipo !== 'expense') return;
        if (isBalanceAdjustmentCategory(t.categoria)) return;
        if (extractTxYmd(t).slice(0, 7) !== targetMonth) return;

        const tCat = (t.categoria || '').toLowerCase();
        if (isMarketing && (tCat.includes('pauta') || tCat.includes('marketing') || t.account_id === 'tarjeta_pauta')) {
          gastoReal += Number(t.monto) || 0;
        } else if (isEnvios && (tCat.includes('flete') || tCat.includes('envio'))) {
          gastoReal += Number(t.monto) || 0;
        } else if (isEmpaque && (tCat.includes('empaque') || tCat.includes('bolsa') || tCat.includes('suministro'))) {
          gastoReal += Number(t.monto) || 0;
        } else if (isOperativo && (tCat.includes('nomina') || tCat.includes('sueldo') || tCat.includes('operat'))) {
          gastoReal += Number(t.monto) || 0;
        } else if (!isMarketing && !isEnvios && !isEmpaque && !isOperativo && tCat.includes(catLower)) {
          gastoReal += Number(t.monto) || 0;
        }
      });

      return { ...b, monto_gastado: gastoReal };
    });
  }, [budgets, activeTransactions, currentSvMonth]);

  const presupuestoTotal = useMemo(() => {
    const totalPresupuestado = budgetsWithRealSpent.reduce((sum, b) => sum + (b.monto_presupuestado || 0), 0);
    const totalGastado = budgetsWithRealSpent.reduce((sum, b) => sum + (b.monto_gastado || 0), 0);
    const pct = totalPresupuestado > 0 ? (totalGastado / totalPresupuestado) * 100 : 0;
    return { totalPresupuestado, totalGastado, pct };
  }, [budgetsWithRealSpent]);

  const financialHealth = useMemo(
    () =>
      computeFinancialHealth({
        periodMetrics,
        activeTransactions,
        businessValue,
        pagosFijos,
        monthlyBudgetsTotal: presupuestoTotal,
        streetSummary: estimadoPorEntrar,
      }),
    [periodMetrics, activeTransactions, businessValue, pagosFijos, presupuestoTotal, estimadoPorEntrar]
  );

  const ledgerSourceTransactions = useMemo(
    () => (syncLedgerWithPeriod ? periodTransactions : activeTransactions),
    [syncLedgerWithPeriod, periodTransactions, activeTransactions]
  );

  const filteredTransactions = useMemo(() => {
    return ledgerSourceTransactions.filter(t => {
      if (filterTipo === 'income' && t.tipo !== 'income') return false;
      if (filterTipo === 'expense' && t.tipo !== 'expense') return false;
      if (filterTipo === 'transfer' && t.tipo !== 'transfer') return false;
      if (filterTipo === 'manual' && !t.es_manual) return false;

      if (filterCategoria !== 'all') {
        if (String(t.categoria || '').toLowerCase() !== filterCategoria.toLowerCase()) {
          return false;
        }
      }

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const descMatch = (t.descripcion || '').toLowerCase().includes(term);
        const catMatch = (t.categoria || '').toLowerCase().includes(term);
        const accMatch = (t.account_nombre || t.account_id || '').toLowerCase().includes(term);
        if (!descMatch && !catMatch && !accMatch) return false;
      }
      return true;
    });
  }, [ledgerSourceTransactions, filterTipo, filterCategoria, searchTerm]);

  const jumpToCategoryInLedger = (categoria: string, tipo: 'all' | 'expense' | 'income' = 'expense') => {
    setSyncLedgerWithPeriod(true);
    setFilterTipo(tipo);
    setFilterCategoria(categoria);
    setSearchTerm('');
    setActiveTab('movimientos');
  };

  const handleHealthAction = (
    actionType: 'liquidate_street' | 'open_planning' | 'go_inventory' | 'open_ledger_ads'
  ) => {
    if (actionType === 'liquidate_street') {
      setStreetDetailFilter('entregado');
      setTimeout(() => {
        streetSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
    } else if (actionType === 'open_planning') {
      setActiveTab('planificacion');
    } else if (actionType === 'open_ledger_ads') {
      jumpToCategoryInLedger('pauta_publicidad', 'expense');
    }
  };

  /* ------------------------------ Acciones ------------------------------ */
  const handleQuickClearLegacyDelivered = async () => {
    if (clearingLegacy) return;
    setClearingLegacy(true);
    try {
      const res = await clearLegacyDeliveredPending();
      setConfirmClearLegacy(false);
      await loadFinanceData(true);
      if (!res.success) {
        showNotice('warn', res.error || 'No se pudo archivar el legacy de entregados.');
      } else {
        showNotice(
          'ok',
          `Se archivaron ${res.clearedCount} pedidos entregados legacy (${fmtMoney(res.clearedTotal)}). Tus cuentas no fueron modificadas.`
        );
      }
    } finally {
      setClearingLegacy(false);
    }
  };

  const handleResetFromNow = async (e: React.FormEvent) => {
    e.preventDefault();
    setResetting(true);
    try {
      const msgs: string[] = [];
      let hasWarn = false;

      if (optLegacyDelivered) {
        const legRes = await clearLegacyDeliveredPending();
        if (!legRes.success) {
          hasWarn = true;
          msgs.push(legRes.error || 'Error archivando pedidos entregados');
        } else {
          msgs.push(`${legRes.clearedCount} entregados legacy cerrados (${fmtMoney(legRes.clearedTotal)})`);
        }
      }

      if (optWipeTx || optZeroAccounts || optSetCutoff) {
        const res = await resetFinancesFromNow({
          wipeTransactions: optWipeTx,
          resetBalancesToZero: optZeroAccounts,
          setOrdersCutoff: optSetCutoff,
        });
        if (optSetCutoff) setFinanceCutoff(res.cutoffIso);
        if (res.warning) {
          hasWarn = true;
          msgs.push(res.warning);
        } else {
          msgs.push('corte financiero aplicado');
        }
      }

      setShowResetModal(false);
      await loadFinanceData(true);
      showNotice(
        hasWarn ? 'warn' : 'ok',
        msgs.length > 0 ? msgs.join(' · ') : 'Listo.'
      );
    } finally {
      setResetting(false);
    }
  };

  const handleClearCutoff = async () => {
    await clearFinanceCutoff();
    setFinanceCutoff(null);
    await loadFinanceData(true);
    showNotice('ok', 'Corte temporal removido: mostrando historial completo disponible.');
  };

  const handleCleanPrematureSales = async () => {
    if (prematureAutoTxs.length === 0 || cleaningPremature) return;
    setCleaningPremature(true);
    try {
      for (const tx of prematureAutoTxs) {
        await deleteMoneyTransaction(tx.id);
      }
      setConfirmCleanPremature(false);
      await loadFinanceData(true);
      showNotice('ok', 'Se revirtieron los cobros automáticos sin liquidar.');
    } finally {
      setCleaningPremature(false);
    }
  };

  const handleDeleteTransaction = async (txId: number | string) => {
    setDeletingTxId(txId);
    await deleteMoneyTransaction(txId);
    setConfirmDeleteTxId(null);
    await loadFinanceData(true);
    setDeletingTxId(null);
  };

  const handleSaveManualTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualMonto || !manualDescripcion) return;
    setIsSavingManual(true);
    await addManualTransaction({
      account_id: manualAccountId,
      tipo: manualTipo,
      categoria: manualCategoria,
      monto: parseFloat(manualMonto),
      descripcion: manualDescripcion,
      fecha: manualFecha,
      codigo_anuncio: manualCategoria === 'pauta_publicidad' ? manualCodigoAnuncio : undefined,
    });
    setIsSavingManual(false);
    setShowManualModal(false);
    setManualMonto('');
    setManualDescripcion('');
    setManualCodigoAnuncio('');
    await loadFinanceData(true);
    showNotice('ok', 'Movimiento asentado.');
  };

  const handleTransferSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTransferError(null);
    const monto = parseFloat(transferMonto);
    if (!monto || monto <= 0) {
      setTransferError('Ingresa un monto mayor a 0.');
      return;
    }
    if (transferOrigenId === transferDestinoId) {
      setTransferError('La cuenta de origen y destino deben ser distintas.');
      return;
    }
    setIsSavingTransfer(true);
    try {
      const res = await addAccountTransfer({
        origen_id: transferOrigenId,
        destino_id: transferDestinoId,
        monto,
        fecha: transferFecha,
        descripcion: transferDescripcion,
      });
      if (!res.success) {
        setTransferError(res.error || 'No se pudo completar la transferencia.');
        return;
      }
      setTransferMonto('');
      setTransferDescripcion('');
      setShowTransferModal(false);
      await loadFinanceData(true);
      showNotice('ok', 'Transferencia registrada.');
    } catch (err: any) {
      setTransferError(err?.message || 'Error al transferir.');
    } finally {
      setIsSavingTransfer(false);
    }
  };

  const handleSaveAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustAccount || adjustSaldo === '') return;
    setIsSavingAdjust(true);
    await updateCashAccountBalance(adjustAccount.id, parseFloat(adjustSaldo), {
      recordAdjustmentTx: adjustRecordTx,
      motivo: adjustMotivo,
    });
    setIsSavingAdjust(false);
    setShowAdjustModal(false);
    setAdjustMotivo('');
    await loadFinanceData(true);
    showNotice(
      'ok',
      `Saldo de ${adjustAccount.nombre} actualizado${adjustRecordTx ? ' y conciliado en libro diario' : ''}.`
    );
  };

  const handleConfirmDirectLiquidation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!liquidateTargetOrder || liquidatingOrder) return;
    setLiquidatingOrder(true);
    try {
      const target = liquidateTargetOrder;
      const res = await liquidateOrderInFinances({
        order: target,
        accountId: liquidateAccountId,
        onSyncInventory: async (prevEstado) => {
          await syncOrderInventoryOnStatusChange({
            order: {
              id: target.id,
              sku: target.sku || '',
              catalogo_sku: target.catalogo_sku,
              items: target.items,
              nombre_cliente: target.nombre_cliente,
              created_at: target.created_at,
            },
            prevEstado,
            nextEstado: 'entregado',
            usuario: 'Liquidación Finanzas',
          });
        },
      });

      if (!res.success) {
        showNotice('warn', res.error || 'No se pudo liquidar el pedido.');
        return;
      }
      setLiquidateTargetOrder(null);
      await loadFinanceData(true);
      if (res.alreadyLiquidated) {
        showNotice('warn', 'Este pedido ya había sido liquidado previamente.');
      } else {
        const codigo = target.pedido_codigo || `#${target.id.slice(0, 8).toUpperCase()}`;
        showNotice('ok', `Pedido ${codigo} liquidado en ${liquidateAccountId}.`);
      }
    } finally {
      setLiquidatingOrder(false);
    }
  };

  const handleSaveBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!budgetCategoria || !budgetMonto) return;
    setIsSavingBudget(true);
    const d = new Date();
    const periodo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    await saveBudget({
      periodo,
      categoria: budgetCategoria,
      monto_presupuestado: parseFloat(budgetMonto),
      notas: budgetNotas,
    });
    setIsSavingBudget(false);
    setShowBudgetModal(false);
    setBudgetCategoria('');
    setBudgetMonto('');
    setBudgetNotas('');
    await loadFinanceData(true);
  };

  const handleSavePagoFijo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pagoFijoNombre || !pagoFijoMonto || !pagoFijoFecha) return;
    const dataToSave = {
      nombre: pagoFijoNombre,
      monto: parseFloat(pagoFijoMonto),
      fecha_vencimiento: pagoFijoFecha,
      categoria: pagoFijoCategoria,
      frecuencia: pagoFijoFrecuencia,
    };
    if (editingPagoFijoId) {
      await supabase.from('panel_pagos').update(dataToSave).eq('id', editingPagoFijoId);
    } else {
      await supabase.from('panel_pagos').insert(dataToSave);
    }
    setShowPagoFijoForm(false);
    setEditingPagoFijoId(null);
    setPagoFijoNombre('');
    setPagoFijoMonto('');
    setPagoFijoFecha('');
    await loadFinanceData(true);
  };

  const handlePagarSuscripcion = async (pago: PagoFijo) => {
    const nuevaFecha = new Date(pago.fecha_vencimiento + 'T12:00:00');
    if (pago.frecuencia === 'mensual') nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);
    else if (pago.frecuencia === 'anual') nuevaFecha.setFullYear(nuevaFecha.getFullYear() + 1);

    await supabase
      .from('panel_pagos')
      .update({ fecha_vencimiento: nuevaFecha.toISOString().split('T')[0] })
      .eq('id', pago.id);

    await addManualTransaction({
      account_id: 'banco_principal',
      tipo: 'expense',
      categoria: 'suscripciones',
      monto: pago.monto,
      descripcion: `Pago recurrente ${pago.nombre}`,
      fecha: new Date().toISOString().slice(0, 10),
    });

    await loadFinanceData(true);
    showNotice('ok', `Pago de ${pago.nombre} asentado.`);
  };

  const handleDeletePagoFijo = async (id: string) => {
    await supabase.from('panel_pagos').delete().eq('id', id);
    setConfirmDeletePagoId(null);
    await loadFinanceData(true);
  };

  const copyActiveSql = () => {
    navigator.clipboard.writeText(
      sqlTab === 'reset' ? FINANCE_RESET_AND_PATCH_SQL : SPRINT2_SQL_CODE
    );
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const cutoffLabel = fmtCutoffLabel(financeCutoff);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-16">
      {/* Encabezado limpio y de una sola fila en escritorio */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--tx)]">
            Finanzas
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mu)] mt-1">
            <span>{accounts.length} cuentas activas</span>
            <span aria-hidden="true">·</span>
            {cutoffLabel ? (
              <span className="inline-flex items-center gap-1.5">
                <span>Conteo desde {cutoffLabel}</span>
                <button
                  type="button"
                  onClick={handleClearCutoff}
                  className="underline hover:text-[var(--tx)] transition-colors"
                >
                  Ver todo
                </button>
              </span>
            ) : (
              <span>Cobros ingresan únicamente al liquidar pedido</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowResetModal(true)}
            className="px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <RotateCcw size={13} /> Limpiar legacy
          </button>

          <button
            type="button"
            onClick={() => setShowSqlModal(true)}
            className="px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <Code size={13} /> SQL
          </button>

          <button
            type="button"
            onClick={() => {
              setTransferError(null);
              setShowTransferModal(true);
            }}
            className="px-3.5 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-semibold text-[var(--tx)] flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors"
          >
            <ArrowRightLeft size={13} /> Transferir
          </button>

          <button
            type="button"
            onClick={() => {
              setManualTipo('expense');
              setShowManualModal(true);
            }}
            className="px-4 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-opacity"
          >
            <Plus size={14} /> Nuevo movimiento
          </button>
        </div>
      </header>

      {/* Aviso discreto de estado */}
      {statusNotice && (
        <div
          className={`px-4 py-2.5 rounded-lg border text-xs flex items-center justify-between gap-3 ${
            statusNotice.tipo === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
          }`}
        >
          <span>{statusNotice.msg}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="opacity-70 hover:opacity-100"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Navegación por pestañas con línea inferior limpia */}
      <nav className="flex items-center gap-6 border-b border-[var(--bd)] overflow-x-auto">
        {[
          { id: 'resumen', label: 'Resumen' },
          {
            id: 'movimientos',
            label: `Libro diario (${ledgerSourceTransactions.length})`,
          },
          { id: 'planificacion', label: 'Presupuestos y fijos' },
        ].map(tab => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`pb-3 text-xs font-semibold whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                active
                  ? 'border-[var(--tx)] text-[var(--tx)]'
                  : 'border-transparent text-[var(--mu)] hover:text-[var(--tx)]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {/* PESTAÑA 1: RESUMEN */}
      {activeTab === 'resumen' && (
        <div className="flex flex-col gap-6">
          {/* Selector explícito de período para Ingresos, Egresos y Salud */}
          <section className="flex flex-col gap-2.5">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 bg-sf border border-[var(--bd)] rounded-lg overflow-x-auto">
                {[
                  { id: 'hoy', label: 'Hoy' },
                  { id: '7d', label: '7 días' },
                  { id: 'mes_actual', label: 'Mes actual' },
                  { id: 'mes_anterior', label: 'Mes anterior' },
                  { id: 'todo', label: 'Todo' },
                  { id: 'custom', label: 'Personalizado' },
                ].map(opt => {
                  const isActive = periodPreset === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPeriodPreset(opt.id as FinancePeriodPreset)}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                        isActive
                          ? 'bg-cd text-[var(--tx)] shadow-sm'
                          : 'text-[var(--mu)] hover:text-[var(--tx)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mu)] tabular-nums">
                <Calendar size={13} className="shrink-0" />
                <span className="font-medium text-[var(--tx)]">{periodRange.label}</span>
                <span aria-hidden="true">·</span>
                <span>{periodMetrics.transactionsCount} movimientos</span>
                {periodRange.comparisonLabel && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{periodRange.comparisonLabel}</span>
                  </>
                )}
              </div>
            </div>

            {periodPreset === 'custom' && (
              <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-cd border border-[var(--bd)] rounded-xl text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-[var(--mu)]">Desde</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={e => setCustomStartDate(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-[var(--bd)] bg-sf font-mono text-xs outline-none"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[var(--mu)]">Hasta</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={e => setCustomEndDate(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-[var(--bd)] bg-sf font-mono text-xs outline-none"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Franja de 4 métricas unificada por divisores sutiles */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--bd)]">
            <div className="p-5">
              <div className="text-xs font-medium text-[var(--mu)]">Liquidez disponible</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
                {loading ? '—' : fmtMoney(businessValue.liquidezNeta)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
                {businessValue.deudaTarjetaPauta > 0
                  ? `Caja/Banco ${fmtMoney(businessValue.liquidezPositiva)} · Tarjeta -${fmtMoney(businessValue.deudaTarjetaPauta)}`
                  : `Suma en ${accounts.length} cuentas`}
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs font-medium text-[var(--mu)]">Por liquidar en calle</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400 mt-1.5">
                {loading ? '—' : fmtMoney(estimadoPorEntrar.totalAfuera)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
                {estimadoPorEntrar.entregadosCount} entregados ({fmtMoney(estimadoPorEntrar.entregadosTotal)}) ·{' '}
                {estimadoPorEntrar.enCaminoCount} en ruta
              </div>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--mu)]">Ingresos liquidados</span>
                {periodMetrics.ingresosDeltaPct !== null && (
                  <span
                    className={`text-[11px] font-mono tabular-nums font-semibold ${
                      periodMetrics.ingresosDeltaPct >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {periodMetrics.ingresosDeltaPct >= 0 ? '+' : ''}
                    {periodMetrics.ingresosDeltaPct.toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-1.5">
                {loading ? '—' : fmtMoney(periodMetrics.ingresos)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1 truncate">
                {periodRange.label}
                {periodMetrics.ajustesPositivos > 0 &&
                  ` · +${fmtMoney(periodMetrics.ajustesPositivos)} conciliaciones`}
              </div>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[var(--mu)]">Egresos operativos</span>
                {periodMetrics.egresosOperativosDeltaPct !== null && (
                  <span
                    className={`text-[11px] font-mono tabular-nums font-semibold ${
                      periodMetrics.egresosOperativosDeltaPct <= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {periodMetrics.egresosOperativosDeltaPct >= 0 ? '+' : ''}
                    {periodMetrics.egresosOperativosDeltaPct.toFixed(0)}%
                  </span>
                )}
              </div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[var(--tx)] mt-1.5">
                {loading ? '—' : fmtMoney(periodMetrics.egresosOperativos)}
              </div>
              <div className="text-xs text-[var(--mu)] mt-1 tabular-nums">
                Neto {fmtMoney(periodMetrics.utilidadOperativa)} · {periodMetrics.margenOperativoPct.toFixed(1)}% margen
                {periodMetrics.comprasInventario > 0 &&
                  ` · Stock ${fmtMoney(periodMetrics.comprasInventario)}`}
              </div>
            </div>
          </section>

          {/* Bloque Estratégico: Valor Total Real del Negocio + Salud Financiera */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Valor Total Real del Negocio */}
            <div className="lg:col-span-6 bg-cd border border-[var(--bd)] rounded-xl flex flex-col justify-between">
              <div>
                <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--tx)]">
                      Valor total real del negocio
                    </h2>
                    <p className="text-xs text-[var(--mu)] mt-0.5">
                      Liquidez en cuentas + inventario al costo + entregados sin liquidar
                    </p>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-3xl font-bold font-mono tabular-nums text-[var(--tx)] tracking-tight">
                      {loading ? '—' : fmtMoney(businessValue.valorTotalReal)}
                    </div>
                    <div className="text-xs text-[var(--mu)] tabular-nums">
                      Liquidez inmediata {fmtMoney(businessValue.liquidezPositiva)} · Bodega/calle{' '}
                      {fmtMoney(businessValue.inventarioCosto + businessValue.entregadosSinLiquidar)}
                    </div>
                  </div>

                  {/* Barra de composición proporcional */}
                  <div
                    className="w-full h-2 rounded-full bg-sf overflow-hidden flex border border-[var(--bd)]"
                    aria-label="Composición del valor real del negocio"
                  >
                    <div
                      className="h-full bg-emerald-600 dark:bg-emerald-500 transition-all"
                      style={{ width: `${businessValue.pctLiquidez}%` }}
                      title={`Liquidez: ${businessValue.pctLiquidez.toFixed(1)}%`}
                    />
                    <div
                      className="h-full bg-zinc-500 dark:bg-zinc-400 transition-all"
                      style={{ width: `${businessValue.pctInventario}%` }}
                      title={`Inventario al costo: ${businessValue.pctInventario.toFixed(1)}%`}
                    />
                    <div
                      className="h-full bg-amber-500 transition-all"
                      style={{ width: `${businessValue.pctEntregados}%` }}
                      title={`Entregados sin liquidar: ${businessValue.pctEntregados.toFixed(1)}%`}
                    />
                  </div>
                </div>

                <div className="divide-y divide-[var(--bd)] border-t border-[var(--bd)]">
                  <div className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--tx)]">Liquidez neta en cuentas</div>
                      <div className="text-[var(--mu)] tabular-nums mt-0.5">
                        {businessValue.pctLiquidez.toFixed(1)}% del valor real · {accounts.length} cuentas
                      </div>
                    </div>
                    <div className="font-mono tabular-nums font-bold text-sm text-emerald-600 dark:text-emerald-400 shrink-0">
                      {loading ? '—' : fmtMoney(businessValue.liquidezNeta)}
                    </div>
                  </div>

                  <div className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[var(--tx)]">Inventario al costo</span>
                        {businessValue.skusSinCostoCount > 0 && (
                          <Link
                            to="/inventario"
                            className="text-amber-600 dark:text-amber-400 hover:underline font-medium whitespace-nowrap"
                          >
                            {businessValue.skusSinCostoCount} SKU(s) sin costo
                          </Link>
                        )}
                      </div>
                      <div className="text-[var(--mu)] tabular-nums mt-0.5">
                        {businessValue.pctInventario.toFixed(1)}% · {businessValue.unidadesFisicas} uds físicas en{' '}
                        {businessValue.skusActivosCount} SKUs
                      </div>
                    </div>
                    <div className="font-mono tabular-nums font-bold text-sm text-[var(--tx)] shrink-0">
                      {loading ? '—' : fmtMoney(businessValue.inventarioCosto)}
                    </div>
                  </div>

                  <div className="px-5 py-3 flex items-center justify-between gap-3 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium text-[var(--tx)]">Entregados sin liquidar</div>
                      <div className="text-[var(--mu)] tabular-nums mt-0.5">
                        {businessValue.pctEntregados.toFixed(1)}% · {estimadoPorEntrar.entregadosCount}{' '}
                        {estimadoPorEntrar.entregadosCount === 1 ? 'pedido cobrado' : 'pedidos cobrados'} por depositar
                      </div>
                    </div>
                    <div className="font-mono tabular-nums font-bold text-sm text-amber-600 dark:text-amber-400 shrink-0">
                      {loading ? '—' : fmtMoney(businessValue.entregadosSinLiquidar)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-5 py-3 border-t border-[var(--bd)] bg-sf/50 text-[11px] text-[var(--mu)] flex flex-wrap items-center justify-between gap-2 tabular-nums">
                <span>
                  Potencial adicional (no sumado): En ruta {fmtMoney(businessValue.enRutaPotencial)} · Venta bodega{' '}
                  {fmtMoney(businessValue.inventarioPrecioVenta)}
                </span>
                <Link
                  to="/inventario"
                  className="font-medium text-[var(--tx)] hover:underline inline-flex items-center gap-1 whitespace-nowrap"
                >
                  Ver inventario <ChevronRight size={12} />
                </Link>
              </div>
            </div>

            {/* Indicador de Salud Financiera */}
            <div className="lg:col-span-6 bg-cd border border-[var(--bd)] rounded-xl flex flex-col justify-between">
              <div>
                <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-semibold text-[var(--tx)]">
                      Salud financiera del negocio
                    </h2>
                    <p className="text-xs text-[var(--mu)] mt-0.5">
                      Evaluación en tiempo real sobre flujo, liquidez, cobro y presupuestos
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {financialHealth.estado === 'Saludable' ? (
                      <ShieldCheck size={17} className="text-emerald-600 dark:text-emerald-400" />
                    ) : financialHealth.estado === 'Atención' ? (
                      <AlertTriangle size={17} className="text-amber-600 dark:text-amber-400" />
                    ) : (
                      <AlertCircle size={17} className="text-rose-600 dark:text-rose-400" />
                    )}
                    <div className="text-right">
                      <div
                        className={`text-sm font-bold leading-none ${
                          financialHealth.estado === 'Saludable'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : financialHealth.estado === 'Atención'
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {financialHealth.estado}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[var(--mu)] mt-0.5">
                        {financialHealth.score}/100 pts
                      </div>
                    </div>
                  </div>
                </div>

                {/* Métricas operativas clave de salud */}
                <div className="px-5 py-3 border-b border-[var(--bd)] bg-sf/40 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--mu)] tabular-nums">
                  <span>
                    Oxígeno de caja:{' '}
                    <strong className="text-[var(--tx)]">
                      {financialHealth.runwayDias !== null ? `${financialHealth.runwayDias} días` : 'Sin gasto diario'}
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Capital en bodega/calle:{' '}
                    <strong className="text-[var(--tx)]">
                      {financialHealth.pctCapitalAtrapado.toFixed(0)}%
                    </strong>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Compromisos 15d:{' '}
                    <strong className="text-[var(--tx)]">
                      {fmtMoney(financialHealth.compromisos15dTotal)}
                    </strong>
                  </span>
                </div>

                {/* Desglose de los pilares */}
                <div className="p-5 space-y-3">
                  {financialHealth.pillars.map(p => {
                    const pct = p.maxScore > 0 ? (p.score / p.maxScore) * 100 : 0;
                    return (
                      <div key={p.id} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-[var(--tx)]">{p.label}</span>
                          <span className="font-mono tabular-nums text-[var(--mu)]">
                            <strong
                              className={
                                p.status === 'ok'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : p.status === 'warn'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-rose-600 dark:text-rose-400'
                              }
                            >
                              {p.score}
                            </strong>
                            /{p.maxScore}
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-sf overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              p.status === 'ok'
                                ? 'bg-emerald-500'
                                : p.status === 'warn'
                                ? 'bg-amber-500'
                                : 'bg-rose-500'
                            }`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-[var(--mu)] tabular-nums">{p.summary}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Simulador de impacto + hallazgos accionables */}
              <div className="border-t border-[var(--bd)] divide-y divide-[var(--bd)]">
                {financialHealth.simulation && (
                  <div className="px-5 py-3 bg-sf/60 flex items-center justify-between gap-3 text-xs">
                    <div className="text-[var(--mu)] leading-relaxed">
                      Si liquidas los{' '}
                      <strong className="text-[var(--tx)] font-mono tabular-nums">
                        {fmtMoney(financialHealth.simulation.montoPorLiquidar)}
                      </strong>{' '}
                      entregados hoy, tu liquidez sube a{' '}
                      <strong className="text-[var(--tx)] font-mono tabular-nums">
                        {fmtMoney(financialHealth.simulation.nuevaLiquidezNeta)}
                      </strong>{' '}
                      y tu salud pasa a{' '}
                      <strong className="text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                        {financialHealth.simulation.nuevoScore}/100 ({financialHealth.simulation.nuevoEstado})
                      </strong>
                      .
                    </div>
                    <button
                      type="button"
                      onClick={() => handleHealthAction('liquidate_street')}
                      className="px-2.5 py-1.5 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-[11px] font-semibold text-[var(--tx)] whitespace-nowrap shrink-0 transition-colors"
                    >
                      Liquidar
                    </button>
                  </div>
                )}

                {financialHealth.findings.length > 0 && (
                  <div className="px-5 py-3 space-y-2">
                    {financialHealth.findings.map(item => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-3 text-xs"
                      >
                        <div className="min-w-0">
                          <div
                            className={`font-medium truncate ${
                              item.severity === 'risk'
                                ? 'text-rose-600 dark:text-rose-400'
                                : item.severity === 'warn'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-[var(--tx)]'
                            }`}
                          >
                            {item.title}
                          </div>
                          <div className="text-[11px] text-[var(--mu)] truncate">{item.detail}</div>
                        </div>
                        {item.actionType === 'go_inventory' ? (
                          <Link
                            to="/inventario"
                            className="text-[11px] font-semibold text-[var(--tx)] hover:underline whitespace-nowrap shrink-0"
                          >
                            {item.actionLabel}
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleHealthAction(item.actionType)}
                            className="text-[11px] font-semibold text-[var(--tx)] hover:underline whitespace-nowrap shrink-0"
                          >
                            {item.actionLabel}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Auditoría de Egresos del Período y Desglose por Categoría */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-[var(--tx)]">
                  Auditoría de flujo y egresos del período
                </h2>
                <p className="text-xs text-[var(--mu)] mt-0.5 tabular-nums">
                  {periodRange.label} · Egresos operativos, inversión en inventario y conciliaciones separados
                </p>
              </div>
              <div className="text-xs text-[var(--mu)] tabular-nums">
                Flujo neto real:{' '}
                <strong
                  className={
                    periodMetrics.flujoNetoCaja >= 0
                      ? 'text-emerald-600 dark:text-emerald-400 font-mono'
                      : 'text-rose-600 dark:text-rose-400 font-mono'
                  }
                >
                  {fmtMoney(periodMetrics.flujoNetoCaja)}
                </strong>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--bd)] border-b border-[var(--bd)] text-xs">
              <div className="px-5 py-3.5">
                <div className="text-[var(--mu)]">Gastos operativos</div>
                <div className="text-base font-bold font-mono tabular-nums text-[var(--tx)] mt-1">
                  {fmtMoney(periodMetrics.egresosOperativos)}
                </div>
                <div className="text-[11px] text-[var(--mu)] mt-0.5">Pauta, envíos, fijos y generales</div>
              </div>

              <div className="px-5 py-3.5">
                <div className="text-[var(--mu)]">Compras inventario</div>
                <div className="text-base font-bold font-mono tabular-nums text-[var(--tx)] mt-1">
                  {fmtMoney(periodMetrics.comprasInventario)}
                </div>
                <div className="text-[11px] text-[var(--mu)] mt-0.5">Pagos a proveedor (pasa a stock)</div>
              </div>

              <div className="px-5 py-3.5">
                <div className="text-[var(--mu)]">Ajustes de conciliación</div>
                <div className="text-base font-bold font-mono tabular-nums text-[var(--tx)] mt-1">
                  {periodMetrics.ajustesNegativos > 0 || periodMetrics.ajustesPositivos > 0
                    ? `${periodMetrics.ajustesNetos >= 0 ? '+' : ''}${fmtMoney(periodMetrics.ajustesNetos)}`
                    : fmtMoney(0)}
                </div>
                <div className="text-[11px] text-[var(--mu)] mt-0.5 tabular-nums">
                  +{fmtMoney(periodMetrics.ajustesPositivos)} / -{fmtMoney(periodMetrics.ajustesNegativos)} (excluidos)
                </div>
              </div>

              <div className="px-5 py-3.5">
                <div className="text-[var(--mu)]">Transferencias internas</div>
                <div className="text-base font-bold font-mono tabular-nums text-[var(--tx)] mt-1">
                  {fmtMoney(periodMetrics.transferenciasTotal)}
                </div>
                <div className="text-[11px] text-[var(--mu)] mt-0.5 tabular-nums">
                  {periodMetrics.transferenciasCount} movimiento(s) · No suman a egresos
                </div>
              </div>
            </div>

            {periodMetrics.duplicateAdGroups.length > 0 && (
              <div className="px-5 py-3 border-b border-[var(--bd)] bg-amber-500/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                  <AlertTriangle size={14} className="shrink-0" />
                  <span>
                    Se detectaron <strong>{periodMetrics.duplicateAdGroups.length}</strong> grupo(s) con múltiples
                    asientos automáticos de pauta en un mismo día (~
                    <strong className="font-mono tabular-nums">
                      {fmtMoney(periodMetrics.duplicateAdExcessTotal)}
                    </strong>{' '}
                    posible excedente previo al deploy).
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => jumpToCategoryInLedger('pauta_publicidad', 'expense')}
                  className="text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline whitespace-nowrap self-start sm:self-auto"
                >
                  Inspeccionar pauta →
                </button>
              </div>
            )}

            {periodMetrics.categoryBreakdown.length === 0 ? (
              <div className="px-5 py-4 text-xs text-[var(--mu)]">
                No hay egresos reales registrados en el período seleccionado.
              </div>
            ) : (
              <div className="divide-y divide-[var(--bd)]">
                {periodMetrics.categoryBreakdown.slice(0, 6).map(cat => (
                  <button
                    key={cat.categoria}
                    type="button"
                    onClick={() => jumpToCategoryInLedger(cat.categoria, 'expense')}
                    className="w-full px-5 py-3 flex items-center justify-between gap-4 hover:bg-sf/50 transition-colors text-left text-xs"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-[var(--tx)] truncate">
                          {cat.label}
                          {cat.bucket === 'inventario' ? ' · Stock' : ''}
                        </span>
                        <span className="text-[11px] text-[var(--mu)] tabular-nums shrink-0">
                          {cat.count} mov. · {cat.pct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full h-1 rounded-full bg-sf overflow-hidden">
                        <div
                          className="h-full bg-[var(--tx)]/60"
                          style={{ width: `${Math.min(cat.pct, 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="font-mono tabular-nums font-semibold text-[var(--tx)] shrink-0">
                      {fmtMoney(cat.monto)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Grid principal: Cuentas (izq) + Pendiente por liquidar (der) */}
          <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Cuentas de dinero */}
            <div className="lg:col-span-7 bg-cd border border-[var(--bd)] rounded-xl flex flex-col">
              <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--tx)]">Cuentas de dinero</h2>
                <span className="text-xs text-[var(--mu)]">Saldos reales</span>
              </div>

              {loading ? (
                <div className="p-5 space-y-3">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="h-10 rounded-lg bg-sf animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="divide-y divide-[var(--bd)] flex-1">
                  {accounts.map(acc => (
                    <div
                      key={acc.id}
                      className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-sf/50 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--tx)] truncate">
                          {acc.nombre}
                        </div>
                        <div className="text-xs text-[var(--mu)] mt-0.5">
                          {accountTypeLabel(acc.tipo)} · {acc.moneda}
                        </div>
                      </div>

                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-base font-bold font-mono tabular-nums text-[var(--tx)]">
                          {fmtMoney(acc.saldo_actual)}
                        </div>

                        <div className="flex items-center gap-2 text-xs text-[var(--mu)]">
                          <button
                            type="button"
                            onClick={() => {
                              setAdjustAccount(acc);
                              setAdjustSaldo(String(acc.saldo_actual));
                              setAdjustRecordTx(true);
                              setAdjustMotivo('');
                              setShowAdjustModal(true);
                            }}
                            className="hover:text-[var(--tx)] transition-colors"
                            title="Ajustar saldo"
                          >
                            Ajustar
                          </button>
                          <span aria-hidden="true">·</span>
                          <button
                            type="button"
                            onClick={() => {
                              setManualAccountId(acc.id);
                              setShowManualModal(true);
                            }}
                            className="hover:text-[var(--tx)] transition-colors"
                            title="Registrar movimiento en esta cuenta"
                          >
                            + Mov
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pendiente por liquidar */}
            <div
              ref={streetSectionRef}
              className="lg:col-span-5 bg-cd border border-[var(--bd)] rounded-xl flex flex-col justify-between"
            >
              <div>
                <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-[var(--tx)]">Por liquidar en caja</h2>
                  <div className="flex items-center gap-3">
                    {estimadoPorEntrar.totalCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setStreetDetailFilter(prev => (prev === 'none' ? 'todos' : 'none'))
                        }
                        className="text-xs font-medium text-[var(--tx)] hover:opacity-80 flex items-center gap-1 transition-opacity"
                      >
                        {streetDetailFilter === 'none' ? (
                          <>
                            Ver detalle ({estimadoPorEntrar.totalCount}) <ChevronDown size={13} />
                          </>
                        ) : (
                          <>
                            Ocultar detalle <ChevronUp size={13} />
                          </>
                        )}
                      </button>
                    )}
                    <Link
                      to="/pedidos"
                      className="text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] flex items-center gap-1 transition-colors"
                    >
                      Ir a Pedidos <ExternalLink size={12} />
                    </Link>
                  </div>
                </div>

                <div className="divide-y divide-[var(--bd)]">
                  <div className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--tx)]">
                        Entregados sin depositar
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mu)] tabular-nums mt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setStreetDetailFilter(prev => (prev === 'entregado' ? 'none' : 'entregado'))
                          }
                          className="hover:text-[var(--tx)] underline-offset-2 hover:underline text-left"
                        >
                          {estimadoPorEntrar.entregadosCount}{' '}
                          {estimadoPorEntrar.entregadosCount === 1 ? 'pedido' : 'pedidos'}
                        </button>
                        {estimadoPorEntrar.entregadosTransferenciaTotal > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {fmtMoney(estimadoPorEntrar.entregadosEfectivoTotal)} efect. /{' '}
                              {fmtMoney(estimadoPorEntrar.entregadosTransferenciaTotal)} transf.
                            </span>
                          </>
                        )}
                        {estimadoPorEntrar.entregadosCount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            {confirmClearLegacy ? (
                              <span className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={clearingLegacy}
                                  onClick={handleQuickClearLegacyDelivered}
                                  className="px-2 py-0.5 rounded bg-[var(--tx)] text-[var(--cd)] font-semibold text-[11px]"
                                >
                                  {clearingLegacy ? 'Cerrando...' : 'Confirmar archivo'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmClearLegacy(false)}
                                  className="px-1.5 py-0.5 rounded border border-[var(--bd)] text-[11px]"
                                >
                                  No
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmClearLegacy(true)}
                                className="underline hover:text-[var(--tx)] transition-colors"
                              >
                                Archivar entregados legacy
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-base font-bold font-mono tabular-nums text-amber-600 dark:text-amber-400">
                      {fmtMoney(estimadoPorEntrar.entregadosTotal)}
                    </div>
                  </div>

                  <div className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--tx)]">
                        En ruta por cobrar
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--mu)] tabular-nums mt-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setStreetDetailFilter(prev => (prev === 'en_camino' ? 'none' : 'en_camino'))
                          }
                          className="hover:text-[var(--tx)] underline-offset-2 hover:underline text-left"
                        >
                          {estimadoPorEntrar.enCaminoCount}{' '}
                          {estimadoPorEntrar.enCaminoCount === 1 ? 'paquete' : 'paquetes'}
                        </button>
                        {estimadoPorEntrar.enCaminoTransferenciaTotal > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {fmtMoney(estimadoPorEntrar.enCaminoEfectivoTotal)} efect. /{' '}
                              {fmtMoney(estimadoPorEntrar.enCaminoTransferenciaTotal)} transf.
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="text-base font-bold font-mono tabular-nums text-[var(--tx)]">
                      {fmtMoney(estimadoPorEntrar.enCaminoTotal)}
                    </div>
                  </div>

                  {estimadoPorEntrar.courierBreakdown.length > 0 ? (
                    <div className="px-5 py-3.5 space-y-2">
                      <div className="text-xs font-medium text-[var(--mu)]">
                        Desglose en calle por repartidor
                      </div>
                      <div className="space-y-1.5">
                        {estimadoPorEntrar.courierBreakdown.map(item => (
                          <div
                            key={item.courier}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0 truncate">
                              <span className="text-[var(--tx)] font-medium">{item.courier}</span>{' '}
                              <span className="text-[var(--mu)] tabular-nums">
                                ({item.entregadosCount > 0 ? `${item.entregadosCount} entr.` : ''}
                                {item.entregadosCount > 0 && item.enCaminoCount > 0 ? ' · ' : ''}
                                {item.enCaminoCount > 0 ? `${item.enCaminoCount} ruta` : ''})
                              </span>
                            </div>
                            <span className="font-mono tabular-nums font-semibold text-[var(--tx)] shrink-0">
                              {fmtMoney(item.total)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="px-5 py-5 text-xs text-[var(--mu)]">
                      No hay cobros pendientes por liquidar ni paquetes en ruta.
                    </div>
                  )}

                  {streetDetailFilter !== 'none' && estimadoPorEntrar.totalCount > 0 && (
                    <div className="px-4 py-3 bg-sf/50 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 text-[11px]">
                          {[
                            { id: 'todos', label: `Todos (${estimadoPorEntrar.totalCount})` },
                            { id: 'entregado', label: `Entregados (${estimadoPorEntrar.entregadosCount})` },
                            { id: 'en_camino', label: `En ruta (${estimadoPorEntrar.enCaminoCount})` },
                          ].map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setStreetDetailFilter(opt.id as any)}
                              className={`px-2 py-1 rounded-md font-medium transition-colors ${
                                streetDetailFilter === opt.id
                                  ? 'bg-cd text-[var(--tx)] border border-[var(--bd)]'
                                  : 'text-[var(--mu)] hover:text-[var(--tx)]'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="max-h-64 overflow-y-auto divide-y divide-[var(--bd)] rounded-lg border border-[var(--bd)] bg-cd">
                        {(streetDetailFilter === 'entregado'
                          ? estimadoPorEntrar.entregados
                          : streetDetailFilter === 'en_camino'
                          ? estimadoPorEntrar.enCamino
                          : [...estimadoPorEntrar.entregados, ...estimadoPorEntrar.enCamino]
                        ).map(ord => {
                          const code = ord.pedido_codigo || `#${ord.id.slice(0, 6).toUpperCase()}`;
                          const isEntregado = ord.estadoNormalizado === 'entregado';
                          return (
                            <div
                              key={ord.id}
                              className="px-3 py-2 flex items-center justify-between gap-2 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-[11px] text-[var(--mu)]">{code}</span>
                                  <span className="font-medium text-[var(--tx)] truncate">
                                    {ord.nombre_cliente || 'Cliente'}
                                  </span>
                                </div>
                                <div className="text-[11px] text-[var(--mu)] flex flex-wrap items-center gap-1.5 mt-0.5">
                                  <span
                                    className={
                                      isEntregado
                                        ? 'text-amber-600 dark:text-amber-400 font-medium'
                                        : 'text-sky-600 dark:text-sky-400 font-medium inline-flex items-center gap-0.5'
                                    }
                                  >
                                    {!isEntregado && <Truck size={10} />}
                                    {isEntregado ? 'Entregado' : 'En ruta'}
                                  </span>
                                  <span>·</span>
                                  <span>{ord.courier || 'Sin asignar'}</span>
                                  <span>·</span>
                                  <span>{ord.esTransferenciaOPrepagado ? 'Transf/Prepago' : 'Contra entrega'}</span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <span className="font-mono tabular-nums font-semibold text-[var(--tx)]">
                                  {fmtMoney(ord.total || 0)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLiquidateTargetOrder(ord);
                                    setLiquidateAccountId(
                                      ord.esTransferenciaOPrepagado ? 'banco_principal' : 'caja_efectivo'
                                    );
                                  }}
                                  className="px-2 py-1 rounded-md border border-[var(--bd)] bg-sf hover:bg-[var(--tx)] hover:text-[var(--cd)] text-[11px] font-semibold transition-colors inline-flex items-center gap-1"
                                  title="Liquidar cobro en cuenta"
                                >
                                  <CheckCircle2 size={11} /> Liquidar
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {prematureAutoTxs.length > 0 && (
                <div className="px-5 py-3 border-t border-[var(--bd)] bg-rose-500/5 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-rose-700 dark:text-rose-300 min-w-0">
                    <AlertCircle size={14} className="shrink-0" />
                    <span className="truncate">
                      {prematureAutoTxs.length} cobro(s) auto sin liquidar ({fmtMoney(prematureTotal)})
                    </span>
                  </div>

                  {confirmCleanPremature ? (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={cleaningPremature}
                        onClick={handleCleanPrematureSales}
                        className="px-2.5 py-1 rounded-md bg-rose-600 text-white font-semibold text-xs"
                      >
                        {cleaningPremature ? 'Revirtiendo...' : 'Confirmar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmCleanPremature(false)}
                        className="px-2 py-1 rounded-md border border-[var(--bd)] text-xs"
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmCleanPremature(true)}
                      className="text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline shrink-0"
                    >
                      Revertir
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Últimos movimientos del período */}
          <section className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-[var(--tx)]">
                  Últimos movimientos ({periodRange.label})
                </h2>
              </div>
              {activeTransactions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setActiveTab('movimientos')}
                  className="text-xs font-medium text-[var(--mu)] hover:text-[var(--tx)] transition-colors whitespace-nowrap"
                >
                  Ver libro completo →
                </button>
              )}
            </div>

            {loading ? (
              <div className="p-5 space-y-2.5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-9 rounded-lg bg-sf animate-pulse" />
                ))}
              </div>
            ) : periodTransactions.length === 0 ? (
              <div className="px-5 py-10 text-center space-y-3">
                <p className="text-sm text-[var(--mu)]">
                  No hay movimientos registrados en {periodRange.label}.
                </p>
                <div className="flex items-center justify-center gap-2">
                  {periodPreset !== 'todo' && activeTransactions.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setPeriodPreset('todo')}
                      className="px-4 py-2 rounded-lg border border-[var(--bd)] bg-sf hover:bg-cd text-xs font-semibold text-[var(--tx)] transition-colors"
                    >
                      Ver todo el historial
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setManualTipo('expense');
                      setShowManualModal(true);
                    }}
                    className="px-4 py-2 rounded-lg border border-[var(--bd)] bg-sf hover:bg-cd text-xs font-semibold text-[var(--tx)] inline-flex items-center gap-1.5 transition-colors"
                  >
                    <Plus size={14} /> Registrar movimiento
                  </button>
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-sf/60 border-b border-[var(--bd)] text-[var(--mu)] font-medium">
                    <tr>
                      <th className="py-2.5 px-5">Fecha</th>
                      <th className="py-2.5 px-4">Concepto</th>
                      <th className="py-2.5 px-4">Cuenta</th>
                      <th className="py-2.5 px-4">Categoría</th>
                      <th className="py-2.5 px-5 text-right">Monto</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--bd)]">
                    {periodTransactions.slice(0, 6).map(tx => (
                      <tr key={tx.id} className="hover:bg-sf/40 transition-colors">
                        <td className="py-3 px-5 font-mono tabular-nums text-[var(--mu)] whitespace-nowrap">
                          {tx.fecha}
                        </td>
                        <td className="py-3 px-4 font-medium text-[var(--tx)] max-w-sm truncate">
                          {tx.descripcion}
                        </td>
                        <td className="py-3 px-4 text-[var(--mu)] whitespace-nowrap">
                          {tx.account_nombre || tx.account_id}
                        </td>
                        <td className="py-3 px-4 text-[var(--mu)] whitespace-nowrap">
                          {getCategoryDisplayLabel(tx.categoria)}
                        </td>
                        <td
                          className={`py-3 px-5 font-mono tabular-nums font-semibold text-right whitespace-nowrap ${
                            tx.tipo === 'income' || tx.categoria === 'transferencia_entrada'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : tx.tipo === 'transfer'
                              ? 'text-[var(--mu)]'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {tx.tipo === 'income' || tx.categoria === 'transferencia_entrada' ? '+' : '-'}
                          {fmtMoney(tx.monto)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* PESTAÑA 2: LIBRO DIARIO */}
      {activeTab === 'movimientos' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 p-1 bg-sf border border-[var(--bd)] rounded-lg overflow-x-auto">
                {[
                  { id: 'all', label: 'Todos' },
                  { id: 'income', label: 'Ingresos' },
                  { id: 'expense', label: 'Egresos' },
                  { id: 'transfer', label: 'Transferencias' },
                  { id: 'manual', label: 'Manuales' },
                ].map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFilterTipo(f.id as any)}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                      filterTipo === f.id
                        ? 'bg-cd text-[var(--tx)] shadow-sm'
                        : 'text-[var(--mu)] hover:text-[var(--tx)]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setSyncLedgerWithPeriod(v => !v)}
                className={`px-3 py-2 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                  syncLedgerWithPeriod
                    ? 'border-[var(--tx)] bg-cd text-[var(--tx)]'
                    : 'border-[var(--bd)] bg-sf text-[var(--mu)] hover:text-[var(--tx)]'
                }`}
              >
                {syncLedgerWithPeriod ? `Período: ${periodRange.label}` : 'Mostrando todo el historial'}
              </button>

              {filterCategoria !== 'all' && (
                <button
                  type="button"
                  onClick={() => setFilterCategoria('all')}
                  className="px-3 py-2 rounded-lg border border-[var(--bd)] bg-cd text-xs font-medium text-[var(--tx)] inline-flex items-center gap-1.5 whitespace-nowrap hover:bg-sf"
                >
                  <span>Categoría: {getCategoryDisplayLabel(filterCategoria)}</span>
                  <X size={12} />
                </button>
              )}
            </div>

            <div className="relative w-full lg:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mu)]" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar concepto, cuenta o categoría..."
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-cd border border-[var(--bd)] text-xs outline-none focus:border-[var(--tx)]"
              />
            </div>
          </div>

          <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden">
            {filteredTransactions.length === 0 ? (
              <div className="py-12 px-5 text-center space-y-3">
                <p className="text-sm text-[var(--mu)]">
                  {ledgerSourceTransactions.length === 0
                    ? 'No hay movimientos registrados en este rango.'
                    : 'Ningún movimiento coincide con los filtros.'}
                </p>
                {activeTransactions.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowManualModal(true)}
                    className="px-4 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] text-xs font-semibold inline-flex items-center gap-1.5"
                  >
                    <Plus size={14} /> Registrar movimiento
                  </button>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    {syncLedgerWithPeriod && (
                      <button
                        type="button"
                        onClick={() => setSyncLedgerWithPeriod(false)}
                        className="px-3.5 py-2 rounded-lg border border-[var(--bd)] bg-sf hover:bg-cd text-xs font-semibold text-[var(--tx)]"
                      >
                        Ver todo el historial
                      </button>
                    )}
                    {filterCategoria !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setFilterCategoria('all')}
                        className="px-3.5 py-2 rounded-lg border border-[var(--bd)] bg-sf hover:bg-cd text-xs font-semibold text-[var(--tx)]"
                      >
                        Quitar filtro de categoría
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-sf/60 border-b border-[var(--bd)] text-[var(--mu)] font-medium">
                    <tr>
                      <th className="py-3 px-4">Fecha</th>
                      <th className="py-3 px-4">Concepto</th>
                      <th className="py-3 px-4">Cuenta</th>
                      <th className="py-3 px-4">Categoría</th>
                      <th className="py-3 px-4">Origen</th>
                      <th className="py-3 px-4 text-right">Monto</th>
                      <th className="py-3 px-4 text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--bd)]">
                    {filteredTransactions.map(tx => {
                      const isPositive =
                        tx.tipo === 'income' || tx.categoria === 'transferencia_entrada';
                      return (
                        <tr key={tx.id} className="hover:bg-sf/40 transition-colors">
                          <td className="py-3 px-4 font-mono tabular-nums text-[var(--mu)] whitespace-nowrap">
                            {tx.fecha}
                          </td>
                          <td className="py-3 px-4 font-medium text-[var(--tx)] max-w-xs truncate">
                            {tx.descripcion}
                          </td>
                          <td className="py-3 px-4 text-[var(--mu)] whitespace-nowrap">
                            {tx.account_nombre || tx.account_id}
                          </td>
                          <td className="py-3 px-4 text-[var(--mu)] whitespace-nowrap">
                            {tx.tipo === 'transfer'
                              ? tx.categoria === 'transferencia_salida'
                                ? 'Salida entre cuentas'
                                : 'Entrada entre cuentas'
                              : getCategoryDisplayLabel(tx.categoria)}
                          </td>
                          <td className="py-3 px-4 text-[var(--mu)] whitespace-nowrap">
                            {tx.tipo === 'transfer'
                              ? 'Transferencia'
                              : tx.es_manual
                              ? 'Manual'
                              : 'Automático'}
                          </td>
                          <td
                            className={`py-3 px-4 font-mono tabular-nums font-semibold text-right whitespace-nowrap ${
                              isPositive
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : tx.tipo === 'transfer'
                                ? 'text-[var(--mu)]'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {isPositive ? '+' : '-'}
                            {fmtMoney(tx.monto)}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            {confirmDeleteTxId === tx.id ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  disabled={deletingTxId === tx.id}
                                  onClick={() => handleDeleteTransaction(tx.id)}
                                  className="px-2 py-1 rounded bg-rose-600 text-white font-semibold text-[11px]"
                                >
                                  {deletingTxId === tx.id ? '...' : 'Revertir'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteTxId(null)}
                                  className="px-2 py-1 rounded border border-[var(--bd)] text-[11px]"
                                >
                                  No
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteTxId(tx.id)}
                                title="Eliminar movimiento y revertir saldo"
                                className="p-1.5 text-[var(--mu)] hover:text-rose-500 rounded-md transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PESTAÑA 3: PRESUPUESTOS Y PAGOS FIJOS */}
      {activeTab === 'planificacion' && (
        <div className="flex flex-col gap-8">
          {/* Bloque A: Presupuestos */}
          <section className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--tx)]">Presupuestos del mes</h2>
                <p className="text-xs text-[var(--mu)] mt-0.5 tabular-nums">
                  Ejecutado {fmtMoney(presupuestoTotal.totalGastado)} de{' '}
                  {fmtMoney(presupuestoTotal.totalPresupuestado)} ({presupuestoTotal.pct.toFixed(1)}%)
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBudgetModal(true)}
                className="px-3.5 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap"
              >
                <Plus size={14} /> Nuevo límite
              </button>
            </div>

            <div className="w-full bg-sf rounded-full h-1.5 overflow-hidden border border-[var(--bd)]">
              <div
                className={`h-full transition-all ${
                  presupuestoTotal.pct > 90
                    ? 'bg-rose-500'
                    : presupuestoTotal.pct > 75
                    ? 'bg-amber-500'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(presupuestoTotal.pct, 100)}%` }}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {budgetsWithRealSpent.map(b => {
                const gastado = b.monto_gastado || 0;
                const pct = b.monto_presupuestado > 0 ? (gastado / b.monto_presupuestado) * 100 : 0;
                const restante = b.monto_presupuestado - gastado;
                return (
                  <div
                    key={b.id}
                    className="p-4 bg-cd border border-[var(--bd)] rounded-xl space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-[var(--tx)]">{b.categoria}</span>
                      <span
                        className={`text-xs font-mono tabular-nums font-semibold ${
                          pct > 90
                            ? 'text-rose-600 dark:text-rose-400'
                            : pct > 75
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-[var(--mu)]'
                        }`}
                      >
                        {pct.toFixed(0)}%
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between text-xs font-mono tabular-nums">
                      <span className="text-base font-bold text-[var(--tx)]">
                        {fmtMoney(gastado)}
                      </span>
                      <span className="text-[var(--mu)]">Límite {fmtMoney(b.monto_presupuestado)}</span>
                    </div>

                    <div className="w-full bg-sf rounded-full h-1.5 overflow-hidden border border-[var(--bd)]">
                      <div
                        className={`h-full transition-all ${
                          pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs text-[var(--mu)]">
                      <span className="tabular-nums">
                        Restante {fmtMoney(Math.max(restante, 0))}
                      </span>
                      {b.notas && <span className="truncate max-w-[200px]">{b.notas}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Bloque B: Suscripciones y Pagos Recurrentes */}
          <section className="space-y-4 pt-6 border-t border-[var(--bd)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[var(--tx)]">
                  Suscripciones y pagos fijos
                </h2>
                <p className="text-xs text-[var(--mu)] mt-0.5">
                  Software, hosting y gastos recurrentes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditingPagoFijoId(null);
                  setShowPagoFijoForm(v => !v);
                }}
                className="px-3.5 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-semibold flex items-center gap-1.5 self-start sm:self-auto whitespace-nowrap"
              >
                <Plus size={14} /> Nueva suscripción
              </button>
            </div>

            {showPagoFijoForm && (
              <form
                onSubmit={handleSavePagoFijo}
                className="bg-cd border border-[var(--bd)] rounded-xl p-4 space-y-3"
              >
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <input
                    placeholder="Nombre (ej. DigitalOcean)"
                    value={pagoFijoNombre}
                    onChange={e => setPagoFijoNombre(e.target.value)}
                    className="bg-sf border border-[var(--bd)] rounded-lg px-3 py-2 text-xs outline-none"
                    required
                  />
                  <input
                    placeholder="Monto ($)"
                    type="number"
                    step="0.01"
                    value={pagoFijoMonto}
                    onChange={e => setPagoFijoMonto(e.target.value)}
                    className="bg-sf border border-[var(--bd)] rounded-lg px-3 py-2 text-xs font-mono outline-none"
                    required
                  />
                  <input
                    type="date"
                    value={pagoFijoFecha}
                    onChange={e => setPagoFijoFecha(e.target.value)}
                    className="bg-sf border border-[var(--bd)] rounded-lg px-3 py-2 text-xs font-mono outline-none"
                    required
                  />
                  <select
                    value={pagoFijoFrecuencia}
                    onChange={e => setPagoFijoFrecuencia(e.target.value)}
                    className="bg-sf border border-[var(--bd)] rounded-lg px-3 py-2 text-xs outline-none"
                  >
                    <option value="mensual">Mensual</option>
                    <option value="anual">Anual</option>
                    <option value="unico">Pago único</option>
                  </select>
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPagoFijoForm(false)}
                    className="px-3 py-1.5 border border-[var(--bd)] rounded-lg text-xs font-medium"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-[var(--tx)] text-[var(--cd)] rounded-lg text-xs font-semibold"
                  >
                    Guardar
                  </button>
                </div>
              </form>
            )}

            <div className="bg-cd border border-[var(--bd)] rounded-xl divide-y divide-[var(--bd)] overflow-hidden">
              {pagosFijos.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--mu)]">
                  No hay suscripciones registradas.
                </div>
              ) : (
                pagosFijos.map(pago => (
                  <div
                    key={pago.id}
                    className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Calendar size={15} className="text-[var(--mu)] shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-[var(--tx)] truncate">
                          {pago.nombre}
                        </div>
                        <div className="text-xs text-[var(--mu)] capitalize tabular-nums">
                          {pago.frecuencia} · Vence {pago.fecha_vencimiento}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                      <span className="font-mono tabular-nums font-bold text-sm text-[var(--tx)]">
                        {fmtMoney(pago.monto)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handlePagarSuscripcion(pago)}
                        className="px-3 py-1.5 rounded-lg border border-[var(--bd)] bg-sf hover:bg-cd text-xs font-semibold text-[var(--tx)] transition-colors"
                      >
                        Pagar y asentar
                      </button>
                      {confirmDeletePagoId === pago.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeletePagoFijo(pago.id)}
                            className="px-2 py-1 rounded bg-rose-600 text-white text-xs font-semibold"
                          >
                            Sí
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeletePagoId(null)}
                            className="px-2 py-1 rounded border border-[var(--bd)] text-xs"
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeletePagoId(pago.id)}
                          className="p-1.5 text-[var(--mu)] hover:text-rose-500 rounded-md"
                          title="Eliminar suscripción"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      )}

      {/* MODAL: LIMPIAR LEGACY / CORTE DESDE AHORA */}
      {showResetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowResetModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <RotateCcw size={16} />
                <h3 className="font-semibold text-sm">Limpiar legacy por liquidar</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowResetModal(false)}
                className="p-1 rounded-md text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleResetFromNow} className="p-5 space-y-4">
              <p className="text-xs text-[var(--mu)] leading-relaxed">
                Cierra los pedidos entregados antiguos para que el conteo de{' '}
                <strong className="text-[var(--tx)]">Por liquidar</strong> empiece limpio desde ahora.
                Tus cuentas bancarias y movimientos actuales no se modifican salvo que marques las
                opciones avanzadas abajo.
              </p>

              <div className="space-y-2.5 text-xs">
                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--bd)] bg-sf/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optLegacyDelivered}
                    onChange={e => setOptLegacyDelivered(e.target.checked)}
                    className="mt-0.5 accent-emerald-600"
                  />
                  <span>
                    <strong className="block text-[var(--tx)]">
                      Archivar pedidos ya entregados sin liquidar ({fmtMoney(estimadoPorEntrar.entregadosTotal)})
                    </strong>
                    <span className="text-[var(--mu)]">
                      Quita el saldo legacy de Finanzas, Hoy y Pedidos sin sumar dinero a cuentas.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--bd)] bg-sf/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optSetCutoff}
                    onChange={e => setOptSetCutoff(e.target.checked)}
                    className="mt-0.5 accent-emerald-600"
                  />
                  <span>
                    <strong className="block text-[var(--tx)]">
                      Aplicar fecha de corte desde este instante (opcional)
                    </strong>
                    <span className="text-[var(--mu)]">
                      Oculta en la vista cualquier movimiento o pedido previo a esta hora.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--bd)] bg-sf/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optWipeTx}
                    onChange={e => setOptWipeTx(e.target.checked)}
                    className="mt-0.5 accent-rose-600"
                  />
                  <span>
                    <strong className="block text-[var(--tx)]">
                      Vaciar libro diario de movimientos (avanzado)
                    </strong>
                    <span className="text-[var(--mu)]">
                      Borra los movimientos registrados en la tabla de finanzas.
                    </span>
                  </span>
                </label>

                <label className="flex items-start gap-2.5 p-3 rounded-lg border border-[var(--bd)] bg-sf/50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={optZeroAccounts}
                    onChange={e => setOptZeroAccounts(e.target.checked)}
                    className="mt-0.5 accent-rose-600"
                  />
                  <span>
                    <strong className="block text-[var(--tx)]">
                      Poner saldos de cuentas en $0.00 (avanzado)
                    </strong>
                    <span className="text-[var(--mu)]">
                      Reinicia Efectivo, Banco, Caja Chica y Tarjeta Ads a cero.
                    </span>
                  </span>
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  className="px-4 py-2 rounded-lg border border-[var(--bd)] text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={
                    resetting ||
                    (!optLegacyDelivered && !optWipeTx && !optZeroAccounts && !optSetCutoff)
                  }
                  className="px-4 py-2 rounded-lg bg-[var(--tx)] text-[var(--cd)] text-xs font-semibold disabled:opacity-50"
                >
                  {resetting ? 'Aplicando...' : 'Aplicar limpieza'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NUEVO MOVIMIENTO MANUAL */}
      {showManualModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowManualModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-semibold text-sm">Registrar movimiento manual</h3>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-1 rounded-md text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveManualTransaction} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-2 p-1 bg-sf rounded-lg border border-[var(--bd)]">
                <button
                  type="button"
                  onClick={() => setManualTipo('expense')}
                  className={`py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    manualTipo === 'expense' ? 'bg-rose-600 text-white' : 'text-[var(--mu)]'
                  }`}
                >
                  <ArrowDownRight size={14} /> Gasto / Egreso
                </button>
                <button
                  type="button"
                  onClick={() => setManualTipo('income')}
                  className={`py-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    manualTipo === 'income' ? 'bg-emerald-600 text-white' : 'text-[var(--mu)]'
                  }`}
                >
                  <ArrowUpRight size={14} /> Pago / Ingreso
                </button>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">Monto ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={manualMonto}
                  onChange={e => setManualMonto(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-base font-mono tabular-nums font-bold outline-none"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                  Concepto / Descripción *
                </label>
                <input
                  type="text"
                  value={manualDescripcion}
                  onChange={e => setManualDescripcion(e.target.value)}
                  placeholder="Ej. Gasolina repartidor, 500 bolsas, abono cliente..."
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">Cuenta *</label>
                  <select
                    value={manualAccountId}
                    onChange={e => setManualAccountId(e.target.value)}
                    className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  >
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.nombre} ({fmtMoney(acc.saldo_actual)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">Categoría</label>
                  <select
                    value={manualCategoria}
                    onChange={e => {
                      const val = e.target.value;
                      setManualCategoria(val);
                      if (val === 'pauta_publicidad') {
                        setManualAccountId('tarjeta_pauta');
                      }
                    }}
                    className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  >
                    {manualTipo === 'expense' ? (
                      <>
                        <option value="gasto_manual">Gasto general</option>
                        <option value="pauta_publicidad">Pauta publicitaria (Meta / TikTok)</option>
                        <option value="flete_envio">Flete / Transporte</option>
                        <option value="empaque_suministros">Empaque / Bolsas</option>
                        <option value="nomina_sueldos">Nómina / Ayudante</option>
                        <option value="pago_proveedor">Pago proveedor</option>
                        <option value="alquiler_servicios">Servicios / Alquiler</option>
                      </>
                    ) : (
                      <>
                        <option value="abono_manual">Abono de cliente</option>
                        <option value="devolucion_proveedor">Devolución proveedor</option>
                        <option value="otro_ingreso">Otro ingreso</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {manualCategoria === 'pauta_publicidad' && (
                <div className="p-3 bg-sf rounded-lg border border-[var(--bd)] space-y-1">
                  <label className="block text-xs font-medium text-[var(--mu)]">
                    Código de anuncio / campaña
                  </label>
                  <input
                    type="text"
                    value={manualCodigoAnuncio}
                    onChange={e => setManualCodigoAnuncio(e.target.value.toUpperCase())}
                    placeholder="Ej. PROMO1, CAMP-EMS-01..."
                    className="w-full p-2 rounded-md border border-[var(--bd)] bg-cd text-xs uppercase outline-none font-mono font-bold"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">Fecha</label>
                <input
                  type="date"
                  value={manualFecha}
                  onChange={e => setManualFecha(e.target.value)}
                  className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingManual}
                  className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs disabled:opacity-50"
                >
                  {isSavingManual ? 'Guardando...' : 'Asentar movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: TRANSFERIR ENTRE CUENTAS */}
      {showTransferModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowTransferModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-semibold text-sm">Transferir entre cuentas</h3>
              <button
                type="button"
                onClick={() => setShowTransferModal(false)}
                className="p-1 rounded-md text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleTransferSubmit} className="p-5 space-y-4">
              {transferError && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs">
                  {transferError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                    Cuenta origen (sale) *
                  </label>
                  <select
                    value={transferOrigenId}
                    onChange={e => setTransferOrigenId(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  >
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.nombre} ({fmtMoney(acc.saldo_actual)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                    Cuenta destino (entra) *
                  </label>
                  <select
                    value={transferDestinoId}
                    onChange={e => setTransferDestinoId(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  >
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.nombre} ({fmtMoney(acc.saldo_actual)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">Monto ($) *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={transferMonto}
                    onChange={e => setTransferMonto(e.target.value)}
                    placeholder="0.00"
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-base font-mono tabular-nums font-bold outline-none"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">Fecha</label>
                  <input
                    type="date"
                    value={transferFecha}
                    onChange={e => setTransferFecha(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs font-mono outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                  Concepto (opcional)
                </label>
                <input
                  type="text"
                  value={transferDescripcion}
                  onChange={e => setTransferDescripcion(e.target.value)}
                  placeholder="Ej. Depósito de efectivo a banco, recarga tarjeta Meta..."
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowTransferModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingTransfer}
                  className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs disabled:opacity-50"
                >
                  {isSavingTransfer ? 'Transfiriendo...' : 'Transferir'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: AJUSTAR SALDO */}
      {showAdjustModal && adjustAccount && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowAdjustModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Pencil size={15} />
                <h3 className="font-semibold text-sm">Ajustar saldo</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAdjustModal(false)}
                className="p-1 rounded-md text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveAdjust} className="p-5 space-y-4">
              <div>
                <div className="text-xs text-[var(--mu)]">Cuenta</div>
                <div className="text-sm font-semibold text-[var(--tx)] mt-0.5">
                  {adjustAccount.nombre}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                  Nuevo saldo real ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={adjustSaldo}
                  onChange={e => setAdjustSaldo(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-lg font-mono tabular-nums font-bold outline-none"
                  required
                  autoFocus
                />
              </div>

              <label className="flex items-start gap-2 text-xs text-[var(--mu)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={adjustRecordTx}
                  onChange={e => setAdjustRecordTx(e.target.checked)}
                  className="mt-0.5 accent-emerald-600"
                />
                <span>
                  <strong className="text-[var(--tx)] block">Registrar asiento de conciliación</strong>
                  Mantiene cuadrado el libro diario con el nuevo saldo de la cuenta.
                </span>
              </label>

              {adjustRecordTx && (
                <div>
                  <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                    Motivo del ajuste (opcional)
                  </label>
                  <input
                    type="text"
                    value={adjustMotivo}
                    onChange={e => setAdjustMotivo(e.target.value)}
                    placeholder="Ej. Cuadre de caja física, comisión bancaria..."
                    className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingAdjust}
                  className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs disabled:opacity-50"
                >
                  {isSavingAdjust ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: LIQUIDAR PEDIDO DIRECTO DESDE FINANZAS */}
      {liquidateTargetOrder && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => !liquidatingOrder && setLiquidateTargetOrder(null)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <h3 className="font-semibold text-sm">Liquidar cobro de pedido</h3>
              </div>
              <button
                type="button"
                onClick={() => !liquidatingOrder && setLiquidateTargetOrder(null)}
                className="p-1 rounded-md text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleConfirmDirectLiquidation} className="p-5 space-y-4">
              <div className="p-3.5 rounded-lg border border-[var(--bd)] bg-sf/60 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-mono text-[var(--mu)]">
                    {liquidateTargetOrder.pedido_codigo || `#${liquidateTargetOrder.id.slice(0, 8).toUpperCase()}`}
                  </span>
                  <span className="font-mono font-bold text-base text-emerald-600 dark:text-emerald-400">
                    {fmtMoney(liquidateTargetOrder.total || 0)}
                  </span>
                </div>
                <div className="text-sm font-semibold text-[var(--tx)]">
                  {liquidateTargetOrder.nombre_cliente || 'Cliente'}
                </div>
                <div className="text-xs text-[var(--mu)]">
                  Repartidor: {liquidateTargetOrder.courier || 'Sin asignar'} ·{' '}
                  {liquidateTargetOrder.esTransferenciaOPrepagado ? 'Transferencia / Prepagado' : 'Contra entrega'}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                  Cuenta donde ingresa el dinero *
                </label>
                <select
                  value={liquidateAccountId}
                  onChange={e => setLiquidateAccountId(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                >
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.nombre} ({fmtMoney(acc.saldo_actual)})
                    </option>
                  ))}
                </select>
              </div>

              {liquidateTargetOrder.estadoNormalizado !== 'entregado' && (
                <div className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
                  Este pedido figura aún <strong>En ruta</strong>; al liquidarlo también se marcará como{' '}
                  <strong>Entregado</strong> y descontará su unidad física en Kárdex.
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={liquidatingOrder}
                  onClick={() => setLiquidateTargetOrder(null)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={liquidatingOrder}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg text-xs disabled:opacity-50"
                >
                  {liquidatingOrder ? 'Liquidando...' : 'Confirmar ingreso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: NUEVO PRESUPUESTO */}
      {showBudgetModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowBudgetModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-semibold text-sm">Nuevo límite de presupuesto</h3>
              <button
                type="button"
                onClick={() => setShowBudgetModal(false)}
                className="p-1 rounded-md text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveBudget} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">Categoría *</label>
                <input
                  type="text"
                  value={budgetCategoria}
                  onChange={e => setBudgetCategoria(e.target.value)}
                  placeholder="Ej. Marketing Meta, Envíos, Empaque..."
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">
                  Límite mensual ($) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={budgetMonto}
                  onChange={e => setBudgetMonto(e.target.value)}
                  placeholder="1000.00"
                  className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-sf text-base font-mono tabular-nums font-bold outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--mu)] mb-1">Notas</label>
                <textarea
                  rows={2}
                  value={budgetNotas}
                  onChange={e => setBudgetNotas(e.target.value)}
                  placeholder="Detalles del límite..."
                  className="w-full p-2 rounded-lg border border-[var(--bd)] bg-sf text-xs outline-none resize-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowBudgetModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-lg text-xs font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingBudget}
                  className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold rounded-lg text-xs disabled:opacity-50"
                >
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: SQL (REINICIO LIMPIO + SCHEMA SPRINT 2) */}
      {showSqlModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowSqlModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col"
          >
            <div className="px-5 py-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Code size={16} />
                <h3 className="font-semibold text-sm">SQL Finanzas — Supabase</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSqlModal(false)}
                className="p-1 rounded-md text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1 p-1 bg-sf border border-[var(--bd)] rounded-lg">
                  <button
                    type="button"
                    onClick={() => setSqlTab('reset')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                      sqlTab === 'reset'
                        ? 'bg-cd text-[var(--tx)] shadow-sm'
                        : 'text-[var(--mu)] hover:text-[var(--tx)]'
                    }`}
                  >
                    Archivar Legacy + Trigger Patch
                  </button>
                  <button
                    type="button"
                    onClick={() => setSqlTab('schema')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                      sqlTab === 'schema'
                        ? 'bg-cd text-[var(--tx)] shadow-sm'
                        : 'text-[var(--mu)] hover:text-[var(--tx)]'
                    }`}
                  >
                    Instalación Completa
                  </button>
                </div>

                <button
                  type="button"
                  onClick={copyActiveSql}
                  className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--tx)] text-[var(--cd)] flex items-center gap-1.5"
                >
                  {copiedSql ? <Check size={14} /> : <Copy size={14} />}
                  {copiedSql ? 'Copiado' : 'Copiar SQL'}
                </button>
              </div>

              <p className="text-xs text-[var(--mu)]">
                {sqlTab === 'reset'
                  ? 'Cierra los pedidos entregados antiguos sin tocar saldos de cuentas y desactiva el auto-cobro al pasar a Entregado.'
                  : 'Crea el esquema completo finance desde cero.'}
              </p>

              <pre className="p-4 rounded-lg bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800 leading-relaxed">
                {sqlTab === 'reset' ? FINANCE_RESET_AND_PATCH_SQL : SPRINT2_SQL_CODE}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
