/**
 * IdempotentWebhookHandler: Ensures webhooks are processed exactly once
 * Deduplicates events, maps statuses, and updates Telegram in real-time
 */

const crypto = require('crypto');

class IdempotentWebhookHandler {
  constructor(db, telegramNotifier) {
    this.db = db;
    this.telegramNotifier = telegramNotifier;
    
    // In-memory cache of recently processed webhooks (5 min TTL)
    this.recentWebhooks = new Map();
  }

  /**
   * Generate unique webhook signature for deduplication
   * Includes: callSid + status + timestamp (rounded to 5s)
   */
  generateWebhookSignature(callSid, status, timestamp) {
    // Round timestamp to 5s window to catch duplicates
    const roundedTime = Math.floor(timestamp / 5000) * 5000;
    const key = `${callSid}:${status}:${roundedTime}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Check if webhook was already processed
   */
  isWebhookDuplicate(signature) {
    return this.recentWebhooks.has(signature);
  }

  /**
   * Mark webhook as processed
   */
  markWebhookProcessed(signature) {
    this.recentWebhooks.set(signature, Date.now());
    
    // Clean old entries (> 5 min)
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    for (const [sig, time] of this.recentWebhooks.entries()) {
      if (time < fiveMinAgo) {
        this.recentWebhooks.delete(sig);
      }
    }
  }

  /**
   * Map Twilio CallStatus to unified status
   */
  mapTwilioStatus(twilioStatus) {
    const mapping = {
      'queued': 'initiated',
      'initiated': 'initiated',
      'ringing': 'ringing',
      'answered': 'answered',
      'in-progress': 'in-progress',
      'completed': 'completed',
      'busy': 'busy',
      'no-answer': 'no-answer',
      'no_answer': 'no-answer',
      'canceled': 'canceled',
      'failed': 'failed'
    };
    return mapping[twilioStatus?.toLowerCase()] || twilioStatus;
  }

  /**
   * Process webhook event (idempotent, always returns 200)
   */
  async processWebhook(callSid, webhookPayload) {
    try {
      // Generate signature for deduplication
      const signature = this.generateWebhookSignature(
        callSid,
        webhookPayload.CallStatus,
        Date.now()
      );

      // Check if already processed
      if (this.isWebhookDuplicate(signature)) {
        console.log(`Duplicate webhook for ${callSid}, ignoring`);
        return { success: true, duplicate: true };
      }

      // Mark as processed
      this.markWebhookProcessed(signature);

      // Get call record
      const callRecord = await this.db.getCall(callSid);
      if (!callRecord) {
        console.warn(`Call not found: ${callSid}`);
        return { success: true, callNotFound: true };
      }

      // Map status
      const unifiedStatus = this.mapTwilioStatus(webhookPayload.CallStatus);

      // Persist webhook event (append-only)
      await this.db.recordCallEvent(callSid, unifiedStatus, {
        twilioStatus: webhookPayload.CallStatus,
        answeredBy: webhookPayload.AnsweredBy || null,
        payloadJson: JSON.stringify(webhookPayload)
      });

      // Update call state
      await this.db.updateCall(callSid, {
        status: unifiedStatus,
        twilio_status: webhookPayload.CallStatus,
        answered_by: webhookPayload.AnsweredBy || null
      });

      // Send Telegram notification
      if (callRecord.telegram_chat_id) {
        await this.notifyTelegram(
          callRecord.telegram_chat_id,
          callSid,
          unifiedStatus,
          webhookPayload
        );
      }

      // Check if terminal state
      const terminalStates = ['completed', 'busy', 'no-answer', 'canceled', 'failed'];
      if (terminalStates.includes(unifiedStatus)) {
        await this.handleTerminalState(callSid, callRecord, unifiedStatus, webhookPayload);
      }

      return { success: true };
    } catch (error) {
      // Never throw; always return 200 to Twilio
      console.error(`Webhook processing error for ${callSid}:`, error.message);
      return { success: true, error: error.message };
    }
  }

  /**
   * Send appropriate Telegram notification based on status
   */
  async notifyTelegram(chatId, callSid, status, payload) {
    try {
      switch (status) {
        case 'initiated':
          await this.telegramNotifier.notifyInitiated(chatId, callSid);
          break;
        case 'ringing':
          await this.telegramNotifier.notifyRinging(chatId, callSid);
          break;
        case 'answered':
          await this.telegramNotifier.notifyAnswered(chatId, callSid, payload.AnsweredBy);
          break;
        case 'in-progress':
          await this.telegramNotifier.notifyInProgress(chatId, callSid);
          break;
        case 'completed':
          // Handle in handleTerminalState
          break;
        case 'busy':
          await this.telegramNotifier.notifyBusy(chatId, callSid);
          break;
        case 'no-answer':
          await this.telegramNotifier.notifyNoAnswer(chatId, callSid);
          break;
        case 'canceled':
          await this.telegramNotifier.notifyCanceled(chatId, callSid);
          break;
        case 'failed':
          await this.telegramNotifier.notifyFailed(chatId, callSid, payload.reason);
          break;
      }
    } catch (error) {
      console.error(`Telegram notification failed for ${callSid}:`, error.message);
    }
  }

  /**
   * Handle terminal state: send final outcome message
   */
  async handleTerminalState(callSid, callRecord, status, payload) {
    try {
      // Calculate call duration
      const startTime = new Date(callRecord.started_at || callRecord.created_at).getTime();
      const endTime = new Date().getTime();
      const duration = Math.round((endTime - startTime) / 1000);

      // Determine success/failure
      let success = false;
      let reason = status;

      if (status === 'completed') {
        // Check if call had input failures
        const inputs = await this.db.getCallInputs(callSid);
        const hasFailedInputs = inputs?.some(i => !i.confirmed);
        
        success = !hasFailedInputs;
        reason = hasFailedInputs ? 'input_validation_failed' : 'completed';
      } else if (status === 'busy') {
        success = false;
        reason = 'busy';
      } else if (status === 'no-answer') {
        success = false;
        reason = 'no_answer';
      } else if (status === 'canceled') {
        success = false;
        reason = 'user_canceled';
      } else if (status === 'failed') {
        success = false;
        reason = payload.reason || 'connection_failed';
      }

      // Compile final outcome
      const outcome = {
        success,
        finalStatus: status,
        reason,
        duration,
        completedAt: new Date().toISOString()
      };

      // Get chat ID for Telegram notification
      if (callRecord.telegram_chat_id) {
        await this.telegramNotifier.sendFinalOutcome(
          callRecord.telegram_chat_id,
          callSid,
          outcome
        );
      }

      // Store outcome in DB
      await this.db.updateCall(callSid, {
        final_outcome: JSON.stringify(outcome),
        ended_at: new Date().toISOString(),
        duration
      });

      // Clean up in-memory state
      this.telegramNotifier.cancelPendingUpdates(callSid);
    } catch (error) {
      console.error(`Error handling terminal state for ${callSid}:`, error.message);
    }
  }

  /**
   * Get all statuses that should be tracked
   */
  getAllMappedStatuses() {
    return [
      'initiated',
      'ringing',
      'answered',
      'in-progress',
      'completed',
      'busy',
      'no-answer',
      'canceled',
      'failed'
    ];
  }
}

module.exports = IdempotentWebhookHandler;
