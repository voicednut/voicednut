const GptCallHandler = require('./GptCallHandler');
const OtpCallHandler = require('./OtpCallHandler');
const InputCollectionHandler = require('./InputCollectionHandler');

/**
 * CallHandlerFactory - Creates appropriate handler based on call type
 * Provides unified interface for all call types
 */
class CallHandlerFactory {
  /**
   * Create handler instance
   * @param {string} callType - Type of call: 'gpt', 'otp', 'collect_input'
   * @param {string|object} metadata - Metadata JSON or object
   * @param {object} options - Handler options (db, provider, etc)
   * @returns {CallHandler} - Appropriate handler instance
   */
  static createHandler(callType, metadata, options = {}) {
    const type = (callType || 'gpt').toLowerCase();

    switch (type) {
      case 'otp':
        return new OtpCallHandler(metadata, options);

      case 'collect_input':
      case 'input_collection':
        return new InputCollectionHandler(metadata, options);

      case 'gpt':
      default:
        // If it's an OTP request within GPT, still use GPT handler
        // OTP will be handled as a function call
        const template = options.template || null;
        return new GptCallHandler(template, metadata, options);
    }
  }

  /**
   * Determine call type from request parameters
   */
  static determineCallType(req) {
    // Check query parameters
    if (req.query?.call_type) {
      return req.query.call_type;
    }

    // Check body parameters
    if (req.body?.call_type) {
      return req.body.call_type;
    }

    // Check metadata
    try {
      const metadata = typeof req.body?.metadata_json === 'string'
        ? JSON.parse(req.body.metadata_json)
        : req.body?.metadata_json;

      if (metadata?.call_type) {
        return metadata.call_type;
      }

      // Infer from metadata presence
      if (metadata?.otp_scenario) {
        return 'otp';
      }
      if (metadata?.input_sequence) {
        return 'collect_input';
      }
    } catch (e) {
      // Ignore parse errors
    }

    // Default to GPT
    return 'gpt';
  }

  /**
   * Validate metadata for call type
   */
  static validateMetadata(callType, metadata) {
    const errors = [];
    const type = (callType || 'gpt').toLowerCase();

    try {
      const parsed = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;

      switch (type) {
        case 'otp':
          if (!parsed.otp_scenario) {
            errors.push('otp_scenario is required for OTP calls');
          }
          if (!['paypal', 'amazon', 'bank', 'google', 'instagram', 'microsoft'].includes(parsed.otp_scenario)) {
            errors.push(`Unknown OTP scenario: ${parsed.otp_scenario}`);
          }
          break;

        case 'collect_input':
        case 'input_collection':
          if (!parsed.input_sequence || !Array.isArray(parsed.input_sequence)) {
            errors.push('input_sequence is required and must be an array');
          }
          if (Array.isArray(parsed.input_sequence) && parsed.input_sequence.length === 0) {
            errors.push('input_sequence cannot be empty');
          }
          if (Array.isArray(parsed.input_sequence) && parsed.input_sequence.length > 20) {
            errors.push('input_sequence cannot have more than 20 stages');
          }
          break;

        case 'gpt':
        default:
          // No specific requirements for GPT
          break;
      }
    } catch (error) {
      errors.push(`Failed to parse metadata: ${error.message}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = CallHandlerFactory;
