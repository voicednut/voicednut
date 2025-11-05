const config = require('../config');
const axios = require('axios');
const { getUser, isAdmin } = require('../db/db');

const MAX_PREVIEW_MESSAGES = 12;
const MAX_CHUNK_LENGTH = 3800;

function escapeHtml(text = '') {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function formatDuration(seconds) {
    if (!seconds || Number.isNaN(seconds)) {
        return 'Unknown';
    }
    const totalSeconds = Math.max(0, parseInt(seconds, 10));
    const minutes = Math.floor(totalSeconds / 60);
    const remainder = totalSeconds % 60;
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

function formatTimestamp(value) {
    if (!value) return 'Unknown time';
    try {
        return new Date(value).toLocaleTimeString();
    } catch (error) {
        return 'Unknown time';
    }
}

async function getTranscript(ctx, callSid) {
    try {
        const response = await axios.get(`${config.apiUrl}/api/calls/${callSid}`, {
            timeout: 15000
        });

        const { call, transcripts = [], dtmf_inputs: dtmfInputs = [] } = response.data || {};

        if (!call) {
            await ctx.reply('❌ Call not found');
            return;
        }

        if (!transcripts.length) {
            let message = `<b>Call Details</b>\n\n`;
            message += `📞 Phone: <b>${escapeHtml(call.phone_number)}</b>\n`;
            message += `🆔 Call ID: <code>${escapeHtml(callSid)}</code>\n`;
            message += `⏱️ Duration: ${formatDuration(call.duration)}\n`;
            message += `📊 Status: ${escapeHtml(call.status || 'Unknown')}\n`;
            if (dtmfInputs.length) {
                message += `🔢 Keypad Input:\n`;
                dtmfInputs.forEach((input, index) => {
                    const timestamp = formatTimestamp(input.received_at);
                    message += `• <code>${escapeHtml(input.digits)}</code> (${escapeHtml(timestamp)})\n`;
                });
            }
            message += `\n❌ No transcript available yet.`;

            await ctx.reply(message, { parse_mode: 'HTML' });
            return;
        }

        let message = `<b>Call Transcript</b>\n\n`;
        message += `📞 Phone: <b>${escapeHtml(call.phone_number)}</b>\n`;
        message += `🆔 Call ID: <code>${escapeHtml(callSid)}</code>\n`;
        message += `⏱️ Duration: ${formatDuration(call.duration)}\n`;
        message += `📊 Status: ${escapeHtml(call.status || 'Unknown')}\n`;
        message += `💬 Messages: ${transcripts.length}\n`;
        if (dtmfInputs.length) {
            message += `🔢 Keypad Inputs:\n`;
            dtmfInputs.forEach((input) => {
                const timestamp = formatTimestamp(input.received_at);
                message += `• <code>${escapeHtml(input.digits)}</code> (${escapeHtml(timestamp)})\n`;
            });
        }

        if (call.call_summary) {
            message += `\n<b>Summary</b>\n${escapeHtml(call.call_summary)}\n`;
        }

        message += `\n<b>Conversation</b>\n`;

        const previewMessages = transcripts.slice(0, MAX_PREVIEW_MESSAGES);

        previewMessages.forEach((entry) => {
            const speakerLabel = entry.speaker === 'user' ? '👤 User' : '🤖 AI';
            const timestamp = formatTimestamp(entry.timestamp);
            message += `\n<b>${speakerLabel}</b> <i>${escapeHtml(timestamp)}</i>\n`;
            message += `${escapeHtml(entry.message)}\n`;
        });

        if (transcripts.length > previewMessages.length) {
            const remaining = transcripts.length - previewMessages.length;
            message += `\n… ${remaining} more message${remaining === 1 ? '' : 's'} (use /fullTranscript ${escapeHtml(callSid)} for full log)`;
        }

        await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error fetching transcript:', error);

        if (error.response?.status === 404) {
            await ctx.reply('❌ Call not found or transcript not ready');
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            await ctx.reply('❌ Unable to reach API server. Please check the server status.');
        } else {
            await ctx.reply('❌ Error fetching transcript. Please try again later.');
        }
    }
}

async function getCallsList(ctx, limit = 10) {
    try {
        const endpoints = [
            `${config.apiUrl}/api/calls/list?limit=${limit}`,
            `${config.apiUrl}/api/calls?limit=${limit}`
        ];

        let calls = [];
        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                const response = await axios.get(endpoint, {
                    timeout: 15000,
                    headers: {
                        Accept: 'application/json'
                    }
                });

                if (Array.isArray(response.data)) {
                    calls = response.data;
                } else if (Array.isArray(response.data.calls)) {
                    calls = response.data.calls;
                }

                if (calls.length) {
                    break;
                }
            } catch (error) {
                lastError = error;
            }
        }

        if (!calls.length) {
            if (lastError) throw lastError;
            await ctx.reply('📋 No calls found');
            return;
        }

        let message = `<b>Recent Calls (${calls.length})</b>\n\n`;

        calls.forEach((call, index) => {
            const phone = escapeHtml(call.phone_number || 'Unknown');
            const status = escapeHtml(call.status || 'Unknown');
            const callId = escapeHtml(call.call_sid || 'N/A');
            const createdDate = escapeHtml(call.created_date || (call.created_at ? new Date(call.created_at).toLocaleDateString() : 'Unknown'));
            const durationLabel = escapeHtml(call.duration_formatted || formatDuration(call.duration));
            const transcriptCount = call.transcript_count || 0;
            const dtmfCount = call.dtmf_input_count || 0;

            message += `${index + 1}. 📞 <b>${phone}</b>\n`;
            message += `&nbsp;&nbsp;🆔 <code>${callId}</code>\n`;
            message += `&nbsp;&nbsp;📅 ${createdDate} | ⏱️ ${durationLabel} | 📊 ${status}\n`;
            if (dtmfCount > 0) {
                message += `&nbsp;&nbsp;🔢 Keypad entries: ${dtmfCount}\n`;
            }
            message += `&nbsp;&nbsp;💬 ${transcriptCount} message${transcriptCount === 1 ? '' : 's'}\n\n`;
        });

        message += `Use /transcript &lt;call_id&gt; to view details.`;

        await ctx.reply(message, { parse_mode: 'HTML' });
    } catch (error) {
        console.error('Error fetching calls list:', error);

        if (error.response?.status === 404) {
            await ctx.reply('❌ Calls API endpoint not available on the server.');
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            await ctx.reply(`❌ Unable to reach API server at ${config.apiUrl}`);
        } else if (error.response?.status === 500) {
            await ctx.reply('❌ Server error while fetching calls. Please try again later.');
        } else if (error.response) {
            await ctx.reply(`❌ API error (${error.response.status}): ${error.response.data?.error || 'Unknown error'}`);
        } else {
            await ctx.reply('❌ Error fetching calls list. Please try again later.');
        }
    }
}

