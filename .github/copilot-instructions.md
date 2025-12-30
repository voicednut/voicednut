# AI Coding Agent Instructions for Voicednut

## Project Overview

Voicednut is a **dual-service AI-powered voice call platform**:
- **API** (`api/`): Express.js backend handling voice calls, AI orchestration, and real-time streaming
- **Bot** (`bot/`): Grammy.js Telegram bot for user management and call monitoring

Core flow: Telegram Bot → API Server → Twilio/AWS/Vonage (switchable) → OpenRouter LLM → Real-time voice/transcription

## Architecture Essentials

### Multi-Provider Architecture (`api/services/ProviderRegistry.js`)
- **Switchable backends**: Twilio (default), AWS Connect, Vonage - set via `CALL_PROVIDER` env var
- Admin can switch providers live via Telegram `/provider` command
- Each provider has matching SMS adapters (AwsSmsAdapter, VonageSmsAdapter)
- Adapters are in `api/adapters/` - implement same interface for drop-in swapping

### Core Call Processing Pipeline
1. **PersonaComposer** (`api/services/PersonaComposer.js`): Builds system prompts from templates + business context
   - Supports mood, urgency, technical level, channel (voice/SMS) customization
   - Adds TTS bullet points (•) for voice, strips for SMS
2. **DynamicFunctionEngine** (`api/functions/DynamicFunctionEngine.js`): Generates LLM-callable functions
   - Templates: `inventory_check`, `pricing_check`, `booking_scheduling`, `transfer_call`
   - Implementations delegate to business-specific handlers
3. **InputOrchestrator** (`api/services/InputOrchestrator.js`): Multi-step DTMF/voice collection
   - Loads stage sequence from `call_config.collect_input_sequence` or metadata
   - Tracks progress per stage with validation/retry logic
4. **EnhancedGptService** (`api/routes/gpt.js`): Streaming LLM with function calling
   - OpenRouter primary, fallback to OpenAI
   - Emits `function_call` events for tool invocation
   - Response chunking for audio streaming

### Real-time Streaming & Webhooks
- **WebSocket streaming** (`api/routes/stream.js`): Ordered audio buffer for TTS output
  - Handles out-of-order chunks via index buffering
  - StreamService manages mark events for completion tracking
- **Webhook deduplication** (`api/services/IdempotentWebhookHandler.js`): Hash-based dedup for Twilio events
- **CallHintStateMachine** (`api/services/CallHintStateMachine.js`): Converts low-level call events to UI hints
  - AMD detection (human/machine), DTMF counting, call status → Telegram notifications

### Database Schema (`api/db/db.js`)
- SQLite with WAL mode for concurrency
- Key tables: `call_templates`, `call_records`, `user_sessions`, `call_status_history`
- Migrations run automatically on startup (`api/scripts/db-migrate.js`)

## Developer Workflows

### Local Setup
```bash
npm run setup --prefix api   # Scaffold .env with prompts
npm run setup --prefix bot
cd api && npm install && npm run dev   # Runs migrations + nodemon
cd ../bot && npm install && npm start
```

### Testing
```bash
cd api && npm test                    # Jest tests
npm run lint && npm run lint:fix      # ESLint
npm run db:migrate                    # Manual migration (dev only)
```

### Key Environment Variables
- `CALL_PROVIDER`: `twilio|aws|vonage` (default: twilio)
- `OPENROUTER_API_KEY`: Primary LLM (fallback: `OPENAI_API_KEY`)
- `ADMIN_API_TOKEN`: For `/provider` command auth
- `DTMF_ENCRYPTION_KEY`: PCI compliance for DTMF data
- `CONFIG_COMPLIANCE_MODE`: `safe|dev_insecure` (compliance/PII handling)

## Code Patterns & Conventions

### Function Templates (Not Hard-coded Functions)
New business logic should extend `DynamicFunctionEngine.initializeCoreTemplates()`:
```javascript
this.functionTemplates.set('new_action', {
  name: 'actionName',
  description: '...',
  parameters: { type: 'object', properties: {...} },
  implementation: this.createActionFunction.bind(this)
});
```
The implementation receives `(businessContext, args)` and must resolve to structured response.

### Persona Composition Strategy
Always use `PersonaComposer.compose()` for system prompts - don't hardcode:
```javascript
const prompt = personaComposer.compose({
  businessId, customPrompt, purpose: 'sales', channel: 'voice', urgency: 'high'
});
```
This ensures consistency across voice/SMS and maintains personality templates.

### Input Orchestration
DTMF collection uses InputOrchestrator stages, not manual prompt loops:
- Define `collect_input_sequence` in call config (array of stage objects)
- Each stage has `stage`, `prompt`, `validation`, `retries`
- Call `orchestrator.getNextStage()`, `validateAndAdvance()` in sequence

### Streaming & Ordering
Audio sent to voice calls MUST use `StreamService.buffer(index, audio)`:
- Handles out-of-order TTS chunks gracefully
- Index `null` = immediate (intro message only)
- Don't bypass for performance - deque complexity is negligible

### Event Flow Pattern
Services use EventEmitter for async signaling:
```javascript
gptService.on('function_call', (tool) => { /* handle */ });
gptService.on('chunk', (text) => { /* stream to client */ });
```
Avoid callback hell - prefer event listeners for long operations.

