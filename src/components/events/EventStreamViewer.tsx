import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, 
  Radio, 
  Pause, 
  Play, 
  RefreshCw, 
  Search, 
  Filter, 
  Database, 
  Send, 
  Copy, 
  Check, 
  X, 
  ExternalLink, 
  Code, 
  Info, 
  ChevronRight,
  Clock,
  Tag,
  Hash,
  Layers,
  Sparkles,
  AlertTriangle
} from 'lucide-react';
import { 
  fetchOsEvents, 
  fetchOsEventTypes, 
  fetchOsConsumers, 
  emitOsEvent, 
  subscribeToOsEvents,
  DEFAULT_EVENT_TYPES 
} from '@/lib/osEvents';
import type { OsEvent, OsEventType, OsEventConsumer, EventDomain } from '@/types/events';

// SQL completo para visualización y copia rápida
const SPRINT1_SQL_CODE = `-- ============================================================================
-- TODOENUNO OS — SPRINT 1: OS EVENT STORE (VERSIÓN OFICIAL)
-- Ejecutar en: Supabase SQL Editor
-- ============================================================================
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

insert into os.event_types (type, domain, description) values
  ('order.created',   'order', 'Nuevo pedido registrado en el sistema'),
  ('order.confirmed', 'order', 'Pedido confirmado / por empacar'),
  ('order.shipped',   'order', 'Pedido despachado / en camino'),
  ('order.delivered', 'order', 'Pedido entregado exitosamente'),
  ('order.cancelled', 'order', 'Pedido cancelado'),
  ('chat.message.received', 'chat', 'Mensaje entrante de cliente'),
  ('chat.message.sent',     'chat', 'Mensaje saliente a cliente'),
  ('lead.generated',        'lead', 'Nuevo prospecto capturado'),
  ('marketing.post.created',    'marketing', 'Publicación programada'),
  ('marketing.post.published',  'marketing', 'Publicación emitida'),
  ('marketing.lead.generated',  'marketing', 'Lead captado por anuncio'),
  ('marketing.ad.expense',      'marketing', 'Gasto diario publicitario'),
  ('supplier.created',      'supplier', 'Nuevo proveedor registrado'),
  ('purchase.requested',    'supplier', 'Licitación de compra creada'),
  ('supplier.bid.received', 'supplier', 'Oferta recibida de proveedor'),
  ('supplier.selected',     'supplier', 'Proveedor seleccionado'),
  ('finance.income.created',  'finance', 'Ingreso por venta liquidado'),
  ('finance.expense.created', 'finance', 'Gasto operativo asentado'),
  ('system.heartbeat', 'system', 'Señal de monitoreo'),
  ('system.test',      'system', 'Evento de prueba')
on conflict (type) do nothing;

insert into os.state_event_map (source_table, estado, event_type) values
  ('whatsapp_orders', 'nuevo',        'order.created'),
  ('whatsapp_orders', 'por_empacar',  'order.confirmed'),
  ('whatsapp_orders', 'confirmado',   'order.confirmed'),
  ('whatsapp_orders', 'en_camino',    'order.shipped'),
  ('whatsapp_orders', 'enviado',      'order.shipped'),
  ('whatsapp_orders', 'entregado',    'order.delivered'),
  ('whatsapp_orders', 'cancelado',    'order.cancelled'),
  ('whatsapp_orders', 'cancelada',    'order.cancelled')
on conflict (source_table, estado) do update set event_type = excluded.event_type;

create or replace function os.emit_event(
  p_type            text,
  p_source_table    text,
  p_source_id       text,
  p_idempotency_key text,
  p_payload         jsonb default '{}'::jsonb
) returns bigint
language plpgsql security definer set search_path = os, public as $$
declare v_id bigint;
begin
  insert into os.events (type, source_table, source_id, idempotency_key, payload)
  values (p_type, p_source_table, p_source_id, p_idempotency_key, coalesce(p_payload, '{}'::jsonb))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  return coalesce(v_id, -1);
end;
$$;

create or replace function os.whatsapp_orders_events() returns trigger
language plpgsql as $$
declare v_event_type text;
begin
  if TG_OP = 'INSERT' then
    select m.event_type into v_event_type from os.state_event_map m
     where m.source_table = 'whatsapp_orders' and m.estado = NEW.estado;

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
        'metodo_pago',    NEW.metodo_pago
      ));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    if OLD.estado is distinct from NEW.estado then
      select m.event_type into v_event_type from os.state_event_map m
       where m.source_table = 'whatsapp_orders' and m.estado = NEW.estado;

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

drop trigger if exists trg_whatsapp_orders_events on public.whatsapp_orders;
create trigger trg_whatsapp_orders_events
  after insert or update on public.whatsapp_orders
  for each row execute function os.whatsapp_orders_events();

alter table os.events enable row level security;
alter table os.event_types enable row level security;
alter table os.state_event_map enable row level security;
alter table os.event_consumers enable row level security;

grant usage on schema os to anon, authenticated, service_role;
grant select, insert on os.events to anon, authenticated, service_role;
grant select on os.event_types, os.state_event_map, os.event_consumers to anon, authenticated, service_role;
grant execute on function os.emit_event to anon, authenticated, service_role;

drop policy if exists "os_events_read" on os.events;
drop policy if exists "os_events_insert" on os.events;
drop policy if exists "os_event_types_read" on os.event_types;
drop policy if exists "os_state_event_map_read" on os.state_event_map;
drop policy if exists "os_event_consumers_read" on os.event_consumers;

create policy "os_events_read" on os.events for select using (true);
create policy "os_events_insert" on os.events for insert with check (true);
create policy "os_event_types_read" on os.event_types for select using (true);
create policy "os_state_event_map_read" on os.state_event_map for select using (true);
create policy "os_event_consumers_read" on os.event_consumers for select using (true);

create or replace view public.os_events as select * from os.events;
create or replace view public.os_event_types as select * from os.event_types;
create or replace view public.os_event_consumers as select * from os.event_consumers;

grant select, insert on public.os_events to anon, authenticated, service_role;
grant select on public.os_event_types to anon, authenticated, service_role;
grant select on public.os_event_consumers to anon, authenticated, service_role;

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
end $$;`;

