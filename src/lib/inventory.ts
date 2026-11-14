import { supabase } from '@/lib/supabase';
import { emitOsEvent } from '@/lib/osEvents';
import { addManualTransaction } from '@/lib/finance';
import { resolveCatalogSku, getInventoryCutoffDate, isOrderBeforeCutoff } from '@/lib/catalogAliases';
import { getCachedToddCatalogSettings } from '@/lib/toddSettings';
import type { 
  StockItem, 
  KardexMovement, 
  EntradaMercaderiaFormData, 
  ProductFormData,
  KardexMovementType,
  ProductVariant,
  ProductVariantInput
} from '@/types/inventory';

// Almacén local de respaldo en memoria (solo cuando Supabase no está disponible)
let localStock: StockItem[] = [];
let localKardex: KardexMovement[] = [];

function normalizeSku(sku?: string | null): string {
  return (sku || '').trim().toUpperCase();
}

/**
 * Helper seguro para escribir en public.inventory_stock (que es una VIEW en Postgres).
 * Postgres NO soporta INSERT ... ON CONFLICT (sku) sobre vistas; por eso comprobamos
 * si el SKU existe y ejecutamos UPDATE o INSERT explícitamente.
 */
async function upsertInventoryStockRow(
  sku: string,
  fields: Record<string, any>
): Promise<{ error: any | null }> {
  const skuClean = normalizeSku(sku);
  const { data: existing, error: selectErr } = await supabase
    .from('inventory_stock')
    .select('sku')
    .eq('sku', skuClean)
    .maybeSingle();

  if (selectErr) {
    return { error: selectErr };
  }

  const optionalKeys = ['todd_pitch', 'todd_instrucciones', 'todd_keywords', 'activo_todd', 'categoria'];
  const stripOptional = (obj: Record<string, any>) => {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!optionalKeys.includes(k)) clean[k] = v;
    }
    return clean;
  };

  if (existing) {
    const updatePayload = { ...fields };
    delete updatePayload.sku;
    const res = await supabase.from('inventory_stock').update(updatePayload).eq('sku', skuClean);
    if (res.error && res.error.message?.includes('column')) {
      return await supabase.from('inventory_stock').update(stripOptional(updatePayload)).eq('sku', skuClean);
    }
    return { error: res.error };
  } else {
    const insertPayload = {
      nombre: skuClean,
      stock_fisico: 0,
      stock_reservado: 0,
      ...fields,
      sku: skuClean
    };
    const res = await supabase.from('inventory_stock').insert(insertPayload);
    if (res.error && res.error.message?.includes('column')) {
      return await supabase.from('inventory_stock').insert(stripOptional(insertPayload));
    }
    return { error: res.error };
  }
}

/**
 * Obtener todos los SKUs con sus niveles de stock físico, reservado y disponible
 */
export async function fetchStockItems(): Promise<{
  items: StockItem[];
  isRealDb: boolean;
  error?: string;
}> {
  try {
    // 1. Consultar vista nativa public.inventory_stock (fuente maestra)
    const { data, error } = await supabase
      .from('inventory_stock')
      .select('*')
      .order('nombre');

    if (!error && Array.isArray(data)) {
      localStock = (data as StockItem[]).map(item => ({
        ...item,
        sku: normalizeSku(item.sku),
        stock_fisico: Number(item.stock_fisico) || 0,
        stock_reservado: Number(item.stock_reservado) || 0,
        stock_disponible:
          item.stock_disponible !== undefined && item.stock_disponible !== null
            ? Number(item.stock_disponible)
            : Math.max((Number(item.stock_fisico) || 0) - (Number(item.stock_reservado) || 0), 0),
        costo_unitario: Number(item.costo_unitario) || 0,
        precio_venta: Number(item.precio_venta) || 0,
        stock_minimo_alerta: Number(item.stock_minimo_alerta ?? 5),
        activo: item.activo !== false
      }));
      return { items: localStock, isRealDb: true };
    }

    // 2. Fallback si aún no se ha corrido el SQL de Sprint 3 / Sprint 10 en Supabase
    const [resInv, resVar, resProd] = await Promise.all([
      supabase.from('inventory_cache').select('*'),
      supabase.from('productos_variantes').select('*'),
      supabase.from('productos').select('*')
    ]);

    if (!resInv.error && Array.isArray(resInv.data)) {
      const prodMap = new Map<string, any>();
      (resProd.data || []).forEach((p: any) => prodMap.set(String(p.template_id), p));

      const varMap = new Map<string, any>();
      (resVar.data || []).forEach((v: any) => {
        if (v.sku) varMap.set(normalizeSku(v.sku), v);
      });

      const fallbackItems: StockItem[] = resInv.data
        .filter((ic: any) => ic.sku && String(ic.sku).trim() !== '')
        .map((ic: any) => {
          const skuClean = normalizeSku(ic.sku);
          const v = varMap.get(skuClean);
          const templateId = v?.template_id ? String(v.template_id) : null;
          const prod = templateId ? prodMap.get(templateId) : null;

          return {
            sku: skuClean,
            nombre: prod?.nombre_base || skuClean,
            template_id: templateId,
            stock_fisico: Math.max(Number(ic.qty) || 0, 0),
            stock_reservado: 0,
            stock_disponible: Math.max(Number(ic.qty) || 0, 0),
            costo_unitario: 0.00,
            precio_venta: Number(v?.precio) || 0.00,
            stock_minimo_alerta: 5,
            ubicacion: 'Bodega Central',
            activo: prod?.active !== false,
            image_url: prod?.image_url || ic.image_url || null,
            updated_at: new Date().toISOString()
          };
        });

      localStock = fallbackItems;
      return {
        items: fallbackItems,
        isRealDb: false,
        error: error?.message || 'Tabla public.inventory_stock no encontrada. Ejecuta el SQL de Sprint 10.'
      };
    }

    return {
      items: localStock,
      isRealDb: false,
      error: error?.message || 'No se pudo conectar con la tabla de inventario en Supabase.'
    };
  } catch (err: any) {
    return {
      items: localStock,
      isRealDb: false,
      error: err?.message || 'Error consultando inventario en Supabase.'
    };
  }
}

/**
 * Obtener movimientos del Kárdex
 */
export async function fetchKardexMovements(
  sku?: string,
  limit = 150
): Promise<{ movements: KardexMovement[]; isRealDb: boolean; error?: string }> {
  try {
    let query = supabase
      .from('inventory_kardex')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sku) {
      query = query.eq('sku', normalizeSku(sku));
    }

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      localKardex = data as KardexMovement[];
      return { movements: localKardex, isRealDb: true };
    }

    return {
      movements: localKardex,
      isRealDb: false,
      error: error?.message
    };
  } catch (err: any) {
    let filtered = [...localKardex];
    if (sku) {
      const target = normalizeSku(sku);
      filtered = filtered.filter(k => normalizeSku(k.sku) === target);
    }
    return { movements: filtered.slice(0, limit), isRealDb: false, error: err?.message };
  }
}

/**
 * Ejecuta un movimiento atómico en Supabase:
 * 1. Intenta vía RPC public.record_movement
 * 2. Si el RPC aún no existe, actualiza directamente inventory_stock + inventory_kardex
 */
