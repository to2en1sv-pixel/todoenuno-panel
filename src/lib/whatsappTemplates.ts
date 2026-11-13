import { supabase } from '@/lib/supabase';

export type OrderTemplateCategory = 'pedidos' | 'repartidor' | 'personalizada';

export interface OrderWhatsappTemplate {
  id: string;
  titulo: string;
  etiquetaBoton: string;
  categoria: OrderTemplateCategory;
  descripcion: string;
  mensaje: string;
  activo: boolean;
  isDefault?: boolean;
}

export const SYSTEM_WA_TEMPLATES_DOC_TITLE = '__SYSTEM_WA_ORDER_TEMPLATES_V1__';
const LOCAL_WA_TEMPLATES_KEY = 'todoenuno_wa_order_templates_v1';

export const WA_TEMPLATE_VARIABLES: Array<{
  key: string;
  label: string;
  example: string;
}> = [
  { key: '{nombre}', label: 'Cliente', example: 'Tatiana Gómez' },
  { key: '{producto}', label: 'Producto / SKU', example: 'Asistente de bebé (Rosado)' },
  { key: '{total}', label: 'Total $', example: '$15.00' },
  { key: '{direccion}', label: 'Dirección', example: 'Residencial Pasadena, San Miguel' },
  { key: '{departamento}', label: 'Depto.', example: 'San Miguel' },
  { key: '{courier}', label: 'Motorista / Courier', example: 'Motorista Central 1' },
  { key: '{fecha_programada}', label: 'Fecha encargo', example: '2026-11-15' },
  { key: '{metodo_pago}', label: 'Pago', example: 'Contra entrega' },
  { key: '{telefono}', label: 'Teléfono', example: '6074-4809' },
  { key: '{codigo}', label: 'Código pedido', example: 'PED-1042' },
];

export const DEFAULT_ORDER_WA_TEMPLATES: OrderWhatsappTemplate[] = [
  {
    id: 'confirmacion',
    titulo: '1. Confirmar Pedido y Dirección',
    etiquetaBoton: 'Enviar Confirmación',
    categoria: 'pedidos',
    descripcion: 'Mensaje inicial para validar dirección y monto antes de despachar.',
    mensaje:
      '¡Hola {nombre}! 👋 Confirmamos tu pedido de *{producto}* por un total de *{total}*. ¿Nos confirmas si recibirás en 📍 {direccion}?',
    activo: true,
    isDefault: true,
  },
  {
    id: 'en_camino',
    titulo: '2. Paquete en Camino con Motorista',
    etiquetaBoton: 'Enviar Aviso de Ruta',
    categoria: 'pedidos',
    descripcion: 'Aviso cuando el pedido pasa a ruta con el repartidor asignado.',
    mensaje:
      '¡Buenas noticias {nombre}! 🛵 Tu pedido va en camino hoy con nuestro repartidor ({courier}). Recuerda tener listo *{total}* en efectivo contra entrega.',
    activo: true,
    isDefault: true,
  },
  {
    id: 'reprogramar',
    titulo: '3. No Contesta / Reprogramar Entrega',
    etiquetaBoton: 'Enviar Reprogramación',
    categoria: 'pedidos',
    descripcion: 'Seguimiento rápido cuando el motorista no logró contactar al cliente.',
    mensaje:
      'Hola {nombre}, nuestro repartidor estuvo en tu zona pero no logramos comunicarnos. ¿Nos confirmas si te queda bien reprogramar la entrega para mañana?',
    activo: true,
    isDefault: true,
  },
  {
    id: 'encargo',
    titulo: '4. Recordatorio de Encargo Programado',
    etiquetaBoton: 'Enviar Recordatorio de Encargo',
    categoria: 'pedidos',
    descripcion: 'Confirmación previa para pedidos agendados a quincena o fecha futura.',
    mensaje:
      '¡Hola {nombre}! 👋 Te saludamos de TODOENUNO. Te recordamos que tu encargo de *{producto}* por *{total}* está programado para entrega este {fecha_programada}. ¿Nos confirmas si todo sigue en pie para despacharlo con el motorista?',
    activo: true,
    isDefault: true,
  },
  {
    id: 'repartidor_llegando',
    titulo: '5. Motorista Llegando (Panel Repartidor)',
    etiquetaBoton: 'Avisar Llegada',
    categoria: 'repartidor',
    descripcion: 'Botón directo de WhatsApp usado por el motorista en /entregar y /repartidor.',
    mensaje:
      'Hola {nombre}, soy el repartidor de To2en1.app. Estoy llegando a tu dirección con tu pedido de *{producto}*. ¿Te encuentras disponible para recibir? 🛵',
    activo: true,
    isDefault: true,
  },
];

