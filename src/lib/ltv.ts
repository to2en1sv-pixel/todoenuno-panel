import { cleanPhone, formatPhoneDisplay, getBlacklistEntries } from './blacklist';
import { emitOsEvent } from './osEvents';
import { supabase } from './supabase';

/* ------------------------------------------------------------------ */
/* Tipos y Modelos de Datos para LTV & Fidelización                   */
/* ------------------------------------------------------------------ */

export type SegmentoRFM = 
  | 'vip_campeon'       // 2+ pedidos, ticket alto, 100% efectividad
  | 'comprador_fiel'    // 2+ pedidos exitosos
  | 'listo_cross_sell'  // 1 pedido exitoso, en ventana de 20 a 120 días
  | 'cliente_reciente'  // Compró hace menos de 20 días (fase de satisfacción/uso)
  | 'en_riesgo'         // Compró hace más de 120 días sin recompra
  | 'bloqueado';        // En lista negra o cancelaciones repetidas (excluido)

export interface HistorialProductoCliente {
  sku: string;
  nombre: string;
  fecha: string;
  monto: number;
  categoriaId: string;
}

export interface ClienteLtvProfile {
  telefono: string;
  telefonoDisplay: string;
  nombre: string;
  pedidosTotales: number;
  pedidosEntregados: number;
  pedidosCancelados: number;
  tasaEntrega: number;
  ltvTotal: number;
  ticketPromedio: number;
  primerPedido: string;
  ultimoPedido: string;
  diasDesdeUltimoPedido: number;
  productosComprados: HistorialProductoCliente[];
  categoriasCompradas: string[];
  categoriaPrincipal: string;
  segmentoRFM: SegmentoRFM;
  enListaNegra: boolean;
  proximaNecesidadEstimada?: SiguienteProductoRecomendado;
}

export interface SiguienteProductoRecomendado {
  categoriaId: string;
  categoriaNombre: string;
  diasRecomendados: number;
  maduroParaOferta: boolean;
  productoRecomendado: string;
  descripcion: string;
  precioRegular: number;
  precioFlash: number;
  razonLogica: string;
}

export interface CohorteCategoria {
  id: string;
  nombre: string;
  icono: string;
  descripcion: string;
  keywords: string[];
  diasMaduracion: number; // Días ideales después de la compra inicial para ofertar
  productoRecomendadoDefault: string;
  precioRegularDefault: number;
  precioFlashDefault: number;
  pitchCrossSell: string;
  totalClientes: number;
  clientesMaduros: number; // Aquellos cuyos días de compra ya alcanzaron la ventana
}

export interface CampanaOfertaFlash {
  id: string;
  titulo: string;
  categoriaId: string;
  categoriaNombre: string;
  productoOfertado: string;
  precioRegular: number;
  precioFlash: number;
  cuponCodigo: string;
  vigenciaHoras: number;
  enlaceImagen?: string;
  beneficioExtra: string;
  mensajePlantilla: string;
  totalDestinatarios: number;
  destinatariosEnviados: string[]; // Lista de teléfonos
  fechaCreacion: string;
  estado: 'activa' | 'finalizada' | 'borrador';
}

export interface MetricasLTVGlobales {
  totalClientesUnicos: number;
  clientesConRecompra: number;
  tasaRecompra: number; // Porcentaje (ej. 18.5%)
  ltvPromedio: number;  // $ promedio facturado por cliente
  ticketPromedioGeneral: number;
  clientesListosOferta: number;
  clientesVip: number;
  clientesExcluidosFraude: number;
  potencialVentasCrossSell: number; // Estimación $ si el 15% compra la oferta flash
}

/* ------------------------------------------------------------------ */
/* Matriz de Inteligencia de Categorías & Necesidad Futura            */
/* ------------------------------------------------------------------ */

