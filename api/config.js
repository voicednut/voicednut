require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';

function readEnv(name) {
  const value = process.env[name];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function ensure(name, fallback) {
  const value = readEnv(name);
  if (value !== undefined) {
    return value;
  }
  if (fallback !== undefined) {
    if (!isProduction) {
      console.warn(`Environment variable "${name}" is missing. Using fallback value in development.`);
    }
    return fallback;
  }
  const message = `Missing required environment variable "${name}".`;
  if (isProduction) {
    throw new Error(message);
  }
  console.warn(`${message} Continuing because NODE_ENV !== 'production'.`);
  return '';
}

const corsOriginsRaw = ensure('CORS_ORIGINS', process.env.WEB_APP_URL || '');
const corsOrigins = corsOriginsRaw
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = {
  twilio: {
    accountSid: ensure('TWILIO_ACCOUNT_SID'),
    authToken: ensure('TWILIO_AUTH_TOKEN'),
    fromNumber: ensure('FROM_NUMBER'),
  },
  telegram: {
    botToken: ensure('TELEGRAM_BOT_TOKEN', process.env.BOT_TOKEN),
  },
  openRouter: {
    apiKey: ensure('OPENROUTER_API_KEY'),
    model: ensure('OPENROUTER_MODEL', 'meta-llama/llama-3.1-8b-instruct:free'),
    siteUrl: ensure('YOUR_SITE_URL', 'http://localhost:3000'),
    siteName: ensure('YOUR_SITE_NAME', 'Voice Call Bot'),
  },
  deepgram: {
    apiKey: ensure('DEEPGRAM_API_KEY'),
    voiceModel: ensure('VOICE_MODEL', 'aura-asteria-en'),
  },
  server: {
    port: Number(ensure('PORT', '3000')),
    hostname: ensure('SERVER', ''),
    corsOrigins,
    rateLimit: {
      windowMs: Number(ensure('RATE_LIMIT_WINDOW_MS', '60000')),
      max: Number(ensure('RATE_LIMIT_MAX', '300')),
    },
  },
};
