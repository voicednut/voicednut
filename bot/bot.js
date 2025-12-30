let grammyPkg;
try {
    grammyPkg = require('grammy');
} catch (error) {
    console.error('❌ Missing dependency "grammy". Run `npm ci --omit=dev` in /bot before starting PM2.');
    throw error;
}
const { Bot, session, InlineKeyboard } = grammyPkg;

let conversationsPkg;
try {
    conversationsPkg = require('@grammyjs/conversations');
} catch (error) {
    console.error('❌ Missing dependency "@grammyjs/conversations". Run `npm ci --omit=dev` in /bot before starting PM2.');
    throw error;
}
const { conversations, createConversation } = conversationsPkg;
const axios = require('axios');
const config = require('./config');
const {
    initialSessionState,
    ensureSession,
    cancelActiveFlow,
    startOperation,
    resetSession,
    OperationCancelledError
} = require('./utils/sessionState');

// Bot initialization
const token = config.botToken;
const bot = new Bot(token);
const allowedChatIds = new Set(
    [
        config.admin.userId,
        ...(process.env.ALLOWED_TELEGRAM_IDS ? process.env.ALLOWED_TELEGRAM_IDS.split(',') : [])
    ]
        .filter(Boolean)
        .map((id) => id.toString().trim())
);

function parsePayload(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function maskDigitsPreview(value) {
    if (!value) return '';
    const str = String(value);
    if (str.length <= 2) {
        return `${'•'.repeat(Math.max(0, str.length - 1))}${str.slice(-1)}`;
    }
    const last = str.slice(-2);
    return `${'•'.repeat(str.length - 2)}${last}`;
}

function buildHeaderMessage(payload) {
    const to = payload.to || payload.number || '';
    const callType = payload.call_type || payload.type || 'Call';
    const template = payload.template || payload.script || 'Custom';
    
    const typeLabel = callType === 'OTP' ? '🔐 OTP' : callType === 'Campaign' ? '📢 Campaign' : '📞 Voice';
    const templateLabel = template && template !== 'Custom' ? `\n📋 <b>${template}</b>` : '';
    
    return (
        `📞 <b>Call in Progress</b>\n\n` +
        `To: <b>${to}</b>\n` +
        `Type: ${typeLabel}${templateLabel}\n\n` +
        `Status updates below…`
    );
}

function buildInlineKeyboard(callSid) {
    return {
        inline_keyboard: [
            [
                { text: '📝 Transcript', callback_data: `transcript:${callSid}` },
                { text: '🎧 Recording', callback_data: `recording:${callSid}` }
            ],
            [
                { text: '📊 Timeline', callback_data: `timeline:${callSid}` },
                { text: 'ℹ️ Details', callback_data: `details:${callSid}` }
            ]
        ]
    };
}

function formatDurationSeconds(seconds) {
    if (!seconds && seconds !== 0) return 'N/A';
    const s = Number(seconds) || 0;
    const mins = Math.floor(s / 60);
    const rem = s % 60;
    if (mins === 0) return `${rem}s`;
    return `${mins}m ${rem}s`;
}

async function fetchCallBundle(callSid) {
    try {
        const response = await axios.get(`${config.apiUrl}/api/calls/${callSid}`, { timeout: 12000 });
        return response.data || {};
    } catch (error) {
        console.error('Call bundle fetch error:', error.message);
        return null;
    }
}

// Styled call event renderer
function formatCallEvent(event) {
    const type = event.notification_type;
    const payload = parsePayload(event.payload);
    const callSid = event.call_sid;

    const message = {
        text: '',
        replyMarkup: null,
        protect: true
    };

    if (type === 'call_initiated') {
        message.text = buildHeaderMessage(payload);
        message.replyMarkup = buildInlineKeyboard(callSid);
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_ended') {
        const finalStatus = (payload.status || '').toLowerCase();
        const statusMap = {
            busy: '🚫 <b>Busy</b>',
            failed: '❌ <b>Failed</b>',
            'no-answer': '⏳ <b>No Answer</b>',
            completed: '🏁 <b>Completed</b>'
        };
        message.text = statusMap[finalStatus] || '🏁 <b>Completed</b>';
        if (payload.duration) {
            const mins = Math.floor(payload.duration / 60);
            const secs = payload.duration % 60;
            message.text += `\n⏱️ <b>Duration:</b> ${mins}m ${secs}s`;
        }
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_human_detected') {
        message.text = '👤 <b>Human Detected</b>';
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_machine_detected') {
        message.text = '🤖 <b>Machine/Voicemail Detected</b>';
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_ringing' || type === 'ringing') {
        message.text = '🔔 <b>Ringing…</b>';
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_answered' || type === 'answered') {
        message.text = '✅ <b>Answered</b>';
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_in_progress' || type === 'in-progress') {
        message.text = '🟢 <b>In Progress</b>';
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_input_dtmf' || type === 'call_input_waiting') {
        const label = payload.label || payload.stage || 'Input';
        const expectedLen = payload.expected_length ? ` (<b>${payload.expected_length}</b> digits)` : '';
        message.text = `⌨️ <b>Awaiting Input:</b> ${label}${expectedLen}`;
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_step_retry' || type === 'call_input_retry') {
        const attemptInfo =
            payload.attempts && payload.max_attempts
                ? ` (Attempt <b>${payload.attempts}</b>/<b>${payload.max_attempts}</b>)`
                : '';
        message.text = `❌ <b>Code Rejected</b>${attemptInfo}\n🔁 Re-prompting for input…`;
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_step_complete' || type === 'call_input_success') {
        const label = payload.label || payload.stage || 'Input';
        const digitsText = payload.digits_preview || maskDigitsPreview(payload.code || '');
        const len = payload.digits_length || (payload.digits_preview ? payload.digits_preview.length : null);
        const lenText = len ? ` (len=<b>${len}</b>)` : '';
        message.text = `✅ <b>${label}:</b> ${digitsText}${lenText}`;
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_input_failed') {
        const attemptInfo =
            payload.attempts && payload.max_attempts
                ? ` (Attempt <b>${payload.attempts}</b>/<b>${payload.max_attempts}</b>)`
                : '';
        message.text = `❌ <b>Input Failed</b>${attemptInfo}`;
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'call_final_outcome') {
        const success = Boolean(payload.success);
        const reason = payload.reason || payload.finalStatus || 'unknown';
        const icon = success ? '🏁' : '❌';
        const statusText = success ? '<b>Completed Successfully</b>' : `<b>Not Completed:</b> ${reason}`;
        message.text = `${icon} ${statusText}`;
        if (payload.duration) {
            const mins = Math.floor(payload.duration / 60);
            const secs = payload.duration % 60;
            message.text += `\n⏱️ <b>Duration:</b> ${mins}m ${secs}s`;
        }
        message.replyMarkup = buildInlineKeyboard(callSid);
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'otp_accepted') {
        const codePreview = payload.code || maskDigitsPreview(payload.code);
        const len = payload.length || (codePreview ? String(codePreview).replace(/•/g, '').length : null);
        message.text = `🔑 <b>Code Accepted</b>${len ? ` (len=<b>${len}</b>)` : ''}`;
        message.parse_mode = 'HTML';
        return message;
    }

    if (type === 'otp_rejected') {
        const attemptInfo =
            payload.attempts && payload.max
                ? ` (Attempt <b>${payload.attempts}</b>/<b>${payload.max}</b>)`
                : '';
        message.text = `❌ <b>Code Rejected</b>${attemptInfo}`;
        message.parse_mode = 'HTML';
        return message;
    }

    // Default case for unknown event types
    message.text = `ℹ️ <b>${type.replace(/_/g, ' ')}</b>`;
    message.parse_mode = 'HTML';
    return message;
}

// Initialize conversations with error handling wrapper
function wrapConversation(handler, name) {
    return createConversation(async (conversation, ctx) => {
        try {
            await handler(conversation, ctx);
        } catch (error) {
            if (error instanceof OperationCancelledError) {
                console.log(`Conversation ${name} cancelled: ${error.message}`);
                return;
            }
            console.error(`Conversation error in ${name}:`, error);
            await ctx.reply('❌ An error occurred during the conversation. Please try again.');
        }
    }, name);
}

// IMPORTANT: Add session middleware BEFORE conversations
bot.use(session({ initial: initialSessionState }));

// Ensure every update touches a session object
bot.use(async (ctx, next) => {
    ensureSession(ctx);
    return next();
});

// Any slash command resets the current session/conversation before handing off
bot.use(async (ctx, next) => {
    const text = ctx.message?.text;
    if (text && text.trim().startsWith('/')) {
        const command = text.split(' ')[0].toLowerCase();
        await resetSession(ctx, `command:${command}`);
        ctx.session.lastCommand = command;
    }
    return next();
});

// Initialize conversations middleware AFTER session
bot.use(conversations());

// Global error handler
bot.catch((err) => {
    const errorMessage = `Error while handling update ${err.ctx.update.update_id}:
    ${err.error.message}
    Stack: ${err.error.stack}`;
    console.error(errorMessage);
    
    try {
        err.ctx.reply('❌ An error occurred. Please try again or contact support.');
    } catch (replyError) {
        console.error('Failed to send error message:', replyError);
    }
});

// Poll and post pending webhook notifications as styled call feeds
const lastSentByCall = new Map();
const lastSentAtByCall = new Map();
const lastCallbackTimeByUser = new Map();  // NEW: Track last callback time for debouncing
const CALLBACK_DEBOUNCE_MS = 800;  // NEW: Debounce rapid callbacks to 800ms
const callSendQueues = new Map(); // call_sid -> { queue: [], sending: false, lastStatus: '' }
const SEQUENTIAL_DELAY_MS = 200;

async function sendHeaderIfMissing(notif, payload) {
    const existingThread = await getCallThread(notif.call_sid);
    if (existingThread && existingThread.telegram_chat_id === notif.telegram_chat_id) {
        return existingThread.message_id;
    }
    const headerText = buildHeaderMessage(payload || {});
    const sent = await bot.api.sendMessage(notif.telegram_chat_id, headerText, {
        parse_mode: 'HTML',
        protect_content: true,
        reply_markup: buildInlineKeyboard(notif.call_sid)
    });
    await upsertCallThread(notif.call_sid, notif.telegram_chat_id, sent.message_id);
    return sent.message_id;
}

async function enqueueNotificationSend(notif, formatted) {
    const callSid = notif.call_sid;
    if (!callSendQueues.has(callSid)) {
        callSendQueues.set(callSid, { queue: [], sending: false, lastStatus: '' });
    }
    const queue = callSendQueues.get(callSid);

    const statusText = formatted.text.trim();
    if (queue.lastStatus === statusText) {
        await markNotification(notif.id, 'sent', null, 'deduped');
        return;
    }

    queue.queue.push({ notif, formatted });
    if (!queue.sending) {
        processQueue(callSid);
    }
}

async function processQueue(callSid) {
    const queue = callSendQueues.get(callSid);
    if (!queue || queue.sending) return;
    const next = queue.queue.shift();
    if (!next) {
        queue.sending = false;
        return;
    }

    queue.sending = true;
    const { notif, formatted } = next;
    const payload = parsePayload(notif.payload);

    try {
        const headerId = await sendHeaderIfMissing(notif, payload);
        const sendOptions = {
            parse_mode: 'HTML',
            protect_content: formatted.protect !== false,
            reply_markup: formatted.replyMarkup || undefined,
            reply_to_message_id: headerId,
            allow_sending_without_reply: true
        };
        await bot.api.sendMessage(notif.telegram_chat_id, formatted.text, sendOptions);
        queue.lastStatus = formatted.text.trim();
        await markNotification(notif.id, 'sent', headerId, null);
    } catch (error) {
        console.error('Failed to send notification', notif.id, error.message);
        await markNotification(notif.id, 'failed', null, error.message);
    } finally {
        queue.sending = false;
        setTimeout(() => processQueue(callSid), SEQUENTIAL_DELAY_MS);
    }
}

async function processPendingNotifications() {
    try {
        const pending = await fetchPendingNotifications(20);
        for (const notif of pending) {
            const { text, replyMarkup, protect } = formatCallEvent(notif);
            const chatId = notif.telegram_chat_id?.toString();
            if (chatId && !allowedChatIds.has(chatId)) {
                await markNotification(notif.id, 'failed', null, 'chat_not_allowed');
                continue;
            }
            try {
                await enqueueNotificationSend(notif, { text, replyMarkup, protect, chatId });
            } catch (error) {
                console.error('Failed to send notification', notif.id, error.message);
                await markNotification(notif.id, 'failed', null, error.message);
            }
        }
    } catch (error) {
        console.error('Notification poller error:', error.message);
    }
}

setInterval(processPendingNotifications, 4000);

async function validateTemplatesApiConnectivity() {
    if (!config.templatesApiUrl) {
        console.warn('⚠️ TEMPLATES_API_URL not configured; skipping templates health check');
        return;
    }

    const healthUrl = new URL('/health', config.templatesApiUrl).toString();
    try {
        const response = await axios.get(healthUrl, { timeout: 5000 });
        const contentType = response.headers?.['content-type'] || '';
        if (!contentType.includes('application/json')) {
            throw new Error(`healthcheck returned ${contentType || 'unknown'} content`);
        }
        if (response.data?.status && response.data.status !== 'healthy') {
            throw new Error(`service reported status "${response.data.status}"`);
        }
        console.log(`✅ Templates API reachable (${healthUrl})`);
    } catch (error) {
        let reason;
        if (error.response) {
            const status = error.response.status;
            const statusText = error.response.statusText || '';
            reason = `HTTP ${status} ${statusText}`;
        } else if (error.request) {
            reason = 'no response received';
        } else {
            reason = error.message;
        }
        console.warn(`⚠️ Unable to reach Templates API at ${healthUrl}: ${reason} (continuing without templates health)`);
    }
}

// Import dependencies
const { getUser, getUserList, isAdmin, expireInactiveUsers } = require('./db/db');
const { callFlow, callWizardFlow, otpFlow, paymentFlow, registerCallCommand } = require('./commands/call');
const { smsFlow, bulkSmsFlow, scheduleSmsFlow, registerSmsCommands } = require('./commands/sms');
const { templatesFlow, registerTemplatesCommand } = require('./commands/templates');
const { personaFlow, registerPersonaCommand } = require('./commands/persona');
const { campaignFlow, registerCampaignCommand } = require('./commands/campaign');
const {
    registerProviderCommand,
    fetchProviderStatus,
    formatProviderStatus,
    updateProvider,
    SUPPORTED_PROVIDERS,
} = require('./commands/provider');
// NOTE: otpFlow and paymentFlow removed - unified under /call command
const {
    fetchPending: fetchPendingNotifications,
    markNotification,
    upsertCallThread,
    getCallThread,
} = require('./db/notifications');
const {
    addUserFlow,
    registerAddUserCommand,
    promoteFlow,
    registerPromoteCommand,
    removeUserFlow,
    registerRemoveUserCommand,
    registerUserListCommand
} = require('./commands/users');

// Register conversations with error handling
bot.use(wrapConversation(callFlow, "call-conversation"));
bot.use(wrapConversation(callWizardFlow, "call-wizard"));
bot.use(wrapConversation(otpFlow, "otp-flow"));
bot.use(wrapConversation(paymentFlow, "payment-flow"));
bot.use(wrapConversation(addUserFlow, "adduser-conversation"));
bot.use(wrapConversation(promoteFlow, "promote-conversation"));
bot.use(wrapConversation(removeUserFlow, "remove-conversation"));
bot.use(wrapConversation(scheduleSmsFlow, "schedule-sms-conversation"));
bot.use(wrapConversation(smsFlow, "sms-conversation"));
bot.use(wrapConversation(bulkSmsFlow, "bulk-sms-conversation"));
bot.use(wrapConversation(templatesFlow, "templates-conversation"));
bot.use(wrapConversation(personaFlow, "persona-conversation"));

// Register command handlers
registerCallCommand(bot);
registerAddUserCommand(bot);
registerPromoteCommand(bot);
registerRemoveUserCommand(bot);
registerSmsCommands(bot);
registerTemplatesCommand(bot);
registerUserListCommand(bot);
registerPersonaCommand(bot);
registerCampaignCommand(bot, allowedChatIds);


// Register non-conversation commands
require('./commands/help')(bot);
require('./commands/menu')(bot);
require('./commands/guide')(bot);
require('./commands/transcript')(bot);
require('./commands/api')(bot);
registerProviderCommand(bot);

function escapeMarkdown(text = '') {
    return text.replace(/([_*[\]()~`>#+=|{}.!\\-])/g, '\\$1');
}

function escapeHtml(text = '') {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatDuration(seconds = 0) {
    if (!seconds || seconds < 1) return 'N/A';
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

async function handleCallFollowUp(ctx, callSid, followAction) {
    if (!callSid) {
        await ctx.reply('❌ Missing call identifier for follow-up.');
        return;
    }

    if (ctx.callbackQuery?.message) {
        try {
            await ctx.editMessageReplyMarkup();
        } catch (error) {
            console.warn('Unable to clear follow-up keyboard:', error.message);
        }
    }

    const action = followAction || 'recap';

    let callData;
    let transcripts = [];

    try {
        const response = await axios.get(`${config.apiUrl}/api/calls/${callSid}`, {
            timeout: 15000
        });

        callData = response.data?.call || response.data;
        transcripts = response.data?.transcripts || [];
    } catch (error) {
        console.error('Follow-up call fetch error:', error?.message || error);
        await ctx.reply('❌ Unable to retrieve call details. Please try again later.');
        return;
    }

    if (!callData) {
        await ctx.reply('❌ Call not found. It may have been archived.');
        return;
    }

    switch (action) {
        case 'recap': {
            const rawSummary = callData.call_summary || 'No recap is available yet for this call.';
            const summary = rawSummary.length > 1200 ? `${rawSummary.slice(0, 1200)}…` : rawSummary;
            const status = callData.status || 'unknown';
            const duration = formatDuration(callData.duration);

            const message =
                `📝 *Call Recap*\n\n` +
                `📞 ${escapeMarkdown(callData.phone_number || 'Unknown')}\n` +
                `📊 Status: ${escapeMarkdown(status)}\n` +
                `⏱️ Duration: ${escapeMarkdown(duration)}\n\n` +
                `${escapeMarkdown(summary)}`;

            await ctx.reply(message, { parse_mode: 'Markdown' });
            break;
        }

        case 'schedule': {
            if (!callData.phone_number) {
                await ctx.reply('❌ Cannot schedule follow-up: original phone number missing.');
                return;
            }
            ctx.session.meta = ctx.session.meta || {};
            ctx.session.meta.prefill = {
                phoneNumber: callData.phone_number,
                customerName: callData.customer_name || callData.client_name || callData.metadata?.customer_name || null,
                followUp: 'sms',
                callSid
            };
            await ctx.reply('⏰ Starting follow-up SMS scheduling flow...');
            try {
                await ctx.conversation.enter('schedule-sms-conversation');
            } catch (error) {
                console.error('Follow-up schedule flow error:', error);
                await ctx.reply('❌ Unable to start scheduling flow. You can use /schedulesms manually.');
            }
            break;
        }

        case 'reassign': {
            if (!callData.phone_number) {
                await ctx.reply('❌ Cannot reassign: original phone number missing.');
                return;
            }
            ctx.session.meta = ctx.session.meta || {};
            ctx.session.meta.prefill = {
                phoneNumber: callData.phone_number,
                customerName: callData.customer_name || callData.client_name || callData.metadata?.customer_name || null,
                followUp: 'call',
                callSid
            };
            await ctx.reply('👤 Reassigning to a new agent. Starting call setup...');
            try {
                await ctx.conversation.enter('call-conversation');
            } catch (error) {
                console.error('Follow-up call flow error:', error);
                await ctx.reply('❌ Unable to start call flow. You can use /call to retry manually.');
            }
            break;
        }

        case 'transcript': {
            if (!transcripts.length) {
                await ctx.reply('📋 No transcript is available for this call yet.');
                return;
            }

            const maxMessages = 6;
            let transcriptMessage = `📋 *Recent Transcript*\n\n`;
            transcripts.slice(0, maxMessages).forEach((entry) => {
                const speaker = entry.speaker === 'user' ? '👤 Customer' : '🤖 AI';
                const snippet = escapeMarkdown(entry.message.slice(0, 160));
                transcriptMessage += `${speaker}: ${snippet}${entry.message.length > 160 ? '…' : ''}\n\n`;
            });

            if (transcripts.length > maxMessages) {
                transcriptMessage += `_… ${transcripts.length - maxMessages} more messages_\n\n`;
            }

            transcriptMessage += `Use /transcript ${escapeMarkdown(callSid)} for the full conversation.`;

            await ctx.reply(transcriptMessage, { parse_mode: 'Markdown' });
            break;
        }
        case 'callagain': {
            if (!callData.phone_number) {
                await ctx.reply('❌ Cannot place the follow-up call because the phone number is missing.');
                return;
            }
            ctx.session.meta = ctx.session.meta || {};
            ctx.session.meta.prefill = {
                phoneNumber: callData.phone_number,
                customerName: callData.customer_name || callData.client_name || callData.metadata?.customer_name || null,
                followUp: 'call',
                callSid,
                quickAction: 'callagain'
            };
            await ctx.reply('☎️ Calling the customer again with the same configuration...');
            try {
                await ctx.conversation.enter('call-conversation');
            } catch (error) {
                console.error('Follow-up call-again flow error:', error);
                await ctx.reply('❌ Unable to start the call flow. You can use /call to retry manually.');
            }
            break;
        }
        case 'skip': {
            await ctx.reply('👍 Noted. Skipping the follow-up for now—you can revisit this call anytime from /calls.');
            break;
        }
        case 'resend': {
            if (!callData.phone_number) {
                await ctx.reply('❌ Cannot resend the code: original phone number missing.');
                return;
            }
            ctx.session.meta = ctx.session.meta || {};
            ctx.session.meta.prefill = {
                phoneNumber: callData.phone_number,
                followUp: 'sms',
                callSid,
                quickAction: 'resend_code'
            };
            await ctx.reply('🔁 Sending a fresh verification code via SMS...');
            try {
                await ctx.conversation.enter('sms-conversation');
            } catch (error) {
                console.error('Resend code flow error:', error);
                await ctx.reply('❌ Unable to start SMS flow. You can use /sms to send the code manually.');
            }
            break;
        }

        default:
            await ctx.reply('ℹ️ Quick action not recognised or not yet implemented.');
            break;
    }
}

async function handleSmsFollowUp(ctx, phone, followAction) {
    if (!phone) {
        await ctx.reply('❌ Missing phone number for follow-up.');
        return;
    }

    if (ctx.callbackQuery?.message) {
        try {
            await ctx.editMessageReplyMarkup();
        } catch (error) {
            console.warn('Unable to clear SMS follow-up keyboard:', error.message);
        }
    }

    const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;
    const action = followAction || 'new';

    ctx.session.meta = ctx.session.meta || {};

    switch (action) {
        case 'new': {
            ctx.session.meta.prefill = {
                phoneNumber: normalizedPhone,
                followUp: 'sms'
            };
            await ctx.reply('💬 Continuing the conversation via SMS...');
            try {
                await ctx.conversation.enter('sms-conversation');
            } catch (error) {
                console.error('Follow-up SMS flow error:', error);
                await ctx.reply('❌ Unable to start SMS flow. You can use /sms to continue manually.');
            }
            break;
        }

        case 'schedule': {
            ctx.session.meta.prefill = {
                phoneNumber: normalizedPhone,
                followUp: 'sms'
            };
            await ctx.reply('⏰ Scheduling a follow-up SMS...');
            try {
                await ctx.conversation.enter('schedule-sms-conversation');
            } catch (error) {
                console.error('Follow-up schedule SMS flow error:', error);
                await ctx.reply('❌ Unable to start schedule flow. You can use /schedulesms manually.');
            }
            break;
        }

        case 'call': {
            ctx.session.meta.prefill = {
                phoneNumber: normalizedPhone,
                followUp: 'call'
            };
            await ctx.reply('📞 Initiating a follow-up call setup...');
            try {
                await ctx.conversation.enter('call-conversation');
            } catch (error) {
                console.error('Follow-up call via SMS action error:', error);
                await ctx.reply('❌ Unable to start call flow. You can use /call to retry manually.');
            }
            break;
        }

        default:
            await ctx.reply('ℹ️ SMS quick action not recognised.');
            break;
    }
}


// Start command handler
bot.command('start', async (ctx) => {
    try {
        expireInactiveUsers();
        
        let user = await new Promise(r => getUser(ctx.from.id, r));
        if (!user) {
            const kb = new InlineKeyboard()
                .text('📱 Contact Admin', `https://t.me/@${config.admin.username}`);
            
            return ctx.reply('*Access Restricted* ⚠️\n\n' +
                'This bot requires authorization.\n' +
                'Please contact an administrator to get access.', {
                parse_mode: 'Markdown',
                reply_markup: kb
            });
        }

        const isOwner = await new Promise(r => isAdmin(ctx.from.id, r));
        
        // Prepare user information
        const userStats = `👤 *User Information*
• ID: \`${ctx.from.id}\`
• Username: @${ctx.from.username || 'none'}
• Role: ${user.role}
• Joined: ${new Date(user.timestamp).toLocaleDateString()}`;

        const welcomeText = isOwner ? 
            '🛡️ *Welcome, Administrator!*\n\nYou have full access to all bot features.' :
            '👋 *Welcome to Voicednut Bot!*\n\nYou can make voice calls using AI agents.';

        const kb = new InlineKeyboard();

        // Add buttons
        kb.text('📞 Call', 'CALL')
          .text('📚 Guide', 'GUIDE')
            .row()
            .text('💬 SMS', 'SMS')
            .text('🏥 Health', 'HEALTH')            
            .row()
            .text('❔ Help', 'HELP')
            .text('📋 Menu', 'MENU');

        if (isOwner) {
            kb.row()
                .text('➕ Add User', 'ADDUSER')
                .text('⬆️ Promote', 'PROMOTE')
                .row()
                .text('👥 Users', 'USERS')
                .text('❌ Remove', 'REMOVE')
                .row()
                .text('☎️ Provider', 'PROVIDER_STATUS')
                .text('🔍 Status', 'STATUS');
        }

        // Prepare the message with conditional Mini App notice
        let message = `${welcomeText}\n\n${userStats}\n\n`;
        
        message += 'Use the buttons below or type /help for available commands.';
        
        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: kb
        });
    } catch (error) {
        console.error('Start command error:', error);
        await ctx.reply('❌ An error occurred. Please try again or contact support.');
    }
});

