import type { BrainNode, BrainConnection, SimulationStep } from '@/types/brain';

// Dimensiones de referencia del canvas virtual (1200 x 800)
export const BRAIN_CANVAS_WIDTH = 1200;
export const BRAIN_CANVAS_HEIGHT = 760;
export const BRAIN_CENTER_X = 600;
export const BRAIN_CENTER_Y = 380;

export const INITIAL_BRAIN_NODES: BrainNode[] = [
  {
    id: 'core_memory',
    label: 'OS MEMORY',
    subtitle: 'Kernel Central & Event Bus',
    domain: 'core',
    status: 'completed',
    x: 600,
    y: 380,
    radius: 54,
    iconName: 'Cpu',
    description: 'Núcleo bio-digital central de TODOENUNO OS. Orquesta el estado compartido, la inmutabilidad de eventos en PostgreSQL y el enrutamiento sináptico entre todos los módulos.',
    completionPercentage: 100,
    health: 99,
    route: '/event-stream',
    subActions: [
      { id: 'ca-1', name: 'Almacén Inmutable de Eventos', description: 'Registro append-only con idempotencia estricta en os.events.', status: 'active', outputEvent: 'system.heartbeat' },
      { id: 'ca-2', name: 'Realtime Pub/Sub Channel', description: 'Transmisión inmediata de cambios a clientes conectados.', status: 'active' },
      { id: 'ca-3', name: 'Consumo por Proyecciones', description: 'Actualización en cascada de inventario, saldos y métricas.', status: 'active' },
      { id: 'ca-4', name: 'Triggers de Automatización', description: 'Disparadores de eventos ante cambios de estado de pedidos.', status: 'active' }
    ],
    supportedEvents: ['system.heartbeat', 'system.test']
  },
  {
    id: 'todd_venta',
    label: 'Todd Venta',
    subtitle: 'Bot de Cierre & Leads',
    domain: 'sales',
    status: 'completed',
    x: 340,
    y: 200,
    radius: 44,
    iconName: 'Bot',
    description: 'Agente conversacional especializado en cerrar ventas B2C en WhatsApp y Messenger. Califica intención de compra, recopila dirección en El Salvador y prepara el carrito COD.',
    completionPercentage: 92,
    health: 96,
    route: '/unichat',
    subActions: [
      { id: 'tv-1', name: 'Captación de Prospectos Ads', description: 'Inicia conversación vinculada al código de anuncio de Meta Ads.', status: 'active', outputEvent: 'lead.generated' },
      { id: 'tv-2', name: 'Negociación & Preguntas Frecuentes', description: 'Responde dudas de producto, precios y garantía en El Salvador.', status: 'active', outputEvent: 'chat.message.sent' },
      { id: 'tv-3', name: 'Recopilación de Dirección COD', description: 'Estructura departamento, municipio, colonia y punto de referencia.', status: 'active' },
      { id: 'tv-4', name: 'Pre-orden y Enlace a Pedidos', description: 'Transfiere la orden confirmada al pipeline de empaques.', status: 'active', outputEvent: 'order.created' }
    ],
    supportedEvents: ['chat.message.received', 'chat.message.sent', 'lead.generated', 'chat.bot.toggled']
  },
  {
    id: 'pedidos_core',
    label: 'Pedidos',
    subtitle: 'Pipeline & Checkout COD',
    domain: 'orders',
    status: 'completed',
    x: 600,
    y: 150,
    radius: 46,
    iconName: 'ShoppingBag',
    description: 'Columna vertebral transaccional. Gestiona estados de la orden (Nuevo ➔ Por Empacar ➔ En Camino ➔ Entregado) con soporte para pagos contra entrega y remesas.',
    completionPercentage: 98,
    health: 98,
    route: '/pedidos',
    subActions: [
      { id: 'pd-1', name: 'Recepción Centralizada COD', description: 'Consolida órdenes de WhatsApp, Meta, TikTok y tienda.', status: 'active', outputEvent: 'order.created' },
      { id: 'pd-2', name: 'Confirmación y Clasificación', description: 'Pasa a estado confirmado y programa ventana de entrega.', status: 'active', outputEvent: 'order.confirmed' },
      { id: 'pd-3', name: 'Auditoría Cruzada Antifraude', description: 'Cruza el número con DICOM antes de autorizar flete.', status: 'active' },
      { id: 'pd-4', name: 'Cierre de Orden y Facturación', description: 'Asienta total recaudado y comisiones de repartidor.', status: 'active', outputEvent: 'order.delivered' }
    ],
    supportedEvents: ['order.created', 'order.confirmed', 'order.shipped', 'order.delivered', 'order.cancelled', 'order.scheduled']
  },
  {
    id: 'dicom_interno',
    label: 'DICOM Interno',
    subtitle: 'Antifraude & Lista Negra',
    domain: 'antifraud',
    status: 'in_progress',
    x: 880,
    y: 200,
    radius: 45,
    iconName: 'ShieldCheck',
    description: 'Sistema de inteligencia de riesgo comercial en El Salvador. Detecta clientes reincidentes que rechazan pedidos en puerta y genera boletas formales con evidencia en WhatsApp.',
    completionPercentage: 88,
    health: 94,
    route: '/analitica',
    subActions: [
      { id: 'dc-1', name: 'Scoring Telefónico Antifraude', description: 'Verifica historial de 8 dígitos de El Salvador al entrar orden.', status: 'active', outputEvent: 'customer.whitelisted' },
      { id: 'dc-2', name: 'Boletín de Incumplimiento', description: 'Registra motivo (no atendió, flete perdido, dirección falsa).', status: 'active', outputEvent: 'customer.blacklisted' },
      { id: 'dc-3', name: 'Notificación Clickeable WhatsApp', description: 'Genera mensaje oficial con producto ordenado, dirección y fotos.', status: 'active', outputEvent: 'customer.notified' },
      { id: 'dc-4', name: 'Exclusión Automática de LTV', description: 'Bloquea a usuarios con mal score de recibir ofertas promocionales.', status: 'active' }
    ],
    supportedEvents: ['customer.blacklisted', 'customer.whitelisted', 'customer.notified']
  },
  {
    id: 'reloj_despacho',
    label: 'Reloj Despacho',
    subtitle: 'Ventana de Corte 2:00 PM',
    domain: 'dispatch',
    status: 'in_progress',
    x: 960,
    y: 360,
    radius: 42,
    iconName: 'Clock',
    description: 'Control de cadencia temporal operativa. Cronometra la ventana de corte de las 2:00 PM para asegurar que los pedidos salgan en las rutas departamentales y urbanas del día.',
    completionPercentage: 75,
    health: 90,
    route: '/pedidos',
    subActions: [
      { id: 'rd-1', name: 'Cuenta Regresiva de Corte Diario', description: 'Sincroniza a picking para empacar antes de la llegada de mensajerías.', status: 'active' },
      { id: 'rd-2', name: 'Agrupación de Rutas por Zona', description: 'Separa San Salvador Centro, La Libertad, Santa Ana y Oriente.', status: 'in_progress' },
      { id: 'rd-3', name: 'Asignación de Guías de Despacho', description: 'Genera manifiesto de entrega para los motoristas.', status: 'in_progress', outputEvent: 'order.scheduled' }
    ],
    supportedEvents: ['order.scheduled', 'order.shipped']
  },
  {
    id: 'motos_logistica',
    label: 'Motos & Logística',
    subtitle: 'Última Milla & Entregas',
    domain: 'delivery',
    status: 'active_dev',
    x: 880,
    y: 560,
    radius: 44,
    iconName: 'Truck',
    description: 'Red de distribución física de última milla. Los motoristas utilizan el portal móvil `/entregar` para reportar entregas en vivo, geo-confirmaciones y cobro en efectivo.',
    completionPercentage: 65,
    health: 85,
    route: '/entregar',
    subActions: [
      { id: 'ml-1', name: 'Portal Móvil de Repartidor', description: 'Interfaz ligera táctil sin login para marcar entrega en ruta.', status: 'active' },
      { id: 'ml-2', name: 'Confirmación Geolocalizada', description: 'Registra coordenadas GPS y foto de comprobante de entrega.', status: 'active', outputEvent: 'order.delivered' },
      { id: 'ml-3', name: 'Liquidación Diaria de Remesas', description: 'Audita el efectivo en mano cobrado en puerta.', status: 'in_progress', outputEvent: 'finance.income.created' },
      { id: 'ml-4', name: 'Reporte Inmediato de Rechazo', description: 'Notifica al instante si el cliente no recibió el paquete.', status: 'active', outputEvent: 'order.cancelled' }
    ],
    supportedEvents: ['order.shipped', 'order.delivered', 'order.cancelled']
  },
  {
    id: 'proveedores_b2b',
    label: 'Proveedores',
    subtitle: 'Licitaciones & Suministro',
    domain: 'suppliers',
    status: 'completed',
    x: 720,
    y: 620,
    radius: 43,
    iconName: 'Store',
    description: 'Portal de abastecimiento mayorista y licitaciones masivas. Publica requerimientos de stock a importadores y transportistas con subasta inversa.',
    completionPercentage: 90,
    health: 95,
    route: '/proveedores',
    subActions: [
      { id: 'pr-1', name: 'Lanzamiento de Licitación Masiva', description: 'Genera cotizaciones simultáneas a proveedores registrados.', status: 'active', outputEvent: 'purchase.requested' },
      { id: 'pr-2', name: 'Recepción de Bids por WhatsApp', description: 'Procesa ofertas de precio unitario y tiempos de entrega.', status: 'active', outputEvent: 'supplier.bid.received' },
      { id: 'pr-3', name: 'Selección Automática de Menor Costo', description: 'Adjudica la orden de compra al proveedor óptimo.', status: 'active', outputEvent: 'supplier.selected' }
    ],
    supportedEvents: ['supplier.created', 'purchase.requested', 'supplier.bid.received', 'supplier.selected']
  },
  {
    id: 'empaques_stock',
    label: 'Empaques',
    subtitle: 'Picking & Bodega',
    domain: 'packaging',
    status: 'in_progress',
    x: 520,
    y: 620,
    radius: 43,
    iconName: 'PackageCheck',
    description: 'Gestión física del almacén y preparación de paquetes. Imprime etiquetas térmicas con datos del destinatario y deduce automáticamente el inventario.',
    completionPercentage: 80,
    health: 92,
    route: '/cola',
    subActions: [
      { id: 'ep-1', name: 'Cola de Picking Prioritaria', description: 'Ordena paquetes por urgencia y hora de salida de ruta.', status: 'active' },
      { id: 'ep-2', name: 'Deducción de Inventario en Bodega', description: 'Resta existencias físicas al confirmar el empaque.', status: 'active', outputEvent: 'inventory.adjustment' },
      { id: 'ep-3', name: 'Impresión de Guía Térmica', description: 'Genera sticker con código de barras y monto a cobrar en puerta.', status: 'in_progress' }
    ],
    supportedEvents: ['inventory.adjustment', 'product.updated', 'order.confirmed']
  },
  {
    id: 'docs_roadmap',
    label: 'Docs Roadmap',
    subtitle: 'Arquitectura & Sprints',
    domain: 'docs',
    status: 'future',
    x: 320,
    y: 600,
    radius: 40,
    iconName: 'FileText',
    description: 'Memoria técnica institucional, contratos de datos, scripts SQL de migración y documentación viva del sistema para escalar a nivel corporativo.',
    completionPercentage: 50,
    health: 80,
    route: '/docs',
    subActions: [
      { id: 'dr-1', name: 'Catálogo de Esquemas SQL', description: 'Repositorio de migraciones idempotentes de Supabase.', status: 'active' },
      { id: 'dr-2', name: 'Manuales Operativos de Puesto', description: 'Guías para operadores de WhatsApp, bodega y motoristas.', status: 'in_progress' },
      { id: 'dr-3', name: 'Bitácora de Sprints de Ingeniería', description: 'Registro de evolución de TODOENUNO OS.', status: 'active' }
    ],
    supportedEvents: ['system.test']
  },
  {
    id: 'lucas_ciclo_vida',
    label: 'Lucas Ciclo de Vida',
    subtitle: 'LTV & Fidelización',
    domain: 'lifecycle',
    status: 'in_progress',
    x: 240,
    y: 470,
    radius: 45,
    iconName: 'Zap',
    description: 'Motor predictivo de retención de clientes. Analiza qué compró el cliente y programa ofertas flash de productos complementarios según la etapa de su necesidad futura.',
    completionPercentage: 85,
    health: 95,
    route: '/ltv',
    subActions: [
      { id: 'lc-1', name: 'Segmentación RFM de Compradores', description: 'Clasifica en VIPs, compradores fieles, en riesgo y nuevos.', status: 'active' },
      { id: 'lc-2', name: 'Matriz Predictiva de Cross-Sell', description: 'Calcula el siguiente producto natural según categoría.', status: 'active', outputEvent: 'ltv.campaign_created' },
      { id: 'lc-3', name: 'Lanzador de Ofertas Flash WhatsApp', description: 'Crea campañas con cupón único, descuento y reloj de 48h.', status: 'active', outputEvent: 'ltv.offer_dispatched' },
      { id: 'lc-4', name: 'Filtro de Exclusión DICOM', description: 'Impide enviar ofertas a personas en la lista negra.', status: 'active' }
    ],
    supportedEvents: ['ltv.campaign_created', 'ltv.offer_dispatched']
  },
  {
    id: 'porta_bebes_nicho',
    label: 'Porta Bebés & Nichos',
    subtitle: 'Cohortes de Producto',
    domain: 'niche',
    status: 'completed',
    x: 200,
    y: 330,
    radius: 41,
    iconName: 'Sparkles',
    description: 'Punto de anclaje de clientes de alto valor. Un cliente que compra un porta bebés es una familia en etapa de crecimiento con un LTV potencial a 24 meses.',
    completionPercentage: 95,
    health: 98,
    route: '/catalogo',
    subActions: [
      { id: 'pb-1', name: 'Registro de Cohorte Inicial', description: 'Captura el producto ancla y fecha de nacimiento estimada.', status: 'active' },
      { id: 'pb-2', name: 'Disparador de Caminador Infantil', description: 'A los 3-6 meses emite recomendación de asistente de caminado.', status: 'active', outputEvent: 'ltv.campaign_created' },
      { id: 'pb-3', name: 'Monitoreo de Margen por Nicho', description: 'Compara rentabilidad entre bebés, hogar y belleza.', status: 'active' }
    ],
    supportedEvents: ['product.created', 'product.updated']
  },
  {
    id: 'os_events_bus',
    label: 'OS Events',
    subtitle: 'Stream en Tiempo Real',
    domain: 'events',
    status: 'completed',
    x: 200,
    y: 160,
    radius: 41,
    iconName: 'Activity',
    description: 'Monitor visual del flujo inmutable de eventos. Muestra la telemetría en tiempo real de todos los hechos ocurridos en la operación comercial.',
    completionPercentage: 100,
    health: 100,
    route: '/event-stream',
    subActions: [
      { id: 'ev-1', name: 'Escucha en Tiempo Real Supabase', description: 'Suscripción por WebSockets mediante Supabase Realtime.', status: 'active' },
      { id: 'ev-2', name: 'Filtros Multidominio', description: 'Segmenta por pedidos, chat, antifraude, finanzas y LTV.', status: 'active' },
      { id: 'ev-3', name: 'Simulador de Hechos', description: 'Permite inyectar eventos de prueba con payload tipado.', status: 'active' }
    ],
    supportedEvents: ['system.heartbeat', 'system.test']
  },
  {
    id: 'finanzas_cashflow',
    label: 'Finanzas COD',
    subtitle: 'Efectivo & Rentabilidad',
    domain: 'finance',
    status: 'completed',
    x: 420,
    y: 490,
    radius: 43,
    iconName: 'Wallet',
    description: 'Gestor del flujo de caja contra entrega. Concilia el efectivo liquidado por repartidores contra el flete real pagado y el costo de adquisición publicitaria (CAC).',
    completionPercentage: 90,
    health: 96,
    route: '/finanzas',
    subActions: [
      { id: 'fn-1', name: 'Liquidación de Efectivo por Repartidor', description: 'Cierra caja diaria conciliando pedidos entregados vs efectivo.', status: 'active', outputEvent: 'finance.income.created' },
      { id: 'fn-2', name: 'Auditoría de Costo de Flete', description: 'Deduce fletes pagados tanto en entregas como en devoluciones.', status: 'active', outputEvent: 'finance.expense.created' },
      { id: 'fn-3', name: 'Cálculo de Margen Neto Unitario', description: 'Muestra ganancia neta en dólares por SKU y por campaña.', status: 'active' }
    ],
    supportedEvents: ['finance.income.created', 'finance.expense.created']
  }
];

