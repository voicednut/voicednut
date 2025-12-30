/**
 * Common Utility Functions
 * Shared helpers across routes
 */

/**
 * Mask sensitive digits for logging
 */
function maskDigits(value) {
  if (!value) return '';
  const str = String(value);
  if (str.length <= 2) {
    return `${'•'.repeat(Math.max(0, str.length - 1))}${str.slice(-1)}`;
  }
  const last = str.slice(-2);
  return `${'•'.repeat(str.length - 2)}${last}`;
}

/**
 * Sanitize digits from input
 */
function sanitizeDigits(rawInput) {
  if (rawInput == null) {
    return '';
  }
  return String(rawInput).replace(/[^0-9*#]/g, '');
}

/**
 * Sanitize customer name
 */
function sanitizeCustomerName(rawName) {
  if (!rawName) {
    return null;
  }
  const cleaned = rawName
    .toString()
    .replace(/[^a-zA-Z0-9\s'\-]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return cleaned || null;
}

/**
 * Build personalized greeting
 */
function buildPersonalizedFirstMessage(baseMessage, customerName, personaLabel) {
  if (!customerName) {
    return baseMessage;
  }
  const greeting = `Hello ${customerName}!`;
  const trimmedBase = (baseMessage || '').trim();
  if (!trimmedBase) {
    return greeting;
  }
  const withoutExistingGreeting = trimmedBase.replace(/^hello[^.!?]*[.!?]?\s*/i, '').trim();
  const remainder = withoutExistingGreeting.length ? withoutExistingGreeting : trimmedBase;
  return `${greeting} ${remainder}`;
}

/**
 * Parse metadata JSON safely
 */
function parseMetadataJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn('⚠️ Failed to parse metadata JSON:', error.message);
    return null;
  }
}

/**
 * Convert value to boolean
 */
function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
  return false;
}

/**
 * Get status icon emoji
 */
function getStatusIcon(status) {
  const icons = {
    'queued': '⏳',
    'ringing': '📞',
    'in-progress': '🎧',
    'completed': '✅',
    'failed': '❌',
    'no-answer': '⏸️',
    'busy': '🔴',
    'cancelled': '⛔'
  };
  return icons[status?.toLowerCase()] || '❓';
}

/**
 * Extract digits from various payload formats
 */
function extractDigitsFromPayload(candidate) {
  if (candidate == null) {
    return '';
  }
  if (typeof candidate === 'string' || typeof candidate === 'number') {
    return sanitizeDigits(candidate);
  }
  if (typeof candidate === 'object') {
    if (typeof candidate.digits === 'string') return sanitizeDigits(candidate.digits);
    if (typeof candidate.value === 'string') return sanitizeDigits(candidate.value);
    if (typeof candidate.input === 'string') return sanitizeDigits(candidate.input);
  }
  return '';
}

/**
 * Append digits safely
 */
function appendDigits(existing, incoming) {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (incoming === existing) return existing;
  if (incoming.startsWith(existing)) {
    return incoming;
  }
  if (existing.startsWith(incoming)) {
    return existing;
  }
  if (incoming.length === 1) {
    return existing + incoming;
  }
  return existing + incoming;
}

/**
 * Build default input sequence
 */
function getDefaultInputSequence(numDigits = 4) {
  return [
    {
      stage: 'ENTRY',
      label: 'Entry',
      prompt: 'Please enter the requested digits followed by the pound key.',
      numDigits: Number(numDigits) || null,
      timeout: 5
    }
  ];
}

/**
 * Normalize input sequence payload
 */
function normalizeInputSequencePayload(rawSequence, fallbackDigits = 4) {
  if (!Array.isArray(rawSequence) || rawSequence.length === 0) {
    return getDefaultInputSequence(fallbackDigits);
  }

  return rawSequence.map((step, index) => ({
    stage: step.stage || `STAGE_${index}`,
    label: step.label || step.stage || 'Input',
    prompt: step.prompt || 'Please enter your input followed by pound.',
    numDigits: Number(step.numDigits) || Number(step.length) || fallbackDigits,
    timeout: Number(step.timeout) || 10,
    successMessage: step.successMessage || 'Thank you.',
    failureMessage: step.failureMessage || 'Invalid input. Please try again.'
  }));
}

/**
 * Get stage constraints from config
 */
function getStageConstraints(stageConfig = {}, callMetadata = {}) {
  const expectedLength =
    Number(stageConfig.numDigits) ||
    Number(stageConfig.expectedLength) ||
    Number(stageConfig.length) ||
    Number(callMetadata.default_digit_length) ||
    null;
  const allowedPattern = stageConfig.allowedPattern || stageConfig.pattern || /^[0-9]+$/;
  const maxAttempts =
    Number(stageConfig.maxAttempts) ||
    Number(callMetadata.max_attempts) ||
    3;

  return {
    expectedLength: Number.isFinite(expectedLength) ? expectedLength : null,
    allowedPattern,
    maxAttempts: Number.isFinite(maxAttempts) && maxAttempts > 0 ? maxAttempts : 3
  };
}

/**
 * Resolve expected OTP from metadata
 */
function resolveExpectedOtp(callMetadata = {}) {
  return (
    callMetadata.expected_otp ||
    callMetadata.otp_code ||
    callMetadata.one_time_passcode ||
    callMetadata.expected_passcode ||
    callMetadata.passcode ||
    null
  );
}

/**
 * Build input steps from config and metadata
 */
function buildInputSteps(callConfig = {}, metadata = {}) {
  const sequenceFromConfig = Array.isArray(callConfig.collect_input_sequence) ? callConfig.collect_input_sequence : null;
  const sequenceFromMetadata = Array.isArray(metadata.input_sequence) ? metadata.input_sequence : null;
  const baseSequence = (sequenceFromConfig && sequenceFromConfig.length)
    ? sequenceFromConfig
    : (sequenceFromMetadata && sequenceFromMetadata.length)
      ? sequenceFromMetadata
      : getDefaultInputSequence(callConfig.collect_digits || 4);

  return baseSequence.map((rawStep, index) => ({
    ...rawStep,
    index
  }));
}

module.exports = {
  maskDigits,
  sanitizeDigits,
  sanitizeCustomerName,
  buildPersonalizedFirstMessage,
  parseMetadataJson,
  toBoolean,
  getStatusIcon,
  extractDigitsFromPayload,
  appendDigits,
  getDefaultInputSequence,
  normalizeInputSequencePayload,
  getStageConstraints,
  resolveExpectedOtp,
  buildInputSteps
};
