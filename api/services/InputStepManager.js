/**
 * InputStepManager: Unified state machine for DTMF input collection
 * Handles all digit collection flows with deterministic validation,
 * TwiML <Gather> integration, and professional UX
 */

class InputStep {
  constructor(config) {
    // Core identification
    this.stepId = config.stepId; // e.g., "verify_account_number"
    this.label = config.label; // e.g., "Account Number"
    
    // Prompt configuration
    this.promptText = config.promptText; // "Please enter your 6-digit reference number."
    this.helpPrompt = config.helpPrompt || null; // e.g., "Press 1 to repeat. Press 2 for help."
    
    // Length validation
    this.expectedLen = config.expectedLen || null; // Fixed length (e.g., 6)
    this.minLen = config.minLen || null; // Minimum (for variable-length)
    this.maxLen = config.maxLen || null; // Maximum
    this.finishOnKey = config.finishOnKey || '#'; // Terminator key (variable-length)
    
    // Validation rules
    this.validation = config.validation || {}; // { type: 'regex'/'range'/'lookup', pattern/min/max/lookup }
    this.isSensitive = config.isSensitive !== false; // Default: sensitive (OTP, PIN, SSN)
    this.confirmMode = config.confirmMode || 'confirm-by-length'; // 'none' / 'confirm-by-length' / 'confirm-prompt'
    
    // Feedback messages
    this.successMessage = config.successMessage || 'Received {digitsLen} digits.';
    this.failureMessage = config.failureMessage || "That format isn't valid. Let's try again.";
    this.incompleteMessage = config.incompleteMessage || 'That was incomplete.';
    this.helpMessage = config.helpMessage || 'Please enter your information now.';
    
    // Timeout & retry behavior
    this.timeoutSeconds = config.timeoutSeconds || 5;
    this.maxRetries = config.maxRetries || 3;
    this.silenceTimeoutMs = config.silenceTimeoutMs || 6000; // After maxRetries, end gracefully
    
    // State tracking (per-call)
    this.state = {
      attempt: 0,
      digitsCollected: '',
      confirmed: false,
      lastError: null,
      completedAt: null
    };
  }

  /**
   * Validate collected digits against this step's rules
   * @param {string} digits - Raw DTMF string
   * @returns {object} { isValid: bool, error?: string, maskedDisplay: string }
   */
  validateDigits(digits) {
    if (!digits || digits.length === 0) {
      return {
        isValid: false,
        error: 'no_input',
        maskedDisplay: ''
      };
    }

    // Length check
    if (this.expectedLen && digits.length !== this.expectedLen) {
      return {
        isValid: false,
        error: `expected_${this.expectedLen}_digits`,
        maskedDisplay: `${digits.length} digits received`
      };
    }

    if (this.minLen && digits.length < this.minLen) {
      return {
        isValid: false,
        error: `too_short_min_${this.minLen}`,
        maskedDisplay: `${digits.length} digits (need ${this.minLen})`
      };
    }

    if (this.maxLen && digits.length > this.maxLen) {
      return {
        isValid: false,
        error: `too_long_max_${this.maxLen}`,
        maskedDisplay: `${digits.length} digits (max ${this.maxLen})`
      };
    }

    // Custom validation
    if (this.validation.type === 'regex' && this.validation.pattern) {
      const regex = new RegExp(this.validation.pattern);
      if (!regex.test(digits)) {
        return {
          isValid: false,
          error: 'pattern_mismatch',
          maskedDisplay: this.maskDigits(digits)
        };
      }
    }

    if (this.validation.type === 'range' && (this.validation.min || this.validation.max)) {
      const num = parseInt(digits, 10);
      if (this.validation.min && num < this.validation.min) {
        return {
          isValid: false,
          error: `below_minimum_${this.validation.min}`,
          maskedDisplay: digits
        };
      }
      if (this.validation.max && num > this.validation.max) {
        return {
          isValid: false,
          error: `exceeds_maximum_${this.validation.max}`,
          maskedDisplay: digits
        };
      }
    }

    if (this.validation.type === 'lookup' && Array.isArray(this.validation.allowedValues)) {
      if (!this.validation.allowedValues.includes(digits)) {
        return {
          isValid: false,
          error: 'not_in_allowed_values',
          maskedDisplay: this.maskDigits(digits)
        };
      }
    }

    // All checks passed
    return {
      isValid: true,
      maskedDisplay: this.maskDigits(digits)
    };
  }

  /**
   * Mask sensitive digits for display/logging
   * e.g., "123456" → "••••56"
   */
  maskDigits(digits) {
    if (!this.isSensitive || !digits) return digits;
    if (digits.length <= 2) return '•'.repeat(digits.length);
    const showLen = Math.min(2, Math.ceil(digits.length / 3));
    return '•'.repeat(digits.length - showLen) + digits.slice(-showLen);
  }

  /**
   * Get the TwiML <Gather> configuration for Twilio
   */
  getGatherConfig() {
    const config = {
      action: '/webhook/dtmf-input', // Webhook endpoint
      method: 'POST',
      timeout: this.timeoutSeconds,
      finishOnKey: this.finishOnKey,
      numDigits: this.expectedLen || null, // Only set if fixed-length
      input: 'dtmf'
    };

    // Remove null values
    Object.keys(config).forEach(key => config[key] === null && delete config[key]);

    return config;
  }

