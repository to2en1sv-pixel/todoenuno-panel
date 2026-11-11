import { supabase } from '@/lib/supabase';
import { emitOsEvent } from '@/lib/osEvents';
import { addManualTransaction } from '@/lib/finance';
import type { 
  StockItem, 
  KardexMovement, 
  EntradaMercaderiaFormData, 
  ProductFormData 
} from '@/types/inventory';

// Almacén local de respaldo
let localStock: StockItem[] = [];
let localKardex: KardexMovement[] = [];

/**
 * Obtener todos los SKUs con sus niveles de stock físico, reservado y disponible
 */
export async function fetchStockItems(): Promise<{ items: StockItem[]; isRealDb: boolean }> {
  try {
    // 1. Intentar consultar vista nativa public.inventory_stock
    const { data, error } = await supabase
      .from('inventory_stock')
      .select('*')
      .order('nombre');

    if (!error && data && data.length > 0) {
      localStock = data as StockItem[];
      return { items: localStock, isRealDb: true };
    }

    // 2. Si no hay tabla nativa aún, combinar inventory_cache con productos_variantes (compatibilidad previa)
    const [resInv, resVar, resProd] = await Promise.all([
      supabase.from('inventory_cache').select('*'),
      supabase.from('productos_variantes').select('*'),
      supabase.from('productos').select('*')
    ]);

    if (!resInv.error && resInv.data && resInv.data.length > 0) {
      const prodMap = new Map<string, string>();
      (resProd.data || []).forEach((p: any) => prodMap.set(String(p.template_id), p.nombre_base));

      const varMap = new Map<string, any>();
      (resVar.data || []).forEach((v: any) => {
        if (v.sku) varMap.set(v.sku, v);
      });

      const fallbackItems: StockItem[] = resInv.data.map((ic: any) => {
        const v = varMap.get(ic.sku);
        const templateId = v?.template_id ? String(v.template_id) : null;
        const nombreBase = templateId ? prodMap.get(templateId) : null;

        return {
          sku: ic.sku,
          nombre: nombreBase || ic.sku,
          template_id: templateId,
          stock_fisico: Number(ic.qty) || 0,
          stock_reservado: 0,
          stock_disponible: Number(ic.qty) || 0,
          costo_unitario: 0.00,
          precio_venta: Number(v?.precio) || 0.00,
          stock_minimo_alerta: 5,
          ubicacion: 'Bodega Central',
          activo: true,
          image_url: null,
          updated_at: new Date().toISOString()
        };
      });

      localStock = fallbackItems;
      return { items: fallbackItems, isRealDb: false };
    }
  } catch {
    // fallback
  }

  return { items: localStock, isRealDb: false };
}

/**
 * Obtener movimientos del Kárdex
 */
export async function fetchKardexMovements(sku?: string, limit = 100): Promise<{ movements: KardexMovement[]; isRealDb: boolean }> {
  try {
    let query = supabase
      .from('inventory_kardex')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (sku) {
      query = query.eq('sku', sku);
    }

    const { data, error } = await query;
    if (!error && data) {
      return { movements: data as KardexMovement[], isRealDb: true };
    }
  } catch {
    // fallback
  }

  let filtered = [...localKardex];
  if (sku) {
    filtered = filtered.filter(k => k.sku === sku);
  }
  return { movements: filtered.slice(0, limit), isRealDb: false };
}

/**
 * Registrar Entrada de Mercadería (Compra o Lote nuevo)
 * - Actualiza stock atómicamente
 * - Genera movimiento en el Kárdex
 * - Opcionalmente asienta egreso en Finanzas
 * - Emite evento inmutable a os.events
 */
