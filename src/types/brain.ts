export type NodeStatus = 'completed' | 'in_progress' | 'active_dev' | 'future';

export type NodeDomain = 
  | 'core' 
  | 'sales' 
  | 'orders' 
  | 'antifraud' 
  | 'dispatch' 
  | 'delivery' 
  | 'suppliers' 
  | 'packaging' 
  | 'lifecycle' 
  | 'niche' 
  | 'finance' 
  | 'docs' 
  | 'events'
  | 'marketing'
  | 'social'
  | 'analytics'
  | 'catalog'
  | 'system';

export interface BrainSubAction {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'in_progress' | 'planned';
  triggerEvent?: string;
  outputEvent?: string;
}

export interface BrainNode {
  id: string;
  label: string;
  subtitle: string;
  domain: NodeDomain;
  status: NodeStatus;
  x: number;
  y: number;
  radius: number;
  iconName: string;
  description: string;
  completionPercentage: number;
  health: number; // 0 - 100%
  route?: string; // Link to module in the app
  subActions: BrainSubAction[];
  supportedEvents: string[];
}

export type BrainFlowType = 
  | 'sales_flow' 
  | 'fulfillment_flow' 
  | 'retention_flow' 
  | 'supply_flow' 
  | 'core_sync'
  | 'marketing_flow'
  | 'finance_flow'
  | 'system_flow';

export interface BrainConnection {
  id: string;
  from: string;
  to: string;
  label?: string;
  eventType?: string;
  description?: string;
  flowType?: BrainFlowType;
  bandwidth?: 'high' | 'medium' | 'low';
  animated?: boolean;
}

export interface SimulationStep {
  step: number;
  title: string;
  sourceNodeId: string;
  targetNodeId: string;
  eventType: string;
  description: string;
  impact: string;
  dataSummary: string;
}
