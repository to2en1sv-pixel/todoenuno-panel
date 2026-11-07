-- ============================================================================
-- TODOENUNO OS — SPRINT 1: OS EVENT STORE (VERSIÓN COMPLETA Y OFICIAL)
-- Archivo: 20261107_sprint1_os_event_store.sql
-- Ejecutar en: Supabase SQL Editor
--
-- Alcance oficial:
--   Paso 1: Schema os
--   Paso 2: os.events (con índice GIN y anti-duplicados)
--   Paso 3: os.event_types, os.state_event_map y os.event_consumers
--   Paso 4: Producer con trigger idempotente sobre public.whatsapp_orders
--           (soportando estados: nuevo, por_empacar, en_camino, entregado, cancelado)
--   Paso 5: Emisor central os.emit_event, RLS, permisos y Realtime para el Viewer
-- ============================================================================

-- ============================================================================
-- PASO 1: Creación del Schema OS
-- ============================================================================
create schema if not exists os;

-- ============================================================================
-- PASO 3A: Catálogo Normalizado de Tipos de Eventos (os.event_types)
-- ============================================================================
create table if not exists os.event_types (
  type           text primary key,               -- Ej: 'order.created', 'chat.message.received'
  domain         text not null,                  -- 'order', 'chat', 'marketing', 'supplier', 'finance', 'system'
  description    text,
  payload_schema jsonb,                          -- Esquema JSON opcional para validación futura
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);

-- Inserción de catálogo oficial de dominios del Roadmap
insert into os.event_types (type, domain, description) values
  -- Dominio: Pedidos (Order)
  ('order.created',   'order', 'Nuevo pedido registrado en el sistema'),
  ('order.confirmed', 'order', 'Pedido confirmado / en preparación para empaque'),
  ('order.shipped',   'order', 'Pedido despachado / en camino con el repartidor'),
  ('order.delivered', 'order', 'Pedido entregado exitosamente al cliente'),
  ('order.cancelled', 'order', 'Pedido cancelado'),

  -- Dominio: Mensajería & Conversaciones (Chat & Lead)
  ('chat.message.received', 'chat', 'Mensaje entrante de cliente (Facebook / WhatsApp / Bot)'),
  ('chat.message.sent',     'chat', 'Mensaje enviado a cliente por agente o bot'),
  ('lead.generated',        'lead', 'Nuevo prospecto o lead capturado desde chat o anuncio'),

  -- Dominio: Marketing & Anuncios
  ('marketing.post.created',    'marketing', 'Publicación programada en cola de redes'),
  ('marketing.post.published',  'marketing', 'Publicación emitida en Facebook/Instagram'),
  ('marketing.lead.generated',  'marketing', 'Lead captado por formulario de campaña publicitaria'),
  ('marketing.ad.expense',      'marketing', 'Gasto diario publicitario registrado en Meta/TikTok'),

  -- Dominio: Proveedores & Licitaciones
  ('supplier.created',      'supplier', 'Nuevo proveedor registrado en el catálogo'),
  ('purchase.requested',    'supplier', 'Requisición de compra / licitación creada'),
  ('supplier.bid.received', 'supplier', 'Oferta o cotización recibida de proveedor'),
  ('supplier.selected',     'supplier', 'Proveedor seleccionado para orden de compra'),

  -- Dominio: Finanzas (Finance Projector)
  ('finance.income.created',  'finance', 'Ingreso registrado (ej. liquidación de pedido entregado)'),
  ('finance.expense.created', 'finance', 'Egreso registrado (ej. gasto de pauta o pago proveedor)'),
  ('finance.debt.created',    'finance', 'Deuda o cuenta por pagar registrada'),

  -- Dominio: Sistema
  ('system.heartbeat', 'system', 'Señal de vida del sistema / cron monitor'),
  ('system.test',      'system', 'Evento de prueba emitido desde el panel')
on conflict (type) do update set
  domain = excluded.domain,
  description = excluded.description,
  enabled = excluded.enabled;

