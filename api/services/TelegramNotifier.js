/**
 * TelegramNotifier: Standardized Telegram UI for call status updates
 * One header message per call, threaded status updates, final outcomes
 */

const axios = require('axios');

class TelegramNotifier {
  constructor(botToken, db) {
    this.botToken = botToken;
    this.db = db;
    this.api = axios.create({
      baseURL: `https://api.telegram.org/bot${botToken}`,
      timeout: 5000
    });
    
    // Debouncing: batch updates within 500ms
    this.updateQueue = new Map(); // callSid → { timer, messages: [] }
  }

  /**
   * Send or update header message for a call
   * Called once when call is initiated
   */
  async sendHeader(chatId, callSid, callConfig) {
    const { to, from, callType, templateName } = callConfig;

    const headerText = `📞 Calling ${to}\n` +
                       `🧾 Type: ${callType || 'service'} • Template: ${templateName || 'default'}\n` +
                       `🆔 Call SID: ${callSid}\n` +
                       `📶 Status: initiated`;

    try {
      const response = await this.api.post('/sendMessage', {
        chat_id: chatId,
        text: headerText,
        parse_mode: 'Markdown'
      });

      const headerMessageId = response.data.result.message_id;

      // Store header message ID for future replies
      await this.db.updateCall(callSid, {
        telegram_header_message_id: headerMessageId
      });

      return headerMessageId;
    } catch (error) {
      console.error(`Failed to send header for call ${callSid}:`, error.message);
      return null;
    }
  }

  /**
   * Queue a status update (debounced within 500ms)
   */
  queueStatusUpdate(chatId, callSid, statusUpdate) {
    if (!this.updateQueue.has(callSid)) {
      this.updateQueue.set(callSid, {
        chatId,
        timer: null,
        messages: [],
        lastSentStatus: null
      });
    }

    const queue = this.updateQueue.get(callSid);
    
    // Avoid duplicate consecutive updates
    if (queue.lastSentStatus === statusUpdate.emoji + statusUpdate.text) {
      return;
    }

    queue.messages.push(statusUpdate);

    // Clear existing timer
    if (queue.timer) clearTimeout(queue.timer);

    // Set new debounce timer (500ms)
    queue.timer = setTimeout(async () => {
      await this.flushUpdates(callSid);
    }, 500);
  }

  /**
   * Flush batched updates to Telegram
   */
  async flushUpdates(callSid) {
    const queue = this.updateQueue.get(callSid);
    if (!queue || queue.messages.length === 0) return;

    const { chatId, messages } = queue;
    const callRecord = await this.db.getCall(callSid);
    if (!callRecord || !callRecord.telegram_header_message_id) {
      console.warn(`No header message for call ${callSid}, skipping updates`);
      this.updateQueue.delete(callSid);
      return;
    }

    // Combine messages into a single update text
    const updateText = messages
      .map(msg => `${msg.emoji} ${msg.text}`)
      .join('\n');

    try {
      await this.api.post('/sendMessage', {
        chat_id: chatId,
        text: updateText,
        reply_to_message_id: callRecord.telegram_header_message_id,
        parse_mode: 'Markdown'
      });

      queue.lastSentStatus = updateText;
    } catch (error) {
      console.error(`Failed to flush updates for call ${callSid}:`, error.message);
    }

    // Clear queue
    queue.messages = [];
    queue.timer = null;
  }

  /**
   * Status updates (queued/debounced)
   */
  