// Enhanced callback query handler (handle any callback, not just :data filter)
bot.on('callback_query', async (ctx, next) => {
    try {
        const action = ctx.callbackQuery?.data;
        if (!action) {
            // Nothing to do for non-data callbacks
            await ctx.answerCallbackQuery();
            return;
        }

        // Answer callback query immediately to prevent timeout
        await ctx.answerCallbackQuery();

        const userId = ctx.from.id.toString();
        const now = Date.now();
        
        // Handle transcript/timeline/details buttons (tx)
        if (action.startsWith('tx:')) {
            const [, kind, callSid] = action.split(':');
            const thread = await getCallThread(callSid);
            const replyId = thread?.message_id;

            const bundle = await fetchCallBundle(callSid);
            if (!bundle || !bundle.call) {
                await bot.api.sendMessage(ctx.chat.id, 'Not available yet — try again shortly.', {
                    reply_to_message_id: replyId || undefined,
                    allow_sending_without_reply: true
                });
                return;
            }

            const { call, transcripts = [], webhook_notifications: webhooks = [] } = bundle;

            if (kind === 'view') {
                if (!transcripts.length) {
                    await bot.api.sendMessage(ctx.chat.id, '📝 Transcript not ready yet — try again shortly.', {
                        reply_to_message_id: replyId || undefined,
                        allow_sending_without_reply: true
                    });
                    return;
                }
                const maxMessages = 8;
                let transcriptMessage = `📝 Transcript (latest)\n\n`;
                transcripts.slice(0, maxMessages).forEach((entry) => {
                    const speaker = entry.speaker === 'user' ? '👤 Caller' : '🤖 AI';
                    const snippet = entry.message.slice(0, 180);
                    transcriptMessage += `${speaker}: ${snippet}${entry.message.length > 180 ? '…' : ''}\n\n`;
                });
                if (transcripts.length > maxMessages) {
                    transcriptMessage += `… ${transcripts.length - maxMessages} more messages\n\n`;
                }
                transcriptMessage += `Full transcript: /transcript ${callSid}`;

                await bot.api.sendMessage(ctx.chat.id, transcriptMessage, {
                    reply_to_message_id: replyId || undefined,
                    allow_sending_without_reply: true
                });
                return;
            }

            if (kind === 'audio') {
                const url = call.recording_url || call.recording || call.audio_url;
                const text = url
                    ? `🎧 Recording:\n${url}`
                    : 'Not available yet — try again shortly.';
                await bot.api.sendMessage(ctx.chat.id, text, {
                    reply_to_message_id: replyId || undefined,
                    allow_sending_without_reply: true
                });
                return;
            }

            if (kind === 'timeline') {
                if (!webhooks || !webhooks.length) {
                    await bot.api.sendMessage(ctx.chat.id, 'Not available yet — try again shortly.', {
                        reply_to_message_id: replyId || undefined,
                        allow_sending_without_reply: true
                    });
                    return;
                }
                const recent = webhooks.slice(0, 12);
                const map = {
                    call_initiated: '📤 initiated',
                    call_ringing: '🔔 ringing',
                    call_answered: '✅ answered',
                    call_in_progress: '🟢 in progress',
                    call_ended: '🏁 completed',
                    busy: '🚫 busy',
                    failed: '❌ failed',
                    canceled: '⚠️ canceled',
                    'no-answer': '⏳ no answer'
                };
                const lines = recent.map((n) => {
                    const label = map[n.notification_type] || n.notification_type;
                    return `${label} • ${n.created_at}`;
                });
                const text = `📊 Timeline\n\n${lines.join('\n')}`;
                await bot.api.sendMessage(ctx.chat.id, text, {
                    reply_to_message_id: replyId || undefined,
                    allow_sending_without_reply: true
                });
                return;
            }

            if (kind === 'details') {
                const duration = formatDurationSeconds(call.duration);
                const text = [
                    `ℹ️ Call details`,
                    `To: ${call.phone_number || 'Unknown'}`,
                    `Status: ${call.status || 'unknown'}`,
                    `Duration: ${duration}`,
                    `Provider: ${call.provider || 'twilio'}`,
                    `Created: ${call.created_at || ''}`
                ].join('\n');
                await bot.api.sendMessage(ctx.chat.id, text, {
                    reply_to_message_id: replyId || undefined,
                    allow_sending_without_reply: true
                });
                return;
            }

            await bot.api.sendMessage(ctx.chat.id, 'Not available yet — try again shortly.', {
                reply_to_message_id: replyId || undefined,
                allow_sending_without_reply: true
            });
            return;
        }

        // NEW: Debounce rapid button clicks (prevent duplicate commands)
        const lastCallbackTime = lastCallbackTimeByUser.get(userId) || 0;
        if (now - lastCallbackTime < CALLBACK_DEBOUNCE_MS) {
            console.log(`⏱️ Callback debounced for user ${userId} (${action})`);
            return;
        }
        lastCallbackTimeByUser.set(userId, now);

        console.log(`Callback query received: ${action} from user ${ctx.from.id}`);

        // Let conversation-specific callbacks (prefixed with data:) pass through unless explicitly handled below
        const isConversationCallback =
            action.includes(':') &&
            !action.startsWith('FOLLOWUP_CALL:') &&
            !action.startsWith('FOLLOWUP_SMS:') &&
            !action.startsWith('PROVIDER_SET:');
        if (isConversationCallback) {
            // If we're currently in a templates flow (or any flow), let the conversation handle it.
            const activeCommand = ctx.session?.currentOp?.command || ctx.session?.lastCommand || '';
            const lowerAction = action.toLowerCase();
            const isTemplateAction =
                lowerAction.startsWith('call-template') ||
                lowerAction.startsWith('sms-template') ||
                lowerAction.startsWith('template-category') ||
                lowerAction.startsWith('confirm');
            if (isTemplateAction && !activeCommand.includes('template')) {
                await ctx.reply('⚠️ That template action has expired. Please run /templates and try again.');
                return;
            }
            return next();
        }

        // Verify user authorization
        const user = await new Promise(r => getUser(ctx.from.id, r));
        if (!user) {
            await ctx.reply("❌ You are not authorized to use this bot.");
            return;
        }

        // Check admin permissions
        const isAdminUser = user.role === 'ADMIN';
        const adminActions = ['ADDUSER', 'PROMOTE', 'REMOVE', 'USERS', 'STATUS', 'TEST_API', 'TEMPLATES', 'SMS_STATS', 'PROVIDER_STATUS'];
        const adminActionPrefixes = ['PROVIDER_SET:'];

        const requiresAdmin = adminActions.includes(action) || adminActionPrefixes.some((prefix) => action.startsWith(prefix));

        if (requiresAdmin && !isAdminUser) {
            await ctx.reply("❌ This action is for administrators only.");
            return;
        }

        if (action.startsWith('FOLLOWUP_CALL:')) {
            await cancelActiveFlow(ctx, `callback:${action}`);
            await resetSession(ctx, `callback:${action}`);
            const [, callSid, followAction] = action.split(':');
            await handleCallFollowUp(ctx, callSid, followAction || 'recap');
            return;
        }

        if (action.startsWith('FOLLOWUP_SMS:')) {
            await cancelActiveFlow(ctx, `callback:${action}`);
            await resetSession(ctx, `callback:${action}`);
            const [, phone, followAction] = action.split(':');
            await handleSmsFollowUp(ctx, phone, followAction || 'new');
            return;
        }

        if (action.startsWith('PROVIDER_SET:')) {
            const [, provider] = action.split(':');
            await cancelActiveFlow(ctx, `callback:${action}`);
            await resetSession(ctx, `callback:${action}`);
            await executeProviderSwitchCommand(ctx, provider?.toLowerCase());
            return;
        }

        // Handle conversation actions
        const conversations = {
            'CALL': 'call-wizard',
            'ADDUSER': 'adduser-conversation',
            'PROMOTE': 'promote-conversation',
            'REMOVE': 'remove-conversation',
            'SMS': 'sms-conversation',
            'BULK_SMS': 'bulk-sms-conversation',
            'SCHEDULE_SMS': 'schedule-sms-conversation',
            'TEMPLATES': 'templates-conversation'
        };

        if (conversations[action]) {
            console.log(`Starting conversation: ${conversations[action]}`);
            await cancelActiveFlow(ctx, `callback:${action}`);
            startOperation(ctx, action.toLowerCase());
            await ctx.reply(`Starting ${action.toLowerCase()} process...`);
            await ctx.conversation.enter(conversations[action]);
            return;
        }

        // Handle direct command actions
        await cancelActiveFlow(ctx, `callback:${action}`);
        await resetSession(ctx, `callback:${action}`);

        switch (action) {
            case 'HELP':
                await executeHelpCommand(ctx);
                break;
                
            case 'USERS':
                if (isAdminUser) {
                    try {
                        await executeUsersCommand(ctx);
                    } catch (usersError) {
                        console.error('Users callback error:', usersError);
                        await ctx.reply('❌ Error displaying users list. Please try again.');
                    }
                }
                break;
                
            case 'GUIDE':
                await executeGuideCommand(ctx);
                break;
                
            case 'MENU':
                await cancelActiveFlow(ctx, 'callback:MENU');
                await resetSession(ctx, 'callback:MENU');
                await executeMenuCommand(ctx, isAdminUser);
                break;
                
            case 'HEALTH':
                await executeHealthCommand(ctx);
                break;
                
            case 'STATUS':
                if (isAdminUser) {
                    await executeStatusCommand(ctx);
                }
                break;

            case 'TEST_API':
                if (isAdminUser) {
                    await executeTestApiCommand(ctx);
                }
                break;

            case 'PROVIDER_STATUS':
                if (isAdminUser) {
                    await executeProviderStatusCommand(ctx);
                }
                break;

            case 'CALLS':
                await executeCallsCommand(ctx);
                break;

            case 'SMS':
                await ctx.reply(`Starting SMS process...`);
                await ctx.conversation.enter('sms-conversation');
                break;
                
            case 'BULK_SMS':
                if (isAdminUser) {
                    await ctx.reply(`Starting bulk SMS process...`);
                    await ctx.conversation.enter('bulk-sms-conversation');
                }
                break;
            
            case 'SCHEDULE_SMS':
                await ctx.reply(`Starting SMS scheduling...`);
                await ctx.conversation.enter('schedule-sms-conversation');
                break;
            
                case 'SMS_STATS':
                    if (isAdminUser) {
                        await executeCommand(ctx, 'smsstats');
                    }
                    break;
                
            default:
                console.log(`Unknown callback action: ${action}`);
                await ctx.reply("❌ Unknown action. Please try again.");
        }

    } catch (error) {
        console.error('Callback query error:', error);
        await ctx.reply("❌ An error occurred processing your request. Please try again.");
    }
});

