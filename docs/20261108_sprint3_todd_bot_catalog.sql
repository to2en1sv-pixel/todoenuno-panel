-- ============================================================================
-- TODOENUNO OS — EXTENSIÓN SPRINT 3: INTELIGENCIA DE CATÁLOGO PARA BOT TODD
-- Preparación de campos de venta por WhatsApp y UniChat
-- Ejecutar en: Supabase SQL Editor (Opcional, el panel ya cuenta con soporte nativo local y DB)
-- ============================================================================

-- 1. Agregar campos de IA y Pitch de ventas a la tabla de productos
alter table if exists public.productos 
  add column if not exists todd_pitch text default '',
  add column if not exists todd_instrucciones text default '',
  add column if not exists todd_keywords text default '',
  add column if not exists activo_todd boolean default true;

-- 2. Asegurar que las políticas de RLS permitan lectura y actualización desde el panel
do $$
begin
  if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos') then
    grant select, insert, update, delete on public.productos to anon, authenticated, service_role;
  end if;
  if exists (select from pg_tables where schemaname = 'public' and tablename = 'productos_variantes') then
    grant select, insert, update, delete on public.productos_variantes to anon, authenticated, service_role;
  end if;
end;
$$;

select 'Columnas de inteligencia para Bot Todd configuradas exitosamente' as resultado;
