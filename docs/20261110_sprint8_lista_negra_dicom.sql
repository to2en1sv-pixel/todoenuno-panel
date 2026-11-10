-- ============================================================================
-- TODOENUNO OS — SPRINT 8: LISTA NEGRA & DICOM INTERNO ANTIFRAUDE (COD EL SALVADOR)
-- Ejecutar en: Supabase SQL Editor (Opcional pero Recomendado para Sincronización Multi-Dispositivo)
-- ============================================================================

-- 1. Tabla de Lista Negra y Boletines de Clientes
create table if not exists public.client_blacklist (
  id uuid primary key default gen_random_uuid(),
  telefono text not null unique,               -- 8 dígitos de El Salvador (ej. 71234567)
  telefono_display text,                       -- Formato visible (+503 7123-4567)
  nombre_cliente text,
  alias_nombres text[] default '{}',
  motivo text not null,
  severidad text not null default 'alta' check (severidad in ('alta', 'media', 'baja')),
  reportado_por text default 'Administración',
  pedido_id uuid,
  activo boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. Índices para consultas ultra rápidas por teléfono y estado
create index if not exists idx_client_blacklist_telefono 
  on public.client_blacklist(telefono);

create index if not exists idx_client_blacklist_activo 
  on public.client_blacklist(activo);

-- 3. Habilitar permisos RLS para lectura y escritura desde la app
alter table public.client_blacklist enable row level security;
grant select, insert, update, delete on public.client_blacklist to anon, authenticated, service_role;

create policy "Acceso completo a client_blacklist"
  on public.client_blacklist for all
  using (true)
  with check (true);

select 'Tabla client_blacklist (DICOM Interno) creada exitosamente' as resultado;
