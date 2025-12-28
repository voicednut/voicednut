-- Add input and webhook tracking tables for Part A & B implementation

-- 1. Add new columns to calls table (for Telegram tracking, final outcome, and capabilities)
ALTER TABLE calls ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS telegram_header_message_id TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS telegram_final_outcome_sent INTEGER DEFAULT 0;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS final_outcome TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS twilio_status TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS answered_by TEXT;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS duration INTEGER;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS ended_at TIMESTAMP;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS requires_input INTEGER DEFAULT 0;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS has_transcript INTEGER DEFAULT 0;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS has_recording INTEGER DEFAULT 0;

-- 2. Create call_inputs table (tracks multi-step DTMF collection)
CREATE TABLE IF NOT EXISTS call_inputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT NOT NULL,
  step_id TEXT NOT NULL,
  step_label TEXT,
  prompt_text TEXT,
  digits_masked TEXT,
  digits_length INTEGER,
  attempt INTEGER DEFAULT 1,
  is_valid INTEGER DEFAULT 0,
  validation_error TEXT,
  confirmed INTEGER DEFAULT 0,
  final_digits_masked TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (call_sid) REFERENCES calls(call_sid),
  INDEX idx_call_sid (call_sid),
  INDEX idx_step_id (step_id)
);

-- 3. Create call_events table (append-only webhook event log for idempotency)
CREATE TABLE IF NOT EXISTS call_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  call_sid TEXT NOT NULL,
  status TEXT NOT NULL,
  twilio_status TEXT,
  answered_by TEXT,
  payload_json TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (call_sid) REFERENCES calls(call_sid),
  INDEX idx_call_sid (call_sid),
  INDEX idx_status (status),
  INDEX idx_created_at (created_at)
);

-- 4. Create webhook_dedupe table (if not exists) for idempotency checking
CREATE TABLE IF NOT EXISTS webhook_dedupe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signature TEXT UNIQUE NOT NULL,
  call_sid TEXT,
  status TEXT,
  processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_signature (signature),
  INDEX idx_call_sid (call_sid)
);

-- 5. Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_calls_created_at ON calls(created_at);
CREATE INDEX IF NOT EXISTS idx_call_inputs_call_sid_step ON call_inputs(call_sid, step_id);
CREATE INDEX IF NOT EXISTS idx_call_events_call_sid_status ON call_events(call_sid, status);
