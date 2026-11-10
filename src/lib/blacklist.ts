import { emitOsEvent } from './osEvents';

export interface BlacklistEntry {
  telefono: string;          // 8 dígitos limpios (ej. 71234567)
  telefonoDisplay: string;   // Formato con código (+503 7123-4567)
  nombreCliente: string;
  aliasNombres: string[];
  motivo: string;
  severidad: 'alta' | 'media' | 'baja';
  reportadoPor: string;      // "Motorista Central 1", "Administración", etc.
  fecha: string;
  pedidoId?: string | null;
  activo: boolean;
}

export interface CustomerRiskEvaluation {
  telefonoLimpio: string;
  telefonoDisplay: string;
  nivelRiesgo: 'rojo' | 'amarillo' | 'verde' | 'neutro';
  score: number;             // 0 a 100 (100 = máxima confianza, 0 = fraude/bloqueado)
  etiqueta: string;
  enListaNegra: boolean;
  motivoListaNegra: string | null;
  severidadListaNegra?: 'alta' | 'media' | 'baja';
  reportadoPor?: string;
  totalPedidos: number;
  entregados: number;
  cancelados: number;
  tasaEntrega: number;
  motivosCancelacion: string[];
  nombresConocidos: string[];
  recomendacion: string;
  alertaMensaje: string | null;
}

const STORAGE_KEY = 'cod_client_blacklist_db';

// Normaliza cualquier string de teléfono a los últimos 8 dígitos numéricos de El Salvador
export function cleanPhone(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 8) {
    // Si viene con 503 delante (ej. 50371234567), tomar los últimos 8
    return digits.slice(-8);
  }
  return digits;
}

// Formatea los 8 dígitos limpios a formato estándar salvadoreño (+503 XXXX-XXXX)
export function formatPhoneDisplay(clean: string): string {
  if (!clean || clean.length < 8) return clean || 'Sin teléfono';
  const c = clean.slice(-8);
  return `+503 ${c.slice(0, 4)}-${c.slice(4)}`;
}

// Carga las entradas manuales de la lista negra desde localStorage con fallback inicial de prevención
export function getBlacklistEntries(): BlacklistEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(item => item.activo !== false);
    }
  } catch (err) {
    console.warn('Error leyendo blacklist de localStorage:', err);
  }
  return [];
}

// Agrega o actualiza un cliente en la lista negra
export function addOrUpdateBlacklist(entry: Omit<BlacklistEntry, 'telefonoDisplay' | 'activo'> & { activo?: boolean }): BlacklistEntry {
  const telefonoLimpio = cleanPhone(entry.telefono);
  if (!telefonoLimpio) throw new Error('El teléfono es requerido para boletinar al cliente.');

  const actual = getBlacklistEntries();
  const index = actual.findIndex(e => cleanPhone(e.telefono) === telefonoLimpio);

  const nuevaEntrada: BlacklistEntry = {
    ...entry,
    telefono: telefonoLimpio,
    telefonoDisplay: formatPhoneDisplay(telefonoLimpio),
    activo: entry.activo ?? true,
    aliasNombres: Array.from(new Set([entry.nombreCliente, ...(entry.aliasNombres || [])])).filter(Boolean)
  };

  if (index >= 0) {
    actual[index] = {
      ...actual[index],
      ...nuevaEntrada,
      aliasNombres: Array.from(new Set([...(actual[index].aliasNombres || []), ...nuevaEntrada.aliasNombres]))
    };
  } else {
    actual.unshift(nuevaEntrada);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(actual));

  // Emitir evento al sistema operativo
  try {
    emitOsEvent({
      type: 'customer.blacklisted',
      source_table: 'whatsapp_orders',
      source_id: entry.pedidoId || telefonoLimpio,
      payload: {
        telefono: telefonoLimpio,
        nombre: entry.nombreCliente,
        motivo: entry.motivo,
        reportadoPor: entry.reportadoPor
      }
    });
  } catch {}

  return nuevaEntrada;
}

// Remueve o rehabilita un cliente de la lista negra
export function removeBlacklistEntry(telefono: string): boolean {
  const clean = cleanPhone(telefono);
  if (!clean) return false;

  const actual = getBlacklistEntries();
  const filtrados = actual.filter(e => cleanPhone(e.telefono) !== clean);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtrados));

  try {
    emitOsEvent({
      type: 'customer.whitelisted',
      source_table: 'whatsapp_orders',
      source_id: clean,
      payload: { telefono: clean }
    });
  } catch {}

  return true;
}

