const CallHandler = require('./CallHandler');
const { EnhancedGptService } = require('../routes/gpt');
const InputOrchestrator = require('../services/InputOrchestrator');
const DynamicFunctionEngine = require('../functions/DynamicFunctionEngine');
const PersonaComposer = require('../services/PersonaComposer');
const { StreamService } = require('../routes/stream');
const CircuitBreaker = require('../utils/CircuitBreaker');

/**
 * GptCallHandler - Handles GPT-powered conversational calls
 * Integrates with InputOrchestrator for DTMF collection when needed
 */
class GptCallHandler extends CallHandler {
  constructor(template, metadata_json, options = {}) {
    super(metadata_json, options);
    this.template = template;
    this.gptService = null;
    this.functionEngine = new DynamicFunctionEngine();
    this.personaComposer = new PersonaComposer();
    this.inputOrchestrator = null;
    this.streamService = null;
    this.interactionCount = 0;
    this.conversationPhase = 'greeting'; // greeting, collecting_input, in_conversation, closing
    
    // Circuit breaker for GPT API calls
    this.gptCircuitBreaker = new CircuitBreaker({
      name: 'GPT-API',
      failureThreshold: 5,
      resetTimeout: 30000,
      fallbackFn: () => this.getDefaultResponse()
    });
  }

  /**
   * Get default response when circuit is open
   */
  getDefaultResponse() {
    return {
      message: 'I am currently unable to process your request. Please try again later.',
      isFallback: true
    };
  }