async function executeMovementInDb(params: {
  sku: string;
  tipo_movimiento: KardexMovementType;
  cantidad: number;
  costo_unitario?: number;
  motivo: string;
  source_table?: string;
  source_id?: string;
  usuario?: string;
}): Promise<{ success: boolean; nuevoFisico?: number; error?: string; isRealDb: boolean }> {
  const skuClean = normalizeSku(params.sku);
  const absQty = Math.abs(Math.round(params.cantidad));
  const costo = Math.max(Number(params.costo_unitario) || 0, 0);

  if (!skuClean) {
    return { success: false, error: 'El SKU es obligatorio.', isRealDb: false };
  }

  try {
    // 1. Intentar RPC en public.record_movement
    const rpcRes = await (supabase as any).rpc('record_movement', {
      p_sku: skuClean,
      p_tipo_movimiento: params.tipo_movimiento,
      p_cantidad: absQty,
      p_costo_unitario: costo,
      p_motivo: params.motivo,
      p_source_table: params.source_table || 'manual',
      p_source_id: params.source_id || `mov-${Date.now()}`,
      p_usuario: params.usuario || 'Panel Admin'
    });

    if (!rpcRes.error && rpcRes.data) {
      const nuevoFisico = Number(rpcRes.data.saldo_fisico ?? 0);
      return { success: true, nuevoFisico, isRealDb: true };
    }

    // 2. Fallback directo sobre inventory_stock + inventory_kardex (si RPC aún no existe)
    const { data: existingRow, error: readErr } = await supabase
      .from('inventory_stock')
      .select('sku, nombre, stock_fisico, stock_reservado, costo_unitario')
      .eq('sku', skuClean)
      .maybeSingle();

    if (readErr) {
      return { success: false, error: readErr.message, isRealDb: false };
    }

    const stockActual = Number(existingRow?.stock_fisico ?? 0);
    const reservadoActual = Number(existingRow?.stock_reservado ?? 0);
    let nuevoFisico = stockActual;
    let nuevoReservado = reservadoActual;
    let deltaKardex = absQty;

    if (
      params.tipo_movimiento === 'inventario_inicial' ||
      params.tipo_movimiento === 'compra_entrada' ||
      params.tipo_movimiento === 'ajuste_positivo'
    ) {
      nuevoFisico = stockActual + absQty;
    } else if (params.tipo_movimiento === 'reserva_pedido') {
      nuevoReservado = reservadoActual + absQty;
    } else if (params.tipo_movimiento === 'liberar_reserva') {
      nuevoReservado = Math.max(reservadoActual - absQty, 0);
    } else if (params.tipo_movimiento === 'venta_salida') {
      nuevoFisico = Math.max(stockActual - absQty, 0);
      nuevoReservado = Math.max(reservadoActual - absQty, 0);
      deltaKardex = -absQty;
    } else if (
      params.tipo_movimiento === 'ajuste_negativo' ||
      params.tipo_movimiento === 'merma_dano'
    ) {
      nuevoFisico = Math.max(stockActual - absQty, 0);
      deltaKardex = -absQty;
    } else if (params.tipo_movimiento === 'devolucion_entrada') {
      nuevoFisico = stockActual + absQty;
      nuevoReservado = Math.max(reservadoActual - absQty, 0);
    }

    const stockUpdatePayload: Record<string, any> = {
      nombre: existingRow?.nombre || skuClean,
      stock_fisico: nuevoFisico,
      stock_reservado: nuevoReservado,
      updated_at: new Date().toISOString()
    };

    if (costo > 0) {
      stockUpdatePayload.costo_unitario = costo;
    }

    const { error: upsertErr } = await upsertInventoryStockRow(skuClean, stockUpdatePayload);

    if (upsertErr) {
      return { success: false, error: upsertErr.message, isRealDb: false };
    }

    // Si tipo_movimiento fue 'inventario_inicial' y la tabla kardex aún no tiene el constraint nuevo del Sprint 10,
    // hacemos fallback seguro a 'ajuste_positivo' para que el registro de Kárdex nunca se pierda.
    const { error: kardexErr } = await supabase.from('inventory_kardex').insert({
      sku: skuClean,
      tipo_movimiento: params.tipo_movimiento,
      cantidad: deltaKardex,
      costo_unitario: costo,
      saldo_fisico: nuevoFisico,
      motivo: params.motivo,
      source_table: params.source_table || 'manual',
      source_id: params.source_id || null,
      usuario: params.usuario || 'Panel Admin'
    });

    if (kardexErr && params.tipo_movimiento === 'inventario_inicial') {
      await supabase.from('inventory_kardex').insert({
        sku: skuClean,
        tipo_movimiento: 'ajuste_positivo',
        cantidad: deltaKardex,
        costo_unitario: costo,
        saldo_fisico: nuevoFisico,
        motivo: `[Inventario Inicial] ${params.motivo}`,
        source_table: params.source_table || 'manual',
        source_id: params.source_id || null,
        usuario: params.usuario || 'Panel Admin'
      });
    } else if (kardexErr && params.tipo_movimiento === 'liberar_reserva') {
      await supabase.from('inventory_kardex').insert({
        sku: skuClean,
        tipo_movimiento: 'ajuste_positivo',
        cantidad: deltaKardex,
        costo_unitario: costo,
        saldo_fisico: nuevoFisico,
        motivo: `[Liberación Reserva] ${params.motivo}`,
        source_table: params.source_table || 'manual',
        source_id: params.source_id || null,
        usuario: params.usuario || 'Panel Admin'
      });
    }

    return { success: true, nuevoFisico, isRealDb: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error ejecutando movimiento', isRealDb: false };
  }
}

/**
 * Registrar Entrada de Unidades:
 * - Inventario Inicial / Reposición sin compra (no toca Finanzas)
 * - Compra a proveedor (opcionalmente asienta egreso en Finanzas)
 */
export async function recordStockEntry(
  entry: EntradaMercaderiaFormData
): Promise<{ success: boolean; error?: string; isRealDb?: boolean }> {
  const skuClean = normalizeSku(entry.sku);
  const cantidad = Math.abs(Math.round(entry.cantidad));
  const costo = Math.max(Number(entry.costo_unitario) || 0, 0);
  const tipoEntrada: KardexMovementType = entry.tipo_entrada || 'inventario_inicial';

  if (!skuClean || cantidad <= 0) {
    return { success: false, error: 'SKU y cantidad mayor a 0 son obligatorios.' };
  }

  const totalCompra = cantidad * costo;
  const motivo =
    tipoEntrada === 'compra_entrada'
      ? `Compra a proveedor ${entry.proveedor || 'Mercadería'}. ${entry.notas || ''}`.trim()
      : tipoEntrada === 'inventario_inicial'
      ? `Carga de inventario inicial / stock en bodega. ${entry.notas || ''}`.trim()
      : `Ingreso directo de unidades (+${cantidad}). ${entry.notas || ''}`.trim();

  const dbRes = await executeMovementInDb({
    sku: skuClean,
    tipo_movimiento: tipoEntrada,
    cantidad,
    costo_unitario: costo,
    motivo,
    source_table: tipoEntrada === 'compra_entrada' ? 'manual_compras' : 'inventario_inicial',
    source_id: `${tipoEntrada}-${Date.now()}`,
    usuario: 'Panel Admin'
  });

  if (!dbRes.success) {
    return { success: false, error: dbRes.error || 'Error guardando entrada en Supabase', isRealDb: false };
  }

  // Asentar en Finanzas SOLO si es compra y el usuario marcó asentar_en_finanzas
  if (tipoEntrada === 'compra_entrada' && entry.asentar_en_finanzas && totalCompra > 0) {
    try {
      await addManualTransaction({
        account_id: entry.cuenta_finanzas_id || 'banco_principal',
        tipo: 'expense',
        categoria: 'pago_proveedor',
        monto: totalCompra,
        descripcion: `Compra ${cantidad}x ${skuClean} (${entry.proveedor || 'Mercadería'})`,
        fecha: new Date().toISOString().slice(0, 10)
      });
    } catch (err) {
      console.warn('Error asentando compra en Finanzas:', err);
    }
  }

  // Emitir evento al OS Event Store
  try {
    await emitOsEvent({
      type: tipoEntrada === 'compra_entrada' ? 'supplier.bid.received' : 'inventory.adjustment',
      source_table: 'inventory_stock',
      source_id: skuClean,
      payload: {
        sku: skuClean,
        cantidad,
        costo_unitario: costo,
        total_compra: tipoEntrada === 'compra_entrada' ? totalCompra : 0,
        proveedor: entry.proveedor || null,
        tipo: tipoEntrada,
        saldo_nuevo: dbRes.nuevoFisico
      }
    });
  } catch {
    // no bloquear flujo principal
  }

  return { success: true, isRealDb: dbRes.isRealDb };
}

/**
 * Ajustar Stock Físico Manual (fijar conteo exacto o sumar/restar delta)
 */
export async function adjustStock(params: {
  sku: string;
  nuevo_stock: number;
  motivo: string;
  tipo?: 'ajuste_positivo' | 'ajuste_negativo' | 'merma_dano';
}): Promise<{ success: boolean; error?: string; isRealDb?: boolean }> {
  const skuClean = normalizeSku(params.sku);
  const nuevoStock = Math.max(Math.round(params.nuevo_stock), 0);

  // Obtener el stock físico REAL actual desde Supabase (no solo desde memoria local)
  let stockAnterior = localStock.find(i => normalizeSku(i.sku) === skuClean)?.stock_fisico ?? 0;
  let costoActual = localStock.find(i => normalizeSku(i.sku) === skuClean)?.costo_unitario ?? 0;

  try {
    const { data: realRow } = await supabase
      .from('inventory_stock')
      .select('stock_fisico, costo_unitario')
      .eq('sku', skuClean)
      .maybeSingle();

    if (realRow) {
      stockAnterior = Number(realRow.stock_fisico) || 0;
      costoActual = Number(realRow.costo_unitario) || 0;
    }
  } catch {
    // usar memoria local
  }

  const diferencia = nuevoStock - stockAnterior;
  if (diferencia === 0) {
    return { success: true, isRealDb: true };
  }

  const tipoMovimiento: KardexMovementType =
    params.tipo || (diferencia >= 0 ? 'ajuste_positivo' : 'ajuste_negativo');

  const dbRes = await executeMovementInDb({
    sku: skuClean,
    tipo_movimiento: tipoMovimiento,
    cantidad: Math.abs(diferencia),
    costo_unitario: costoActual,
    motivo: `${params.motivo} (Antes: ${stockAnterior}, Ahora: ${nuevoStock})`,
    source_table: 'manual_ajustes',
    source_id: `ajuste-${Date.now()}`,
    usuario: 'Panel Admin'
  });

  if (!dbRes.success) {
    return { success: false, error: dbRes.error || 'No se pudo actualizar el stock en Supabase', isRealDb: false };
  }

  // Emitir evento al OS Event Store
  try {
    await emitOsEvent({
      type: 'inventory.adjustment',
      source_table: 'inventory_stock',
      source_id: skuClean,
      payload: {
        sku: skuClean,
        stock_anterior: stockAnterior,
        nuevo_stock: nuevoStock,
        diferencia,
        tipo_movimiento: tipoMovimiento,
        motivo: params.motivo
      }
    });
  } catch {
    // ignorar
  }

  return { success: true, isRealDb: dbRes.isRealDb };
}

/**
 * Sumar o restar rápidamente una cantidad al stock actual (+1, +5, +10, -1, etc.)
 */
export async function quickAddStockDelta(
  sku: string,
  delta: number,
  motivo = 'Ajuste rápido en bodega'
): Promise<{ success: boolean; error?: string }> {
  const skuClean = normalizeSku(sku);
  if (delta === 0) return { success: true };

  const tipoMovimiento: KardexMovementType =
    delta > 0 ? 'ajuste_positivo' : 'ajuste_negativo';

  const res = await executeMovementInDb({
    sku: skuClean,
    tipo_movimiento: tipoMovimiento,
    cantidad: Math.abs(delta),
    motivo: `${motivo} (${delta > 0 ? `+${delta}` : delta} uds)`,
    source_table: 'ajuste_rapido',
    source_id: `quick-${Date.now()}`,
    usuario: 'Panel Admin'
  });

  if (!res.success) {
    return { success: false, error: res.error };
  }

  try {
    await emitOsEvent({
      type: 'inventory.adjustment',
      source_table: 'inventory_stock',
      source_id: skuClean,
      payload: {
        sku: skuClean,
        diferencia: delta,
        nuevo_stock: res.nuevoFisico,
        tipo_movimiento: tipoMovimiento,
        motivo
      }
    });
  } catch {}

  return { success: true };
}

/**
 * Comprimir archivo de imagen del cliente para optimizar almacenamiento y velocidad
 */
export function compressImageFile(file: File, maxWidth = 800, maxHeight = 800, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error('Error al leer el archivo'));
    reader.readAsDataURL(file);
  });
}

