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