  /**
   * Initialize GPT call
   */
  async initiate(to, from) {
    return this.executeWithErrorHandling(async () => {
      if (!this.db) {
        throw new Error('Database connection required for GptCallHandler');
      }

      // Validate inputs
      if (!to || !from) {
        throw new Error('Invalid phone numbers: to and from are required');
      }

      // Create call record
      const callData = {
        call_type: 'gpt',
        to,
        from,
        status: 'initiated',
        template: this.template,
        metadata_json: JSON.stringify(this.metadata),
        started_at: new Date().toISOString()
      };

      const callRecord = await this.db.saveCall(callData);
      this.callSid = callRecord.call_sid;

      console.log(`📞 Initiating GPT call ${this.callSid} to ${to}`);

      // Create Twilio call with webhook
      const twilio = require('twilio');
      const config = require('../config');
      
      if (!config.twilio.accountSid || !config.twilio.authToken) {
        throw new Error('Twilio credentials not configured');
      }

      const client = twilio(config.twilio.accountSid, config.twilio.authToken);
      
      const webhookUrl = this.buildWebhookUrl(`/incoming?CallSid=${encodeURIComponent(this.callSid)}&call_type=gpt`);
      
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
        
        // Update call record with actual Twilio SID
        await this.db.updateCall(this.callSid, {
          status: 'ringing'
        });

        this.setupTimeout();
        console.log(`✅ GPT call created: ${call.sid}`);
        
        return this.callSid;
      } catch (error) {
        // Log failure
        await this.db.updateCall(this.callSid, {
          status: 'failed',
          ended_at: new Date().toISOString()
        });
        throw error;
      }
    }, 'initiate');
  }

  /**
   * Build webhook URL with public hostname
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
   * Handle incoming call webhook
   */
  async handleIncoming(twimlResponse) {
    return this.executeWithErrorHandling(async () => {
      if (!this.gptService) {
        // Initialize GPT service
        const callRecord = await this.db.getCall(this.callSid);
        if (!callRecord) {
          throw new Error(`Call record not found: ${this.callSid}`);
        }

        // Build persona-aware prompt
        const prompt = this.personaComposer.compose({
          businessId: callRecord.business_id,
          customPrompt: callRecord.template,
          purpose: this.metadata.purpose || 'general',
          channel: 'voice',
          urgency: this.metadata.urgency || 'normal'
        });

        this.gptService = new EnhancedGptService(prompt);
        this.gptService.setCallSid(this.callSid);

        // Setup dynamic functions
        const functions = this.functionEngine.generateFunctions(this.metadata.business_id || 'default');
        this.gptService.setDynamicFunctions(functions.tools, functions.implementations);

        // Setup input orchestration if needed
        if (this.metadata.input_sequence || this.metadata.require_otp) {
          const callConfig = {
            collect_input_sequence: this.metadata.input_sequence || [],
            metadata_json: JSON.stringify(this.metadata)
          };
          this.inputOrchestrator = new InputOrchestrator(callConfig);
          this.conversationPhase = 'collecting_input';
        }

        // Handle GPT events
        this.gptService.on('gptreply', (data) => {
          this.emitSafe('gptreply', data);
        });

        this.gptService.on('timeout', async () => {
          await this.handleTimeout();
        });
      }

      // Get first message
      const firstMessage = this.gptService.firstMessage || 'Hello! How can I help you today?';
      
      const twiml = new (require('twilio').twiml.VoiceResponse)();
      twiml.say(firstMessage);
      
      // Setup gathering if input required
      if (this.inputOrchestrator) {
        const nextStage = this.inputOrchestrator.getNextStage();
        if (nextStage) {
          twiml.gather({
            numDigits: nextStage.numDigits || 1,
            timeout: 5,
            actionOnEmptyResult: false
          });
        }
      } else {
        // Gather for DTMF input during conversation
        twiml.gather({
          input: 'dtmf speech',
          timeout: 3,
          numDigits: 1,
          actionOnEmptyResult: true
        });
      }

      twiml.redirect(this.buildWebhookUrl(`/incoming?CallSid=${encodeURIComponent(this.callSid)}&call_type=gpt&action=gather`));

      return twiml;
    }, 'handleIncoming');
  }

  /**
   * Handle DTMF input
   */
  async handleDtmf(digits, stageKey) {
    return this.executeWithErrorHandling(async () => {
      if (!digits) return { success: false, reason: 'empty_input' };

      const callRecord = await this.db.getCall(this.callSid);
      if (!callRecord) {
        throw new Error(`Call record not found: ${this.callSid}`);
      }

      // If in input collection phase
      if (this.conversationPhase === 'collecting_input' && this.inputOrchestrator) {
        const result = await this.inputOrchestrator.validateAndAdvance(digits, stageKey);
        
        if (!result.success) {
          // Retry
          const nextAttempt = result.attempt + 1;
          if (nextAttempt >= (result.maxAttempts || 3)) {
            // Fallback to SMS
            await this.sendFallbackSms(callRecord, result);
            this.conversationPhase = 'in_conversation';
          }
        } else {
          // Move to next stage or conversation
          const hasMoreStages = this.inputOrchestrator.hasMoreStages();
          if (!hasMoreStages) {
            this.conversationPhase = 'in_conversation';
          }
        }

        return result;
      }

      // Otherwise, feed to GPT
      if (this.gptService) {
        this.interactionCount++;
        
        // Execute with circuit breaker protection
        const response = await this.gptCircuitBreaker.execute(
          async () => {
            return await this.gptService.completion(
              `Customer entered: ${digits}`,
              this.interactionCount,
              'user'
            );
          },
          () => this.getDefaultResponse()
        );
        
        return {
          success: !!response && !response.isFallback,
          response,
          interactionCount: this.interactionCount,
          circuitBreakerActive: response?.isFallback || false
        };
      }

      return { success: false, reason: 'gpt_not_ready' };
    }, 'handleDtmf');
  }

  /**
   * Send SMS fallback for failed DTMF collection
   */
  async sendFallbackSms(callRecord, failureData) {
    try {
      const smsService = require('../routes/sms').EnhancedSmsService;
      if (!smsService) return;

      const message = `We had trouble collecting information on the call. Please reply to confirm: ${failureData.expectedValue || 'your response'}`;
      
      await smsService.sendSMS(callRecord.to, message);
      
      await this.db.logServiceHealth('dtmf_fallback_sms', 'sent', {
        call_sid: this.callSid,
        reason: failureData.reason
      });
    } catch (error) {
      console.warn('Failed to send fallback SMS:', error.message);
    }
  }

  /**
   * Handle call status updates
   */
  async handleStatus(status) {
    return this.executeWithErrorHandling(async () => {
      const normalizedStatus = status.toLowerCase();

      console.log(`📊 Call ${this.callSid} status: ${normalizedStatus}`);

      if (normalizedStatus === 'answered') {
        this.conversationPhase = 'greeting';
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
   * Finalize call with cleanup
   */
  async finalize(status) {
    try {
      const duration = Math.floor((Date.now() - this.startTime) / 1000);
      
      await this.db.updateCall(this.callSid, {
        status,
        ended_at: new Date().toISOString(),
        duration_seconds: duration
      });

      // Cleanup resources
      await this.cleanup(status);

      console.log(`✅ Call ${this.callSid} finalized (${status}, ${duration}s)`);
    } catch (error) {
      console.error('Error finalizing call:', error.message);
    }
  }

  /**
   * Get handler diagnostics for monitoring
   */
  getHealthStatus() {
    return {
      callSid: this.callSid,
      conversationPhase: this.conversationPhase,
      interactionCount: this.interactionCount,
      uptime: Date.now() - this.startTime,
      circuitBreaker: this.gptCircuitBreaker.getState(),
      gptServiceActive: !!this.gptService,
      inputOrchestratorActive: !!this.inputOrchestrator
    };
  }

  /**
   * Handle timeout
   */
  async handleTimeout() {
    try {
      const twiml = new (require('twilio').twiml.VoiceResponse)();
      twiml.say('Sorry, the call took too long. Thank you for calling.');
      twiml.hangup();
      return twiml;
    } catch (error) {
      console.error('Error handling timeout:', error);
      return null;
    }
  }

  /**
   * Get call state including conversation details
   */
  getState() {
    const base = super.getState();
    return {
      ...base,
      conversationPhase: this.conversationPhase,
      interactionCount: this.interactionCount,
      hasGptService: !!this.gptService,
      hasInputOrchestrator: !!this.inputOrchestrator
    };
  }
}

module.exports = GptCallHandler;
