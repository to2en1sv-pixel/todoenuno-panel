-- ============================================================================
-- TODOENUNO OS — SPRINT 1: OS Event Store
-- Archivo: 20261107_sprint1_os_event_store.sql
-- Ejecutar en: Supabase SQL Editor
--
-- Alcance:
--   Paso 1: schema os
--   Paso 2: os.events
--   Paso 3: os.event_types (+ os.state_event_map, data-driven)
--   Paso 4: producer con trigger sobre whatsapp_orders (idempotente)
--   Extra : RLS, Realtime para el viewer (Paso 5), queries de verificación
-- ============================================================================

-- ============================================================================
-- PASO 1: schema
-- ============================================================================
create schema if not exists os;

-- ============================================================================
-- PASO 3: registro de tipos de evento (antes que events: es FK)
-- ============================================================================
create table if not exists os.event_types (
  type           text primary key,               -- 'order.created'
  domain         text not null,                  -- 'order'
  description    text,
  payload_schema jsonb,                          -- validación futura (Fase 2)
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);

-- ============================================================================
-- PASO 2: el event store
-- ============================================================================
create table if not exists os.events (
  id              bigint generated always as identity primary key,
  type            text not null references os.event_types(type),
  occurred_at     timestamptz not null default now(),
  source_table    text not null,                 -- trazabilidad: de dónde salió
  source_id       text not null,                 -- id del registro origen
  idempotency_key text not null unique,          -- anti-duplicados (riesgo #2)
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists os_events_type_idx     on os.events (type, occurred_at desc);
create index if not exists os_events_occurred_idx on os.events (occurred_at desc);
create index if not exists os_events_source_idx   on os.events (source_table, source_id);

-- ============================================================================
-- MAPA estado → evento (data-driven: se edita con UPDATE/INSERT, sin tocar código)
-- OJO: confirmar los valores reales de whatsapp_orders.estado. Solo sabemos
-- que el default es 'nuevo'. Agregar/aquí ajustar los que apliquen.
-- ============================================================================
create table if not exists os.state_event_map (
  source_table text not null,
  estado       text not null,
  event_type   text not null references os.event_types(type),
  primary key (source_table, estado)
);

insert into os.event_types (type, domain, description) values
  ('order.created',   'order', 'Nuevo pedido registrado'),
  ('order.confirmed', 'order', 'Pedido confirmado'),
  ('order.shipped',   'order', 'Pedido enviado'),
  ('order.delivered', 'order', 'Pedido entregado'),
  ('order.cancelled', 'order', 'Pedido cancelado')
on conflict (type) do nothing;

insert into os.state_event_map (source_table, estado, event_type) values
  ('whatsapp_orders', 'nuevo',      'order.created'),
  ('whatsapp_orders', 'confirmado', 'order.confirmed'),
  ('whatsapp_orders', 'enviado',    'order.shipped'),
  ('whatsapp_orders', 'entregado',  'order.delivered'),
  ('whatsapp_orders', 'cancelado',  'order.cancelled'),
  ('whatsapp_orders', 'cancelada',  'order.cancelled')
on conflict do nothing;

-- ============================================================================
-- EMISOR central: toda inserción pasa por aquí. ON CONFLICT = idempotencia.
-- ============================================================================
create or replace function os.emit_event(
  p_type            text,
  p_source_table    text,
  p_source_id       text,
  p_idempotency_key text,
  p_payload         jsonb default '{}'::jsonb
) returns bigint
language plpgsql
security definer
set search_path = os, public
as $$
declare
  v_id bigint;
begin
  insert into os.events (type, source_table, source_id, idempotency_key, payload)
  values (p_type, p_source_table, p_source_id, p_idempotency_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return coalesce(v_id, -1);  -- -1 = duplicado, no se insertó
end;
$$;

-- ============================================================================
-- PASO 4: producer — trigger sobre whatsapp_orders
--  INSERT            → evento según estado inicial (default order.created)
--  UPDATE de estado  → evento de la transición, 1 solo por cambio
-- ============================================================================
create or replace function os.whatsapp_orders_events() returns trigger
language plpgsql
as $$
declare
  v_event_type text;
begin
  if TG_OP = 'INSERT' then
    select m.event_type into v_event_type
      from os.state_event_map m
     where m.source_table = 'whatsapp_orders'
       and m.estado = NEW.estado;

    perform os.emit_event(
      coalesce(v_event_type, 'order.created'),
      'whatsapp_orders',
      NEW.id::text,
      'whatsapp_orders:' || NEW.id::text || ':' || coalesce(v_event_type, 'order.created'),
      jsonb_build_object(
        'order_id',       NEW.id,
        'pedido_codigo',  NEW.pedido_codigo,
        'telefono',       NEW.telefono,
        'nombre_cliente', NEW.nombre_cliente,
        'sku',            NEW.sku,
        'total',          NEW.total,
        'estado',         NEW.estado,
        'codigo_anuncio', NEW.codigo_anuncio,   -- clave de atribución p/ Fase 8
        'metodo_pago',    NEW.metodo_pago
      ));
    return NEW;

  elsif TG_OP = 'UPDATE' then
    -- solo si cambió el estado (whatsapp_orders no tiene updated_at, esto lo compensa)
    if OLD.estado is distinct from NEW.estado then
      select m.event_type into v_event_type
        from os.state_event_map m
       where m.source_table = 'whatsapp_orders'
         and m.estado = NEW.estado;

      if v_event_type is not null then
        perform os.emit_event(
          v_event_type,
          'whatsapp_orders',
          NEW.id::text,
          'whatsapp_orders:' || NEW.id::text || ':' || v_event_type,  -- 1 por transición
          jsonb_build_object(
            'order_id',        NEW.id,
            'pedido_codigo',   NEW.pedido_codigo,
            'estado_anterior', OLD.estado,
            'estado',          NEW.estado,
            'total',           NEW.total,
            'codigo_anuncio',  NEW.codigo_anuncio
          ));
      end if;
    end if;
    return NEW;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_whatsapp_orders_events on public.whatsapp_orders;
create trigger trg_whatsapp_orders_events
  after insert or update on public.whatsapp_orders
  for each row execute function os.whatsapp_orders_events();

-- ============================================================================
-- SEGURIDAD: RLS (service_role ya bypass; esto es para el panel/autenticados)
-- ============================================================================
alter table os.events          enable row level security;
alter table os.event_types     enable row level security;
alter table os.state_event_map enable row level security;

grant usage on schema os to authenticated;
grant select on os.events, os.event_types, os.state_event_map to authenticated;

create policy "os_events_read"          on os.events          for select to authenticated using (true);
create policy "os_event_types_read"     on os.event_types     for select to authenticated using (true);
create policy "os_state_event_map_read" on os.state_event_map for select to authenticated using (true);

-- ============================================================================
-- REALTIME (Paso 5 — el viewer necesita esto para mostrar el flujo vivo)
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'alter publication supabase_realtime add table os.events';
  end if;
exception when duplicate_object then
  null;  -- ya estaba en la publicación
end $$;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
-- 1) Insertar un pedido de prueba:
-- insert into public.whatsapp_orders (telefono, nombre_cliente, total, sku, estado)
-- values ('0000000000', 'TEST EVENTO', 1, 'TEST-SKU', 'nuevo');
--
-- 2) Ver el evento:
-- select id, type, occurred_at, payload->>'pedido_codigo' from os.events order by id desc limit 5;
--
-- 3) Cambiar estado y ver la transición:
-- update public.whatsapp_orders set estado = 'entregado' where telefono = '0000000000';
-- select type, payload->>'estado_anterior', payload->>'estado' from os.events order by id desc limit 2;
--
-- 4) Limpiar prueba:
-- delete from os.events where payload->>'telefono' = '0000000000';
-- delete from public.whatsapp_orders where telefono = '0000000000';
--
-- BACKFILL opcional (pedidos históricos → order.created):
-- select os.emit_event('order.created', 'whatsapp_orders', id::text,
--   'whatsapp_orders:' || id::text || ':order.created',
--   jsonb_build_object('order_id', id, 'pedido_codigo', pedido_codigo,
--                      'total', total, 'codigo_anuncio', codigo_anuncio,
--                      'estado', estado, 'backfilled', true))
-- from public.whatsapp_orders;
