-- ============================================================================
-- TODOENUNO OS — SPRINT 2: MONEY ENGINE & CONTROL DE PRESUPUESTOS (BUDGETS)
-- Archivo: 20261107_sprint2_money_engine.sql
-- Ejecutar en: Supabase SQL Editor
--
-- Componentes:
--   1. Schema finance
--   2. Cuentas de dinero (finance.cash_accounts)
--   3. Libro de transacciones (finance.money_transactions) con soporte para gastos/pagos manuales
--   4. Control de presupuestos mensuales (finance.budgets)
--   5. Métricas diarias consolidadas (finance.daily_metrics)
--   6. Finance Projector (Trigger consumidor sobre os.events)
--   7. Vistas en schema public para compatibilidad 100% inmediata con PostgREST
--   8. Permisos y RLS
-- ============================================================================

-- 1. Schema finance
create schema if not exists finance;

-- 2. Cuentas de dinero (Billeteras / Bancos / Cajas)
create table if not exists finance.cash_accounts (
  id           text primary key,               -- Ej: 'caja_efectivo', 'banco_principal'
  nombre       text not null,
  tipo         text not null default 'cash',   -- 'cash', 'bank', 'wallet', 'credit_card'
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

-- 3. Libro Diario de Transacciones (Ingresos y Egresos)
create table if not exists finance.money_transactions (
  id              bigint generated always as identity primary key,
  account_id      text not null references finance.cash_accounts(id) on update cascade,
  tipo            text not null check (tipo in ('income', 'expense', 'transfer')),
  categoria       text not null,                 -- 'venta_pedido', 'pauta_publicidad', 'nomina_sueldos', 'gasto_manual', etc.
  monto           numeric(12,2) not null check (monto > 0),
  descripcion     text not null,
  fecha           date not null default current_date,
  source_event_id bigint,                        -- Referencia al evento si fue automático
  source_table    text,                          -- 'whatsapp_orders', 'gastos_publicidad', 'manual'
  source_id       text,
  comprobante_url text,
  es_manual       boolean not null default false, -- TRUE para gastos y cobros manuales introducidos por el usuario
  created_at      timestamptz not null default now()
);

create index if not exists finance_tx_fecha_idx   on finance.money_transactions (fecha desc);
create index if not exists finance_tx_account_idx on finance.money_transactions (account_id);
create index if not exists finance_tx_tipo_idx    on finance.money_transactions (tipo);
create index if not exists finance_tx_manual_idx  on finance.money_transactions (es_manual);

-- 4. Presupuestos Mensuales (Budget Control)
create table if not exists finance.budgets (
  id                  text primary key,          -- Ej: '2026-11-marketing'
  periodo             text not null,             -- 'YYYY-MM', ej: '2026-11'
  categoria           text not null,
  monto_presupuestado numeric(12,2) not null check (monto_presupuestado >= 0),
  notas               text,
  created_at          timestamptz not null default now()
);

create index if not exists finance_budgets_periodo_idx on finance.budgets (periodo);

insert into finance.budgets (id, periodo, categoria, monto_presupuestado, notas) values
  ('2026-11-marketing', '2026-11', 'Marketing & Pauta Meta', 1200.00, 'Presupuesto mensual Meta y TikTok'),
  ('2026-11-envios',    '2026-11', 'Envíos y Logística',      500.00, 'Fletes y pagos a mensajeros'),
  ('2026-11-empaque',   '2026-11', 'Suministros y Empaque',   250.00, 'Bolsas Kraft y cinta'),
  ('2026-11-operativo', '2026-11', 'Nómina y Operaciones',    800.00, 'Operador de empaque y servicios')
on conflict (id) do nothing;

-- 5. Métricas diarias consolidadas (Daily Snapshots)
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

-- 6. Función RPC para actualizar saldos de cuenta al insertar transacciones
create or replace function public.update_account_balance(
  p_account_id text,
  p_delta      numeric
) returns numeric
language plpgsql
security definer
as $$
declare
  v_nuevo_saldo numeric;
begin
  update finance.cash_accounts
     set saldo_actual = saldo_actual + p_delta
   where id = p_account_id
  returning saldo_actual into v_nuevo_saldo;

  return coalesce(v_nuevo_saldo, 0);
end;
$$;

-- 7. CONSUMIDOR: Finance Projector (Trigger sobre os.events)
-- Escucha order.delivered y marketing.ad.expense
create or replace function finance.project_os_event() returns trigger
language plpgsql
security definer
as $$
declare
  v_total numeric;
  v_order_code text;
  v_client text;
  v_amount numeric;
  v_campaign text;
begin
  -- Caso 1: Pedido Entregado -> Ingreso en efectivo contraentrega
  if NEW.type = 'order.delivered' then
    v_total      := coalesce((NEW.payload->>'total')::numeric, 0);
    v_order_code := coalesce(NEW.payload->>'pedido_codigo', NEW.source_id);
    v_client     := coalesce(NEW.payload->>'nombre_cliente', 'Cliente');

    if v_total > 0 then
      insert into finance.money_transactions (
        account_id, tipo, categoria, monto, descripcion, fecha, source_event_id, source_table, source_id, es_manual
      ) values (
        'caja_efectivo',
        'income',
        'venta_pedido',
        v_total,
        'Cobro liquidado pedido ' || v_order_code || ' (' || v_client || ')',
        current_date,
        NEW.id,
        NEW.source_table,
        NEW.source_id,
        false
      );

      update finance.cash_accounts
         set saldo_actual = saldo_actual + v_total
       where id = 'caja_efectivo';
    end if;

  -- Caso 2: Gasto de Publicidad -> Egreso en tarjeta de pauta
  elsif NEW.type = 'marketing.ad.expense' then
    v_amount   := coalesce((NEW.payload->>'amount')::numeric, 0);
    v_campaign := coalesce(NEW.payload->>'campaign_id', 'Campaña');

    if v_amount > 0 then
      insert into finance.money_transactions (
        account_id, tipo, categoria, monto, descripcion, fecha, source_event_id, source_table, source_id, es_manual
      ) values (
        'tarjeta_pauta',
        'expense',
        'pauta_publicidad',
        v_amount,
        'Gasto publicitario diario ' || v_campaign,
        current_date,
        NEW.id,
        NEW.source_table,
        NEW.source_id,
        false
      );

      update finance.cash_accounts
         set saldo_actual = saldo_actual - v_amount
       where id = 'tarjeta_pauta';
    end if;
  end if;

  -- Actualizar checkpoint de lectura del consumidor
  update os.event_consumers
     set last_event_id = NEW.id,
         updated_at = now()
   where consumer_name = 'finance_projector';

  return NEW;
end;
$$;

drop trigger if exists trg_finance_projector on os.events;
create trigger trg_finance_projector
  after insert on os.events
  for each row execute function finance.project_os_event();

-- 8. Vistas en schema public para compatibilidad 100% con PostgREST
create or replace view public.finance_cash_accounts as select * from finance.cash_accounts;
create or replace view public.finance_money_transactions as select * from finance.money_transactions;
create or replace view public.finance_budgets as select * from finance.budgets;
create or replace view public.finance_daily_metrics as select * from finance.daily_metrics;

-- 9. Permisos y RLS
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

-- Eliminar políticas si existían para evitar error 42710
drop policy if exists "finance_cash_accounts_all"      on finance.cash_accounts;
drop policy if exists "finance_money_transactions_all" on finance.money_transactions;
drop policy if exists "finance_budgets_all"            on finance.budgets;
drop policy if exists "finance_daily_metrics_all"      on finance.daily_metrics;

create policy "finance_cash_accounts_all"      on finance.cash_accounts      for all using (true) with check (true);
create policy "finance_money_transactions_all" on finance.money_transactions for all using (true) with check (true);
create policy "finance_budgets_all"            on finance.budgets            for all using (true) with check (true);
create policy "finance_daily_metrics_all"      on finance.daily_metrics      for all using (true) with check (true);
