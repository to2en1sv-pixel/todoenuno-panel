import React, { useState, useEffect, useMemo } from 'react';
import { 
  Wallet, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Plus, 
  Receipt, 
  PieChart, 
  ArrowUpRight, 
  ArrowDownRight, 
  Calendar, 
  AlertCircle, 
  CheckCircle2, 
  Pencil, 
  Trash2, 
  Filter, 
  Search, 
  Code, 
  Copy, 
  Check, 
  X, 
  Layers, 
  Sparkles,
  CreditCard,
  Building,
  Coins,
  RefreshCw,
  Megaphone,
  ExternalLink
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { 
  fetchCashAccounts, 
  fetchBudgets, 
  fetchMoneyTransactions, 
  addManualTransaction, 
  saveBudget,
  updateCashAccountBalance,
  deleteMoneyTransaction
} from '@/lib/finance';
import type { 
  CashAccount, 
  MoneyTransaction, 
  Budget, 
  TransactionType 
} from '@/types/finance';

// Tipo de pagos fijos de la versión previa
type PagoFijo = {
  id: string;
  nombre: string;
  monto: number;
  moneda: string;
  fecha_vencimiento: string;
  frecuencia: string;
  categoria: string;
};

const SPRINT2_SQL_CODE = `-- ============================================================================
-- TODOENUNO OS — SPRINT 2: MONEY ENGINE & CONTROL DE PRESUPUESTOS (BUDGETS)
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
  ('caja_efectivo',   'Efectivo Repartidores (Contraentrega)', 'cash',        640.00,  'USD', '#10b981'),
  ('banco_principal', 'Banco Agrícola (Cuenta Principal)',    'bank',        2850.50, 'USD', '#3b82f6'),
  ('caja_chica',      'Caja Chica de Oficina',                'cash',        125.00,  'USD', '#f59e0b'),
  ('tarjeta_pauta',   'Tarjeta Débito Meta Ads',              'credit_card', 450.00,  'USD', '#8b5cf6')
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

insert into finance.budgets (id, periodo, categoria, monto_presupuestado, notas) values
  ('2026-11-marketing', '2026-11', 'Marketing & Pauta Meta', 1200.00, 'Presupuesto mensual Meta y TikTok'),
  ('2026-11-envios',    '2026-11', 'Envíos y Logística',      500.00, 'Fletes y pagos a mensajeros'),
  ('2026-11-empaque',   '2026-11', 'Suministros y Empaque',   250.00, 'Bolsas Kraft y cinta'),
  ('2026-11-operativo', '2026-11', 'Nómina y Operaciones',    800.00, 'Operador de empaque y servicios')
on conflict (id) do nothing;

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
  v_total numeric;
  v_order_code text;
  v_client text;
  v_amount numeric;
  v_campaign text;
begin
  if NEW.type = 'order.delivered' then
    v_total      := coalesce((NEW.payload->>'total')::numeric, 0);
    v_order_code := coalesce(NEW.payload->>'pedido_codigo', NEW.source_id);
    v_client     := coalesce(NEW.payload->>'nombre_cliente', 'Cliente');

    if v_total > 0 then
      insert into finance.money_transactions (
        account_id, tipo, categoria, monto, descripcion, fecha, source_event_id, source_table, source_id, es_manual
      ) values (
        'caja_efectivo', 'income', 'venta_pedido', v_total,
        'Cobro liquidado pedido ' || v_order_code || ' (' || v_client || ')',
        current_date, NEW.id, NEW.source_table, NEW.source_id, false
      );

      update finance.cash_accounts
         set saldo_actual = saldo_actual + v_total
       where id = 'caja_efectivo';
    end if;

  elsif NEW.type = 'marketing.ad.expense' then
    v_amount   := coalesce((NEW.payload->>'amount')::numeric, 0);
    v_campaign := coalesce(NEW.payload->>'campaign_id', 'Campaña');

    if v_amount > 0 then
      insert into finance.money_transactions (
        account_id, tipo, categoria, monto, descripcion, fecha, source_event_id, source_table, source_id, es_manual
      ) values (
        'tarjeta_pauta', 'expense', 'pauta_publicidad', v_amount,
        'Gasto publicitario diario ' || v_campaign,
        current_date, NEW.id, NEW.source_table, NEW.source_id, false
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

-- Trigger sobre gastos_publicidad (Marketing Event Producer)
create or replace function os.gastos_publicidad_events() returns trigger
language plpgsql security definer set search_path = os, public as $$
begin
  if TG_OP = 'INSERT' then
    perform os.emit_event(
      'marketing.ad.expense',
      'gastos_publicidad',
      NEW.id::text,
      'gastos_publicidad:' || NEW.id || ':' || coalesce(NEW.fecha::text, current_date::text),
      jsonb_build_object(
        'gasto_id', NEW.id,
        'campaign_id', coalesce(NEW.codigo_anuncio, 'META_AD'),
        'codigo_anuncio', NEW.codigo_anuncio,
        'platform', coalesce(NEW.plataforma, 'meta'),
        'amount', NEW.monto,
        'date', NEW.fecha,
        'notas', NEW.notas
      )
    );
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_gastos_publicidad_events on public.gastos_publicidad;
create trigger trg_gastos_publicidad_events
  after insert on public.gastos_publicidad
  for each row execute function os.gastos_publicidad_events();

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

export function FinanzasPage() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'budgets' | 'transactions' | 'fixed_payments'>('dashboard');

  // Datos financieros
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [transactions, setTransactions] = useState<MoneyTransaction[]>([]);
  const [isRealDb, setIsRealDb] = useState(false);
  const [loading, setLoading] = useState(true);

  // Pagos Fijos (Suscripciones previas)
  const [pagosFijos, setPagosFijos] = useState<PagoFijo[]>([]);
  const [showPagoFijoForm, setShowPagoFijoForm] = useState(false);
  const [editingPagoFijoId, setEditingPagoFijoId] = useState<string | null>(null);
  const [pagoFijoNombre, setPagoFijoNombre] = useState('');
  const [pagoFijoMonto, setPagoFijoMonto] = useState('');
  const [pagoFijoFecha, setPagoFijoFecha] = useState('');
  const [pagoFijoCategoria, setPagoFijoCategoria] = useState('software');
  const [pagoFijoFrecuencia, setPagoFijoFrecuencia] = useState('mensual');

  // Modal de Transacción Manual (Gastos / Pagos)
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualTipo, setManualTipo] = useState<TransactionType>('expense');
  const [manualMonto, setManualMonto] = useState('');
  const [manualDescripcion, setManualDescripcion] = useState('');
  const [manualCategoria, setManualCategoria] = useState('gasto_manual');
  const [manualAccountId, setManualAccountId] = useState('caja_chica');
  const [manualFecha, setManualFecha] = useState(new Date().toISOString().slice(0, 10));
  const [manualCodigoAnuncio, setManualCodigoAnuncio] = useState('');
  const [isSavingManual, setIsSavingManual] = useState(false);

  // Modal de Presupuesto
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [budgetCategoria, setBudgetCategoria] = useState('');
  const [budgetMonto, setBudgetMonto] = useState('');
  const [budgetNotas, setBudgetNotas] = useState('');
  const [isSavingBudget, setIsSavingBudget] = useState(false);

  // Modal SQL Sprint 2
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Filtros de transacciones
  const [filterTipo, setFilterTipo] = useState<'all' | 'income' | 'expense' | 'manual'>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modal de Ajuste de Saldo de Cuenta
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [adjustAccount, setAdjustAccount] = useState<CashAccount | null>(null);
  const [adjustSaldo, setAdjustSaldo] = useState('');
  const [isSavingAdjust, setIsSavingAdjust] = useState(false);

  const handleSaveAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustAccount || !adjustSaldo) return;
    setIsSavingAdjust(true);
    await updateCashAccountBalance(adjustAccount.id, parseFloat(adjustSaldo));
    setIsSavingAdjust(false);
    setShowAdjustModal(false);
    await loadFinanceData(true);
  };

  // Manejo de eliminación de transacciones
  const [deletingTxId, setDeletingTxId] = useState<number | string | null>(null);

  const handleDeleteTransaction = async (tx: MoneyTransaction) => {
    const desc = tx.descripcion || 'esta transacción';
    const monto = Number(tx.monto).toFixed(2);
    const signo = tx.tipo === 'income' ? '+' : '-';
    const revertirTexto = tx.tipo === 'expense' 
      ? `Se devolverán $${monto} al saldo de la cuenta.` 
      : `Se restarán $${monto} del saldo de la cuenta.`;

    const confirmado = window.confirm(
      `¿Deseas eliminar la transacción "${desc}" (${signo}$${monto})?\n\n${revertirTexto}`
    );
    if (!confirmado) return;

    setDeletingTxId(tx.id);
    await deleteMoneyTransaction(tx.id);
    await loadFinanceData(true);
    setDeletingTxId(null);
  };

  // Carga de datos
  const loadFinanceData = async (silent = false) => {
    if (!silent) setLoading(true);
    const [accData, budData, txData] = await Promise.all([
      fetchCashAccounts(),
      fetchBudgets(),
      fetchMoneyTransactions()
    ]);

    setAccounts(accData.accounts);
    setBudgets(budData.budgets);
    setTransactions(txData.transactions);
    setIsRealDb(accData.isRealDb || txData.isRealDb);

    // Cargar suscripciones fijas desde panel_pagos
    try {
      const { data } = await supabase.from('panel_pagos').select('*').order('fecha_vencimiento', { ascending: true });
      if (data) setPagosFijos(data);
    } catch {
      // fallback
    }

    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadFinanceData();
  }, []);

  // Cálculos consolidados
  const saldoTotalCuentas = useMemo(() => {
    return accounts.reduce((sum, a) => sum + (a.saldo_actual || 0), 0);
  }, [accounts]);

  const metricasMes = useMemo(() => {
    let ingresos = 0;
    let egresos = 0;

    transactions.forEach(tx => {
      if (tx.tipo === 'income') ingresos += Number(tx.monto) || 0;
      if (tx.tipo === 'expense') egresos += Number(tx.monto) || 0;
    });

    const utilidadNeta = ingresos - egresos;
    const margen = ingresos > 0 ? (utilidadNeta / ingresos) * 100 : 0;

    return { ingresos, egresos, utilidadNeta, margen };
  }, [transactions]);

  // Presupuestos con cálculo reactivo del gasto real del mes
  const budgetsWithRealSpent = useMemo(() => {
    return budgets.map(b => {
      const isMarketing = b.categoria.toLowerCase().includes('marketing') || b.categoria.toLowerCase().includes('pauta');
      const isEnvios = b.categoria.toLowerCase().includes('envio') || b.categoria.toLowerCase().includes('logist');
      const isEmpaque = b.categoria.toLowerCase().includes('empaque') || b.categoria.toLowerCase().includes('suministro');
      const isOperativo = b.categoria.toLowerCase().includes('operat') || b.categoria.toLowerCase().includes('nomina');

      let gastoReal = 0;
      transactions.forEach(t => {
        if (t.tipo !== 'expense') return;
        const cat = (t.categoria || '').toLowerCase();
        if (isMarketing && (cat.includes('pauta') || cat.includes('marketing') || t.account_id === 'tarjeta_pauta')) {
          gastoReal += Number(t.monto) || 0;
        } else if (isEnvios && (cat.includes('flete') || cat.includes('envio'))) {
          gastoReal += Number(t.monto) || 0;
        } else if (isEmpaque && (cat.includes('empaque') || cat.includes('bolsa') || cat.includes('suministro'))) {
          gastoReal += Number(t.monto) || 0;
        } else if (isOperativo && (cat.includes('nomina') || cat.includes('sueldo') || cat.includes('operat'))) {
          gastoReal += Number(t.monto) || 0;
        }
      });

      return {
        ...b,
        monto_gastado: gastoReal > 0 ? gastoReal : (b.monto_gastado || 0)
      };
    });
  }, [budgets, transactions]);

  const presupuestoTotal = useMemo(() => {
    const totalPresupuestado = budgetsWithRealSpent.reduce((sum, b) => sum + (b.monto_presupuestado || 0), 0);
    const totalGastado = budgetsWithRealSpent.reduce((sum, b) => sum + (b.monto_gastado || 0), 0);
    const pct = totalPresupuestado > 0 ? (totalGastado / totalPresupuestado) * 100 : 0;
    return { totalPresupuestado, totalGastado, pct };
  }, [budgetsWithRealSpent]);

  // Manejo de Registro Manual
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
      codigo_anuncio: manualCategoria === 'pauta_publicidad' ? manualCodigoAnuncio : undefined
    });

    setIsSavingManual(false);
    setShowManualModal(false);
    setManualMonto('');
    setManualDescripcion('');
    setManualCodigoAnuncio('');
    await loadFinanceData(true);
  };

  // Manejo de Presupuesto
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
      notas: budgetNotas
    });

    setIsSavingBudget(false);
    setShowBudgetModal(false);
    setBudgetCategoria('');
    setBudgetMonto('');
    setBudgetNotas('');
    await loadFinanceData(true);
  };

  // Manejo de Pagos Fijos (Suscripciones)
  const handleSavePagoFijo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pagoFijoNombre || !pagoFijoMonto || !pagoFijoFecha) return;

    const dataToSave = {
      nombre: pagoFijoNombre,
      monto: parseFloat(pagoFijoMonto),
      fecha_vencimiento: pagoFijoFecha,
      categoria: pagoFijoCategoria,
      frecuencia: pagoFijoFrecuencia
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
    loadFinanceData(true);
  };

  const handlePagarSuscripcion = async (pago: PagoFijo) => {
    let nuevaFecha = new Date(pago.fecha_vencimiento + 'T12:00:00');
    if (pago.frecuencia === 'mensual') nuevaFecha.setMonth(nuevaFecha.getMonth() + 1);
    else if (pago.frecuencia === 'anual') nuevaFecha.setFullYear(nuevaFecha.getFullYear() + 1);

    const nuevaFechaStr = nuevaFecha.toISOString().split('T')[0];
    await supabase.from('panel_pagos').update({ fecha_vencimiento: nuevaFechaStr }).eq('id', pago.id);

    // Asentar automáticamente como gasto manual en el libro diario
    await addManualTransaction({
      account_id: 'banco_principal',
      tipo: 'expense',
      categoria: 'suscripciones',
      monto: pago.monto,
      descripcion: `Pago recurrente suscripción ${pago.nombre}`,
      fecha: new Date().toISOString().slice(0, 10)
    });

    loadFinanceData(true);
  };

  const handleDeletePagoFijo = async (id: string) => {
    if (!confirm('¿Eliminar esta suscripción de la lista?')) return;
    await supabase.from('panel_pagos').delete().eq('id', id);
    loadFinanceData(true);
  };

  // Filtrado de transacciones
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      if (filterTipo === 'income' && t.tipo !== 'income') return false;
      if (filterTipo === 'expense' && t.tipo !== 'expense') return false;
      if (filterTipo === 'manual' && !t.es_manual) return false;

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const descMatch = t.descripcion.toLowerCase().includes(term);
        const catMatch = t.categoria.toLowerCase().includes(term);
        const accMatch = (t.account_nombre || t.account_id).toLowerCase().includes(term);
        if (!descMatch && !catMatch && !accMatch) return false;
      }
      return true;
    });
  }, [transactions, filterTipo, searchTerm]);

  const copySql = () => {
    navigator.clipboard.writeText(SPRINT2_SQL_CODE);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  const getAccountIcon = (tipo: string) => {
    switch (tipo) {
      case 'bank': return <Building size={18} className="text-blue-500" />;
      case 'credit_card': return <CreditCard size={18} className="text-purple-500" />;
      default: return <Coins size={18} className="text-emerald-500" />;
    }
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6 pb-14">
      {/* Encabezado General */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center bg-cd p-5 rounded-2xl border border-[var(--bd)] gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Wallet className="text-[var(--ac)]" size={24} />
            <h1 className="text-2xl font-black">Finanzas & Money Engine</h1>
            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
              Sprint 2
            </span>
          </div>
          <p className="text-xs text-[var(--mu)] mt-1">
            Gestión de liquidez, cuentas de dinero, control de presupuestos y registro de gastos/pagos manuales.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={() => {
              setManualTipo('expense');
              setShowManualModal(true);
            }}
            className="flex-1 sm:flex-none px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 shadow-sm"
          >
            <Plus size={15} /> Registrar Gasto / Pago Manual
          </button>

          <button
            onClick={() => setShowSqlModal(true)}
            className="px-3 py-2 border border-[var(--bd)] rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-sf transition-colors"
          >
            <Code size={14} /> SQL Sprint 2
          </button>
        </div>
      </div>

      {/* Selector de Pestañas */}
      <div className="flex items-center p-1 bg-sf rounded-xl border border-[var(--bd)] overflow-x-auto">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-colors ${
            activeTab === 'dashboard' ? 'bg-cd text-[var(--tx)] shadow-sm' : 'text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          <DollarSign size={14} /> Cuentas & Liquidez
        </button>
        <button
          onClick={() => setActiveTab('budgets')}
          className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-colors ${
            activeTab === 'budgets' ? 'bg-cd text-[var(--tx)] shadow-sm' : 'text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          <PieChart size={14} /> Presupuestos (Budgets)
        </button>
        <button
          onClick={() => setActiveTab('transactions')}
          className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-colors ${
            activeTab === 'transactions' ? 'bg-cd text-[var(--tx)] shadow-sm' : 'text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          <Receipt size={14} /> Libro de Movimientos ({transactions.length})
        </button>
        <button
          onClick={() => setActiveTab('fixed_payments')}
          className={`px-4 py-2 rounded-lg text-xs font-bold whitespace-nowrap flex items-center gap-2 transition-colors ${
            activeTab === 'fixed_payments' ? 'bg-cd text-[var(--tx)] shadow-sm' : 'text-[var(--mu)] hover:text-[var(--tx)]'
          }`}
        >
          <Calendar size={14} /> Suscripciones Fijas ({pagosFijos.length})
        </button>
      </div>

      {/* PESTAÑA 1: CUENTAS & LIQUIDEZ */}
      {activeTab === 'dashboard' && (
        <div className="flex flex-col gap-6">
          {/* Tarjetas KPI Superiores */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
              <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Saldo Total Disponible</span>
              <div className="text-2xl font-black mt-1 text-emerald-600 dark:text-emerald-400">
                ${saldoTotalCuentas.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] tx-mu mt-1 block">En {accounts.length} cuentas activas</span>
            </div>

            <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
              <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Ingresos del Mes</span>
              <div className="text-2xl font-black mt-1 flex items-center gap-1 text-emerald-500">
                <ArrowUpRight size={20} />
                ${metricasMes.ingresos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] tx-mu mt-1 block">Cobros y abonos</span>
            </div>

            <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
              <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Egresos del Mes</span>
              <div className="text-2xl font-black mt-1 flex items-center gap-1 text-rose-500">
                <ArrowDownRight size={20} />
                ${metricasMes.egresos.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] tx-mu mt-1 block">Pauta + envíos + compras</span>
            </div>

            <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)]">
              <span className="text-[10px] tx-mu uppercase font-bold tracking-wider block">Utilidad Neta Libre</span>
              <div className="text-2xl font-black mt-1 text-[var(--ac)]">
                ${metricasMes.utilidadNeta.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
              <span className="text-[10px] tx-mu mt-1 block">Margen: {metricasMes.margen.toFixed(1)}%</span>
            </div>
          </div>

          {/* Cuentas de Dinero (Billeteras) */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold uppercase tracking-wider tx-mu flex items-center gap-2">
                <Coins size={16} /> Cuentas de Dinero y Billeteras
              </h2>
              <span className="text-xs text-[var(--mu)]">Actualizadas por eventos en tiempo real</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {accounts.map(acc => (
                <div key={acc.id} className="p-5 bg-cd border border-[var(--bd)] rounded-2xl flex flex-col justify-between shadow-sm relative overflow-hidden group">
                  <div className="flex items-start justify-between">
                    <div className="p-2.5 bg-sf rounded-xl border border-[var(--bd)]">
                      {getAccountIcon(acc.tipo)}
                    </div>
                    <span className="text-[10px] font-mono uppercase bg-sf px-2 py-0.5 rounded-full border border-[var(--bd)] tx-mu">
                      {acc.tipo}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="font-bold text-sm text-[var(--tx)] truncate">{acc.nombre}</h3>
                    <div className="text-xl font-black mt-1" style={{ color: acc.color || 'var(--tx)' }}>
                      ${acc.saldo_actual.toLocaleString('en-US', { minimumFractionDigits: 2 })} {acc.moneda}
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t border-[var(--bd)] flex items-center justify-between text-[11px] tx-mu">
                    <button
                      onClick={() => {
                        setAdjustAccount(acc);
                        setAdjustSaldo(String(acc.saldo_actual));
                        setShowAdjustModal(true);
                      }}
                      className="hover:text-[var(--tx)] hover:underline flex items-center gap-1 font-medium transition-colors"
                    >
                      <Pencil size={11} /> Ajustar Saldo
                    </button>
                    <button
                      onClick={() => {
                        setManualAccountId(acc.id);
                        setShowManualModal(true);
                      }}
                      className="text-[var(--ac)] hover:underline font-bold"
                    >
                      + Movimiento
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card de Conexión de Pauta Publicitaria Meta Ads */}
          <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-500/10 via-purple-500/5 to-transparent border border-purple-500/20 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-600 dark:text-purple-400">
                <Megaphone size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-sm text-[var(--tx)]">Conexión Pauta Publicitaria (Meta Ads / TikTok)</h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-600 dark:text-purple-300">
                    Fase 4 Activa
                  </span>
                </div>
                <p className="text-xs tx-mu mt-0.5">
                  Los gastos en publicidad descuentan de la <strong>Tarjeta Débito Meta Ads</strong>, alimentan el <strong>Event Stream</strong> y calculan el ROAS por anuncio.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => {
                  setManualTipo('expense');
                  setManualCategoria('pauta_publicidad');
                  setManualAccountId('tarjeta_pauta');
                  setShowManualModal(true);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Plus size={14} /> Registrar Pauta
              </button>
              <a
                href="/rentabilidad"
                className="px-3.5 py-1.5 rounded-xl border border-[var(--bd)] bg-sf hover:bg-cd text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                Ver ROAS & Anuncios <ExternalLink size={12} />
              </a>
            </div>
          </div>

          {/* Resumen rápido de últimos movimientos */}
          <div className="bg-cd border border-[var(--bd)] rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Receipt size={16} className="text-[var(--ac)]" /> Últimos Movimientos Asentados
              </h3>
              <button onClick={() => setActiveTab('transactions')} className="text-xs text-[var(--ac)] hover:underline font-bold">
                Ver todos los movimientos →
              </button>
            </div>

            <div className="divide-y divide-[var(--bd)]">
              {transactions.slice(0, 5).map(tx => (
                <div key={tx.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`p-2 rounded-xl shrink-0 ${tx.tipo === 'income' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-rose-500/10 text-rose-500'}`}>
                      {tx.tipo === 'income' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold truncate text-[var(--tx)]">{tx.descripcion}</div>
                      <div className="text-[10px] tx-mu mt-0.5 flex items-center gap-2">
                        <span>{tx.fecha}</span>
                        <span>•</span>
                        <span className="capitalize">{tx.account_nombre || tx.account_id}</span>
                        <span>•</span>
                        <span className="font-mono">{tx.es_manual ? '✍️ Manual' : '🤖 Automático'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className={`font-mono font-bold text-sm ${tx.tipo === 'income' ? 'text-emerald-500' : 'text-rose-500'}`}>
                      {tx.tipo === 'income' ? '+' : '-'}${Number(tx.monto).toFixed(2)}
                    </div>
                    <button
                      onClick={() => handleDeleteTransaction(tx)}
                      disabled={deletingTxId === tx.id}
                      title="Eliminar movimiento y revertir saldo"
                      className="p-1.5 text-[var(--mu)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 2: CONTROL DE PRESUPUESTOS (BUDGETS) */}
      {activeTab === 'budgets' && (
        <div className="flex flex-col gap-6">
          {/* Header de Presupuestos */}
          <div className="bg-cd border border-[var(--bd)] rounded-2xl p-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div>
              <h2 className="text-base font-bold flex items-center gap-2">
                <PieChart size={18} className="text-[var(--ac)]" /> Control Mensual de Presupuesto
              </h2>
              <p className="text-xs tx-mu mt-0.5">
                Define límites de gasto por categoría para evitar sobrecostos en pauta, empaque y mensajería.
              </p>
            </div>

            <button
              onClick={() => setShowBudgetModal(true)}
              className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold flex items-center gap-2 hover:opacity-90"
            >
              <Plus size={15} /> Nuevo Presupuesto
            </button>
          </div>

          {/* Barra Global de Presupuesto Consumido */}
          <div className="p-5 bg-cd border border-[var(--bd)] rounded-2xl">
            <div className="flex justify-between items-end mb-2">
              <div>
                <span className="text-[11px] tx-mu font-bold uppercase">Ejecución Global del Presupuesto</span>
                <div className="text-2xl font-black mt-0.5">
                  ${presupuestoTotal.totalGastado.toFixed(2)} <span className="text-sm font-normal tx-mu">de ${presupuestoTotal.totalPresupuestado.toFixed(2)}</span>
                </div>
              </div>
              <span className={`text-sm font-black ${presupuestoTotal.pct > 90 ? 'text-rose-500' : presupuestoTotal.pct > 75 ? 'text-amber-500' : 'text-emerald-500'}`}>
                {presupuestoTotal.pct.toFixed(1)}% Usado
              </span>
            </div>

            <div className="w-full bg-sf rounded-full h-3 overflow-hidden border border-[var(--bd)]">
              <div 
                className={`h-full transition-all duration-500 ${
                  presupuestoTotal.pct > 90 ? 'bg-rose-500' : presupuestoTotal.pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'
                }`}
                style={{ width: `${Math.min(presupuestoTotal.pct, 100)}%` }}
              />
            </div>
          </div>

          {/* Lista de Presupuestos por Categoría */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {budgetsWithRealSpent.map(b => {
              const gastado = b.monto_gastado || 0;
              const pct = b.monto_presupuestado > 0 ? (gastado / b.monto_presupuestado) * 100 : 0;
              const saldoRestante = b.monto_presupuestado - gastado;

              return (
                <div key={b.id} className="p-5 bg-cd border border-[var(--bd)] rounded-2xl flex flex-col justify-between shadow-sm">
                  <div>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-bold text-sm text-[var(--tx)]">{b.categoria}</h3>
                      <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${
                        pct > 90 ? 'bg-rose-500/10 text-rose-600 border-rose-500/30' :
                        pct > 75 ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' :
                        'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                      }`}>
                        {pct.toFixed(0)}%
                      </span>
                    </div>

                    <div className="flex items-baseline justify-between mt-3 text-xs">
                      <span className="font-mono text-base font-black text-[var(--tx)]">
                        ${gastado.toFixed(2)}
                      </span>
                      <span className="tx-mu">
                        Límite: ${b.monto_presupuestado.toFixed(2)}
                      </span>
                    </div>

                    <div className="w-full bg-sf rounded-full h-2 mt-2 overflow-hidden border border-[var(--bd)]">
                      <div 
                        className={`h-full transition-all ${
                          pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>

                    <div className="mt-3 flex justify-between items-center text-[11px] tx-mu">
                      <span>Restante: ${Math.max(saldoRestante, 0).toFixed(2)}</span>
                      {b.notas && <span className="italic truncate max-w-[200px]">"{b.notas}"</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* PESTAÑA 3: LIBRO DIARIO DE MOVIMIENTOS */}
      {activeTab === 'transactions' && (
        <div className="flex flex-col gap-4">
          <div className="bg-cd border border-[var(--bd)] rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            {/* Filtros */}
            <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
              {[
                { id: 'all', label: 'Todos' },
                { id: 'income', label: '🟢 Ingresos' },
                { id: 'expense', label: '🔴 Egresos' },
                { id: 'manual', label: '✍️ Solo Manuales' },
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setFilterTipo(f.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    filterTipo === f.id ? 'bg-[var(--tx)] text-[var(--cd)]' : 'text-[var(--mu)] hover:bg-sf'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Buscador */}
            <div className="relative w-full sm:w-64">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 tx-mu" />
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Buscar por concepto o cuenta..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-sf border border-[var(--bd)] text-xs outline-none"
              />
            </div>
          </div>

          {/* Tabla de Movimientos */}
          <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-sf border-b border-[var(--bd)] text-[10px] tx-mu uppercase font-bold">
                  <tr>
                    <th className="py-3 px-4">Fecha</th>
                    <th className="py-3 px-4">Concepto / Descripción</th>
                    <th className="py-3 px-4">Cuenta</th>
                    <th className="py-3 px-4">Categoría</th>
                    <th className="py-3 px-4">Origen</th>
                    <th className="py-3 px-4 text-right">Monto</th>
                    <th className="py-3 px-4 text-center">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--bd)]">
                  {filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center tx-mu">
                        No se encontraron transacciones con los filtros seleccionados.
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map(tx => (
                      <tr key={tx.id} className="hover:bg-sf/50 transition-colors">
                        <td className="py-3 px-4 font-mono whitespace-nowrap">{tx.fecha}</td>
                        <td className="py-3 px-4 font-medium text-[var(--tx)] max-w-xs truncate">
                          {tx.descripcion}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap capitalize">
                          {tx.account_nombre || tx.account_id}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="px-2 py-0.5 rounded-md bg-sf border border-[var(--bd)] text-[10px] font-mono">
                            {tx.categoria}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                            tx.es_manual ? 'bg-amber-500/10 text-amber-600' : 'bg-blue-500/10 text-blue-600'
                          }`}>
                            {tx.es_manual ? '✍️ Manual' : '🤖 OS Event'}
                          </span>
                        </td>
                        <td className={`py-3 px-4 font-mono font-bold text-right whitespace-nowrap ${
                          tx.tipo === 'income' ? 'text-emerald-500' : 'text-rose-500'
                        }`}>
                          {tx.tipo === 'income' ? '+' : '-'}${Number(tx.monto).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-center whitespace-nowrap">
                          <button
                            onClick={() => handleDeleteTransaction(tx)}
                            disabled={deletingTxId === tx.id}
                            title="Eliminar transacción y revertir saldo"
                            className="p-1.5 text-[var(--mu)] hover:text-rose-500 hover:bg-rose-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* PESTAÑA 4: SUSCRIPCIONES Y PAGOS FIJOS (Preservada y Mejorada) */}
      {activeTab === 'fixed_payments' && (
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center bg-cd p-4 rounded-2xl border border-[var(--bd)]">
            <div>
              <h3 className="font-bold text-sm">Calendario de Pagos Recurrentes</h3>
              <p className="text-xs tx-mu mt-0.5">Software, hosting y suscripciones mensuales con recordatorios.</p>
            </div>
            <button
              onClick={() => setShowPagoFijoForm(true)}
              className="px-3 py-1.5 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <Plus size={14} /> Nueva Suscripción
            </button>
          </div>

          {showPagoFijoForm && (
            <form onSubmit={handleSavePagoFijo} className="bg-cd border border-[var(--bd)] rounded-2xl p-5 shadow-sm space-y-3">
              <h4 className="font-bold text-xs uppercase tx-mu">{editingPagoFijoId ? 'Editar Suscripción' : 'Nueva Suscripción'}</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input placeholder="Nombre (Ej. DigitalOcean)" value={pagoFijoNombre} onChange={e=>setPagoFijoNombre(e.target.value)} className="bg-sf border border-[var(--bd)] rounded-xl px-3 py-2 text-xs outline-none" required />
                <input placeholder="Monto ($)" type="number" step="0.01" value={pagoFijoMonto} onChange={e=>setPagoFijoMonto(e.target.value)} className="bg-sf border border-[var(--bd)] rounded-xl px-3 py-2 text-xs outline-none" required />
                <input type="date" value={pagoFijoFecha} onChange={e=>setPagoFijoFecha(e.target.value)} className="bg-sf border border-[var(--bd)] rounded-xl px-3 py-2 text-xs outline-none" required />
                <select value={pagoFijoFrecuencia} onChange={e=>setPagoFijoFrecuencia(e.target.value)} className="bg-sf border border-[var(--bd)] rounded-xl px-3 py-2 text-xs outline-none">
                  <option value="mensual">Mensual</option>
                  <option value="anual">Anual</option>
                  <option value="unico">Pago Único</option>
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowPagoFijoForm(false)} className="px-3 py-1.5 border border-[var(--bd)] rounded-xl text-xs font-semibold">Cancelar</button>
                <button type="submit" className="px-4 py-1.5 bg-[var(--ac)] text-white rounded-xl text-xs font-bold">Guardar</button>
              </div>
            </form>
          )}

          <div className="bg-cd border border-[var(--bd)] rounded-2xl divide-y divide-[var(--bd)] overflow-hidden shadow-sm">
            {pagosFijos.length === 0 ? (
              <div className="p-8 text-center text-xs tx-mu">No hay suscripciones registradas.</div>
            ) : (
              pagosFijos.map(pago => (
                <div key={pago.id} className="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-500/10 text-blue-500 rounded-xl">
                      <Calendar size={18} />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-[var(--tx)]">{pago.nombre}</div>
                      <div className="text-[10px] tx-mu flex items-center gap-2 mt-0.5">
                        <span className="capitalize">{pago.frecuencia}</span>
                        <span>•</span>
                        <span>Vencimiento: {pago.fecha_vencimiento}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <div className="font-bold font-mono text-sm">${pago.monto.toFixed(2)}</div>
                    <button
                      onClick={() => handlePagarSuscripcion(pago)}
                      className="px-3 py-1 bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 rounded-lg text-xs font-bold flex items-center gap-1 hover:bg-emerald-500/20 transition-colors"
                    >
                      <CheckCircle2 size={12} /> Pagar & Asentar
                    </button>
                    <button onClick={() => handleDeletePagoFijo(pago.id)} className="p-1.5 text-rose-400 hover:text-rose-600 rounded-lg">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* MODAL: REGISTRAR GASTO O PAGO MANUAL (Requerimiento Clave) */}
      {showManualModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowManualModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Receipt size={18} className="text-[var(--ac)]" />
                <h3 className="font-bold text-sm">Registrar Movimiento Manual</h3>
              </div>
              <button onClick={() => setShowManualModal(false)} className="p-1 rounded-lg hover:bg-black/10">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveManualTransaction} className="p-5 space-y-4">
              {/* Selector Tipo: Gasto vs Ingreso */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-sf rounded-xl border border-[var(--bd)]">
                <button
                  type="button"
                  onClick={() => setManualTipo('expense')}
                  className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                    manualTipo === 'expense' ? 'bg-rose-500 text-white shadow-sm' : 'tx-mu'
                  }`}
                >
                  <ArrowDownRight size={14} /> Gasto / Egreso Manual
                </button>
                <button
                  type="button"
                  onClick={() => setManualTipo('income')}
                  className={`py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                    manualTipo === 'income' ? 'bg-emerald-500 text-white shadow-sm' : 'tx-mu'
                  }`}
                >
                  <ArrowUpRight size={14} /> Pago / Ingreso Manual
                </button>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Monto ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={manualMonto}
                  onChange={e => setManualMonto(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-base font-bold outline-none"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Concepto / Descripción *</label>
                <input
                  type="text"
                  value={manualDescripcion}
                  onChange={e => setManualDescripcion(e.target.value)}
                  placeholder="Ej. Gasolina repartidor, 500 bolsas empaque, abono cliente..."
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Cuenta Afectada *</label>
                  <select
                    value={manualAccountId}
                    onChange={e => setManualAccountId(e.target.value)}
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  >
                    {accounts.map(acc => (
                      <option key={acc.id} value={acc.id}>
                        {acc.nombre} (${acc.saldo_actual.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Categoría</label>
                  <select
                    value={manualCategoria}
                    onChange={e => {
                      const val = e.target.value;
                      setManualCategoria(val);
                      if (val === 'pauta_publicidad') {
                        setManualAccountId('tarjeta_pauta');
                      }
                    }}
                    className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  >
                    {manualTipo === 'expense' ? (
                      <>
                        <option value="gasto_manual">Gasto General</option>
                        <option value="pauta_publicidad">📢 Pauta Publicitaria (Meta Ads / TikTok)</option>
                        <option value="flete_envio">Flete / Transporte</option>
                        <option value="empaque_suministros">Empaque / Bolsas</option>
                        <option value="nomina_sueldos">Nómina / Ayudante</option>
                        <option value="pago_proveedor">Pago Proveedor</option>
                        <option value="alquiler_servicios">Servicios / Alquiler</option>
                      </>
                    ) : (
                      <>
                        <option value="abono_manual">Abono de Cliente</option>
                        <option value="devolucion_proveedor">Devolución Proveedor</option>
                        <option value="otro_ingreso">Otro Ingreso</option>
                      </>
                    )}
                  </select>
                </div>
              </div>

              {manualCategoria === 'pauta_publicidad' && (
                <div className="p-3 bg-sf rounded-xl border border-[var(--bd)] space-y-1">
                  <label className="block text-[10px] uppercase font-bold text-purple-600 dark:text-purple-400">
                    Código de Anuncio / Campaña
                  </label>
                  <input
                    type="text"
                    value={manualCodigoAnuncio}
                    onChange={e => setManualCodigoAnuncio(e.target.value.toUpperCase())}
                    placeholder="Ej. PROMO1, CAMP-EMS-01..."
                    className="w-full p-2 rounded-lg border border-[var(--bd)] bg-cd text-xs uppercase outline-none font-mono font-bold"
                  />
                  <span className="text-[10px] tx-mu block">
                    ✨ Se sincronizará automáticamente con el módulo de Rentabilidad & ROAS y afectará la Tarjeta Débito Meta Ads.
                  </span>
                </div>
              )}

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Fecha</label>
                <input
                  type="date"
                  value={manualFecha}
                  onChange={e => setManualFecha(e.target.value)}
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingManual}
                  className="px-5 py-2 bg-[var(--ac)] text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  <Plus size={14} /> {isSavingManual ? 'Guardando...' : 'Asentar Movimiento'}
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
            className="w-full max-w-md rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-bold text-sm">Nuevo Límite de Presupuesto</h3>
              <button onClick={() => setShowBudgetModal(false)} className="p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveBudget} className="p-5 space-y-4">
              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Categoría *</label>
                <input
                  type="text"
                  value={budgetCategoria}
                  onChange={e => setBudgetCategoria(e.target.value)}
                  placeholder="Ej. Marketing Meta, Envíos, Empaque..."
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Monto Límite Mensual ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={budgetMonto}
                  onChange={e => setBudgetMonto(e.target.value)}
                  placeholder="Ej. 1000.00"
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-base font-bold outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Notas / Propósito</label>
                <textarea
                  rows={2}
                  value={budgetNotas}
                  onChange={e => setBudgetNotas(e.target.value)}
                  placeholder="Detalles del objetivo..."
                  className="w-full p-2 rounded-xl border border-[var(--bd)] bg-sf text-xs outline-none resize-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowBudgetModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingBudget}
                  className="px-5 py-2 bg-[var(--ac)] text-white font-bold rounded-xl text-xs flex items-center gap-1.5"
                >
                  Guardar Presupuesto
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL SQL SPRINT 2 */}
      {showSqlModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowSqlModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Code size={18} className="text-emerald-500" />
                <h3 className="font-bold text-sm">Script SQL Sprint 2 — Money Engine & Budgets</h3>
              </div>
              <button onClick={() => setShowSqlModal(false)} className="p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="p-4 bg-sf rounded-xl border border-[var(--bd)] text-xs tx-mu space-y-1">
                <p className="font-semibold text-[var(--tx)]">Instrucciones para Supabase:</p>
                <p>1. Copia el script abajo.</p>
                <p>2. Pégalo en tu SQL Editor de Supabase y presiona <strong>Run</strong>.</p>
                <p>3. Creará el schema <code className="font-mono bg-cd px-1 rounded">finance</code>, las cuentas de dinero, el libro de movimientos y el trigger que proyecta automáticamente pedidos entregados a cobros de caja.</p>
              </div>

              <div className="relative">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-mono tx-mu">docs/20261107_sprint2_money_engine.sql</span>
                  <button
                    onClick={copySql}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm"
                  >
                    {copiedSql ? <Check size={14} /> : <Copy size={14} />}
                    {copiedSql ? '¡Copiado!' : 'Copiar SQL Sprint 2'}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800 leading-relaxed">
                  {SPRINT2_SQL_CODE}
                </pre>
              </div>
            </div>

            <div className="p-4 border-t border-[var(--bd)] bg-sf flex justify-end">
              <button onClick={() => setShowSqlModal(false)} className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: AJUSTAR SALDO DE CUENTA */}
      {showAdjustModal && adjustAccount && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowAdjustModal(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <h3 className="font-bold text-sm">Ajustar Saldo de Cuenta</h3>
              <button onClick={() => setShowAdjustModal(false)} className="p-1 rounded-lg">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveAdjust} className="p-5 space-y-4">
              <div>
                <span className="text-xs font-bold text-[var(--tx)] block">{adjustAccount.nombre}</span>
                <span className="text-[10px] tx-mu">Define el saldo real actual en tu caja o banco.</span>
              </div>

              <div>
                <label className="block text-[10px] uppercase font-bold tx-mu mb-1">Nuevo Saldo ($) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={adjustSaldo}
                  onChange={e => setAdjustSaldo(e.target.value)}
                  placeholder="0.00"
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-lg font-bold outline-none"
                  required
                  autoFocus
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdjustModal(false)}
                  className="px-3 py-1.5 border border-[var(--bd)] rounded-xl text-xs font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSavingAdjust}
                  className="px-4 py-1.5 bg-[var(--ac)] text-white font-bold rounded-xl text-xs flex items-center gap-1.5"
                >
                  {isSavingAdjust ? 'Guardando...' : 'Actualizar Saldo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