function mergeWithDefaults(parsed: unknown): OrderWhatsappTemplate[] {
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return DEFAULT_ORDER_WA_TEMPLATES.map((t) => ({ ...t }));
  }

  const byId = new Map<string, OrderWhatsappTemplate>();
  for (const item of parsed) {
    if (item && typeof item === 'object' && typeof (item as any).id === 'string') {
      const t = item as OrderWhatsappTemplate;
      byId.set(t.id, {
        id: t.id,
        titulo: String(t.titulo || 'Plantilla sin título'),
        etiquetaBoton: String(t.etiquetaBoton || 'Enviar WhatsApp'),
        categoria:
          t.categoria === 'repartidor' || t.categoria === 'personalizada'
            ? t.categoria
            : 'pedidos',
        descripcion: String(t.descripcion || ''),
        mensaje: String(t.mensaje || ''),
        activo: t.activo !== false,
        isDefault: Boolean(t.isDefault),
      });
    }
  }

  // Garantizar que las plantillas base siempre existan si faltaba alguna
  const result: OrderWhatsappTemplate[] = [];
  for (const def of DEFAULT_ORDER_WA_TEMPLATES) {
    const existing = byId.get(def.id);
    if (existing) {
      result.push({ ...existing, isDefault: true });
      byId.delete(def.id);
    } else {
      result.push({ ...def });
    }
  }

  // Añadir personalizadas creadas por el usuario
  for (const custom of byId.values()) {
    result.push({ ...custom, isDefault: false });
  }

  return result;
}

export function getCachedOrderWhatsappTemplates(): OrderWhatsappTemplate[] {
  try {
    const raw = localStorage.getItem(LOCAL_WA_TEMPLATES_KEY);
    if (raw) {
      return mergeWithDefaults(JSON.parse(raw));
    }
  } catch {}
  return DEFAULT_ORDER_WA_TEMPLATES.map((t) => ({ ...t }));
}

function writeLocalTemplates(templates: OrderWhatsappTemplate[]) {
  try {
    localStorage.setItem(LOCAL_WA_TEMPLATES_KEY, JSON.stringify(templates));
  } catch {}
}

export async function fetchOrderWhatsappTemplates(): Promise<{
  templates: OrderWhatsappTemplate[];
  source: 'supabase' | 'local';
}> {
  try {
    const { data, error } = await supabase
      .from('panel_docs')
      .select('id,contenido')
      .eq('titulo', SYSTEM_WA_TEMPLATES_DOC_TITLE)
      .maybeSingle();

    if (!error && data?.contenido) {
      const merged = mergeWithDefaults(JSON.parse(data.contenido));
      writeLocalTemplates(merged);
      return { templates: merged, source: 'supabase' };
    }
  } catch {}

  return {
    templates: getCachedOrderWhatsappTemplates(),
    source: 'local',
  };
}

export async function saveOrderWhatsappTemplates(
  templates: OrderWhatsappTemplate[]
): Promise<{
  ok: boolean;
  source: 'supabase' | 'local';
  error?: string;
}> {
  const clean = mergeWithDefaults(templates);
  writeLocalTemplates(clean);

  try {
    const serialized = JSON.stringify(clean);
    const { data: existing, error: selErr } = await supabase
      .from('panel_docs')
      .select('id')
      .eq('titulo', SYSTEM_WA_TEMPLATES_DOC_TITLE)
      .maybeSingle();

    if (selErr) {
      return { ok: true, source: 'local', error: selErr.message };
    }

    if (existing?.id) {
      const { error: updErr } = await supabase
        .from('panel_docs')
        .update({
          contenido: serialized,
          categoria: 'Sistema',
          estado: 'Completado',
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updErr) {
        return { ok: true, source: 'local', error: updErr.message };
      }
      return { ok: true, source: 'supabase' };
    }

    const { error: insErr } = await supabase.from('panel_docs').insert({
      titulo: SYSTEM_WA_TEMPLATES_DOC_TITLE,
      contenido: serialized,
      categoria: 'Sistema',
      estado: 'Completado',
      updated_at: new Date().toISOString(),
    });

    if (insErr) {
      return { ok: true, source: 'local', error: insErr.message };
    }
    return { ok: true, source: 'supabase' };
  } catch (err: any) {
    return { ok: true, source: 'local', error: err?.message };
  }
}

export function renderWhatsappTemplate(
  templateText: string,
  pedido?: {
    id?: string | null;
    pedido_codigo?: string | null;
    nombre_cliente?: string | null;
    sku?: string | null;
    catalogo_sku?: string | null;
    total?: number | string | null;
    direccion?: string | null;
    departamento?: string | null;
    courier?: string | null;
    fecha_programada?: string | null;
    metodo_pago?: string | null;
    telefono?: string | null;
  } | null
): string {
  const numTotal = Number(pedido?.total) || 0;
  const formattedTotal = `$${numTotal.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

  const replacements: Record<string, string> = {
    '{nombre}': (pedido?.nombre_cliente || '').trim(),
    '{producto}': (pedido?.sku || pedido?.catalogo_sku || 'tu producto').trim(),
    '{total}': formattedTotal,
    '{direccion}': (pedido?.direccion || 'tu dirección').trim(),
    '{departamento}': (pedido?.departamento || 'El Salvador').trim(),
    '{courier}': (pedido?.courier || 'Motorista').trim(),
    '{fecha_programada}': (pedido?.fecha_programada || 'día acordado').trim(),
    '{metodo_pago}': (pedido?.metodo_pago || 'Contra entrega').trim(),
    '{telefono}': (pedido?.telefono || '').trim(),
    '{codigo}': (pedido?.pedido_codigo || pedido?.id || '').trim(),
  };

  let out = templateText || '';
  for (const [token, val] of Object.entries(replacements)) {
    out = out.split(token).join(val);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}
