import { supabase } from '@/lib/supabase';
import type {
  OsEvent,
  OsEventType,
  OsEventConsumer,
  OsDailyMemory,
  EmitEventParams,
} from '@/types/events';

// Simulación inicial representativa cuando Supabase aún no tiene la migración aplicada
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
      codigo_anuncio: 'FB-EMS-VID2',
    },
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
      estado: 'en_camino',
    },
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
      estado: 'por_empacar',
    },
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
      metodo_pago: 'contraentrega',
    },
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
      codigo_anuncio: 'FB-EMS-VID2',
    },
  },
  {
    id: 100,
    type: 'chat.message.received',
    occurred_at: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    source_table: 'bb_messages',
    source_id: 'msg-9921',
    idempotency_key: 'bb_messages:msg-9921',
    payload: {
      conversation_id: 'conv-carlos-m',
      sender_id: 'carlos-m',
      text: 'Hola, vi su anuncio del Mini Masajeador EMS. ¿Aún tienen disponible con envío gratis?',
      channel: 'whatsapp',
    },
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
      date: new Date().toISOString().slice(0, 10),
    },
  },
];

let localEvents: OsEvent[] = [...SAMPLE_EVENTS];
const subscribers: Set<(event: OsEvent) => void> = new Set();
let lastEmitDiagnostic: string | null = null;

export function getLastEmitDiagnostic(): string | null {
  return lastEmitDiagnostic;
}

