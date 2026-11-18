export type EventDomain = 
  | 'order' 
  | 'chat' 
  | 'lead' 
  | 'marketing' 
  | 'supplier' 
  | 'finance' 
  | 'inventory'
  | 'customer'
  | 'ltv'
  | 'system';

export interface OsEvent {
  id: number;
  type: string;
  occurred_at: string;
  source_table: string;
  source_id: string;
  idempotency_key: string;
  payload: Record<string, any>;
  created_at?: string;
}

export interface OsEventType {
  type: string;
  domain: EventDomain | string;
  description: string | null;
  payload_schema?: Record<string, any> | null;
  enabled: boolean;
  created_at?: string;
}

export interface OsStateEventMap {
  source_table: string;
  estado: string;
  event_type: string;
}

export interface OsEventConsumer {
  consumer_name: string;
  last_event_id: number;
  status: 'active' | 'paused' | 'error';
  last_error: string | null;
  updated_at: string;
  created_at?: string;
}

export interface OsDailyMemory {
  day: string;
  total_events: number;
  orders_created: number;
  orders_delivered: number;
  orders_cancelled: number;
  gross_sales: number;
  delivered_revenue: number;
  ad_spend: number;
  chats_received: number;
  chats_sent: number;
  top_products: Array<{
    sku: string;
    orders?: number;
    delivered?: number;
    inquiries?: number;
    volume?: number;
  }>;
  top_ads: Array<{
    codigo_anuncio: string;
    orders?: number;
    delivered?: number;
    revenue?: number;
  }>;
  funnel_summary?: {
    funnel_steps?: number;
    leads?: number;
    bot_toggles?: number;
    issues?: number;
  };
  summary_text?: string | null;
  ai_insights?: string | null;
  last_event_id?: number | null;
  updated_at?: string;
}

export interface EmitEventParams {
  type: string;
  source_table: string;
  source_id: string;
  idempotency_key?: string;
  occurred_at?: string;
  payload: Record<string, any>;
}
