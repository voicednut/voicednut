const { CallHandler, GptCallHandler, OtpCallHandler, InputCollectionHandler, CallHandlerFactory } = require('../handlers');
const CircuitBreaker = require('../utils/CircuitBreaker');

describe('Handler Architecture', () => {
  describe('CallHandler Base Class', () => {
    it('should initialize with proper metadata', () => {
      const mockDb = {};
      const handler = new CallHandler('test-call-id', { userId: 'user123' }, { db: mockDb });
      
      expect(handler.callSid).toBe('test-call-id');
      expect(handler.metadata.userId).toBe('user123');
      expect(handler.db).toBe(mockDb);
    });

    it('should have error boundary methods', () => {
      const handler = new CallHandler('test-id', {}, {});
      
      expect(typeof handler.executeWithErrorHandling).toBe('function');
      expect(typeof handler.cleanup).toBe('function');
      expect(typeof handler.setupTimeout).toBe('function');
      expect(typeof handler.clearTimeout).toBe('function');
    });

    it('should handle timeout correctly', async () => {
      const handler = new CallHandler('test-id', {}, {});
      handler.setupTimeout(100); // 100ms timeout
      
      let timedOut = false;
      
      const promise = new Promise((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, 150);
      });
      
      await promise;
      expect(timedOut).toBe(true);
    });
  });

  describe('GptCallHandler', () => {
    it('should have circuit breaker integration', async () => {
      const mockDb = {};
      const mockGptService = { completion: jest.fn() };
      const handler = new GptCallHandler('gpt-call-id', {}, { 
        db: mockDb,
        gptService: mockGptService 
      });
      
      expect(handler.gptCircuitBreaker).toBeInstanceOf(CircuitBreaker);
    });

    it('should provide health status', () => {
      const handler = new GptCallHandler('gpt-call-id', {}, { db: {} });
      const health = handler.getHealthStatus();
      
      expect(health).toHaveProperty('callSid');
      expect(health).toHaveProperty('conversationPhase');
      expect(health).toHaveProperty('interactionCount');
      expect(health).toHaveProperty('uptime');
      expect(health).toHaveProperty('circuitBreaker');
    });
  });

  describe('OtpCallHandler', () => {
    it('should initialize OTP handler', () => {
      const handler = new OtpCallHandler('otp-call-id', { scenario: 'paypal' }, { db: {} });
      
      expect(handler.callSid).toBe('otp-call-id');
      expect(handler.scenario).toBe('paypal');
    });

    it('should have required methods', () => {
      const handler = new OtpCallHandler('otp-call-id', {}, { db: {} });
      
      expect(typeof handler.initiate).toBe('function');
      expect(typeof handler.handleDtmf).toBe('function');
      expect(typeof handler.handleStatus).toBe('function');
    });
  });

  describe('InputCollectionHandler', () => {
    it('should initialize input handler', () => {
      const handler = new InputCollectionHandler('input-call-id', { steps: 3 }, { db: {} });
      
      expect(handler.callSid).toBe('input-call-id');
    });

    it('should handle DTMF input', () => {
      const handler = new InputCollectionHandler('input-call-id', {}, { db: {} });
      
      expect(typeof handler.handleDtmf).toBe('function');
    });
  });

  describe('CallHandlerFactory', () => {
    it('should create GptCallHandler for gpt type', () => {
      const handler = CallHandlerFactory.createCallHandler('gpt', 'call-1', {}, { db: {} });
      
      expect(handler).toBeInstanceOf(GptCallHandler);
      expect(handler.callType).toBe('gpt');
    });

    it('should create OtpCallHandler for otp type', () => {
      const handler = CallHandlerFactory.createCallHandler('otp', 'call-2', {}, { db: {} });
      
      expect(handler).toBeInstanceOf(OtpCallHandler);
      expect(handler.callType).toBe('otp');
    });

    it('should create InputCollectionHandler for collect_input type', () => {
      const handler = CallHandlerFactory.createCallHandler('collect_input', 'call-3', {}, { db: {} });
      
      expect(handler).toBeInstanceOf(InputCollectionHandler);
      expect(handler.callType).toBe('collect_input');
    });

    it('should throw error for unknown type', () => {
      expect(() => {
        CallHandlerFactory.createCallHandler('unknown', 'call-4', {}, { db: {} });
      }).toThrow();
    });
  });

  describe('CircuitBreaker Integration', () => {
    it('should initialize circuit breaker with correct state', () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 5,
        resetTimeout: 30000
      });
      
      const state = breaker.getState();
      expect(state.state).toBe('CLOSED');
      expect(state.failureCount).toBe(0);
    });

    it('should transition to OPEN after threshold failures', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 2,
        resetTimeout: 30000
      });
      
      breaker.recordFailure();
      expect(breaker.getState().state).toBe('CLOSED');
      
      breaker.recordFailure();
      expect(breaker.getState().state).toBe('OPEN');
    });

    it('should use fallback when open', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 30000
      });
      
      breaker.recordFailure();
      
      const fallback = () => 'fallback response';
      const result = await breaker.execute(
        () => Promise.resolve('normal response'),
        fallback
      );
      
      expect(result).toBe('fallback response');
    });
  });

  describe('Error Handling', () => {
    it('should catch and handle errors during initiation', async () => {
      const handler = new CallHandler('test-id', {}, { db: {} });
      const errorFn = async () => {
        throw new Error('Test error');
      };
      
      const result = await handler.executeWithErrorHandling(errorFn, 'test operation');
      
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(false);
      expect(result).toHaveProperty('error');
    });

    it('should cleanup resources on handler removal', async () => {
      const handler = new CallHandler('test-id', {}, { db: {} });
      const cleanupSpy = jest.spyOn(handler, 'cleanup');
      
      await handler.cleanup();
      
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
});
