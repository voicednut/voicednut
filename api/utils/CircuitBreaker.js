/**
 * CircuitBreaker - Pattern implementation for external API calls
 * Prevents cascading failures by tracking and stopping unhealthy requests
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'Circuit';
    this.failureThreshold = options.failureThreshold || 5; // Max failures before opening
    this.resetTimeout = options.resetTimeout || 30000; // 30 seconds before attempting reset
    this.fallbackFn = options.fallbackFn || null; // Called when circuit is open
    
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
  }

  /**
   * Execute function with circuit breaker protection
   * @param {Function} fn - Async function to execute
   * @param {Function} fallback - Optional fallback if circuit is open
   */
  async execute(fn, fallback = null) {
    // Check if circuit should reset
    if (this.state === 'OPEN') {
      const timeSinceFailure = Date.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.resetTimeout) {
        console.log(`🔄 ${this.name} CircuitBreaker attempting reset...`);
        this.state = 'HALF_OPEN';
      } else {
        // Circuit is open, use fallback
        const fb = fallback || this.fallbackFn;
        if (fb) {
          console.warn(`⚠️ ${this.name} CircuitBreaker OPEN, using fallback`);
          return fb();
        }
        throw new Error(`${this.name} CircuitBreaker is OPEN`);
      }
    }

    try {
      const result = await fn();
      
      // Success - reset failures
      if (this.state === 'HALF_OPEN') {
        console.log(`✅ ${this.name} CircuitBreaker recovered`);
        this.state = 'CLOSED';
      }
      this.failureCount = 0;
      this.lastFailureTime = null;
      
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a failure
   */
  recordFailure() {
    this.failureCount += 1;
    this.lastFailureTime = Date.now();
    
    console.warn(`⚠️ ${this.name} failure ${this.failureCount}/${this.failureThreshold}`);
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.error(`❌ ${this.name} CircuitBreaker OPENED after ${this.failureCount} failures`);
    }
  }

  /**
   * Manually reset circuit
   */
  reset() {
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.state = 'CLOSED';
    console.log(`🔧 ${this.name} CircuitBreaker manually reset`);
  }

  /**
   * Get circuit state for monitoring
   */
  getState() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      failureThreshold: this.failureThreshold,
      resetTimeout: this.resetTimeout
    };
  }
}

module.exports = CircuitBreaker;