/**
 * Obtener configuración comercial para el Bot Todd
 */
export function getToddProductConfig(keyId: string | number): {
  todd_pitch: string;
  todd_instrucciones: string;
  todd_keywords: string;
  activo_todd: boolean;
} {
  const k = String(keyId).trim();
  try {
    const raw = localStorage.getItem(`todd_cfg_${k}`);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return {
    todd_pitch: '',
    todd_instrucciones: '',
    todd_keywords: '',
    activo_todd: true,
  };
}

export interface UpdateProductPayload {
  sku?: string;
  template_id?: string | number | null;
  nombre_base?: string;
  image_url?: string | null;
  active?: boolean;
  todd_pitch?: string;
  todd_instrucciones?: string;
  todd_keywords?: string;
  activo_todd?: boolean;
  precio_venta?: number;
  costo_unitario?: number;
  stock_minimo_alerta?: number;
  ubicacion?: string;
  categoria?: string;
}

/**
 * Actualizar detalles comerciales, fotos e inteligencia de Todd para un producto
 * Garantiza guardado en inventory_stock (por SKU) y sincroniza public.productos si aplica.
 */
export async function updateProductDetails(
  payload: UpdateProductPayload
): Promise<{ success: boolean; error?: string }> {
  const skuClean = normalizeSku(payload.sku);
  const templateIdStr = payload.template_id !== undefined && payload.template_id !== null
    ? String(payload.template_id).trim()
    : '';
  const localKey = skuClean || templateIdStr;

  // 1. Guardar configuración de Todd en localStorage
  if (localKey) {
    try {
      const currentTodd = getToddProductConfig(localKey);
      const updatedTodd = {
        ...currentTodd,
        todd_pitch: payload.todd_pitch !== undefined ? payload.todd_pitch : currentTodd.todd_pitch,
        todd_instrucciones: payload.todd_instrucciones !== undefined ? payload.todd_instrucciones : currentTodd.todd_instrucciones,
        todd_keywords: payload.todd_keywords !== undefined ? payload.todd_keywords : currentTodd.todd_keywords,
        activo_todd: payload.activo_todd !== undefined ? payload.activo_todd : currentTodd.activo_todd,
      };
      localStorage.setItem(`todd_cfg_${localKey}`, JSON.stringify(updatedTodd));
    } catch {
      // ignorar
    }
  }

  let dbError: string | undefined;

  // 2. Guardar/Actualizar en inventory_stock (fuente principal)
  const targetSku = skuClean || (templateIdStr ? `SKU-${templateIdStr}` : '');
  if (targetSku) {
    const stockPayload: Record<string, any> = {
      sku: targetSku,
      updated_at: new Date().toISOString()
    };

    if (payload.nombre_base !== undefined) stockPayload.nombre = payload.nombre_base;
    if (templateIdStr) stockPayload.template_id = templateIdStr;
    if (payload.image_url !== undefined) stockPayload.image_url = payload.image_url;
    if (payload.active !== undefined) stockPayload.activo = payload.active;
    if (payload.precio_venta !== undefined && !Number.isNaN(payload.precio_venta)) {
      stockPayload.precio_venta = Math.max(payload.precio_venta, 0);
    }
    if (payload.costo_unitario !== undefined && !Number.isNaN(payload.costo_unitario)) {
      stockPayload.costo_unitario = Math.max(payload.costo_unitario, 0);
    }
    if (payload.stock_minimo_alerta !== undefined && !Number.isNaN(payload.stock_minimo_alerta)) {
      stockPayload.stock_minimo_alerta = Math.max(Math.round(payload.stock_minimo_alerta), 0);
    }
    if (payload.ubicacion !== undefined) stockPayload.ubicacion = payload.ubicacion;
    if (payload.categoria !== undefined) stockPayload.categoria = payload.categoria;
    if (payload.todd_pitch !== undefined) stockPayload.todd_pitch = payload.todd_pitch;
    if (payload.todd_instrucciones !== undefined) stockPayload.todd_instrucciones = payload.todd_instrucciones;
    if (payload.todd_keywords !== undefined) stockPayload.todd_keywords = payload.todd_keywords;
    if (payload.activo_todd !== undefined) stockPayload.activo_todd = payload.activo_todd;

    const { error: stockErr } = await upsertInventoryStockRow(targetSku, stockPayload);
    if (stockErr) {
      dbError = stockErr.message;
    }
  }

  // 3. Si tiene template_id numérico, sincronizar también con public.productos
  if (templateIdStr && /^\d+$/.test(templateIdStr)) {
    const numericId = Number(templateIdStr);
    const updateObj: Record<string, any> = {};
    if (payload.nombre_base !== undefined) updateObj.nombre_base = payload.nombre_base;
    if (payload.image_url !== undefined) updateObj.image_url = payload.image_url;
    if (payload.active !== undefined) updateObj.active = payload.active;

    if (Object.keys(updateObj).length > 0) {
      const fullObj = {
        ...updateObj,
        ...(payload.todd_pitch !== undefined ? { todd_pitch: payload.todd_pitch } : {}),
        ...(payload.todd_instrucciones !== undefined ? { todd_instrucciones: payload.todd_instrucciones } : {}),
        ...(payload.todd_keywords !== undefined ? { todd_keywords: payload.todd_keywords } : {}),
        ...(payload.activo_todd !== undefined ? { activo_todd: payload.activo_todd } : {}),
      };

      const res = await supabase.from('productos').update(fullObj).eq('template_id', numericId);
      if (res.error && res.error.message?.includes('column')) {
        await supabase.from('productos').update(updateObj).eq('template_id', numericId);
      }
    }
  }

  if (dbError) {
    return { success: false, error: dbError };
  }

  try {
    await emitOsEvent({
      type: 'product.updated',
      source_table: 'inventory_stock',
      source_id: targetSku || templateIdStr,
      payload: {
        sku: targetSku,
        template_id: templateIdStr || null,
        nombre: payload.nombre_base,
        precio_venta: payload.precio_venta,
        costo_unitario: payload.costo_unitario,
        activo: payload.active
      }
    });
  } catch {}

  return { success: true };
}

/**
 * Eliminar o Desactivar un producto de forma real en Supabase
 */
export async function deleteProductItem(params: {
  sku?: string | null;
  template_id?: string | number | null;
  hardDelete: boolean;
  nombre?: string;
  precio_venta?: number;
  costo_unitario?: number;
  image_url?: string | null;
}): Promise<{ success: boolean; error?: string; needsSqlRepair?: boolean }> {
  const skuClean = normalizeSku(params.sku);
  const templateIdStr =
    params.template_id !== undefined && params.template_id !== null
      ? String(params.template_id).trim()
      : '';

  if (!params.hardDelete) {
    // Soft-delete: Desactivar en inventory_stock (upsert si era legacy) y en productos
    const errors: string[] = [];
    const targetSku = skuClean || (templateIdStr ? `PROD-${templateIdStr}` : '');

    if (targetSku) {
      const { error } = await upsertInventoryStockRow(targetSku, {
        nombre: params.nombre?.trim() || targetSku,
        template_id: templateIdStr || null,
        precio_venta: Math.max(Number(params.precio_venta) || 0, 0),
        costo_unitario: Math.max(Number(params.costo_unitario) || 0, 0),
        image_url: params.image_url || null,
        activo: false,
        activo_todd: false,
        updated_at: new Date().toISOString()
      });
      if (error) errors.push(error.message);

      localStock = localStock.map(item =>
        normalizeSku(item.sku) === targetSku ? { ...item, activo: false, activo_todd: false } : item
      );
    }

    if (templateIdStr && /^\d+$/.test(templateIdStr)) {
      await supabase.from('productos').update({ active: false }).eq('template_id', Number(templateIdStr));
    }

    if (skuClean || templateIdStr) {
      const key = skuClean || templateIdStr;
      const todd = getToddProductConfig(key);
      localStorage.setItem(`todd_cfg_${key}`, JSON.stringify({ ...todd, activo_todd: false }));
    }

    return errors.length > 0 ? { success: false, error: errors.join(' | ') } : { success: true };
  }

  // Hard-delete: Eliminar completamente
  let hardError: string | undefined;
  let needsSqlRepair = false;

  try {
    // 1. Intentar RPC atómico public.delete_inventory_product (elimina FK y todas las tablas como SECURITY DEFINER)
    const rpcRes = await (supabase as any).rpc('delete_inventory_product', {
      p_sku: skuClean || null,
      p_template_id: templateIdStr || null
    });

    if (rpcRes.error) {
      // 2. Fallback paso a paso en orden seguro de dependencias FK
      if (templateIdStr && /^\d+$/.test(templateIdStr)) {
        const numId = Number(templateIdStr);

        // Desvincular post_queue si apunta al template_id o a sus variantes
        try {
          await supabase.from('post_queue').update({ template_id: null }).eq('template_id', numId);
          const { data: varsToUnlink } = await supabase
            .from('productos_variantes')
            .select('variante_id')
            .eq('template_id', numId);
          const varIds = (varsToUnlink || []).map((v: any) => v.variante_id).filter(Boolean);
          if (varIds.length > 0) {
            await supabase.from('post_queue').update({ variante_id: null }).in('variante_id', varIds);
          }
        } catch {
          // ignorar si no existe o no aplica
        }

        // Intentar eliminar variantes por template_id y por sku
        await supabase.from('productos_variantes').delete().eq('template_id', numId);
        if (skuClean) {
          await supabase.from('productos_variantes').delete().eq('sku', skuClean);
        }

        // Verificar si aún quedan variantes bloqueadas por RLS (Supabase devuelve error: null con 0 filas borradas)
        const { data: remainingVars } = await supabase
          .from('productos_variantes')
          .select('variante_id')
          .eq('template_id', numId)
          .limit(1);

        if (remainingVars && remainingVars.length > 0) {
          return {
            success: false,
            needsSqlRepair: true,
            error:
              'La tabla legacy "productos_variantes" tiene variantes protegidas por RLS/FK (productos_variantes_template_id_fkey). Ejecuta el Script SQL Sprint 10 (botón </> SQL) en Supabase o usa "Desactivar / Pausar".'
          };
        }

        // Eliminar registro padre en public.productos
        const delProd = await supabase.from('productos').delete().eq('template_id', numId);
        if (delProd.error && !delProd.error.message.includes('does not exist')) {
          const msg = delProd.error.message || '';
          if (
            msg.includes('productos_variantes_template_id_fkey') ||
            msg.includes('foreign key constraint') ||
            msg.includes('row-level security')
          ) {
            return {
              success: false,
              needsSqlRepair: true,
              error:
                'Bloqueo FK/RLS en "productos_variantes" / "productos". Ejecuta el Script SQL Sprint 10 (botón </> SQL) en Supabase para habilitar ON DELETE CASCADE y borrado atómico, o usa "Desactivar / Pausar".'
            };
          }
          hardError = msg;
        }
      }

      if (skuClean) {
        await supabase.from('productos_variantes').delete().eq('sku', skuClean);
        await supabase.from('inventory_cache').delete().eq('sku', skuClean);

        const delKardex = await supabase.from('inventory_kardex').delete().eq('sku', skuClean);
        if (delKardex.error && !delKardex.error.message.includes('does not exist')) {
          console.warn('Error eliminando kardex:', delKardex.error.message);
        }

        const delStock = await supabase.from('inventory_stock').delete().eq('sku', skuClean);
        if (delStock.error && !delStock.error.message.includes('does not exist')) {
          hardError = hardError || delStock.error.message;
        }
      }

      if (templateIdStr) {
        const delStockByTpl = await supabase.from('inventory_stock').delete().eq('template_id', templateIdStr);
        if (delStockByTpl.error && !delStockByTpl.error.message.includes('does not exist')) {
          hardError = hardError || delStockByTpl.error.message;
        }
      }
    }
  } catch (err: any) {
    hardError = err?.message || 'Error al eliminar producto de Supabase.';
  }

  if (hardError) {
    if (
      hardError.includes('productos_variantes_template_id_fkey') ||
      hardError.includes('foreign key') ||
      hardError.includes('permission')
    ) {
      needsSqlRepair = true;
    }
    return { success: false, error: hardError, needsSqlRepair };
  }

  // Limpiar caches locales
  if (skuClean) {
    localStock = localStock.filter(i => normalizeSku(i.sku) !== skuClean);
    localKardex = localKardex.filter(k => normalizeSku(k.sku) !== skuClean);
    localStorage.removeItem(`todd_cfg_${skuClean}`);
  }
  if (templateIdStr) {
    localStock = localStock.filter(i => String(i.template_id) !== templateIdStr);
    localStorage.removeItem(`todd_cfg_${templateIdStr}`);
  }

  try {
    await emitOsEvent({
      type: 'inventory.adjustment',
      source_table: 'inventory_stock',
      source_id: skuClean || templateIdStr,
      payload: {
        sku: skuClean || null,
        template_id: templateIdStr || null,
        accion: 'producto_eliminado'
      }
    });
  } catch {}

  return { success: true };
}

/**
 * Crear o registrar un producto nuevo en el Catálogo e Inventario Nativo
 */
export async function saveProductItem(
  product: ProductFormData
): Promise<{ success: boolean; error?: string; warning?: string; item?: StockItem }> {
  const sku = normalizeSku(product.sku);
  const nombre = product.nombre.trim();
  const stockInicial = Math.max(Math.round(Number(product.stock_inicial) || 0), 0);
  const precioVenta = Math.max(Number(product.precio_venta) || 0, 0);
  const costoUnitario = Math.max(Number(product.costo_unitario) || 0, 0);
  const stockMinimo = Math.max(Math.round(Number(product.stock_minimo) || 5), 0);

  if (!sku || !nombre) {
    return { success: false, error: 'El nombre y el SKU del producto son obligatorios.' };
  }

  // 1. Verificar que no exista ya ese SKU en inventory_stock
  const { data: existingSku } = await supabase
    .from('inventory_stock')
    .select('sku')
    .eq('sku', sku)
    .maybeSingle();

  if (existingSku) {
    return {
      success: false,
      error: `El SKU "${sku}" ya existe en tu inventario. Edítalo o usa "+ Ingresar Stock" para sumarle unidades.`
    };
  }

  // 2. Generar template_id numérico único seguro para compatibilidad con public.productos (integer/bigint)
  const numericTemplateId = Math.floor(Date.now() / 1000);

  // 3. Insertar en inventory_stock (con stock_fisico = 0 primero si luego registramos movimiento inicial,
  //    o con stockInicial directo si falla el kardex)
  const stockPayload: Record<string, any> = {
    sku,
    nombre,
    template_id: String(numericTemplateId),
    precio_venta: precioVenta,
    costo_unitario: costoUnitario,
    stock_fisico: stockInicial,
    stock_reservado: 0,
    stock_minimo_alerta: stockMinimo,
    ubicacion: product.ubicacion?.trim() || 'Bodega Central',
    activo: true,
    image_url: product.image_url?.trim() || null,
    todd_pitch: product.todd_pitch?.trim() || '',
    todd_keywords: product.todd_keywords?.trim() || '',
    activo_todd: true,
    categoria: product.categoria?.trim() || 'General',
    updated_at: new Date().toISOString()
  };

  let { error: insertErr } = await supabase
    .from('inventory_stock')
    .insert(stockPayload);

  // Si aún no corren el SQL Sprint 10 (y faltan columnas nuevas), reintentar con columnas Sprint 3 base
  if (insertErr && insertErr.message?.includes('column')) {
    const basePayload = {
      sku,
      nombre,
      template_id: String(numericTemplateId),
      precio_venta: precioVenta,
      costo_unitario: costoUnitario,
      stock_fisico: stockInicial,
      stock_reservado: 0,
      stock_minimo_alerta: stockMinimo,
      ubicacion: product.ubicacion?.trim() || 'Bodega Central',
      activo: true,
      image_url: product.image_url?.trim() || null,
      updated_at: new Date().toISOString()
    };
    const retry = await supabase.from('inventory_stock').insert(basePayload);
    insertErr = retry.error;
  }

  if (insertErr) {
    return {
      success: false,
      error: `Error al guardar en Supabase (inventory_stock): ${insertErr.message}`
    };
  }

  // 4. Si tiene stock inicial > 0, registrar asiento en el Kárdex SIN duplicar el stock físico
  if (stockInicial > 0) {
    const { error: kardexErr } = await supabase.from('inventory_kardex').insert({
      sku,
      tipo_movimiento: 'inventario_inicial',
      cantidad: stockInicial,
      costo_unitario: costoUnitario,
      saldo_fisico: stockInicial,
      motivo: 'Stock inicial al crear producto',
      source_table: 'catalogo_creacion',
      usuario: 'Panel Admin'
    });

    if (kardexErr) {
      await supabase.from('inventory_kardex').insert({
        sku,
        tipo_movimiento: 'ajuste_positivo',
        cantidad: stockInicial,
        costo_unitario: costoUnitario,
        saldo_fisico: stockInicial,
        motivo: '[Inventario Inicial] Stock inicial al crear producto',
        source_table: 'catalogo_creacion',
        usuario: 'Panel Admin'
      });
    }
  }

  // 5. Sincronizar con tabla legacy public.productos usando template_id numérico seguro
  let warning: string | undefined;
  try {
    const prodInsert = await supabase.from('productos').insert({
      template_id: numericTemplateId,
      nombre_base: nombre,
      image_url: product.image_url?.trim() || null,
      active: true,
      is_published: true
    });
    if (prodInsert.error) {
      // No fallar la creación si la tabla legacy tiene restricciones distintas
      console.info('Sincronización opcional con public.productos omitida:', prodInsert.error.message);
    }
  } catch {
    // opcional
  }

  // 6. Guardar Todd config en localStorage
  localStorage.setItem(
    `todd_cfg_${sku}`,
    JSON.stringify({
      todd_pitch: product.todd_pitch || '',
      todd_instrucciones: product.todd_instrucciones || '',
      todd_keywords: product.todd_keywords || '',
      activo_todd: true
    })
  );

  const createdItem: StockItem = {
    sku,
    nombre,
    template_id: String(numericTemplateId),
    stock_fisico: stockInicial,
    stock_reservado: 0,
    stock_disponible: stockInicial,
    costo_unitario: costoUnitario,
    precio_venta: precioVenta,
    stock_minimo_alerta: stockMinimo,
    ubicacion: product.ubicacion?.trim() || 'Bodega Central',
    activo: true,
    image_url: product.image_url?.trim() || null,
    todd_pitch: product.todd_pitch || '',
    todd_keywords: product.todd_keywords || '',
    activo_todd: true,
    categoria: product.categoria || 'General',
    updated_at: new Date().toISOString()
  };

  localStock.push(createdItem);

  try {
    await emitOsEvent({
      type: 'product.created',
      source_table: 'inventory_stock',
      source_id: sku,
      payload: {
        sku,
        nombre,
        precio_venta: precioVenta,
        costo_unitario: costoUnitario,
        stock_inicial: stockInicial
      }
    });
  } catch {}

  return { success: true, warning, item: createdItem };
}

/* ============================================================================
 * INTEGRACIÓN PEDIDOS <-> INVENTARIO & KÁRDEX (BODEGA + CONTRA ENTREGA)
 * ========================================================================== */

export interface OrderForInventory {
  id: string;
  sku?: string | null;
  catalogo_sku?: string | null;
  codigo_anuncio?: string | null;
  estado?: string | null;
  created_at?: string | null;
  items?: any;
  cantidad?: number | null;
  nombre_cliente?: string | null;
}

export interface ResolvedOrderLine {
  sku: string;
  cantidad: number;
  itemStock: StockItem;
}

export interface OrderLedgerState {
  reservedNet: number;
  soldNet: number;
  damagedNet: number;
}

/**
 * Extrae la cantidad de unidades de un pedido desde items[], cantidad o patrones como "2x ..."
 */
export function extractOrderQuantity(order: Pick<OrderForInventory, 'items' | 'cantidad' | 'sku'>): number {
  if (order.cantidad !== undefined && order.cantidad !== null && Number(order.cantidad) > 0) {
    return Math.min(Math.max(Math.round(Number(order.cantidad)), 1), 100);
  }

  if (Array.isArray(order.items) && order.items.length > 0) {
    const sum = order.items.reduce((acc: number, it: any) => {
      const q = Number(it?.cantidad ?? it?.qty ?? 1);
      return acc + (Number.isFinite(q) && q > 0 ? Math.round(q) : 1);
    }, 0);
    if (sum > 0) return Math.min(sum, 100);
  }

  const raw = String(order.sku || '').trim();
  const multMatch =
    raw.match(/(?:^|\s)(\d+)\s*x(?:\s|$)/i) ||
    raw.match(/(?:combo|promo|pack)\s+(?:de\s+)?(\d+)\b/i);
  if (multMatch && multMatch[1]) {
    const n = Number(multMatch[1]);
    if (n >= 1 && n <= 50) return n;
  }

  return 1;
}

/**
 * Resuelve las líneas de SKU reales existentes en inventory.stock para un pedido.
 * Nunca inventa SKUs nuevos si el pedido trae texto libre no mapeado.
 */
export function resolveOrderInventoryLines(
  order: OrderForInventory,
  stockItems: StockItem[]
): ResolvedOrderLine[] {
  if (!stockItems || stockItems.length === 0) return [];

  const stockMap = new Map<string, StockItem>();
  stockItems.forEach(item => {
    stockMap.set(normalizeSku(item.sku), item);
  });
  const knownSkus = Array.from(stockMap.keys());
  const aggregated = new Map<string, ResolvedOrderLine>();

  const addLine = (skuCandidate: string | null, qty: number) => {
    if (!skuCandidate) return;
    const clean = normalizeSku(skuCandidate);
    const stockRow = stockMap.get(clean);
    if (!stockRow) return;
    const existing = aggregated.get(clean);
    if (existing) {
      existing.cantidad += qty;
    } else {
      aggregated.set(clean, { sku: clean, cantidad: Math.max(1, Math.round(qty)), itemStock: stockRow });
    }
  };

  if (Array.isArray(order.items) && order.items.length > 0) {
    for (const it of order.items) {
      const rawItSku = it?.catalogo_sku || it?.sku || it?.nombre || order.sku;
      const qty = Math.min(Math.max(Math.round(Number(it?.cantidad ?? it?.qty ?? 1) || 1), 1), 100);
      const resolved = resolveCatalogSku(
        rawItSku,
        order.codigo_anuncio,
        it?.catalogo_sku || order.catalogo_sku,
        knownSkus
      );
      if (resolved) addLine(resolved, qty);
    }
  }

  if (aggregated.size === 0) {
    const resolved = resolveCatalogSku(
      order.sku,
      order.codigo_anuncio,
      order.catalogo_sku,
      knownSkus
    );
    if (resolved) {
      addLine(resolved, extractOrderQuantity(order));
    }
  }

  return Array.from(aggregated.values());
}

/**
 * Calcula el balance neto (reservado activo, vendido descontado, merma) de un pedido según su historial en Kárdex
 */
export function computeOrderLedgerFromMovements(
  movements: KardexMovement[],
  skuFilter?: string
): OrderLedgerState {
  let reserved = 0;
  let sold = 0;
  let damaged = 0;

  const targetSku = skuFilter ? normalizeSku(skuFilter) : null;
  const sorted = [...movements].sort((a, b) => {
    const ta = new Date(a.created_at).getTime() || 0;
    const tb = new Date(b.created_at).getTime() || 0;
    return ta !== tb ? ta - tb : (a.id || 0) - (b.id || 0);
  });

  for (const m of sorted) {
    if (targetSku && normalizeSku(m.sku) !== targetSku) continue;
    const qty = Math.abs(Number(m.cantidad) || 0);
    if (qty === 0) continue;

    if (m.tipo_movimiento === 'reserva_pedido') {
      reserved += qty;
    } else if (
      m.tipo_movimiento === 'liberar_reserva' ||
      (m.tipo_movimiento === 'ajuste_positivo' && (m.motivo || '').startsWith('[Liberación Reserva]'))
    ) {
      reserved = Math.max(0, reserved - qty);
    } else if (m.tipo_movimiento === 'venta_salida') {
      sold += qty;
      reserved = Math.max(0, reserved - qty);
    } else if (m.tipo_movimiento === 'devolucion_entrada') {
      sold = Math.max(0, sold - qty);
      reserved = Math.max(0, reserved - qty);
    } else if (m.tipo_movimiento === 'merma_dano') {
      damaged += qty;
      reserved = Math.max(0, reserved - qty);
    }
  }

  return { reservedNet: reserved, soldNet: sold, damagedNet: damaged };
}

/**
 * Obtiene un mapa order_id -> movimientos del Kárdex para pintar badges visuales en Pedidos
 */
export async function fetchOrderKardexMap(): Promise<Record<string, KardexMovement[]>> {
  const map: Record<string, KardexMovement[]> = {};
  try {
    const { data, error } = await supabase
      .from('inventory_kardex')
      .select('*')
      .eq('source_table', 'whatsapp_orders')
      .order('created_at', { ascending: true })
      .limit(800);

    if (!error && Array.isArray(data)) {
      for (const row of data as KardexMovement[]) {
        if (!row.source_id) continue;
        if (!map[row.source_id]) map[row.source_id] = [];
        map[row.source_id].push(row);
      }
    }
  } catch {
    // ignorar si aún no existe tabla
  }
  return map;
}

export interface SyncOrderInventoryResult {
  success: boolean;
  skipped: boolean;
  reason?: string;
  actions: Array<{ sku: string; tipo: KardexMovementType; cantidad: number }>;
  summaryText: string;
  error?: string;
}

/**
 * Sincroniza atómicamente el inventario cuando un pedido cambia de estado:
 * - nuevo / programado: sin reserva (si retrocede desde empaque, libera reserva)
 * - por_empacar / en_camino: reserva unidades (stock_reservado += N) sin duplicar
 * - entregado: descuenta físico (venta_salida) consumiendo la reserva del pedido
 * - cancelado: libera reserva si venía de empaque/ruta; reingresa físico SOLO si venía de entregado
 */
export async function syncOrderInventoryOnStatusChange(params: {
  order: OrderForInventory;
  prevEstado: string | null | undefined;
  nextEstado: string;
  reingresarStock?: boolean;
  esMerma?: boolean;
  motivoCancelacion?: string;
  usuario?: string;
  stockItemsCache?: StockItem[];
  forzarHistorico?: boolean;
}): Promise<SyncOrderInventoryResult> {
  const { order, nextEstado } = params;
  const prevNorm = (params.prevEstado || 'nuevo').trim().toLowerCase();
  const nextNorm = (nextEstado || 'nuevo').trim().toLowerCase();
  const shortId = order.id.slice(0, 8).toUpperCase();
  const usuario = params.usuario || 'Panel Pedidos';

  // Blindaje histórico: si el pedido es anterior a la fecha de corte/reinicio de inventario,
  // nunca reserva ni descuenta del inventario nuevo a menos que se fuerce explícitamente.
  const invCutoff = getInventoryCutoffDate();
  if (!params.forzarHistorico && invCutoff && isOrderBeforeCutoff(order.created_at, invCutoff)) {
    return {
      success: true,
      skipped: true,
      reason: 'historical_cutoff',
      actions: [],
      summaryText: 'Pedido histórico pre-reinicio: protegido (no descuenta inventario nuevo)'
    };
  }

  let stockList = params.stockItemsCache;
  if (!stockList || stockList.length === 0) {
    const res = await fetchStockItems();
    stockList = res.items;
  }

  const lines = resolveOrderInventoryLines(order, stockList);
  if (lines.length === 0) {
    return {
      success: true,
      skipped: true,
      reason: 'unmapped_sku',
      actions: [],
      summaryText: 'Sin SKU vinculado en inventario'
    };
  }

  // Consultar movimientos previos exactos de este pedido para garantizar idempotencia
  let existingMovs: KardexMovement[] = [];
  try {
    const { data } = await supabase
      .from('inventory_kardex')
      .select('*')
      .eq('source_table', 'whatsapp_orders')
      .eq('source_id', order.id)
      .order('created_at', { ascending: true });
    if (Array.isArray(data)) {
      existingMovs = data as KardexMovement[];
    }
  } catch {
    // continuar con array vacío
  }

  const actions: Array<{ sku: string; tipo: KardexMovementType; cantidad: number }> = [];
  const errors: string[] = [];

  const runMov = async (
    sku: string,
    tipo: KardexMovementType,
    cantidad: number,
    motivo: string,
    costoUnitario = 0
  ) => {
    const res = await executeMovementInDb({
      sku,
      tipo_movimiento: tipo,
      cantidad,
      costo_unitario: costoUnitario,
      motivo,
      source_table: 'whatsapp_orders',
      source_id: order.id,
      usuario
    });
    if (res.success) {
      actions.push({ sku, tipo, cantidad });
    } else if (res.error) {
      errors.push(`${sku}: ${res.error}`);
    }
  };

  for (const line of lines) {
    const { sku, cantidad, itemStock } = line;
    const ledger = computeOrderLedgerFromMovements(existingMovs, sku);

    if (nextNorm === 'nuevo' || nextNorm === 'programado') {
      if (ledger.soldNet > 0) {
        await runMov(
          sku,
          'devolucion_entrada',
          ledger.soldNet,
          `Reversión de entrega pedido #${shortId} (${order.nombre_cliente || 'Cliente'})`,
          itemStock.costo_unitario
        );
      } else if (ledger.reservedNet > 0) {
        await runMov(
          sku,
          'liberar_reserva',
          ledger.reservedNet,
          `Liberación de reserva pedido #${shortId} devuelto a ${nextNorm === 'programado' ? 'Encargo' : 'Nuevo'}`
        );
      }
    } else if (nextNorm === 'por_empacar' || nextNorm === 'en_camino') {
      if (ledger.soldNet > 0) {
        await runMov(
          sku,
          'devolucion_entrada',
          ledger.soldNet,
          `Reingreso por retorno a ${nextNorm === 'en_camino' ? 'Ruta' : 'Empaque'} #${shortId}`,
          itemStock.costo_unitario
        );
      }
      const neededReserve = Math.max(cantidad - ledger.reservedNet, 0);
      if (neededReserve > 0) {
        await runMov(
          sku,
          'reserva_pedido',
          neededReserve,
          `Reserva en ${nextNorm === 'por_empacar' ? 'Empaque' : 'Ruta'} pedido #${shortId} (${order.nombre_cliente || 'Cliente'})`
        );
      }
    } else if (nextNorm === 'entregado') {
      const neededSell = Math.max(cantidad - ledger.soldNet, 0);
      if (neededSell > 0) {
        // Si saltó directo a entregado sin pasar por empaque/ruta, reservamos primero
        // para que venta_salida no consuma reservas de otros pedidos activos.
        const missingReserve = Math.max(neededSell - ledger.reservedNet, 0);
        if (missingReserve > 0) {
          await runMov(
            sku,
            'reserva_pedido',
            missingReserve,
            `Auto-reserva previa a entrega directa #${shortId}`
          );
        }
        await runMov(
          sku,
          'venta_salida',
          neededSell,
          `Venta entregada pedido #${shortId} (${order.nombre_cliente || 'Cliente'})`,
          itemStock.costo_unitario
        );
      }
    } else if (nextNorm === 'cancelado') {
      const motivoTxt = params.motivoCancelacion || 'Cancelación / Novedad';
      const debeReingresar = params.reingresarStock !== false;

      if (ledger.soldNet > 0) {
        if (!params.esMerma && debeReingresar) {
          await runMov(
            sku,
            'devolucion_entrada',
            ledger.soldNet,
            `Devolución post-entrega #${shortId} (${motivoTxt})`,
            itemStock.costo_unitario
          );
        }
      } else if (ledger.reservedNet > 0) {
        if (params.esMerma) {
          await runMov(
            sku,
            'liberar_reserva',
            ledger.reservedNet,
            `Liberar reserva por merma #${shortId} (${motivoTxt})`
          );
          await runMov(
            sku,
            'merma_dano',
            ledger.reservedNet,
            `Producto dañado en devolución #${shortId} (${motivoTxt})`,
            itemStock.costo_unitario
          );
        } else if (debeReingresar) {
          await runMov(
            sku,
            'liberar_reserva',
            ledger.reservedNet,
            `Reserva liberada a bodega por devolución #${shortId} (${motivoTxt})`
          );
        }
      } else if ((prevNorm === 'por_empacar' || prevNorm === 'en_camino') && debeReingresar) {
        // Pedido legado (anterior a Sprint 12) que estaba empacado sin asiento previo en Kárdex
        const reservableFallback = Math.min(cantidad, Math.max(itemStock.stock_reservado || 0, 0));
        if (reservableFallback > 0) {
          await runMov(
            sku,
            'liberar_reserva',
            reservableFallback,
            `Reserva liberada por devolución #${shortId} (${motivoTxt})`
          );
        }
        if (params.esMerma) {
          await runMov(
            sku,
            'merma_dano',
            cantidad,
            `Producto dañado en devolución #${shortId} (${motivoTxt})`,
            itemStock.costo_unitario
          );
        }
      }
    }
  }

  // Si hubo venta o devolución de una variante específica (color/talla), ajustar también public.productos_variantes + Bot Todd
  if (actions.length > 0 && Array.isArray(order.items) && order.items.length > 0) {
    for (const a of actions) {
      if (a.tipo === 'venta_salida' || a.tipo === 'devolucion_entrada') {
        const matchedItem = order.items.find((it: any) =>
          (it?.variante_id || it?.variante_sku || it?.color || it?.talla) &&
          (!it?.catalogo_sku || normalizeSku(it.catalogo_sku) === a.sku)
        );
        if (matchedItem) {
          const delta = a.tipo === 'venta_salida' ? -a.cantidad : a.cantidad;
          try {
            await applyVariantStockDelta({
              masterSku: a.sku,
              varianteId: matchedItem.variante_id ? Number(matchedItem.variante_id) : undefined,
              varianteSku: matchedItem.variante_sku || undefined,
              color: matchedItem.color || undefined,
              talla: matchedItem.talla || undefined,
              delta
            });
          } catch {
            // no bloquear flujo principal de pedidos
          }
        }
      }
    }
  }

  // Construir mensaje amigable de resumen
  let summaryText = 'Sin cambios de inventario';
  if (actions.length > 0) {
    const first = actions[0];
    const totalUds = actions.reduce((s, a) => s + a.cantidad, 0);
    if (actions.some(a => a.tipo === 'merma_dano')) {
      summaryText = `⚠️ ${totalUds}x ${first.sku} registrado como Merma/Daño`;
    } else if (actions.some(a => a.tipo === 'venta_salida')) {
      summaryText = `✅ ${totalUds}x ${first.sku} descontado de Bodega (Kárdex)`;
    } else if (actions.some(a => a.tipo === 'devolucion_entrada')) {
      summaryText = `↩️ +${totalUds}x ${first.sku} reingresado a Bodega`;
    } else if (actions.some(a => a.tipo === 'liberar_reserva')) {
      summaryText = `🔓 ${totalUds}x ${first.sku} liberado a Stock Disponible`;
    } else if (actions.some(a => a.tipo === 'reserva_pedido')) {
      summaryText = `🔒 ${totalUds}x ${first.sku} reservado para empaque`;
    }
  }

  return {
    success: errors.length === 0,
    skipped: actions.length === 0,
    actions,
    summaryText,
    error: errors.length > 0 ? errors.join(' | ') : undefined
  };
}

/* ============================================================================
 * VARIANTES DE PRODUCTOS (COLOR, TALLA, STOCK POR VARIANTE & BOT TODD)
 * ========================================================================== */

const TODD_VARIANTS_MARKER = '[VARIANTES_DISPONIBLES]:';

function slugToken(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 18);
}