  /**
   * Build TwiML Say message for prompt
   */
  getPromptMessage() {
    return this.promptText;
  }

  /**
   * Get appropriate feedback message based on validation result
   */
  getFeedbackMessage(validationResult, attempt) {
    if (validationResult.isValid) {
      return this.successMessage.replace('{digitsLen}', validationResult.maskedDisplay);
    }

    if (attempt >= this.maxRetries) {
      return `We couldn't get valid input. ${this.label} will be required to complete this call.`;
    }

    if (validationResult.error === 'no_input') {
      return `I didn't receive any input. ${this.getPromptMessage()}`;
    }

    return this.failureMessage;
  }

  /**
   * Record this step's completion
   */
  complete(digits, validationResult) {
    this.state.digitsCollected = digits;
    this.state.confirmed = validationResult.isValid;
    this.state.completedAt = new Date().toISOString();
  }

  /**
   * Reset for retry
   */
  recordAttempt(attempt, error) {
    this.state.attempt = attempt;
    this.state.lastError = error;
  }
}

/**
 * InputStepManager: Orchestrates input collection across a call
 */
class InputStepManager {
  constructor(db) {
    this.db = db;
    this.steps = new Map(); // stepId → InputStep
    this.callSteps = new Map(); // callSid → { currentStepIndex, steps: [InputStep], state: Map }
  }

  /**
   * Register an input step definition
   */
  registerStep(step) {
    if (!(step instanceof InputStep)) {
      step = new InputStep(step);
    }
    this.steps.set(step.stepId, step);
    return step;
  }

  /**
   * Initialize input collection for a call
   * @param {string} callSid
   * @param {array} stepConfigs - Array of InputStep configs
   */
  async initializeForCall(callSid, stepConfigs) {
    const steps = stepConfigs.map(config => {
      if (config instanceof InputStep) return config;
      return this.steps.get(config.stepId) || new InputStep(config);
    });

    this.callSteps.set(callSid, {
      currentStepIndex: 0,
      steps,
      state: new Map(), // stepId → { attempt, digitsCollected, confirmed }
      startedAt: Date.now()
    });

    // Persist to DB
    await this.db.persistInputFlow(callSid, steps.map(s => s.stepId));

    return steps[0]; // Return first step
  }

  /**
   * Get current step for a call
   */
  getCurrentStep(callSid) {
    const callState = this.callSteps.get(callSid);
    if (!callState || callState.currentStepIndex >= callState.steps.length) {
      return null;
    }
    return callState.steps[callState.currentStepIndex];
  }

  /**
   * Process digit input and advance if complete
   * @returns {object} { isStepComplete, nextStep, feedback, shouldAdvance }
   */
  async processInput(callSid, digits) {
    const callState = this.callSteps.get(callSid);
    if (!callState) {
      return { isStepComplete: false, error: 'call_not_found' };
    }

    const step = callState.steps[callState.currentStepIndex];
    if (!step) {
      return { isStepComplete: false, error: 'no_current_step' };
    }

    // Increment attempt
    const attempt = (callState.state.get(step.stepId)?.attempt || 0) + 1;
    const validation = step.validateDigits(digits);

    // Record attempt
    callState.state.set(step.stepId, {
      attempt,
      digitsCollected: digits,
      confirmed: validation.isValid,
      validationError: validation.error,
      maskedDisplay: validation.maskedDisplay
    });

    // Persist attempt to DB
    await this.db.recordInputAttempt(callSid, step.stepId, {
      attempt,
      digitsLen: digits.length,
      maskedDigits: step.maskDigits(digits),
      isValid: validation.isValid,
      validationError: validation.error
    });

    const feedback = step.getFeedbackMessage(validation, attempt);

    // Determine next action
    if (validation.isValid) {
      // Move to next step
      callState.currentStepIndex += 1;
      const nextStep = callState.steps[callState.currentStepIndex] || null;

      return {
        isStepComplete: true,
        isFlowComplete: !nextStep,
        nextStep,
        feedback,
        shouldAdvance: true,
        digitsCollected: digits,
        maskedDisplay: validation.maskedDisplay
      };
    }

    // Validation failed
    if (attempt >= step.maxRetries) {
      return {
        isStepComplete: false,
        flowFailed: true,
        feedback: `After ${attempt} attempts, we couldn't validate your ${step.label.toLowerCase()}.`,
        shouldAdvance: false,
        attempt,
        maxRetries: step.maxRetries
      };
    }

    // Reprompt
    return {
      isStepComplete: false,
      flowFailed: false,
      feedback: `${feedback} Please try again.`,
      shouldAdvance: false,
      attempt,
      maxRetries: step.maxRetries
    };
  }

  /**
   * Get full input collection state for a call
   */
  getCallInputState(callSid) {
    const callState = this.callSteps.get(callSid);
    if (!callState) return null;

    return {
      currentStepIndex: callState.currentStepIndex,
      totalSteps: callState.steps.length,
      currentStep: callState.steps[callState.currentStepIndex] || null,
      completedSteps: Array.from(callState.state.entries()).map(([stepId, state]) => ({
        stepId,
        ...state
      })),
      isComplete: callState.currentStepIndex >= callState.steps.length,
      progress: `${callState.currentStepIndex} of ${callState.steps.length}`
    };
  }

  /**
   * Clean up call state
   */
  clearCallState(callSid) {
    this.callSteps.delete(callSid);
  }
}

module.exports = { InputStep, InputStepManager };
