'use strict';

const crypto = require('crypto');
const config = require('../config');

const STAGE_DEFINITIONS = {
  SSN_LAST4: { label: 'SSN', mask: (digits) => '••••' },
  DOB_MMDD: { label: 'DOB', mask: (digits) => '••••' },
  CARD_PAN: {
    label: 'Card Number',
    mask: (digits = '') => digits.replace(/\d(?=\d{4})/g, '*'),
  },
  CVV: { label: 'CVV', mask: () => '***' },
};

const GENERIC_STAGE = { label: 'Entry', mask: (digits = '') => digits.replace(/\d/g, '•') };

function normalizeStage(stageKey = 'generic') {
  if (!stageKey) return 'GENERIC';
  return stageKey.toString().trim().toUpperCase();
}

function getStageDefinition(stageKey) {
  const normalized = normalizeStage(stageKey);
  return STAGE_DEFINITIONS[normalized] || { ...GENERIC_STAGE, label: normalized }; // keep original label for unknown stage
}

function maskDigits(stageKey, digits) {
  const entry = getStageDefinition(stageKey);
  try {
    return entry.mask(String(digits || ''));
  } catch (error) {
    return GENERIC_STAGE.mask(String(digits || ''));
  }
}

function getEncryptionKey() {
  const raw = config.compliance.encryptionKey;
  if (!raw) return null;

  let decoded;
  try {
    if (raw.length === 64 && /^[0-9a-f]+$/i.test(raw)) {
      decoded = Buffer.from(raw, 'hex');
    } else {
      decoded = Buffer.from(raw, 'base64');
    }
  } catch (error) {
    console.warn('Invalid DTMF_ENCRYPTION_KEY. Expected base64 or hex encoded string.');
    return null;
  }

  if (decoded.length !== 32) {
    console.warn('DTMF_ENCRYPTION_KEY must be 32 bytes for AES-256-GCM.');
    return null;
  }

  return decoded;
}

function encryptDigits(rawDigits) {
  const key = getEncryptionKey();
  if (!key || !rawDigits) {
    return null;
  }

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(rawDigits), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

function decryptDigits(payload) {
  if (!payload) return null;
  const key = getEncryptionKey();
  if (!key) return null;

  try {
    const buffer = Buffer.from(payload, 'base64');
    const iv = buffer.subarray(0, 12);
    const authTag = buffer.subarray(12, 28);
    const ciphertext = buffer.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch (error) {
    console.warn('Failed to decrypt DTMF entry:', error.message);
    return null;
  }
}

function shouldRevealRawDigits() {
  return config.compliance.mode === 'dev_insecure';
}

function buildMetadata(stageKey, digits) {
  const hash = crypto.createHash('sha256').update(String(digits || '')).digest('hex');
  return {
    stage_key: normalizeStage(stageKey),
    hash,
    length: String(digits || '').length,
  };
}

function savePayloadForCompliance(stageKey, digits, provider, extraMeta = {}) {
  const masked = maskDigits(stageKey, digits);
  const encrypted = encryptDigits(digits);
  const metadata = { ...buildMetadata(stageKey, digits), provider, ...extraMeta };
  return { maskedDigits: masked, encryptedDigits: encrypted, metadata };
}

function formatSummary(entries = []) {
  if (!entries.length) {
    return {
      summaryLines: ['No keypad entries were captured.'],
      containsRaw: false,
    };
  }

  const revealRaw = shouldRevealRawDigits();
  const summaryLines = entries.map((entry) => {
    const stage = getStageDefinition(entry.stage_key);
    const label = stage.label || entry.stage_key || 'Entry';
    let value = entry.masked_digits;
    if (revealRaw) {
      const decrypted = decryptDigits(entry.encrypted_digits);
      if (decrypted) {
        value = decrypted;
      }
    }
    return `${label}: ${value}`;
  });

  return { summaryLines, containsRaw: revealRaw };
}

module.exports = {
  normalizeStage,
  maskDigits,
  encryptDigits,
  decryptDigits,
  savePayloadForCompliance,
  shouldRevealRawDigits,
  formatSummary,
  getStageDefinition,
};