// Command execution functions for inline buttons
async function executeHelpCommand(ctx) {
    try {
        // Check if user is authorized
        const user = await new Promise(r => getUser(ctx.from.id, r));
        if (!user) {
            return ctx.reply('❌ You are not authorized to use this bot.');
        }
        const isOwner = await new Promise(r => isAdmin(ctx.from.id, r));
        
        // Build help text using HTML formatting (more reliable)
        let helpText = `📱 <b>Basic Commands</b>
• /start - Restart bot &amp; show main menu
• /call - Start a new voice call
• /sms - Send an SMS message
• /smsconversation &lt;phone&gt; - View SMS conversation
• /transcript &lt;call_sid&gt; - Get call transcript
• /calls [limit] - List recent calls (max 50)
• /health or /ping - Check bot &amp; API health
• /guide - Show detailed usage guide
• /menu - Show quick action buttons
• /help - Show this help message`;
        
        if (isOwner) {
            helpText += `
            
👑 <b>Admin Commands</b>
• /adduser - Add new authorized user
• /promote - Promote user to admin
• /removeuser - Remove user access
• /users - List all authorized users
• /bulksms - Send bulk SMS messages
• /schedulesms - Schedule SMS for later
• /provider - View or switch call provider
• /smsstats - View SMS statistics
• /templates - Manage call &amp; SMS templates
• /status - Full system status check
• /testapi - Test API connection`;
        }
        
        helpText += `
        
📖 <b>Quick Usage</b>
1. Use /call or click 📞 Call button
2. Enter phone number (E.164 format: +1234567890)
3. Define agent behavior/prompt
4. Set initial message to be spoken
5. Monitor call progress and receive notifications

💡 <b>Examples</b>
• Phone format: +1234567890 (not 123-456-7890)
• Get transcript: /transcript CA1234567890abcdef
• List calls: /calls 20
• Check health: /health
        
🆘 <b>Support &amp; Info</b>
• Contact admin: @${config.admin.username}
• Bot version: 2.0.0
• For issues or questions, contact support`;
        
        const kb = new InlineKeyboard()
        .text('📞 New Call', 'CALL')
        .text('📋 Menu', 'MENU')
        .row()
        .text('📱 New SMS', 'SMS')
        .text('📚 Full Guide', 'GUIDE');
        
        if (isOwner) {
            kb.row()
            .text('👥 Users', 'USERS')
            .text('➕ Add User', 'ADDUSER')
            .row()
            .text('☎️ Provider', 'PROVIDER_STATUS');
        }
        
        await ctx.reply(helpText, {
            parse_mode: 'HTML',
            reply_markup: kb
        });
    } catch (error) {
        console.error('Help command error:', error);
        await ctx.reply('❌ Error displaying help. Please try again.');
    }
}