export function buildVariantSku(baseSku: string, color?: string, talla?: string): string {
  const parts = [normalizeSku(baseSku)];
  const c = slugToken(color || '');
  const t = slugToken(talla || '');
  if (c && c !== 'ESTANDAR' && c !== 'UNICO') parts.push(c);
  if (t && t !== 'UNICA' && t !== 'ESTANDAR') parts.push(t);
  if (parts.length === 1) parts.push('STD');
  return parts.join('-');
}

function generateSafeInt4Id(): number {
  return Math.floor(100_000_000 + Math.random() * 1_850_000_000);
}

/**
 * Quita el bloque autogenerado de variantes para preservar las instrucciones manuales del usuario.
 */
export function stripVariantToddBlock(text: string | null | undefined): string {
  const raw = (text || '').trim();
  const idx = raw.indexOf(TODD_VARIANTS_MARKER);
  if (idx === -1) return raw;
  return raw.slice(0, idx).trim();
}

/**
 * Genera el resumen legible de colores, tallas, precios y stock para Bot Todd y palabras clave.
 */
export function sanitizeToddInstructionsForPrivacy(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .replace(/:\s*\d+\s*uds\b/gi, ': Disponible')
    .replace(/\b\d+\s*uds\b/gi, 'Disponible');
}

export function formatVariantsForTodd(
  variants: ProductVariant[],
  basePrice = 0,
  options?: { allowBackorder?: boolean; hideExactCounts?: boolean }
): {
  summaryBlock: string;
  bulletLines: string[];
  keywordsExtra: string[];
  totalStock: number;
} {
  const activeVars = variants.filter(v => v.estado !== 'PAUSADO');
  const totalStock = activeVars.reduce((acc, v) => acc + Math.max(Number(v.stock) || 0, 0), 0);
  const hideCounts = options?.hideExactCounts !== false;
  const allowBackorder = Boolean(options?.allowBackorder);

  if (activeVars.length === 0) {
    return { summaryBlock: '', bulletLines: [], keywordsExtra: [], totalStock: 0 };
  }

  const kwSet = new Set<string>();
  const bulletLines = activeVars.map(v => {
    const colorTxt = (v.color || '').trim();
    const tallaTxt = (v.talla || '').trim();
    if (colorTxt) kwSet.add(colorTxt.toLowerCase());
    if (tallaTxt && tallaTxt.toLowerCase() !== 'única' && tallaTxt.toLowerCase() !== 'unica') {
      kwSet.add(`talla ${tallaTxt.toLowerCase()}`);
    }
    const labelParts = [colorTxt, tallaTxt && tallaTxt.toLowerCase() !== 'única' ? `Talla ${tallaTxt}` : ''].filter(Boolean);
    const label = labelParts.join(' · ') || 'Estándar';
    const qty = Math.max(Number(v.stock) || 0, 0);
    const price = Number(v.precio) > 0 ? Number(v.precio) : basePrice;
    const priceTag = price > 0 ? ` ($${price.toFixed(2)})` : '';
    const isAvailable = qty > 0 || allowBackorder;
    if (!isAvailable) return `${label}: Agotado`;
    return hideCounts ? `${label}: Disponible${priceTag}` : `${label}: ${qty} uds${priceTag}`;
  });

  const summaryBlock = `${TODD_VARIANTS_MARKER} ${bulletLines.join(' | ')}`;
  return {
    summaryBlock,
    bulletLines,
    keywordsExtra: Array.from(kwSet),
    totalStock
  };
}

