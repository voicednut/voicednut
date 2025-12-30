/**
 * OTP System Integration Tests
 * 
 * Run with: cd apii && npm test -- __tests__/otp.test.js
 */

const OtpScenarioEngine = require('../services/OtpScenarioEngine');

describe('OTP Scenario Engine', () => {
  let engine;
  const mockDb = {
    execute: jest.fn().mockResolvedValue({ success: true }),
    query: jest.fn().mockResolvedValue([])
  };
  const mockConfig = {
    dtmfEncryption: false,
    dtmfEncryptionKey: null
  };

  beforeEach(() => {
    engine = new OtpScenarioEngine(mockDb, mockConfig);
    jest.clearAllMocks();
  });

  describe('Scenario Management', () => {
    test('should list all available scenarios', () => {
      const scenarios = engine.listScenarios();
      expect(scenarios.length).toBeGreaterThan(0);
      expect(scenarios[0]).toHaveProperty('key');
      expect(scenarios[0]).toHaveProperty('name');
      expect(scenarios[0]).toHaveProperty('digits');
    });

    test('should get specific scenario by key', () => {
      const scenario = engine.getScenario('paypal');
      expect(scenario).toBeDefined();
      expect(scenario.digits).toBe(6);
      expect(scenario.name).toBe('PayPal Verification');
    });

    test('should return null for unknown scenario', () => {
      const scenario = engine.getScenario('invalid_service');
      expect(scenario).toBeNull();
    });

    test('should handle case-insensitive scenario lookup', () => {
      const scenario1 = engine.getScenario('PAYPAL');
      const scenario2 = engine.getScenario('paypal');
      expect(scenario1).toEqual(scenario2);
    });
  });

  describe('Call Initialization', () => {
    test('should initialize call state', () => {
      const callSid = 'test_call_123';
      const state = engine.initializeCall(callSid, {
        service: 'amazon',
        userId: 'user_456',
        businessId: 'biz_789'
      });

      expect(state.callSid).toBe(callSid);
      expect(state.service).toBe('amazon');
      expect(state.status).toBe('initiated');
      expect(state.attempts).toBe(0);
      expect(state.maxRetries).toBe(3);
    });

    test('should throw error if callSid is missing', () => {
      expect(() => engine.initializeCall(null, { service: 'paypal' })).toThrow();
    });

    test('should emit initialization event', (done) => {
      engine.on('call:initialized', (state) => {
        expect(state.callSid).toBe('test_123');
        done();
      });

      engine.initializeCall('test_123', { service: 'paypal' });
    });
  });

  describe('Digit Validation', () => {
    test('should validate correct digit format', () => {
      const isValid = engine.validateDigits('123456', 6);
      expect(isValid).toBe(true);
    });

    test('should reject non-digit characters', () => {
      const isValid = engine.validateDigits('12345a', 6);
      expect(isValid).toBe(false);
    });

    test('should reject wrong length', () => {
      const isValid = engine.validateDigits('12345', 6);
      expect(isValid).toBe(false);
    });

    test('should handle empty input', () => {
      const isValid = engine.validateDigits('', 6);
      expect(isValid).toBe(false);
    });

    test('should handle null input', () => {
      const isValid = engine.validateDigits(null, 6);
      expect(isValid).toBe(false);
    });
  });

  describe('Digit Processing', () => {
    test('should accept valid digits on first attempt', async () => {
      const callSid = 'test_call_123';
      engine.initializeCall(callSid, { service: 'paypal' });

      const result = await engine.processDigits(callSid, '123456');

      expect(result.valid).toBe(true);
      expect(result.status).toBe('success');
      expect(result.action).toBe('hangup');
    });

    test('should reject invalid digits and allow retry', async () => {
      const callSid = 'test_call_456';
      engine.initializeCall(callSid, { service: 'paypal' });

      const result = await engine.processDigits(callSid, '12345'); // Wrong length

      expect(result.valid).toBe(false);
      expect(result.status).toBe('retry');
      expect(result.action).toBe('regather');
      expect(result.remaining).toBe(2); // 3 retries - 1
    });

    test('should fail after max retries exceeded', async () => {
      const callSid = 'test_call_789';
      engine.initializeCall(callSid, { service: 'paypal' });

      // Attempt 1
      await engine.processDigits(callSid, '12345');
      // Attempt 2
      await engine.processDigits(callSid, '12345');
      // Attempt 3 - should fail
      const result = await engine.processDigits(callSid, '12345');

      expect(result.valid).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.action).toBe('hangup');
    });

    test('should emit event on max retries', (done) => {
      const callSid = 'test_call_events';
      engine.initializeCall(callSid, { service: 'paypal' });

      engine.on('call:max_retries_exceeded', (state) => {
        expect(state.callSid).toBe(callSid);
        done();
      });

      engine.processDigits(callSid, '12345');
      engine.processDigits(callSid, '12345');
      engine.processDigits(callSid, '12345');
    });

    test('should emit event on valid input', (done) => {
      const callSid = 'test_call_valid';
      engine.initializeCall(callSid, { service: 'amazon' });

      engine.on('call:valid_input', (state) => {
        expect(state.callSid).toBe(callSid);
        expect(state.status).toBe('completed');
        done();
      });

      engine.processDigits(callSid, '123456');
    });
  });

  describe('Prompt Management', () => {
    test('should get initial prompt for call', () => {
      const callSid = 'test_prompt_123';
      engine.initializeCall(callSid, { service: 'bank' });

      const prompt = engine.getPrompt(callSid, 'initial');
      expect(prompt).toContain('Please enter your 8-digit authorization code');
    });

    test('should get retry prompt', () => {
      const callSid = 'test_prompt_456';
      engine.initializeCall(callSid, { service: 'google' });

      const prompt = engine.getPrompt(callSid, 'retry');
      expect(prompt).toContain('Incorrect code');
    });

    test('should return null for nonexistent call', () => {
      const prompt = engine.getPrompt('nonexistent_call', 'initial');
      expect(prompt).toBeNull();
    });
  });

  describe('Gather Configuration', () => {
    test('should get correct gather config for scenario', () => {
      const callSid = 'test_gather_123';
      engine.initializeCall(callSid, { service: 'bank' });

      const config = engine.getGatherConfig(callSid);
      expect(config.numDigits).toBe(8);
      expect(config.timeout).toBe(10);
      expect(config.finishOnKey).toBe('#');
    });

    test('should handle different scenario timeouts', () => {
      const callSid1 = 'test_gather_google';
      const callSid2 = 'test_gather_bank';

      engine.initializeCall(callSid1, { service: 'google' });
      engine.initializeCall(callSid2, { service: 'bank' });

      const googleConfig = engine.getGatherConfig(callSid1);
      const bankConfig = engine.getGatherConfig(callSid2);

      expect(googleConfig.timeout).toBe(8);
      expect(bankConfig.timeout).toBe(10);
    });
  });

  describe('Call Statistics', () => {
    test('should calculate call duration', async () => {
      const callSid = 'test_stats_123';
      engine.initializeCall(callSid, { service: 'paypal' });

      // Simulate some delay
      await new Promise(resolve => setTimeout(resolve, 100));

      await engine.processDigits(callSid, '123456');

      const stats = engine.getCallStats(callSid);
      expect(stats.duration).toBeGreaterThanOrEqual(100);
      expect(stats.success).toBe(true);
    });

    test('should track attempts in stats', async () => {
      const callSid = 'test_stats_attempts';
      engine.initializeCall(callSid, { service: 'paypal' });

      await engine.processDigits(callSid, '12345'); // Invalid
      await engine.processDigits(callSid, '123456'); // Valid

      const stats = engine.getCallStats(callSid);
      expect(stats.attempts).toBe(2);
      expect(stats.retries).toBe(1);
    });
  });

  describe('Call Cleanup', () => {
    test('should remove call state on cleanup', () => {
      const callSid = 'test_cleanup_123';
      engine.initializeCall(callSid, { service: 'paypal' });

      expect(engine.getActiveCalls().length).toBe(1);

      engine.cleanup(callSid);

      expect(engine.getActiveCalls().length).toBe(0);
    });

    test('should emit cleanup event', (done) => {
      const callSid = 'test_cleanup_event';
      engine.initializeCall(callSid, { service: 'amazon' });

      engine.on('call:cleaned_up', (state) => {
        expect(state.callSid).toBe(callSid);
        done();
      });

      engine.cleanup(callSid);
    });
  });

  describe('Active Calls Tracking', () => {
    test('should list active calls', () => {
      engine.initializeCall('call_1', { service: 'paypal' });
      engine.initializeCall('call_2', { service: 'amazon' });

      const active = engine.getActiveCalls();
      expect(active.length).toBe(2);
    });

    test('should not include completed calls in active list', async () => {
      const callSid1 = 'call_active';
      const callSid2 = 'call_completed';

      engine.initializeCall(callSid1, { service: 'paypal' });
      engine.initializeCall(callSid2, { service: 'amazon' });

      await engine.processDigits(callSid2, '123456'); // Complete call 2

      const active = engine.getActiveCalls();
      expect(active.length).toBe(1);
      expect(active[0].callSid).toBe(callSid1);
    });
  });
});
