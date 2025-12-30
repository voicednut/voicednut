-- Migration: Add call_events table for webhook audit trail and event tracking
-- Purpose: Append-only log of all Twilio/provider webhooks for call lifecycle tracking
-- Features: Event deduplication, terminal state detection, call status history

-- Create call_events table (append-only audit log)
CREATE TABLE IF NOT EXISTS call_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_status TEXT,
  webhook_payload JSON,
  
  -- Extracted from webhook for easy querying
  twilio_status TEXT,
  answered_by TEXT,
  duration INTEGER,
  from_number TEXT,
  to_number TEXT,
  call_ended_by TEXT,
  
  -- Metadata
  user_id INTEGER,
  business_id INTEGER,
  telegram_chat_id TEXT,
  
  -- Tracking
  processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_terminal_event BOOLEAN DEFAULT FALSE,
  event_hash TEXT UNIQUE,
  
  FOREIGN KEY (call_sid) REFERENCES call_records(call_sid),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (business_id) REFERENCES businesses(id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_call_events_call_sid ON call_events(call_sid);
CREATE INDEX IF NOT EXISTS idx_call_events_timestamp ON call_events(processed_at);
CREATE INDEX IF NOT EXISTS idx_call_events_event_type ON call_events(event_type);
CREATE INDEX IF NOT EXISTS idx_call_events_terminal ON call_events(is_terminal_event);
CREATE INDEX IF NOT EXISTS idx_call_events_status ON call_events(twilio_status);
CREATE INDEX IF NOT EXISTS idx_call_events_user ON call_events(user_id);
CREATE INDEX IF NOT EXISTS idx_call_events_hash ON call_events(event_hash);

-- Composite index for quick call status lookup
CREATE INDEX IF NOT EXISTS idx_call_events_lookup ON call_events(call_sid, processed_at DESC);
