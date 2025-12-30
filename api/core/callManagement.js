/**
 * Call Handler Management & Utilities
 * Centralized call lifecycle management
 */

const Map = require('collections/map');

// In-memory registries
const callHandlers = new Map();
const callConfigurations = new Map();
const activeCalls = new Map();
const callFunctionSystems = new Map();
const inputOrchestrators = new Map();
const callHangupTimers = new Map();
const awsCallSessions = new Map();
const awsContactIndex = new Map();
const vonageCallIndex = new Map();
const callDtmfBuffers = new Map();
const callDtmfStageBuffers = new Map();
const callDtmfAttempts = new Map();
const callPhases = new Map();

const DTMF_FLUSH_DELAY_MS = 1500;
const DTMF_MAX_ATTEMPTS_DEFAULT = 3;

const ORCHESTRATOR_STATES = {
  INITIATED: 'INITIATED',
  RINGING: 'RINGING',
  ANSWERED: 'ANSWERED',
  IN_PROGRESS: 'IN_PROGRESS',
  COLLECTING_INPUT: 'COLLECTING_INPUT',
  VALIDATING: 'VALIDATING',
  SUCCESS: 'SUCCESS',
  FAIL: 'FAIL',
  COMPLETED: 'COMPLETED'
};

/**
 * Create and register a call handler
 */
function createCallHandler(callType, metadata, options = {}) {
  try {
    const { CallHandlerFactory } = require('../handlers');
    const handler = CallHandlerFactory.create(callType, metadata, options);
    const callSid = handler.callSid || metadata.callSid;
    
    if (callSid) {
      callHandlers.set(callSid, handler);
    }
    return handler;
  } catch (error) {
    console.error(`❌ Failed to create ${callType} handler:`, error.message);
    return null;
  }
}

/**
 * Get a registered handler
 */
function getCallHandler(callSid) {
  return callHandlers.get(callSid) || null;
}

/**
 * Cleanup a single handler
 */
async function removeCallHandler(callSid, reason = 'normal') {
  try {
    const handler = callHandlers.get(callSid);
    if (handler && typeof handler.cleanup === 'function') {
      await handler.cleanup();
    }
    callHandlers.delete(callSid);
  } catch (error) {
    console.warn(`⚠️ Error removing handler ${callSid}:`, error.message);
  }
}

/**
 * Cleanup all handlers on shutdown
 */
async function cleanupAllHandlers() {
  console.log(`🧹 Cleaning up ${callHandlers.size} active handlers...`);
  
  for (const [callSid, handler] of callHandlers.entries()) {
    try {
      if (typeof handler.cleanup === 'function') {
        await handler.cleanup();
      }
    } catch (error) {
      console.warn(`⚠️ Error cleaning up ${callSid}:`, error.message);
    }
  }
  
  callHandlers.clear();
  console.log('✅ All handlers cleaned up');
}

/**
 * Get all active call handlers
 */
function getAllCallHandlers() {
  return Array.from(callHandlers.values());
}

/**
 * Get handler statistics
 */
function getHandlerStats() {
  const handlers = Array.from(callHandlers.values());
  
  return {
    activeCount: handlers.length,
    byType: handlers.reduce((acc, h) => {
      const type = h.callType || 'unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {}),
    withErrors: handlers.filter(h => h.errorMetrics?.errorCount > 0).length,
    totalErrors: handlers.reduce((sum, h) => sum + (h.errorMetrics?.errorCount || 0), 0)
  };
}

/**
 * Remove call configuration
 */
function removeCallConfiguration(callSid) {
  if (!callSid) return;
  callConfigurations.delete(callSid);
  inputOrchestrators.delete(callSid);
}

/**
 * Get stage buffer for DTMF
 */
function getStageBuffer(callSid, stageKey) {
  const dtmfUtils = require('../utils/dtmf');
  const normalized = dtmfUtils.normalizeStage(stageKey || 'GENERIC');
  const map = callDtmfStageBuffers.get(callSid) || new Map();
  const buffer = map.get(normalized) || { digits: '', updatedAt: Date.now() };
  map.set(normalized, buffer);
  callDtmfStageBuffers.set(callSid, map);
  return buffer;
}

/**
 * Clear stage buffer
 */
function clearStageBuffer(callSid, stageKey) {
  const dtmfUtils = require('../utils/dtmf');
  const normalized = dtmfUtils.normalizeStage(stageKey || 'GENERIC');
  const map = callDtmfStageBuffers.get(callSid);
  if (!map) return;
  map.delete(normalized);
  if (!map.size) {
    callDtmfStageBuffers.delete(callSid);
  }
}

/**
 * Track stage attempt
 */
function trackStageAttempt(callSid, stageKey) {
  const dtmfUtils = require('../utils/dtmf');
  const normalized = dtmfUtils.normalizeStage(stageKey || 'GENERIC');
  const map = callDtmfAttempts.get(callSid) || new Map();
  const attempts = (map.get(normalized) || 0) + 1;
  map.set(normalized, attempts);
  callDtmfAttempts.set(callSid, map);
  return attempts;
}

/**
 * Reset stage attempts
 */
function resetStageAttempts(callSid, stageKey) {
  const dtmfUtils = require('../utils/dtmf');
  const map = callDtmfAttempts.get(callSid);
  if (!map) return;
  map.delete(dtmfUtils.normalizeStage(stageKey || 'GENERIC'));
  if (!map.size) {
    callDtmfAttempts.delete(callSid);
  }
}

/**
 * Schedule call hangup
 */
async function scheduleCallHangup(callSid, delayMs = 4500, options = {}) {
  const { currentProvider, twilioAccountSid, twilioAuthToken } = options;
  
  if (!callSid || currentProvider !== 'twilio') return;
  if (callHangupTimers.has(callSid)) return;
  if (!twilioAccountSid || !twilioAuthToken) return;
  
  const timer = setTimeout(async () => {
    try {
      const twilio = require('twilio');
      const client = twilio(twilioAccountSid, twilioAuthToken);
      await client.calls(callSid).update({ status: 'completed' });
      console.log(`📞 Call ${callSid} hangup scheduled after ${delayMs}ms`);
    } catch (error) {
      console.warn(`⚠️ Failed to hangup call ${callSid}:`, error.message);
    }
  }, delayMs);
  
  callHangupTimers.set(callSid, timer);
}

module.exports = {
  // Maps
  callHandlers,
  callConfigurations,
  activeCalls,
  callFunctionSystems,
  inputOrchestrators,
  callHangupTimers,
  awsCallSessions,
  awsContactIndex,
  vonageCallIndex,
  callDtmfBuffers,
  callDtmfStageBuffers,
  callDtmfAttempts,
  callPhases,
  
  // Constants
  DTMF_FLUSH_DELAY_MS,
  DTMF_MAX_ATTEMPTS_DEFAULT,
  ORCHESTRATOR_STATES,
  
  // Functions
  createCallHandler,
  getCallHandler,
  removeCallHandler,
  cleanupAllHandlers,
  getAllCallHandlers,
  getHandlerStats,
  removeCallConfiguration,
  getStageBuffer,
  clearStageBuffer,
  trackStageAttempt,
  resetStageAttempts,
  scheduleCallHangup
};
