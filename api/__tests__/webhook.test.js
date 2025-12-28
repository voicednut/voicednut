/**
 * Webhook Deduplication Tests
 * Tests for webhook idempotency and deduplication logic
 */

const crypto = require('crypto');

// Mock webhook deduplication function
function createWebhookHash(callSid, eventType, eventData) {
  const dataStr = JSON.stringify({
    call_sid: callSid,
    event_type: eventType,
    timestamp: eventData.timestamp,
    payload: eventData.payload
  });
  return crypto
    .createHash('sha256')
    .update(dataStr)
    .digest('hex');
}

describe('Webhook Deduplication', () => {
  test('should create unique hash for different events', () => {
    const event1 = {
      timestamp: '2025-01-01T10:00:00Z',
      payload: { status: 'answered' }
    };
    const event2 = {
      timestamp: '2025-01-01T10:00:01Z',
      payload: { status: 'completed' }
    };

    const hash1 = createWebhookHash('SID123', 'status', event1);
    const hash2 = createWebhookHash('SID123', 'status', event2);
    
    expect(hash1).not.toBe(hash2);
  });

  test('should create same hash for identical events', () => {
    const event = {
      timestamp: '2025-01-01T10:00:00Z',
      payload: { status: 'answered' }
    };

    const hash1 = createWebhookHash('SID123', 'status', event);
    const hash2 = createWebhookHash('SID123', 'status', event);
    
    expect(hash1).toBe(hash2);
  });

  test('should detect duplicate webhooks', () => {
    const processedWebhooks = new Set();
    const event = {
      timestamp: '2025-01-01T10:00:00Z',
      payload: { status: 'answered' }
    };
    const hash = createWebhookHash('SID123', 'status', event);

    // First attempt - should process
    const isDuplicate1 = processedWebhooks.has(hash);
    if (!isDuplicate1) {
      processedWebhooks.add(hash);
    }
    
    // Second attempt - should be duplicate
    const isDuplicate2 = processedWebhooks.has(hash);

    expect(isDuplicate1).toBe(false);
    expect(isDuplicate2).toBe(true);
  });
});

describe('Webhook Status Progression', () => {
  const statusOrder = ['queued', 'initiated', 'ringing', 'in-progress', 'answered', 'completed', 'busy', 'no-answer', 'failed', 'canceled'];
  
  function isValidStatusProgression(currentStatus, newStatus) {
    const currentIndex = statusOrder.indexOf(currentStatus);
    const newIndex = statusOrder.indexOf(newStatus);
    
    // Allow progression forward or to terminal states
    const isFailureState = ['busy', 'no-answer', 'failed', 'canceled'].includes(newStatus);
    return newIndex > currentIndex || isFailureState;
  }

  test('should allow forward progression', () => {
    expect(isValidStatusProgression('queued', 'initiated')).toBe(true);
    expect(isValidStatusProgression('initiated', 'ringing')).toBe(true);
    expect(isValidStatusProgression('ringing', 'answered')).toBe(true);
  });

  test('should allow transition to failure states', () => {
    expect(isValidStatusProgression('ringing', 'busy')).toBe(true);
    expect(isValidStatusProgression('initiated', 'failed')).toBe(true);
    expect(isValidStatusProgression('answered', 'completed')).toBe(true);
  });

  test('should reject backward progression', () => {
    expect(isValidStatusProgression('answered', 'ringing')).toBe(false);
    expect(isValidStatusProgression('completed', 'initiated')).toBe(false);
  });
});

module.exports = { createWebhookHash };
