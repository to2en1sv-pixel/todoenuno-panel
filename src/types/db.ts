export type Producto = {
  template_id: number;
  nombre_base: string | null;
  is_published: boolean | null;
  active: boolean | null;
  image_url: string | null;
};

export type Variante = {
  variante_id: number;
  template_id: number | null;
  sku: string | null;
  nombre_completo: string | null;
  color: string | null;
  talla: string | null;
  stock: number | null;
  precio: number | null;
  estado: string | null;
  es_test: boolean | null;
  updated_at: string | null;
  image_url: string | null;
};

export type InventoryItem = {
  sku: string;
  qty: number;
  state: string;
  updated_at: string | null;
  image_url: string | null;
};

export type PostQueueItem = {
  id: string;
  template_id: number | null;
  variante_id: number | null;
  nombre: string | null;
  sku: string | null;
  image_url: string | null;
  content_type: string | null;
  status: string | null;
  priority: number | null;
  fb_post_id: string | null;
  posted_at: string | null;
  created_at: string | null;
};

export type FbPostActivo = {
  id: string;
  post_queue_id: string | null;
  fb_post_id: string;
  template_id: number | null;
  is_active: boolean | null;
  created_at: string | null;
};

export type CronRun = {
  id: string;
  target: 'post-auto' | 'sync-odoo' | 'cron';
  source: string;
  status: 'success' | 'error' | 'running';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  http_status: number | null;
  message: string | null;
  meta: Record<string, unknown> | null;
};
