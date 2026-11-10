import { emitOsEvent } from './osEvents';
import { supabase } from './supabase';

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
  notificado?: boolean;
  fechaNotificacion?: string | null;
  evidenciaUrls?: string[];
  producto?: string | null;
  direccion?: string | null;
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

// Sincroniza desde Supabase en background (si la tabla client_blacklist existe)
let supabaseSyncAttempted = false;
export async function syncBlacklistFromSupabase(): Promise<BlacklistEntry[]> {
  try {
    const { data, error } = await supabase
      .from('client_blacklist')
      .select('*')
      .eq('activo', true)
      .order('created_at', { ascending: false });

    if (!error && Array.isArray(data)) {
      const mapeados: BlacklistEntry[] = data.map((row: any) => ({
        telefono: cleanPhone(row.telefono),
        telefonoDisplay: row.telefono_display || formatPhoneDisplay(row.telefono),
        nombreCliente: row.nombre_cliente || 'Cliente',
        aliasNombres: row.alias_nombres || [],
        motivo: row.motivo || 'Reportado en lista negra',
        severidad: (row.severidad as 'alta' | 'media' | 'baja') || 'alta',
        reportadoPor: row.reportado_por || 'Equipo Operativo',
        fecha: row.created_at ? row.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
        pedidoId: row.pedido_id,
        activo: row.activo ?? true,
        notificado: Boolean(row.notificado),
        fechaNotificacion: row.fecha_notificacion || null,
        evidenciaUrls: Array.isArray(row.evidencia_urls) ? row.evidencia_urls : [],
        producto: row.producto || null,
        direccion: row.direccion || null
      }));

      // Guardar en cache local
      localStorage.setItem(STORAGE_KEY, JSON.stringify(mapeados));
      window.dispatchEvent(new Event('blacklist_updated'));
      return mapeados;
    }
  } catch (err) {
    // Si la tabla no existe en Supabase, continúa trabajando silenciosamente con localStorage
  }
  return getBlacklistEntries();
}

// Carga las entradas manuales de la lista negra (localStorage instantáneo con sync opcional de Supabase)
export function getBlacklistEntries(): BlacklistEntry[] {
  // Disparar sincronización silenciosa con Supabase una sola vez al cargar la app
  if (!supabaseSyncAttempted && typeof window !== 'undefined') {
    supabaseSyncAttempted = true;
    syncBlacklistFromSupabase().catch(() => {});
  }

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

// Agrega o actualiza un cliente en la lista negra (Local + Supabase si existe)
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
    aliasNombres: Array.from(new Set([entry.nombreCliente, ...(entry.aliasNombres || [])])).filter(Boolean),
    notificado: entry.notificado ?? false,
    fechaNotificacion: entry.fechaNotificacion || null,
    evidenciaUrls: entry.evidenciaUrls || [],
    producto: entry.producto || null,
    direccion: entry.direccion || null
  };

  if (index >= 0) {
    actual[index] = {
      ...actual[index],
      ...nuevaEntrada,
      aliasNombres: Array.from(new Set([...(actual[index].aliasNombres || []), ...nuevaEntrada.aliasNombres])),
      notificado: nuevaEntrada.notificado ?? actual[index].notificado,
      fechaNotificacion: nuevaEntrada.fechaNotificacion ?? actual[index].fechaNotificacion,
      evidenciaUrls: Array.from(new Set([...(actual[index].evidenciaUrls || []), ...(nuevaEntrada.evidenciaUrls || [])])),
      producto: nuevaEntrada.producto ?? actual[index].producto ?? null,
      direccion: nuevaEntrada.direccion ?? actual[index].direccion ?? null
    };
  } else {
    actual.unshift(nuevaEntrada);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(actual));
  window.dispatchEvent(new Event('blacklist_updated'));

  // Sincronización en segundo plano con Supabase si la tabla está creada
  (async () => {
    try {
      await (supabase.from('client_blacklist') as any).upsert({
        telefono: telefonoLimpio,
        telefono_display: formatPhoneDisplay(telefonoLimpio),
        nombre_cliente: entry.nombreCliente,
        alias_nombres: nuevaEntrada.aliasNombres,
        motivo: entry.motivo,
        severidad: entry.severidad,
        reportado_por: entry.reportadoPor,
        pedido_id: entry.pedidoId || null,
        activo: true,
        notificado: nuevaEntrada.notificado,
        fecha_notificacion: nuevaEntrada.fechaNotificacion,
        evidencia_urls: nuevaEntrada.evidenciaUrls,
        producto: nuevaEntrada.producto,
        direccion: nuevaEntrada.direccion,
        updated_at: new Date().toISOString()
      }, { onConflict: 'telefono' });
    } catch {}
  })();

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

