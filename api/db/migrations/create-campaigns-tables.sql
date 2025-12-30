-- Campaign Management Tables for Outbound Call Campaigns

-- Main campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT UNIQUE NOT NULL,
    business_id TEXT NOT NULL,
    user_chat_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'draft', -- draft, scheduled, active, paused, completed, cancelled
    persona TEXT, -- References template or persona name
    template TEXT, -- Call template/script
    start_time DATETIME,
    end_time DATETIME,
    call_frequency TEXT DEFAULT 'normal', -- normal, aggressive, conservative
    max_calls_per_second REAL DEFAULT 1.0,
    max_calls_per_minute INTEGER DEFAULT 10,
    max_retry_attempts INTEGER DEFAULT 3,
    do_not_call_filter BOOLEAN DEFAULT 1,
    voicemail_detection BOOLEAN DEFAULT 1,
    voicemail_message TEXT,
    timezone TEXT DEFAULT 'UTC',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    scheduled_at DATETIME,
    completed_at DATETIME,
    paused_at DATETIME,
    metadata TEXT -- JSON with campaign-specific config
);

-- Contact list for campaigns
CREATE TABLE IF NOT EXISTS campaign_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id TEXT UNIQUE NOT NULL,
    campaign_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    name TEXT,
    email TEXT,
    segment TEXT, -- For tracking contact segments
    priority INTEGER DEFAULT 0, -- Higher = call first
    custom_data TEXT, -- JSON with custom fields
    do_not_call BOOLEAN DEFAULT 0,
    dnc_reason TEXT, -- why marked DNC
    status TEXT DEFAULT 'pending', -- pending, queued, ringing, connected, completed, failed, voicemail, no_answer, invalid
    call_count INTEGER DEFAULT 0,
    last_called_at DATETIME,
    first_call_at DATETIME,
    outcome TEXT, -- success, no_answer, voicemail, disconnected, invalid_number, dnc_hit
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id) ON DELETE CASCADE
);

-- Campaign call execution history
CREATE TABLE IF NOT EXISTS campaign_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id TEXT UNIQUE NOT NULL,
    campaign_id TEXT NOT NULL,
    contact_id TEXT,
    call_sid TEXT, -- Twilio/provider call SID
    phone_number TEXT NOT NULL,
    call_type TEXT DEFAULT 'outbound',
    status TEXT DEFAULT 'initiated', -- initiated, ringing, connected, completed, failed
    duration INTEGER DEFAULT 0, -- seconds
    sentiment TEXT, -- positive, neutral, negative
    outcome TEXT, -- success, no_answer, voicemail, busy, disconnected, error
    failure_reason TEXT, -- Technical reason for failure
    transcript TEXT, -- Full call transcript
    recording_url TEXT,
    ai_summary TEXT, -- AI-generated call summary
    conversion_result BOOLEAN, -- Did call lead to conversion
    retry_count INTEGER DEFAULT 0,
    next_retry_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    ended_at DATETIME,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id) ON DELETE CASCADE,
    FOREIGN KEY (contact_id) REFERENCES campaign_contacts(contact_id) ON DELETE SET NULL
);

-- Campaign metrics/statistics
CREATE TABLE IF NOT EXISTS campaign_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    date TEXT NOT NULL, -- YYYY-MM-DD
    total_dialed INTEGER DEFAULT 0,
    total_answered INTEGER DEFAULT 0,
    total_voicemail INTEGER DEFAULT 0,
    total_no_answer INTEGER DEFAULT 0,
    total_failed INTEGER DEFAULT 0,
    total_completed INTEGER DEFAULT 0,
    total_conversions INTEGER DEFAULT 0,
    average_duration INTEGER DEFAULT 0, -- seconds
    average_sentiment TEXT, -- positive, neutral, negative
    dnc_hits INTEGER DEFAULT 0,
    cost REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, date),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id) ON DELETE CASCADE
);

-- DNC (Do Not Call) registry
CREATE TABLE IF NOT EXISTS do_not_call_registry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT UNIQUE NOT NULL,
    name TEXT,
    reason TEXT DEFAULT 'unknown', -- user_requested, regulatory, business_rule, fraud
    source TEXT, -- manual, federal_registry, state_registry, customer_request
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME, -- NULL = permanent
    notes TEXT
);

-- Campaign schedules (for recurring campaigns)
CREATE TABLE IF NOT EXISTS campaign_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id TEXT UNIQUE NOT NULL,
    campaign_id TEXT NOT NULL,
    recurrence TEXT, -- daily, weekly, monthly, once
    recurrence_pattern TEXT, -- JSON: {day_of_week: [1,3,5], time: "14:00"}
    next_execution DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id) ON DELETE CASCADE
);

-- Campaign segment performance tracking
CREATE TABLE IF NOT EXISTS campaign_segment_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT NOT NULL,
    segment TEXT NOT NULL,
    total_dialed INTEGER DEFAULT 0,
    total_answered INTEGER DEFAULT 0,
    answer_rate REAL DEFAULT 0.0,
    conversion_count INTEGER DEFAULT 0,
    conversion_rate REAL DEFAULT 0.0,
    average_duration INTEGER DEFAULT 0,
    cost REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, segment),
    FOREIGN KEY (campaign_id) REFERENCES campaigns(campaign_id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_business ON campaigns(business_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_campaign ON campaign_contacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_status ON campaign_contacts(status);
CREATE INDEX IF NOT EXISTS idx_campaign_contacts_dnc ON campaign_contacts(do_not_call);
CREATE INDEX IF NOT EXISTS idx_campaign_calls_campaign ON campaign_calls(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_calls_status ON campaign_calls(status);
CREATE INDEX IF NOT EXISTS idx_campaign_calls_phone ON campaign_calls(phone_number);
CREATE INDEX IF NOT EXISTS idx_dnc_phone ON do_not_call_registry(phone_number);
