-- ============================================================================
-- TODOENUNO OS — SPRINT 4: MÓDULO DE PEDIDOS PRO & LOGÍSTICA CONTRA ENTREGA
-- Ejecutar en: Supabase SQL Editor (Opcional, el panel cuenta con soporte híbrido y tolerancia a fallos)
-- ============================================================================

-- 1. Agregar columnas para gestión de couriers, liquidación y logística inversa
alter table if exists public.whatsapp_orders
  add column if not exists courier text default 'Sin asignar',
  add column if not exists departamento text default 'San Salvador',
  add column if not exists motivo_cancelacion text,
  add column if not exists liquidado boolean default false,
  add column if not exists liquidado_at timestamptz,
  add column if not exists cuenta_liquidacion text,
  add column if not exists origen text default 'whatsapp_bot';

-- 2. Asegurar permisos RLS
do $$
begin
  if exists (select from pg_tables where schemaname = 'public' and tablename = 'whatsapp_orders') then
    grant select, insert, update, delete on public.whatsapp_orders to anon, authenticated, service_role;
  end if;
end;
$$;

select 'Columnas de Logística Pro para Pedidos configuradas exitosamente' as resultado;