// Marca un cliente de la lista negra como formalmente notificado por WhatsApp
export function marcarNotificadoBlacklist(
  telefono: string, 
  evidenciaUrls: string[] = [], 
  producto?: string, 
  direccion?: string
): boolean {
  const clean = cleanPhone(telefono);
  if (!clean) return false;

  const actual = getBlacklistEntries();
  const index = actual.findIndex(e => cleanPhone(e.telefono) === clean);
  if (index < 0) return false;

  const ahora = new Date().toISOString();
  actual[index].notificado = true;
  actual[index].fechaNotificacion = ahora;
  if (evidenciaUrls.length > 0) {
    actual[index].evidenciaUrls = Array.from(new Set([...(actual[index].evidenciaUrls || []), ...evidenciaUrls]));
  }
  if (producto !== undefined) {
    actual[index].producto = producto.trim() || null;
  }
  if (direccion !== undefined) {
    actual[index].direccion = direccion.trim() || null;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(actual));
  window.dispatchEvent(new Event('blacklist_updated'));

  (async () => {
    try {
      await (supabase.from('client_blacklist') as any)
        .update({
          notificado: true,
          fecha_notificacion: ahora,
          evidencia_urls: actual[index].evidenciaUrls,
          producto: actual[index].producto,
          direccion: actual[index].direccion,
          updated_at: ahora
        })
        .eq('telefono', clean);
    } catch {}
  })();

  return true;
}

// Generador de plantillas institucionales de notificación WhatsApp
export type TipoPlantillaBlacklist = 'bloqueo' | 'rehabilitacion' | 'aviso_flete';

export function generarMensajeNotificacionBlacklist(params: {
  tipo: TipoPlantillaBlacklist;
  nombreCliente: string;
  telefono: string;
  motivo: string;
  reportadoPor?: string;
  evidenciaUrls?: string[];
  producto?: string;
  direccion?: string;
}): string {
  const { tipo, nombreCliente, telefono, motivo, reportadoPor, evidenciaUrls = [], producto, direccion } = params;
  const displayTel = formatPhoneDisplay(telefono);

  const productoTexto = producto && producto.trim() ? `\n📦 *Producto ordenado:* ${producto.trim()}` : '';
  const direccionTexto = direccion && direccion.trim() ? `\n📍 *Dirección registrada:* ${direccion.trim()}` : '';
  const evidenciasTexto = evidenciaUrls.filter(Boolean).length > 0
    ? `\n📸 *Evidencia documental en ruta:*\n${evidenciaUrls.filter(Boolean).map((u, i) => `• Prueba #${i + 1}: ${u.trim()}`).join('\n')}\n`
    : '';

  if (tipo === 'bloqueo') {
    return (
`⚖️ *AVISO INSTITUCIONAL — CONTROL DE RIESGO Y LOGÍSTICA*
*TODOENUNO EL SALVADOR*

Estimado/a *${nombreCliente}*,

Le notificamos formalmente que su número telefónico *${displayTel}* ha sido ingresado a nuestro *Registro Interno de Restricción e Incidencias Comerciales*.
${productoTexto}${direccionTexto}
📋 *Detalle del incidente:* ${motivo}
📌 *Reportado por:* ${reportadoPor || 'Red de Repartidores en Ruta'}${evidenciasTexto}
⚠️ *Resolución operativa:*
A partir de este momento, nuestra red de mensajería suspende la admisión de pedidos bajo la modalidad de pago contra entrega para este número de contacto y sus direcciones registradas.

_Departamento de Auditoría & Envíos COD_`
    );
  }

  if (tipo === 'rehabilitacion') {
    return (
`⚖️ *DEPARTAMENTO DE OPERACIONES & LOGÍSTICA — TODOENUNO*

Estimado/a *${nombreCliente}*,

Registramos una incidencia operativa con la entrega de su pedido en nuestra red de mensajería contra entrega en El Salvador.
${productoTexto}${direccionTexto}
📋 *Detalle del reporte:* ${motivo}
📌 *Reporte del repartidor:* ${reportadoPor || 'Motorista en Ruta'}${evidenciasTexto}
💡 *Oportunidad de Rehabilitación:*
Comprendemos que pueden ocurrir imprevistos o emergencias de fuerza mayor. Para regularizar su récord como cliente confiable y evitar restricciones en futuros pedidos, puede cubrir el costo operativo del flete no recaudado (*$3.50 USD*) vía transferencia bancaria o Chivo Wallet.

Si desea regularizar su expediente con nuestro equipo de despacho, por favor responda a este mensaje formal.`
    );
  }

  // aviso_flete
  return (
`📦 *DEPARTAMENTO DE DESPACHO — TODOENUNO EL SALVADOR*

Estimado/a *${nombreCliente}*,

Le informamos que debido a incidencias previas registradas con pedidos no concretados a su número telefónico (*${displayTel}*):
${productoTexto}${direccionTexto}
📋 *Historial de incidencia:* ${motivo}${evidenciasTexto}
⚠️ *Política de Despacho:*
Para autorizar y procesar cualquier futuro encargo o solicitud de producto a su nombre, será requisito indispensable el abono del costo de envío por adelantado ($3.50 USD).

Agradecemos su comprensión con las políticas de seguridad y control operativo en ruta.`
  );
}

// Remueve o rehabilita un cliente de la lista negra (Local + Supabase si existe)
export function removeBlacklistEntry(telefono: string): boolean {
  const clean = cleanPhone(telefono);
  if (!clean) return false;

  const actual = getBlacklistEntries();
  const filtrados = actual.filter(e => cleanPhone(e.telefono) !== clean);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtrados));
  window.dispatchEvent(new Event('blacklist_updated'));

  // Sincronizar en segundo plano con Supabase
  (async () => {
    try {
      await (supabase.from('client_blacklist') as any)
        .delete()
        .eq('telefono', clean);
    } catch {}
  })();

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