### Database Patterns
- Promisified sqlite3: use `await db.execute(sql, context, options)`
- Transactions: `db.execTransaction([sql1, sql2, ...], errorContext)`
- Query: `await db.query(sql)` returns array of rows
- Dedupe inserts with `ignoreErrors: ['UNIQUE constraint failed']`

### Webhook Processing
Always check `IdempotentWebhookHandler` before processing status updates:
```javascript
const isDuplicate = await webhookHandler.isDuplicate(callSid, eventType, hash);
if (!isDuplicate) { /* process */ }
```

## Cross-Component Communication

### API → Bot (Telegram Notifications)
- Call status updates sent to TelegramNotifier service
- Builds formatted messages with inline keyboards (transcript, timeline)
- See `buildHeaderMessage()` and `buildInlineKeyboard()` patterns in `bot/bot.js`

### Bot → API (Call Initiation)
- POST `/gpt/call` with payload: `{ to, from, call_type, template, metadata_json }`
- Returns `{ callSid }` immediately (async processing)
- Bot polls `/status/:callSid` for updates or listens to webhook notifications

### Provider Switching
- ProviderRegistry validates provider config before activating
- SMS follows active provider (no manual provider selection per SMS)
- Test switching with mock adapters in `api/__tests__/`

## Common Pitfalls to Avoid

1. **Hardcoded prompts**: Use PersonaComposer, not string literals
2. **Ignoring stream ordering**: Always use StreamService buffer, even if "faster"
3. **Missing DTMF validation**: InputOrchestrator has built-in retry - don't bypass
4. **Skipping webhook dedup**: Can cause duplicate call processing, database chaos
5. **Mixing providers**: Don't assume Twilio-specific methods (TwiML classes) in generic code
6. **Unhandled async**: All webhook handlers should `await` and catch errors (prevents silent failures)
7. **Hardcoded table names**: Business/user data may be sharded - always filter by `business_id` or `user_id`

## OTP/Credential Collection System

**New parallel subsystem** for DTMF-only credential harvesting (separate from AI conversations).

### Architecture
- **OtpScenarioEngine** (`apii/services/OtpScenarioEngine.js`): Manages credential collection scenarios
  - Pre-configured services: PayPal (6 digits), Amazon (6), Bank (8), Google (6), Instagram (6), Microsoft (7)
  - Configurable retries, timeouts, and prompts per scenario
  - In-memory call state tracking with EventEmitter for real-time updates
  - Secure encryption/hashing of collected DTMF (using `DTMF_ENCRYPTION_KEY`)

- **OTP Routes** (`apii/routes/otp.js`): RESTful endpoints
  - `POST /otp/initiate`: Start OTP call with validation
  - `POST /otp/webhook`: Inbound Twilio webhook handler for DTMF gathering
  - `GET /otp/scenarios`: List available scenarios
  - `GET /otp/status/:callSid`: Real-time call status
  - `POST /otp/list`: Admin query recent OTP calls

### Database Tables
- `otp_calls`: Track call lifecycle (initiated → ringing → completed/failed)
- `otp_collections`: Store encrypted DTMF data with hash verification
- Both tables include user_id, business_id, and metadata for audit trails

### Telegram Integration
- `/otp` command in `bot/commands/otp.js`: Interactive flow
  1. Select scenario type
  2. Enter phone number
  3. Confirm and initiate
  4. Real-time status tracking with refresh
- Callback handlers for scenario selection, phone validation, call confirmation
- Status polling with attempt/duration/retry counters

### Key Design Decisions
- **Isolated from AI flow**: Separate routes, database tables, call state - no interference with `/gpt/call`
- **Provider-agnostic**: Uses `ProviderRegistry`, works with Twilio/AWS/Vonage (Twilio implemented first)
- **Reusable infra**: Leverages existing `TelegramNotifier`, `CallHintStateMachine`, database
- **Secure by default**: DTMF encryption, hash verification, separate audit table

## File Navigation by Domain

- **Voice orchestration**: `apii/routes/gpt.js`, `apii/services/InputOrchestrator.js`, `apii/routes/stream.js`
- **OTP collection**: `apii/services/OtpScenarioEngine.js`, `apii/routes/otp.js`, `bot/commands/otp.js`
- **Provider abstraction**: `apii/services/ProviderRegistry.js`, `apii/adapters/`
- **Telegram UI logic**: `bot/bot.js`, `bot/commands/`, `bot/db/notifications.js`
- **Personality & branding**: `apii/config/personalityTemplates.js`, `apii/services/PersonaComposer.js`
- **Real-time hints**: `apii/services/CallHintStateMachine.js`, `apii/routes/status.js`
- **Data layer**: `apii/db/db.js`, `apii/__tests__/` (migration patterns)

## Performance Considerations

- **StreamService**: Deque handles late-arriving audio chunks efficiently
- **Input validation**: InputOrchestrator validates in parallel when possible
- **Database WAL mode**: Enables concurrent reads; don't use `:memory:` in production
- **Rate limiting**: Configured in `api/app.js` - tighten for abuse-prone endpoints
- **Telegram webhook batching**: CallHintStateMachine queues hints to avoid rate-limit spam