async function sendFullTranscript(ctx, callSid) {
    try {
        const response = await axios.get(`${config.apiUrl}/api/calls/${callSid}`, {
            timeout: 20000
        });

        const { call, transcripts = [], dtmf_inputs: dtmfInputs = [] } = response.data || {};

        if (!call || !transcripts.length) {
            await ctx.reply('❌ Call or transcript not found');
            return;
        }

        let buffer = `📋 FULL CALL TRANSCRIPT\n\n`;
        buffer += `📞 Number: ${call.phone_number}\n`;
        buffer += `🆔 Call ID: ${callSid}\n`;
        buffer += `⏱️ Duration: ${formatDuration(call.duration)}\n`;
        buffer += `📊 Status: ${call.status || 'Unknown'}\n`;
        buffer += `💬 Messages: ${transcripts.length}\n`;
        if (dtmfInputs.length) {
            buffer += `🔢 Keypad Inputs:\n`;
            dtmfInputs.forEach((input) => {
                buffer += `  - ${input.digits} (${formatTimestamp(input.received_at)})\n`;
            });
        }
        buffer += `\nCONVERSATION:\n`;

        transcripts.forEach((entry) => {
            const speakerLabel = entry.speaker === 'user' ? '👤 USER' : '🤖 AI';
            const timestamp = formatTimestamp(entry.timestamp);
            buffer += `\n${speakerLabel} (${timestamp}):\n${entry.message}\n`;
        });

        const chunks = [];
        let remaining = buffer;

        while (remaining.length > MAX_CHUNK_LENGTH) {
            let splitIndex = remaining.lastIndexOf('\n', MAX_CHUNK_LENGTH);
            if (splitIndex === -1) {
                splitIndex = MAX_CHUNK_LENGTH;
            }
            chunks.push(remaining.slice(0, splitIndex));
            remaining = remaining.slice(splitIndex);
        }

        if (remaining.trim().length) {
            chunks.push(remaining);
        }

        for (let i = 0; i < chunks.length; i++) {
            const suffix = i < chunks.length - 1 ? '\n\n… (continued)' : '';
            await ctx.reply(chunks[i] + suffix);
            if (i < chunks.length - 1) {
                await new Promise((resolve) => setTimeout(resolve, 700));
            }
        }
    } catch (error) {
        console.error('Full transcript error:', error);
        if (error.response?.status === 404) {
            await ctx.reply('❌ Call not found');
        } else {
            await ctx.reply('❌ Error fetching full transcript');
        }
    }
}

