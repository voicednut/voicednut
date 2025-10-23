import { create } from 'zustand';
import { callService } from '../features/calls/callService';
import { type Call, type CallInitiateResponse } from '../types/call';

interface CallState {
  calls: Call[];
  callHistory: Call[];
  loading: boolean;
  error: string | null;
  fetchActiveCalls: () => Promise<void>;
  fetchCallHistory: () => Promise<void>;
  initiateCall: (form: {
    phoneNumber: string;
    prompt: string;
    firstMessage: string;
  }) => Promise<CallInitiateResponse>;
  terminateCall: (callSid: string) => Promise<void>;
  updateCall: (call: Partial<Call> & { call_sid: string }) => void;
  removeCall: (callId: string) => void;
  addCall: (call: Call) => void;
  setError: (error: string | null) => void;
}

export const useCallStore = create<CallState>((set) => ({
  calls: [],
  callHistory: [],
  loading: false,
  error: null,
  fetchActiveCalls: async () => {
    set({ loading: true, error: null });
    try {
      const calls = await callService.listActive();
      set({ calls, loading: false });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch active calls';
      set({ error: errorMessage, loading: false });
    }
  },
  fetchCallHistory: async () => {
    set({ loading: true, error: null });
    try {
      const history = await callService.listRecent();
      set({ callHistory: history, loading: false });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch call history';
      set({ error: errorMessage, loading: false });
    }
  },
  initiateCall: async (form) => {
    set({ loading: true, error: null });
    try {
      const response = await callService.initiateCall(form);
      set({ loading: false });
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initiate call';
      set({ error: errorMessage, loading: false });
      throw err;
    }
  },
  terminateCall: () => {
    set({ error: 'Call termination is not yet supported from the mini app UI.' });
    return Promise.resolve();
  },
  updateCall: (updatedCall) =>
    set((state) => ({
      calls: state.calls.map((call) =>
        call.call_sid === updatedCall.call_sid ? { ...call, ...updatedCall } : call
      ),
    })),
  removeCall: (callId) =>
    set((state) => ({
      calls: state.calls.filter((call) => call.call_sid !== callId),
    })),
  addCall: (call) =>
    set((state) => ({
      calls: [...state.calls, call],
    })),
  setError: (error) => set({ error }),
}));

export default useCallStore;
