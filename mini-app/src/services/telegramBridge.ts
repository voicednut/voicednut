export interface TelegramActionPayload {
  action: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

const getWebApp = () => window.Telegram?.WebApp;

export const sendTelegramAction = (
  action: string,
  payload: Record<string, unknown> = {}
): boolean => {
  const webApp = getWebApp();
  if (!webApp) {
    console.warn('Telegram WebApp is not available. Action was not sent.', { action, payload });
    return false;
  }

  const initDataRaw = (webApp as { initData?: unknown }).initData;
  const message = {
    action,
    timestamp: new Date().toISOString(),
    payload,
    initData: typeof initDataRaw === 'string' ? initDataRaw : '',
  };

  try {
    const sendData = (webApp as { sendData?: unknown }).sendData;
    if (typeof sendData !== 'function') {
      console.warn('Telegram WebApp.sendData is not available');
      return false;
    }
    (sendData as (data: string) => void)(JSON.stringify(message));
    return true;
  } catch (error: unknown) {
    const details = error instanceof Error ? error.message : String(error);
    console.error('Failed to send data to Telegram bot', details);
    return false;
  }
};

export default sendTelegramAction;