async function ensureAdmin(ctx) {
    const user = await new Promise((resolve) => getUser(ctx.from.id, resolve));
    if (!user) {
        await ctx.reply('❌ You are not authorized to use this bot.');
        return false;
    }

    const adminStatus = await new Promise((resolve) => isAdmin(ctx.from.id, resolve));
    if (!adminStatus) {
        await ctx.reply('❌ This command is for administrators only.');
        return false;
    }

    return true;
}

module.exports = (bot) => {
    bot.command('transcript', async (ctx) => {
        try {
            if (!(await ensureAdmin(ctx))) {
                return;
            }

            const parts = ctx.message.text.trim().split(/\s+/);
            if (parts.length < 2) {
                await ctx.reply('📋 Usage: /transcript <call_id>\nExample: /transcript CA1234567890abcdef');
                return;
            }

            const callSid = parts[1].trim();
            if (!/^CA[a-z0-9]+$/i.test(callSid)) {
                await ctx.reply('❌ Invalid Call SID format. Expected value starting with "CA".');
                return;
            }

            await getTranscript(ctx, callSid);
        } catch (error) {
            console.error('Transcript command error:', error);
            await ctx.reply('❌ Error processing transcript command');
        }
    });

    bot.command('calls', async (ctx) => {
        try {
            if (!(await ensureAdmin(ctx))) {
                return;
            }

            const parts = ctx.message.text.trim().split(/\s+/);
            const limit = parts.length > 1 ? Math.min(Math.max(parseInt(parts[1], 10) || 10, 1), 50) : 10;

            await ctx.reply('📋 Fetching recent calls...');
            await getCallsList(ctx, limit);
        } catch (error) {
            console.error('Calls command error:', error);
            await ctx.reply('❌ Error fetching calls list');
        }
    });

    bot.command('fullTranscript', async (ctx) => {
        try {
            if (!(await ensureAdmin(ctx))) {
                return;
            }

            const parts = ctx.message.text.trim().split(/\s+/);
            if (parts.length < 2) {
                await ctx.reply('📋 Usage: /fullTranscript <call_id>');
                return;
            }

            const callSid = parts[1].trim();
            if (!/^CA[a-z0-9]+$/i.test(callSid)) {
                await ctx.reply('❌ Invalid Call SID format. Expected value starting with "CA".');
                return;
            }

            await ctx.reply('📋 Fetching full transcript...');
            await sendFullTranscript(ctx, callSid);
        } catch (error) {
            console.error('Full transcript command error:', error);
            await ctx.reply('❌ Error fetching full transcript');
        }
    });
};