async function executeUsersCommand(ctx) {
    try {
        const users = await new Promise((resolve, reject) => {
            getUserList((err, result) => {
                if (err) {
                    console.error('Database error in getUserList:', err);
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });

        if (!users || users.length === 0) {
            await ctx.reply('📋 No users found in the system.');
            return;
        }

        // Create user list without problematic markdown - use plain text
        let message = `📋 USERS LIST (${users.length}):\n\n`;
        
        users.forEach((user, index) => {
            const roleIcon = user.role === 'ADMIN' ? '🛡️' : '👤';
            const username = user.username || 'no_username';
            const joinDate = new Date(user.timestamp).toLocaleDateString();
            message += `${index + 1}. ${roleIcon} @${username}\n`;
            message += `   ID: ${user.telegram_id}\n`;
            message += `   Role: ${user.role}\n`;
            message += `   Joined: ${joinDate}\n\n`;
        });

        // Send without parse_mode to avoid markdown parsing errors
        await ctx.reply(message);

    } catch (error) {
        console.error('executeUsersCommand error:', error);
        await ctx.reply('❌ Error fetching users list. Please try again.');
    }
}

async function executeGuideCommand(ctx) {
    const mainGuide = `📚 *Voice Call Bot Guide*

*Making Calls:*
1️⃣ Start a call using /call or the Call button
2️⃣ Enter phone number in E.164 format (+1234567890)
3️⃣ Define the AI agent's behavior/personality
4️⃣ Set the first message to be spoken
5️⃣ Monitor the call progress

*Phone Number Format:*
• Must start with + symbol
• Include country code
• No spaces or special characters
• Example: +1234567890

*Best Practices:*
• Keep agent prompts clear and specific
• Test with short calls first
• Monitor initial responses
• End calls if needed

*Troubleshooting:*
• If call fails, check number format
• Ensure proper authorization
• Contact admin for persistent issues
• Use /status to check bot health

*Need Help?*
Contact: @${config.admin.username} for support.
Version: 2.0.0`;

    const kb = new InlineKeyboard()
        .text('📞 Call', 'CALL')
        .text('📋 Commands', 'HELP')
        .row()
        .text('🔄 Main Menu', 'MENU')
        .text('💬 SMS', 'SMS');

    await ctx.reply(mainGuide, {
        parse_mode: 'Markdown',
        reply_markup: kb
    });
}

async function executeMenuCommand(ctx, isAdminUser) {
    const kb = new InlineKeyboard()
        .text('📞 Call', 'CALL')
        .text('💬 SMS', 'SMS')
        .row()
        .text('📋 Calls', 'CALLS')
        .text('📚 Guide', 'GUIDE')
        .row()
        .text('🏥 Health', 'HEALTH')
        .text('ℹ️ Help', 'HELP');

    if (isAdminUser) {
        kb.row()
            .text('📤 Bulk SMS', 'BULK_SMS')
            .text('⏰ Schedule SMS', 'SCHEDULE_SMS')
            .row()
            .text('➕ Add User', 'ADDUSER')
            .text('⬆️ Promote', 'PROMOTE')
            .row()
            .text('👥 Users', 'USERS')
            .text('❌ Remove', 'REMOVE')
            .row()
            .text('🧰 Templates', 'TEMPLATES')
            .text('📊 SMS Stats', 'SMS_STATS')
            .row()
            .text('☎️ Provider', 'PROVIDER_STATUS')
            .row()
            .text('🔍 Status', 'STATUS')
            .text('🧪 Test API', 'TEST_API');
    }

    const menuText = isAdminUser ? 
        '🛡️ *Administrator Menu*\n\nSelect an action below:' :
        '📋 *Quick Actions Menu*\n\nSelect an action below:';

    await ctx.reply(menuText, {
        parse_mode: 'Markdown',
        reply_markup: kb
    });
}


async function executeHealthCommand(ctx) {
    const axios = require('axios');
    
    try {
        const startTime = Date.now();
        const response = await axios.get(`${config.apiUrl}/health`, {
            timeout: 5000
        });
        const responseTime = Date.now() - startTime;
        
        const health = response.data;
        
        let message = `🏥 *Health Check*\n\n`;
        message += `🤖 Bot: ✅ Responsive\n`;
        message += `🌐 API: ${health.status === 'healthy' ? '✅' : '❌'} ${health.status}\n`;
        message += `⚡ Response Time: ${responseTime}ms\n`;
        message += `📊 Active Calls: ${health.active_calls || 0}\n`;
        message += `⏰ Checked: ${new Date().toLocaleTimeString()}`;
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Health command error:', error);
        await ctx.reply(`❌ *Health Check Failed*\n\nBot is online but API connection failed.\nError: ${error.message}`, { parse_mode: 'Markdown' });
    }
}

async function executeStatusCommand(ctx) {
    const axios = require('axios');
    
    try {
        const response = await axios.get(`${config.apiUrl}/health`, {
            timeout: 10000
        });
        
        const health = response.data;
        
        let message = `🔍 *System Status*\n\n`;
        message += `🤖 Bot: ✅ Online\n`;
        message += `🌐 API: ${health.status === 'healthy' ? '✅' : '❌'} ${health.status}\n`;
        message += `🗄️ Database: ${health.services?.database?.connected ? '✅ Connected' : '❌ Disconnected'}\n`;
        message += `📊 Active Calls: ${health.active_calls || 0}\n`;
        message += `📋 Recent Calls: ${health.services?.database?.recent_calls || 0}\n`;
        message += `📡 Webhook Service: ${health.services?.webhook_service?.status || 'Unknown'}\n`;
        message += `⏰ Last Check: ${new Date(health.timestamp).toLocaleString()}\n\n`;
        message += `📡 API Endpoint: ${config.apiUrl}`;
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('Status command error:', error);
        await ctx.reply(`❌ *System Status Check Failed*\n\nError: ${error.message}`, { parse_mode: 'Markdown' });
    }
}

async function executeTestApiCommand(ctx) {
    const axios = require('axios');
    
    try {
        console.log('Testing API connection to:', config.apiUrl);
        const response = await axios.get(`${config.apiUrl}/health`, {
            timeout: 10000
        });
        
        const health = response.data;
        
        let message = `✅ *API Status: ${health.status}*\n\n`;
        message += `🔗 URL: ${config.apiUrl}\n`;
        message += `📊 Active Calls: ${health.active_calls || 0}\n`;
        message += `🗄️ Database: ${health.services?.database?.connected ? '✅ Connected' : '❌ Disconnected'}\n`;
        message += `⏰ Timestamp: ${new Date(health.timestamp).toLocaleString()}`;
        
        // Add enhanced features info if available
        if (health.enhanced_features) {
            message += `\n🚀 Enhanced Features: ✅ Active`;
        }
        
        await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error('API test failed:', error.message);
        await ctx.reply(`❌ *API Test Failed*\n\nURL: ${config.apiUrl}\nError: ${error.message}`, { parse_mode: 'Markdown' });
    }
}

async function executeCallsCommand(ctx) {
    const axios = require('axios');

    try {
        console.log('Executing calls command via callback...');
        
        let response;
        let calls = [];
        
        // Try multiple API endpoints in order of preference
        const endpoints = [
            `${config.apiUrl}/api/calls/list?limit=10`,  // Enhanced endpoint
            `${config.apiUrl}/api/calls?limit=10`,       // Basic endpoint
        ];
        
        let lastError = null;
        let successfulEndpoint = null;
        
        for (const endpoint of endpoints) {
            try {
                console.log(`Trying endpoint: ${endpoint}`);
                
                response = await axios.get(endpoint, {
                    timeout: 15000,
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    }
                });

                console.log(`Success! API Response status: ${response.status}`);
                successfulEndpoint = endpoint;
                
                // Handle different response structures
                if (response.data.calls) {
                    calls = response.data.calls;
                } else if (Array.isArray(response.data)) {
                    calls = response.data;
                } else {
                    console.log('Unexpected response structure:', Object.keys(response.data));
                    continue; // Try next endpoint
                }
                
                break; // Success, exit loop
                
            } catch (endpointError) {
                console.log(`Endpoint ${endpoint} failed:`, endpointError.message);
                lastError = endpointError;
                continue; // Try next endpoint
            }
        }
        
        // If all endpoints failed
        if (!calls || calls.length === 0) {
            if (lastError) {
                throw lastError; // Re-throw the last error for proper handling
            } else {
                return ctx.reply('📋 No calls found');
            }
        }

        console.log(`Successfully fetched ${calls.length} calls from: ${successfulEndpoint}`);

        let message = `<b>Recent Calls (${calls.length})</b>\n\n`;

        calls.forEach((call, index) => {
            const dateLabel = escapeHtml(new Date(call.created_at).toLocaleDateString());
            const durationLabel = escapeHtml(
                call.duration
                    ? `${Math.floor(call.duration / 60)}:${String(call.duration % 60).padStart(2, '0')}`
                    : 'N/A'
            );
            const statusLabel = escapeHtml(call.status || 'Unknown');
            const phoneLabel = escapeHtml(call.phone_number || 'Unknown');
            const callId = escapeHtml(call.call_sid || 'N/A');
            const transcriptCount = call.transcript_count || 0;
            const dtmfCount = call.dtmf_input_count || 0;

            message += `${index + 1}. 📞 <b>${phoneLabel}</b>\n`;
            message += `&nbsp;&nbsp;🆔 <code>${callId}</code>\n`;
            message += `&nbsp;&nbsp;📅 ${dateLabel} | ⏱️ ${durationLabel} | 📊 ${statusLabel}\n`;
            if (dtmfCount > 0) {
                message += `&nbsp;&nbsp;🔢 Keypad entries: ${dtmfCount}\n`;
            }
            message += `&nbsp;&nbsp;💬 ${transcriptCount} message${transcriptCount === 1 ? '' : 's'}\n\n`;
        });

        message += 'Use /transcript &lt;call_id&gt; to view details';

        await ctx.reply(message, { parse_mode: 'HTML' });

    } catch (error) {
        console.error('Error fetching calls list via callback:', error);
        
        // Provide specific error messages based on error type
        if (error.response?.status === 404) {
            await ctx.reply(
                '❌ *API Endpoints Missing*\n\n' +
                'The calls list endpoints are not available on the server\\.\n\n' +
                '*Missing endpoints:*\n' +
                '• `/api/calls` \\- Basic calls listing\n' +
                '• `/api/calls/list` \\- Enhanced calls listing\n\n' +
                'Please contact your system administrator to add these endpoints to the Express application\\.',
                { parse_mode: 'Markdown' }
            );
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            await ctx.reply(
                `❌ *Server Connection Failed*\n\n` +
                `Cannot connect to API server at:\n\`${config.apiUrl}\`\n\n` +
                `Please check if the server is running\\.`,
                { parse_mode: 'Markdown' }
            );
        } else if (error.response?.status === 500) {
            await ctx.reply('❌ Server error while fetching calls. Please try again later.');
        } else if (error.response) {
            await ctx.reply(`❌ API error (${error.response.status}): ${error.response.data?.error || 'Unknown error'}`);
        } else {
            await ctx.reply('❌ Error fetching calls list. Please try again later.');
        }
    }
}

function buildProviderKeyboard(activeProvider = '') {
    const keyboard = new InlineKeyboard();
    SUPPORTED_PROVIDERS.forEach((provider, index) => {
        const normalized = provider.toLowerCase();
        const isActive = normalized === activeProvider;
        const label = isActive ? `✅ ${normalized.toUpperCase()}` : normalized.toUpperCase();
        keyboard.text(label, `PROVIDER_SET:${normalized}`);

        const shouldInsertRow = index % 2 === 1 && index < SUPPORTED_PROVIDERS.length - 1;
        if (shouldInsertRow) {
            keyboard.row();
        }
    });

    keyboard.row().text('🔄 Refresh', 'PROVIDER_STATUS');
    return keyboard;
}

async function executeProviderStatusCommand(ctx) {
    try {
        const status = await fetchProviderStatus();
        const active = (status.provider || '').toLowerCase();
        const keyboard = buildProviderKeyboard(active);

        let message = formatProviderStatus(status);
        message += '\n\nTap a provider below to switch.';

        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    } catch (error) {
        console.error('Provider status command error:', error);
        if (error.response) {
            const details = error.response.data?.details || error.response.data?.error || error.response.statusText;
            await ctx.reply(`❌ Failed to fetch provider status: ${details || 'Unknown error'}`);
        } else if (error.request) {
            await ctx.reply('❌ No response from provider API. Please check the server.');
        } else {
            await ctx.reply(`❌ Error fetching provider status: ${error.message}`);
        }
    }
}

async function executeProviderSwitchCommand(ctx, provider) {
    const normalized = (provider || '').trim().toLowerCase();
    if (!normalized || !SUPPORTED_PROVIDERS.includes(normalized)) {
        await ctx.reply('❌ Unsupported provider selection.');
        return;
    }

    try {
        const result = await updateProvider(normalized);
        const status = await fetchProviderStatus();
        const active = (status.provider || '').toLowerCase();
        const keyboard = buildProviderKeyboard(active);

        const targetLabel = active ? active.toUpperCase() : normalized.toUpperCase();
        let message = result.changed === false
            ? `ℹ️ Provider already set to *${targetLabel}*.`
            : `✅ Call provider set to *${targetLabel}*.`;

        message += '\n\n';
        message += formatProviderStatus(status);
        message += '\n\nTap a provider below to switch again.';

        await ctx.reply(message, {
            parse_mode: 'Markdown',
            reply_markup: keyboard,
        });
    } catch (error) {
        console.error('Provider switch command error:', error);
        if (error.response) {
            const details = error.response.data?.details || error.response.data?.error || error.response.statusText;
            await ctx.reply(`❌ Failed to update provider: ${details || 'Unknown error'}`);
        } else if (error.request) {
            await ctx.reply('❌ No response from provider API. Please check the server.');
        } else {
            await ctx.reply(`❌ Error switching provider: ${error.message}`);
        }
    }
}

const TELEGRAM_COMMANDS = [
    { command: 'start', description: 'Start or restart the bot' },
    { command: 'call', description: 'Start outbound voice call' },
    { command: 'sms', description: 'Send SMS message' },
    { command: 'transcript', description: 'Get call transcript by SID' },
    { command: 'calls', description: 'List recent calls' },
    { command: 'smsconversation', description: 'View SMS conversation' },
    { command: 'guide', description: 'Show detailed usage guide' },
    { command: 'help', description: 'Show available commands' },
    { command: 'cancel', description: 'Cancel the current action' },
    { command: 'menu', description: 'Show quick action menu' },
    { command: 'health', description: 'Check bot and API health' },
    { command: 'campaign', description: 'Manage call campaigns (admin only)' },
    { command: 'bulksms', description: 'Send bulk SMS (admin only)' },
    { command: 'schedulesms', description: 'Schedule SMS message' },
    { command: 'provider', description: 'Manage call provider (admin only)' },
    { command: 'smsstats', description: 'SMS statistics (admin only)' },
    { command: 'templates', description: 'Manage call & SMS templates (admin only)' },
    { command: 'adduser', description: 'Add user (admin only)' },
    { command: 'promote', description: 'Promote to ADMIN (admin only)' },
    { command: 'removeuser', description: 'Remove a USER (admin only)' },
    { command: 'users', description: 'List authorized users (admin only)' },
    { command: 'status', description: 'System status (admin only)' }
];

// Handle unknown commands and text messages
bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    
    // Skip if it's a command that's handled elsewhere
    if (text.startsWith('/')) {
        return;
    }
    
    // For non-command messages outside conversations
    if (!ctx.conversation) {
        await ctx.reply('👋 Use /help to see available commands or /menu for quick actions.');
    }
});

async function bootstrap() {
    try {
        await validateTemplatesApiConnectivity();
    } catch (error) {
        console.error(`❌ ${error.message}`);
        process.exit(1);
    }

    console.log('🚀 Starting Voice Call Bot...');
    try {
        await bot.api.setMyCommands(TELEGRAM_COMMANDS);
        console.log('✅ Telegram commands registered');
        await bot.start();
        console.log('✅ Voice Call Bot is running!');
        console.log('🔄 Polling for updates...');
    } catch (error) {
        console.error('❌ Failed to start bot:', error);
        process.exit(1);
    }
}

bootstrap();
