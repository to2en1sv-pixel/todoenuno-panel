import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  Radio,
  Pause,
  Play,
  RefreshCw,
  Search,
  Database,
  Send,
  Copy,
  Check,
  X,
  ExternalLink,
  Code,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  AlertTriangle,
  Brain,
  Download,
} from 'lucide-react';
import {
  fetchOsEvents,
  fetchOsEventTypes,
  fetchOsConsumers,
  fetchOsDailyMemory,
  rebuildOsMemory,
  backfillMissingOsEvents,
  exportOsEventsJsonl,
  getLastEmitDiagnostic,
  emitOsEvent,
  subscribeToOsEvents,
  DEFAULT_EVENT_TYPES,
} from '@/lib/osEvents';
import type {
  OsEvent,
  OsEventType,
  OsEventConsumer,
  OsDailyMemory,
} from '@/types/events';

// SQL completo Sprint 12 para visualización y copia rápida
const SPRINT12_SQL_CODE = String.raw`-- ============================================================================
-- TODOENUNO OS — SPRINT 12: OS EVENT STORE TOTAL + AI MEMORY LAYER (OS MEMORY)
-- Archivo: 20261117_sprint12_os_events_ai_memory.sql
-- Ejecutar en: Supabase SQL Editor (100% idempotente, seguro de re-ejecutar)
-- ============================================================================

-- 1. Schema base OS
create schema if not exists os;

create table if not exists os.event_types (
  type           text primary key,
  domain         text not null,
  description    text,
  payload_schema jsonb,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists os.events (
  id              bigint generated always as identity primary key,
  type            text not null references os.event_types(type),
  occurred_at     timestamptz not null default now(),
  source_table    text not null,
  source_id       text not null,
  idempotency_key text not null unique,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists os_events_type_idx     on os.events (type, occurred_at desc);
create index if not exists os_events_occurred_idx on os.events (occurred_at desc);
create index if not exists os_events_source_idx   on os.events (source_table, source_id);
create index if not exists os_events_payload_gin  on os.events using gin (payload);

create table if not exists os.event_consumers (
  consumer_name   text primary key,
  last_event_id   bigint not null default 0,
  status          text not null default 'active',
  last_error      text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create table if not exists os.state_event_map (
  source_table text not null,
  estado       text not null,
  event_type   text not null references os.event_types(type),
  primary key (source_table, estado)
);

-- 2. Catálogo completo de tipos de eventos (48 tipos reales de todos los módulos)
insert into os.event_types (type, domain, description) values
  ('order.created',              'order', 'Nuevo pedido registrado en el sistema'),
  ('order.confirmed',            'order', 'Pedido confirmado / en preparación para empaque'),
  ('order.shipped',              'order', 'Pedido despachado / en ruta con motorista o courier'),
  ('order.delivered',            'order', 'Pedido entregado y cobrado en puerta exitosamente'),
  ('order.cancelled',            'order', 'Pedido cancelado o devuelto en entrega'),
  ('order.scheduled',            'order', 'Pedido programado / encargo a futuro'),
  ('order.delivery_issue',       'order', 'Novedad o incidencia reportada en ruta de entrega'),
  ('order.dispatch.photo_sent',  'order', 'Foto de guía o paquete despachado enviada al cliente'),
  ('order.delay.notified',       'order', 'Aviso de retraso logístico enviado por WhatsApp'),
  ('chat.message.received',      'chat', 'Mensaje entrante de cliente (WhatsApp / Redes)'),
  ('chat.message.sent',          'chat', 'Mensaje saliente enviado por Bot Todd o agente humano'),
  ('chat.bot.toggled',           'chat', 'Cambio de modo Bot Todd automatizado vs Agente Humano'),
  ('chat.funnel.progressed',     'chat', 'Avance del cliente en el embudo de Bot Todd y SKU cotizado'),
  ('social.reply.sent',          'chat', 'Respuesta enviada a DM o comentario social de Meta'),
  ('lead.generated',             'lead', 'Prospecto captado desde chat WhatsApp o anuncio'),
  ('marketing.post.created',     'marketing', 'Pieza agregada o programada en cola / bodega de contenido'),
  ('marketing.post.published',   'marketing', 'Publicación emitida en Facebook / Instagram'),
  ('marketing.lead.generated',   'marketing', 'Lead captado desde formulario o comentario de anuncio'),
  ('marketing.ad.expense',       'marketing', 'Gasto publicitario diario registrado en Meta / TikTok'),
  ('marketing.meta.synced',      'marketing', 'Sincronización automática ejecutada con Meta Marketing API'),
  ('inventory.adjustment',       'inventory', 'Ajuste manual de stock / merma / conteo físico'),
  ('product.created',            'inventory', 'Nuevo producto creado en el catálogo'),
  ('product.updated',            'inventory', 'Producto actualizado en catálogo o pitch de Bot Todd'),
  ('product.deleted',            'inventory', 'Producto desactivado o eliminado del catálogo'),
  ('supplier.created',           'supplier', 'Nuevo proveedor registrado en el catálogo'),
  ('purchase.requested',         'supplier', 'Solicitud o licitación de compra creada'),
  ('supplier.bid.received',      'supplier', 'Oferta o cotización recibida de proveedor'),
  ('supplier.selected',          'supplier', 'Proveedor adjudicado para compra'),
  ('finance.income.created',     'finance', 'Ingreso liquidado en caja (pedido COD cobrado)'),
  ('finance.expense.created',    'finance', 'Egreso asentado (pauta, compra o gasto operativo)'),
  ('finance.debt.created',       'finance', 'Cuenta por pagar o deuda registrada'),
  ('finance.transfer.created',   'finance', 'Transferencia interna entre cuentas o cajas'),
  ('finance.bill.created',       'finance', 'Pago recurrente o suscripción registrada en calendario'),
  ('finance.bill.paid',          'finance', 'Pago recurrente marcado como pagado y renovado'),
  ('customer.blacklisted',       'customer', 'Cliente agregado a Lista Negra / DICOM interno'),
  ('customer.whitelisted',       'customer', 'Cliente rehabilitado de Lista Negra'),
  ('customer.notified',          'customer', 'Notificación formal enviada a cliente por WhatsApp'),
  ('ltv.campaign_created',       'ltv', 'Campaña de Oferta Flash / recompra creada'),
  ('ltv.offer_dispatched',       'ltv', 'Oferta Flash enviada por WhatsApp a cliente previo'),
  ('system.heartbeat',                         'system', 'Latido de salud del sistema'),
  ('system.test',                              'system', 'Evento de verificación manual'),
  ('system.finance_reset',                     'system', 'Reinicio operativo de módulo de Finanzas'),
  ('system.finance_cutoff_cleared',            'system', 'Corte histórico aplicado en Finanzas'),
  ('system.finance_delivered_legacy_cleared',  'system', 'Entregados legacy archivados en Finanzas'),
  ('system.vault_reset',                       'system', 'Reinicio de métricas en Bóveda de Productos'),
  ('system.vault_cutoff_cleared',              'system', 'Corte de fecha limpiado en Bóveda de Productos'),
  ('system.memory.consolidated',               'system', 'Consolidación de memoria histórica diaria para IA'),
  ('ai.brief.generated',                       'system', 'Brief operativo / resumen generado con contexto histórico')
on conflict (type) do update set
  domain = excluded.domain,
  description = excluded.description,
  enabled = excluded.enabled;

-- 3. Mapa completo de transiciones de estado en whatsapp_orders
insert into os.state_event_map (source_table, estado, event_type) values
  ('whatsapp_orders', 'nuevo',       'order.created'),
  ('whatsapp_orders', 'programado',  'order.scheduled'),
  ('whatsapp_orders', 'encargo',     'order.scheduled'),
  ('whatsapp_orders', 'agendado',    'order.scheduled'),
  ('whatsapp_orders', 'por_empacar', 'order.confirmed'),
  ('whatsapp_orders', 'confirmado',  'order.confirmed'),
  ('whatsapp_orders', 'empacado',    'order.confirmed'),
  ('whatsapp_orders', 'en_empaque',  'order.confirmed'),
  ('whatsapp_orders', 'en_camino',   'order.shipped'),
  ('whatsapp_orders', 'en_ruta',     'order.shipped'),
  ('whatsapp_orders', 'enviado',     'order.shipped'),
  ('whatsapp_orders', 'despachado',  'order.shipped'),
  ('whatsapp_orders', 'entregado',   'order.delivered'),
  ('whatsapp_orders', 'entregada',   'order.delivered'),
  ('whatsapp_orders', 'completado',  'order.delivered'),
  ('whatsapp_orders', 'cancelado',   'order.cancelled'),
  ('whatsapp_orders', 'cancelada',   'order.cancelled'),
  ('whatsapp_orders', 'rechazado',   'order.cancelled'),
  ('whatsapp_orders', 'devuelto',    'order.cancelled')
on conflict (source_table, estado) do update set event_type = excluded.event_type;

-- 4. Emisor seguro con auto-registro de tipos y fecha histórica
drop function if exists public.emit_os_event(text, text, text, text, jsonb);
drop function if exists os.emit_event(text, text, text, text, jsonb);

create or replace function os.emit_event(
  p_type            text,
  p_source_table    text,
  p_source_id       text,
  p_idempotency_key text,
  p_payload         jsonb default '{}'::jsonb,
  p_occurred_at     timestamptz default null
) returns bigint
language plpgsql security definer set search_path = os, public as $$
declare
  v_id bigint;
  v_domain text;
begin
  v_domain := coalesce(nullif(split_part(coalesce(p_type, ''), '.', 1), ''), 'system');
  if v_domain = 'product' then
    v_domain := 'inventory';
  elsif v_domain = 'purchase' then
    v_domain := 'supplier';
  elsif v_domain = 'social' then
    v_domain := 'chat';
  elsif v_domain = 'ai' then
    v_domain := 'system';
  end if;

  insert into os.event_types (type, domain, description, enabled)
  values (p_type, v_domain, 'Auto-registrado por emisor del OS', true)
  on conflict (type) do nothing;

  insert into os.events (type, occurred_at, source_table, source_id, idempotency_key, payload)
  values (
    p_type,
    coalesce(p_occurred_at, now()),
    p_source_table,
    p_source_id,
    p_idempotency_key,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return coalesce(v_id, -1);
end;
$$;

create or replace function public.emit_os_event(
  p_type            text,
  p_source_table    text,
  p_source_id       text,
  p_idempotency_key text,
  p_payload         jsonb default '{}'::jsonb,
  p_occurred_at     timestamptz default null
) returns bigint
language sql security definer set search_path = os, public as $$
  select os.emit_event(p_type, p_source_table, p_source_id, p_idempotency_key, p_payload, p_occurred_at);
$$;

-- 5. Triggers automáticos sobre whatsapp_orders, bb_messages, bb_conversations y fb_leads
create or replace function os.whatsapp_orders_events() returns trigger
language plpgsql security definer set search_path = os, public as $$
declare
  v_event_type text;
  v_estado_new text;
  v_estado_old text;
  v_row jsonb;
begin
  v_row := to_jsonb(NEW);
  v_estado_new := lower(trim(coalesce(NEW.estado, 'nuevo')));

  if TG_OP = 'INSERT' then
    select m.event_type into v_event_type from os.state_event_map m
     where m.source_table = 'whatsapp_orders' and m.estado = v_estado_new;

    perform os.emit_event(
      coalesce(v_event_type, 'order.created'),
      'whatsapp_orders',
      NEW.id::text,
      'whatsapp_orders:' || NEW.id::text || ':' || coalesce(v_event_type, 'order.created'),
      jsonb_strip_nulls(jsonb_build_object(
        'order_id',       NEW.id,
        'pedido_codigo',  coalesce(v_row->>'pedido_codigo', 'PED-' || substr(NEW.id::text, 1, 8)),
        'telefono',       NEW.telefono,
        'nombre_cliente', NEW.nombre_cliente,
        'sku',            NEW.sku,
        'catalogo_sku',   v_row->>'catalogo_sku',
        'cantidad',       coalesce((v_row->>'cantidad')::numeric, 1),
        'total',          NEW.total,
        'estado',         v_estado_new,
        'departamento',   v_row->>'departamento',
        'courier',        v_row->>'courier',
        'codigo_anuncio', NEW.codigo_anuncio,
        'metodo_pago',    NEW.metodo_pago
      )));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    v_estado_old := lower(trim(coalesce(OLD.estado, '')));
    if v_estado_old is distinct from v_estado_new then
      select m.event_type into v_event_type from os.state_event_map m
       where m.source_table = 'whatsapp_orders' and m.estado = v_estado_new;

      if v_event_type is not null then
        perform os.emit_event(
          v_event_type,
          'whatsapp_orders',
          NEW.id::text,
          'whatsapp_orders:' || NEW.id::text || ':' || v_event_type || ':' || extract(epoch from now())::bigint,
          jsonb_strip_nulls(jsonb_build_object(
            'order_id',            NEW.id,
            'pedido_codigo',       coalesce(v_row->>'pedido_codigo', 'PED-' || substr(NEW.id::text, 1, 8)),
            'nombre_cliente',      NEW.nombre_cliente,
            'telefono',            NEW.telefono,
            'estado_anterior',     v_estado_old,
            'estado',              v_estado_new,
            'sku',                 NEW.sku,
            'catalogo_sku',        v_row->>'catalogo_sku',
            'total',               NEW.total,
            'departamento',        v_row->>'departamento',
            'courier',             v_row->>'courier',
            'motivo_cancelacion',  v_row->>'motivo_cancelacion',
            'liquidado',           v_row->'liquidado',
            'codigo_anuncio',      NEW.codigo_anuncio
          )));
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

create or replace function os.bb_messages_events() returns trigger
language plpgsql security definer set search_path = os, public as $$
declare
  v_row jsonb;
  v_type text;
begin
  v_row := to_jsonb(NEW);
  v_type := case when coalesce(NEW.from_me, false) then 'chat.message.sent' else 'chat.message.received' end;

  perform os.emit_event(
    v_type,
    'bb_messages',
    NEW.id::text,
    'bb_messages:' || NEW.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'message_id',      NEW.id,
      'conversation_id', NEW.conversation_id,
      'telefono',        v_row->>'telefono_real',
      'from_me',         coalesce(NEW.from_me, false),
      'channel',         'whatsapp',
      'text',            left(coalesce(NEW.body, ''), 240)
    ))
  );
  return NEW;
end;
$$;

create or replace function os.bb_conversations_status_events() returns trigger
language plpgsql security definer set search_path = os, public as $$
begin
  if OLD.status is distinct from NEW.status then
    perform os.emit_event(
      'chat.bot.toggled',
      'bb_conversations',
      NEW.id::text,
      'bb_conversations:' || NEW.id::text || ':status:' || coalesce(NEW.status, 'bot') || ':' || extract(epoch from now())::bigint,
      jsonb_strip_nulls(jsonb_build_object(
        'conversation_id', NEW.id,
        'telefono',        NEW.contact_phone,
        'nombre_cliente',  NEW.contact_name,
        'previous_status', OLD.status,
        'next_status',     NEW.status
      ))
    );
  end if;
  return NEW;
end;
$$;

create or replace function os.fb_leads_events() returns trigger
language plpgsql security definer set search_path = os, public as $$
declare v_row jsonb;
begin
  v_row := to_jsonb(NEW);
  perform os.emit_event(
    'marketing.lead.generated',
    'fb_leads',
    NEW.id::text,
    'fb_leads:' || NEW.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'lead_id',     NEW.id,
      'nombre',      v_row->>'fb_user_name',
      'fb_post_id',  v_row->>'fb_post_id',
      'keyword',     v_row->>'keyword',
      'text',        left(coalesce(v_row->>'message_text', ''), 200)
    ))
  );
  return NEW;
end;
$$;

do $$
begin
  if to_regclass('public.bb_messages') is not null then
    drop trigger if exists trg_bb_messages_events on public.bb_messages;
    create trigger trg_bb_messages_events
      after insert on public.bb_messages
      for each row execute function os.bb_messages_events();
  end if;

  if to_regclass('public.bb_conversations') is not null then
    drop trigger if exists trg_bb_conversations_status_events on public.bb_conversations;
    create trigger trg_bb_conversations_status_events
      after update on public.bb_conversations
      for each row execute function os.bb_conversations_status_events();
  end if;

  if to_regclass('public.fb_leads') is not null then
    drop trigger if exists trg_fb_leads_events on public.fb_leads;
    create trigger trg_fb_leads_events
      after insert on public.fb_leads
      for each row execute function os.fb_leads_events();
  end if;
end $$;

-- 6. Capa de Memoria IA Diaria (os.daily_memory)
create table if not exists os.daily_memory (
  day                date primary key,
  total_events       int not null default 0,
  orders_created     int not null default 0,
  orders_delivered   int not null default 0,
  orders_cancelled   int not null default 0,
  gross_sales        numeric not null default 0,
  delivered_revenue  numeric not null default 0,
  ad_spend           numeric not null default 0,
  chats_received     int not null default 0,
  chats_sent         int not null default 0,
  top_products       jsonb not null default '[]'::jsonb,
  top_ads            jsonb not null default '[]'::jsonb,
  funnel_summary     jsonb not null default '{}'::jsonb,
  summary_text       text,
  ai_insights        text,
  last_event_id      bigint,
  updated_at         timestamptz not null default now()
);

create index if not exists os_daily_memory_day_idx on os.daily_memory (day desc);

create or replace function os.rebuild_daily_memory(p_days int default 30)
returns jsonb
language plpgsql security definer set search_path = os, public as $$
declare
  v_days int := greatest(1, least(coalesce(p_days, 30), 365));
  v_cutoff date := ((now() at time zone 'America/El_Salvador')::date - v_days);
  v_max_event_id bigint := 0;
  v_rec record;
  v_top_products jsonb;
  v_top_ads jsonb;
  v_funnel jsonb;
  v_summary text;
  v_days_updated int := 0;
begin
  select coalesce(max(id), 0) into v_max_event_id from os.events;

  for v_rec in
    select
      (e.occurred_at at time zone 'America/El_Salvador')::date as sv_day,
      count(*)::int as total_events,
      count(*) filter (where e.type = 'order.created')::int as orders_created,
      count(*) filter (where e.type = 'order.delivered')::int as orders_delivered,
      count(*) filter (where e.type = 'order.cancelled')::int as orders_cancelled,
      coalesce(sum(case when e.type = 'order.created' and (e.payload->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (e.payload->>'total')::numeric else 0 end), 0) as gross_sales,
      coalesce(sum(case when e.type = 'order.delivered' and (e.payload->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (e.payload->>'total')::numeric else 0 end), 0) as delivered_revenue,
      coalesce(sum(case when e.type = 'marketing.ad.expense' then
        case
          when (e.payload->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.payload->>'amount')::numeric
          when (e.payload->>'monto') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.payload->>'monto')::numeric
          else 0
        end
      else 0 end), 0) as ad_spend,
      count(*) filter (where e.type = 'chat.message.received')::int as chats_received,
      count(*) filter (where e.type = 'chat.message.sent')::int as chats_sent,
      max(e.id) as max_day_event_id
    from os.events e
    where (e.occurred_at at time zone 'America/El_Salvador')::date >= v_cutoff
    group by 1
    order by 1 desc
  loop
    select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) into v_top_products
    from (
      select
        coalesce(nullif(e.payload->>'catalogo_sku', ''), nullif(e.payload->>'sku', ''), 'SIN-SKU') as sku,
        count(*) filter (where e.type = 'order.created')::int as orders,
        count(*) filter (where e.type = 'order.delivered')::int as delivered,
        count(*) filter (where e.type = 'chat.funnel.progressed')::int as inquiries,
        coalesce(sum(case when e.type in ('order.created','order.delivered') and (e.payload->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (e.payload->>'total')::numeric else 0 end), 0) as volume
      from os.events e
      where (e.occurred_at at time zone 'America/El_Salvador')::date = v_rec.sv_day
        and e.type in ('order.created', 'order.delivered', 'chat.funnel.progressed')
        and coalesce(nullif(e.payload->>'catalogo_sku', ''), nullif(e.payload->>'sku', '')) is not null
      group by 1
      order by orders desc, inquiries desc, volume desc
      limit 5
    ) t;

    select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) into v_top_ads
    from (
      select
        upper(trim(e.payload->>'codigo_anuncio')) as codigo_anuncio,
        count(*) filter (where e.type = 'order.created')::int as orders,
        count(*) filter (where e.type = 'order.delivered')::int as delivered,
        coalesce(sum(case when e.type = 'order.delivered' and (e.payload->>'total') ~ '^-?[0-9]+(\.[0-9]+)?$'
          then (e.payload->>'total')::numeric else 0 end), 0) as revenue
      from os.events e
      where (e.occurred_at at time zone 'America/El_Salvador')::date = v_rec.sv_day
        and coalesce(trim(e.payload->>'codigo_anuncio'), '') <> ''
      group by 1
      order by orders desc, revenue desc
      limit 5
    ) a;

    select jsonb_build_object(
      'funnel_steps', count(*) filter (where e.type = 'chat.funnel.progressed'),
      'leads',        count(*) filter (where e.type in ('lead.generated', 'marketing.lead.generated')),
      'bot_toggles',  count(*) filter (where e.type = 'chat.bot.toggled'),
      'issues',       count(*) filter (where e.type = 'order.delivery_issue')
    ) into v_funnel
    from os.events e
    where (e.occurred_at at time zone 'America/El_Salvador')::date = v_rec.sv_day;

    v_summary := format(
      '%s: %s eventos | Pedidos: %s creados, %s entregados ($%s cobrado), %s cancelados | Chats: %s entrantes / %s salientes | Pauta: $%s',
      to_char(v_rec.sv_day, 'YYYY-MM-DD'),
      v_rec.total_events,
      v_rec.orders_created,
      v_rec.orders_delivered,
      round(v_rec.delivered_revenue, 2),
      v_rec.orders_cancelled,
      v_rec.chats_received,
      v_rec.chats_sent,
      round(v_rec.ad_spend, 2)
    );

    insert into os.daily_memory (
      day, total_events, orders_created, orders_delivered, orders_cancelled,
      gross_sales, delivered_revenue, ad_spend, chats_received, chats_sent,
      top_products, top_ads, funnel_summary, summary_text, last_event_id, updated_at
    )
    values (
      v_rec.sv_day, v_rec.total_events, v_rec.orders_created, v_rec.orders_delivered, v_rec.orders_cancelled,
      v_rec.gross_sales, v_rec.delivered_revenue, v_rec.ad_spend, v_rec.chats_received, v_rec.chats_sent,
      v_top_products, v_top_ads, coalesce(v_funnel, '{}'::jsonb), v_summary, v_rec.max_day_event_id, now()
    )
    on conflict (day) do update set
      total_events      = excluded.total_events,
      orders_created    = excluded.orders_created,
      orders_delivered  = excluded.orders_delivered,
      orders_cancelled  = excluded.orders_cancelled,
      gross_sales       = excluded.gross_sales,
      delivered_revenue = excluded.delivered_revenue,
      ad_spend          = excluded.ad_spend,
      chats_received    = excluded.chats_received,
      chats_sent        = excluded.chats_sent,
      top_products      = excluded.top_products,
      top_ads           = excluded.top_ads,
      funnel_summary    = excluded.funnel_summary,
      summary_text      = excluded.summary_text,
      last_event_id     = excluded.last_event_id,
      updated_at        = now();

    v_days_updated := v_days_updated + 1;
  end loop;

  insert into os.event_consumers (consumer_name, last_event_id, status, last_error, updated_at)
  values
    ('os_memory',         v_max_event_id, 'active', null, now()),
    ('finance_projector', v_max_event_id, 'active', null, now()),
    ('dashboard_stream',  v_max_event_id, 'active', null, now())
  on conflict (consumer_name) do update set
    last_event_id = greatest(os.event_consumers.last_event_id, excluded.last_event_id),
    status        = 'active',
    last_error    = null,
    updated_at    = now();

  return jsonb_build_object(
    'ok', true,
    'days_updated', v_days_updated,
    'last_event_id', v_max_event_id
  );
end;
$$;

create or replace function public.rebuild_os_memory(p_days int default 30)
returns jsonb
language sql security definer set search_path = os, public as $$
  select os.rebuild_daily_memory(p_days);
$$;

-- 7. Permisos, RLS, Vistas Públicas y Realtime
alter table os.events enable row level security;
alter table os.event_types enable row level security;
alter table os.state_event_map enable row level security;
alter table os.event_consumers enable row level security;
alter table os.daily_memory enable row level security;

grant usage on schema os to anon, authenticated, service_role;
grant select, insert on os.events to anon, authenticated, service_role;
grant select, insert, update on os.event_types, os.event_consumers, os.daily_memory to anon, authenticated, service_role;
grant select on os.state_event_map to anon, authenticated, service_role;
grant execute on function os.emit_event(text, text, text, text, jsonb, timestamptz) to anon, authenticated, service_role;
grant execute on function public.emit_os_event(text, text, text, text, jsonb, timestamptz) to anon, authenticated, service_role;
grant execute on function os.rebuild_daily_memory(int) to anon, authenticated, service_role;
grant execute on function public.rebuild_os_memory(int) to anon, authenticated, service_role;

drop policy if exists "os_events_read" on os.events;
drop policy if exists "os_events_insert" on os.events;
drop policy if exists "os_event_types_read" on os.event_types;
drop policy if exists "os_event_types_write" on os.event_types;
drop policy if exists "os_state_event_map_read" on os.state_event_map;
drop policy if exists "os_event_consumers_read" on os.event_consumers;
drop policy if exists "os_event_consumers_write" on os.event_consumers;
drop policy if exists "os_daily_memory_read" on os.daily_memory;
drop policy if exists "os_daily_memory_write" on os.daily_memory;

create policy "os_events_read" on os.events for select using (true);
create policy "os_events_insert" on os.events for insert with check (true);
create policy "os_event_types_read" on os.event_types for select using (true);
create policy "os_event_types_write" on os.event_types for all using (true) with check (true);
create policy "os_state_event_map_read" on os.state_event_map for select using (true);
create policy "os_event_consumers_read" on os.event_consumers for select using (true);
create policy "os_event_consumers_write" on os.event_consumers for all using (true) with check (true);
create policy "os_daily_memory_read" on os.daily_memory for select using (true);
create policy "os_daily_memory_write" on os.daily_memory for all using (true) with check (true);

create or replace view public.os_events as select * from os.events;
create or replace view public.os_event_types as select * from os.event_types;
create or replace view public.os_event_consumers as select * from os.event_consumers;
create or replace view public.os_daily_memory as select * from os.daily_memory;

grant select, insert on public.os_events to anon, authenticated, service_role;
grant select on public.os_event_types to anon, authenticated, service_role;
grant select, insert, update on public.os_event_consumers to anon, authenticated, service_role;
grant select, insert, update on public.os_daily_memory to anon, authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'os'
        and tablename = 'events'
    ) then
      alter publication supabase_realtime add table os.events;
    end if;
  end if;
end $$;

-- 8. Reparar fechas históricas y eliminar cualquier duplicado previo de backfill
delete from os.events b
where b.idempotency_key like 'backfill:whatsapp_orders:%'
  and exists (
    select 1 from os.events r
    where r.source_table = 'whatsapp_orders'
      and r.source_id = b.source_id
      and r.type = b.type
      and r.idempotency_key not like 'backfill:%'
  );

update os.events e
set occurred_at = coalesce(
  case when e.type = 'order.created' then o.created_at
       else coalesce((to_jsonb(o)->>'liquidado_at')::timestamptz, o.created_at)
  end,
  e.occurred_at
)
from public.whatsapp_orders o
where e.source_table = 'whatsapp_orders'
  and e.source_id = o.id::text
  and (e.idempotency_key like 'backfill:%' or coalesce((e.payload->>'backfill')::boolean, false) = true);

update os.events e
set occurred_at = (g.fecha::text || ' 18:00:00-06')::timestamptz
from public.gastos_publicidad g
where e.source_table = 'gastos_publicidad'
  and e.source_id = g.id::text
  and e.idempotency_key like 'backfill:gastos_publicidad:%'
  and g.fecha is not null;

update os.events e
set occurred_at = (tx.fecha::text || ' 18:00:00-06')::timestamptz
from public.finance_money_transactions tx
where e.source_table = 'finance_money_transactions'
  and e.source_id = tx.id::text
  and e.idempotency_key like 'backfill:finance_tx:%'
  and tx.fecha is not null;

update os.events e
set occurred_at = coalesce(ws.updated_at, e.occurred_at)
from public.whatsapp_state ws
where e.source_table = 'whatsapp_state'
  and e.source_id = ws.telefono
  and e.idempotency_key like 'backfill:funnel:%';

delete from os.daily_memory;

select public.rebuild_os_memory(30) as sprint12_resultado;`;

