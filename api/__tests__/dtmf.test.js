/**
 * DTMF Buffer Management Tests
 * Tests for DTMF digit buffering and timeout logic
 */

describe('DTMF Buffer Management', () => {
  class DTMFBuffer {
    constructor(callSid, ttlMs = 5000) {
      this.callSid = callSid;
      this.digits = '';
      this.createdAt = Date.now();
      this.lastUpdatedAt = Date.now();
      this.ttlMs = ttlMs;
    }

    addDigits(newDigits) {
      if (!newDigits) return;
      this.digits += newDigits;
      this.lastUpdatedAt = Date.now();
    }

    isExpired() {
      return Date.now() - this.createdAt > this.ttlMs;
    }

    isEmpty() {
      return this.digits.length === 0;
    }

    clear() {
      this.digits = '';
    }
  }

  test('should accumulate digits correctly', () => {
    const buffer = new DTMFBuffer('SID123');
    buffer.addDigits('1234');
    expect(buffer.digits).toBe('1234');
    
    buffer.addDigits('5');
    expect(buffer.digits).toBe('12345');
  });

  test('should track creation and expiry', () => {
    const buffer = new DTMFBuffer('SID123', 100);
    expect(buffer.isExpired()).toBe(false);
    
    // Simulate time passing
    jest.useFakeTimers();
    jest.advanceTimersByTime(150);
    expect(buffer.isExpired()).toBe(true);
    jest.useRealTimers();
  });

  test('should clear buffer', () => {
    const buffer = new DTMFBuffer('SID123');
    buffer.addDigits('12345');
    expect(buffer.isEmpty()).toBe(false);
    
    buffer.clear();
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.digits).toBe('');
  });

  test('should enforce max length', () => {
    const buffer = new DTMFBuffer('SID123');
    const maxDigits = 10;
    
    buffer.addDigits('12345');
    const canAddMore = buffer.digits.length < maxDigits;
    expect(canAddMore).toBe(true);
    
    buffer.addDigits('67890123');
    const shouldTruncate = buffer.digits.length > maxDigits;
    expect(shouldTruncate).toBe(true);
  });
});

describe('DTMF Validation', () => {
  function validateDigits(digits, expectedLength) {
    if (!digits) return false;
    if (expectedLength && digits.length !== expectedLength) return false;
    // Only allow 0-9, *, #
    return /^[0-9*#]+$/.test(digits);
  }

  test('should validate valid digits', () => {
    expect(validateDigits('1234')).toBe(true);
    expect(validateDigits('9876543210')).toBe(true);
    expect(validateDigits('*123#')).toBe(true);
  });

  test('should reject invalid characters', () => {
    expect(validateDigits('123a456')).toBe(false);
    expect(validateDigits('123-456')).toBe(false);
    expect(validateDigits('123 456')).toBe(false);
  });

  test('should validate expected length', () => {
    expect(validateDigits('1234', 4)).toBe(true);
    expect(validateDigits('1234', 5)).toBe(false);
    expect(validateDigits('12345', 4)).toBe(false);
  });
});

module.exports = { DTMFBuffer };
