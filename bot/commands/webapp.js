const crypto = require('crypto');
const config = require('../config');

// Validate WebApp data
function validateWebAppData(rawInitData) {
  if (typeof rawInitData !== 'string' || rawInitData.length === 0) {
    return false;
  }

  const params = new URLSearchParams(rawInitData);
  const data = {};

  for (const [key, value] of params.entries()) {
    data[key] = value;
  }

  if (!data.hash) {
    return false;
  }

  const dataCheckString = Object.keys(data)
    .filter((key) => key !== 'hash')
    .map((key) => {
      return `${key}=${data[key]}`;
    })
    .sort()
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(config.botToken)
    .digest();

  const hash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  return hash === data.hash;
}

module.exports = (bot) => {
  // Handle data from WebApp
  bot.on('message:web_app_data', async (ctx) => {
    try {
      const { web_app_data } = ctx.message;

      let parsed;
      try {
        parsed = JSON.parse(web_app_data.data);
      } catch (parseError) {
        console.error('Failed to parse web_app_data payload', parseError);
        await ctx.reply('❌ Unable to process data from the mini app');
        return;
      }

      const { action, timestamp, payload, initData } = parsed;

      if (!validateWebAppData(initData)) {
        await ctx.reply('❌ Invalid WebApp data received');
        return;
      }

      switch (action) {
        case 'call_initiated': {
          const target = payload?.to || payload?.phoneNumber;
          await ctx.reply(
            `📞 Call initiated\nTo: ${target || 'unknown'}\nSID: ${payload?.callSid ?? 'unknown'}\n⏱️ ${timestamp || new Date().toISOString()}`
          );
          break;
        }

        case 'call_ended': {
          const statusIcon = payload?.status === 'completed' ? '✅' : '❌';
          const durationSeconds = Number(payload?.duration ?? 0);
          const mins = Math.floor(durationSeconds / 60);
          const secs = String(durationSeconds % 60).padStart(2, '0');
          await ctx.reply(
            `${statusIcon} Call ${payload?.status ?? 'ended'}${
              durationSeconds ? `\nDuration: ${mins}:${secs}` : ''
            }`
          );
          break;
        }

        case 'sms_sent': {
          await ctx.reply(`📱 SMS sent to ${payload?.phoneNumber ?? 'recipient'}`);
          break;
        }

        case 'user_added': {
          await ctx.reply(`👤 New user added: ${payload?.name ?? payload?.username ?? 'Unknown'}`);
          break;
        }

        case 'user_removed': {
          await ctx.reply(`🚫 User removed: ${payload?.userId ?? 'unknown'}`);
          break;
        }

        default:
          await ctx.reply('⚠️ Unknown action received from WebApp');
      }
    } catch (error) {
      console.error('Error handling WebApp data:', error);
      await ctx.reply('❌ Error processing WebApp data');
    }
  });
};