type DateRangeFilter = 'all' | 'today' | '7d' | '30d';

export function EventStreamViewer() {
  const [events, setEvents] = useState<OsEvent[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [loadingMore, setLoadingMore] = useState<boolean>(false);
  const [eventTypes, setEventTypes] = useState<OsEventType[]>(DEFAULT_EVENT_TYPES);
  const [consumers, setConsumers] = useState<OsEventConsumer[]>([]);
  const [dailyMemory, setDailyMemory] = useState<OsDailyMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRealDb, setIsRealDb] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [lastDiagnostic, setLastDiagnostic] = useState<string | null>(null);

  // Sincronización y memoria IA
  const [isSyncingMemory, setIsSyncingMemory] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Controles de visualización
  const [isPaused, setIsPaused] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [selectedType] = useState<string>('all');
  const [dateRange, setDateRange] = useState<DateRangeFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modales
  const [selectedEvent, setSelectedEvent] = useState<OsEvent | null>(null);
  const [showSqlModal, setShowSqlModal] = useState(false);
  const [showEmitModal, setShowEmitModal] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);

  // Formulario de emisión de prueba
  const [testType, setTestType] = useState('order.created');
  const [testCustomer, setTestCustomer] = useState('Mariana Gómez');
  const [testPhone, setTestPhone] = useState('78901234');
  const [testSku, setTestSku] = useState('MINI-EMS-01');
  const [testTotal, setTestTotal] = useState('29.99');
  const [testAdCode, setTestAdCode] = useState('FB-REEL-04');
  const [isEmitting, setIsEmitting] = useState(false);

  // Carga inicial
  const loadData = async (silent = false) => {
    if (!silent) setLoading(true);
    const result = await fetchOsEvents(200);
    setEvents(result.events);
    setTotalCount(result.totalCount);
    setHasMore(result.hasMore);
    setIsRealDb(result.isRealDb);
    setDbError(result.error || null);
    setLastDiagnostic(getLastEmitDiagnostic());
    window.dispatchEvent(
      new CustomEvent('os-events-synced', {
        detail: { totalCount: result.totalCount, events: result.events },
      })
    );

    const [typesData, consumersData, memoryData] = await Promise.all([
      fetchOsEventTypes(),
      fetchOsConsumers(),
      fetchOsDailyMemory(30),
    ]);
    if (typesData.length > 0) setEventTypes(typesData);
    if (consumersData.length > 0) setConsumers(consumersData);
    setDailyMemory(memoryData);

    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();

    const unsubscribe = subscribeToOsEvents((incomingEvent) => {
      if (!isPaused) {
        setEvents((prev) => {
          if (
            prev.some(
              (e) =>
                e.id === incomingEvent.id ||
                (incomingEvent.idempotency_key &&
                  e.idempotency_key === incomingEvent.idempotency_key)
            )
          ) {
            return prev;
          }
          setTotalCount((c) => Math.max(c + 1, prev.length + 1));
          return [incomingEvent, ...prev];
        });
      }
      setLastDiagnostic(getLastEmitDiagnostic());
    });

    return () => unsubscribe();
  }, [isPaused]);

  // Cargar más eventos históricos (paginación por keyset ID)
  const handleLoadMore = async () => {
    if (loadingMore || !hasMore || events.length === 0) return;
    setLoadingMore(true);

    const oldestId = events.reduce((min, ev) => (ev.id < min ? ev.id : min), events[0].id);
    const res = await fetchOsEvents(200, oldestId);

    setEvents((prev) => {
      const existingKeys = new Set(prev.map((e) => e.id));
      const fresh = res.events.filter((e) => !existingKeys.has(e.id));
      return [...prev, ...fresh];
    });
    setHasMore(res.hasMore);
    if (res.totalCount > 0) setTotalCount(res.totalCount);
    setLoadingMore(false);
  };

  // Backfill idempotente + consolidación de os_daily_memory
  const handleSyncAndRebuildMemory = async () => {
    if (isSyncingMemory) return;
    setIsSyncingMemory(true);
    setSyncStatus(null);

    try {
      const backfill = await backfillMissingOsEvents(30);
      const mem = await rebuildOsMemory(30);
      await loadData(true);

      if (mem.ok) {
        const prefix =
          backfill.newlyInserted > 0
            ? `Agregados ${backfill.newlyInserted} eventos nuevos (escaneados: ${backfill.scannedOrders} pedidos, ${backfill.scannedAds} pautas, ${backfill.scannedFinances} movs, ${backfill.scannedFunnels} chats)`
            : `Todo al día: 0 eventos nuevos (${backfill.skippedExisting} ya existían sin duplicar)`;
        setSyncStatus(
          `${prefix} · Memoria IA consolidada (${mem.daysUpdated} días · hasta evento #${mem.lastEventId}).`
        );
      } else {
        setSyncStatus(
          mem.error ||
            'Eventos sincronizados, pero falta ejecutar SQL Sprint 12 en Supabase para consolidar os_daily_memory.'
        );
      }
    } catch (err: any) {
      setSyncStatus(`Error sincronizando memoria IA: ${err?.message || 'desconocido'}`);
    } finally {
      setIsSyncingMemory(false);
    }
  };

  // Exportar dataset JSONL para análisis o entrenamiento IA
  const handleExportJsonl = () => {
    const dataToExport = filteredEvents.length > 0 ? filteredEvents : events;
    if (dataToExport.length === 0) return;
    const jsonl = exportOsEventsJsonl(dataToExport);
    const blob = new Blob([jsonl], { type: 'application/x-ndjson;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `todoenuno-os-events-${dateStr}.jsonl`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Manejo de emisión de prueba
  const handleEmitTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsEmitting(true);

    let payload: Record<string, any> = {};
    const mockId = 'ord-' + Math.floor(1000 + Math.random() * 9000);

    if (testType.startsWith('order.')) {
      payload = {
        order_id: mockId,
        pedido_codigo: `PED-${mockId.slice(-4)}`,
        nombre_cliente: testCustomer,
        telefono: testPhone,
        sku: testSku,
        total: parseFloat(testTotal) || 0,
        estado: testType === 'order.created' ? 'nuevo' : testType.replace('order.', ''),
        codigo_anuncio: testAdCode,
        metodo_pago: 'contraentrega',
        is_simulation: true,
      };
    } else if (testType === 'chat.funnel.progressed') {
      payload = {
        telefono: testPhone,
        paso_actual: 'cotizando',
        sku: testSku,
        nombre_producto: testSku,
        precio: parseFloat(testTotal) || 15,
      };
    } else if (testType.startsWith('chat.')) {
      payload = {
        conversation_id: `conv-${mockId}`,
        sender_id: testCustomer.toLowerCase().replace(/\s+/g, '-'),
        text: `Hola, deseo consultar el estado de mi pedido del producto ${testSku}`,
        channel: 'whatsapp',
      };
    } else if (testType.startsWith('lead.')) {
      payload = {
        lead_id: `lead-${mockId}`,
        nombre: testCustomer,
        telefono: testPhone,
        codigo_anuncio: testAdCode,
      };
    } else if (testType === 'marketing.ad.expense') {
      payload = {
        codigo_anuncio: testAdCode,
        platform: 'meta',
        amount: parseFloat(testTotal) || 10,
        fecha: new Date().toISOString().slice(0, 10),
      };
    } else if (testType.startsWith('finance.')) {
      payload = {
        categoria: testType === 'finance.bill.paid' ? 'servicio_recurrente' : 'venta_cod',
        monto: parseFloat(testTotal) || 15,
        descripcion: `Movimiento de prueba (${testSku})`,
      };
    } else {
      payload = {
        message: 'Evento emitido manualmente para pruebas de arquitectura Sprint 12',
        timestamp: new Date().toISOString(),
      };
    }

    await emitOsEvent({
      type: testType,
      source_table: testType.startsWith('order.') ? 'whatsapp_orders' : 'panel_simulator',
      source_id: mockId,
      payload,
    });

    setLastDiagnostic(getLastEmitDiagnostic());
    setIsEmitting(false);
    setShowEmitModal(false);
  };

  // Copiar SQL
  const handleCopySql = () => {
    navigator.clipboard.writeText(SPRINT12_SQL_CODE);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
  };

  // Copiar Payload
  const handleCopyPayload = () => {
    if (!selectedEvent) return;
    navigator.clipboard.writeText(JSON.stringify(selectedEvent.payload, null, 2));
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2000);
  };

  // Filtrado de eventos (dominio, fecha, búsqueda)
  const filteredEvents = useMemo(() => {
    const now = Date.now();
    const todaySvStr = new Date(now - 6 * 3600 * 1000).toISOString().slice(0, 10);

    return events.filter((ev) => {
      if (selectedDomain !== 'all') {
        const domain = ev.type.split('.')[0];
        const normalizedDomain =
          domain === 'product'
            ? 'inventory'
            : domain === 'purchase'
              ? 'supplier'
              : domain === 'social'
                ? 'chat'
                : domain === 'ai'
                  ? 'system'
                  : domain;
        if (normalizedDomain !== selectedDomain) return false;
      }

      if (selectedType !== 'all' && ev.type !== selectedType) {
        return false;
      }

      if (dateRange !== 'all') {
        const ts = new Date(ev.occurred_at).getTime();
        if (dateRange === 'today') {
          const evSvDay = new Date(ts - 6 * 3600 * 1000).toISOString().slice(0, 10);
          if (evSvDay !== todaySvStr) return false;
        } else if (dateRange === '7d') {
          if (now - ts > 7 * 24 * 60 * 60 * 1000) return false;
        } else if (dateRange === '30d') {
          if (now - ts > 30 * 24 * 60 * 60 * 1000) return false;
        }
      }

      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const typeMatch = ev.type.toLowerCase().includes(term);
        const sourceMatch = ev.source_table.toLowerCase().includes(term);
        const payloadStr = JSON.stringify(ev.payload).toLowerCase();
        if (!typeMatch && !sourceMatch && !payloadStr.includes(term)) return false;
      }

      return true;
    });
  }, [events, selectedDomain, selectedType, dateRange, searchTerm]);

  // Helper para obtener estilo de dominio
  const getDomainBadge = (type: string) => {
    const domain = type.split('.')[0];
    switch (domain) {
      case 'order':
        return {
          bg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
          label: 'PEDIDO',
          dot: 'bg-emerald-500',
        };
      case 'chat':
      case 'social':
        return {
          bg: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30',
          label: 'CHAT',
          dot: 'bg-violet-500',
        };
      case 'lead':
        return {
          bg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
          label: 'LEAD',
          dot: 'bg-amber-500',
        };
      case 'marketing':
        return {
          bg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
          label: 'MKTG',
          dot: 'bg-rose-500',
        };
      case 'supplier':
      case 'purchase':
        return {
          bg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
          label: 'PROV',
          dot: 'bg-orange-500',
        };
      case 'finance':
        return {
          bg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
          label: 'FINANZAS',
          dot: 'bg-blue-500',
        };
      case 'inventory':
      case 'product':
        return {
          bg: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30',
          label: 'INVENTARIO',
          dot: 'bg-teal-500',
        };
      case 'customer':
        return {
          bg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
          label: 'DICOM',
          dot: 'bg-rose-500',
        };
      case 'ltv':
        return {
          bg: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30',
          label: 'LTV FLASH',
          dot: 'bg-fuchsia-500',
        };
      case 'ai':
        return {
          bg: 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
          label: 'IA BRIEF',
          dot: 'bg-indigo-500',
        };
      default:
        return {
          bg: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
          label: 'SISTEMA',
          dot: 'bg-zinc-500',
        };
    }
  };

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('es-SV', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  const formatTimeAgo = (iso: string) => {
    try {
      const d = new Date(iso);
      const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diffSec < 10) return 'hace un momento';
      if (diffSec < 60) return `hace ${diffSec}s`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `hace ${diffMin}m`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `hace ${diffHour}h`;
      const diffDay = Math.floor(diffHour / 24);
      return `hace ${diffDay}d`;
    } catch {
      return '';
    }
  };

  const latestMemory = dailyMemory[0];

  return (
    <div className="flex flex-col gap-5">
      {/* Banner si SQL OS aún no está activo o si falta os_daily_memory */}
      {(!isRealDb || dbError) && (
        <div className="bg-cd border border-amber-500/30 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0">
              <AlertTriangle size={17} />
            </div>
            <div>
              <div className="font-semibold text-sm text-[var(--tx)] flex items-center gap-2 flex-wrap">
                Sprint 12: Event Store Total + Memoria IA
                <span className="text-[10px] px-2 py-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 font-mono font-semibold rounded">
                  {dbError ? 'Revisar esquema Supabase' : 'Pendiente en Supabase'}
                </span>
              </div>
              <p className="text-xs text-[var(--mu)] mt-0.5">
                {dbError
                  ? `${dbError}. Ejecuta el script SQL Sprint 12 en Supabase para habilitar todos los triggers y la tabla de memoria diaria.`
                  : 'El panel está operando en modo simulador. Ejecuta SQL Sprint 12 en Supabase para registrar hechos reales y entrenar la memoria histórica de tus Briefs.'}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSqlModal(true)}
            className="w-full sm:w-auto px-3.5 py-2 bg-[var(--tx)] text-[var(--cd)] font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity shrink-0"
          >
            <Code size={13} /> Ver SQL Sprint 12
          </button>
        </div>
      )}

      {/* KPI Strip Unificada del Event Store */}
      <div className="bg-cd border border-[var(--bd)] rounded-xl grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-[var(--bd)]">
        <div className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sf border border-[var(--bd)] flex items-center justify-center tx-mu shrink-0">
            <Activity size={17} />
          </div>
          <div>
            <div className="text-[11px] tx-mu font-medium">Total en Event Store</div>
            <div className="text-2xl font-bold font-mono tabular-nums">
              {totalCount.toLocaleString()}
            </div>
            <div className="text-[10px] tx-mu font-mono">
              En buffer: {events.length.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
            <Layers size={17} />
          </div>
          <div>
            <div className="text-[11px] tx-mu font-medium">Tipos de Eventos</div>
            <div className="text-2xl font-bold font-mono tabular-nums">{eventTypes.length}</div>
            <div className="text-[10px] tx-mu">Catálogo unificado</div>
          </div>
        </div>

        <div className="p-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sf border border-[var(--bd)] flex items-center justify-center tx-mu shrink-0">
            <Brain size={17} />
          </div>
          <div>
            <div className="text-[11px] tx-mu font-medium">Consumidores &amp; Memoria IA</div>
            <div className="text-2xl font-bold font-mono tabular-nums">{consumers.length}</div>
            <div className="text-[10px] tx-mu font-mono">
              {dailyMemory.length} días consolidados
            </div>
          </div>
        </div>

        <div className="p-4 flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${
              isRealDb
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
            }`}
          >
            <Database size={17} />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] tx-mu font-medium">Motor Activo</div>
            <div className="text-xs font-semibold truncate">
              {isRealDb ? 'Supabase OS Real' : 'Simulador + In-Memory'}
            </div>
            <div className="text-[10px] tx-mu truncate">
              {latestMemory ? `Última mem: ${latestMemory.day}` : 'Sin consolidar aún'}
            </div>
          </div>
        </div>
      </div>

      {/* Barra Compacta de Consumidores & Memoria IA (os_memory) */}
      <div className="bg-cd border border-[var(--bd)] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-col gap-1.5 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-[var(--tx)] flex items-center gap-1.5">
                <Brain size={14} className="text-indigo-500" />
                Consumidores &amp; Memoria IA (<code className="font-mono text-[11px]">os_memory</code>)
              </span>
              {consumers.length > 0 ? (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {consumers.map((c) => (
                    <span
                      key={c.consumer_name}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-sf border border-[var(--bd)] text-[10px] font-mono text-[var(--tx)]"
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          c.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                      />
                      <span>{c.consumer_name}</span>
                      <span className="tx-mu">#{c.last_event_id}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[11px] tx-mu">
                  Sin checkpoints todavía — ejecuta Sincronizar + Memoria IA
                </span>
              )}
            </div>

            {latestMemory?.summary_text && (
              <p className="text-[11px] tx-mu truncate" title={latestMemory.summary_text}>
                Resumen reciente: {latestMemory.summary_text}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              onClick={handleSyncAndRebuildMemory}
              disabled={isSyncingMemory}
              className="px-3 py-1.5 rounded-lg bg-[var(--tx)] text-[var(--cd)] text-xs font-semibold flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <RefreshCw size={12} className={isSyncingMemory ? 'animate-spin' : ''} />
              {isSyncingMemory ? 'Sincronizando...' : 'Sincronizar + Memoria IA'}
            </button>

            <button
              onClick={handleExportJsonl}
              disabled={events.length === 0}
              className="px-3 py-1.5 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              <Download size={12} />
              Exportar Dataset IA (.jsonl)
            </button>
          </div>
        </div>

        {syncStatus && (
          <div className="px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300">
            {syncStatus}
          </div>
        )}

        {lastDiagnostic && (
          <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-[11px] text-amber-700 dark:text-amber-300 flex items-center justify-between gap-2">
            <span>Diagnóstico reciente de emisión: {lastDiagnostic}</span>
            <button
              onClick={() => setShowSqlModal(true)}
              className="underline font-semibold shrink-0"
            >
              Revisar SQL Sprint 12
            </button>
          </div>
        )}
      </div>

      {/* Barra de Controles y Filtros */}
      <div className="bg-cd border border-[var(--bd)] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-sf border border-[var(--bd)] rounded-lg text-xs font-medium">
              <span
                className={`w-2 h-2 rounded-full ${isPaused ? 'bg-amber-500' : 'bg-emerald-500'}`}
              />
              <span>{isPaused ? 'Flujo Pausado' : 'Escuchando en Vivo'}</span>
            </div>

            <button
              onClick={() => setIsPaused(!isPaused)}
              className="px-3 py-1.5 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-medium flex items-center gap-1.5 transition-colors"
            >
              {isPaused ? (
                <Play size={13} className="text-emerald-500" />
              ) : (
                <Pause size={13} className="text-amber-500" />
              )}
              {isPaused ? 'Reanudar' : 'Pausar'}
            </button>

            <button
              onClick={() => loadData(true)}
              className="p-1.5 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs transition-colors"
              title="Recargar eventos"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>

            {/* Selector de rango de fechas */}
            <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-sf border border-[var(--bd)]">
              {(
                [
                  { id: 'all', label: 'Todos' },
                  { id: 'today', label: 'Hoy' },
                  { id: '7d', label: '7 días' },
                  { id: '30d', label: '30 días' },
                ] as { id: DateRangeFilter; label: string }[]
              ).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setDateRange(r.id)}
                  className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                    dateRange === r.id
                      ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                      : 'text-[var(--mu)] hover:text-[var(--tx)]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 w-full lg:w-auto">
            <button
              onClick={() => setShowEmitModal(true)}
              className="flex-1 lg:flex-none px-3.5 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 hover:opacity-90 transition-opacity"
            >
              <Send size={13} /> Emitir Evento de Prueba
            </button>

            <button
              onClick={() => setShowSqlModal(true)}
              className="px-3 py-2 border border-[var(--bd)] bg-cd rounded-lg text-xs font-medium flex items-center gap-1.5 hover:bg-sf transition-colors"
            >
              <Code size={13} /> SQL Sprint 12
            </button>
          </div>
        </div>

        {/* Filtros de Dominio y Búsqueda */}
        <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-[var(--bd)]">
          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'order', label: 'Pedidos' },
              { id: 'chat', label: 'Chat' },
              { id: 'lead', label: 'Leads' },
              { id: 'marketing', label: 'Marketing' },
              { id: 'inventory', label: 'Inventario' },
              { id: 'supplier', label: 'Proveedores' },
              { id: 'finance', label: 'Finanzas' },
              { id: 'customer', label: 'DICOM' },
              { id: 'ltv', label: 'LTV' },
              { id: 'system', label: 'Sistema' },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDomain(d.id)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedDomain === d.id
                    ? 'bg-[var(--tx)] text-[var(--cd)] font-semibold'
                    : 'text-[var(--mu)] hover:bg-sf hover:text-[var(--tx)]'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="relative flex-1 w-full">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--mu)]" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por cliente, SKU, teléfono o tipo de evento..."
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-lg bg-sf border border-[var(--bd)] outline-none focus:border-[var(--tx)] transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--mu)] hover:text-[var(--tx)]"
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Lista Principal del Event Stream */}
      <div className="bg-cd border border-[var(--bd)] rounded-xl overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-emerald-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--tx)]">
              Event Stream Feed ({filteredEvents.length} visibles · {totalCount.toLocaleString()} en BD)
            </span>
          </div>
          <span className="text-[11px] tx-mu">
            {isPaused ? 'Modo pausa activo' : 'Actualizando en tiempo real'}
          </span>
        </div>

        <div className="divide-y divide-[var(--bd)] max-h-[620px] overflow-y-auto font-sans">
          {filteredEvents.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center text-[var(--mu)]">
              <Activity size={32} className="opacity-20 mb-2" />
              <p className="text-sm font-semibold">No hay eventos que coincidan con los filtros</p>
              <p className="text-xs opacity-75 mt-1">
                Prueba cambiando los filtros o sincroniza los eventos históricos desde el botón superior.
              </p>
            </div>
          ) : (
            <>
              {filteredEvents.map((event) => {
                const badge = getDomainBadge(event.type);
                const p = event.payload || {};

                return (
                  <div
                    key={event.id || event.idempotency_key}
                    onClick={() => setSelectedEvent(event)}
                    className="p-3.5 hover:bg-sf/70 cursor-pointer transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group"
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="flex flex-col items-start shrink-0 min-w-[70px]">
                        <span className="text-xs font-semibold font-mono tabular-nums text-[var(--tx)]">
                          {formatTime(event.occurred_at)}
                        </span>
                        <span className="text-[10px] tx-mu">
                          {formatTimeAgo(event.occurred_at)}
                        </span>
                      </div>

                      <div className="shrink-0">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider border ${badge.bg}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {badge.label}
                        </span>
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold font-mono text-[var(--tx)] transition-colors">
                            {event.type}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-sf border border-[var(--bd)] font-mono text-[var(--mu)]">
                            {event.source_table}
                          </span>
                        </div>

                        <div className="text-xs text-[var(--mu)] mt-0.5 flex items-center gap-2 flex-wrap truncate">
                          {p.nombre_cliente && (
                            <span className="font-medium text-[var(--tx)]">
                              {p.nombre_cliente}
                            </span>
                          )}
                          {p.total !== undefined && (
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                              ${Number(p.total).toFixed(2)}
                            </span>
                          )}
                          {p.monto !== undefined && (
                            <span className="font-bold text-blue-600 dark:text-blue-400">
                              ${Number(p.monto).toFixed(2)}
                            </span>
                          )}
                          {p.paso_actual && (
                            <span className="font-mono text-[11px] bg-sf px-1.5 py-0.5 rounded text-violet-600 dark:text-violet-400">
                              paso: {p.paso_actual}
                            </span>
                          )}
                          {p.sku && (
                            <span className="font-mono text-[11px] bg-sf px-1 rounded">
                              SKU: {p.sku}
                            </span>
                          )}
                          {p.codigo_anuncio && (
                            <span className="text-indigo-600 dark:text-indigo-400 font-medium text-[11px]">
                              #{p.codigo_anuncio}
                            </span>
                          )}
                          {(p.descripcion || p.concepto) && (
                            <span className="truncate max-w-sm">
                              {p.descripcion || p.concepto}
                            </span>
                          )}
                          {p.text && (
                            <span className="truncate italic max-w-sm">"{p.text}"</span>
                          )}
                          {p.amount !== undefined && (
                            <span className="text-rose-500 font-semibold">
                              Gasto: ${Number(p.amount).toFixed(2)} ({p.platform || 'meta'})
                            </span>
                          )}
                          {p.days_analyzed !== undefined && (
                            <span className="text-indigo-500 font-medium">
                              {p.mode || 'brief'} · {p.days_analyzed}d memoria
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      <span className="text-[10px] tx-mu font-mono hidden md:inline">
                        ID: #{String(event.id)}
                      </span>
                      <button className="p-1 rounded-lg hover:bg-sf text-[var(--mu)] group-hover:text-[var(--tx)]">
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}

              {hasMore && (
                <div className="p-4 bg-sf/50 flex items-center justify-center">
                  <button
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="px-4 py-2 rounded-lg border border-[var(--bd)] bg-cd hover:bg-sf text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 transition-colors"
                  >
                    <ChevronDown size={14} />
                    {loadingMore
                      ? 'Cargando historial...'
                      : `Cargar 200 más (${Math.max(0, totalCount - events.length)} restantes)`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal Inspector de Evento (Payload JSON) */}
      {selectedEvent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setSelectedEvent(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] flex flex-col"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-mono font-semibold border ${
                    getDomainBadge(selectedEvent.type).bg
                  }`}
                >
                  {selectedEvent.type}
                </span>
                <span className="text-xs font-mono tx-mu">ID: {selectedEvent.id}</span>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1.5 rounded-lg hover:bg-black/10 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-sf p-3 rounded-xl border border-[var(--bd)] text-xs">
                <div>
                  <span className="tx-mu block text-[10px] uppercase font-bold">Fecha / Hora</span>
                  <span className="font-mono font-medium">
                    {new Date(selectedEvent.occurred_at).toLocaleString('es-SV')}
                  </span>
                </div>
                <div>
                  <span className="tx-mu block text-[10px] uppercase font-bold">Tabla Origen</span>
                  <span className="font-mono font-semibold">{selectedEvent.source_table}</span>
                </div>
                <div>
                  <span className="tx-mu block text-[10px] uppercase font-bold">ID Registro</span>
                  <span className="font-mono">{selectedEvent.source_id}</span>
                </div>
                <div>
                  <span className="tx-mu block text-[10px] uppercase font-bold">Idempotencia</span>
                  <span
                    className="font-mono truncate block"
                    title={selectedEvent.idempotency_key}
                  >
                    {selectedEvent.idempotency_key.slice(0, 16)}...
                  </span>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider tx-mu flex items-center gap-1.5">
                    <Code size={14} /> Payload del Evento (JSON)
                  </span>
                  <button
                    onClick={handleCopyPayload}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-[var(--bd)] bg-sf hover:bg-black/5 flex items-center gap-1.5 transition-colors"
                  >
                    {copiedPayload ? (
                      <Check size={12} className="text-emerald-500" />
                    ) : (
                      <Copy size={12} />
                    )}
                    {copiedPayload ? '¡Copiado!' : 'Copiar JSON'}
                  </button>
                </div>

                <pre className="p-4 rounded-xl bg-zinc-950 text-emerald-400 font-mono text-xs overflow-x-auto max-h-72 border border-zinc-800 leading-relaxed">
                  {JSON.stringify(selectedEvent.payload, null, 2)}
                </pre>
              </div>
            </div>

            <div className="p-3 border-t border-[var(--bd)] bg-sf flex justify-end">
              <button
                onClick={() => setSelectedEvent(null)}
                className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Emitir Evento de Prueba */}
      {showEmitModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowEmitModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-[var(--ac)]" />
                <h3 className="font-bold text-sm">Simulador de Eventos (Sprint 12)</h3>
              </div>
              <button
                onClick={() => setShowEmitModal(false)}
                className="p-1.5 rounded-lg hover:bg-black/10 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleEmitTest} className="p-5 space-y-4">
              <p className="text-xs text-[var(--mu)]">
                Emite un hecho con la estructura oficial del Event Store para verificar la persistencia en Supabase y el stream en vivo.
              </p>

              <div>
                <label className="block text-xs font-bold tx-mu uppercase mb-1">
                  Tipo de Evento
                </label>
                <select
                  value={testType}
                  onChange={(e) => setTestType(e.target.value)}
                  className="w-full p-2.5 rounded-xl border border-[var(--bd)] bg-sf text-xs font-mono outline-none"
                >
                  <optgroup label="Dominio: Pedidos">
                    <option value="order.created">order.created (Nuevo pedido)</option>
                    <option value="order.confirmed">order.confirmed (Por empacar)</option>
                    <option value="order.shipped">order.shipped (En camino)</option>
                    <option value="order.delivered">order.delivered (Entregado)</option>
                    <option value="order.cancelled">order.cancelled (Cancelado)</option>
                  </optgroup>
                  <optgroup label="Dominio: Mensajería, Bot & Leads">
                    <option value="chat.message.received">
                      chat.message.received (Mensaje cliente)
                    </option>
                    <option value="chat.funnel.progressed">
                      chat.funnel.progressed (Avance de embudo Bot Todd)
                    </option>
                    <option value="lead.generated">lead.generated (Nuevo prospecto)</option>
                  </optgroup>
                  <optgroup label="Dominio: Marketing, Finanzas & IA">
                    <option value="marketing.ad.expense">
                      marketing.ad.expense (Gasto Meta Ads)
                    </option>
                    <option value="marketing.meta.synced">
                      marketing.meta.synced (Sincronización Meta)
                    </option>
                    <option value="finance.income.created">
                      finance.income.created (Cobro liquidado)
                    </option>
                    <option value="finance.bill.paid">
                      finance.bill.paid (Pago recurrente completado)
                    </option>
                    <option value="system.memory.consolidated">
                      system.memory.consolidated (Consolidación Memoria IA)
                    </option>
                    <option value="ai.brief.generated">
                      ai.brief.generated (Brief operativo generado)
                    </option>
                  </optgroup>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold tx-mu uppercase mb-1">Cliente</label>
                  <input
                    type="text"
                    value={testCustomer}
                    onChange={(e) => setTestCustomer(e.target.value)}
                    className="w-full p-2 text-xs rounded-xl border border-[var(--bd)] bg-sf outline-none"
                    placeholder="Nombre completo"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold tx-mu uppercase mb-1">Teléfono</label>
                  <input
                    type="text"
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    className="w-full p-2 text-xs rounded-xl border border-[var(--bd)] bg-sf outline-none"
                    placeholder="70000000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold tx-mu uppercase mb-1">SKU</label>
                  <input
                    type="text"
                    value={testSku}
                    onChange={(e) => setTestSku(e.target.value)}
                    className="w-full p-2 text-xs rounded-xl border border-[var(--bd)] bg-sf outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold tx-mu uppercase mb-1">Total ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={testTotal}
                    onChange={(e) => setTestTotal(e.target.value)}
                    className="w-full p-2 text-xs rounded-xl border border-[var(--bd)] bg-sf outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold tx-mu uppercase mb-1">
                    Cód. Anuncio
                  </label>
                  <input
                    type="text"
                    value={testAdCode}
                    onChange={(e) => setTestAdCode(e.target.value)}
                    className="w-full p-2 text-xs rounded-xl border border-[var(--bd)] bg-sf outline-none font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowEmitModal(false)}
                  className="px-4 py-2 border border-[var(--bd)] rounded-xl text-xs font-semibold hover:bg-sf"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isEmitting}
                  className="px-5 py-2 bg-[var(--ac)] text-white font-bold rounded-xl text-xs flex items-center gap-2 hover:opacity-90 disabled:opacity-50"
                >
                  <Send size={13} /> {isEmitting ? 'Emitiendo...' : 'Publicar Evento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Guía e Instalación SQL Sprint 12 */}
      {showSqlModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowSqlModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-xl border border-[var(--bd)] bg-cd text-[var(--tx)] flex flex-col"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Code size={18} className="text-emerald-500" />
                <h3 className="font-bold text-sm">
                  Script SQL Sprint 12 — OS Event Store Total &amp; Memoria IA
                </h3>
              </div>
              <button
                onClick={() => setShowSqlModal(false)}
                className="p-1.5 rounded-lg hover:bg-black/10 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              <div className="p-4 bg-sf rounded-xl border border-[var(--bd)] text-xs text-[var(--mu)] space-y-2">
                <p className="font-semibold text-[var(--tx)]">
                  Instrucciones de activación en Supabase:
                </p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>
                    Abre tu proyecto de Supabase en{' '}
                    <a
                      href="https://supabase.com/dashboard"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-500 underline inline-flex items-center gap-1"
                    >
                      SQL Editor <ExternalLink size={10} />
                    </a>
                    .
                  </li>
                  <li>
                    Haz clic en <strong>"Copiar SQL Completo"</strong> abajo.
                  </li>
                  <li>
                    Pega el código en el editor de Supabase y presiona <strong>Run</strong>.
                  </li>
                  <li>
                    ¡Listo! Activa 48 tipos de eventos, RPC{' '}
                    <code className="font-mono bg-cd px-1 rounded">public.emit_os_event</code>,
                    triggers sobre pedidos/mensajes/leads y la tabla{' '}
                    <code className="font-mono bg-cd px-1 rounded">os.daily_memory</code> para tus Briefs IA.
                  </li>
                </ol>
              </div>

              <div className="relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono tx-mu">
                    20261117_sprint12_os_events_ai_memory.sql
                  </span>
                  <button
                    onClick={handleCopySql}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm transition-colors"
                  >
                    {copiedSql ? <Check size={14} /> : <Copy size={14} />}
                    {copiedSql ? '¡Copiado al portapapeles!' : 'Copiar SQL Completo'}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800 leading-relaxed">
                  {SPRINT12_SQL_CODE}
                </pre>
              </div>
            </div>

            <div className="p-4 border-t border-[var(--bd)] bg-sf flex justify-between items-center">
              <span className="text-[11px] tx-mu">
                Ubicación en repo:{' '}
                <code className="font-mono">docs/20261117_sprint12_os_events_ai_memory.sql</code>
              </span>
              <button
                onClick={() => setShowSqlModal(false)}
                className="px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
