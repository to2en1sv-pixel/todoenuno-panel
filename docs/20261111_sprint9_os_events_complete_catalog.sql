-- ============================================================================
-- TODOENUNO OS — SPRINT 9: CATÁLOGO TOTAL UNIFICADO DE EVENTOS DEL OS EVENT STREAM
-- Archivo: 20261111_sprint9_os_events_complete_catalog.sql
-- Ejecutar en: Supabase SQL Editor
-- ============================================================================

-- 1. Asegurar esquema del OS
create schema if not exists os;

-- 2. Asegurar tabla base de tipos de eventos
create table if not exists os.event_types (
  type           text primary key,               -- Ej: 'order.created', 'chat.message.received'
  domain         text not null,                  -- 'order', 'chat', 'lead', 'marketing', 'supplier', 'finance', 'inventory', 'customer', 'ltv', 'system'
  description    text,
  payload_schema jsonb,
  enabled        boolean not null default true,
  created_at     timestamptz not null default now()
);

-- 3. Catálogo completo de eventos de todos los módulos del sistema
insert into os.event_types (type, domain, description) values
  -- Dominio: Pedidos & Logística COD
  ('order.created',   'order', 'Nuevo pedido registrado en el sistema'),
  ('order.confirmed', 'order', 'Pedido confirmado / en preparación para empaque'),
  ('order.shipped',   'order', 'Pedido despachado / en camino con motorista o courier'),
  ('order.delivered', 'order', 'Pedido entregado y cobrado en efectivo exitosamente'),
  ('order.cancelled', 'order', 'Pedido cancelado / devuelto en puerta'),
  ('order.scheduled', 'order', 'Pedido programado / encargo a futuro asignado'),

  -- Dominio: Mensajería, Conversaciones & Omnicanal (UniChat / Social Inbox)
  ('chat.message.received', 'chat', 'Mensaje entrante de cliente (WhatsApp / Facebook)'),
  ('chat.message.sent',     'chat', 'Mensaje saliente de agente o bot'),
  ('chat.bot.toggled',      'chat', 'Cambio de modo Bot automatizado vs Agente Humano'),
  ('social.reply.sent',     'chat', 'Respuesta enviada a DM o comentario social de Meta'),
  ('lead.generated',        'lead', 'Nuevo prospecto captado desde chat o anuncio'),

  -- Dominio: Marketing, Anuncios & Redes
  ('marketing.post.created',    'marketing', 'Publicación programada en cola de redes'),
  ('marketing.post.published',  'marketing', 'Publicación emitida en Facebook / Instagram'),
  ('marketing.lead.generated',  'marketing', 'Lead captado por formulario publicitario'),
  ('marketing.ad.expense',      'marketing', 'Gasto publicitario diario registrado en Meta / TikTok'),

  -- Dominio: Inventario, Kárdex & Catálogo
  ('inventory.adjustment', 'inventory', 'Ajuste manual de stock / merma / conteo físico'),
  ('product.created',      'inventory', 'Nuevo producto creado en el catálogo'),
  ('product.updated',      'inventory', 'Detalles comerciales o pitch de Todd actualizados'),

  -- Dominio: Proveedores, Licitaciones & Compras
  ('supplier.created',      'supplier', 'Nuevo proveedor registrado en el catálogo'),
  ('purchase.requested',    'supplier', 'Licitación masiva / compra solicitada'),
  ('supplier.bid.received', 'supplier', 'Oferta o cotización recibida de proveedor'),
  ('supplier.selected',     'supplier', 'Proveedor adjudicado para orden de compra'),

  -- Dominio: Finanzas, Caja & Money Engine
  ('finance.income.created',  'finance', 'Ingreso liquidado (pedido entregado cobrado)'),
  ('finance.expense.created', 'finance', 'Egreso asentado (pauta publicitaria / compra stock)'),
  ('finance.debt.created',    'finance', 'Deuda o cuenta por pagar registrada'),

  -- Dominio: Clientes, Score Antifraude & DICOM Interno
  ('customer.blacklisted', 'customer', 'Cliente boletinado en Lista Negra / DICOM'),
  ('customer.whitelisted', 'customer', 'Cliente rehabilitado de Lista Negra'),
  ('customer.notified',    'customer', 'Cliente notificado formalmente por WhatsApp'),

  -- Dominio: Fidelización, LTV & Ofertas Flash Cross-Sell
  ('ltv.campaign_created', 'ltv', 'Campaña de Oferta Flash creada por ciclo de necesidad'),
  ('ltv.offer_dispatched', 'ltv', 'Oferta Flash despachada a cliente por WhatsApp'),

  -- Dominio: Sistema & Diagnóstico
  ('system.heartbeat', 'system', 'Latido de monitoreo / salud del sistema'),
  ('system.test',      'system', 'Evento emitido manualmente para pruebas de integridad')
on conflict (type) do update set
  domain = excluded.domain,
  description = excluded.description,
  enabled = excluded.enabled;

-- 4. Habilitar permisos RLS para lectura y escritura desde la aplicación
alter table os.event_types enable row level security;
grant select, insert, update on os.event_types to anon, authenticated, service_role;

drop policy if exists "Acceso publico lectura a event_types" on os.event_types;
create policy "Acceso publico lectura a event_types"
  on os.event_types for select
  using (true);

-- 5. Asegurar vistas públicas si no existen
create or replace view public.os_event_types as
  select * from os.event_types;

grant select on public.os_event_types to anon, authenticated, service_role;

select 'Catálogo completo de eventos OS (Sprint 9) sincronizado exitosamente' as resultado;
