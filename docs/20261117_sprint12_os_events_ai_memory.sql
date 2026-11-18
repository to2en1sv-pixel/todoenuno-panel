-- ============================================================================
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
  -- Pedidos & Logística COD
  ('order.created',              'order', 'Nuevo pedido registrado en el sistema'),
  ('order.confirmed',            'order', 'Pedido confirmado / en preparación para empaque'),
  ('order.shipped',              'order', 'Pedido despachado / en ruta con motorista o courier'),
  ('order.delivered',            'order', 'Pedido entregado y cobrado en puerta exitosamente'),
  ('order.cancelled',            'order', 'Pedido cancelado o devuelto en entrega'),
  ('order.scheduled',            'order', 'Pedido programado / encargo a futuro'),
  ('order.delivery_issue',       'order', 'Novedad o incidencia reportada en ruta de entrega'),
  ('order.dispatch.photo_sent',  'order', 'Foto de guía o paquete despachado enviada al cliente'),
  ('order.delay.notified',       'order', 'Aviso de retraso logístico enviado por WhatsApp'),

  -- Mensajería, Bot Todd, Omnicanal & Leads
  ('chat.message.received',      'chat', 'Mensaje entrante de cliente (WhatsApp / Redes)'),
  ('chat.message.sent',          'chat', 'Mensaje saliente enviado por Bot Todd o agente humano'),
  ('chat.bot.toggled',           'chat', 'Cambio de modo Bot Todd automatizado vs Agente Humano'),
  ('chat.funnel.progressed',     'chat', 'Avance del cliente en el embudo de Bot Todd y SKU cotizado'),
  ('social.reply.sent',          'chat', 'Respuesta enviada a DM o comentario social de Meta'),
  ('lead.generated',             'lead', 'Prospecto captado desde chat WhatsApp o anuncio'),

  -- Marketing, Pauta Meta & Contenido
  ('marketing.post.created',     'marketing', 'Pieza agregada o programada en cola / bodega de contenido'),
  ('marketing.post.published',   'marketing', 'Publicación emitida en Facebook / Instagram'),
  ('marketing.lead.generated',   'marketing', 'Lead captado desde formulario o comentario de anuncio'),
  ('marketing.ad.expense',       'marketing', 'Gasto publicitario diario registrado en Meta / TikTok'),
  ('marketing.meta.synced',      'marketing', 'Sincronización automática ejecutada con Meta Marketing API'),

  -- Inventario, Kárdex & Catálogo
  ('inventory.adjustment',       'inventory', 'Ajuste manual de stock / merma / conteo físico'),
  ('product.created',            'inventory', 'Nuevo producto creado en el catálogo'),
  ('product.updated',            'inventory', 'Producto actualizado en catálogo o pitch de Bot Todd'),
  ('product.deleted',            'inventory', 'Producto desactivado o eliminado del catálogo'),

  -- Proveedores, Licitaciones & Compras
  ('supplier.created',           'supplier', 'Nuevo proveedor registrado en el catálogo'),
  ('purchase.requested',         'supplier', 'Solicitud o licitación de compra creada'),
  ('supplier.bid.received',      'supplier', 'Oferta o cotización recibida de proveedor'),
  ('supplier.selected',          'supplier', 'Proveedor adjudicado para compra'),

  -- Finanzas, Cajas & Pagos Recurrentes
  ('finance.income.created',     'finance', 'Ingreso liquidado en caja (pedido COD cobrado)'),
  ('finance.expense.created',    'finance', 'Egreso asentado (pauta, compra o gasto operativo)'),
  ('finance.debt.created',       'finance', 'Cuenta por pagar o deuda registrada'),
  ('finance.transfer.created',   'finance', 'Transferencia interna entre cuentas o cajas'),
  ('finance.bill.created',       'finance', 'Pago recurrente o suscripción registrada en calendario'),
  ('finance.bill.paid',          'finance', 'Pago recurrente marcado como pagado y renovado'),

  -- Clientes, Antifraude & DICOM Interno
  ('customer.blacklisted',       'customer', 'Cliente agregado a Lista Negra / DICOM interno'),
  ('customer.whitelisted',       'customer', 'Cliente rehabilitado de Lista Negra'),
  ('customer.notified',          'customer', 'Notificación formal enviada a cliente por WhatsApp'),

  -- Fidelización, LTV & Ofertas Flash
  ('ltv.campaign_created',       'ltv', 'Campaña de Oferta Flash / recompra creada'),
  ('ltv.offer_dispatched',       'ltv', 'Oferta Flash enviada por WhatsApp a cliente previo'),

  -- Sistema, Mantenimiento & Capa IA
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

-- 4. Función os.emit_event mejorada: auto-registra cualquier p_type nuevo para nunca perder eventos por FK
create or replace function os.emit_event(
  p_type            text,
  p_source_table    text,
  p_source_id       text,
  p_idempotency_key text,
  p_payload         jsonb default '{}'::jsonb
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

  insert into os.events (type, source_table, source_id, idempotency_key, payload)
  values (p_type, p_source_table, p_source_id, p_idempotency_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (idempotency_key) do nothing
  returning id into v_id;

  return coalesce(v_id, -1);
end;
$$;

-- Wrapper RPC público para cliente web y rutas serverless
create or replace function public.emit_os_event(
  p_type            text,
  p_source_table    text,
  p_source_id       text,
  p_idempotency_key text,
  p_payload         jsonb default '{}'::jsonb
) returns bigint
language sql security definer set search_path = os, public as $$
  select os.emit_event(p_type, p_source_table, p_source_id, p_idempotency_key, p_payload);
$$;

-- 5. Trigger enriquecido sobre whatsapp_orders (lectura segura vía to_jsonb)
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

-- 6. Triggers automáticos seguros para Mensajería (bb_messages / bb_conversations) y Leads (fb_leads)
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

-- 7. CAPA DE MEMORIA IA (os.daily_memory): Entrenamiento y contexto histórico diario para Brief & Bot IA
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

-- 8. Permisos, Políticas RLS y Vistas Públicas
alter table os.events enable row level security;
alter table os.event_types enable row level security;
alter table os.state_event_map enable row level security;
alter table os.event_consumers enable row level security;
alter table os.daily_memory enable row level security;

grant usage on schema os to anon, authenticated, service_role;
grant select, insert on os.events to anon, authenticated, service_role;
grant select, insert, update on os.event_types, os.event_consumers, os.daily_memory to anon, authenticated, service_role;
grant select on os.state_event_map to anon, authenticated, service_role;
grant execute on function os.emit_event(text, text, text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.emit_os_event(text, text, text, text, jsonb) to anon, authenticated, service_role;
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

-- 9. Realtime para os.events
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

-- 10. Construir memoria histórica inicial de los últimos 30 días desde os.events
select public.rebuild_os_memory(30) as sprint12_resultado;
