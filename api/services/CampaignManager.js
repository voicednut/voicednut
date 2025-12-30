const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

/**
 * CampaignManager - Orchestrates outbound call campaigns
 * Handles scheduling, contact management, retry logic, and compliance
 */
class CampaignManager extends EventEmitter {
  constructor(database) {
    super();
    this.db = database;
    this.activeCampaigns = new Map(); // In-memory tracking of active campaigns
    this.campaignQueues = new Map(); // Contact queues per campaign
    this.retrySchedules = new Map(); // Retry timers
    this.callRateLimiters = new Map(); // Rate limiters per campaign
  }

  /**
   * Create new campaign
   */
  async createCampaign(options = {}) {
    const {
      businessId,
      userChatId,
      name,
      description = '',
      persona = 'default',
      template = '',
      startTime = new Date(),
      callFrequency = 'normal',
      maxCallsPerSecond = 1.0,
      maxCallsPerMinute = 10,
      maxRetryAttempts = 3,
      doNotCallFilter = true,
      voicemailDetection = true,
      voicemailMessage = '',
      timezone = 'UTC',
      metadata = {}
    } = options;

    const campaignId = `camp_${uuidv4()}`;

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO campaigns (
          campaign_id, business_id, user_chat_id, name, description, persona, template,
          start_time, call_frequency, max_calls_per_second, max_calls_per_minute,
          max_retry_attempts, do_not_call_filter, voicemail_detection, voicemail_message,
          timezone, metadata, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        campaignId, businessId, userChatId, name, description, persona, template,
        startTime, callFrequency, maxCallsPerSecond, maxCallsPerMinute,
        maxRetryAttempts, doNotCallFilter ? 1 : 0, voicemailDetection ? 1 : 0,
        voicemailMessage, timezone, JSON.stringify(metadata), 'draft'
      ];

      this.db.db.run(sql, params, function(err) {
        if (err) {
          console.error('❌ Failed to create campaign:', err);
          reject(err);
        } else {
          console.log(`✅ Campaign created: ${campaignId}`);
          resolve({
            campaignId,
            status: 'draft',
            createdAt: new Date()
          });
        }
      });
    });
  }

  /**
   * Add contacts to campaign
   */
  async addContacts(campaignId, contacts) {
    // contacts: [{ phoneNumber, name, email, segment, customData }]
    let added = 0;
    let invalid = 0;

    return new Promise((resolve, reject) => {
      const insertStmt = this.db.db.prepare(`
        INSERT INTO campaign_contacts (
          contact_id, campaign_id, phone_number, name, email, segment, custom_data, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      contacts.forEach(contact => {
        const { phoneNumber, name = '', email = '', segment = 'default', customData = {} } = contact;

        // Basic validation
        if (!this._isValidPhoneNumber(phoneNumber)) {
          invalid++;
          return;
        }

        const contactId = `cont_${uuidv4()}`;
        insertStmt.run(
          [
            contactId, campaignId, phoneNumber, name, email, segment,
            JSON.stringify(customData), 'pending'
          ],
          (err) => {
            if (!err) added++;
          }
        );
      });

      insertStmt.finalize((err) => {
        if (err) {
          reject(err);
        } else {
          resolve({ added, invalid, total: contacts.length });
        }
      });
    });
  }

  /**
   * Start campaign
   */
  async startCampaign(campaignId) {
    return new Promise((resolve, reject) => {
      this.db.db.get(
        'SELECT * FROM campaigns WHERE campaign_id = ?',
        [campaignId],
        async (err, campaign) => {
          if (err || !campaign) {
            reject(new Error(`Campaign not found: ${campaignId}`));
            return;
          }

          // Update campaign status
          this.db.db.run(
            'UPDATE campaigns SET status = ?, updated_at = ? WHERE campaign_id = ?',
            ['active', new Date().toISOString(), campaignId],
            async (err) => {
              if (err) {
                reject(err);
                return;
              }

              // Load contacts and start queue processing
              this._initializeCampaignQueue(campaignId, campaign);
              this.activeCampaigns.set(campaignId, campaign);

              console.log(`🚀 Campaign started: ${campaignId}`);
              resolve({
                campaignId,
                status: 'active',
                startedAt: new Date()
              });
            }
          );
        }
      );
    });
  }

  /**
   * Initialize contact queue and start processing
   */
  async _initializeCampaignQueue(campaignId, campaign) {
    return new Promise((resolve, reject) => {
      const sql = `
        SELECT * FROM campaign_contacts 
        WHERE campaign_id = ? AND status = 'pending'
        ORDER BY priority DESC, created_at ASC
      `;

      this.db.db.all(sql, [campaignId], (err, contacts) => {
        if (err) {
          reject(err);
          return;
        }

        const queue = contacts.map(c => ({
          contactId: c.contact_id,
          phoneNumber: c.phone_number,
          name: c.name,
          segment: c.segment,
          customData: c.custom_data ? JSON.parse(c.custom_data) : {},
          retryCount: 0
        }));

        this.campaignQueues.set(campaignId, queue);

        // Start rate-limited dialing
        this._startDialingLoop(campaignId, campaign);
        resolve(queue.length);
      });
    });
  }

  /**
   * Main dialing loop with rate limiting
   */
  _startDialingLoop(campaignId, campaign) {
    const queue = this.campaignQueues.get(campaignId);
    if (!queue || queue.length === 0) return;

    const rateLimit = this._createRateLimiter(
      campaign.max_calls_per_second,
      campaign.max_calls_per_minute
    );

    const dialNext = async () => {
      const contact = queue.shift();
      if (!contact) {
        // Campaign finished
        this._completeCampaign(campaignId);
        return;
      }

      // Wait for rate limit
      await rateLimit.wait();

      // Emit event for API to handle actual call
      this.emit('dial_contact', {
        campaignId,
        contact,
        campaign
      });

      // Schedule next dial
      setTimeout(dialNext, 100); // Small delay between queuing
    };

    dialNext();
  }

  /**
   * Create rate limiter
   */
  _createRateLimiter(callsPerSecond, callsPerMinute) {
    let callsThisSecond = 0;
    let callsThisMinute = 0;
    let secondStart = Date.now();
    let minuteStart = Date.now();

    return {
      async wait() {
        const now = Date.now();

        // Reset second counter
        if (now - secondStart > 1000) {
          callsThisSecond = 0;
          secondStart = now;
        }

        // Reset minute counter
        if (now - minuteStart > 60000) {
          callsThisMinute = 0;
          minuteStart = now;
        }

        // Wait if hitting limits
        if (callsThisSecond >= callsPerSecond) {
          await new Promise(r => setTimeout(r, 100));
        }
        if (callsThisMinute >= callsPerMinute) {
          await new Promise(r => setTimeout(r, 500));
        }

        callsThisSecond++;
        callsThisMinute++;
      }
    };
  }

  /**
   * Record campaign call result
   */
  async recordCampaignCall(campaignId, contactId, result = {}) {
    const {
      callSid = '',
      phoneNumber = '',
      status = 'completed',
      duration = 0,
      sentiment = 'neutral',
      outcome = 'completed',
      failureReason = null,
      transcript = '',
      recordingUrl = '',
      aiSummary = '',
      conversionResult = false
    } = result;

    const callId = `call_${uuidv4()}`;

    return new Promise((resolve, reject) => {
      const sql = `
        INSERT INTO campaign_calls (
          call_id, campaign_id, contact_id, call_sid, phone_number, status,
          duration, sentiment, outcome, failure_reason, transcript, recording_url,
          ai_summary, conversion_result, started_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const params = [
        callId, campaignId, contactId, callSid, phoneNumber, status,
        duration, sentiment, outcome, failureReason, transcript, recordingUrl,
        aiSummary, conversionResult ? 1 : 0, new Date().toISOString()
      ];

      this.db.db.run(sql, params, async (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Update contact status
        await this._updateContactStatus(contactId, outcome);

        // Update campaign metrics
        await this._updateCampaignMetrics(campaignId, outcome, duration, sentiment, conversionResult);

        resolve(callId);
      });
    });
  }

  /**
   * Update contact status after call
   */
  async _updateContactStatus(contactId, outcome) {
    const statusMap = {
      'success': 'completed',
      'no_answer': 'no_answer',
      'voicemail': 'voicemail',
      'disconnected': 'failed',
      'invalid_number': 'invalid',
      'dnc_hit': 'completed'
    };

    return new Promise((resolve) => {
      const status = statusMap[outcome] || 'failed';
      this.db.db.run(
        `UPDATE campaign_contacts 
         SET status = ?, call_count = call_count + 1, updated_at = ?, last_called_at = ?
         WHERE contact_id = ?`,
        [status, new Date().toISOString(), new Date().toISOString(), contactId],
        resolve
      );
    });
  }

  /**
   * Update daily campaign metrics
   */
  async _updateCampaignMetrics(campaignId, outcome, duration, sentiment, conversion) {
    const today = new Date().toISOString().split('T')[0];

    return new Promise((resolve) => {
      this.db.db.get(
        `SELECT * FROM campaign_metrics WHERE campaign_id = ? AND date = ?`,
        [campaignId, today],
        (err, existing) => {
          if (!existing) {
            // Create new metrics entry
            this.db.db.run(
              `INSERT INTO campaign_metrics (campaign_id, date, total_dialed, total_answered)
               VALUES (?, ?, 1, ${outcome === 'success' || outcome === 'no_answer' ? 1 : 0})`,
              [campaignId, today],
              resolve
            );
          } else {
            // Update existing metrics
            let update = `UPDATE campaign_metrics SET total_dialed = total_dialed + 1`;
            if (outcome === 'success' || outcome === 'no_answer') {
              update += `, total_answered = total_answered + 1`;
            }
            if (outcome === 'voicemail') {
              update += `, total_voicemail = total_voicemail + 1`;
            }
            if (outcome === 'no_answer') {
              update += `, total_no_answer = total_no_answer + 1`;
            }
            if (outcome === 'completed' || outcome === 'success') {
              update += `, total_completed = total_completed + 1`;
            }
            if (conversion) {
              update += `, total_conversions = total_conversions + 1`;
            }

            update += ` WHERE campaign_id = ? AND date = ?`;

            this.db.db.run(update, [campaignId, today], resolve);
          }
        }
      );
    });
  }

  /**
   * Pause campaign
   */
  async pauseCampaign(campaignId) {
    return new Promise((resolve, reject) => {
      this.db.db.run(
        `UPDATE campaigns SET status = ?, paused_at = ? WHERE campaign_id = ?`,
        ['paused', new Date().toISOString(), campaignId],
        (err) => {
          if (err) reject(err);
          else {
            this.activeCampaigns.delete(campaignId);
            console.log(`⏸️ Campaign paused: ${campaignId}`);
            resolve();
          }
        }
      );
    });
  }

  /**
   * Complete campaign
   */
  async _completeCampaign(campaignId) {
    return new Promise((resolve) => {
      this.db.db.run(
        `UPDATE campaigns SET status = ?, completed_at = ? WHERE campaign_id = ?`,
        ['completed', new Date().toISOString(), campaignId],
        () => {
          this.activeCampaigns.delete(campaignId);
          this.campaignQueues.delete(campaignId);
          console.log(`✅ Campaign completed: ${campaignId}`);
          resolve();
        }
      );
    });
  }

  /**
   * Get campaign details with metrics
   */
  async getCampaignDetails(campaignId) {
    return new Promise((resolve, reject) => {
      this.db.db.get(
        `SELECT * FROM campaigns WHERE campaign_id = ?`,
        [campaignId],
        (err, campaign) => {
          if (err || !campaign) {
            reject(new Error('Campaign not found'));
            return;
          }

          this.db.db.all(
            `SELECT * FROM campaign_metrics WHERE campaign_id = ? ORDER BY date DESC LIMIT 30`,
            [campaignId],
            (err, metrics) => {
              if (err) {
                reject(err);
                return;
              }

              const summary = metrics.reduce(
                (acc, m) => ({
                  totalDialed: acc.totalDialed + m.total_dialed,
                  totalAnswered: acc.totalAnswered + m.total_answered,
                  totalVoicemail: acc.totalVoicemail + m.total_voicemail,
                  totalConversions: acc.totalConversions + m.total_conversions,
                  totalCost: acc.totalCost + m.cost
                }),
                { totalDialed: 0, totalAnswered: 0, totalVoicemail: 0, totalConversions: 0, totalCost: 0 }
              );

              const answerRate = summary.totalDialed > 0 ? 
                ((summary.totalAnswered / summary.totalDialed) * 100).toFixed(2) : 0;

              const conversionRate = summary.totalAnswered > 0 ?
                ((summary.totalConversions / summary.totalAnswered) * 100).toFixed(2) : 0;

              resolve({
                campaign: { ...campaign, metadata: JSON.parse(campaign.metadata || '{}') },
                summary,
                answerRate: parseFloat(answerRate),
                conversionRate: parseFloat(conversionRate),
                metrics
              });
            }
          );
        }
      );
    });
  }

  /**
   * Phone number validation
   */
  _isValidPhoneNumber(phone) {
    // Remove non-digit characters
    const digits = phone.replace(/\D/g, '');
    // Basic validation: 10+ digits
    return digits.length >= 10;
  }
}

module.exports = CampaignManager;
