import { io, Socket } from 'socket.io-client';
import { create } from 'zustand';
import { config } from '@/services/config';
import { type Call } from '../types/call';

interface WebSocketEvents {
  callUpdate: (data: Partial<Call> & { call_sid: string }) => void;
  callEnded: (callId: string) => void;
  newCall: (call: Call) => void;
}

interface WebSocketState {
  socket: Socket<WebSocketEvents> | null;
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
}

export const useWebSocket = create<WebSocketState>((set) => ({
  socket: null,
  connected: false,
  connect: () => {
    const newSocket = io(config.api.wsUrl, {
      transports: ['websocket'],
      autoConnect: true,
    });

    newSocket.on('connect', () => {
      set({ connected: true });
    });

    newSocket.on('disconnect', () => {
      set({ connected: false });
    });

    set({ socket: newSocket });
  },
  disconnect: () => {
    set((state) => {
      if (state.socket) {
        state.socket.disconnect();
      }
      return { socket: null, connected: false };
    });
  },
}));

export default useWebSocket;
