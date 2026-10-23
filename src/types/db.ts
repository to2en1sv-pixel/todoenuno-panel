export type Producto = { template_id: number; nombre_base: string | null; is_published: boolean | null; active: boolean | null; image_url: string | null; };
export type Variante = { variante_id: number; template_id: number | null; sku: string | null; nombre_completo: string | null; color: string | null; talla: string | null; stock: number | null; precio: number | null; estado: string | null; };
export type InventoryItem = { sku: string; qty: number; state: string; image_url: string | null; };
export type PostQueueItem = { id: string; template_id: number | null; nombre: string | null; sku: string | null; image_url: string | null; status: string | null; posted_at: string | null; created_at: string | null; fb_post_id: string | null; };
