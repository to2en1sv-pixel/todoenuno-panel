import type { BrainNode, BrainConnection, SimulationStep } from '@/types/brain';

// Dimensiones de referencia del canvas virtual (1200 x 780)
export const BRAIN_CANVAS_WIDTH = 1200;
export const BRAIN_CANVAS_HEIGHT = 780;
export const BRAIN_CENTER_X = 600;
export const BRAIN_CENTER_Y = 390;

/**
 * Catálogo completo de nodos del Gemelo Digital (OS Brain).
 * Representa los 18 módulos y sub-sistemas reales disponibles en TODOENUNO OS.
 */
export const INITIAL_BRAIN_NODES: BrainNode[] = [
  // 1. Núcleo Central
  {
    id: 'core_memory',
    label: 'OS MEMORY',
    subtitle: 'Kernel Central & Event Store',
    domain: 'core',
    status: 'completed',
    x: 600,
    y: 390,
    radius: 54,
    iconName: 'Cpu',
    description: 'Núcleo bio-digital central de TODOENUNO OS. Orquesta el estado compartido, la inmutabilidad de eventos en PostgreSQL (os.events) y el enrutamiento sináptico entre todos los módulos del sistema.',
    completionPercentage: 100,
    health: 100,
    route: '/event-stream',
    subActions: [
      { id: 'cm-1', name: 'Almacén Inmutable de Eventos', description: 'Registro append-only con idempotencia estricta en el esquema os.events.', status: 'active', outputEvent: 'system.heartbeat' },
      { id: 'cm-2', name: 'Realtime Pub/Sub Channel', description: 'Suscripción por WebSockets vía Supabase Realtime a clientes conectados.', status: 'active' },
      { id: 'cm-3', name: 'Proyecciones Asíncronas (Projectors)', description: 'Actualización en cascada de inventario, balances de efectivo y analítica.', status: 'active' },
      { id: 'cm-4', name: 'Triggers de Automatización Transaccional', description: 'Disparadores SQL ante cambios de estado en whatsapp_orders.', status: 'active' }
    ],
    supportedEvents: ['system.heartbeat', 'system.test']
  },

  // 2. Dashboard Ejecutivo Hoy (Cúspide Operativa)
  {
    id: 'hoy_dashboard',
    label: 'Hoy (Dashboard)',
    subtitle: 'Control Diario & Alertas',
    domain: 'core',
    status: 'completed',
    x: 600,
    y: 85,
    radius: 46,
    iconName: 'LayoutDashboard',
    description: 'Panel de mando operativo diario. Consolida facturación en tiempo real, cumplimiento de meta COD, tasa de entrega porcentual en El Salvador, semáforo de pedidos pendientes y monitoreo del corte.',
    completionPercentage: 100,
    health: 98,
    route: '/',
    subActions: [
      { id: 'hd-1', name: 'Monitoreo de Facturación Diaria', description: 'Cálculo de ingresos brutos y recaudación contra entrega del día.', status: 'active' },
      { id: 'hd-2', name: 'Semáforo de Pedidos Críticos', description: 'Alerta temprana de órdenes sin confirmar próximas a perder ruta.', status: 'active' },
      { id: 'hd-3', name: 'Tasa Efectiva de Entrega (%)', description: 'Relación en vivo de pedidos entregados vs pedidos despachados.', status: 'active' }
    ],
    supportedEvents: ['order.created', 'order.delivered', 'finance.income.created', 'marketing.ad.expense']
  },

  // 3. Pedidos Core (Columna Transaccional COD)
  {
    id: 'pedidos_core',
    label: 'Pedidos COD',
    subtitle: 'Pipeline & Checkout Transaccional',
    domain: 'orders',
    status: 'completed',
    x: 600,
    y: 235,
    radius: 48,
    iconName: 'ShoppingBag',
    description: 'Columna vertebral transaccional. Gestiona el ciclo de vida de las órdenes (Nuevo ➔ Por Empacar ➔ En Camino ➔ Entregado / Cancelado) con soporte para pagos contra entrega y remesas.',
    completionPercentage: 98,
    health: 98,
    route: '/pedidos',
    subActions: [
      { id: 'pd-1', name: 'Recepción Centralizada COD', description: 'Consolida órdenes de WhatsApp, Facebook Ads, TikTok y web.', status: 'active', outputEvent: 'order.created' },
      { id: 'pd-2', name: 'Confirmación Telefónica / Chat', description: 'Pasa orden a "por_empacar" y programa la fecha de entrega.', status: 'active', outputEvent: 'order.confirmed' },
      { id: 'pd-3', name: 'Auditoría Antifraude DICOM', description: 'Cruza el número con DICOM interno antes de comprometer el flete.', status: 'active' },
      { id: 'pd-4', name: 'Cierre de Orden y Cobro', description: 'Asienta total recaudado y comisiones de flete al entregar.', status: 'active', outputEvent: 'order.delivered' },
      { id: 'pd-5', name: 'Registro de Encargos Programados', description: 'Agenda envíos futuros solicitados para quincena o fin de mes.', status: 'active', outputEvent: 'order.scheduled' }
    ],
    supportedEvents: ['order.created', 'order.confirmed', 'order.shipped', 'order.delivered', 'order.cancelled', 'order.scheduled']
  },

  // 4. Marketing & Pauta Publicitaria
  {
    id: 'marketing_studio',
    label: 'Marketing & Promo',
    subtitle: 'Pauta Ads & Copys IA',
    domain: 'marketing',
    status: 'completed',
    x: 160,
    y: 110,
    radius: 44,
    iconName: 'Megaphone',
    description: 'Gestor de adquisición de tráfico. Generador de copys persuasivos con IA, registro de gastos de pauta diaria en Meta/TikTok y disparador de alertas automáticas ante productos con alto ROAS.',
    completionPercentage: 92,
    health: 96,
    route: '/marketing',
    subActions: [
      { id: 'mk-1', name: 'Generador de Copys de Venta con IA', description: 'Redacta textos optimizados con gancho para Meta Ads en El Salvador.', status: 'active', outputEvent: 'marketing.post.created' },
      { id: 'mk-2', name: 'Control de Gasto Diario de Pauta', description: 'Registra egresos por campaña publicitaria en USD.', status: 'active', outputEvent: 'marketing.ad.expense' },
      { id: 'mk-3', name: 'Pauta Trigger Automatizado', description: 'Dispara alertas cuando un anuncio supera el ROAS objetivo.', status: 'active' },
      { id: 'mk-4', name: 'Captura de Leads de Formularios Meta', description: 'Importa clientes potenciales con número telefónico validado.', status: 'active', outputEvent: 'marketing.lead.generated' }
    ],
    supportedEvents: ['marketing.ad.expense', 'marketing.lead.generated', 'marketing.post.created', 'marketing.post.published']
  },

  // 5. Social Inbox (Bandeja Omnicanal Meta)
  {
    id: 'social_inbox',
    label: 'Social Inbox',
    subtitle: 'Comentarios & DMs de Meta',
    domain: 'social',
    status: 'completed',
    x: 370,
    y: 100,
    radius: 44,
    iconName: 'Inbox',
    description: 'Centro de mensajería social unificada. Centraliza comentarios públicos en anuncios de Facebook/Instagram y mensajes privados (DMs), con respuestas rápidas y derivación directa a ventas.',
    completionPercentage: 90,
    health: 94,
    route: '/social-inbox',
    subActions: [
      { id: 'si-1', name: 'Monitor de Comentarios en Anuncios', description: 'Captura preguntas de precio, cobertura departamental y disponibilidad.', status: 'active', outputEvent: 'chat.message.received' },
      { id: 'si-2', name: 'Respuesta Rápida Automatizada', description: 'Envía información de producto y enlace directo a WhatsApp.', status: 'active', outputEvent: 'social.reply.sent' },
      { id: 'si-3', name: 'Conversión de Comentario a Lead', description: 'Registra el prospecto calificado para seguimiento en UniChat.', status: 'active', outputEvent: 'lead.generated' }
    ],
    supportedEvents: ['chat.message.received', 'chat.message.sent', 'social.reply.sent', 'lead.generated']
  },

  // 6. Todd Venta (Bot de Cierre en WhatsApp)
  {
    id: 'todd_venta',
    label: 'Todd Venta',
    subtitle: 'Bot de Cierre & Conversión',
    domain: 'sales',
    status: 'completed',
    x: 360,
    y: 240,
    radius: 46,
    iconName: 'Bot',
    description: 'Agente conversacional especializado en cerrar ventas B2C en WhatsApp. Califica intención de compra, responde objeciones locales, recopila dirección en El Salvador y prepara el carrito COD.',
    completionPercentage: 95,
    health: 97,
    route: '/unichat',
    subActions: [
      { id: 'tv-1', name: 'Atención Inmediata de Tráfico Ads', description: 'Vincula la conversación entrante al código de anuncio (codigo_anuncio).', status: 'active', outputEvent: 'lead.generated' },
      { id: 'tv-2', name: 'Negociación y Pitch de Ventas', description: 'Responde dudas de garantía, flete y tiempo de entrega en El Salvador.', status: 'active', outputEvent: 'chat.message.sent' },
      { id: 'tv-3', name: 'Estructuración de Dirección COD', description: 'Normaliza departamento, municipio, colonia y punto de referencia.', status: 'active' },
      { id: 'tv-4', name: 'Pre-orden Automatizada', description: 'Crea el pedido directamente en whatsapp_orders.', status: 'active', outputEvent: 'order.created' }
    ],
    supportedEvents: ['chat.message.received', 'chat.message.sent', 'lead.generated', 'chat.bot.toggled']
  },

  // 7. DICOM Interno (Antifraude y Lista Negra)
  {
    id: 'dicom_interno',
    label: 'DICOM Interno',
    subtitle: 'Antifraude & Lista Negra SV',
    domain: 'antifraud',
    status: 'completed',
    x: 840,
    y: 180,
    radius: 45,
    iconName: 'ShieldCheck',
    description: 'Sistema de scoring e inteligencia de riesgo comercial en El Salvador. Detecta clientes reincidentes que rechazan pedidos en puerta, fletes perdidos y genera notificaciones formales de WhatsApp.',
    completionPercentage: 92,
    health: 95,
    route: '/analitica',
    subActions: [
      { id: 'dc-1', name: 'Scoring Telefónico Antifraude', description: 'Verifica historial crediticio/logístico de 8 dígitos al ingresar pedido.', status: 'active', outputEvent: 'customer.whitelisted' },
      { id: 'dc-2', name: 'Boletín Oficial de Incumplimiento', description: 'Registra motivo de rechazo (dirección falsa, no atendió al motorista).', status: 'active', outputEvent: 'customer.blacklisted' },
      { id: 'dc-3', name: 'Generador de Boleta WhatsApp', description: 'Envía aviso formal de mora y costo de flete devuelto.', status: 'active', outputEvent: 'customer.notified' },
      { id: 'dc-4', name: 'Filtro de Exclusión para Lucas LTV', description: 'Impide enviar ofertas flash y descuentos a morosos boletinados.', status: 'active' }
    ],
    supportedEvents: ['customer.blacklisted', 'customer.whitelisted', 'customer.notified']
  },

  // 8. Analítica & Mapa Logístico El Salvador
  {
    id: 'analitica_geo',
    label: 'Analítica SV',
    subtitle: 'Mapa Departamental & Horas',
    domain: 'analytics',
    status: 'completed',
    x: 1050,
    y: 120,
    radius: 44,
    iconName: 'PieChart',
    description: 'Módulo de inteligencia geoespacial y temporal. Mapa de calor de los 14 departamentos de El Salvador, efectividad de entrega por zona geográfica y curvas de pedidos por franja horaria.',
    completionPercentage: 94,
    health: 96,
    route: '/analitica',
    subActions: [
      { id: 'ag-1', name: 'Mapa de Calor 14 Departamentos', description: 'Monitorea concentración de pedidos en San Salvador, La Libertad, etc.', status: 'active' },
      { id: 'ag-2', name: 'Analítica Horaria de Ventas', description: 'Detecta picos de conversión (11:00 AM - 2:00 PM y 7:00 PM - 10:00 PM).', status: 'active' },
      { id: 'ag-3', name: 'Tasa de Éxito por Courier', description: 'Compara efectividad de entrega entre motoristas propios y couriers.', status: 'active' }
    ],
    supportedEvents: ['order.delivered', 'order.cancelled']
  },

  // 9. Reloj de Despacho (Ventana de Corte 2:00 PM)
  {
    id: 'reloj_despacho',
    label: 'Reloj Despacho',
    subtitle: 'Ventana de Corte 2:00 PM',
    domain: 'dispatch',
    status: 'completed',
    x: 1040,
    y: 260,
    radius: 43,
    iconName: 'Clock',
    description: 'Control de cadencia temporal operativa. Cronometra la ventana de corte de las 2:00 PM para asegurar que los pedidos salgan en las rutas departamentales y urbanas del día.',
    completionPercentage: 88,
    health: 94,
    route: '/pedidos',
    subActions: [
      { id: 'rd-1', name: 'Cuenta Regresiva de Corte Diario', description: 'Sincroniza a picking para empacar antes de la llegada de mensajerías.', status: 'active' },
      { id: 'rd-2', name: 'Agrupación de Rutas por Zona', description: 'Separa San Salvador Centro, La Libertad, Santa Ana y Oriente.', status: 'active' },
      { id: 'rd-3', name: 'Asignación de Guías de Despacho', description: 'Genera manifiesto de entrega para los motoristas.', status: 'active', outputEvent: 'order.scheduled' }
    ],
    supportedEvents: ['order.scheduled', 'order.shipped']
  },

  // 10. Empaques & Picking de Bodega
  {
    id: 'empaques_stock',
    label: 'Empaques & Cola',
    subtitle: 'Picking, Guías & Bodega',
    domain: 'packaging',
    status: 'completed',
    x: 840,
    y: 350,
    radius: 45,
    iconName: 'PackageCheck',
    description: 'Gestión física del almacén y preparación de paquetes. Imprime etiquetas térmicas con datos del destinatario, código de barras y deduce automáticamente el inventario físico en bodega.',
    completionPercentage: 90,
    health: 95,
    route: '/cola',
    subActions: [
      { id: 'ep-1', name: 'Cola Prioritaria de Picking', description: 'Ordena paquetes por urgencia y hora de salida de ruta.', status: 'active' },
      { id: 'ep-2', name: 'Deducción de Stock en Bodega', description: 'Resta existencias físicas al confirmar el empaque del producto.', status: 'active', outputEvent: 'inventory.adjustment' },
      { id: 'ep-3', name: 'Impresión de Guía Térmica', description: 'Genera sticker con código QR, teléfono y monto a cobrar en puerta.', status: 'active' }
    ],
    supportedEvents: ['inventory.adjustment', 'product.updated', 'order.confirmed']
  },

  // 11. Motos & Logística de Última Milla
  {
    id: 'motos_logistica',
    label: 'Motos & Repartos',
    subtitle: 'Última Milla & Portal Móvil',
    domain: 'delivery',
    status: 'completed',
    x: 1040,
    y: 440,
    radius: 46,
    iconName: 'Truck',
    description: 'Red de distribución física de última milla. Los motoristas utilizan el portal móvil `/entregar` para reportar entregas en vivo, geo-confirmaciones y cobro en efectivo.',
    completionPercentage: 92,
    health: 96,
    route: '/entregar',
    subActions: [
      { id: 'ml-1', name: 'Portal Móvil de Repartidor', description: 'Interfaz ligera táctil sin login para marcar entrega en ruta.', status: 'active' },
      { id: 'ml-2', name: 'Confirmación Geolocalizada', description: 'Registra coordenadas GPS y foto de comprobante de entrega.', status: 'active', outputEvent: 'order.delivered' },
      { id: 'ml-3', name: 'Liquidación Diaria de Remesas', description: 'Audita el efectivo en mano cobrado en puerta.', status: 'active', outputEvent: 'finance.income.created' },
      { id: 'ml-4', name: 'Reporte Inmediato de Rechazo', description: 'Notifica al instante si el cliente no recibió el paquete.', status: 'active', outputEvent: 'order.cancelled' }
    ],
    supportedEvents: ['order.shipped', 'order.delivered', 'order.cancelled', 'finance.income.created']
  },

  // 12. Finanzas & Flujo de Caja COD
  {
    id: 'finanzas_cashflow',
    label: 'Finanzas COD',
    subtitle: 'Efectivo & Money Engine',
    domain: 'finance',
    status: 'completed',
    x: 800,
    y: 560,
    radius: 46,
    iconName: 'Wallet',
    description: 'Gestor del flujo de caja contra entrega. Concilia el efectivo liquidado por motoristas contra el flete real pagado, costos de adquisición de pauta (CAC) y cuentas por pagar a proveedores.',
    completionPercentage: 95,
    health: 98,
    route: '/finanzas',
    subActions: [
      { id: 'fn-1', name: 'Liquidación de Efectivo por Repartidor', description: 'Cierra caja diaria conciliando pedidos entregados vs efectivo en mano.', status: 'active', outputEvent: 'finance.income.created' },
      { id: 'fn-2', name: 'Auditoría de Costo de Flete', description: 'Deduce fletes pagados tanto en entregas como en devoluciones.', status: 'active', outputEvent: 'finance.expense.created' },
      { id: 'fn-3', name: 'Gestión de Cuentas por Pagar', description: 'Registra deudas y compromisos con importadores y transportistas.', status: 'active', outputEvent: 'finance.debt.created' }
    ],
    supportedEvents: ['finance.income.created', 'finance.expense.created', 'finance.debt.created']
  },

  // 13. Rentabilidad & Bóveda ROAS
  {
    id: 'rentabilidad_roas',
    label: 'Rentabilidad ROAS',
    subtitle: 'Bóveda de Productos & Margen',
    domain: 'finance',
    status: 'completed',
    x: 600,
    y: 670,
    radius: 45,
    iconName: 'TrendingUp',
    description: 'Bóveda de rentabilidad por producto y campaña. Calcula el margen neto unitario por SKU, el ROAS mínimo de equilibrio (Breakeven) y el impacto de devoluciones en el beneficio final.',
    completionPercentage: 94,
    health: 97,
    route: '/rentabilidad',
    subActions: [
      { id: 'rn-1', name: 'Bóveda de Margen Unitario por SKU', description: 'Desglosa precio de venta, costo producto, empaque y comisión.', status: 'active' },
      { id: 'rn-2', name: 'Cálculo de ROAS Breakeven', description: 'Indica el multiplicador publicitario mínimo para no perder dinero.', status: 'active' },
      { id: 'rn-3', name: 'Absorción de Fletes Fallidos', description: 'Calcula cuántas ventas absorben el costo de un flete devuelto.', status: 'active' }
    ],
    supportedEvents: ['finance.income.created', 'finance.expense.created', 'order.delivered']
  },

  // 14. Proveedores & Licitaciones B2B
  {
    id: 'proveedores_b2b',
    label: 'Proveedores B2B',
    subtitle: 'Licitaciones & Suministro',
    domain: 'suppliers',
    status: 'completed',
    x: 400,
    y: 650,
    radius: 44,
    iconName: 'Store',
    description: 'Portal de abastecimiento mayorista y licitaciones masivas. Publica requerimientos de stock a importadores con subasta inversa y adjudica órdenes al mejor postor.',
    completionPercentage: 92,
    health: 96,
    route: '/proveedores',
    subActions: [
      { id: 'pr-1', name: 'Lanzamiento de Licitación Masiva', description: 'Emite solicitud de cotización por WhatsApp a proveedores.', status: 'active', outputEvent: 'purchase.requested' },
      { id: 'pr-2', name: 'Recepción de Ofertas (Bids)', description: 'Procesa cotizaciones unitarias y tiempos de entrega en días.', status: 'active', outputEvent: 'supplier.bid.received' },
      { id: 'pr-3', name: 'Adjudicación y Orden de Compra', description: 'Selecciona proveedor óptimo y asienta la cuenta por pagar.', status: 'active', outputEvent: 'supplier.selected' }
    ],
    supportedEvents: ['supplier.created', 'purchase.requested', 'supplier.bid.received', 'supplier.selected']
  },

  // 15. Catálogo Maestro & Kárdex de Inventario
  {
    id: 'catalogo_kardex',
    label: 'Catálogo & Kárdex',
    subtitle: 'Inventario, SKUs & Aliases',
    domain: 'catalog',
    status: 'completed',
    x: 380,
    y: 500,
    radius: 45,
    iconName: 'Layers',
    description: 'Inventario centralizado y catálogo maestro. Controla Kárdex de entradas/salidas, existencias en bodega, precios al público, cohortes de productos ancla y sinónimos para el bot Todd.',
    completionPercentage: 96,
    health: 98,
    route: '/inventario',
    subActions: [
      { id: 'ck-1', name: 'Kárdex Físico de Entradas y Salidas', description: 'Historial inmutable de movimientos de stock con causa y costo.', status: 'active', outputEvent: 'inventory.adjustment' },
      { id: 'ck-2', name: 'Aliases y Sinónimos de Todd Bot', description: 'Mapea frases coloquiales salvadoreñas al SKU correspondiente.', status: 'active', outputEvent: 'product.updated' },
      { id: 'ck-3', name: 'Alertas de Stock Crítico', description: 'Detecta cuando un producto está por agotarse y pide reposición.', status: 'active', outputEvent: 'purchase.requested' }
    ],
    supportedEvents: ['product.created', 'product.updated', 'inventory.adjustment']
  },

  // 16. Lucas Ciclo de Vida & LTV (Fidelización)
  {
    id: 'lucas_ciclo_vida',
    label: 'Lucas LTV',
    subtitle: 'Retención & Ofertas Flash',
    domain: 'lifecycle',
    status: 'completed',
    x: 190,
    y: 410,
    radius: 46,
    iconName: 'Zap',
    description: 'Motor predictivo de fidelización y valor de vida del cliente. Identifica productos ancla (como Porta Bebés) y programa ofertas flash automatizadas por WhatsApp a los 60-180 días con CAC = $0.',
    completionPercentage: 90,
    health: 96,
    route: '/ltv',
    subActions: [
      { id: 'lc-1', name: 'Segmentación de Cohortes de Clientes', description: 'Clasifica compradores según producto ancla y fecha de compra.', status: 'active' },
      { id: 'lc-2', name: 'Matriz Predictiva de Cross-Sell', description: 'Recomienda el producto complementario en el momento oportuno.', status: 'active', outputEvent: 'ltv.campaign_created' },
      { id: 'lc-3', name: 'Lanzador de Ofertas Flash 48 Horas', description: 'Dispara cupón único y temporizador por WhatsApp vía Todd.', status: 'active', outputEvent: 'ltv.offer_dispatched' },
      { id: 'lc-4', name: 'Filtro de Exclusión DICOM', description: 'Evita premiar o vender a clientes con antecedentes de rechazo.', status: 'active' }
    ],
    supportedEvents: ['ltv.campaign_created', 'ltv.offer_dispatched', 'order.delivered']
  },

  // 17. Sistema & Diagnóstico Operativo
  {
    id: 'sistema_monitoreo',
    label: 'Sistema & Bot',
    subtitle: 'Webhooks, Bot Toggle & Salud',
    domain: 'system',
    status: 'completed',
    x: 160,
    y: 260,
    radius: 42,
    iconName: 'Server',
    description: 'Centro de control técnico e infraestructura. Gestiona el interruptor de automatización de Todd Bot, verifica el estado de Webhooks de Meta, conectividad a Supabase y tareas programadas (cron).',
    completionPercentage: 95,
    health: 99,
    route: '/sistema',
    subActions: [
      { id: 'sm-1', name: 'Interruptor Maestro de Todd Bot', description: 'Activa o desactiva la respuesta autónoma de la IA en chats.', status: 'active', outputEvent: 'chat.bot.toggled' },
      { id: 'sm-2', name: 'Diagnóstico de Webhooks Meta', description: 'Verifica la recepción continua de mensajes de WhatsApp y Facebook.', status: 'active' },
      { id: 'sm-3', name: 'Latido de Salud del Kernel', description: 'Emite comprobación periódica de integridad del sistema.', status: 'active', outputEvent: 'system.heartbeat' }
    ],
    supportedEvents: ['chat.bot.toggled', 'system.heartbeat', 'system.test']
  },

  // 18. Docs & Memoria Arquitectónica
  {
    id: 'docs_roadmap',
    label: 'Docs Roadmap',
    subtitle: 'Arquitectura & Sprints SQL',
    domain: 'docs',
    status: 'completed',
    x: 160,
    y: 620,
    radius: 42,
    iconName: 'FileText',
    description: 'Memoria institucional técnica. Repositorio de scripts SQL de migración (Sprint 1 a 9), manuales operativos de puesto y mapa normativo de eventos de TODOENUNO OS.',
    completionPercentage: 85,
    health: 90,
    route: '/docs',
    subActions: [
      { id: 'dr-1', name: 'Catálogo de Scripts SQL de Sprints', description: 'Migraciones idempotentes para replicar el esquema en Supabase.', status: 'active' },
      { id: 'dr-2', name: 'Mapa Oficial de Eventos OS', description: 'Contrato de datos entre tablas de origen y eventos del bus.', status: 'active' },
      { id: 'dr-3', name: 'Bitácora de Sprints de Ingeniería', description: 'Registro de hitos y dependencias de la plataforma.', status: 'active' }
    ],
    supportedEvents: ['system.test']
  }
];

