import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useWebSocket } from './WebSocketContext';
import type {
  WebSocketEvent,
  CallUpdatePayload,
  CallTimelineEntry,
  ConnectionAckPayload,
} from '../types/websocket';

export interface MonitoredCall {
  call_sid: string;
  to: string;
  status: string;
  started_at?: string;
  ended_at?: string;
  latest_update?: string;
  prompt_preview?: string;
  first_message?: string;
  duration?: number;
  error?: string;
  timeline: CallTimelineEntry[];
}

interface CallMonitorContextValue {
  activeCalls: MonitoredCall[];
  recentEvents: WebSocketEvent[];
  clearEvents: () => void;
  isLoading: boolean;
  error: string | null;
}

const CallMonitorContext = createContext<CallMonitorContextValue | undefined>(undefined);

interface CallMonitorProviderProps {
  children: ReactNode;
}

const MAX_EVENTS = 100;

const mapToArray = (collection: Record<string, MonitoredCall>): MonitoredCall[] =>
  Object.values(collection).sort((a, b) => {
    const left = new Date(b.latest_update ?? b.started_at ?? '').getTime();
    const right = new Date(a.latest_update ?? a.started_at ?? '').getTime();
    return left - right;
  });

export const CallMonitorProvider = ({ children }: CallMonitorProviderProps): JSX.Element => {
  const { status, lastMessage } = useWebSocket();
  const [activeCalls, setActiveCalls] = useState<Record<string, MonitoredCall>>({});
  const [recentEvents, setRecentEvents] = useState<WebSocketEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const updateCall = useCallback((call: Partial<CallUpdatePayload> & { call_sid: string }) => {
    setActiveCalls((prev) => {
      const existing = prev[call.call_sid] ?? {};
      const merged: MonitoredCall = {
        call_sid: call.call_sid,
        to: call.to ?? existing.to ?? '',
        status: call.status ?? existing.status ?? 'initiated',
        started_at: call.started_at ?? existing.started_at,
        ended_at: call.ended_at ?? existing.ended_at,
        latest_update: call.latest_update ?? new Date().toISOString(),
        prompt_preview: call.prompt_preview ?? existing.prompt_preview,
        first_message: call.first_message ?? existing.first_message,
        duration: call.duration ?? existing.duration,
        error: call.error ?? existing.error,
        timeline: call.timeline ?? existing.timeline ?? [],
      };

      const next = { ...prev, [call.call_sid]: merged };

      if (['completed', 'failed'].includes(merged.status) && merged.ended_at) {
        // Keep completed calls visible briefly before removing
        setTimeout(() => {
          setActiveCalls((current) => {
            const currentCall = current[call.call_sid];
            if (!currentCall || !['completed', 'failed'].includes(currentCall.status)) {
              return current;
            }
            const updated = { ...current };
            delete updated[call.call_sid];
            return updated;
          });
        }, 15000);
      }

      return next;
    });
  }, []);

  const clearEvents = useCallback(() => {
    setRecentEvents([]);
  }, []);

  useEffect(() => {
    if (!lastMessage || typeof lastMessage !== 'object' || !('type' in lastMessage)) {
      return;
    }

    try {
      const event = lastMessage as WebSocketEvent;

      // Add to recent events
      setRecentEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));

      // Handle specific event types
      switch (event.type) {
        case 'connection_ack': {
          const ackData = event.data as ConnectionAckPayload;
          if (Array.isArray(ackData.activeCalls)) {
            const mapped: Record<string, MonitoredCall> = {};
            for (const call of ackData.activeCalls) {
              if (call.call_sid) {
                mapped[call.call_sid] = {
                  ...call,
                  timeline: call.timeline ?? [],
                  latest_update: call.latest_update ?? new Date().toISOString(),
                };
              }
            }
            setActiveCalls(mapped);
          }
          break;
        }

        case 'call_update':
        case 'call_completed':
        case 'call_failed': {
          const callData = event.data as CallUpdatePayload;
          if (callData.call_sid) {
            updateCall({
              ...callData,
              status:
                callData.status ?? (event.type === 'call_failed' ? 'failed' : callData.status),
            });
          }
          break;
        }

        default:
          // Other events don't affect call state
          break;
      }
    } catch (err) {
      console.error('Error processing WebSocket message:', err);
      setError('Failed to process update');
    }
  }, [lastMessage, updateCall]);

  const value = useMemo<CallMonitorContextValue>(
    () => ({
      activeCalls: mapToArray(activeCalls),
      recentEvents,
      clearEvents,
      isLoading: status === 'connecting',
      error,
    }),
    [activeCalls, recentEvents, clearEvents, status, error]
  );

  return <CallMonitorContext.Provider value={value}>{children}</CallMonitorContext.Provider>;
};

export const useCallMonitor = (): CallMonitorContextValue => {
  const context = useContext(CallMonitorContext);
  if (!context) {
    throw new Error('useCallMonitor must be used within a CallMonitorProvider');
  }
  return context;
};
