import { type ThemeParams } from '@tma.js/sdk-react';

interface WebApp {
  showAlert: (message: string) => void;
  showConfirm: (message: string) => Promise<boolean>;
  close: () => void;
  expand: () => void;
  themeParams: ThemeParams;
  isExpanded: boolean;
}

interface TelegramWebApp {
  WebApp: WebApp;
}

declare global {
  interface Window {
    Telegram?: TelegramWebApp;
  }
}