/**
 * Garantiza que exista una fila padre válida en public.productos con template_id int4
 * para que la FK de public.productos_variantes nunca falle.
 */
export async function ensureProductTemplateExists(params: {
  sku: string;
  template_id?: string | number | null;
  nombre: string;
  image_url?: string | null;
  todd_pitch?: string;
  todd_instrucciones?: string;
  todd_keywords?: string;
  activo?: boolean;
  activo_todd?: boolean;
}): Promise<{ templateId: number | null; error?: string }> {
  const rawTpl = params.template_id !== undefined && params.template_id !== null
    ? String(params.template_id).trim()
    : '';
  let numericId = /^\d+$/.test(rawTpl) ? Number(rawTpl) : 0;

  if (numericId > 0 && numericId <= 2_147_483_647) {
    const { data: existing } = await supabase
      .from('productos')
      .select('template_id')
      .eq('template_id', numericId)
      .maybeSingle();

    if (existing?.template_id) {
      return { templateId: Number(existing.template_id) };
    }
  } else {
    numericId = Math.min(Math.floor(Date.now() / 1000), 2_147_483_647);
  }

  const insertPayload: Record<string, any> = {
    template_id: numericId,
    nombre_base: params.nombre || params.sku,
    image_url: params.image_url || null,
    active: params.activo !== false,
    is_published: params.activo !== false,
    todd_pitch: params.todd_pitch || '',
    todd_instrucciones: params.todd_instrucciones || '',
    todd_keywords: params.todd_keywords || '',
    activo_todd: params.activo_todd !== false
  };

  let res = await supabase.from('productos').insert(insertPayload);
  if (res.error && res.error.message?.includes('column')) {
    res = await supabase.from('productos').insert({
      template_id: numericId,
      nombre_base: params.nombre || params.sku,
      image_url: params.image_url || null,
      active: params.activo !== false,
      is_published: params.activo !== false
    });
  }

  // Si hubo colisión de PK con otro producto, generar otro template_id int4
  if (res.error && (res.error.code === '23505' || res.error.message?.includes('duplicate'))) {
    numericId = generateSafeInt4Id();
    res = await supabase.from('productos').insert({
      template_id: numericId,
      nombre_base: params.nombre || params.sku,
      image_url: params.image_url || null,
      active: params.activo !== false,
      is_published: params.activo !== false
    });
  }

  if (res.error) {
    return { templateId: null, error: res.error.message };
  }

  if (params.sku) {
    await upsertInventoryStockRow(params.sku, { template_id: String(numericId) });
  }

  return { templateId: numericId };
}

