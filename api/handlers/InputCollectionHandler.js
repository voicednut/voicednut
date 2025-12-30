const CallHandler = require('./CallHandler');
const InputOrchestrator = require('../services/InputOrchestrator');

/**
 * InputCollectionHandler - Handles pure DTMF collection calls (no AI)
 * Used for IVR, surveys, or any structured input gathering
 */
class InputCollectionHandler extends CallHandler {
  constructor(metadata_json, options = {}) {
    super(metadata_json, options);
    this.inputOrchestrator = null;
    this.currentStageIndex = 0;
    this.collectedInputs = [];
    this.phase = 'greeting'; // greeting, collecting, validating, completed
  }

  /**
   * Initialize input collection call
   */
  async initiate(to, from) {
    return this.executeWithErrorHandling(async () => {
      if (!this.db) {
        throw new Error('Database connection required for InputCollectionHandler');
      }

      // Validate input sequence is provided
      if (!this.metadata.input_sequence || !Array.isArray(this.metadata.input_sequence) || this.metadata.input_sequence.length === 0) {
        throw new Error('input_sequence is required and must be a non-empty array');
      }

      // Create call record
      const callData = {
        call_type: 'collect_input',
        to,
        from,
        status: 'initiated',
        metadata_json: JSON.stringify(this.metadata),
        started_at: new Date().toISOString()
      };

      const callRecord = await this.db.saveCall(callData);
      this.callSid = callRecord.call_sid;

      console.log(`📋 Initiating input collection call ${this.callSid} with ${this.metadata.input_sequence.length} stages`);

      // Initialize orchestrator
      this.inputOrchestrator = new InputOrchestrator({
        call_type: 'collect_input',
        collect_input_sequence: this.metadata.input_sequence,
        metadata_json: JSON.stringify(this.metadata)
      });

      // Create Twilio call
      const twilio = require('twilio');
      const config = require('../config');

      if (!config.twilio.accountSid || !config.twilio.authToken) {
        throw new Error('Twilio credentials not configured');
      }

      const client = twilio(config.twilio.accountSid, config.twilio.authToken);

      const webhookUrl = this.buildWebhookUrl(`/incoming?CallSid=${encodeURIComponent(this.callSid)}&call_type=collect_input`);

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

        await this.db.updateCall(this.callSid, {
          status: 'ringing'
        });

        this.setupTimeout();
        console.log(`✅ Input collection call created: ${call.sid}`);

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
   * Handle incoming call - prompt for first input
   */
  async handleIncoming(twimlResponse) {
    return this.executeWithErrorHandling(async () => {
      const twiml = new (require('twilio').twiml.VoiceResponse)();

      if (this.phase === 'greeting') {
        // Initial greeting
        const greeting = this.metadata.greeting || 'Thank you for calling. We have a few quick questions.';
        twiml.say(greeting);
        this.phase = 'collecting';
      }

      // Get current stage
      const currentStage = this.inputOrchestrator.getStageAtIndex(this.currentStageIndex);
      if (!currentStage) {
        // All stages complete
        const thankYou = this.metadata.thank_you_message || 'Thank you for your responses.';
        twiml.say(thankYou);
        twiml.hangup();
        this.phase = 'completed';
        return twiml;
      }

      // Prompt for current stage
      const prompt = currentStage.prompt || `Please provide your ${currentStage.label}`;
      twiml.say(prompt);

      // Gather input
      const gatherOptions = {
        timeout: 10,
        actionOnEmptyResult: false
      };

      if (currentStage.numDigits) {
        gatherOptions.numDigits = currentStage.numDigits;
      } else {
        // Open-ended input (speech or press *)
        gatherOptions.input = 'dtmf';
        gatherOptions.finishOnKey = '#';
      }

      twiml.gather(gatherOptions);

      twiml.redirect(this.buildWebhookUrl(`/incoming?CallSid=${encodeURIComponent(this.callSid)}&call_type=collect_input&action=gather&stage=${this.currentStageIndex}`));

      return twiml;
    }, 'handleIncoming');
  }

  /**
   * Handle DTMF input
   */
  async handleDtmf(digits, stageKey) {
    return this.executeWithErrorHandling(async () => {
      if (!digits || digits.length === 0) {
        return {
          success: false,
          reason: 'empty_input',
          stage: this.currentStageIndex
        };
      }

      const callRecord = await this.db.getCall(this.callSid);
      if (!callRecord) {
        throw new Error(`Call record not found: ${this.callSid}`);
      }

      const currentStage = this.inputOrchestrator.getStageAtIndex(this.currentStageIndex);
      if (!currentStage) {
        return {
          success: false,
          reason: 'no_stage',
          stage: this.currentStageIndex
        };
      }

      // Save input
      await this.db.saveCallInput({
        call_sid: this.callSid,
        stage: currentStage.label || `stage_${this.currentStageIndex}`,
        input_value: digits,
        is_valid: true,
        attempt_number: 1,
        metadata: JSON.stringify({
          stage_index: this.currentStageIndex,
          stage_label: currentStage.label
        })
      });

      this.collectedInputs.push({
        stage: currentStage.label,
        value: digits,
        timestamp: new Date().toISOString()
      });

      // Move to next stage
      const hasMoreStages = this.currentStageIndex + 1 < this.inputOrchestrator.getStageCount();

      if (hasMoreStages) {
        this.currentStageIndex++;
      } else {
        this.phase = 'completed';
      }

      console.log(`✅ Collected input for stage ${this.currentStageIndex}: ${currentStage.label}`);

      return {
        success: true,
        stage: this.currentStageIndex,
        hasMoreStages,
        value: digits
      };
    }, 'handleDtmf');
  }

  /**
   * Handle status updates
   */
  async handleStatus(status) {
    return this.executeWithErrorHandling(async () => {
      const normalizedStatus = status.toLowerCase();

      console.log(`📊 Input collection call ${this.callSid} status: ${normalizedStatus}`);

      if (normalizedStatus === 'answered') {
        this.phase = 'greeting';
      } else if (['completed', 'failed', 'no-answer', 'busy', 'canceled'].includes(normalizedStatus)) {
        await this.finalize(normalizedStatus);
      }

      await this.db.updateCallStatus(this.callSid, normalizedStatus, {
        status: normalizedStatus,
        updated_at: new Date().toISOString()
      });
    }, 'handleStatus');
  }

  /**
   * Finalize input collection call
   */
  async finalize(status) {
    try {
      const duration = Math.floor((Date.now() - this.startTime) / 1000);

      const outcome = this.phase === 'completed' ? 'success' : 'incomplete';

      await this.db.updateCall(this.callSid, {
        status,
        ended_at: new Date().toISOString(),
        duration_seconds: duration,
        metadata_json: JSON.stringify({
          ...this.metadata,
          collection_outcome: outcome,
          collected_stages: this.collectedInputs.length,
          total_stages: this.inputOrchestrator.getStageCount()
        })
      });

      await this.cleanup(status);

      console.log(`✅ Input collection call ${this.callSid} finalized (${outcome}, ${duration}s)`);
    } catch (error) {
      console.error('Error finalizing input collection call:', error.message);
    }
  }

  /**
   * Get input collection state
   */
  getState() {
    const base = super.getState();
    return {
      ...base,
      phase: this.phase,
      currentStageIndex: this.currentStageIndex,
      totalStages: this.inputOrchestrator ? this.inputOrchestrator.getStageCount() : 0,
      collectedInputs: this.collectedInputs.length
    };
  }
}

module.exports = InputCollectionHandler;
