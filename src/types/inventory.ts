export type KardexMovementType = 
  | 'compra_entrada'
  | 'venta_salida'
  | 'reserva_pedido'
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

export interface ProductFormData {
  sku: string;
  nombre: string;
  precio_venta: number;
  costo_unitario: number;
  stock_inicial: number;
  stock_minimo: number;
  image_url?: string;
}

export interface EntradaMercaderiaFormData {
  sku: string;
  cantidad: number;
  costo_unitario: number;
  proveedor?: string;
  notas?: string;
  asentar_en_finanzas: boolean;
  cuenta_finanzas_id?: string;
}
