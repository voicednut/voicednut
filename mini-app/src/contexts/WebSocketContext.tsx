import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { config } from '../services/config';
import type { WebSocketEvent, WebSocketEventType } from '../types/websocket';

export type WebSocketStatus = 'connecting' | 'open' | 'closed' | 'error';

interface WebSocketContextValue {
  status: WebSocketStatus;
  send: (data: unknown) => void;
  lastMessage: unknown;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined);

interface WebSocketProviderProps {
  children: ReactNode;
}

const isWebSocketEventType = (type: string): type is WebSocketEventType => {
  const validTypes = [
    'connection_ack',
    'call_update',
    'call_completed',
    'call_failed',
    'system_config_updated',
    'user_updated',
  ] as const;
  return validTypes.includes(type as WebSocketEventType);
};

const resolveWebSocketUrl = (): string | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  if (config.api.wsUrl) {
    return config.api.wsUrl;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
};

export const WebSocketProvider = ({ children }: WebSocketProviderProps): JSX.Element => {
  const [status, setStatus] = useState<WebSocketStatus>('connecting');
  const [lastMessage, setLastMessage] = useState<unknown>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsUrl = useMemo(() => resolveWebSocketUrl(), []);

  const connect = useCallback(() => {
    if (!wsUrl) {
      setStatus('closed');
      return;
    }

    try {
      setStatus('connecting');
      const socket = new WebSocket(wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('open');
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as unknown;
          const isValidEvent = (value: unknown): value is WebSocketEvent => {
            if (!value || typeof value !== 'object') return false;
            const candidate = value as Partial<WebSocketEvent>;
            return (
              typeof candidate.type === 'string' &&
              isWebSocketEventType(candidate.type) &&
              'data' in candidate &&
              'timestamp' in candidate
            );
          };

          if (isValidEvent(parsed)) {
            setLastMessage(parsed);
          } else {
            console.warn('Received invalid WebSocket message format:', parsed);
          }
        } catch (error) {
          console.warn('Failed to parse WebSocket message:', error);
        }
      };

      socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        setStatus('error');
      };

      socket.onclose = () => {
        setStatus('closed');
        socketRef.current = null;

        // Attempt to reconnect after a delay
        if (!reconnectTimerRef.current) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, 5000);
        }
      };
    } catch (error) {
      console.error('Failed to establish WebSocket connection:', error);
      setStatus('error');
    }
  }, [wsUrl]);

  const send = useCallback((data: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(data));
    } else {
      console.warn('Attempted to send message while WebSocket is not open');
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }

      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };
  }, [connect]);

  const value = useMemo<WebSocketContextValue>(
    () => ({
      status,
      send,
      lastMessage,
    }),
    [status, send, lastMessage]
  );

  return <WebSocketContext.Provider value={value}>{children}</WebSocketContext.Provider>;
};

export const useWebSocket = (): WebSocketContextValue => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};