export const DEFAULT_EVENT_TYPES: OsEventType[] = [
  // Pedidos & Logística COD
  { type: 'order.created', domain: 'order', description: 'Nuevo pedido registrado', enabled: true },
  { type: 'order.confirmed', domain: 'order', description: 'Pedido confirmado / por empacar', enabled: true },
  { type: 'order.shipped', domain: 'order', description: 'Pedido despachado / en camino', enabled: true },
  { type: 'order.delivered', domain: 'order', description: 'Pedido entregado exitosamente', enabled: true },
  { type: 'order.cancelled', domain: 'order', description: 'Pedido cancelado o devuelto', enabled: true },
  { type: 'order.scheduled', domain: 'order', description: 'Pedido programado / encargo a futuro', enabled: true },
  { type: 'order.delivery_issue', domain: 'order', description: 'Incidencia reportada en entrega', enabled: true },
  { type: 'order.dispatch.photo_sent', domain: 'order', description: 'Foto de despacho enviada por WhatsApp', enabled: true },
  { type: 'order.delay.notified', domain: 'order', description: 'Aviso de retraso notificado al cliente', enabled: true },

  // Mensajería, Conversaciones, Embudo Todd & Omnicanal
  { type: 'chat.message.received', domain: 'chat', description: 'Mensaje entrante de cliente', enabled: true },
  { type: 'chat.message.sent', domain: 'chat', description: 'Mensaje saliente de agente o Bot Todd', enabled: true },
  { type: 'chat.bot.toggled', domain: 'chat', description: 'Cambio de modo Bot vs Humano', enabled: true },
  { type: 'chat.funnel.progressed', domain: 'chat', description: 'Avance de etapa y SKU en embudo Bot Todd', enabled: true },
  { type: 'social.reply.sent', domain: 'chat', description: 'Respuesta enviada a DM o comentario social', enabled: true },
  { type: 'lead.generated', domain: 'lead', description: 'Prospecto captado desde chat/redes', enabled: true },

  // Marketing, Pauta Meta & Contenido
  { type: 'marketing.post.created', domain: 'marketing', description: 'Publicación agregada a cola/bodega', enabled: true },
  { type: 'marketing.post.published', domain: 'marketing', description: 'Publicación emitida en FB/IG', enabled: true },
  { type: 'marketing.lead.generated', domain: 'marketing', description: 'Lead de campaña publicitaria', enabled: true },
  { type: 'marketing.ad.expense', domain: 'marketing', description: 'Gasto publicitario registrado', enabled: true },
  { type: 'marketing.meta.synced', domain: 'marketing', description: 'Sincronización automática Meta Marketing API', enabled: true },

  // Inventario & Catálogo
  { type: 'inventory.adjustment', domain: 'inventory', description: 'Ajuste manual de stock / merma', enabled: true },
  { type: 'product.created', domain: 'inventory', description: 'Nuevo producto creado en catálogo', enabled: true },
  { type: 'product.updated', domain: 'inventory', description: 'Producto actualizado en catálogo / Todd', enabled: true },
  { type: 'product.deleted', domain: 'inventory', description: 'Producto eliminado del catálogo', enabled: true },

  // Proveedores & Compras
  { type: 'supplier.created', domain: 'supplier', description: 'Nuevo proveedor registrado', enabled: true },
  { type: 'purchase.requested', domain: 'supplier', description: 'Licitación / compra solicitada', enabled: true },
  { type: 'supplier.bid.received', domain: 'supplier', description: 'Oferta recibida de proveedor', enabled: true },
  { type: 'supplier.selected', domain: 'supplier', description: 'Proveedor adjudicado', enabled: true },

  // Finanzas, Caja & Pagos Recurrentes
  { type: 'finance.income.created', domain: 'finance', description: 'Ingreso liquidado (pedido entregado)', enabled: true },
  { type: 'finance.expense.created', domain: 'finance', description: 'Egreso asentado (pauta/compra/operación)', enabled: true },
  { type: 'finance.debt.created', domain: 'finance', description: 'Cuenta por pagar registrada', enabled: true },
  { type: 'finance.transfer.created', domain: 'finance', description: 'Transferencia entre cuentas o cajas', enabled: true },
  { type: 'finance.bill.created', domain: 'finance', description: 'Pago recurrente registrado en calendario', enabled: true },
  { type: 'finance.bill.paid', domain: 'finance', description: 'Pago recurrente liquidado y renovado', enabled: true },

  // Clientes, Score Antifraude & DICOM
  { type: 'customer.blacklisted', domain: 'customer', description: 'Cliente ingresado a Lista Negra / DICOM', enabled: true },
  { type: 'customer.whitelisted', domain: 'customer', description: 'Cliente rehabilitado de Lista Negra', enabled: true },
  { type: 'customer.notified', domain: 'customer', description: 'Cliente notificado por WhatsApp', enabled: true },

  // Fidelización, LTV & Ofertas Flash Cross-Sell
  { type: 'ltv.campaign_created', domain: 'ltv', description: 'Campaña de Oferta Flash creada', enabled: true },
  { type: 'ltv.offer_dispatched', domain: 'ltv', description: 'Oferta Flash enviada por WhatsApp', enabled: true },

  // Sistema, Mantenimiento & Capa IA
  { type: 'system.heartbeat', domain: 'system', description: 'Latido de monitoreo del sistema', enabled: true },
  { type: 'system.test', domain: 'system', description: 'Evento emitido para verificación manual', enabled: true },
  { type: 'system.finance_reset', domain: 'system', description: 'Reinicio de datos en Finanzas', enabled: true },
  { type: 'system.finance_cutoff_cleared', domain: 'system', description: 'Corte histórico aplicado en Finanzas', enabled: true },
  { type: 'system.finance_delivered_legacy_cleared', domain: 'system', description: 'Entregados legacy archivados en Finanzas', enabled: true },
  { type: 'system.vault_reset', domain: 'system', description: 'Reinicio de Bóveda de Productos', enabled: true },
  { type: 'system.vault_cutoff_cleared', domain: 'system', description: 'Corte limpiado en Bóveda de Productos', enabled: true },
  { type: 'system.memory.consolidated', domain: 'system', description: 'Consolidación diaria de memoria IA (os_memory)', enabled: true },
  { type: 'ai.brief.generated', domain: 'system', description: 'Brief operativo generado con memoria histórica', enabled: true },
];

/**
 * Consulta eventos recientes desde Supabase con paginación y conteo total real
 */
