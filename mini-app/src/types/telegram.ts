import type { ThemeParams } from '@tma.js/sdk-react';

export type TelegramTheme = ThemeParams;

export interface ViewportChangeEvent {
  height: number;
  stableHeight: number;
  isStateStable: boolean;
}