// Evalúa el score y nivel de riesgo de un cliente cruzando órdenes pasadas + lista negra
export function evaluateCustomerRisk(
  rawPhone: string | null | undefined,
  allOrders: any[] = []
): CustomerRiskEvaluation {
  const telefonoLimpio = cleanPhone(rawPhone);
  const display = formatPhoneDisplay(telefonoLimpio);

  // Si no hay teléfono válido
  if (!telefonoLimpio || telefonoLimpio.length < 8) {
    return {
      telefonoLimpio: '',
      telefonoDisplay: 'Sin teléfono',
      nivelRiesgo: 'neutro',
      score: 50,
      etiqueta: 'Sin Historial',
      enListaNegra: false,
      motivoListaNegra: null,
      totalPedidos: 0,
      entregados: 0,
      cancelados: 0,
      tasaEntrega: 0,
      motivosCancelacion: [],
      nombresConocidos: [],
      recomendacion: 'Solicitar y verificar número de WhatsApp antes de despachar.',
      alertaMensaje: null
    };
  }

  // 1. Revisar si está boletinado explícitamente en la lista negra
  const blacklist = getBlacklistEntries();
  const entryBlacklist = blacklist.find(b => cleanPhone(b.telefono) === telefonoLimpio && b.activo !== false);

  // 2. Cruzar con todas las órdenes históricas con este teléfono
  const ordenesCliente = allOrders.filter(o => cleanPhone(o.telefono) === telefonoLimpio);
  const nombresSet = new Set<string>();
  const motivosCancelacion: string[] = [];

  let entregados = 0;
  let cancelados = 0;

  ordenesCliente.forEach(o => {
    if (o.nombre_cliente?.trim()) nombresSet.add(o.nombre_cliente.trim());
    const est = String(o.estado || '').toLowerCase();
    if (est === 'entregado') {
      entregados++;
    } else if (est === 'cancelado') {
      cancelados++;
      if (o.motivo_cancelacion?.trim()) motivosCancelacion.push(o.motivo_cancelacion.trim());
      else if (o.notas && o.notas.toLowerCase().includes('novedad')) motivosCancelacion.push(o.notas.trim());
    }
  });

  if (entryBlacklist?.nombreCliente) nombresSet.add(entryBlacklist.nombreCliente);
  (entryBlacklist?.aliasNombres || []).forEach(n => nombresSet.add(n));

  const totalPedidos = ordenesCliente.length;
  const cerrados = entregados + cancelados;
  const tasaEntrega = cerrados > 0 ? (entregados / cerrados) * 100 : (entregados > 0 ? 100 : 0);
  const nombresConocidos = Array.from(nombresSet);

  // 3. Determinar Nivel de Riesgo y Score (0 - 100)
  let nivelRiesgo: 'rojo' | 'amarillo' | 'verde' | 'neutro' = 'neutro';
  let score = 50; // Base neutra para clientes nuevos
  let etiqueta = 'Cliente Nuevo';
  let recomendacion = 'Confirmar pedido vía WhatsApp o llamada antes de enviar.';
  let alertaMensaje: string | null = null;

  if (entryBlacklist) {
    nivelRiesgo = 'rojo';
    score = 10;
    etiqueta = '🚨 Lista Negra (Boletinado)';
    alertaMensaje = `Boletinado por ${entryBlacklist.reportadoPor || 'Motorista'}: "${entryBlacklist.motivo}".`;
    recomendacion = 'EXIGIR PAGO ANTICIPADO DE FLETE ($3.50) antes de entregar al repartidor o descartar pedido.';
  } else if (cancelados >= 2 || (cancelados >= 1 && entregados === 0)) {
    nivelRiesgo = 'rojo';
    score = Math.max(0, 30 - cancelados * 10);
    etiqueta = `🔴 Alto Riesgo (${cancelados} cancelaciones)`;
    alertaMensaje = `Cliente con ${cancelados} pedidos cancelados previamente.`;
    recomendacion = 'Exigir flete anticipado o llamada de reconfirmación estricta.';
  } else if (cancelados === 1 && entregados > 0) {
    nivelRiesgo = 'amarillo';
    score = 45;
    etiqueta = '⚠️ En Observación (1 cancelación previa)';
    alertaMensaje = `Tiene 1 entrega exitosa y 1 cancelación previa.`;
    recomendacion = 'Reconfirmar dirección exacta y horario de entrega.';
  } else if (entregados >= 2 && cancelados === 0) {
    nivelRiesgo = 'verde';
    score = Math.min(100, 75 + entregados * 5);
    etiqueta = `🛡️ Cliente VIP (${entregados} entregas)`;
    recomendacion = 'Cliente confiable y recurrente. Despacho prioritario.';
  } else if (entregados === 1 && cancelados === 0) {
    nivelRiesgo = 'verde';
    score = 75;
    etiqueta = '✓ Cliente Verificado (1 entrega)';
    recomendacion = 'Historial positivo. Despacho seguro.';
  }

  return {
    telefonoLimpio,
    telefonoDisplay: display,
    nivelRiesgo,
    score,
    etiqueta,
    enListaNegra: !!entryBlacklist,
    motivoListaNegra: entryBlacklist?.motivo || null,
    severidadListaNegra: entryBlacklist?.severidad,
    reportadoPor: entryBlacklist?.reportadoPor,
    totalPedidos,
    entregados,
    cancelados,
    tasaEntrega,
    motivosCancelacion,
    nombresConocidos,
    recomendacion,
    alertaMensaje
  };
}
