// Event types that can be received from the WebSocket
export type WebSocketEventType =
  | 'connection_ack'
  | 'call_update'
  | 'call_completed'
  | 'call_failed'
  | 'system_config_updated'
  | 'user_updated';

// Base interface for all WebSocket events
export interface WebSocketEvent<T = unknown> {
  type: WebSocketEventType;
  data: T;
  timestamp: string;
}

// Event payloads
export interface CallUpdatePayload {
  call_sid: string;
  status: string;
  to: string;
  started_at?: string;
  ended_at?: string;
  latest_update?: string;
  prompt_preview?: string;
  first_message?: string;
  duration?: number;
  error?: string;
  timeline?: CallTimelineEntry[];
}

export interface CallTimelineEntry {
  timestamp: string;
  type: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SystemConfigPayload {
  key: string;
  value: unknown;
  updatedBy: string;
}

export interface UserUpdatePayload {
  userId: string;
  action: 'added' | 'removed' | 'promoted';
  updatedBy: string;
}

// Connection acknowledgment payload
export interface ConnectionAckPayload {
  activeCalls: CallUpdatePayload[];
  systemConfig: Record<string, unknown>;
}
