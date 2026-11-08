-- ============================================================================
-- TODOENUNO OS — FASE 4 / SPRINT 2: MARKETING AD EXPENSE TRIGGER (PAUTA A FINANZAS)
-- Ejecutar en: Supabase SQL Editor
-- 
-- ¿Qué hace este script?
-- 1. Crea el trigger sobre 'gastos_publicidad' para emitir 'marketing.ad.expense' a os.events.
-- 2. Asegura que el Finance Projector tome ese evento y:
--    - Asiente el egreso en 'finance.money_transactions' (cuenta: tarjeta_pauta).
--    - Reste el monto del saldo de 'tarjeta_pauta' (Tarjeta Débito Meta Ads).
--    - Sume el monto gastado al presupuesto de 'Marketing & Pauta Meta' en 'finance.budgets'.
-- ============================================================================

-- 1. Función para emitir evento marketing.ad.expense desde gastos_publicidad
create or replace function os.gastos_publicidad_events() returns trigger
language plpgsql
security definer
set search_path = os, public
as $$
declare
  v_campaign text;
  v_idempotency text;
begin
  if TG_OP = 'INSERT' then
    v_campaign := coalesce(NEW.codigo_anuncio, 'META_AD');
    v_idempotency := 'gastos_publicidad:' || NEW.id || ':' || coalesce(NEW.fecha::text, current_date::text);

    perform os.emit_event(
      'marketing.ad.expense',
      'gastos_publicidad',
      NEW.id::text,
      v_idempotency,
      jsonb_build_object(
        'gasto_id',       NEW.id,
        'campaign_id',    v_campaign,
        'codigo_anuncio', NEW.codigo_anuncio,
        'platform',       coalesce(NEW.plataforma, 'meta'),
        'amount',         NEW.monto,
        'date',           NEW.fecha,
        'notas',          NEW.notas
      )
    );
  end if;

  return NEW;
end;
$$;

-- 2. Trigger sobre gastos_publicidad
drop trigger if exists trg_gastos_publicidad_events on public.gastos_publicidad;
create trigger trg_gastos_publicidad_events
  after insert on public.gastos_publicidad
  for each row execute function os.gastos_publicidad_events();

-- 3. Actualizar Finance Projector para garantizar vinculación completa con tarjeta_pauta y presupuestos
create or replace function finance.project_os_event() returns trigger
language plpgsql security definer as $$
declare
  v_total numeric;
  v_order_code text;
  v_client text;
  v_amount numeric;
  v_campaign text;
  v_periodo text;
begin
  -- Caso 1: Pedido Entregado -> Cobro liquidado en caja_efectivo
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

  -- Caso 2: Gasto de Publicidad (Pauta Meta / TikTok) -> Egreso en tarjeta_pauta
  elsif NEW.type = 'marketing.ad.expense' then
    v_amount   := coalesce((NEW.payload->>'amount')::numeric, 0);
    v_campaign := coalesce(NEW.payload->>'campaign_id', NEW.payload->>'codigo_anuncio', 'Campaña');
    v_periodo  := to_char(coalesce((NEW.payload->>'date')::date, current_date), 'YYYY-MM');

    if v_amount > 0 then
      insert into finance.money_transactions (
        account_id, tipo, categoria, monto, descripcion, fecha, source_event_id, source_table, source_id, es_manual
      ) values (
        'tarjeta_pauta', 'expense', 'pauta_publicidad', v_amount,
        'Gasto publicitario ' || v_campaign || ' (' || coalesce(NEW.payload->>'platform', 'meta') || ')',
        coalesce((NEW.payload->>'date')::date, current_date),
        NEW.id, NEW.source_table, NEW.source_id, false
      );

      -- Descontar saldo de la cuenta tarjeta_pauta
      update finance.cash_accounts
         set saldo_actual = saldo_actual - v_amount
       where id = 'tarjeta_pauta';

      -- Actualizar presupuesto mensual de Marketing si existe
      update finance.budgets
         set monto_gastado = monto_gastado + v_amount
       where periodo = v_periodo
         and (categoria ilike '%marketing%' or categoria ilike '%pauta%');
    end if;
  end if;

  -- Actualizar consumidor
  update os.event_consumers
     set last_event_id = NEW.id, updated_at = now()
   where consumer_name = 'finance_projector';

  return NEW;
end;
$$;

-- 4. Re-enganchar trigger sobre os.events si no existía
drop trigger if exists trg_finance_projector on os.events;
create trigger trg_finance_projector
  after insert on os.events
  for each row execute function finance.project_os_event();

-- Verificación de instalación
select 'Trigger de Pauta y Finance Projector vinculados exitosamente' as resultado;
