import { supabase } from '@/lib/supabase';
import type { OsEvent, OsEventType, OsEventConsumer, EmitEventParams } from '@/types/events';

// Simulación inicial representativa del Sprint 1 para cuando Supabase aún no tiene la migración aplicada
const SAMPLE_EVENTS: OsEvent[] = [
  {
    id: 105,
    type: 'order.delivered',
    occurred_at: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
    source_table: 'whatsapp_orders',
    source_id: 'ord-8831',
    idempotency_key: 'whatsapp_orders:ord-8831:order.delivered:1731000000',
    payload: {
      order_id: 'ord-8831',
      pedido_codigo: 'PED-8831',
      nombre_cliente: 'Carlos Méndez',
      telefono: '70231940',
      total: 35.0,
      sku: 'MINI-EMS-01',
      estado_anterior: 'en_camino',
      estado: 'entregado',
      codigo_anuncio: 'FB-EMS-VID2'
    }
  },
  {
    id: 104,
    type: 'order.shipped',
    occurred_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    source_table: 'whatsapp_orders',
    source_id: 'ord-8831',
    idempotency_key: 'whatsapp_orders:ord-8831:order.shipped:1730999000',
    payload: {
      order_id: 'ord-8831',
      pedido_codigo: 'PED-8831',
      nombre_cliente: 'Carlos Méndez',
      telefono: '70231940',
      total: 35.0,
      sku: 'MINI-EMS-01',
      estado_anterior: 'por_empacar',
      estado: 'en_camino'
    }
  },
  {
    id: 103,
    type: 'order.confirmed',
    occurred_at: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    source_table: 'whatsapp_orders',
    source_id: 'ord-8831',
    idempotency_key: 'whatsapp_orders:ord-8831:order.confirmed:1730998000',
    payload: {
      order_id: 'ord-8831',
      pedido_codigo: 'PED-8831',
      nombre_cliente: 'Carlos Méndez',
      total: 35.0,
      sku: 'MINI-EMS-01',
      estado_anterior: 'nuevo',
      estado: 'por_empacar'
    }
  },
  {
    id: 102,
    type: 'order.created',
    occurred_at: new Date(Date.now() - 1000 * 60 * 38).toISOString(),
    source_table: 'whatsapp_orders',
    source_id: 'ord-8831',
    idempotency_key: 'whatsapp_orders:ord-8831:order.created',
    payload: {
      order_id: 'ord-8831',
      pedido_codigo: 'PED-8831',
      nombre_cliente: 'Carlos Méndez',
      telefono: '70231940',
      total: 35.0,
      sku: 'MINI-EMS-01',
      estado: 'nuevo',
      codigo_anuncio: 'FB-EMS-VID2',
      metodo_pago: 'contraentrega'
    }
  },
  {
    id: 101,
    type: 'lead.generated',
    occurred_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    source_table: 'fb_leads',
    source_id: 'lead-4402',
    idempotency_key: 'fb_leads:lead-4402:lead.generated',
    payload: {
      lead_id: 'lead-4402',
      nombre: 'Carlos Méndez',
      telefono: '70231940',
      campaign_id: 'CAMP-EMS-PROMO',
      codigo_anuncio: 'FB-EMS-VID2'
    }
  },
  {
    id: 100,
    type: 'chat.message.received',
    occurred_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    source_table: 'fb_messages',
    source_id: 'msg-9921',
    idempotency_key: 'fb_messages:msg-9921:chat.message.received',
    payload: {
      conversation_id: 'conv-carlos-m',
      sender_id: 'carlos-m',
      text: 'Hola, vi su anuncio del Mini Masajeador EMS. ¿Aún tienen disponible con envío gratis?',
      channel: 'facebook'
    }
  },
  {
    id: 99,
    type: 'marketing.ad.expense',
    occurred_at: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    source_table: 'gastos_publicidad',
    source_id: 'adexp-20261107',
    idempotency_key: 'gastos_publicidad:adexp-20261107',
    payload: {
      campaign_id: 'CAMP-EMS-PROMO',
      platform: 'meta',
      amount: 45.0,
      currency: 'USD',
      date: new Date().toISOString().slice(0, 10)
    }
  }
];

// Almacén en memoria de respaldo
let localEvents: OsEvent[] = [...SAMPLE_EVENTS];
const subscribers: Set<(event: OsEvent) => void> = new Set();

