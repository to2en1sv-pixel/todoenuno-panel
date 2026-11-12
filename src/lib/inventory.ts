import { supabase } from '@/lib/supabase';
import { emitOsEvent } from '@/lib/osEvents';
import { addManualTransaction } from '@/lib/finance';
import type { 
  StockItem, 
  KardexMovement, 
  EntradaMercaderiaFormData, 
  ProductFormData,
  KardexMovementType
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
