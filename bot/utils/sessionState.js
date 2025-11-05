const { randomUUID } = require('crypto');

class OperationCancelledError extends Error {
  constructor(reason = 'Operation cancelled') {
    super(reason);
    this.name = 'OperationCancelledError';
  }
}

const initialSessionState = () => ({
  currentOp: null,
  lastCommand: null,
  pendingControllers: [],
  meta: {}
});

function ensureSession(ctx) {
  if (!ctx.session || typeof ctx.session !== 'object') {
    ctx.session = initialSessionState();
  } else {
    ctx.session.currentOp = ctx.session.currentOp || null;
    ctx.session.pendingControllers = ctx.session.pendingControllers || [];
    ctx.session.meta = ctx.session.meta || {};
  }
}

function generateOpId() {
  if (typeof randomUUID === 'function') {
    return randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function startOperation(ctx, command, metadata = {}) {
  ensureSession(ctx);
  const opId = generateOpId();
  ctx.session.currentOp = {
    id: opId,
    command,
    metadata,
    startedAt: Date.now()
  };
  ctx.session.lastCommand = command;
  return opId;
}

function getCurrentOpId(ctx) {
  return ctx.session?.currentOp?.id || null;
}

function isOperationActive(ctx, opId) {
  return Boolean(opId && ctx.session?.currentOp?.id === opId);
}

function registerAbortController(ctx, controller) {
  ensureSession(ctx);
  ctx.session.pendingControllers.push(controller);
  const release = () => {
    ctx.session.pendingControllers = ctx.session.pendingControllers.filter((item) => item !== controller);
  };
  return release;
}

async function cancelActiveFlow(ctx, reason = 'reset') {
  ensureSession(ctx);
  if (ctx.session.pendingControllers.length > 0) {
    ctx.session.pendingControllers.forEach((controller) => {
      try {
        controller.abort(reason);
      } catch (error) {
        console.warn('Abort controller error:', error.message);
      }
    });
    ctx.session.pendingControllers = [];
  }

  if (ctx.conversation && typeof ctx.conversation.exit === 'function') {
    try {
      await ctx.conversation.exit();
    } catch (error) {
      if (!/no conversation/i.test(error.message)) {
        console.warn('Conversation exit warning:', error.message);
      }
    }
  }

  ctx.session.currentOp = null;
  ctx.session.meta = {};
}

function resetSession(ctx) {
  ensureSession(ctx);
  ctx.session.currentOp = null;
  ctx.session.lastCommand = null;
  ctx.session.meta = {};
  ctx.session.pendingControllers = [];
}

function ensureOperationActive(ctx, opId) {
  if (!isOperationActive(ctx, opId)) {
    throw new OperationCancelledError();
  }
}

module.exports = {
  initialSessionState,
  startOperation,
  cancelActiveFlow,
  getCurrentOpId,
  isOperationActive,
  registerAbortController,
  resetSession,
  ensureSession,
  ensureOperationActive,
  OperationCancelledError
};
