export type EventDomain = 
  | 'order' 
  | 'chat' 
  | 'lead' 
  | 'marketing' 
  | 'supplier' 
  | 'finance' 
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

export interface EmitEventParams {
  type: string;
  source_table: string;
  source_id: string;
  idempotency_key?: string;
  payload: Record<string, any>;
}
