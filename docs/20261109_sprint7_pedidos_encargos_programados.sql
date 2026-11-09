-- ============================================================================
-- TODOENUNO OS — SPRINT 7: ENCARGOS & PEDIDOS PROGRAMADOS (ENTREGAS FUTURAS)
-- Ejecutar en: Supabase SQL Editor
-- ============================================================================

-- 1. Agregar columnas para control de encargos y fechas programadas
alter table if exists public.whatsapp_orders
  add column if not exists fecha_programada date,
  add column if not exists es_encargo boolean default false;

-- 2. Crear índice para ordenar y filtrar rápidamente por fecha programada
create index if not exists idx_whatsapp_orders_fecha_programada 
  on public.whatsapp_orders(fecha_programada);

-- 3. Migrar automáticamente órdenes existentes que tengan notas de fecha futura
-- (ej. "para sabado", "para el 15", "quincena", "para fin de mes", "otra semana")
update public.whatsapp_orders
set 
  estado = 'programado',
  es_encargo = true
where estado = 'nuevo'
  and (
    lower(coalesce(notas, '')) like '%para sabado%'
    or lower(coalesce(notas, '')) like '%para el sabado%'
    or lower(coalesce(notas, '')) like '%quincena%'
    or lower(coalesce(notas, '')) like '%para el 15%'
    or lower(coalesce(notas, '')) like '%fin de mes%'
    or lower(coalesce(notas, '')) like '%otra semana%'
    or lower(coalesce(notas, '')) like '%para el lunes%'
    or lower(coalesce(notas, '')) like '%en 15 dias%'
  );

-- 4. Asegurar permisos RLS
grant select, insert, update, delete on public.whatsapp_orders to anon, authenticated, service_role;

select 'Columnas de Encargos y Pedidos Programados configuradas exitosamente' as resultado;