export const INITIAL_BRAIN_CONNECTIONS: BrainConnection[] = [
  // Core radial connections (OS Memory hub)
  { id: 'c-core-todd', from: 'core_memory', to: 'todd_venta', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-pedidos', from: 'core_memory', to: 'pedidos_core', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-dicom', from: 'core_memory', to: 'dicom_interno', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-reloj', from: 'core_memory', to: 'reloj_despacho', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-motos', from: 'core_memory', to: 'motos_logistica', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-prov', from: 'core_memory', to: 'proveedores_b2b', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-empaques', from: 'core_memory', to: 'empaques_stock', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-docs', from: 'core_memory', to: 'docs_roadmap', flowType: 'core_sync', bandwidth: 'low', animated: false },
  { id: 'c-core-lucas', from: 'core_memory', to: 'lucas_ciclo_vida', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-porta', from: 'core_memory', to: 'porta_bebes_nicho', flowType: 'core_sync', bandwidth: 'medium', animated: true },
  { id: 'c-core-events', from: 'core_memory', to: 'os_events_bus', flowType: 'core_sync', bandwidth: 'high', animated: true },
  { id: 'c-core-finanzas', from: 'core_memory', to: 'finanzas_cashflow', flowType: 'core_sync', bandwidth: 'high', animated: true },

  // Operational pipeline synapses (Inter-module workflows)
  // 1. Sales & Order Intake Flow
  { id: 'c-todd-pedidos', from: 'todd_venta', to: 'pedidos_core', label: 'Cierre Lead ➔ Pedido COD', flowType: 'sales_flow', bandwidth: 'high', animated: true },
  { id: 'c-pedidos-dicom', from: 'pedidos_core', to: 'dicom_interno', label: 'Verificación Antifraude', flowType: 'sales_flow', bandwidth: 'high', animated: true },
  { id: 'c-dicom-pedidos', from: 'dicom_interno', to: 'pedidos_core', label: 'Score Aprobado / Rechazado', flowType: 'sales_flow', bandwidth: 'medium', animated: true },

  // 2. Fulfillment & Logistics Flow
  { id: 'c-pedidos-empaques', from: 'pedidos_core', to: 'empaques_stock', label: 'Orden Confirmada ➔ Picking', flowType: 'fulfillment_flow', bandwidth: 'high', animated: true },
  { id: 'c-empaques-reloj', from: 'empaques_stock', to: 'reloj_despacho', label: 'Corte 2:00 PM', flowType: 'fulfillment_flow', bandwidth: 'high', animated: true },
  { id: 'c-reloj-motos', from: 'reloj_despacho', to: 'motos_logistica', label: 'Despacho a Ruta', flowType: 'fulfillment_flow', bandwidth: 'high', animated: true },
  { id: 'c-motos-finanzas', from: 'motos_logistica', to: 'finanzas_cashflow', label: 'Remesa de Efectivo Cobrado', flowType: 'fulfillment_flow', bandwidth: 'high', animated: true },

  // 3. Customer Retention & LTV Flow
  { id: 'c-motos-pedidos', from: 'motos_logistica', to: 'pedidos_core', label: 'Marcado Entregado', flowType: 'fulfillment_flow', bandwidth: 'medium', animated: true },
  { id: 'c-pedidos-porta', from: 'pedidos_core', to: 'porta_bebes_nicho', label: 'Compra Producto Ancla', flowType: 'retention_flow', bandwidth: 'medium', animated: true },
  { id: 'c-porta-lucas', from: 'porta_bebes_nicho', to: 'lucas_ciclo_vida', label: 'Tiempo Transcurrido (180 días)', flowType: 'retention_flow', bandwidth: 'high', animated: true },
  { id: 'c-lucas-dicom', from: 'lucas_ciclo_vida', to: 'dicom_interno', label: 'Filtro Anti-Morosos', flowType: 'retention_flow', bandwidth: 'medium', animated: true },
  { id: 'c-lucas-todd', from: 'lucas_ciclo_vida', to: 'todd_venta', label: 'Disparo de Oferta Flash', flowType: 'retention_flow', bandwidth: 'high', animated: true },

  // 4. Supply Chain Flow
  { id: 'c-empaques-prov', from: 'empaques_stock', to: 'proveedores_b2b', label: 'Alerta Stock Crítico', flowType: 'supply_flow', bandwidth: 'medium', animated: true },
  { id: 'c-prov-empaques', from: 'proveedores_b2b', to: 'empaques_stock', label: 'Reabastecimiento Contenedor', flowType: 'supply_flow', bandwidth: 'medium', animated: true },
  { id: 'c-prov-finanzas', from: 'proveedores_b2b', to: 'finanzas_cashflow', label: 'Pago a Proveedor', flowType: 'supply_flow', bandwidth: 'medium', animated: true }
];

export const COD_SIMULATION_STEPS: SimulationStep[] = [
  {
    step: 1,
    title: 'Lead Entrante de Facebook / WhatsApp',
    sourceNodeId: 'todd_venta',
    targetNodeId: 'pedidos_core',
    eventType: 'lead.generated',
    description: 'El cliente ve un anuncio de Porta Bebés Ergonómico y hace clic en el enlace de WhatsApp. Bot Todd atiende al instante, cotiza flete a Santa Tecla y obtiene la dirección.',
    impact: 'Se califica al comprador y se recopilan datos de contacto para El Salvador.',
    dataSummary: 'Cliente: Carla Hernández · Teléfono: 7458-1290 · SKU: PORTA-BEBE-ERG-01 · Total: $34.00'
  },
  {
    step: 2,
    title: 'Verificación Antifraude & Score Telefónico',
    sourceNodeId: 'pedidos_core',
    targetNodeId: 'dicom_interno',
    eventType: 'customer.whitelisted',
    description: 'El sistema consulta la base de datos de DICOM Interno. El número 7458-1290 no tiene reportes de paquetes botados ni direcciones falsas.',
    impact: 'Score: 98/100 (Bajo Riesgo). Se autoriza el despacho con pago contra entrega sin solicitar adelanto.',
    dataSummary: 'Resultado: APROBADO · Incidentes previos: 0 · Flete sugerido: $3.50'
  },
  {
    step: 3,
    title: 'Registro de Orden COD & Reserva de Stock',
    sourceNodeId: 'pedidos_core',
    targetNodeId: 'empaques_stock',
    eventType: 'order.created',
    description: 'Se emite la orden oficial PED-9142 con estado "nuevo". El módulo de Empaques descuenta 1 unidad del inventario físico en bodega.',
    impact: 'Inventario físico protegido contra sobreventa; se imprime guía con sticker térmico.',
    dataSummary: 'Orden: PED-9142 · Estado: confirmado · Stock restante: 14 uds'
  },
  {
    step: 4,
    title: 'Ventana de Corte 2:00 PM & Picking',
    sourceNodeId: 'empaques_stock',
    targetNodeId: 'reloj_despacho',
    eventType: 'order.scheduled',
    description: 'El paquete es empacado y clasificado en la canasta de la ruta "La Libertad / Santa Tecla" antes del corte de las 2:00 PM.',
    impact: 'Garantiza entrega en menos de 24 horas hábiles.',
    dataSummary: 'Ruta: Santa Tecla Zona 1 · Courier: Motorista Carlos · Manifiesto: #RT-08'
  },
  {
    step: 5,
    title: 'Despacho a Motorista y Ruta de Entrega',
    sourceNodeId: 'reloj_despacho',
    targetNodeId: 'motos_logistica',
    eventType: 'order.shipped',
    description: 'El motorista recibe la lista en su portal móvil `/entregar`. Se desplaza a la colonia y llama al cliente para coordinar recepción.',
    impact: 'El cliente recibe aviso de WhatsApp con link para rastreo en tiempo real.',
    dataSummary: 'Estado: en_camino · Repartidor asignado: Carlos M. · Hora salida: 2:15 PM'
  },
  {
    step: 6,
    title: 'Entrega en Puerta & Cobro de $34.00 Efectivo',
    sourceNodeId: 'motos_logistica',
    targetNodeId: 'finanzas_cashflow',
    eventType: 'order.delivered',
    description: 'Carlos entrega el porta bebés en mano, recibe $34.00 en efectivo y presiona "Confirmar Entrega" en su teléfono.',
    impact: 'La orden queda liquidada; se asienta ingreso en finanzas y se descuenta comisión de flete.',
    dataSummary: 'Cobrado: $34.00 USD · Flete moto: $3.50 · Margen bruto generado: $18.50'
  },
  {
    step: 7,
    title: 'Activación de Cohorte LTV (Futura Oferta Flash)',
    sourceNodeId: 'pedidos_core',
    targetNodeId: 'porta_bebes_nicho',
    eventType: 'ltv.campaign_created',
    description: 'El módulo LTV detecta que la clienta compró para un recién nacido. Agenda automáticamente una regla predictiva para ofrecerle un "Asistente de Caminado" en 120 días.',
    impact: 'Multiplica el Valor de Vida del Cliente (LTV) de $34.00 a un potencial de $90.00 sin costo publicitario.',
    dataSummary: 'Cohorte: Maternidad & Bebés · Siguiente oferta: Asistente Caminado · Descuento futuro: 20%'
  }
];
