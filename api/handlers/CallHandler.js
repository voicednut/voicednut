const EventEmitter = require('events');

/**
 * Base CallHandler - Abstract class for all call types
 * Ensures consistent error handling, state management, and cleanup
 */
class CallHandler extends EventEmitter {
  constructor(metadata_json, options = {}) {
    super();
    this.metadata = this.parseMetadata(metadata_json);
    this.callSid = null;
    this.streamSid = null;
    this.startTime = Date.now();
    this.db = options.db || null;
    this.provider = options.provider || 'twilio';
    this.maxDuration = options.maxDuration || 3600000; // 1 hour
    this.timeout = null;
    this.cleanedUp = false;
    
    // Error tracking
    this.errorMetrics = {
      errorCount: 0,
      lastError: null,
      lastErrorTime: null,
      errorLog: []
    };
  }

  /**
   * Safely parse metadata JSON
   */
  parseMetadata(metadata_json) {
    if (!metadata_json) return {};
    if (typeof metadata_json === 'object') return metadata_json;
    try {
      return JSON.parse(metadata_json);
    } catch (error) {
      console.warn('⚠️ Failed to parse metadata:', error.message);
      return {};
    }
  }

  /**
   * Initialize the call - must be implemented by subclass
   */
  async initiate(to, from) {
    throw new Error('CallHandler.initiate() must be implemented by subclass');
  }

  /**
   * Handle DTMF input - must be implemented by subclass
   */
  async handleDtmf(digits, stageKey) {
    throw new Error('CallHandler.handleDtmf() must be implemented by subclass');
  }

  /**
   * Handle status updates - must be implemented by subclass
   */
  async handleStatus(status) {
    throw new Error('CallHandler.handleStatus() must be implemented by subclass');
  }

  /**
   * Handle media stream - optional
   */
  async handleMedia(mediaPayload) {
    // Override in subclass if needed
  }

  /**
   * Get call state for logging/debugging
   */
  getState() {
    return {
      callSid: this.callSid,
      provider: this.provider,
      uptime: Date.now() - this.startTime,
      metadata: this.metadata,
      errors: this.errorMetrics
    };
  }

  /**
   * Setup call timeout protection
   */
  setupTimeout() {
    if (this.timeout) clearTimeout(this.timeout);
    
    this.timeout = setTimeout(async () => {
      console.warn(`⚠️ Call ${this.callSid} exceeded max duration, terminating...`);
      await this.cleanup('timeout');
      this.emit('timeout', { callSid: this.callSid });
    }, this.maxDuration);
  }

  /**
   * Clear timeout
   */
  clearTimeout() {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  /**
   * Cleanup all resources - called before handler is destroyed
   */
  async cleanup(reason = 'normal') {
    if (this.cleanedUp) return;
    
    try {
      this.clearTimeout();
      this.removeAllListeners();
      
      if (this.db && this.callSid) {
        try {
          await this.db.logServiceHealth('call_cleanup', 'info', {
            call_sid: this.callSid,
            reason,
            duration: Date.now() - this.startTime
          });
        } catch (e) {
          console.warn('Failed to log call cleanup:', e.message);
        }
      }

      this.cleanedUp = true;
      console.log(`✅ Cleaned up handler for ${this.callSid} (${reason})`);
    } catch (error) {
      console.error('❌ Error during cleanup:', error.message);
    }
  }

  /**
   * Wrap async operations with error handling
   */
  async executeWithErrorHandling(fn, context = '') {
    try {
      return await fn();
    } catch (error) {
      const msg = `Error in ${this.constructor.name}.${context}: ${error.message}`;
      console.error('❌', msg);
      
      // Track error metrics
      this.errorMetrics.errorCount++;
      this.errorMetrics.lastError = error.message;
      this.errorMetrics.lastErrorTime = new Date().toISOString();
      this.errorMetrics.errorLog.push({
        timestamp: this.errorMetrics.lastErrorTime,
        context,
        error: error.message,
        stack: error.stack
      });
      
      // Keep only last 10 errors to prevent memory leak
      if (this.errorMetrics.errorLog.length > 10) {
        this.errorMetrics.errorLog.shift();
      }
      
      if (this.db && this.callSid) {
        try {
          await this.db.logServiceHealth('handler_error', 'error', {
            call_sid: this.callSid,
            handler: this.constructor.name,
            context,
            error: error.message,
            stack: error.stack,
            error_count: this.errorMetrics.errorCount
          });
        } catch (logError) {
          console.warn('Failed to log handler error:', logError.message);
        }
      }
      
      throw error;
    }
  }

  /**
   * Emit event safely
   */
  emitSafe(eventName, data) {
    try {
      this.emit(eventName, data);
    } catch (error) {
      console.error(`❌ Error emitting event ${eventName}:`, error.message);
    }
  }
}

module.exports = CallHandler;
