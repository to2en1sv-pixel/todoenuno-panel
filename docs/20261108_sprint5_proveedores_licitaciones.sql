-- ============================================================================
-- TODOENUNO OS — SPRINT 5: SUBASTA INVERSA, LICITACIONES & DATA INTELLIGENCE
-- Para n8n + Evolution API en WhatsApp
-- Ejecutar en: Supabase SQL Editor (Opcional, el frontend cuenta con soporte tolerante a fallos)
-- ============================================================================

-- 1. Asegurar tabla licitaciones y columnas de adjudicación
create table if not exists public.licitaciones (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  cantidad integer not null default 1,
  imagen_url text,
  precio_referencia numeric(10,2),
  precio_maximo numeric(10,2),
  modo_prueba boolean default false,
  estado text not null default 'pending',
  ganador_proveedor_id text,
  precio_adjudicado numeric(10,2),
  ahorro_total numeric(10,2),
  adjudicado_at timestamptz,
  created_at timestamptz not null default now()
);

alter table if exists public.licitaciones
  add column if not exists ganador_proveedor_id text,
  add column if not exists precio_adjudicado numeric(10,2),
  add column if not exists ahorro_total numeric(10,2),
  add column if not exists adjudicado_at timestamptz;

-- 2. Asegurar tabla licitacion_proveedores y columnas de pujas (bids)
create table if not exists public.licitacion_proveedores (
  id uuid primary key default gen_random_uuid(),
  licitacion_id uuid not null references public.licitaciones(id) on delete cascade,
  proveedor_id uuid not null,
  precio_ofertado numeric(10,2),
  cantidad_disponible integer,
  tiempo_entrega text,
  estado text not null default 'enviado',
  respondido_at timestamptz,
  notas text,
  created_at timestamptz not null default now()
);

alter table if exists public.licitacion_proveedores
  add column if not exists precio_ofertado numeric(10,2),
  add column if not exists cantidad_disponible integer,
  add column if not exists tiempo_entrega text,
  add column if not exists estado text default 'enviado',
  add column if not exists respondido_at timestamptz,
  add column if not exists notas text;

-- 3. Permisos
grant select, insert, update, delete on public.licitaciones to anon, authenticated, service_role;
grant select, insert, update, delete on public.licitacion_proveedores to anon, authenticated, service_role;

select 'Esquema de Licitaciones y Subasta Inversa configurado exitosamente' as resultado;