/**
 * Consulta variantes de public.productos_variantes (todas o por template_id)
 */
export async function fetchProductVariants(templateId?: string | number | null): Promise<ProductVariant[]> {
  try {
    let query = supabase
      .from('productos_variantes')
      .select('*')
      .order('color', { ascending: true })
      .order('talla', { ascending: true });

    if (templateId !== undefined && templateId !== null && String(templateId).trim() !== '') {
      query = query.eq('template_id', Number(templateId));
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data)) return [];
    return data.map((v: any) => ({
      variante_id: Number(v.variante_id),
      template_id: Number(v.template_id),
      sku: normalizeSku(v.sku),
      nombre_completo: v.nombre_completo || v.sku || '',
      color: v.color || '',
      talla: v.talla || 'Única',
      stock: Math.max(Number(v.stock) || 0, 0),
      precio: Number(v.precio) || 0,
      estado: v.estado || (Number(v.stock) > 0 ? 'DISPONIBLE' : 'NO_DISPONIBLE'),
      es_test: Boolean(v.es_test),
      image_url: v.image_url || null,
      updated_at: v.updated_at
    }));
  } catch {
    return [];
  }
}

/**
 * Sincroniza variantes -> inventory_cache (para Bot Todd),
 * Sumatoria de unidades -> stock_fisico del Producto Maestro en inventory_stock + Kárdex,
 * y Resumen de colores/tallas/stock -> todd_instrucciones & todd_keywords.
 */
