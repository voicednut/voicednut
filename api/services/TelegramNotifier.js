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
   * NOTE: Does NOT display CallSid - kept internal only
   */
  async sendHeader(chatId, callSid, callConfig) {
    const { to, callType, templateName } = callConfig;
    const typeLabel = callType === 'collect_input' ? 'Input Collection' : 'Service Call';
    const templateLabel = templateName ? `Template: ${templateName}` : 'Default';

    const headerText = 
      `📞 <b>Call in Progress</b>\n\n` +
      `To: <b>${to}</b>\n` +
      `Type: ${typeLabel}\n` +
      `${templateLabel}\n\n` +
      `Status updates below…`;

    try {
      const buttons = [
        { text: '📝 Transcript', callback_data: `transcript:${callSid}` },
        { text: '🎧 Recording', callback_data: `recording:${callSid}` },
        { text: '📊 Timeline', callback_data: `timeline:${callSid}` },
        { text: 'ℹ️ Details', callback_data: `details:${callSid}` }
      ];

      const response = await this.api.post('/sendMessage', {
        chat_id: chatId,
        text: headerText,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [buttons] }
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
   * Queue a status update for sequential delivery
   * Messages are sent one after another with 150-300ms spacing
   */
  async queueStatusUpdate(chatId, callSid, statusUpdate) {
    if (!this.updateQueue.has(callSid)) {
      this.updateQueue.set(callSid, {
        chatId,
        queue: [],
        processing: false,
        lastSentStatus: null
      });
    }

    const queue = this.updateQueue.get(callSid);
    const messageKey = `${statusUpdate.emoji} ${statusUpdate.text}`;
    
    // Avoid duplicate consecutive updates
    if (queue.lastSentStatus === messageKey) {
      return;
    }

    queue.queue.push(statusUpdate);

    // Process queue if not already processing
    if (!queue.processing) {
      this._processStatusQueue(callSid);
    }
  }

  /**
   * Process status queue sequentially with spacing
   */
  async _processStatusQueue(callSid) {
    const queue = this.updateQueue.get(callSid);
    if (!queue || queue.processing) {
      return;
    }

    queue.processing = true;

    try {
      const callRecord = await this.db.getCall(callSid);
      if (!callRecord || !callRecord.telegram_header_message_id) {
        console.warn(`No header message for call ${callSid}, skipping queued updates`);
        this.updateQueue.delete(callSid);
        return;
      }

      while (queue.queue.length > 0) {
        const statusUpdate = queue.queue.shift();
        const messageText = `${statusUpdate.emoji} ${statusUpdate.text}`;

        try {
          await this.api.post('/sendMessage', {
            chat_id: queue.chatId,
            text: messageText,
            reply_to_message_id: callRecord.telegram_header_message_id,
            parse_mode: 'HTML'
          });

          queue.lastSentStatus = messageText;
          
          // Wait 150-300ms before next message (sequential delivery)
          if (queue.queue.length > 0) {
            const delay = 150 + Math.random() * 150;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          console.error(`Failed to send queued status for ${callSid}:`, error.message);
        }
      }
    } finally {
      queue.processing = false;
    }
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
      const queue = this.updateQueue.get(callSid);
      // Wait for pending queue to finish processing
      while (queue.processing && queue.queue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const { success, finalStatus, reason, duration } = outcome;

    const icon = success ? '🏁' : '❌';
    const statusText = success ? 'Completed successfully.' : `Not completed: ${reason || finalStatus}.`;
    const durationText = duration ? `\n⏱️ Duration: ${Math.round(duration / 60)}m ${duration % 60}s` : '';

    const finalText = `${icon} ${statusText}${durationText}`;

    try {
      // Inline buttons for call details
      const keyboard = {
        inline_keyboard: [
          [
            { text: '📝 Transcript', callback_data: `transcript:${callSid}` },
            { text: '🎧 Recording', callback_data: `recording:${callSid}` }
          ],
          [
            { text: '📊 Timeline', callback_data: `timeline:${callSid}` },
            { text: 'ℹ️ Details', callback_data: `details:${callSid}` }
          ]
        ]
      };

      await this.api.post('/sendMessage', {
        chat_id: chatId,
        text: finalText,
        reply_to_message_id: callRecord.telegram_header_message_id,
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

      // Store final outcome
      await this.db.updateCall(callSid, {
        telegram_final_outcome_sent: true,
        telegram_outcome: JSON.stringify(outcome)
      });

      console.log(`✅ Final outcome sent for ${callSid}`);
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
