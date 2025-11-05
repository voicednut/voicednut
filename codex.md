## Objective
Enhance this project to deliver:
- Provider-agnostic voice and SMS automation (AWS, Twilio, Vonage)
- Secure multi-stage numeric data capture (DTMF collection)
- Reliable Telegram bot state and recovery
- Database constraint handling and validation
- Robust error feedback and session restoration
- Clean, readable transcripts
- Compliance and safe data masking

---

## 1. Provider-Agnostic DTMF & Context Handling

**Goals:**
- Capture numeric input (SSN, DOB, CVV, etc.) through keypad entry.
- Work seamlessly across AWS Connect/Chime, Twilio, and Vonage.
- Support multi-stage data capture (stage-by-stage prompts).

**Requirements:**
- Normalize provider responses (`call_id`, `stage_key`, `digits`, etc.).
- Persist each stage with masking/tokenization.
- Store securely in `dtmf_entries` table.
- Mask outputs in all user-visible data.

**Example Flow — Account Verification**
1. SSN_LAST4 → prompt “Enter the last four of your SSN.”
2. DOB_MMDD → “Enter your date of birth as MMDD.”
3. CARD_PAN → “Enter your card number.”
4. CVV → “Enter your card CVV.”

**Masked Notification Example:**
```
SSN: ••••
DOB: ••••
Card Number: ************7575
CVV: ***
```

**Dev-Only (Safe Mode Disabled):**
```
SSN: 5628
DOB: 2345
Card Number: 64357878547775575
CVV: 565
```

---

## 2. Transcript Cleaning and Storage

Ensure all call transcripts are readable and free of escape artifacts.

```ts
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\n|\t/g, ' ')
    .replace(/\([\/"])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
```

Store both `raw_text` and `clean_text` in database.

---

## 3. Telegram Notification Flow

- Notify bot users immediately after a call ends.  
- Send **masked summary** before transcript appears.  
- Respect `CONFIG_COMPLIANCE_MODE` = `"safe"` or `"dev_insecure"`.  
- Default to `"safe"`; disallow raw digits in production.  

If a stage fails or times out, show partial summary and alert missing entries.

---

## 4. Bot Conversation & Error Recovery

### Observed Problems
1. ❌ *An error occurred during the conversation. Please try again.*  
2. ❌ *Invalid request. Check the provided details and try again.*  
3. API payload rejected — `"Unknown business_id 'finance'"`  
4. Duplicate call templates (`SQLITE_CONSTRAINT` error).  
5. Undefined `voice_model` and null context in `persona.js`.  

### Root Causes
- Expired or undefined `conversation.flow`
- Missing input validation before API call
- Database uniqueness violations
- API mismatch between business identifiers and templates

### Fixes
#### A. Conversation Context
- Always reinitialize flow:
  ```ts
  if (!session.flow || session.flow.expired) session.flow = new FlowContext('call');
  ```
- Guard `/call`, `/sms`, `/template` commands against overlap.
- Add `safeReset()` to recover from failed state and re-display correct menu.

#### B. Validation Layer
- Check fields before sending payload to API:
  ```ts
  assert(number.match(/^\+\d{10,15}$/), 'Invalid E.164 number');
  assert(business_id && business_id in BUSINESS_MAP, 'Unknown business_id');
  ```

#### C. Graceful Database Handling
- Catch and resolve SQLite constraint errors:
  - Detect duplicate `call_templates.name`.
  - Suggest or auto-rename new template: `template-1`, `template-2`, etc.

#### D. Contextual Error Messaging
| Condition | Telegram Response |
|------------|------------------|
| Missing template | ⚠️ Template not found. Please recreate or list existing ones. |
| Unknown business_id | ❌ Unrecognized service “finance”. Choose a valid business profile. |
| Duplicate name | ⚠️ Template name already exists. Please rename or create new. |
| Network/API failure | 🔄 Temporary network issue. Retrying shortly. |
| Expired session | ⚠️ Session expired. Restarting call setup... |

#### E. Recovery Prompt
If `/call` fails mid-flow:
```
⚠️ Setup interrupted — restarting call setup...
📞 Enter phone number (E.164 format, e.g., +15551234567):
```

#### F. Logging
- Structured logs with `conversation_id`, `request_id`, `provider`, `stage`, `status`.
- No raw PII or credentials logged.

---

## 5. Compliance & Security

- Never store CVV or raw card data.  
- Use masking, hashing, or tokenization for PII.  
- Enforce compliance modes (`safe` / `dev_insecure`).  
- AEAD encryption for intermediate data.  
- KMS for key management.  

---

## 6. API & DB Stability Fixes

**Error Logs Showed:**
```
SQLITE_CONSTRAINT: UNIQUE constraint failed: call_templates.name
Error: Unknown business_id "finance"
TypeError: Cannot read properties of undefined (reading 'data')
```

### Solutions:
1. **Template Creation:**
   - Enforce unique constraint validation before insert.
   - `INSERT OR IGNORE` or unique check prior to write.
2. **Business ID Handling:**
   - Map all valid business_ids in backend (`finance`, `healthcare`, etc.).
   - Reject unknown IDs with structured error.
3. **API Request Validation:**
   - Ensure all outbound API payloads define `voice_model`, `purpose`, `template`, and `business_id`.
4. **Undefined Property Fix:**
   - Add safe guards in `persona.js` (`if (!data) return defaultPersona;`).

---

## 7. Acceptance Tests

1. **DTMF flow test** (Twilio, Vonage, AWS) — multi-stage numeric collection works.  
2. **Telegram bot** — handles conversation restarts cleanly.  
3. **Duplicate template** — detected and prompts rename.  
4. **Unknown business_id** — handled with user-friendly message.  
5. **Compliance** — CVV blocked in prod mode.  
6. **Transcript cleaning** — no slashes or escapes remain.  
7. **Idempotency** — multiple webhooks = one DB entry.  

---

## 8. Deliverables Summary

- ✅ Multi-stage DTMF engine (provider-agnostic)
- ✅ Clean transcript pipeline
- ✅ Masked Telegram notifier
- ✅ Bot error handling & recovery system
- ✅ DB & API validation
- ✅ Business ID and template name checks
- ✅ Compliance enforcement
- ✅ Acceptance test coverage

---

## Implementation Notes for Codex

- Implement provider adapters under `src/voice/providers`.
- Centralize DTMF saving and masking in `saveDtmfEntry()`.
- Add `ErrorBoundary` middleware for commands.
- Update conversation logic in `/call` and `/template` flows.
- Include mock tests for all error cases.

---

**End of Unified Instruction**