export async function fetchOsEvents(
  limit = 200,
  beforeId?: number
): Promise<{
  events: OsEvent[];
  totalCount: number;
  hasMore: boolean;
  isRealDb: boolean;
  error?: string;
}> {
  try {
    // 1. Vista pública public.os_events (óptimo para Supabase PostgREST)
    let pubQuery = supabase
      .from('os_events')
      .select('*', { count: 'exact' })
      .order('id', { ascending: false })
      .limit(limit);
    if (beforeId && beforeId > 0) {
      pubQuery = pubQuery.lt('id', beforeId);
    }

    const publicRes = await pubQuery;
    if (!publicRes.error && publicRes.data) {
      const rows = publicRes.data as OsEvent[];
      let totalCount = typeof publicRes.count === 'number' ? publicRes.count : rows.length;
      if (beforeId && beforeId > 0) {
        const cntRes = await supabase.from('os_events').select('id', { count: 'exact', head: true });
        if (typeof cntRes.count === 'number') totalCount = cntRes.count;
      }
      return {
        events: rows,
        totalCount,
        hasMore: rows.length === limit,
        isRealDb: true,
      };
    }

    // 2. Schema directo os.events
    let schQuery = (supabase as any)
      .schema('os')
      .from('events')
      .select('*', { count: 'exact' })
      .order('id', { ascending: false })
      .limit(limit);
    if (beforeId && beforeId > 0) {
      schQuery = schQuery.lt('id', beforeId);
    }

    const schemaRes = await schQuery;
    if (!schemaRes.error && schemaRes.data) {
      const rows = schemaRes.data as OsEvent[];
      let totalCount = typeof schemaRes.count === 'number' ? schemaRes.count : rows.length;
      if (beforeId && beforeId > 0) {
        const cntRes = await (supabase as any)
          .schema('os')
          .from('events')
          .select('id', { count: 'exact', head: true });
        if (typeof cntRes.count === 'number') totalCount = cntRes.count;
      }
      return {
        events: rows,
        totalCount,
        hasMore: rows.length === limit,
        isRealDb: true,
      };
    }

    // 3. Fallback a tabla events en public
    const fallback = await supabase
      .from('events')
      .select('*', { count: 'exact' })
      .order('id', { ascending: false })
      .limit(limit);

    if (!fallback.error && fallback.data) {
      const rows = fallback.data as OsEvent[];
      return {
        events: rows,
        totalCount: typeof fallback.count === 'number' ? fallback.count : rows.length,
        hasMore: rows.length === limit,
        isRealDb: true,
      };
    }

    const lastErr =
      publicRes.error?.message ||
      schemaRes.error?.message ||
      'Pendiente de ejecutar migración en Supabase';
    const slice = localEvents.slice(0, limit);
    return {
      events: slice,
      totalCount: localEvents.length,
      hasMore: false,
      isRealDb: false,
      error: `Supabase: ${lastErr} (Mostrando vista previa local hasta ejecutar el SQL)`,
    };
  } catch (err: any) {
    return {
      events: localEvents.slice(0, limit),
      totalCount: localEvents.length,
      hasMore: false,
      isRealDb: false,
      error: err?.message || 'Error de conexión con Supabase',
    };
  }
}

/**
 * Consulta el catálogo de tipos de eventos registrados
 */
