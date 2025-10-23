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

const parseEnvString = (value: unknown, defaultValue: string): string =>
  typeof value === 'string' ? value : defaultValue;

const parseEnvBoolean = (value: unknown, defaultValue: boolean): boolean =>
  typeof value === 'string' ? value === 'true' : defaultValue;

export const config: Config = {
  api: {
    baseUrl: parseEnvString(import.meta.env.VITE_API_URL, 'http://localhost:3000'),
    wsUrl: parseEnvString(import.meta.env.VITE_WS_URL, 'http://localhost:3000'),
  },
  features: {
    mockData: parseEnvBoolean(import.meta.env.VITE_ENABLE_MOCK_DATA, false),
    debugMode: parseEnvBoolean(import.meta.env.VITE_ENABLE_DEBUG_MODE, false),
  },
  app: {
    botUsername: parseEnvString(import.meta.env.VITE_BOT_USERNAME, ''),
    title: parseEnvString(import.meta.env.VITE_APP_TITLE, 'VoicedNut'),
    shortName: parseEnvString(import.meta.env.VITE_APP_SHORT_NAME, 'voicednut'),
  },
};

export default config;