export const DEFAULT_EVENT_TYPES: OsEventType[] = [
  // Pedidos & Logística
  { type: 'order.created', domain: 'order', description: 'Nuevo pedido registrado', enabled: true },
  { type: 'order.confirmed', domain: 'order', description: 'Pedido confirmado / por empacar', enabled: true },
  { type: 'order.shipped', domain: 'order', description: 'Pedido despachado / en camino', enabled: true },
  { type: 'order.delivered', domain: 'order', description: 'Pedido entregado exitosamente', enabled: true },
  { type: 'order.cancelled', domain: 'order', description: 'Pedido cancelado', enabled: true },
  { type: 'order.scheduled', domain: 'order', description: 'Pedido programado / encargo a futuro', enabled: true },

  // Mensajería, Conversaciones & Omnicanal
  { type: 'chat.message.received', domain: 'chat', description: 'Mensaje entrante de cliente', enabled: true },
  { type: 'chat.message.sent', domain: 'chat', description: 'Mensaje saliente de agente/bot', enabled: true },
  { type: 'chat.bot.toggled', domain: 'chat', description: 'Cambio de modo Bot vs Humano', enabled: true },
  { type: 'social.reply.sent', domain: 'chat', description: 'Respuesta enviada a DM o comentario social', enabled: true },
  { type: 'lead.generated', domain: 'lead', description: 'Prospecto captado desde chat/redes', enabled: true },

  // Marketing & Pauta Publicitaria
  { type: 'marketing.post.created', domain: 'marketing', description: 'Publicación programada en cola', enabled: true },
  { type: 'marketing.post.published', domain: 'marketing', description: 'Publicación emitida en redes', enabled: true },
  { type: 'marketing.lead.generated', domain: 'marketing', description: 'Lead de campaña publicitaria', enabled: true },
  { type: 'marketing.ad.expense', domain: 'marketing', description: 'Gasto publicitario registrado', enabled: true },

  // Inventario & Catálogo
  { type: 'inventory.adjustment', domain: 'inventory', description: 'Ajuste manual de stock / merma', enabled: true },
  { type: 'product.created', domain: 'inventory', description: 'Nuevo producto creado en catálogo', enabled: true },
  { type: 'product.updated', domain: 'inventory', description: 'Producto actualizado en catálogo / Todd', enabled: true },

  // Proveedores & Compras
  { type: 'supplier.created', domain: 'supplier', description: 'Nuevo proveedor registrado', enabled: true },
  { type: 'purchase.requested', domain: 'supplier', description: 'Licitación / compra solicitada', enabled: true },
  { type: 'supplier.bid.received', domain: 'supplier', description: 'Oferta recibida de proveedor', enabled: true },
  { type: 'supplier.selected', domain: 'supplier', description: 'Proveedor adjudicado', enabled: true },

  // Finanzas & Caja
  { type: 'finance.income.created', domain: 'finance', description: 'Ingreso liquidado (pedido entregado)', enabled: true },
  { type: 'finance.expense.created', domain: 'finance', description: 'Egreso asentado (pauta/compra/operación)', enabled: true },
  { type: 'finance.debt.created', domain: 'finance', description: 'Cuenta por pagar registrada', enabled: true },

  // Clientes, Score Antifraude & DICOM
  { type: 'customer.blacklisted', domain: 'customer', description: 'Cliente ingresado a Lista Negra / DICOM', enabled: true },
  { type: 'customer.whitelisted', domain: 'customer', description: 'Cliente rehabilitado de Lista Negra', enabled: true },
  { type: 'customer.notified', domain: 'customer', description: 'Cliente notificado por WhatsApp', enabled: true },

  // Fidelización, LTV & Ofertas Flash Cross-Sell
  { type: 'ltv.campaign_created', domain: 'ltv', description: 'Campaña de Oferta Flash creada', enabled: true },
  { type: 'ltv.offer_dispatched', domain: 'ltv', description: 'Oferta Flash enviada por WhatsApp', enabled: true },

  // Sistema
  { type: 'system.heartbeat', domain: 'system', description: 'Latido de monitoreo del sistema', enabled: true },
  { type: 'system.test', domain: 'system', description: 'Evento emitido para verificación manual', enabled: true },
];

/**
 * Consulta eventos recientes desde Supabase con fallback local automático
 */
