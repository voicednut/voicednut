import type WebApp from '@twa-dev/sdk';
import type { EventNames, EventParams } from '@twa-dev/types';

export interface TelegramTheme {
  bg_color: string;
  text_color: string;
  hint_color: string;
  link_color: string;
  button_color: string;
  button_text_color: string;
  secondary_bg_color: string;
}

export interface TelegramConfig {
  initDataUnsafe: {
    user?: {
      id: number;
      username?: string;
      first_name?: string;
      last_name?: string;
    };
    start_param?: string;
  };
  version: string;
  platform: string;
  colorScheme: 'light' | 'dark';
  themeParams: TelegramTheme;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  headerColor: string;
  backgroundColor: string;
  isClosingConfirmationEnabled: boolean;
}

export interface TelegramService {
  webapp: typeof WebApp;
  showAlert: (message: string) => Promise<void>;
  showConfirm: (message: string) => Promise<boolean>;
  close: () => void;
  expand: () => void;
  ready: () => void;
  themeParams: TelegramTheme;
  handleThemeChange: (callback: (params: TelegramTheme) => void) => () => void;
  handleViewportChange: (callback: (height: number) => void) => () => void;
  handleStableViewportChange: (callback: (height: number) => void) => () => void;
}

type SafeWebApp = typeof WebApp & {
  themeParams: TelegramTheme;
  viewportHeight: number;
  viewportStableHeight: number;
  showAlert: typeof WebApp.showAlert;
  showConfirm: typeof WebApp.showConfirm;
  close: typeof WebApp.close;
  expand: typeof WebApp.expand;
  ready: typeof WebApp.ready;
  onEvent: typeof WebApp.onEvent;
  offEvent: typeof WebApp.offEvent;
};

export const createTelegramService = (webappInstance: typeof WebApp): TelegramService => {
  // Validate webapp instance has all required methods
  const isSafeWebApp = (app: typeof WebApp): app is SafeWebApp => {
    return (
      typeof app.themeParams === 'object' &&
      typeof app.viewportHeight === 'number' &&
      typeof app.viewportStableHeight === 'number' &&
      typeof app.showAlert === 'function' &&
      typeof app.showConfirm === 'function' &&
      typeof app.close === 'function' &&
      typeof app.expand === 'function' &&
      typeof app.ready === 'function' &&
      typeof app.onEvent === 'function' &&
      typeof app.offEvent === 'function'
    );
  };

  if (!isSafeWebApp(webappInstance)) {
    throw new Error('Invalid WebApp instance provided');
  }

  const webapp = webappInstance;

  const getThemeParams = (): TelegramTheme => webapp.themeParams;

  const getViewportHeight = (): number => webapp.viewportHeight;

  const getStableViewportHeight = (): number => webapp.viewportStableHeight;

  const subscribe = <T extends EventNames>(
    event: T,
    handler: (params: EventParams[T]) => unknown
  ) => {
    webapp.onEvent(event, handler);
    return () => {
      webapp.offEvent(event, handler);
    };
  };

  const service: TelegramService = {
    webapp,
    showAlert: (message: string) => {
      return new Promise<void>((resolve) => {
        try {
          webapp.showAlert(message, () => resolve());
        } catch (error) {
          console.error('Alert dialog error:', error);
          resolve();
        }
      });
    },
    showConfirm: (message: string) => {
      return new Promise<boolean>((resolve) => {
        try {
          webapp.showConfirm(message, (confirmed) => {
            resolve(Boolean(confirmed));
          });
        } catch (error) {
          console.error('Confirm dialog error:', error);
          resolve(false);
        }
      });
    },
    close: () => {
      webapp.close();
    },
    expand: () => {
      webapp.expand();
    },
    ready: () => {
      webapp.ready();
    },
    get themeParams(): TelegramTheme {
      return getThemeParams();
    },
    handleThemeChange: (callback: (params: TelegramTheme) => void) => {
      const handler = () => {
        try {
          callback(getThemeParams());
        } catch (error) {
          console.error('Theme change handler error:', error);
        }
      };
      return subscribe('themeChanged', handler);
    },
    handleViewportChange: (callback: (height: number) => void) => {
      return subscribe('viewportChanged', (params) => {
        void params;
        try {
          callback(getViewportHeight());
        } catch (error) {
          console.error('Viewport change handler error:', error);
        }
      });
    },
    handleStableViewportChange: (callback: (height: number) => void) => {
      const handler = (params: { isStateStable: boolean }) => {
        try {
          if (params?.isStateStable) {
            callback(getStableViewportHeight());
          }
        } catch (error) {
          console.error('Stable viewport change handler error:', error);
        }
      };
      return subscribe('viewportChanged', handler);
    },
  };

  return service;
};
