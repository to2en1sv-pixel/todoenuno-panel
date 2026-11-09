export interface GastoPublicidad {
  id: string
  fecha: string          // 'YYYY-MM-DD'
  codigo_anuncio: string
  plataforma: string
  monto: number
  notas: string | null
  created_at: string
}

export interface OrdenWhatsapp {
  id: string
  total: number
  sku?: string | null
  catalogo_sku?: string | null
  codigo_anuncio: string | null
  created_at: string
}

export interface RoasRow {
  codigo_anuncio: string
  producto_catalogo?: string | null
  ventas: number
  gasto: number
  pedidos: number
  roas: number | null
  cpa: number | null
}

export interface PuntoVentas {
  fecha: string     // 'YYYY-MM-DD'
  etiqueta: string  // '05/03'
  ventas: number
  pedidos: number
}

export type CicloVidaProducto = 'escala' | 'hibernacion' | 'testeo' | 'quemado';

export interface RendimientoMesProducto {
  mesNumero: number; // 1 - 12
  nombreMes: string; // Ene, Feb, Mar...
  ventas: number;
  gasto: number;
  pedidos: number;
  cogs: number;
  gananciaNeta: number;
  margenNeto: number | null;
  roas: number | null;
}

export interface ProductoBovedaRoas {
  sku: string;                     // SKU del catálogo (canónico)
  catalogo_sku?: string;           // Identificador de catálogo
  nombre: string;                  // Nombre oficial del producto
  image_url?: string | null;
  costoUnitario: number;
  precioVentaSugerido: number;
  stockActual?: number;
  ventasTotales: number;
  gastoTotal: number;
  cogsTotal: number;
  gananciaNetaReal: number;
  margenNetoPorcentaje: number | null;
  utilidadPorUnidad: number;
  pedidosTotales: number;
  roasHistorico: number | null;
  cpaHistorico: number | null;
  ticketPromedio: number;
  estadoCiclo: CicloVidaProducto;
  mesesDesempeno: RendimientoMesProducto[];
  mejorMes: { nombre: string; roas: number } | null;
  peorMes: { nombre: string; roas: number } | null;
  anunciosAsociados: string[];
  aliasTextos: string[];           // Todos los textos libres de pedidos consolidados aquí
  esCatalogoOficial: boolean;      // True si existe físicamente en el catálogo/inventario
  activo: boolean;
  notasEstrategicas?: string;
}

