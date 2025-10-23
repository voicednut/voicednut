import { Navigate, Route, Routes, HashRouter } from 'react-router-dom';
import { useLaunchParams, useSignal, miniApp } from '@tma.js/sdk-react';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { useEffect } from 'react';
import { WebSocketProvider } from '../contexts/WebSocketContext';
import { CallMonitorProvider } from '../contexts/CallMonitorContext';
import { useWebSocket } from '../services/websocket';
import { useTelegramFeatures, initializeTelegram } from '../contexts/telegram.context';

import { IndexPage } from '@/pages/IndexPage/IndexPage';
import { CallsPage } from '@/pages/calls/CallsPage';
import { TranscriptsPage } from '@/pages/TranscriptsPage/TranscriptsPage';

// Initialize telegram features
void initializeTelegram();

function AppContent() {
  const lp = useLaunchParams();
  const themeSignal = useSignal(miniApp.isDark);
  const isDark = typeof themeSignal === 'boolean' ? themeSignal : false;
  const { initData } = useTelegramFeatures();
  const { connect, disconnect } = useWebSocket();

  useEffect(() => {
    if (initData) {
      // Connect to WebSocket when app is initialized
      connect();
      return () => disconnect();
    }
  }, [initData, connect, disconnect]);

  return (
    <AppRoot
      appearance={isDark ? 'dark' : 'light'}
      platform={['macos', 'ios'].includes(lp.tgWebAppPlatform) ? 'ios' : 'base'}
    >
      <HashRouter>
        <Routes>
          <Route path="/" element={<IndexPage />} />
          <Route path="/calls" element={<CallsPage />} />
          <Route path="/transcripts" element={<TranscriptsPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </HashRouter>
    </AppRoot>
  );
}

export function App() {
  return (
    <WebSocketProvider>
      <CallMonitorProvider>
        <AppContent />
      </CallMonitorProvider>
    </WebSocketProvider>
  );
}