export async function recordStockEntry(entry: EntradaMercaderiaFormData): Promise<{ success: boolean; error?: string }> {
  const cantidad = Math.abs(entry.cantidad);
  const costo = Math.abs(entry.costo_unitario);
  const totalCompra = cantidad * costo;
  const motivo = `Compra a proveedor ${entry.proveedor || 'Mercadería'}. ${entry.notas || ''}`.trim();

  try {
    // 1. Intentar llamar función RPC nativa
    const rpcRes = await (supabase as any).rpc('record_movement', {
      p_sku: entry.sku,
      p_tipo_movimiento: 'compra_entrada',
      p_cantidad: cantidad,
      p_costo_unitario: costo,
      p_motivo: motivo,
      p_source_table: 'manual_compras',
      p_source_id: `compra-${Date.now()}`,
      p_usuario: 'Panel Admin'
    });

    if (rpcRes.error) {
      // Intentar actualización directa
      const currentItem = localStock.find(i => i.sku === entry.sku);
      const nuevoFisico = (currentItem?.stock_fisico || 0) + cantidad;

      await supabase
        .from('inventory_stock')
        .upsert({
          sku: entry.sku,
          stock_fisico: nuevoFisico,
          costo_unitario: costo > 0 ? costo : currentItem?.costo_unitario || 0,
          updated_at: new Date().toISOString()
        });

      await supabase.from('inventory_kardex').insert({
        sku: entry.sku,
        tipo_movimiento: 'compra_entrada',
        cantidad,
        costo_unitario: costo,
        saldo_fisico: nuevoFisico,
        motivo,
        source_table: 'manual_compras',
        usuario: 'Panel Admin'
      });
    }
  } catch {
    // local fallback
  }

  // 2. Si se solicitó asentar en Finanzas, registrar egreso automático en Money Engine
  if (entry.asentar_en_finanzas && totalCompra > 0) {
    try {
      await addManualTransaction({
        account_id: entry.cuenta_finanzas_id || 'banco_principal',
        tipo: 'expense',
        categoria: 'pago_proveedor',
        monto: totalCompra,
        descripcion: `Compra ${cantidad}x ${entry.sku} (${entry.proveedor || 'Mercadería'})`,
        fecha: new Date().toISOString().slice(0, 10)
      });
    } catch (err) {
      console.warn('Error asentando compra en Finanzas:', err);
    }
  }

  // 3. Emitir evento al OS Event Store
  try {
    await emitOsEvent({
      type: 'supplier.bid.received',
      source_table: 'inventory_stock',
      source_id: entry.sku,
      payload: {
        sku: entry.sku,
        cantidad,
        costo_unitario: costo,
        total_compra: totalCompra,
        proveedor: entry.proveedor || null,
        tipo: 'compra_entrada'
      }
    });
  } catch {
    // ignorar
  }

  // Actualizar local
  const currentIdx = localStock.findIndex(i => i.sku === entry.sku);
  if (currentIdx >= 0) {
    const item = localStock[currentIdx];
    const nuevoFisico = item.stock_fisico + cantidad;
    localStock[currentIdx] = {
      ...item,
      stock_fisico: nuevoFisico,
      stock_disponible: nuevoFisico - item.stock_reservado,
      costo_unitario: costo > 0 ? costo : item.costo_unitario
    };
  }

  localKardex.unshift({
    id: Date.now(),
    sku: entry.sku,
    tipo_movimiento: 'compra_entrada',
    cantidad,
    costo_unitario: costo,
    saldo_fisico: (localStock.find(i => i.sku === entry.sku)?.stock_fisico || cantidad),
    motivo,
    source_table: 'manual_compras',
    created_at: new Date().toISOString()
  });

  return { success: true };
}

/**
 * Ajustar Stock Físico Manual (Conteo de inventario, merma o daño)
 */
