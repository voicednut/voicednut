interface Config {
  api: {
    baseUrl: string;
    wsUrl: string;
  };
  features: {
    mockData: boolean;
    debugMode: boolean;
  };
  app: {
    botUsername: string;
    title: string;
    shortName: string;
  };
}

import { getEnvVar, getBooleanEnvVar } from '@/helpers/env';

export const config: Config = {
  api: {
    baseUrl: getEnvVar('VITE_API_URL', 'http://localhost:3000'),
    wsUrl: getEnvVar('VITE_WS_URL', 'http://localhost:3000'),
  },
  features: {
    mockData: getBooleanEnvVar('VITE_ENABLE_MOCK_DATA', false),
    debugMode: getBooleanEnvVar('VITE_ENABLE_DEBUG_MODE', false),
  },
  app: {
    botUsername: getEnvVar('VITE_BOT_USERNAME', ''),
    title: getEnvVar('VITE_APP_TITLE', 'VOICEDNUT'),
    shortName: getEnvVar('VITE_APP_SHORT_NAME', 'VOICEDNUT'),
  },
};

export default config;
