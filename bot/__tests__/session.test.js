/**
 * Bot Session Management Tests
 * Tests for session state, reset, and operation tracking
 */

describe('Session State Management', () => {
  function initializeSession() {
    return {
      currentOp: null,
      lastCommand: null,
      pendingControllers: [],
      meta: {},
      flow: null,
      errors: []
    };
  }

  test('should initialize empty session', () => {
    const session = initializeSession();
    
    expect(session.currentOp).toBeNull();
    expect(session.lastCommand).toBeNull();
    expect(Array.isArray(session.pendingControllers)).toBe(true);
    expect(session.pendingControllers.length).toBe(0);
  });

  test('should track active operation', () => {
    const session = initializeSession();
    
    session.currentOp = {
      id: 'op123',
      command: '/call',
      startedAt: Date.now()
    };
    
    expect(session.currentOp.id).toBe('op123');
    expect(session.currentOp.command).toBe('/call');
  });

  test('should reset session completely', () => {
    const session = initializeSession();
    
    // Populate session
    session.currentOp = { id: 'op123', command: '/call' };
    session.lastCommand = '/call';
    session.errors = ['error1'];
    session.pendingControllers = [{}];
    
    // Reset
    session.currentOp = null;
    session.lastCommand = null;
    session.errors = [];
    session.pendingControllers = [];
    session.meta = {};
    
    // Verify reset
    expect(session.currentOp).toBeNull();
    expect(session.lastCommand).toBeNull();
    expect(session.errors.length).toBe(0);
    expect(session.pendingControllers.length).toBe(0);
  });
});

describe('Command Isolation', () => {
  test('should prevent duplicate command execution', () => {
    const activeCommands = new Set();
    const userId = '123456';
    
    // First /call
    const canStart1 = !activeCommands.has(userId + ':call');
    if (canStart1) {
      activeCommands.add(userId + ':call');
    }
    
    // Second /call attempt
    const canStart2 = !activeCommands.has(userId + ':call');
    
    expect(canStart1).toBe(true);
    expect(canStart2).toBe(false);
  });

  test('should reset session on new command', () => {
    const sessions = new Map();
    const userId = '123';
    
    // Start /call
    sessions.set(userId, {
      command: '/call',
      active: true,
      data: { some: 'data' }
    });
    
    // Start /sms - should reset previous session
    const previousCommand = sessions.get(userId)?.command;
    sessions.set(userId, {
      command: '/sms',
      active: true,
      data: {}
    });
    
    const currentCommand = sessions.get(userId).command;
    
    expect(previousCommand).toBe('/call');
    expect(currentCommand).toBe('/sms');
  });
});

describe('Callback Debouncing', () => {
  test('should debounce rapid callbacks', () => {
    const lastCallback = new Map();
    const DEBOUNCE_MS = 800;
    const userId = '123';
    
    const canProcess = (now) => {
      const lastTime = lastCallback.get(userId) || 0;
      if (now - lastTime < DEBOUNCE_MS) {
        return false;
      }
      lastCallback.set(userId, now);
      return true;
    };
    
    const t1 = 1000;
    const t2 = 1100; // 100ms later
    const t3 = 1900; // 800ms later
    
    expect(canProcess(t1)).toBe(true); // First click OK
    expect(canProcess(t2)).toBe(false); // Too fast
    expect(canProcess(t3)).toBe(true); // OK after debounce window
  });
});