-- ============================================================================
-- PASO 2: OS Event Store (os.events)
-- ============================================================================
create table if not exists os.events (
  id              bigint generated always as identity primary key,
  type            text not null references os.event_types(type),
  occurred_at     timestamptz not null default now(),
  source_table    text not null,                 -- Ej: 'whatsapp_orders', 'gastos_publicidad'
  source_id       text not null,                 -- ID del registro origen
  idempotency_key text not null unique,          -- Llave única anti-duplicados
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

-- Índices de alto rendimiento para el Event Stream y Analytics
create index if not exists os_events_type_idx     on os.events (type, occurred_at desc);
create index if not exists os_events_occurred_idx on os.events (occurred_at desc);
create index if not exists os_events_source_idx   on os.events (source_table, source_id);
create index if not exists os_events_payload_gin  on os.events using gin (payload);

-- ============================================================================
-- PASO 3B: Tabla de Consumidores (os.event_consumers) — Fases 6-8
-- ============================================================================
create table if not exists os.event_consumers (
  consumer_name   text primary key,               -- Ej: 'finance_projector', 'os_memory'
  last_event_id   bigint not null default 0,      -- Checkpoint de lectura
  status          text not null default 'active', -- 'active', 'paused', 'error'
  last_error      text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

insert into os.event_consumers (consumer_name, last_event_id, status) values
  ('finance_projector', 0, 'active'),
  ('os_memory',         0, 'active'),
  ('dashboard_stream',  0, 'active')
on conflict (consumer_name) do nothing;

-- ============================================================================
-- PASO 3C: Mapa Estado → Evento (os.state_event_map)
-- Soporta los estados exactos del tablero Kanban de TodoEnUno:
-- 'nuevo', 'por_empacar', 'en_camino', 'entregado', 'cancelado'
-- y variantes históricas 'confirmado', 'enviado', 'cancelada'
-- ============================================================================
create table if not exists os.state_event_map (
  source_table text not null,
  estado       text not null,
  event_type   text not null references os.event_types(type),
  primary key (source_table, estado)
);

insert into os.state_event_map (source_table, estado, event_type) values
  ('whatsapp_orders', 'nuevo',        'order.created'),
  ('whatsapp_orders', 'por_empacar',  'order.confirmed'),
  ('whatsapp_orders', 'confirmado',   'order.confirmed'),
  ('whatsapp_orders', 'en_camino',    'order.shipped'),
  ('whatsapp_orders', 'enviado',      'order.shipped'),
  ('whatsapp_orders', 'entregado',    'order.delivered'),
  ('whatsapp_orders', 'cancelado',    'order.cancelled'),
  ('whatsapp_orders', 'cancelada',    'order.cancelled')
on conflict (source_table, estado) do update set
  event_type = excluded.event_type;

-- ============================================================================
-- PASO 5A: Emisor Central os.emit_event
-- Idempotente: si la idempotency_key ya existe, no duplica y retorna -1.
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
  
  return coalesce(v_id, -1);
end;
$$;

-- ============================================================================
-- PASO 4: Producer con Trigger sobre whatsapp_orders
-- Captura creación inicial y transiciones de estado
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
        'pedido_codigo',  coalesce(NEW.pedido_codigo, ('PED-' || substr(NEW.id::text, 1, 8))),
        'telefono',       NEW.telefono,
        'nombre_cliente', NEW.nombre_cliente,
        'sku',            NEW.sku,
        'total',          NEW.total,
        'estado',         NEW.estado,
        'codigo_anuncio', NEW.codigo_anuncio,
        'metodo_pago',    NEW.metodo_pago,
        'direccion',      NEW.direccion,
        'notas',          NEW.notas
      ));
    return NEW;

  elsif TG_OP = 'UPDATE' then
    -- Se dispara solo si cambió el estado
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
          'whatsapp_orders:' || NEW.id::text || ':' || v_event_type || ':' || extract(epoch from now())::bigint,
          jsonb_build_object(
            'order_id',        NEW.id,
            'pedido_codigo',   coalesce(NEW.pedido_codigo, ('PED-' || substr(NEW.id::text, 1, 8))),
            'nombre_cliente',  NEW.nombre_cliente,
            'estado_anterior', OLD.estado,
            'estado',          NEW.estado,
            'sku',             NEW.sku,
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

-- Desactivar trigger anterior si existía y crear nuevo
drop trigger if exists trg_whatsapp_orders_events on public.whatsapp_orders;
create trigger trg_whatsapp_orders_events
  after insert or update on public.whatsapp_orders
  for each row execute function os.whatsapp_orders_events();

-- ============================================================================
-- PASO 5B: Permisos y RLS
-- ============================================================================
alter table os.events          enable row level security;
alter table os.event_types     enable row level security;
alter table os.state_event_map enable row level security;
alter table os.event_consumers enable row level security;

-- Concesión de permisos a usuarios autenticados y anónimos (para panel frontend)
grant usage on schema os to anon, authenticated, service_role;
grant select, insert on os.events to anon, authenticated, service_role;
grant select on os.event_types, os.state_event_map, os.event_consumers to anon, authenticated, service_role;
grant execute on function os.emit_event to anon, authenticated, service_role;

-- Políticas de lectura abierta para el panel
drop policy if exists "os_events_read" on os.events;
create policy "os_events_read" on os.events for select using (true);

drop policy if exists "os_events_insert" on os.events;
create policy "os_events_insert" on os.events for insert with check (true);

drop policy if exists "os_event_types_read" on os.event_types;
create policy "os_event_types_read" on os.event_types for select using (true);

drop policy if exists "os_state_event_map_read" on os.state_event_map;
create policy "os_state_event_map_read" on os.state_event_map for select using (true);

drop policy if exists "os_event_consumers_read" on os.event_consumers;
create policy "os_event_consumers_read" on os.event_consumers for select using (true);

-- ============================================================================
-- PASO 5C: Habilitar Realtime para el Visor de Eventos
-- ============================================================================
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    -- Remover primero si existía para evitar duplicado
    begin
      execute 'alter publication supabase_realtime add table os.events';
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;

-- ============================================================================
-- BACKFILL HISTÓRICO OPCIONAL (Convertir pedidos existentes a order.created)
-- Ejecutar si deseas poblar el histórico de eventos con tus pedidos actuales:
-- ============================================================================
-- select os.emit_event(
--   'order.created',
--   'whatsapp_orders',
--   id::text,
--   'whatsapp_orders:' || id::text || ':order.created:backfill',
--   jsonb_build_object(
--     'order_id',       id,
--     'pedido_codigo',  coalesce(pedido_codigo, 'PED-' || substr(id::text, 1, 8)),
--     'nombre_cliente', nombre_cliente,
--     'telefono',       telefono,
--     'sku',            sku,
--     'total',          total,
--     'estado',         estado,
--     'codigo_anuncio', codigo_anuncio,
--     'backfilled',     true
--   )
-- )
-- from public.whatsapp_orders;