export const CATEGORIAS_CROSS_SELL: Omit<CohorteCategoria, 'totalClientes' | 'clientesMaduros'>[] = [
  {
    id: 'maternidad_bebes',
    nombre: 'Maternidad & Primeros Pasos',
    icono: 'Baby',
    descripcion: 'Clientes que adquirieron portabebés, pañaleras o fajas postparto.',
    keywords: ['portabebe', 'porta bebe', 'bebe', 'maternidad', 'panalera', 'faja post', 'extractor'],
    diasMaduracion: 90, // A los 3-6 meses el bebé ya empieza a levantarse y gatear
    productoRecomendadoDefault: 'Asistente de Caminado Ergonómico + Gorro Anticaídas',
    precioRegularDefault: 22.00,
    precioFlashDefault: 14.99,
    pitchCrossSell: 'Tu bebé ya está en la etapa de dar sus primeros pasos. Este arnés evita caídas y protege su cabecita mientras gana confianza para caminar.'
  },
  {
    id: 'hogar_cocina',
    nombre: 'Hogar & Cocina Eficiente',
    icono: 'UtensilsCrossed',
    descripcion: 'Clientes que compraron picatodos, sartenes, organizadores o licuadoras portátiles.',
    keywords: ['picatodo', 'cocina', 'sarten', 'olla', 'organizador', 'dispensador', 'licuadora', 'cuchillo', 'molino'],
    diasMaduracion: 35,
    productoRecomendadoDefault: 'Sellador al Vacío de Alimentos + 10 Bolsas Térmicas',
    precioRegularDefault: 25.00,
    precioFlashDefault: 15.50,
    pitchCrossSell: 'Complementa tus utensilios de cocina manteniendo tus carnes, quesos y vegetales frescos hasta 5 veces más tiempo sin ocupar espacio en tu nevera.'
  },
  {
    id: 'belleza_cuidado',
    nombre: 'Belleza & Cuidado Personal',
    icono: 'Sparkles',
    descripcion: 'Clientes de depiladoras, cepillos secadores, rizadores o tratamientos faciales.',
    keywords: ['cepillo', 'secador', 'depiladora', 'facial', 'masajeador facial', 'cabello', 'maquillaje', 'skincare', 'crema'],
    diasMaduracion: 40,
    productoRecomendadoDefault: 'Kit Masajeador Facial Lifting EMS + Sérum Anti-Edad',
    precioRegularDefault: 24.00,
    precioFlashDefault: 16.00,
    pitchCrossSell: 'Potencia tu rutina de belleza con microcorrientes para reafirmar la piel del rostro y cuello desde la comodidad de tu casa.'
  },
  {
    id: 'tecnologia_gadgets',
    nombre: 'Tecnología & Gadgets',
    icono: 'Smartphone',
    descripcion: 'Clientes de Smartwatches, audífonos bluetooth, bocinas o accesorios móviles.',
    keywords: ['smartwatch', 'reloj', 'audifono', 'tws', 'bluetooth', 'bocina', 'tripode', 'gadget', 'soporte auto'],
    diasMaduracion: 30,
    productoRecomendadoDefault: 'Audífonos Inalámbricos Pro con Cancelación de Ruido + Powerbank',
    precioRegularDefault: 20.00,
    precioFlashDefault: 12.99,
    pitchCrossSell: 'El complemento ideal para tu reloj inteligente: audio de alta definición y batería de larga duración con envío contra entrega garantizado.'
  },
  {
    id: 'herramientas_auto',
    nombre: 'Auto & Herramientas Prácticas',
    icono: 'Wrench',
    descripcion: 'Clientes de compresores portátiles, aspiradoras para carro o pulidoras.',
    keywords: ['compresor', 'llanta', 'auto', 'carro', 'aspiradora', 'pulidora', 'herramienta', 'linterna', 'luz solar'],
    diasMaduracion: 45,
    productoRecomendadoDefault: 'Kit de Emergencia Vial 45 Piezas + Linterna LED Recargable',
    precioRegularDefault: 28.00,
    precioFlashDefault: 18.50,
    pitchCrossSell: 'Ten siempre la tranquilidad de estar preparado ante cualquier imprevisto en carretera con un kit compacto y de alta resistencia.'
  },
  {
    id: 'fitness_salud',
    nombre: 'Fitness, Salud & Alivio Muscular',
    icono: 'HeartPulse',
    descripcion: 'Clientes de pistolas de masaje, fajas térmicas, correctores de postura o bandas.',
    keywords: ['pistola masaje', 'faja', 'corrector', 'postura', 'fitness', 'ejercicio', 'rodillera', 'espalda', 'alivio'],
    diasMaduracion: 35,
    productoRecomendadoDefault: 'Electroestimulador TENS para Alivio de Dolores Lumbar y Cuello',
    precioRegularDefault: 23.00,
    precioFlashDefault: 15.00,
    pitchCrossSell: 'Elimina la tensión muscular y dolores de espalda después de una larga jornada de trabajo con impulsos terapéuticos relajantes.'
  }
];

/* ------------------------------------------------------------------ */
/* Funciones de Detección de Categoría y Cohortes                     */
/* ------------------------------------------------------------------ */

