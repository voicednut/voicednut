import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useCallStore } from '../stores/callStore';
import { type Call } from '../types/call';

interface CallUpdate extends Partial<Call> {
  call_sid: string;
}

export const useWebSocketConnection = (isMonitoringActive: boolean): Socket | null => {
  const socketRef = useRef<Socket | null>(null);
  const { updateCall, removeCall, addCall } = useCallStore();

  useEffect(() => {
    if (!isMonitoringActive) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    // Only create new connection if we don't have one
    if (!socketRef.current) {
      const apiUrl =
        typeof import.meta.env.VITE_API_URL === 'string'
          ? import.meta.env.VITE_API_URL
          : 'http://localhost:3000';
      socketRef.current = io(apiUrl, {
        transports: ['websocket'],
        autoConnect: true,
      });

      socketRef.current.on('callUpdate', (data: CallUpdate) => {
        updateCall(data);
      });

      socketRef.current.on('callEnded', (callId: string) => {
        removeCall(callId);
      });

      socketRef.current.on('newCall', (call: Call) => {
        addCall(call);
      });
    }

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [isMonitoringActive, updateCall, removeCall, addCall]);

  return socketRef.current;
};
