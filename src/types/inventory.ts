export type KardexMovementType = 
  | 'inventario_inicial'
  | 'compra_entrada'
  | 'venta_salida'
  | 'reserva_pedido'
  | 'liberar_reserva'
  | 'devolucion_entrada'
  | 'ajuste_positivo'
  | 'ajuste_negativo'
  | 'merma_dano';

export interface StockItem {
  sku: string;
  nombre: string;
  template_id?: string | null;
  stock_fisico: number;
  stock_reservado: number;
  stock_disponible: number;
  costo_unitario: number;
  precio_venta: number;
  stock_minimo_alerta: number;
  ubicacion: string;
  activo: boolean;
  image_url?: string | null;
  todd_pitch?: string | null;
  todd_instrucciones?: string | null;
  todd_keywords?: string | null;
  activo_todd?: boolean;
  categoria?: string | null;
  updated_at?: string;
  created_at?: string;
}

export interface KardexMovement {
  id: number;
  sku: string;
  tipo_movimiento: KardexMovementType;
  cantidad: number;
  costo_unitario: number;
  saldo_fisico: number;
  motivo: string;
  source_table?: string | null;
  source_id?: string | null;
  usuario?: string;
  created_at: string;
}

export interface ToddProductConfig {
  todd_pitch?: string;
  todd_instrucciones?: string;
  todd_keywords?: string;
  activo_todd?: boolean;
}

export interface ProductFormData {
  sku: string;
  nombre: string;
  precio_venta: number;
  costo_unitario: number;
  stock_inicial: number;
  stock_minimo: number;
  ubicacion?: string;
  categoria?: string;
  image_url?: string;
  todd_pitch?: string;
  todd_instrucciones?: string;
  todd_keywords?: string;
}

export interface EntradaMercaderiaFormData {
  sku: string;
  cantidad: number;
  costo_unitario: number;
  tipo_entrada?: 'inventario_inicial' | 'compra_entrada' | 'ajuste_positivo';
  proveedor?: string;
  notas?: string;
  asentar_en_finanzas: boolean;
  cuenta_finanzas_id?: string;
}

export interface ProductVariant {
  variante_id: number;
  template_id: number;
  sku: string;
  nombre_completo: string;
  color: string;
  talla: string;
  stock: number;
  precio: number;
  estado: 'DISPONIBLE' | 'NO_DISPONIBLE' | 'PAUSADO' | string;
  es_test?: boolean;
  image_url?: string | null;
  updated_at?: string;
}

export interface ProductVariantInput {
  color: string;
  talla?: string;
  stock: number;
  precio?: number;
  sku?: string;
  image_url?: string | null;
}

