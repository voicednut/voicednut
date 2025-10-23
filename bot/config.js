'use strict';

/*
 * Configuration for the Telegram bot
 */

require('dotenv').config();
const required = ['ADMIN_TELEGRAM_ID', 'ADMIN_TELEGRAM_USERNAME', 'API_URL', 'BOT_TOKEN'];

// Check for required environment variables

for (const key of required) {
  if (!process.env[key]) {
    console.error(`❌ Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const miniAppUrl = process.env.MINI_APP_URL || process.env.WEB_APP_URL;

if (!miniAppUrl) {
  console.error('❌ Missing environment variable: MINI_APP_URL (or WEB_APP_URL fallback)');
  process.exit(1);
}

// Check for required environment variables

module.exports = {
  admin: {
    userId: process.env.ADMIN_TELEGRAM_ID,
    username: process.env.ADMIN_TELEGRAM_USERNAME
  },
  apiUrl: process.env.API_URL,
  botToken: process.env.BOT_TOKEN,

  // New Mini App configuration
  webAppUrl: miniAppUrl,
  miniAppUrl,
  webAppSecret: process.env.WEB_APP_SECRET || 'your-web-app-secret',
  webAppPort: process.env.WEB_APP_PORT || 8080,

  // CORS settings for Mini App
  cors: {
    origins: [
      'https://web.telegram.org',
      miniAppUrl
    ].filter(Boolean)
  }
};
