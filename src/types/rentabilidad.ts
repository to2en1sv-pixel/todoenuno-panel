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
  codigo_anuncio: string | null
  created_at: string
}

export interface RoasRow {
  codigo_anuncio: string
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
  roas: number | null;
}

export interface ProductoBovedaRoas {
  sku: string;
  nombre: string;
  image_url?: string | null;
  ventasTotales: number;
  gastoTotal: number;
  pedidosTotales: number;
  roasHistorico: number | null;
  cpaHistorico: number | null;
  ticketPromedio: number;
  estadoCiclo: CicloVidaProducto;
  mesesDesempeno: RendimientoMesProducto[];
  mejorMes: { nombre: string; roas: number } | null;
  peorMes: { nombre: string; roas: number } | null;
  anunciosAsociados: string[];
  activo: boolean;
  notasEstrategicas?: string;
}