export function clasificarProductoEnCategoria(nombreProducto?: string | null): { id: string; nombre: string; icono: string } {
  if (!nombreProducto) {
    return { id: 'general', nombre: 'General & Multirubro', icono: 'Package' };
  }

  const normalizado = nombreProducto.toLowerCase();

  for (const cat of CATEGORIAS_CROSS_SELL) {
    if (cat.keywords.some(k => normalizado.includes(k))) {
      return { id: cat.id, nombre: cat.nombre, icono: cat.icono };
    }
  }

  return { id: 'general', nombre: 'General & Novedades', icono: 'Package' };
}

/* ------------------------------------------------------------------ */
/* Motor de Análisis de Clientes LTV & RFM                            */
/* ------------------------------------------------------------------ */

export function procesarPerfilesLtv(orders: any[]): {
  perfiles: ClienteLtvProfile[];
  metricas: MetricasLTVGlobales;
  cohortes: CohorteCategoria[];
} {
  const blacklist = getBlacklistEntries();
  const blacklistPhones = new Set(blacklist.map(b => cleanPhone(b.telefono)));

  const ahora = new Date();
  const phoneMap = new Map<string, {
    telefonoLimpio: string;
    nombre: string;
    pedidos: any[];
  }>();

  // 1. Agrupar órdenes por teléfono del cliente
  orders.forEach(o => {
    const clean = cleanPhone(o.telefono);
    if (!clean || clean.length < 8) return;

    if (!phoneMap.has(clean)) {
      phoneMap.set(clean, {
        telefonoLimpio: clean,
        nombre: o.nombre_cliente?.trim() || 'Cliente',
        pedidos: []
      });
    }

    const entry = phoneMap.get(clean)!;
    if (o.nombre_cliente?.trim() && (entry.nombre === 'Cliente' || entry.nombre.length < o.nombre_cliente.trim().length)) {
      entry.nombre = o.nombre_cliente.trim();
    }
    entry.pedidos.push(o);
  });

  // 2. Procesar el historial y métricas de cada cliente
  const perfiles: ClienteLtvProfile[] = [];

  phoneMap.forEach(({ telefonoLimpio, nombre, pedidos }) => {
    // Ordenar pedidos cronológicamente
    pedidos.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

    let entregados = 0;
    let cancelados = 0;
    let ltvTotal = 0;
    const productosComprados: HistorialProductoCliente[] = [];
    const categoriasSet = new Set<string>();

    pedidos.forEach(p => {
      const est = String(p.estado || '').toLowerCase();
      const monto = Number(p.total) || 0;
      const nombreProd = p.producto || p.sku || 'Producto TODOENUNO';
      const cat = clasificarProductoEnCategoria(nombreProd);

      if (est === 'entregado') {
        entregados++;
        ltvTotal += monto;
        categoriasSet.add(cat.id);
        productosComprados.push({
          sku: p.sku || '',
          nombre: nombreProd,
          fecha: p.created_at || '',
          monto,
          categoriaId: cat.id
        });
      } else if (est === 'cancelado') {
        cancelados++;
      }
    });

    const pedidosTotales = pedidos.length;
    const tasaEntrega = (entregados + cancelados) > 0 ? (entregados / (entregados + cancelados)) * 100 : (entregados > 0 ? 100 : 0);
    const ticketPromedio = entregados > 0 ? ltvTotal / entregados : 0;

    const primerPedido = pedidos[0]?.created_at || new Date().toISOString();
    const ultimoPedido = pedidos[pedidos.length - 1]?.created_at || new Date().toISOString();
    const diffMs = ahora.getTime() - new Date(ultimoPedido).getTime();
    const diasDesdeUltimoPedido = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));

    const enListaNegra = blacklistPhones.has(telefonoLimpio);

    // Determinar categoría principal
    let categoriaPrincipal = 'general';
    if (categoriasSet.size > 0) {
      categoriaPrincipal = Array.from(categoriasSet)[categoriasSet.size - 1]; // La más reciente
    }

    // Segmentación RFM
    let segmentoRFM: SegmentoRFM = 'cliente_reciente';

    if (enListaNegra || (cancelados >= 2 && entregados === 0)) {
      segmentoRFM = 'bloqueado';
    } else if (entregados >= 2 && ltvTotal >= 40 && cancelados === 0) {
      segmentoRFM = 'vip_campeon';
    } else if (entregados >= 2) {
      segmentoRFM = 'comprador_fiel';
    } else if (entregados === 1 && diasDesdeUltimoPedido >= 20 && diasDesdeUltimoPedido <= 120) {
      segmentoRFM = 'listo_cross_sell';
    } else if (entregados >= 1 && diasDesdeUltimoPedido > 120) {
      segmentoRFM = 'en_riesgo';
    } else if (entregados === 1 && diasDesdeUltimoPedido < 20) {
      segmentoRFM = 'cliente_reciente';
    } else {
      segmentoRFM = 'cliente_reciente';
    }

    // Calcular recomendación de siguiente producto
    const catConfig = CATEGORIAS_CROSS_SELL.find(c => c.id === categoriaPrincipal);
    let proximaNecesidadEstimada: SiguienteProductoRecomendado | undefined = undefined;

    if (catConfig && entregados > 0 && !enListaNegra) {
      proximaNecesidadEstimada = {
        categoriaId: catConfig.id,
        categoriaNombre: catConfig.nombre,
        diasRecomendados: catConfig.diasMaduracion,
        maduroParaOferta: diasDesdeUltimoPedido >= (catConfig.diasMaduracion * 0.7), // Al 70% del tiempo ya es idóneo
        productoRecomendado: catConfig.productoRecomendadoDefault,
        descripcion: catConfig.descripcion,
        precioRegular: catConfig.precioRegularDefault,
        precioFlash: catConfig.precioFlashDefault,
        razonLogica: catConfig.pitchCrossSell
      };
    }

    perfiles.push({
      telefono: telefonoLimpio,
      telefonoDisplay: formatPhoneDisplay(telefonoLimpio),
      nombre,
      pedidosTotales,
      pedidosEntregados: entregados,
      pedidosCancelados: cancelados,
      tasaEntrega,
      ltvTotal,
      ticketPromedio,
      primerPedido,
      ultimoPedido,
      diasDesdeUltimoPedido,
      productosComprados,
      categoriasCompradas: Array.from(categoriasSet),
      categoriaPrincipal,
      segmentoRFM,
      enListaNegra,
      proximaNecesidadEstimada
    });
  });

  // Ordenar perfiles por LTV descendente (los mejores clientes primero)
  perfiles.sort((a, b) => b.ltvTotal - a.ltvTotal);

  // 3. Procesar métricas globales
  const totalClientesUnicos = perfiles.length;
  const clientesConRecompra = perfiles.filter(p => p.pedidosEntregados >= 2).length;
  const tasaRecompra = totalClientesUnicos > 0 ? (clientesConRecompra / totalClientesUnicos) * 100 : 0;
  
  const totalLtvRecaudado = perfiles.reduce((acc, p) => acc + p.ltvTotal, 0);
  const ltvPromedio = totalClientesUnicos > 0 ? totalLtvRecaudado / totalClientesUnicos : 0;
  
  const entregadosTodos = perfiles.reduce((acc, p) => acc + p.pedidosEntregados, 0);
  const ticketPromedioGeneral = entregadosTodos > 0 ? totalLtvRecaudado / entregadosTodos : 0;

  const clientesListosOferta = perfiles.filter(p => 
    p.proximaNecesidadEstimada?.maduroParaOferta && 
    !p.enListaNegra && 
    (p.segmentoRFM === 'listo_cross_sell' || p.segmentoRFM === 'comprador_fiel' || p.segmentoRFM === 'vip_campeon')
  ).length;

  const clientesVip = perfiles.filter(p => p.segmentoRFM === 'vip_campeon').length;
  const clientesExcluidosFraude = perfiles.filter(p => p.enListaNegra || p.segmentoRFM === 'bloqueado').length;

  // Estimación conservadora: Si el 12% de los listos compran una oferta promedio de $15.00
  const potencialVentasCrossSell = clientesListosOferta * 0.12 * 15.00;

  const metricas: MetricasLTVGlobales = {
    totalClientesUnicos,
    clientesConRecompra,
    tasaRecompra,
    ltvPromedio,
    ticketPromedioGeneral,
    clientesListosOferta,
    clientesVip,
    clientesExcluidosFraude,
    potencialVentasCrossSell
  };

  // 4. Calcular cohortes agrupados
  const cohortes: CohorteCategoria[] = CATEGORIAS_CROSS_SELL.map(cat => {
    const clientesCat = perfiles.filter(p => p.categoriaPrincipal === cat.id && !p.enListaNegra && p.pedidosEntregados >= 1);
    const clientesMaduros = clientesCat.filter(p => p.diasDesdeUltimoPedido >= (cat.diasMaduracion * 0.65)).length;

    return {
      ...cat,
      totalClientes: clientesCat.length,
      clientesMaduros
    };
  });

  return { perfiles, metricas, cohortes };
}

