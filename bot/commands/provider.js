const axios = require('axios');
const config = require('../config');
const { getUser, isAdmin } = require('../db/db');

const ADMIN_HEADER_NAME = 'x-admin-token';
const SUPPORTED_PROVIDERS = ['twilio', 'aws', 'vonage'];

function formatProviderStatus(status) {
    if (!status) {
        return 'No status data available.';
    }

    const current = status.provider || 'unknown';
    const stored = status.stored_provider || current;
    const supported = Array.isArray(status.supported_providers) ? status.supported_providers.join(', ') : SUPPORTED_PROVIDERS.join(', ');
    const vonageReady = status.vonage_ready ? '✅' : '⚠️';

    const lines = [
        `⚙️ *Call Provider Settings*`,
        '',
        `• Current Provider: *${current.toUpperCase()}*`,
        `• Stored Default: ${stored.toUpperCase()}`,
        `• AWS Ready: ${status.aws_ready ? '✅' : '⚠️'}`,
        `• Twilio Ready: ${status.twilio_ready ? '✅' : '⚠️'}`,
        `• Vonage Ready: ${vonageReady}`,
        `• Supported: ${supported}`,
    ];

    return lines.join('\n');
}

async function fetchProviderStatus() {
    const response = await axios.get(`${config.apiUrl}/admin/provider`, {
        timeout: 10000,
        headers: {
            [ADMIN_HEADER_NAME]: config.admin.apiToken,
            'Content-Type': 'application/json',
        },
    });
    return response.data;
}

async function updateProvider(provider) {
    const response = await axios.post(
        `${config.apiUrl}/admin/provider`,
        { provider },
        {
            timeout: 15000,
            headers: {
                [ADMIN_HEADER_NAME]: config.admin.apiToken,
                'Content-Type': 'application/json',
            },
        }
    );
    return response.data;
}

module.exports = (bot) => {
    bot.command('provider', async (ctx) => {
        const text = ctx.message?.text || '';
        const args = text.split(/\s+/).slice(1);
        const requestedAction = (args[0] || '').toLowerCase();

        const user = await new Promise((resolve) => getUser(ctx.from.id, resolve));
        if (!user) {
            return ctx.reply('❌ You are not authorized to use this bot.');
        }

        const admin = await new Promise((resolve) => isAdmin(ctx.from.id, resolve));
        if (!admin) {
            return ctx.reply('❌ This command is for administrators only.');
        }

        try {
            if (!requestedAction || requestedAction === 'status') {
                const status = await fetchProviderStatus();
                return ctx.reply(formatProviderStatus(status), { parse_mode: 'Markdown' });
            }

            if (!SUPPORTED_PROVIDERS.includes(requestedAction)) {
                return ctx.reply(
                    `❌ Unsupported provider "${requestedAction}".\n\nUsage:\n• /provider status\n• /provider twilio\n• /provider aws\n• /provider vonage`
                );
            }

            await ctx.reply(`🛠 Switching call provider to *${requestedAction.toUpperCase()}*...`, { parse_mode: 'Markdown' });

            const result = await updateProvider(requestedAction);
            const status = await fetchProviderStatus();

            let message = `✅ Call provider set to *${status.provider?.toUpperCase() || requestedAction.toUpperCase()}*.\n`;
            if (result.changed === false) {
                message = `ℹ️ Provider already set to *${status.provider?.toUpperCase() || requestedAction.toUpperCase()}*.\n`;
            }
            message += '\n';
            message += formatProviderStatus(status);

            await ctx.reply(message, { parse_mode: 'Markdown' });
        } catch (error) {
            console.error('Failed to manage provider via Telegram command:', error);
            if (error.response) {
                const details = error.response.data?.details || error.response.data?.error || error.response.statusText;
                await ctx.reply(`❌ Failed to update provider: ${details || 'Unknown error'}`);
            } else if (error.request) {
                await ctx.reply('❌ No response from API. Please check the server status.');
            } else {
                await ctx.reply(`❌ Error: ${error.message}`);
            }
        }
    });
};