/**
 * Conexiones y sinapsis reales de TODOENUNO OS.
 * Cada conexión modela un flujo de datos concreto respaldado por eventos inmutables.
 */
export const INITIAL_BRAIN_CONNECTIONS: BrainConnection[] = [
  // ==========================================================================
  // GRUPO A: SINAPSIS RADIALES CON OS MEMORY (Kernel Event Store)
  // ==========================================================================
  { id: 'c-core-hoy', from: 'core_memory', to: 'hoy_dashboard', label: 'Telemetría de Eventos en Vivo', eventType: 'system.heartbeat', description: 'Alimenta los indicadores ejecutivos diarios desde el event stream.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-pedidos', from: 'core_memory', to: 'pedidos_core', label: 'Transacciones Inmutables', eventType: 'order.created', description: 'Garantiza idempotencia y persistencia de cada pedido.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-todd', from: 'core_memory', to: 'todd_venta', label: 'Eventos de Conversación', eventType: 'chat.message.received', description: 'Sincroniza mensajes entrantes y prospectos captados.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-marketing', from: 'core_memory', to: 'marketing_studio', label: 'Gasto & Leads de Pauta', eventType: 'marketing.ad.expense', description: 'Registra egresos de Meta Ads y formularios en el stream.', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-social', from: 'core_memory', to: 'social_inbox', label: 'Comentarios & DMs Meta', eventType: 'social.reply.sent', description: 'Canaliza interacciones sociales al bus central.', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-dicom', from: 'core_memory', to: 'dicom_interno', label: 'Boletín de Clientes & Riesgo', eventType: 'customer.blacklisted', description: 'Mantiene el índice histórico de solvencia y rechazos.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-analitica', from: 'core_memory', to: 'analitica_geo', label: 'Feed Georreferenciado', eventType: 'order.delivered', description: 'Alimenta el mapa de calor de El Salvador con entregas reales.', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-reloj', from: 'core_memory', to: 'reloj_despacho', label: 'Cadencia de Ventana 2:00 PM', eventType: 'order.scheduled', description: 'Sincroniza los tiempos límite de corte para el despacho.', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-empaques', from: 'core_memory', to: 'empaques_stock', label: 'Cola de Picking & Rotulado', eventType: 'order.confirmed', description: 'Notifica paquetes listos para deducción de stock y embalaje.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-motos', from: 'core_memory', to: 'motos_logistica', label: 'Telemetría de Reparto en Ruta', eventType: 'order.shipped', description: 'Monitorea las confirmaciones geolocalizadas de los motoristas.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-finanzas', from: 'core_memory', to: 'finanzas_cashflow', label: 'Finance Projector Sync', eventType: 'finance.income.created', description: 'Convierte eventos de entrega en asientos de caja y egresos.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-rentabilidad', from: 'core_memory', to: 'rentabilidad_roas', label: 'Atribución de Margen Neto', eventType: 'finance.income.created', description: 'Recalcula rentabilidad por SKU según ingresos y fletes reales.', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-kardex', from: 'core_memory', to: 'catalogo_kardex', label: 'Kárdex Inmutable de Stock', eventType: 'inventory.adjustment', description: 'Registra cada deducción o ingreso físico en bodega.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-lucas', from: 'core_memory', to: 'lucas_ciclo_vida', label: 'Disparadores de Cohortes LTV', eventType: 'ltv.campaign_created', description: 'Programa ofertas automáticas al cumplirse el plazo de ciclo.', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-prov', from: 'core_memory', to: 'proveedores_b2b', label: 'Licitaciones & Subasta Inversa', eventType: 'purchase.requested', description: 'Registra solicitudes de compra y adjudicaciones B2B.', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-sistema', from: 'core_memory', to: 'sistema_monitoreo', label: 'Latidos de Integridad (Heartbeat)', eventType: 'system.heartbeat', description: 'Verifica la salud de los servicios y webhooks del sistema.', flowType: 'core_sync', bandwidth: 'low', animated: true },
  { id: 'c-core-docs', from: 'core_memory', to: 'docs_roadmap', label: 'Auditoría de Esquemas SQL', eventType: 'system.test', description: 'Contratos y esquemas de datos auditados contra la arquitectura.', flowType: 'core_sync', bandwidth: 'low', animated: false },

  // ==========================================================================
  // GRUPO B: FLUJO DE MARKETING & ADQUISICIÓN (Marketing Flow)
  // ==========================================================================
  {
    id: 'c-mkt-todd',
    from: 'marketing_studio',
    to: 'todd_venta',
    label: 'Anuncios Meta ➔ Cierre en WhatsApp',
    eventType: 'lead.generated',
    description: 'El anuncio con código de pauta deriva al comprador a WhatsApp atendido por Todd.',
    flowType: 'marketing_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-mkt-social',
    from: 'marketing_studio',
    to: 'social_inbox',
    label: 'Pauta Ads ➔ Comentarios en Publicaciones',
    eventType: 'marketing.post.published',
    description: 'Las campañas activas generan consultas en anuncios de Facebook e Instagram.',
    flowType: 'marketing_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-social-todd',
    from: 'social_inbox',
    to: 'todd_venta',
    label: 'Prospecto Calificado ➔ Bot de Negociación',
    eventType: 'chat.message.received',
    description: 'Los comentarios con intención de compra se transfieren al bot Todd.',
    flowType: 'marketing_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-mkt-finanzas',
    from: 'marketing_studio',
    to: 'finanzas_cashflow',
    label: 'Gasto Diario de Pauta ➔ Egreso Contable',
    eventType: 'marketing.ad.expense',
    description: 'Asienta el costo de publicidad en Meta y TikTok para deducirlo del margen.',
    flowType: 'marketing_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-mkt-roas',
    from: 'marketing_studio',
    to: 'rentabilidad_roas',
    label: 'Inversión Publicitaria ➔ Atribución CAC',
    eventType: 'marketing.ad.expense',
    description: 'Alimenta el cálculo del costo de adquisición unitario por producto.',
    flowType: 'marketing_flow',
    bandwidth: 'medium',
    animated: true
  },

  // ==========================================================================
  // GRUPO C: FLUJO COMERCIAL & CHECKOUT COD (Sales Flow)
  // ==========================================================================
  {
    id: 'c-todd-pedidos',
    from: 'todd_venta',
    to: 'pedidos_core',
    label: 'Cierre Lead ➔ Pedido COD Creado',
    eventType: 'order.created',
    description: 'Todd recopila nombre, teléfono y dirección salvadoreña y crea la orden.',
    flowType: 'sales_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-pedidos-dicom',
    from: 'pedidos_core',
    to: 'dicom_interno',
    label: 'Scoring Telefónico Antifraude',
    eventType: 'customer.whitelisted',
    description: 'Cruza el número con DICOM interno antes de comprometer el flete en ruta.',
    flowType: 'sales_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-dicom-pedidos',
    from: 'dicom_interno',
    to: 'pedidos_core',
    label: 'Veredicto de Riesgo: Aprobado / Rechazado',
    eventType: 'customer.blacklisted',
    description: 'Autoriza el envío sin anticipo o exige pago previo si tiene paquetes botados.',
    flowType: 'sales_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-pedidos-kardex',
    from: 'pedidos_core',
    to: 'catalogo_kardex',
    label: 'Verificación de Stock Disponible',
    eventType: 'product.updated',
    description: 'Comprueba existencias antes de prometer entrega en 24 horas.',
    flowType: 'sales_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-pedidos-hoy',
    from: 'pedidos_core',
    to: 'hoy_dashboard',
    label: 'Nuevas Órdenes ➔ Facturación Hoy',
    eventType: 'order.created',
    description: 'Actualiza en tiempo real el contador diario de pedidos y volumen en dólares.',
    flowType: 'sales_flow',
    bandwidth: 'high',
    animated: true
  },

  // ==========================================================================
  // GRUPO D: FLUJO DE ALMACÉN, PICKING & DESPACHO (Fulfillment Flow)
  // ==========================================================================
  {
    id: 'c-pedidos-empaques',
    from: 'pedidos_core',
    to: 'empaques_stock',
    label: 'Orden Confirmada ➔ Cola de Picking',
    eventType: 'order.confirmed',
    description: 'Al confirmar datos con el cliente, el paquete entra a la lista de embalaje.',
    flowType: 'fulfillment_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-empaques-kardex',
    from: 'empaques_stock',
    to: 'catalogo_kardex',
    label: 'Deducción de Inventario Físico',
    eventType: 'inventory.adjustment',
    description: 'Al imprimir la guía térmica se resta automáticamente la unidad en bodega.',
    flowType: 'fulfillment_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-empaques-reloj',
    from: 'empaques_stock',
    to: 'reloj_despacho',
    label: 'Corte 2:00 PM / Asignación de Canasta',
    eventType: 'order.scheduled',
    description: 'Clasifica los bultos por departamento y ruta antes de la llegada de transportistas.',
    flowType: 'fulfillment_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-reloj-motos',
    from: 'reloj_despacho',
    to: 'motos_logistica',
    label: 'Despacho de Manifiesto a Repartidores',
    eventType: 'order.shipped',
    description: 'El motorista carga su hoja de ruta en el portal móvil `/entregar`.',
    flowType: 'fulfillment_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-motos-pedidos',
    from: 'motos_logistica',
    to: 'pedidos_core',
    label: 'Actualización en Vivo: Entregado / Fallo',
    eventType: 'order.delivered',
    description: 'El estado del pedido pasa a "entregado" en cuanto el cliente recibe el producto.',
    flowType: 'fulfillment_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-motos-analitica',
    from: 'motos_logistica',
    to: 'analitica_geo',
    label: 'Geolocalización en 14 Deptos de El Salvador',
    eventType: 'order.delivered',
    description: 'Asocia la entrega exitosa a la coordenada y departamento salvadoreño.',
    flowType: 'fulfillment_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-motos-dicom',
    from: 'motos_logistica',
    to: 'dicom_interno',
    label: 'Reporte Inmediato de Rechazo en Puerta',
    eventType: 'customer.blacklisted',
    description: 'Si el cliente no contesta o rechaza pagar, se registra en Lista Negra.',
    flowType: 'fulfillment_flow',
    bandwidth: 'medium',
    animated: true
  },

  // ==========================================================================
  // GRUPO E: FLUJO DE FINANZAS, CAJA & RENTABILIDAD (Finance Flow)
  // ==========================================================================
  {
    id: 'c-motos-finanzas',
    from: 'motos_logistica',
    to: 'finanzas_cashflow',
    label: 'Liquidación de Efectivo Recaudado COD',
    eventType: 'finance.income.created',
    description: 'El motorista liquida el dinero cobrado en mano al finalizar la ruta.',
    flowType: 'finance_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-pedidos-finanzas',
    from: 'pedidos_core',
    to: 'finanzas_cashflow',
    label: 'Cierre de Venta ➔ Asiento de Ingreso',
    eventType: 'finance.income.created',
    description: 'Finance Projector proyecta el ingreso y desglosa el costo del flete.',
    flowType: 'finance_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-finanzas-roas',
    from: 'finanzas_cashflow',
    to: 'rentabilidad_roas',
    label: 'Conciliación de Efectivo vs Rentabilidad Real',
    eventType: 'finance.income.created',
    description: 'Alimenta los márgenes netos reales descontando fletes y costos bancarios.',
    flowType: 'finance_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-finanzas-hoy',
    from: 'finanzas_cashflow',
    to: 'hoy_dashboard',
    label: 'Efectivo Cobrado ➔ Tasa de Cobro Hoy',
    eventType: 'finance.income.created',
    description: 'Muestra en el panel superior cuánto dinero ya ingresó físicamente a caja.',
    flowType: 'finance_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-roas-mkt',
    from: 'rentabilidad_roas',
    to: 'marketing_studio',
    label: 'Feedback de Rendimiento: Escalar o Pausar Ads',
    eventType: 'finance.expense.created',
    description: 'Informa al generador de pauta qué productos tienen margen suficiente para escalar.',
    flowType: 'finance_flow',
    bandwidth: 'medium',
    animated: true
  },

  // ==========================================================================
  // GRUPO F: FLUJO DE RETENCIÓN & FIDELIZACIÓN LTV (Retention Flow)
  // ==========================================================================
  {
    id: 'c-pedidos-lucas',
    from: 'pedidos_core',
    to: 'lucas_ciclo_vida',
    label: 'Pedido Entregado ➔ Activación Cohorte LTV',
    eventType: 'order.delivered',
    description: 'Al entregar un producto ancla (ej. Porta Bebés), registra al cliente en la matriz.',
    flowType: 'retention_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-lucas-kardex',
    from: 'lucas_ciclo_vida',
    to: 'catalogo_kardex',
    label: 'Selección de Producto Complementario',
    eventType: 'ltv.campaign_created',
    description: 'Determina el siguiente producto lógico según la edad del bebé o uso del cliente.',
    flowType: 'retention_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-lucas-dicom',
    from: 'lucas_ciclo_vida',
    to: 'dicom_interno',
    label: 'Filtro Anti-Morosos para Ofertas Flash',
    eventType: 'customer.whitelisted',
    description: 'Excluye de recibir cupones y promociones a personas con incidentes en DICOM.',
    flowType: 'retention_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-lucas-todd',
    from: 'lucas_ciclo_vida',
    to: 'todd_venta',
    label: 'Disparo de Oferta Flash 48h por WhatsApp',
    eventType: 'ltv.offer_dispatched',
    description: 'Envía mensaje personalizado con cupón de descuento temporal vía Todd.',
    flowType: 'retention_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-lucas-pedidos',
    from: 'lucas_ciclo_vida',
    to: 'pedidos_core',
    label: 'Recompra Orgánica (CAC = $0.00)',
    eventType: 'order.created',
    description: 'Crea una orden repetitiva de alto margen sin pagar publicidad a Meta.',
    flowType: 'retention_flow',
    bandwidth: 'medium',
    animated: true
  },

  // ==========================================================================
  // GRUPO G: FLUJO DE CADENA DE SUMINISTRO & PROVEEDORES (Supply Flow)
  // ==========================================================================
  {
    id: 'c-kardex-prov',
    from: 'catalogo_kardex',
    to: 'proveedores_b2b',
    label: 'Stock Crítico ➔ Solicitud de Licitación B2B',
    eventType: 'purchase.requested',
    description: 'Cuando las existencias tocan el punto de reorden, dispara subasta inversa.',
    flowType: 'supply_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-prov-kardex',
    from: 'proveedores_b2b',
    to: 'catalogo_kardex',
    label: 'Reabastecimiento Contenedor ➔ Entrada Kárdex',
    eventType: 'inventory.adjustment',
    description: 'Ingresa al inventario disponible el lote entregado por el importador.',
    flowType: 'supply_flow',
    bandwidth: 'high',
    animated: true
  },
  {
    id: 'c-prov-finanzas',
    from: 'proveedores_b2b',
    to: 'finanzas_cashflow',
    label: 'Liquidación / Pago a Proveedor Adjudicado',
    eventType: 'finance.expense.created',
    description: 'Asienta el egreso o cuenta por pagar para saldar el stock recibido.',
    flowType: 'supply_flow',
    bandwidth: 'medium',
    animated: true
  },

  // ==========================================================================
  // GRUPO H: GOBERNANZA, SISTEMA & AUTOMATIZACIÓN (System Flow)
  // ==========================================================================
  {
    id: 'c-sis-todd',
    from: 'sistema_monitoreo',
    to: 'todd_venta',
    label: 'Switch Maestro: Bot Automático vs Asesor',
    eventType: 'chat.bot.toggled',
    description: 'Alterna entre la IA conversacional autónoma y la intervención de ejecutivos.',
    flowType: 'system_flow',
    bandwidth: 'medium',
    animated: true
  },
  {
    id: 'c-sis-core',
    from: 'sistema_monitoreo',
    to: 'core_memory',
    label: 'Latido de Salud & Monitoreo de Webhooks',
    eventType: 'system.heartbeat',
    description: 'Verifica la integridad de las conexiones con Meta, WhatsApp y Supabase.',
    flowType: 'system_flow',
    bandwidth: 'low',
    animated: true
  },
  {
    id: 'c-docs-core',
    from: 'docs_roadmap',
    to: 'core_memory',
    label: 'Contratos de Esquemas SQL & Sprints',
    eventType: 'system.test',
    description: 'Mapeo oficial de tablas origen y eventos del catálogo inmutable.',
    flowType: 'system_flow',
    bandwidth: 'low',
    animated: false
  }
];

/**
 * Simulación del ciclo completo de un pedido contra entrega (COD) en El Salvador.
 * Recorre paso a paso las sinapsis y módulos reales del sistema.
 */
export const COD_SIMULATION_STEPS: SimulationStep[] = [
  {
    step: 1,
    title: 'Anuncio en Meta Ads & Tráfico a WhatsApp',
    sourceNodeId: 'marketing_studio',
    targetNodeId: 'todd_venta',
    eventType: 'lead.generated',
    description: 'Una madre en Santa Tecla ve un video publicitario de Porta Bebés Ergonómico en Facebook y hace clic en "Enviar Mensaje". El bot Todd la saluda de inmediato en WhatsApp.',
    impact: 'Se califica al prospecto y se registra el código de anuncio para atribución de pauta publicitaria.',
    dataSummary: 'Campaña: FB-BEBES-PROMO · Prospecto: Carla Hernández · Teléfono: 7458-1290 · SV'
  },
  {
    step: 2,
    title: 'Negociación, Cotización de Flete & Cierre de Venta',
    sourceNodeId: 'todd_venta',
    targetNodeId: 'pedidos_core',
    eventType: 'order.created',
    description: 'Todd responde sobre soporte lumbar, confirma que el flete a Santa Tecla es de $3.50 y recopila la dirección completa. Genera automáticamente la orden PED-9142 en estado "nuevo".',
    impact: 'Cierre de venta sin intervención humana; orden registrada en el pipeline transaccional.',
    dataSummary: 'Orden: PED-9142 · SKU: PORTA-BEBE-ERG-01 · Total a cobrar: $34.00 · Pago: Contra Entrega (COD)'
  },
  {
    step: 3,
    title: 'Auditoría Antifraude & Score en DICOM Interno',
    sourceNodeId: 'pedidos_core',
    targetNodeId: 'dicom_interno',
    eventType: 'customer.whitelisted',
    description: 'El sistema consulta la base de datos de DICOM Interno de El Salvador. El número 7458-1290 tiene un score crediticio de 98/100, sin historial de pedidos botados ni direcciones falsas.',
    impact: 'Score: 98/100 (Bajo Riesgo). Se aprueba el envío COD en puerta sin necesidad de exigir anticipo.',
    dataSummary: 'Resultado: APROBADO · Reincidencia: 0% · Flete autorizado: $3.50 a Santa Tecla'
  },
  {
    step: 4,
    title: 'Confirmación, Reserva en Kárdex & Picking en Bodega',
    sourceNodeId: 'pedidos_core',
    targetNodeId: 'empaques_stock',
    eventType: 'order.confirmed',
    description: 'La orden pasa al estado "por_empacar". El módulo de Empaques descuenta 1 unidad del Kárdex de almacén e imprime la guía térmica adhesiva con código QR.',
    impact: 'Inventario físico protegido contra sobreventa; paquete embalado y rotulado para la ruta.',
    dataSummary: 'Estado: confirmado ➔ por_empacar · Stock restante: 14 uds · Guía Térmica: #GT-9142'
  },
  {
    step: 5,
    title: 'Ventana de Corte 2:00 PM & Agrupación de Ruta',
    sourceNodeId: 'empaques_stock',
    targetNodeId: 'reloj_despacho',
    eventType: 'order.scheduled',
    description: 'El paquete es clasificado en la canasta de la ruta "La Libertad / Santa Tecla" antes del corte de las 2:00 PM para asegurar que no se retrase.',
    impact: 'Garantiza la promesa de entrega en menos de 24 horas hábiles en la zona metropolitana.',
    dataSummary: 'Ruta: Santa Tecla Zona 1 · Courier: Motorista Carlos M. · Manifiesto: #MAN-08'
  },
  {
    step: 6,
    title: 'Despacho a Motorista y Salida a Ruta con Portal Móvil',
    sourceNodeId: 'reloj_despacho',
    targetNodeId: 'motos_logistica',
    eventType: 'order.shipped',
    description: 'El motorista Carlos recibe la hoja de ruta en su teléfono en `/entregar`. Se desplaza a la colonia en Santa Tecla y llama a la clienta para coordinar la entrega.',
    impact: 'La clienta recibe confirmación por WhatsApp y el pedido pasa a estado "en_camino".',
    dataSummary: 'Estado: en_camino · Repartidor: Carlos M. · Salida: 2:15 PM · Teléfono móvil: Activo'
  },
  {
    step: 7,
    title: 'Entrega en Puerta, Geolocalización & Cobro de $34.00 Efectivo',
    sourceNodeId: 'motos_logistica',
    targetNodeId: 'finanzas_cashflow',
    eventType: 'order.delivered',
    description: 'Carlos entrega el porta bebés en mano, recibe $34.00 en billetes en efectivo y presiona "Confirmar Entrega" en su teléfono, guardando las coordenadas GPS.',
    impact: 'Orden liquidada en el sistema; el motorista queda con la remesa de efectivo a liquidar en bodega.',
    dataSummary: 'Cobrado: $34.00 USD en efectivo · Flete moto: $3.50 · Coordenadas: 13.6769, -89.2796 (Santa Tecla)'
  },
  {
    step: 8,
    title: 'Liquidación en Finanzas & Conciliación en Hoy Dashboard',
    sourceNodeId: 'finanzas_cashflow',
    targetNodeId: 'hoy_dashboard',
    eventType: 'finance.income.created',
    description: 'Al final de la tarde, Carlos liquida los $34.00 en caja. Finanzas asienta el ingreso y actualiza los indicadores del panel ejecutivo diario.',
    impact: 'Margen neto unitario generado: $18.50. La tasa de efectividad de entrega del día sube.',
    dataSummary: 'Ingreso Neto: +$34.00 · Costo Producto: $12.00 · Flete: $3.50 · Margen Bruto: $18.50'
  },
  {
    step: 9,
    title: 'Activación de Cohorte en Lucas LTV (Oferta Flash a 120 Días)',
    sourceNodeId: 'pedidos_core',
    targetNodeId: 'lucas_ciclo_vida',
    eventType: 'ltv.campaign_created',
    description: 'El motor predictivo detecta que Carla compró para un recién nacido. Agenda una regla para ofrecerle automáticamente un "Asistente de Caminado" en 120 días por WhatsApp.',
    impact: 'Eleva el Valor de Vida del Cliente (LTV) de $34.00 a un potencial de $90.00 con costo publicitario cero (CAC = $0).',
    dataSummary: 'Cohorte: Maternidad & Bebés · Siguiente Oferta: Asistente Caminado · Disparo Programado: 120 días'
  }
];
