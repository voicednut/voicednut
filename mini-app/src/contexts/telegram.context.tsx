import { useEffect } from 'react';
import { create } from 'zustand';
import {
  themeParams,
  initData,
  viewport,
  miniApp,
  backButton,
  type ThemeParams,
} from '@tma.js/sdk-react';

// Make sure window.Telegram type is available
import '../types/telegram-window';

interface TelegramState {
  themeParams: ThemeParams;
  viewportHeight: number;
  viewportStableHeight: number;
  isExpanded: boolean;
  setThemeParams: (params: ThemeParams) => void;
  setViewportHeight: (height: number) => void;
  setViewportStableHeight: (height: number) => void;
  setIsExpanded: (expanded: boolean) => void;
  showAlert: (message: string) => Promise<void>;
  showConfirm: (message: string) => Promise<boolean>;
  close: () => void;
  expand: () => void;
  toggleExpand: () => void;
}

const defaultThemeParams: Record<string, `#${string}`> = {
  bg_color: '#ffffff',
  text_color: '#000000',
  hint_color: '#999999',
  link_color: '#2481cc',
  button_color: '#2481cc',
  button_text_color: '#ffffff',
  secondary_bg_color: '#f0f0f0',
};

const applyThemeToDocument = (params: Partial<Record<string, string>>): void => {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;

  Object.entries(params).forEach(([key, value]) => {
    if (typeof value !== 'string' || value.length === 0) {
      return;
    }

    const kebabName = key.replace(/_/g, '-');
    root.style.setProperty(`--tg-theme-${kebabName}`, value);
    root.style.setProperty(`--tgui--${key}`, value);
  });
};

if (typeof window !== 'undefined') {
  applyThemeToDocument(defaultThemeParams);
}

export const useTelegramStore = create<TelegramState>((set) => ({
  themeParams: defaultThemeParams,
  viewportHeight: 0,
  viewportStableHeight: 0,
  isExpanded: false,
  setThemeParams: (params) => {
    applyThemeToDocument(params);
    set({ themeParams: params });
  },
  setViewportHeight: (height) => set({ viewportHeight: height }),
  setViewportStableHeight: (height) => set({ viewportStableHeight: height }),
  setIsExpanded: (expanded) => set({ isExpanded: expanded }),
  showAlert: (message) => {
    return Promise.resolve(window.Telegram?.WebApp?.showAlert(message));
  },
  showConfirm: async (message) => {
    if (window.Telegram?.WebApp) {
      return await window.Telegram.WebApp.showConfirm(message);
    }
    return false;
  },
  close: () => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.close();
    }
  },
  expand: () => {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.expand();
      set({ isExpanded: true });
    }
  },
  toggleExpand: () => {
    const state = useTelegramStore.getState();
    if (window.Telegram?.WebApp) {
      if (state.isExpanded) {
        window.Telegram.WebApp.close();
      } else {
        window.Telegram.WebApp.expand();
      }
      set({ isExpanded: !state.isExpanded });
    }
  },
}));

export function initializeTelegram(): void {
  // Mount all required components
  void backButton.mount.ifAvailable();
  void initData.restore();
  applyThemeToDocument(defaultThemeParams);

  if (miniApp.mount.isAvailable()) {
    void themeParams.mount();
    void miniApp.mount();
    void themeParams.bindCssVars();
  }

  if (viewport.mount.isAvailable()) {
    void viewport.mount();
    void viewport.bindCssVars();
  }
}

export function useTelegramFeatures() {
  const { setThemeParams, setViewportHeight, setViewportStableHeight } = useTelegramStore();

  useEffect(() => {
    // Initial theme setup
    const currentTheme = themeParams.state();
    if (currentTheme) {
      setThemeParams(currentTheme);
    }

    // Initial viewport setup
    const currentViewport = viewport.state();
    if (currentViewport) {
      setViewportHeight(currentViewport.height);
      setViewportStableHeight(currentViewport.stableHeight);
    }

    const interval = setInterval(() => {
      const theme = themeParams.state();
      const vp = viewport.state();

      if (theme) {
        setThemeParams(theme);
      }

      if (vp) {
        setViewportHeight(vp.height);
        setViewportStableHeight(vp.stableHeight);
      }
    }, 100);

    return () => {
      clearInterval(interval);
    };
  }, [setThemeParams, setViewportHeight, setViewportStableHeight]);

  return {
    initData: initData.state(),
    themeParams: themeParams.state(),
    viewport: viewport.state(),
  };
}