export async function syncVariantsToMasterAndTodd(params: {
  masterSku: string;
  templateId: number;
  productName: string;
  basePrice?: number;
  syncMasterStock?: boolean;
  syncToddDetails?: boolean;
  allowBackorder?: boolean;
  hideExactCounts?: boolean;
}): Promise<{ variants: ProductVariant[]; totalStock: number }> {
  const masterSkuClean = normalizeSku(params.masterSku);
  const variants = await fetchProductVariants(params.templateId);
  const totalStock = variants
    .filter(v => v.estado !== 'PAUSADO')
    .reduce((sum, v) => sum + Math.max(Number(v.stock) || 0, 0), 0);

  // 1. Sincronizar cada variante con public.inventory_cache para lectura instantánea de Todd
  for (const v of variants) {
    if (!v.sku) continue;
    const state = v.stock > 0 && v.estado !== 'PAUSADO' ? 'DISPONIBLE' : 'NO_DISPONIBLE';
    try {
      await supabase
        .from('inventory_cache')
        .upsert(
          {
            sku: v.sku,
            qty: Math.max(v.stock, 0),
            state,
            image_url: v.image_url || null,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'sku' }
        );
    } catch {
      // inventory_cache opcional
    }
  }

  // 2. Sincronizar stock físico maestro si tiene variantes (y registrar ajuste en Kárdex)
  if (params.syncMasterStock !== false && variants.length > 0 && masterSkuClean) {
    try {
      await adjustStock({
        sku: masterSkuClean,
        nuevo_stock: totalStock,
        motivo: `Sincronización automática desde variantes (${variants.length} color/talla)`
      });
    } catch {
      // no bloquear
    }
  }

  // 3. Alimentar detalles de Bot Todd en inventory_stock, public.productos y localStorage
  if (params.syncToddDetails !== false && masterSkuClean) {
    try {
      const { data: stockRow } = await supabase
        .from('inventory_stock')
        .select('todd_instrucciones, todd_keywords, todd_pitch, activo_todd, precio_venta')
        .eq('sku', masterSkuClean)
        .maybeSingle();

      const localCfg = getToddProductConfig(masterSkuClean);
      const baseInstr = stripVariantToddBlock(
        stockRow?.todd_instrucciones ?? localCfg.todd_instrucciones ?? ''
      );
      const toddCfg = getCachedToddCatalogSettings();
      const allowBackorder =
        params.allowBackorder ??
        (toddCfg.allowBackorderGlobal || toddCfg.backorderSkus.includes(masterSkuClean));
      const hideExactCounts = params.hideExactCounts ?? toddCfg.hideExactStockCounts;
      const formatted = formatVariantsForTodd(
        variants,
        params.basePrice ?? Number(stockRow?.precio_venta || 0),
        { allowBackorder, hideExactCounts }
      );

      const nextInstrucciones = formatted.summaryBlock
        ? (baseInstr ? `${baseInstr}\n${formatted.summaryBlock}` : formatted.summaryBlock)
        : baseInstr;

      const existingKw = (stockRow?.todd_keywords ?? localCfg.todd_keywords ?? '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean);
      const existingKwLower = new Set(existingKw.map((k: string) => k.toLowerCase()));
      formatted.keywordsExtra.forEach(kw => {
        if (!existingKwLower.has(kw.toLowerCase())) {
          existingKw.push(kw);
          existingKwLower.add(kw.toLowerCase());
        }
      });
      const nextKeywords = existingKw.join(', ');

      await updateProductDetails({
        sku: masterSkuClean,
        template_id: params.templateId,
        todd_instrucciones: nextInstrucciones,
        todd_keywords: nextKeywords
      });
    } catch {
      // no bloquear
    }
  }

  return { variants, totalStock };
}

/**
 * Crear una o varias variantes (color, talla, stock) para un producto del catálogo
 */
export async function createProductVariants(params: {
  masterSku: string;
  templateId?: string | number | null;
  productName: string;
  basePrice: number;
  productImage?: string | null;
  variantsToCreate: ProductVariantInput[];
  syncMasterStock?: boolean;
  syncToddDetails?: boolean;
}): Promise<{ success: boolean; error?: string; createdCount: number; templateId?: number }> {
  if (!params.variantsToCreate || params.variantsToCreate.length === 0) {
    return { success: false, error: 'Agrega al menos un color o talla.', createdCount: 0 };
  }

  const tplRes = await ensureProductTemplateExists({
    sku: params.masterSku,
    template_id: params.templateId,
    nombre: params.productName,
    image_url: params.productImage
  });

  if (!tplRes.templateId) {
    return {
      success: false,
      error: tplRes.error || 'No se pudo asegurar el producto padre en public.productos.',
      createdCount: 0
    };
  }

  const templateId = tplRes.templateId;
  const existing = await fetchProductVariants(templateId);
  const existingSkus = new Set(existing.map(v => v.sku.toUpperCase()));

  let createdCount = 0;
  const errors: string[] = [];

  for (const input of params.variantsToCreate) {
    const colorClean = (input.color || '').trim();
    const tallaClean = (input.talla || 'Única').trim() || 'Única';
    if (!colorClean && !tallaClean) continue;

    let varSku = normalizeSku(input.sku || buildVariantSku(params.masterSku, colorClean, tallaClean));
    if (existingSkus.has(varSku)) {
      varSku = `${varSku}-${Math.floor(10 + Math.random() * 89)}`;
    }
    existingSkus.add(varSku);

    const stockQty = Math.max(Math.round(Number(input.stock) || 0), 0);
    const precioVal = Math.max(Number(input.precio ?? params.basePrice) || 0, 0);
    const descParts = [colorClean, tallaClean !== 'Única' ? `Talla ${tallaClean}` : ''].filter(Boolean).join(' / ');
    const nombreCompleto = descParts ? `${params.productName} (${descParts})` : params.productName;

    const { error } = await supabase.from('productos_variantes').insert({
      variante_id: generateSafeInt4Id(),
      template_id: templateId,
      sku: varSku,
      nombre_completo: nombreCompleto,
      color: colorClean || 'Estándar',
      talla: tallaClean,
      stock: stockQty,
      precio: precioVal,
      estado: stockQty > 0 ? 'DISPONIBLE' : 'NO_DISPONIBLE',
      es_test: false,
      image_url: input.image_url || params.productImage || null,
      updated_at: new Date().toISOString()
    });

    if (error) {
      errors.push(`${colorClean || varSku}: ${error.message}`);
    } else {
      createdCount++;
    }
  }

  if (createdCount > 0) {
    await syncVariantsToMasterAndTodd({
      masterSku: params.masterSku,
      templateId,
      productName: params.productName,
      basePrice: params.basePrice,
      syncMasterStock: params.syncMasterStock,
      syncToddDetails: params.syncToddDetails
    });
  }

  if (errors.length > 0 && createdCount === 0) {
    return { success: false, error: errors.join(' | '), createdCount: 0, templateId };
  }

  return {
    success: true,
    createdCount,
    templateId,
    error: errors.length > 0 ? errors.join(' | ') : undefined
  };
}

/**
 * Actualizar stock, precio, color o talla de una variante y resincronizar Bodega + Bot Todd
 */
export async function updateProductVariant(params: {
  varianteId: number;
  masterSku: string;
  templateId: number;
  productName: string;
  basePrice?: number;
  patch: {
    color?: string;
    talla?: string;
    stock?: number;
    precio?: number;
    estado?: string;
  };
  syncMasterStock?: boolean;
  syncToddDetails?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  const updateObj: Record<string, any> = {
    updated_at: new Date().toISOString()
  };

  if (params.patch.color !== undefined) updateObj.color = params.patch.color.trim() || 'Estándar';
  if (params.patch.talla !== undefined) updateObj.talla = params.patch.talla.trim() || 'Única';
  if (params.patch.precio !== undefined) updateObj.precio = Math.max(Number(params.patch.precio) || 0, 0);
  if (params.patch.stock !== undefined) {
    const st = Math.max(Math.round(Number(params.patch.stock) || 0), 0);
    updateObj.stock = st;
    if (params.patch.estado === undefined) {
      updateObj.estado = st > 0 ? 'DISPONIBLE' : 'NO_DISPONIBLE';
    }
  }
  if (params.patch.estado !== undefined) updateObj.estado = params.patch.estado;

  const { error } = await supabase
    .from('productos_variantes')
    .update(updateObj)
    .eq('variante_id', params.varianteId);

  if (error) {
    return { success: false, error: error.message };
  }

  await syncVariantsToMasterAndTodd({
    masterSku: params.masterSku,
    templateId: params.templateId,
    productName: params.productName,
    basePrice: params.basePrice,
    syncMasterStock: params.syncMasterStock,
    syncToddDetails: params.syncToddDetails
  });

  return { success: true };
}

/**
 * Eliminar una variante de productos_variantes y resincronizar Bodega + Bot Todd
 */
export async function deleteProductVariant(params: {
  varianteId: number;
  variantSku?: string;
  masterSku: string;
  templateId: number;
  productName: string;
  basePrice?: number;
  syncMasterStock?: boolean;
  syncToddDetails?: boolean;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await supabase.from('post_queue').update({ variante_id: null }).eq('variante_id', params.varianteId);
  } catch {
    // opcional
  }

  const { error } = await supabase
    .from('productos_variantes')
    .delete()
    .eq('variante_id', params.varianteId);

  if (error) {
    return { success: false, error: error.message };
  }

  if (params.variantSku) {
    try {
      await supabase.from('inventory_cache').delete().eq('sku', normalizeSku(params.variantSku));
    } catch {}
  }

  await syncVariantsToMasterAndTodd({
    masterSku: params.masterSku,
    templateId: params.templateId,
    productName: params.productName,
    basePrice: params.basePrice,
    syncMasterStock: params.syncMasterStock,
    syncToddDetails: params.syncToddDetails
  });

  return { success: true };
}

/**
 * Ajusta el stock de una variante específica cuando se entrega o devuelve un pedido en Pedidos / Motorista.
 */
async function applyVariantStockDelta(params: {
  masterSku: string;
  varianteId?: number;
  varianteSku?: string;
  color?: string;
  talla?: string;
  delta: number;
}): Promise<void> {
  if (!params.delta) return;

  let target: any = null;
  if (params.varianteId) {
    const { data } = await supabase
      .from('productos_variantes')
      .select('*')
      .eq('variante_id', params.varianteId)
      .maybeSingle();
    target = data;
  } else if (params.varianteSku) {
    const { data } = await supabase
      .from('productos_variantes')
      .select('*')
      .eq('sku', normalizeSku(params.varianteSku))
      .maybeSingle();
    target = data;
  }

  if (!target || !target.variante_id) return;

  const nextStock = Math.max((Number(target.stock) || 0) + params.delta, 0);
  const nextEstado = nextStock > 0 ? 'DISPONIBLE' : 'NO_DISPONIBLE';

  await supabase
    .from('productos_variantes')
    .update({ stock: nextStock, estado: nextEstado, updated_at: new Date().toISOString() })
    .eq('variante_id', target.variante_id);

  if (target.sku) {
    try {
      await supabase
        .from('inventory_cache')
        .upsert(
          { sku: target.sku, qty: nextStock, state: nextEstado, updated_at: new Date().toISOString() },
          { onConflict: 'sku' }
        );
    } catch {}
  }

  if (target.template_id) {
    await syncVariantsToMasterAndTodd({
      masterSku: params.masterSku,
      templateId: Number(target.template_id),
      productName: target.nombre_completo || params.masterSku,
      syncMasterStock: false, // El Kárdex del pedido ya ajustó inventory.stock
      syncToddDetails: true
    });
  }
}