export function EventStreamViewer() {
  const [events, setEvents] = useState<OsEvent[]>([]);
  const [eventTypes, setEventTypes] = useState<OsEventType[]>(DEFAULT_EVENT_TYPES);
  const [consumers, setConsumers] = useState<OsEventConsumer[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRealDb, setIsRealDb] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  
  // Controles de visualización
  const [isPaused, setIsPaused] = useState(false);
  const [selectedDomain, setSelectedDomain] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
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
    const result = await fetchOsEvents(80);
    setEvents(result.events);
    setIsRealDb(result.isRealDb);
    setDbError(result.error || null);

    const [typesData, consumersData] = await Promise.all([
      fetchOsEventTypes(),
      fetchOsConsumers()
    ]);
    if (typesData.length > 0) setEventTypes(typesData);
    if (consumersData.length > 0) setConsumers(consumersData);

    if (!silent) setLoading(false);
  };

  useEffect(() => {
    loadData();

    // Suscripción al stream
    const unsubscribe = subscribeToOsEvents((incomingEvent) => {
      if (!isPaused) {
        setEvents((prev) => {
          // Evitar duplicados por ID
          if (prev.some((e) => e.id === incomingEvent.id || e.idempotency_key === incomingEvent.idempotency_key)) {
            return prev;
          }
          return [incomingEvent, ...prev];
        });
      }
    });

    return () => unsubscribe();
  }, [isPaused]);

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
        is_simulation: true
      };
    } else if (testType.startsWith('chat.')) {
      payload = {
        conversation_id: `conv-${mockId}`,
        sender_id: testCustomer.toLowerCase().replace(/\s+/g, '-'),
        text: `Hola, deseo consultar el estado de mi pedido del producto ${testSku}`,
        channel: 'whatsapp'
      };
    } else if (testType.startsWith('lead.')) {
      payload = {
        lead_id: `lead-${mockId}`,
        nombre: testCustomer,
        telefono: testPhone,
        codigo_anuncio: testAdCode
      };
    } else {
      payload = {
        message: 'Evento emitido manualmente para pruebas de arquitectura',
        timestamp: new Date().toISOString()
      };
    }

    await emitOsEvent({
      type: testType,
      source_table: testType.startsWith('order.') ? 'whatsapp_orders' : 'panel_simulator',
      source_id: mockId,
      payload
    });

    setIsEmitting(false);
    setShowEmitModal(false);
  };

  // Copiar SQL
  const handleCopySql = () => {
    navigator.clipboard.writeText(SPRINT1_SQL_CODE);
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

  // Filtrado de eventos
  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      // Filtro dominio
      if (selectedDomain !== 'all') {
        const parts = ev.type.split('.');
        const domain = parts[0];
        if (domain !== selectedDomain) return false;
      }

      // Filtro tipo específico
      if (selectedType !== 'all' && ev.type !== selectedType) {
        return false;
      }

      // Búsqueda en texto y payload
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const typeMatch = ev.type.toLowerCase().includes(term);
        const sourceMatch = ev.source_table.toLowerCase().includes(term);
        const payloadStr = JSON.stringify(ev.payload).toLowerCase();
        const payloadMatch = payloadStr.includes(term);
        if (!typeMatch && !sourceMatch && !payloadMatch) return false;
      }

      return true;
    });
  }, [events, selectedDomain, selectedType, searchTerm]);

  // Helper para obtener estilo de dominio
  const getDomainBadge = (type: string) => {
    const domain = type.split('.')[0];
    switch (domain) {
      case 'order':
        return {
          bg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
          label: 'PEDIDO',
          dot: 'bg-emerald-500'
        };
      case 'chat':
        return {
          bg: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30',
          label: 'CHAT',
          dot: 'bg-violet-500'
        };
      case 'lead':
        return {
          bg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
          label: 'LEAD',
          dot: 'bg-amber-500'
        };
      case 'marketing':
        return {
          bg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
          label: 'MKTG',
          dot: 'bg-rose-500'
        };
      case 'supplier':
        return {
          bg: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
          label: 'PROV',
          dot: 'bg-orange-500'
        };
      case 'finance':
        return {
          bg: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
          label: 'FINANZAS',
          dot: 'bg-blue-500'
        };
      case 'inventory':
        return {
          bg: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30',
          label: 'INVENTARIO',
          dot: 'bg-teal-500'
        };
      case 'customer':
        return {
          bg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30',
          label: 'DICOM',
          dot: 'bg-rose-500'
        };
      case 'ltv':
        return {
          bg: 'bg-fuchsia-500/15 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/30',
          label: 'LTV FLASH',
          dot: 'bg-fuchsia-500'
        };
      default:
        return {
          bg: 'bg-zinc-500/15 text-zinc-600 dark:text-zinc-400 border-zinc-500/30',
          label: 'SISTEMA',
          dot: 'bg-zinc-500'
        };
    }
  };

  // Formato de hora exacta
  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '—';
    }
  };

  // Formato relativo
  const formatTimeAgo = (iso: string) => {
    try {
      const d = new Date(iso);
      const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
      if (diffSec < 10) return 'hace un momento';
      if (diffSec < 60) return `hace ${diffSec}s`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `hace ${diffMin}m`;
      const diffHour = Math.floor(diffMin / 60);
      return `hace ${diffHour}h`;
    } catch {
      return '';
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Banner de Estado de Integración SQL */}
      {!isRealDb && (
        <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5 sm:mt-0">
              <AlertTriangle size={18} />
            </div>
            <div>
              <div className="font-bold text-sm text-[var(--tx)] flex items-center gap-2">
                Sprint 1: Schema OS y Event Store Listo
                <span className="text-[10px] px-2 py-0.5 bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold rounded-full">
                  Pendiente de ejecutar en Supabase
                </span>
              </div>
              <p className="text-xs text-[var(--mu)] mt-0.5">
                El panel está mostrando el visor en tiempo real y permitiendo emitir eventos de simulación. Ejecuta el SQL oficial en el editor de Supabase para activar los triggers automáticos sobre <code className="px-1 py-0.5 bg-sf rounded text-[11px] font-mono">whatsapp_orders</code>.
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowSqlModal(true)}
            className="w-full sm:w-auto px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-colors shrink-0"
          >
            <Code size={14} /> Ver SQL y Guía de Instalación
          </button>
        </div>
      )}

      {/* KPI Cards del Event Store */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--sf)] flex items-center justify-center text-[var(--ac)]">
            <Activity size={20} />
          </div>
          <div>
            <div className="text-[11px] tx-mu uppercase font-bold tracking-wider">Eventos en Buffer</div>
            <div className="text-2xl font-black">{events.length}</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500">
            <Layers size={20} />
          </div>
          <div>
            <div className="text-[11px] tx-mu uppercase font-bold tracking-wider">Tipos de Eventos</div>
            <div className="text-2xl font-black">{eventTypes.length}</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-500">
            <Radio size={20} />
          </div>
          <div>
            <div className="text-[11px] tx-mu uppercase font-bold tracking-wider">Consumidores OS</div>
            <div className="text-2xl font-black">{consumers.length}</div>
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-cd border border-[var(--bd)] flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isRealDb ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
            <Database size={20} />
          </div>
          <div>
            <div className="text-[11px] tx-mu uppercase font-bold tracking-wider">Motor Activo</div>
            <div className="text-xs font-bold truncate">
              {isRealDb ? 'Supabase OS Real' : 'Simulador + In-Memory'}
            </div>
          </div>
        </div>
      </div>

      {/* Barra de Controles y Filtros */}
      <div className="bg-cd border border-[var(--bd)] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-sf border border-[var(--bd)] rounded-xl text-xs font-semibold">
              <span className={`w-2.5 h-2.5 rounded-full ${isPaused ? 'bg-amber-500' : 'bg-emerald-500 animate-pulse'}`} />
              <span>{isPaused ? 'Flujo Pausado' : 'Escuchando en Vivo'}</span>
            </div>

            <button
              onClick={() => setIsPaused(!isPaused)}
              className="px-3 py-1.5 rounded-xl border border-[var(--bd)] bg-sf hover:bg-black/5 text-xs font-semibold flex items-center gap-1.5 transition-colors"
            >
              {isPaused ? <Play size={13} className="text-emerald-500" /> : <Pause size={13} className="text-amber-500" />}
              {isPaused ? 'Reanudar' : 'Pausar'}
            </button>

            <button
              onClick={() => loadData(true)}
              className="p-1.5 rounded-xl border border-[var(--bd)] bg-sf hover:bg-black/5 text-xs transition-colors"
              title="Recargar eventos"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="flex items-center gap-2 w-full lg:w-auto">
            <button
              onClick={() => setShowEmitModal(true)}
              className="flex-1 lg:flex-none px-4 py-2 bg-[var(--tx)] text-[var(--cd)] rounded-xl text-xs font-bold flex items-center justify-center gap-2 hover:opacity-90 transition-opacity shadow-sm"
            >
              <Send size={13} /> Emitir Evento de Prueba
            </button>

            <button
              onClick={() => setShowSqlModal(true)}
              className="px-3 py-2 border border-[var(--bd)] rounded-xl text-xs font-bold flex items-center gap-1.5 hover:bg-sf transition-colors"
            >
              <Code size={14} /> SQL Sprint 1
            </button>
          </div>
        </div>

        {/* Filtros de Dominio y Búsqueda */}
        <div className="flex flex-col sm:flex-row items-center gap-2 pt-2 border-t border-[var(--bd)]">
          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'order', label: '📦 Pedidos' },
              { id: 'chat', label: '💬 Chat' },
              { id: 'lead', label: '🎯 Leads' },
              { id: 'marketing', label: '📢 Marketing' },
              { id: 'inventory', label: '🏷️ Inventario' },
              { id: 'supplier', label: '🏢 Proveedores' },
              { id: 'finance', label: '💰 Finanzas' },
              { id: 'customer', label: '🛡️ DICOM' },
              { id: 'ltv', label: '⚡ LTV' },
              { id: 'system', label: '⚙️ Sistema' },
            ].map((d) => (
              <button
                key={d.id}
                onClick={() => setSelectedDomain(d.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedDomain === d.id
                    ? 'bg-[var(--tx)] text-[var(--cd)]'
                    : 'text-[var(--mu)] hover:bg-sf'
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
              className="w-full pl-9 pr-8 py-1.5 text-xs rounded-xl bg-sf border border-[var(--bd)] outline-none focus:border-[var(--ac)] transition-colors"
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

      {/* Lista Principal del Event Stream (Visor Vivo del Paso 5) */}
      <div className="bg-cd border border-[var(--bd)] rounded-2xl overflow-hidden shadow-sm flex flex-col">
        <div className="px-5 py-3 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
          <div className="flex items-center gap-2">
            <Radio size={15} className="text-emerald-500 animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider text-[var(--tx)]">
              Event Stream Feed ({filteredEvents.length} eventos)
            </span>
          </div>
          <span className="text-[11px] tx-mu">
            {isPaused ? 'Modo pausa activo' : 'Actualizando en tiempo real'}
          </span>
        </div>

        <div className="divide-y divide-[var(--bd)] max-h-[600px] overflow-y-auto font-sans">
          {filteredEvents.length === 0 ? (
            <div className="p-12 text-center flex flex-col items-center justify-center text-[var(--mu)]">
              <Activity size={36} className="opacity-20 mb-2" />
              <p className="text-sm font-semibold">No hay eventos que coincidan con los filtros</p>
              <p className="text-xs opacity-75 mt-1">
                Prueba cambiando los filtros o emite un evento de prueba con el botón superior.
              </p>
            </div>
          ) : (
            filteredEvents.map((event) => {
              const badge = getDomainBadge(event.type);
              const p = event.payload || {};

              return (
                <div
                  key={event.id || event.idempotency_key}
                  onClick={() => setSelectedEvent(event)}
                  className="p-3.5 hover:bg-sf/70 cursor-pointer transition-colors flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 group"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    {/* Timestamp estilo terminal */}
                    <div className="flex flex-col items-start shrink-0 min-w-[70px]">
                      <span className="text-xs font-bold font-mono text-[var(--tx)]">
                        {formatTime(event.occurred_at)}
                      </span>
                      <span className="text-[10px] tx-mu">
                        {formatTimeAgo(event.occurred_at)}
                      </span>
                    </div>

                    {/* Badge de Dominio */}
                    <div className="shrink-0">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${badge.bg}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                        {badge.label}
                      </span>
                    </div>

                    {/* Nombre del evento y resumen del payload */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold font-mono text-[var(--tx)] group-hover:text-[var(--ac)] transition-colors">
                          {event.type}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-sf border border-[var(--bd)] font-mono text-[var(--mu)]">
                          {event.source_table}
                        </span>
                      </div>

                      {/* Resumen contextual según datos */}
                      <div className="text-xs text-[var(--mu)] mt-0.5 flex items-center gap-2 flex-wrap truncate">
                        {p.nombre_cliente && (
                          <span className="font-semibold text-[var(--tx)]">
                            👤 {p.nombre_cliente}
                          </span>
                        )}
                        {p.total !== undefined && (
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">
                            ${Number(p.total).toFixed(2)}
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
                        {p.text && (
                          <span className="truncate italic max-w-sm">
                            "{p.text}"
                          </span>
                        )}
                        {p.amount !== undefined && (
                          <span className="text-rose-500 font-semibold">
                            Gasto: ${p.amount} ({p.platform || 'ad'})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Acceso a detalle */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <span className="text-[10px] tx-mu font-mono hidden md:inline">
                      ID: #{String(event.id).slice(-6)}
                    </span>
                    <button className="p-1 rounded-lg hover:bg-sf text-[var(--mu)] group-hover:text-[var(--tx)]">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              );
            })
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
            className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${getDomainBadge(selectedEvent.type).bg}`}>
                  {selectedEvent.type}
                </span>
                <span className="text-xs font-mono tx-mu">
                  ID: {selectedEvent.id}
                </span>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1.5 rounded-lg hover:bg-black/10 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4">
              {/* Metadatos del evento */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-sf p-3 rounded-xl border border-[var(--bd)] text-xs">
                <div>
                  <span className="tx-mu block text-[10px] uppercase font-bold">Fecha / Hora</span>
                  <span className="font-mono font-medium">{new Date(selectedEvent.occurred_at).toLocaleString('es-SV')}</span>
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
                  <span className="font-mono truncate block" title={selectedEvent.idempotency_key}>
                    {selectedEvent.idempotency_key.slice(0, 16)}...
                  </span>
                </div>
              </div>

              {/* Payload JSON */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider tx-mu flex items-center gap-1.5">
                    <Code size={14} /> Payload del Evento (JSON)
                  </span>
                  <button
                    onClick={handleCopyPayload}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-[var(--bd)] bg-sf hover:bg-black/5 flex items-center gap-1.5 transition-colors"
                  >
                    {copiedPayload ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
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
            className="w-full max-w-lg rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl overflow-hidden"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-[var(--ac)]" />
                <h3 className="font-bold text-sm">Simulador de Eventos (Sprint 1)</h3>
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
                Emite un hecho con la estructura oficial del Event Store para verificar la visualización y las transiciones en el stream.
              </p>

              <div>
                <label className="block text-xs font-bold tx-mu uppercase mb-1">Tipo de Evento</label>
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
                  <optgroup label="Dominio: Mensajería & Leads">
                    <option value="chat.message.received">chat.message.received (Mensaje cliente)</option>
                    <option value="lead.generated">lead.generated (Nuevo prospecto)</option>
                  </optgroup>
                  <optgroup label="Dominio: Marketing & Finanzas">
                    <option value="marketing.ad.expense">marketing.ad.expense (Gasto Meta Ads)</option>
                    <option value="finance.income.created">finance.income.created (Cobro liquidado)</option>
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
                  <label className="block text-xs font-bold tx-mu uppercase mb-1">Cód. Anuncio</label>
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

      {/* Modal Guía e Instalación SQL Sprint 1 */}
      {showSqlModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowSqlModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--bd)] bg-cd text-[var(--tx)] shadow-2xl flex flex-col"
          >
            <div className="p-4 border-b border-[var(--bd)] flex items-center justify-between bg-sf">
              <div className="flex items-center gap-2">
                <Code size={18} className="text-emerald-500" />
                <h3 className="font-bold text-sm">Script SQL Sprint 1 — OS Event Store</h3>
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
                  <li>Abre tu proyecto de Supabase en <a href="https://supabase.com/dashboard" target="_blank" rel="noreferrer" className="text-indigo-500 underline inline-flex items-center gap-1">SQL Editor <ExternalLink size={10} /></a>.</li>
                  <li>Haz clic en <strong>"Copiar SQL Completo"</strong> abajo.</li>
                  <li>Pega el código en el editor de Supabase y presiona <strong>Run</strong>.</li>
                  <li>¡Listo! El esquema <code className="font-mono bg-cd px-1 rounded">os</code>, la tabla <code className="font-mono bg-cd px-1 rounded">os.events</code>, el trigger sobre <code className="font-mono bg-cd px-1 rounded">whatsapp_orders</code> y las políticas RLS quedarán activados.</li>
                </ol>
              </div>

              <div className="relative">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-mono tx-mu">20261107_sprint1_os_event_store.sql</span>
                  <button
                    onClick={handleCopySql}
                    className="px-3 py-1.5 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-sm transition-colors"
                  >
                    {copiedSql ? <Check size={14} /> : <Copy size={14} />}
                    {copiedSql ? '¡Copiado al portapapeles!' : 'Copiar SQL Completo'}
                  </button>
                </div>
                <pre className="p-4 rounded-xl bg-zinc-950 text-zinc-200 font-mono text-xs overflow-x-auto max-h-96 border border-zinc-800 leading-relaxed">
                  {SPRINT1_SQL_CODE}
                </pre>
              </div>
            </div>

            <div className="p-4 border-t border-[var(--bd)] bg-sf flex justify-between items-center">
              <span className="text-[11px] tx-mu">
                Ubicación en repo: <code className="font-mono">docs/20261107_sprint1_os_event_store.sql</code>
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