export async function fetchOsEvents(limit = 100): Promise<{
  events: OsEvent[];
  isRealDb: boolean;
  error?: string;
}> {
  try {
    // 1. Intentamos consultar la vista pública public.os_events (óptimo para Supabase API)
    const publicRes = await supabase
      .from('os_events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (!publicRes.error && publicRes.data) {
      return { events: publicRes.data as OsEvent[], isRealDb: true };
    }

    // 2. Intentamos con el schema directo os.events
    const schemaRes = await (supabase as any)
      .schema('os')
      .from('events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (!schemaRes.error && schemaRes.data) {
      return { events: schemaRes.data as OsEvent[], isRealDb: true };
    }

    // 3. Fallback a tabla events en public
    const fallback = await supabase
      .from('events')
      .select('*')
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (!fallback.error && fallback.data) {
      return { events: fallback.data as OsEvent[], isRealDb: true };
    }

    const lastErr = publicRes.error?.message || schemaRes.error?.message || 'Pendiente de ejecutar migración en Supabase';
    return {
      events: localEvents.slice(0, limit),
      isRealDb: false,
      error: `Supabase: ${lastErr} (Mostrando vista previa local hasta ejecutar el SQL)`
    };
  } catch (err: any) {
    return {
      events: localEvents.slice(0, limit),
      isRealDb: false,
      error: err?.message || 'Error de conexión con Supabase'
    };
  }
}

/**
 * Consulta el catálogo de tipos de eventos registrados
 */
export async function fetchOsEventTypes(): Promise<OsEventType[]> {
  try {
    const { data, error } = await (supabase as any)
      .schema('os')
      .from('event_types')
      .select('*')
      .order('type');

    if (!error && data && data.length > 0) {
      return data as OsEventType[];
    }
  } catch {
    // ignorar y retornar catálogo por defecto
  }
  return DEFAULT_EVENT_TYPES;
}

/**
 * Consulta los consumidores de eventos registrados
 */
export async function fetchOsConsumers(): Promise<OsEventConsumer[]> {
  try {
    const { data, error } = await (supabase as any)
      .schema('os')
      .from('event_consumers')
      .select('*')
      .order('consumer_name');

    if (!error && data && data.length > 0) {
      return data as OsEventConsumer[];
    }
  } catch {
    // ignorar
  }
  return [
    { consumer_name: 'finance_projector', last_event_id: 105, status: 'active', last_error: null, updated_at: new Date().toISOString() },
    { consumer_name: 'os_memory', last_event_id: 105, status: 'active', last_error: null, updated_at: new Date().toISOString() },
    { consumer_name: 'dashboard_stream', last_event_id: 105, status: 'active', last_error: null, updated_at: new Date().toISOString() }
  ];
}

/**
 * Emite un nuevo evento al Event Store (idempotente)
 */
export async function emitOsEvent(params: EmitEventParams): Promise<{ success: boolean; event: OsEvent; isRealDb: boolean }> {
  const idempotency_key = params.idempotency_key || `${params.source_table}:${params.source_id}:${params.type}:${Date.now()}`;
  
  const newEvent: OsEvent = {
    id: Date.now(),
    type: params.type,
    occurred_at: new Date().toISOString(),
    source_table: params.source_table,
    source_id: params.source_id,
    idempotency_key,
    payload: params.payload,
    created_at: new Date().toISOString()
  };

  let isRealDb = false;

  try {
    // Intentar llamada a RPC o inserción directa
    const { data, error } = await (supabase as any)
      .schema('os')
      .from('events')
      .insert({
        type: newEvent.type,
        source_table: newEvent.source_table,
        source_id: newEvent.source_id,
        idempotency_key: newEvent.idempotency_key,
        payload: newEvent.payload
      })
      .select()
      .single();

    if (!error && data) {
      newEvent.id = data.id;
      isRealDb = true;
    }
  } catch {
    // Fallback in-memory
  }

  // Notificar a observadores locales y actualizar store en memoria
  localEvents = [newEvent, ...localEvents];
  subscribers.forEach(cb => cb(newEvent));

  return { success: true, event: newEvent, isRealDb };
}

/**
 * Suscripción en tiempo real a nuevos eventos vía Supabase Realtime y bus local
 */
export function subscribeToOsEvents(onEvent: (event: OsEvent) => void): () => void {
  subscribers.add(onEvent);

  let channel: any = null;
  try {
    channel = supabase
      .channel('os-events-live')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'os', table: 'events' },
        (payload) => {
          if (payload.new) {
            onEvent(payload.new as OsEvent);
          }
        }
      )
      .subscribe();
  } catch (err) {
    console.warn('Realtime subscription failed, using local bus:', err);
  }

  return () => {
    subscribers.delete(onEvent);
    if (channel) {
      supabase.removeChannel(channel);
    }
  };
}