  async notifyInitiated(chatId, callSid) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '📤',
      text: 'Call initiated.'
    });
  }

  async notifyRinging(chatId, callSid) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '🔔',
      text: 'Phone is ringing…'
    });
  }

  async notifyAnswered(chatId, callSid, answeredBy = null) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '✅',
      text: 'Call has been answered.'
    });
    
    if (answeredBy && answeredBy.toLowerCase().includes('machine')) {
      this.queueStatusUpdate(chatId, callSid, {
        emoji: '🤖',
        text: 'Voicemail or automation detected.'
      });
    }
  }

  async notifyInProgress(chatId, callSid) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '🟢',
      text: 'Call in progress.'
    });
  }

  async notifyInputAwiting(chatId, callSid, stepLabel, expectedLen) {
    // Only emit input messages if call requires input
    const callRecord = await this.db.getCall(callSid);
    if (!callRecord || !callRecord.requires_input) {
      return; // Silent skip for non-input calls
    }

    this.queueStatusUpdate(chatId, callSid, {
      emoji: '⌨️',
      text: `Awaiting input: ${stepLabel} (${expectedLen} digits)`
    });
  }

  async notifyInputReceived(chatId, callSid, maskedDisplay, attempt = 1) {
    // Only emit input messages if call requires input
    const callRecord = await this.db.getCall(callSid);
    if (!callRecord || !callRecord.requires_input) {
      return; // Silent skip for non-input calls
    }

    const icon = attempt === 1 ? '✅' : '🔄';
    this.queueStatusUpdate(chatId, callSid, {
      emoji: icon,
      text: `Input received: ${maskedDisplay}`
    });
  }

  async notifyInputRejected(chatId, callSid, reason, attempt, maxRetries) {
    // Only emit input messages if call requires input
    const callRecord = await this.db.getCall(callSid);
    if (!callRecord || !callRecord.requires_input) {
      return; // Silent skip for non-input calls
    }

    this.queueStatusUpdate(chatId, callSid, {
      emoji: '❌',
      text: `Rejected: ${reason}. Attempt ${attempt}/${maxRetries}`
    });
  }

  /**
   * Terminal status messages
   */

  async notifyCompleted(chatId, callSid, reason = null) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '🏁',
      text: 'Call has ended.'
    });
  }

  async notifyBusy(chatId, callSid) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '🚫',
      text: 'Line is busy.'
    });
  }

  async notifyNoAnswer(chatId, callSid) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '⏳',
      text: 'No answer.'
    });
  }

  async notifyCanceled(chatId, callSid) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '⚠️',
      text: 'Call was canceled.'
    });
  }

  async notifyFailed(chatId, callSid, reason = null) {
    this.queueStatusUpdate(chatId, callSid, {
      emoji: '❌',
      text: `Call failed to connect${reason ? ': ' + reason : ''}.`
    });
  }

  /**
   * Send final outcome message with buttons
   * Called when call reaches terminal state
   */
  async sendFinalOutcome(chatId, callSid, outcome) {
    const callRecord = await this.db.getCall(callSid);
    if (!callRecord) {
      console.warn(`Call not found: ${callSid}`);
      return;
    }

    // Flush any pending updates first
    if (this.updateQueue.has(callSid)) {
      await this.flushUpdates(callSid);
    }

    const { success, finalStatus, reason, duration } = outcome;

    const icon = success ? '✅' : '❌';
    const statusText = success ? 'Completed successfully.' : `Not completed: ${reason || finalStatus}.`;
    const durationText = duration ? `\n⏱️ Duration: ${Math.round(duration / 60)}m ${duration % 60}s` : '';

    const finalText = `${icon} ${statusText}${durationText}`;

    try {
      // Inline buttons for call details
      const keyboard = {
        inline_keyboard: [
          [
            { text: '📝 View Transcript', callback_data: `transcript:${callSid}` },
            { text: '📊 Call Details', callback_data: `details:${callSid}` }
          ]
        ]
      };

      await this.api.post('/sendMessage', {
        chat_id: chatId,
        text: finalText,
        reply_to_message_id: callRecord.telegram_header_message_id,
        reply_markup: keyboard,
        parse_mode: 'Markdown'
      });

      // Store final outcome
      await this.db.updateCall(callSid, {
        telegram_final_outcome_sent: true,
        telegram_outcome: JSON.stringify(outcome)
      });
    } catch (error) {
      console.error(`Failed to send final outcome for call ${callSid}:`, error.message);
    }
  }

  /**
   * Handle callback queries from inline buttons
   */
  async handleCallbackQuery(chatId, callbackData) {
    const [action, callSid] = callbackData.split(':');

    if (action === 'transcript') {
      const transcript = await this.db.getTranscripts(callSid);
      if (!transcript || transcript.length === 0) {
        return { text: '📝 Transcript not ready yet.' };
      }

      const formatted = transcript
        .map(t => `${t.speaker.toUpperCase()}: ${t.message}`)
        .join('\n');

      return { text: formatted, parseMode: 'Markdown' };
    }

    if (action === 'details') {
      const call = await this.db.getCall(callSid);
      const details = `Call SID: ${call.call_sid}\n` +
                      `To: ${call.phone_number}\n` +
                      `Duration: ${call.duration || 'N/A'}s\n` +
                      `Status: ${call.status}\n` +
                      `Created: ${call.created_at}`;
      return { text: details, parseMode: 'Markdown' };
    }

    return { text: 'Unknown action' };
  }

  /**
   * Cancel any pending updates for a call
   */
  cancelPendingUpdates(callSid) {
    const queue = this.updateQueue.get(callSid);
    if (queue && queue.timer) {
      clearTimeout(queue.timer);
    }
    this.updateQueue.delete(callSid);
  }
}

module.exports = TelegramNotifier;