export async function adjustStock(params: {
  sku: string;
  nuevo_stock: number;
  motivo: string;
  tipo?: 'ajuste_positivo' | 'ajuste_negativo' | 'merma_dano';
}): Promise<{ success: boolean }> {
  const currentItem = localStock.find(i => i.sku === params.sku);
  const stockAnterior = currentItem?.stock_fisico || 0;
  const diferencia = params.nuevo_stock - stockAnterior;
  const tipoMovimiento = params.tipo || (diferencia >= 0 ? 'ajuste_positivo' : 'ajuste_negativo');

  try {
    await (supabase as any).rpc('record_movement', {
      p_sku: params.sku,
      p_tipo_movimiento: tipoMovimiento,
      p_cantidad: Math.abs(diferencia),
      p_costo_unitario: currentItem?.costo_unitario || 0,
      p_motivo: `Ajuste manual: ${params.motivo} (Antes: ${stockAnterior}, Ahora: ${params.nuevo_stock})`,
      p_source_table: 'manual_ajustes',
      p_source_id: `ajuste-${Date.now()}`,
      p_usuario: 'Panel Admin'
    });
  } catch {
    // fallback
  }

  // Actualizar local
  if (currentItem) {
    currentItem.stock_fisico = params.nuevo_stock;
    currentItem.stock_disponible = Math.max(params.nuevo_stock - currentItem.stock_reservado, 0);
  }

  // Emitir evento al OS Event Store
  try {
    await emitOsEvent({
      type: 'inventory.adjustment',
      source_table: 'inventory_stock',
      source_id: params.sku,
      payload: {
        sku: params.sku,
        stock_anterior: stockAnterior,
        nuevo_stock: params.nuevo_stock,
        diferencia,
        tipo_movimiento: tipoMovimiento,
        motivo: params.motivo
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
export function getToddProductConfig(templateId: string | number): {
  todd_pitch: string;
  todd_instrucciones: string;
  todd_keywords: string;
  activo_todd: boolean;
} {
  const tId = String(templateId);
  try {
    const raw = localStorage.getItem(`todd_cfg_${tId}`);
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
  template_id: string | number;
  nombre_base?: string;
  image_url?: string | null;
  active?: boolean;
  todd_pitch?: string;
  todd_instrucciones?: string;
  todd_keywords?: string;
  activo_todd?: boolean;
  precio_venta?: number;
  costo_unitario?: number;
}

/**
 * Actualizar detalles comerciales, fotos e inteligencia de Todd para un producto
 */
export async function updateProductDetails(payload: UpdateProductPayload): Promise<{ success: boolean; error?: string }> {
  const templateId = String(payload.template_id);

  // 1. Guardar configuración de Todd localmente (siempre seguro y reactivo de inmediato)
  try {
    const localToddKey = `todd_cfg_${templateId}`;
    const currentTodd = getToddProductConfig(templateId);
    const updatedTodd = {
      ...currentTodd,
      todd_pitch: payload.todd_pitch !== undefined ? payload.todd_pitch : currentTodd.todd_pitch,
      todd_instrucciones: payload.todd_instrucciones !== undefined ? payload.todd_instrucciones : currentTodd.todd_instrucciones,
      todd_keywords: payload.todd_keywords !== undefined ? payload.todd_keywords : currentTodd.todd_keywords,
      activo_todd: payload.activo_todd !== undefined ? payload.activo_todd : currentTodd.activo_todd,
    };
    localStorage.setItem(localToddKey, JSON.stringify(updatedTodd));
  } catch (err) {
    console.warn('Error saving local Todd config:', err);
  }

  // 2. Intentar actualizar en public.productos
  try {
    const updateObj: Record<string, any> = {};
    if (payload.nombre_base !== undefined) updateObj.nombre_base = payload.nombre_base;
    if (payload.image_url !== undefined) updateObj.image_url = payload.image_url;
    if (payload.active !== undefined) updateObj.active = payload.active;

    // Intentar incluir campos de Todd si la columna existe
    const fullObj = {
      ...updateObj,
      ...(payload.todd_pitch !== undefined ? { todd_pitch: payload.todd_pitch } : {}),
      ...(payload.todd_instrucciones !== undefined ? { todd_instrucciones: payload.todd_instrucciones } : {}),
      ...(payload.todd_keywords !== undefined ? { todd_keywords: payload.todd_keywords } : {}),
      ...(payload.activo_todd !== undefined ? { activo_todd: payload.activo_todd } : {}),
    };

    const res = await supabase.from('productos').update(fullObj).eq('template_id', payload.template_id);
    if (res.error && res.error.message?.includes('column')) {
      // Si la tabla productos aún no tiene las columnas opcionales de Todd, actualizar las columnas estándar
      await supabase.from('productos').update(updateObj).eq('template_id', payload.template_id);
    }
  } catch (err) {
    console.warn('Error updating productos:', err);
  }

  // 3. Sincronizar también con inventory_stock para los SKUs asociados
  try {
    const stockUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
    if (payload.nombre_base) stockUpdate.nombre = payload.nombre_base;
    if (payload.image_url !== undefined) stockUpdate.image_url = payload.image_url;
    if (payload.precio_venta !== undefined && payload.precio_venta > 0) stockUpdate.precio_venta = payload.precio_venta;
    if (payload.costo_unitario !== undefined && payload.costo_unitario > 0) stockUpdate.costo_unitario = payload.costo_unitario;

    await supabase.from('inventory_stock').update(stockUpdate).eq('template_id', templateId);
  } catch (err) {
    // fallback
  }

  // Emitir evento al OS Event Store
  try {
    await emitOsEvent({
      type: 'product.updated',
      source_table: 'productos',
      source_id: templateId,
      payload: {
        template_id: templateId,
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
 * Eliminar un producto (soft-delete para desactivar o hard-delete para limpiar registros de prueba)
 */
export async function deleteProductItem(templateId: string | number, hardDelete = false): Promise<{ success: boolean; error?: string }> {
  const tId = String(templateId);

  if (!hardDelete) {
    // Soft-delete: Marcar como inactivo
    try {
      await supabase.from('productos').update({ active: false }).eq('template_id', templateId);
      await supabase.from('inventory_stock').update({ activo: false }).eq('template_id', tId);
      
      const todd = getToddProductConfig(tId);
      localStorage.setItem(`todd_cfg_${tId}`, JSON.stringify({ ...todd, activo_todd: false }));
    } catch (err) {
      console.warn('Error soft deleting product:', err);
    }
    return { success: true };
  }

  // Hard-delete: Eliminar de raíz (productos de prueba)
  try {
    // 1. Eliminar variantes
    await supabase.from('productos_variantes').delete().eq('template_id', templateId);
    // 2. Eliminar de productos
    await supabase.from('productos').delete().eq('template_id', templateId);
    // 3. Eliminar de inventory_stock si existe
    await supabase.from('inventory_stock').delete().eq('template_id', tId);
    // 4. Limpiar config local de Todd
    localStorage.removeItem(`todd_cfg_${tId}`);
  } catch (err) {
    console.warn('Error deleting product from Supabase:', err);
  }

  return { success: true };
}

/**
 * Crear o editar un producto y su SKU en inventario nativo
 */
export async function saveProductItem(product: ProductFormData): Promise<{ success: boolean }> {
  const sku = product.sku.trim().toUpperCase();

  try {
    // 1. Guardar en inventory_stock
    await supabase.from('inventory_stock').upsert({
      sku,
      nombre: product.nombre.trim(),
      precio_venta: product.precio_venta,
      costo_unitario: product.costo_unitario,
      stock_fisico: product.stock_inicial,
      stock_minimo_alerta: product.stock_minimo || 5,
      image_url: product.image_url || null,
      updated_at: new Date().toISOString()
    });

    // 2. Si no existía en productos, insertarlo en la tabla productos para compatibilidad de vistas
    try {
      await supabase.from('productos').upsert({
        template_id: sku,
        nombre_base: product.nombre.trim(),
        image_url: product.image_url || null,
        active: true
      });
    } catch {
      // continuar
    }

    // 3. Guardar Todd config
    if (product.todd_pitch || product.todd_instrucciones || product.todd_keywords) {
      localStorage.setItem(`todd_cfg_${sku}`, JSON.stringify({
        todd_pitch: product.todd_pitch || '',
        todd_instrucciones: product.todd_instrucciones || '',
        todd_keywords: product.todd_keywords || '',
        activo_todd: true
      }));
    }
  } catch {
    // fallback
  }

  // Actualizar memoria local
  const existingIdx = localStock.findIndex(i => i.sku === sku);
  const item: StockItem = {
    sku,
    nombre: product.nombre.trim(),
    template_id: sku,
    stock_fisico: product.stock_inicial,
    stock_reservado: 0,
    stock_disponible: product.stock_inicial,
    costo_unitario: product.costo_unitario,
    precio_venta: product.precio_venta,
    stock_minimo_alerta: product.stock_minimo || 5,
    ubicacion: 'Bodega Central',
    activo: true,
    image_url: product.image_url || null,
    updated_at: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    localStock[existingIdx] = { ...localStock[existingIdx], ...item };
  } else {
    localStock.push(item);
  }

  // Emitir evento al OS Event Store
  try {
    await emitOsEvent({
      type: existingIdx >= 0 ? 'product.updated' : 'product.created',
      source_table: 'inventory_stock',
      source_id: sku,
      payload: {
        sku,
        nombre: product.nombre.trim(),
        precio_venta: product.precio_venta,
        costo_unitario: product.costo_unitario,
        stock_inicial: product.stock_inicial
      }
    });
  } catch {}

  return { success: true };
}