/* ------------------------------------------------------------------ */
/* Gestión de Campañas de Ofertas Flash en LocalStorage + Supabase    */
/* ------------------------------------------------------------------ */

const STORAGE_CAMPANAS_KEY = 'cod_ltv_flash_campaigns_db';

export function getCampanasFlash(): CampanaOfertaFlash[] {
  try {
    const raw = localStorage.getItem(STORAGE_CAMPANAS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

export function guardarCampanaFlash(campana: Omit<CampanaOfertaFlash, 'id' | 'fechaCreacion'>): CampanaOfertaFlash {
  const actual = getCampanasFlash();
  const nueva: CampanaOfertaFlash = {
    ...campana,
    id: `camp_${Date.now()}`,
    fechaCreacion: new Date().toISOString()
  };

  actual.unshift(nueva);
  localStorage.setItem(STORAGE_CAMPANAS_KEY, JSON.stringify(actual));
  window.dispatchEvent(new Event('ltv_campaigns_updated'));

  // Emitir evento al Event Stream del OS
  try {
    emitOsEvent({
      type: 'ltv.campaign_created',
      source_table: 'ltv_campaigns',
      source_id: nueva.id,
      payload: {
        titulo: nueva.titulo,
        categoria: nueva.categoriaNombre,
        producto: nueva.productoOfertado,
        precioFlash: nueva.precioFlash,
        totalDestinatarios: nueva.totalDestinatarios
      }
    });
  } catch {}

  return nueva;
}

export function marcarDestinatarioEnviado(campanaId: string, telefono: string): void {
  const clean = cleanPhone(telefono);
  const actual = getCampanasFlash();
  const camp = actual.find(c => c.id === campanaId);
  if (!camp) return;

  if (!camp.destinatariosEnviados.includes(clean)) {
    camp.destinatariosEnviados.push(clean);
    localStorage.setItem(STORAGE_CAMPANAS_KEY, JSON.stringify(actual));
    window.dispatchEvent(new Event('ltv_campaigns_updated'));

    try {
      emitOsEvent({
        type: 'ltv.offer_dispatched',
        source_table: 'ltv_campaigns',
        source_id: campanaId,
        payload: {
          telefono: clean,
          campana: camp.titulo,
          producto: camp.productoOfertado
        }
      });
    } catch {}
  }
}

/* ------------------------------------------------------------------ */
/* Generador de Mensaje de WhatsApp para Ofertas Flash                */
/* ------------------------------------------------------------------ */

export function generarMensajeOfertaFlash(params: {
  nombreCliente: string;
  productoOfertado: string;
  productoAnterior?: string;
  precioRegular: number;
  precioFlash: number;
  cuponCodigo: string;
  vigenciaHoras?: number;
  beneficioExtra?: string;
  pitchPersonalizado?: string;
}): string {
  const {
    nombreCliente,
    productoOfertado,
    productoAnterior,
    precioRegular,
    precioFlash,
    cuponCodigo,
    vigenciaHoras = 48,
    beneficioExtra = 'Envío Gratis a todo El Salvador (Pago Contra Entrega)',
    pitchPersonalizado
  } = params;

  const ahorro = Math.max(0, precioRegular - precioFlash).toFixed(2);
  const mencioAnterior = productoAnterior
    ? `Sabemos que anteriormente confiaste en nosotros con tu *${productoAnterior}*, y hoy queremos recompensar tu preferencia:`
    : `Como parte de nuestro selecto grupo de clientes preferenciales en El Salvador, hoy queremos recompensar tu lealtad:`;

  const pitchTexto = pitchPersonalizado ? `\n💡 *¿Por qué te encantará?*\n${pitchPersonalizado}\n` : '';

  return (
`✨ *TODOENUNO — VENTA PRIVADA EXCLUSIVA PARA CLIENTES VIP* ✨

Hola *${nombreCliente}*, ¡es un placer saludarte! 👋

${mencioAnterior}

🔥 *OFERTA FLASH EXCLUSIVA:*
📦 *${productoOfertado}*
${pitchTexto}
🏷️ *Precio Regular:* ~$${precioRegular.toFixed(2)}~
💥 *Tu Precio Especial VIP:* *$${precioFlash.toFixed(2)} USD*
🎁 *Ahorro Inmediato:* *$${ahorro} USD*
🚚 *Beneficio:* ${beneficioExtra}

⏳ *Condiciones:*
• Oferta válida únicamente por las próximas *${vigenciaHoras} horas*.
• Cupón asignado a tu número: *${cuponCodigo}*
• Modalidad: *Pagas en efectivo al recibir en tu puerta*.

👉 *¿Deseas que te apartemos una unidad y programemos tu entrega?* 
Solo responde *"SÍ, QUIERO MI OFERTA"* y confirmamos tu dirección de despacho.`
  );
}