export async function fetchOsEventTypes(): Promise<OsEventType[]> {
  try {
    const pub = await supabase.from('os_event_types').select('*').order('type');
    if (!pub.error && pub.data && pub.data.length > 0) {
      return pub.data as OsEventType[];
    }

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
    const pub = await supabase
      .from('os_event_consumers')
      .select('*')
      .order('consumer_name');
    if (!pub.error && pub.data && pub.data.length > 0) {
      return pub.data as OsEventConsumer[];
    }

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
    {
      consumer_name: 'finance_projector',
      last_event_id: 0,
      status: 'active',
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    {
      consumer_name: 'os_memory',
      last_event_id: 0,
      status: 'active',
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    {
      consumer_name: 'dashboard_stream',
      last_event_id: 0,
      status: 'active',
      last_error: null,
      updated_at: new Date().toISOString(),
    },
  ];
}

/**
 * Emite un nuevo evento al Event Store con triple fallback:
 *   1) RPC public.emit_os_event (auto-registra tipos desconocidos y es idempotente)
 *   2) .schema('os').from('events')
 *   3) public.os_events
 */
export async function emitOsEvent(
  params: EmitEventParams
): Promise<{
  success: boolean;
  duplicate?: boolean;
  event: OsEvent;
  isRealDb: boolean;
  error?: string;
}> {
  const idempotency_key =
    params.idempotency_key ||
    `${params.source_table}:${params.source_id}:${params.type}:${Date.now()}`;

  const effectiveOccurredAt = params.occurred_at || new Date().toISOString();

  const newEvent: OsEvent = {
    id: Date.now(),
    type: params.type,
    occurred_at: effectiveOccurredAt,
    source_table: params.source_table,
    source_id: params.source_id,
    idempotency_key,
    payload: params.payload || {},
    created_at: new Date().toISOString(),
  };

  let isRealDb = false;
  let duplicate = false;
  let dbErrMsg: string | undefined;

  try {
    let rpcRes = await supabase.rpc('emit_os_event', {
      p_type: newEvent.type,
      p_source_table: newEvent.source_table,
      p_source_id: newEvent.source_id,
      p_idempotency_key: newEvent.idempotency_key,
      p_payload: newEvent.payload,
      ...(params.occurred_at ? { p_occurred_at: params.occurred_at } : {}),
    });

    // Compatibilidad si la BD aún tiene la firma de 5 argumentos
    if (rpcRes.error && params.occurred_at) {
      rpcRes = await supabase.rpc('emit_os_event', {
        p_type: newEvent.type,
        p_source_table: newEvent.source_table,
        p_source_id: newEvent.source_id,
        p_idempotency_key: newEvent.idempotency_key,
        p_payload: newEvent.payload,
      });
    }

    if (!rpcRes.error && typeof rpcRes.data === 'number') {
      if (rpcRes.data > 0) {
        newEvent.id = rpcRes.data;
      } else if (rpcRes.data === -1) {
        duplicate = true;
      }
      isRealDb = true;
      lastEmitDiagnostic = null;
    } else {
      dbErrMsg = rpcRes.error?.message;
      const insertRow: Record<string, any> = {
        type: newEvent.type,
        source_table: newEvent.source_table,
        source_id: newEvent.source_id,
        idempotency_key: newEvent.idempotency_key,
        payload: newEvent.payload,
      };
      if (params.occurred_at) insertRow.occurred_at = params.occurred_at;

      const schemaRes = await (supabase as any)
        .schema('os')
        .from('events')
        .insert(insertRow)
        .select()
        .single();

      if (!schemaRes.error && schemaRes.data) {
        newEvent.id = schemaRes.data.id;
        isRealDb = true;
        lastEmitDiagnostic = null;
      } else if (schemaRes.error?.code === '23505') {
        isRealDb = true;
        duplicate = true;
        lastEmitDiagnostic = null;
      } else {
        dbErrMsg = schemaRes.error?.message || dbErrMsg;
        const viewRes = await supabase
          .from('os_events')
          .insert(insertRow)
          .select()
          .single();

        if (!viewRes.error && viewRes.data) {
          newEvent.id = viewRes.data.id;
          isRealDb = true;
          lastEmitDiagnostic = null;
        } else if (viewRes.error?.code === '23505') {
          isRealDb = true;
          duplicate = true;
          lastEmitDiagnostic = null;
        } else {
          dbErrMsg = viewRes.error?.message || dbErrMsg;
        }
      }
    }
  } catch (err: any) {
    dbErrMsg = err?.message || 'Error inesperado emitiendo evento OS';
  }

  if (!isRealDb && dbErrMsg) {
    lastEmitDiagnostic = `[${params.type}] ${dbErrMsg}`;
    console.warn('emitOsEvent fallback local:', lastEmitDiagnostic);
  }

  // Solo notificar al stream local si el evento realmente es nuevo (no duplicado en BD)
  if (!duplicate) {
    const alreadyLocal = localEvents.some(
      (e) => e.idempotency_key === newEvent.idempotency_key
    );
    if (!alreadyLocal) {
      localEvents = [newEvent, ...localEvents.slice(0, 299)];
      subscribers.forEach((cb) => cb(newEvent));
    }
  }

  return { success: true, duplicate, event: newEvent, isRealDb, error: dbErrMsg };
}

/**
 * Consulta resúmenes diarios consolidados en os_daily_memory (Capa IA)
 */
export async function fetchOsDailyMemory(days = 30): Promise<OsDailyMemory[]> {
  try {
    const pub = await supabase
      .from('os_daily_memory')
      .select('*')
      .order('day', { ascending: false })
      .limit(days);
    if (!pub.error && Array.isArray(pub.data)) {
      return pub.data as OsDailyMemory[];
    }

    const sch = await (supabase as any)
      .schema('os')
      .from('daily_memory')
      .select('*')
      .order('day', { ascending: false })
      .limit(days);
    if (!sch.error && Array.isArray(sch.data)) {
      return sch.data as OsDailyMemory[];
    }
  } catch {}
  return [];
}

/**
 * Consolida os.events por día en os.daily_memory y actualiza checkpoint de os_memory
 */
export async function rebuildOsMemory(
  days = 30
): Promise<{ ok: boolean; daysUpdated: number; lastEventId: number; error?: string }> {
  try {
    const rpcRes = await supabase.rpc('rebuild_os_memory', { p_days: days });
    if (!rpcRes.error && rpcRes.data) {
      const data = rpcRes.data as any;
      return {
        ok: true,
        daysUpdated: Number(data.days_updated || 0),
        lastEventId: Number(data.last_event_id || 0),
      };
    }

    // Fallback TypeScript si el RPC SQL aún no se ha ejecutado
    const { events, isRealDb } = await fetchOsEvents(1000);
    if (!isRealDb) {
      return {
        ok: false,
        daysUpdated: 0,
        lastEventId: 0,
        error: 'Ejecuta primero SQL Sprint 12 en Supabase para activar os_daily_memory.',
      };
    }

    const byDay = new Map<string, OsEvent[]>();
    let maxId = 0;
    for (const ev of events) {
      if (ev.id > maxId) maxId = ev.id;
      const svDay = new Date(new Date(ev.occurred_at).getTime() - 6 * 3600 * 1000)
        .toISOString()
        .slice(0, 10);
      const list = byDay.get(svDay) || [];
      list.push(ev);
      byDay.set(svDay, list);
    }

    let updated = 0;
    for (const [day, list] of byDay.entries()) {
      const ordersCreated = list.filter((e) => e.type === 'order.created').length;
      const ordersDelivered = list.filter((e) => e.type === 'order.delivered').length;
      const ordersCancelled = list.filter((e) => e.type === 'order.cancelled').length;
      const grossSales = list
        .filter((e) => e.type === 'order.created')
        .reduce((s, e) => s + (Number(e.payload?.total) || 0), 0);
      const deliveredRevenue = list
        .filter((e) => e.type === 'order.delivered')
        .reduce((s, e) => s + (Number(e.payload?.total) || 0), 0);
      const adSpend = list
        .filter((e) => e.type === 'marketing.ad.expense')
        .reduce((s, e) => s + (Number(e.payload?.amount ?? e.payload?.monto) || 0), 0);
      const chatsReceived = list.filter((e) => e.type === 'chat.message.received').length;
      const chatsSent = list.filter((e) => e.type === 'chat.message.sent').length;

      const row = {
        day,
        total_events: list.length,
        orders_created: ordersCreated,
        orders_delivered: ordersDelivered,
        orders_cancelled: ordersCancelled,
        gross_sales: Math.round(grossSales * 100) / 100,
        delivered_revenue: Math.round(deliveredRevenue * 100) / 100,
        ad_spend: Math.round(adSpend * 100) / 100,
        chats_received: chatsReceived,
        chats_sent: chatsSent,
        summary_text: `${day}: ${list.length} eventos | ${ordersCreated} creados, ${ordersDelivered} entregados ($${deliveredRevenue.toFixed(2)}) | Chats ${chatsReceived}/${chatsSent} | Pauta $${adSpend.toFixed(2)}`,
        last_event_id: maxId,
        updated_at: new Date().toISOString(),
      };

      const res = await supabase.from('os_daily_memory').upsert(row, { onConflict: 'day' });
      if (!res.error) updated++;
    }

    await emitOsEvent({
      type: 'system.memory.consolidated',
      source_table: 'os_daily_memory',
      source_id: `sync:${new Date().toISOString().slice(0, 10)}`,
      idempotency_key: `system:memory:consolidated:${new Date().toISOString().slice(0, 13)}`,
      payload: {
        days_updated: updated,
        last_event_id: maxId,
        origen: 'os_brain_panel',
      },
    });

    return { ok: true, daysUpdated: updated, lastEventId: maxId };
  } catch (err: any) {
    return {
      ok: false,
      daysUpdated: 0,
      lastEventId: 0,
      error: err?.message || 'Error consolidando memoria OS',
    };
  }
}

/**
 * Reconstruye eventos faltantes idempotentes respetando fechas reales y sin duplicar triggers previos
 */
export async function backfillMissingOsEvents(days = 30): Promise<{
  newlyInserted: number;
  insertedEstimate: number;
  skippedExisting: number;
  scannedOrders: number;
  scannedAds: number;
  scannedFinances: number;
  scannedFunnels: number;
}> {
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  const [ordersRes, adsRes, txRes, stateRes, existingRes] = await Promise.all([
    supabase
      .from('whatsapp_orders')
      .select('id,pedido_codigo,nombre_cliente,telefono,sku,catalogo_sku,total,estado,codigo_anuncio,departamento,metodo_pago,created_at,liquidado_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('gastos_publicidad')
      .select('id,fecha,codigo_anuncio,plataforma,monto,notas')
      .gte('fecha', sinceDate)
      .limit(200),
    supabase
      .from('finance_money_transactions')
      .select('id,tipo,categoria,monto,descripcion,fecha,account_id,source_id')
      .gte('fecha', sinceDate)
      .limit(200),
    supabase
      .from('whatsapp_state')
      .select('telefono,paso_actual,last_sku,last_nombre,last_precio,last_detalle,updated_at')
      .gte('updated_at', sinceIso)
      .limit(200),
    supabase
      .from('os_events')
      .select('type,source_table,source_id,idempotency_key')
      .order('id', { ascending: false })
      .limit(2000),
  ]);

  const existingKeys = new Set<string>();
  const existingOrderStates = new Set<string>();
  for (const row of existingRes.data || []) {
    if (row.idempotency_key) existingKeys.add(row.idempotency_key);
    if (row.source_table === 'whatsapp_orders' && row.source_id && row.type) {
      existingOrderStates.add(`${row.source_id}:${row.type}`);
    }
  }

  let newlyInserted = 0;
  let skippedExisting = 0;

  for (const o of ordersRes.data || []) {
    const estado = String(o.estado || 'nuevo').toLowerCase();
    const createdKey = `whatsapp_orders:${o.id}:order.created`;

    if (existingKeys.has(createdKey) || existingOrderStates.has(`${o.id}:order.created`)) {
      skippedExisting++;
    } else {
      const res1 = await emitOsEvent({
        type: 'order.created',
        source_table: 'whatsapp_orders',
        source_id: String(o.id),
        idempotency_key: createdKey,
        occurred_at: o.created_at || undefined,
        payload: {
          order_id: o.id,
          pedido_codigo: o.pedido_codigo || `PED-${String(o.id).slice(0, 8)}`,
          nombre_cliente: o.nombre_cliente,
          telefono: o.telefono,
          sku: o.sku,
          catalogo_sku: o.catalogo_sku,
          total: Number(o.total || 0),
          estado,
          codigo_anuncio: o.codigo_anuncio,
          departamento: o.departamento,
          metodo_pago: o.metodo_pago,
          backfill: true,
        },
      });
      if (res1.isRealDb && !res1.duplicate) newlyInserted++;
      else skippedExisting++;
    }

    if (
      estado === 'entregado' ||
      estado === 'cancelado' ||
      estado === 'en_camino' ||
      estado === 'por_empacar'
    ) {
      const mapType: Record<string, string> = {
        por_empacar: 'order.confirmed',
        en_camino: 'order.shipped',
        entregado: 'order.delivered',
        cancelado: 'order.cancelled',
      };
      const t = mapType[estado];
      const stateKey = `backfill:whatsapp_orders:${o.id}:${t}`;
      if (t) {
        if (existingKeys.has(stateKey) || existingOrderStates.has(`${o.id}:${t}`)) {
          skippedExisting++;
        } else {
          const res2 = await emitOsEvent({
            type: t,
            source_table: 'whatsapp_orders',
            source_id: String(o.id),
            idempotency_key: stateKey,
            occurred_at: o.liquidado_at || o.created_at || undefined,
            payload: {
              order_id: o.id,
              pedido_codigo: o.pedido_codigo || `PED-${String(o.id).slice(0, 8)}`,
              nombre_cliente: o.nombre_cliente,
              telefono: o.telefono,
              sku: o.sku,
              catalogo_sku: o.catalogo_sku,
              total: Number(o.total || 0),
              estado,
              codigo_anuncio: o.codigo_anuncio,
              backfill: true,
            },
          });
          if (res2.isRealDb && !res2.duplicate) newlyInserted++;
          else skippedExisting++;
        }
      }
    }
  }

  for (const g of adsRes.data || []) {
    const k = `backfill:gastos_publicidad:${g.id}`;
    if (existingKeys.has(k)) {
      skippedExisting++;
      continue;
    }
    const adTs = g.fecha ? `${String(g.fecha).slice(0, 10)}T18:00:00-06:00` : undefined;
    const res = await emitOsEvent({
      type: 'marketing.ad.expense',
      source_table: 'gastos_publicidad',
      source_id: String(g.id),
      idempotency_key: k,
      occurred_at: adTs,
      payload: {
        fecha: g.fecha,
        codigo_anuncio: g.codigo_anuncio,
        platform: String(g.plataforma || 'Meta').toLowerCase(),
        amount: Number(g.monto || 0),
        notas: g.notas,
        backfill: true,
      },
    });
    if (res.isRealDb && !res.duplicate) newlyInserted++;
    else skippedExisting++;
  }

  for (const tx of txRes.data || []) {
    const k = `backfill:finance_tx:${tx.id}`;
    if (existingKeys.has(k)) {
      skippedExisting++;
      continue;
    }
    const tType =
      tx.tipo === 'income'
        ? 'finance.income.created'
        : tx.categoria?.includes('transferencia')
          ? 'finance.transfer.created'
          : 'finance.expense.created';
    const txTs = tx.fecha ? `${String(tx.fecha).slice(0, 10)}T18:00:00-06:00` : undefined;
    const res = await emitOsEvent({
      type: tType,
      source_table: 'finance_money_transactions',
      source_id: String(tx.id),
      idempotency_key: k,
      occurred_at: txTs,
      payload: {
        account_id: tx.account_id,
        categoria: tx.categoria,
        monto: Number(tx.monto || 0),
        descripcion: tx.descripcion,
        fecha: tx.fecha,
        backfill: true,
      },
    });
    if (res.isRealDb && !res.duplicate) newlyInserted++;
    else skippedExisting++;
  }

  for (const st of stateRes.data || []) {
    const k = `backfill:funnel:${st.telefono}:${st.paso_actual || 'inicio'}:${st.last_sku || 'na'}`;
    if (existingKeys.has(k)) {
      skippedExisting++;
      continue;
    }
    const res = await emitOsEvent({
      type: 'chat.funnel.progressed',
      source_table: 'whatsapp_state',
      source_id: String(st.telefono),
      idempotency_key: k,
      occurred_at: st.updated_at || undefined,
      payload: {
        telefono: st.telefono,
        paso_actual: st.paso_actual || 'inicio',
        sku: st.last_sku || null,
        nombre_producto: st.last_nombre || null,
        precio: st.last_precio || null,
        detalle: st.last_detalle || null,
        backfill: true,
      },
    });
    if (res.isRealDb && !res.duplicate) newlyInserted++;
    else skippedExisting++;
  }

  return {
    newlyInserted,
    insertedEstimate: newlyInserted,
    skippedExisting,
    scannedOrders: ordersRes.data?.length || 0,
    scannedAds: adsRes.data?.length || 0,
    scannedFinances: txRes.data?.length || 0,
    scannedFunnels: stateRes.data?.length || 0,
  };
}

/**
 * Exporta eventos en formato JSONL limpio listo para fine-tuning / entrenamiento IA
 */
export function exportOsEventsJsonl(events: OsEvent[]): string {
  return events
    .map((ev) =>
      JSON.stringify({
        id: ev.id,
        occurred_at: ev.occurred_at,
        domain: ev.type.split('.')[0],
        type: ev.type,
        source_table: ev.source_table,
        source_id: ev.source_id,
        payload: ev.payload,
      })
    )
    .join('\n');
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
