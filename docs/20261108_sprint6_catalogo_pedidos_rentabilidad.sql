-- ============================================================================
-- TODOENUNO OS — SPRINT 6: INTERCONEXIÓN CATÁLOGO <-> PEDIDOS <-> RENTABILIDAD
-- Ejecutar en: Supabase SQL Editor
-- ============================================================================

-- 1. Agregar columna catalogo_sku a whatsapp_orders
-- Permite vincular cualquier orden con el SKU canónico del catálogo, sin importar
-- qué texto libre o variación se use en la guía ("3 pulseras magneticas", "color gris", etc.)
alter table if exists public.whatsapp_orders
  add column if not exists catalogo_sku text;

-- 2. Índice para consultas rápidas por producto del catálogo
create index if not exists idx_whatsapp_orders_catalogo_sku 
  on public.whatsapp_orders(catalogo_sku);

-- 3. Tabla opcional para persistir reglas de atribución y alias de marketing en la base de datos
create table if not exists public.catalogo_atribucion_alias (
  id uuid primary key default gen_random_uuid(),
  catalogo_sku text not null,
  alias text not null,
  tipo text not null default 'texto_pedido' check (tipo in ('texto_pedido', 'codigo_anuncio', 'variante')),
  created_at timestamptz not null default now(),
  unique(catalogo_sku, alias, tipo)
);

-- Habilitar permisos RLS
do $$
begin
  if exists (select from pg_tables where schemaname = 'public' and tablename = 'catalogo_atribucion_alias') then
    grant select, insert, update, delete on public.catalogo_atribucion_alias to anon, authenticated, service_role;
  end if;
  if exists (select from pg_tables where schemaname = 'public' and tablename = 'whatsapp_orders') then
    grant select, insert, update, delete on public.whatsapp_orders to anon, authenticated, service_role;
  end if;
end;
$$;

-- 4. Backfill inicial inteligente para pedidos existentes basados en texto
update public.whatsapp_orders
set catalogo_sku = 'PORTA-BEBES'
where (catalogo_sku is null or catalogo_sku = '')
  and (
    upper(coalesce(sku, '')) like '%PORTA BEBE%'
    or upper(coalesce(sku, '')) like '%PORTABEBES%'
    or upper(coalesce(codigo_anuncio, '')) like '%PORTABEBE%'
  );

update public.whatsapp_orders
set catalogo_sku = 'PULSERA-MAG'
where (catalogo_sku is null or catalogo_sku = '')
  and (
    upper(coalesce(sku, '')) like '%PULSERA%'
    or upper(coalesce(codigo_anuncio, '')) like '%PULMAG%'
  );

update public.whatsapp_orders
set catalogo_sku = 'MINI-MASAJ'
where (catalogo_sku is null or catalogo_sku = '')
  and (
    upper(coalesce(sku, '')) like '%MASAJEADOR%'
    or upper(coalesce(codigo_anuncio, '')) like '%MASAJ%'
  );

update public.whatsapp_orders
set catalogo_sku = 'BANCO-RETRACTIL'
where (catalogo_sku is null or catalogo_sku = '')
  and (
    upper(coalesce(sku, '')) like '%BANCORETRACTIL%'
    or upper(coalesce(sku, '')) like '%BANCO RETRACTIL%'
  );

update public.whatsapp_orders
set catalogo_sku = 'ENCENDEDORES'
where (catalogo_sku is null or catalogo_sku = '')
  and (
    upper(coalesce(sku, '')) like '%ENCENDEDOR%'
  );

select 'Interconexión Catálogo <-> Pedidos <-> Rentabilidad configurada exitosamente' as resultado;
