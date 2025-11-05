const axios = require('axios');
const config = require('../config');
const { getUser, isAdmin } = require('../db/db');

const ADMIN_HEADER_NAME = 'x-admin-token';
const SUPPORTED_PROVIDERS = ['twilio', 'aws', 'vonage'];

function formatProviderStatus(status) {
    if (!status) {
        return 'No status data available.';
    }

    const current = typeof status.provider === 'string' ? status.provider : 'unknown';
    const stored = typeof status.stored_provider === 'string' && status.stored_provider.length > 0
        ? status.stored_provider
        : current;
    const supportedValues = Array.isArray(status.supported_providers) && status.supported_providers.length > 0
        ? status.supported_providers
        : SUPPORTED_PROVIDERS;
    const vonageReady = status.vonage_ready ? '✅' : '⚠️';

    const lines = [
        '⚙️ *Call Provider Settings*',
        '',
        `• Current Provider: *${current.toUpperCase()}*`,
        `• Stored Default: ${stored.toUpperCase()}`,
        `• AWS Ready: ${status.aws_ready ? '✅' : '⚠️'}`,
        `• Twilio Ready: ${status.twilio_ready ? '✅' : '⚠️'}`,
        `• Vonage Ready: ${vonageReady}`,
        `• Supported: ${supportedValues.join(', ').toUpperCase()}`,
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

async function ensureAuthorizedAdmin(ctx) {
    const fromId = ctx.from?.id;
    if (!fromId) {
        await ctx.reply('❌ Missing sender information.');
        return { user: null, isAdminUser: false };
    }

    const user = await new Promise((resolve) => getUser(fromId, resolve));
    if (!user) {
        await ctx.reply('❌ You are not authorized to use this bot.');
        return { user: null, isAdminUser: false };
    }

    const admin = await new Promise((resolve) => isAdmin(fromId, resolve));
    if (!admin) {
        await ctx.reply('❌ This command is for administrators only.');
        return { user, isAdminUser: false };
    }

    return { user, isAdminUser: true };
}

async function handleProviderSwitch(ctx, requestedProvider) {
    await ctx.reply(`🛠 Switching call provider to *${requestedProvider.toUpperCase()}*...`, { parse_mode: 'Markdown' });

    const result = await updateProvider(requestedProvider);
    const status = await fetchProviderStatus();

    let message = `✅ Call provider set to *${status.provider?.toUpperCase() || requestedProvider.toUpperCase()}*.\n`;
    if (result.changed === false) {
        message = `ℹ️ Provider already set to *${status.provider?.toUpperCase() || requestedProvider.toUpperCase()}*.\n`;
    }
    message += '\n';
    message += formatProviderStatus(status);

    await ctx.reply(message, { parse_mode: 'Markdown' });
}

function registerProviderCommand(bot) {
    bot.command('provider', async (ctx) => {
        const text = ctx.message?.text || '';
        const args = text.split(/\s+/).slice(1);
        const requestedAction = (args[0] || '').toLowerCase();

        const { isAdminUser } = await ensureAuthorizedAdmin(ctx);
        if (!isAdminUser) {
            return;
        }

        try {
            if (!requestedAction || requestedAction === 'status') {
                const status = await fetchProviderStatus();
                await ctx.reply(formatProviderStatus(status), { parse_mode: 'Markdown' });
                return;
            }

            if (!SUPPORTED_PROVIDERS.includes(requestedAction)) {
                await ctx.reply(
                    `❌ Unsupported provider "${requestedAction}".\n\nUsage:\n• /provider status\n• /provider twilio\n• /provider aws\n• /provider vonage`
                );
                return;
            }

            await handleProviderSwitch(ctx, requestedAction);
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
}

module.exports = {
    registerProviderCommand,
    fetchProviderStatus,
    updateProvider,
    formatProviderStatus,
    handleProviderSwitch,
    SUPPORTED_PROVIDERS,
    ADMIN_HEADER_NAME,
};
