export interface Call {
  call_sid: string;
  phone_number: string;
  status:
    | 'initiated'
    | 'queued'
    | 'ringing'
    | 'in-progress'
    | 'completed'
    | 'failed'
    | 'busy'
    | 'no-answer'
    | 'canceled';
  duration?: number | null;
  transcript_count?: number;
  error?: string | null;
  created_at: string;
  updated_at?: string | null;
  ended_at?: string | null;
  first_message?: string | null;
  prompt?: string | null;
  call_summary?: string | null;
  business_context?: Record<string, unknown> | null;
}

export interface CallListResponse {
  success: boolean;
  calls: Call[];
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
  enhanced_features?: boolean;
}

export interface CallInitiateResponse {
  success: boolean;
  call_sid: string;
  to: string;
  status: string;
  business_context?: Record<string, unknown>;
  generated_functions?: number;
  function_types?: string[];
  enhanced_webhooks?: boolean;
  error?: string;
  details?: string;
}

export interface TranscriptEntry {
  id: number;
  call_sid: string;
  speaker: string;
  message: string;
  timestamp: string;
  confidence?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface CallDetailResponse {
  call: Call & {
    user_chat_id?: string | null;
    ai_analysis?: string | null;
  };
  transcripts: TranscriptEntry[];
  transcript_count: number;
  adaptation_analytics?: Record<string, unknown>;
  business_context?: Record<string, unknown> | null;
  webhook_notifications?: Array<{
    id: number;
    notification_type: string;
    status: string;
    created_at: string;
    sent_at?: string | null;
    error_message?: string | null;
    delivery_time_ms?: number | null;
  }>;
  enhanced_features?: boolean;
}

export interface APIErrorResponse {
  error: string;
  details?: string;
}
