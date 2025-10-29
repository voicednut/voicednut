const config = require('../config');
const axios = require('axios');
const { InlineKeyboard } = require('grammy');
const { getUser } = require('../db/db');

const BUSINESS_OPTIONS = [
    {
        id: 'technical_support',
        label: 'Technical Support',
        description: 'Installation help, troubleshooting, escalations',
        purposes: [
            { id: 'technical_support', label: 'Technical Support Call', emoji: '🛠️', defaultEmotion: 'confused', defaultUrgency: 'normal' },
            { id: 'service_recovery', label: 'Service Recovery Follow-up', emoji: '♻️', defaultEmotion: 'frustrated', defaultUrgency: 'high' }
        ],
        defaultPurpose: 'technical_support'
    },
    {
        id: 'dental_clinic',
        label: 'Healthcare – Dental',
        description: 'Appointment reminders, rescheduling, treatment questions',
        purposes: [
            { id: 'appointment_reminder', label: 'Appointment Reminder', emoji: '🗓️', defaultEmotion: 'neutral', defaultUrgency: 'normal' },
            { id: 'service_recovery', label: 'Service Recovery Call', emoji: '💬', defaultEmotion: 'frustrated', defaultUrgency: 'normal' }
        ],
        defaultPurpose: 'appointment_reminder'
    },
    {
        id: 'finance_alerts',
        label: 'Finance – Payments & Security',
        description: 'Payment issues, fraud alerts, verification',
        purposes: [
            { id: 'payment_issue', label: 'Payment Issue Follow-up', emoji: '💳', defaultEmotion: 'frustrated', defaultUrgency: 'high' },
            { id: 'emergency_response', label: 'Urgent Security Alert', emoji: '🚨', defaultEmotion: 'urgent', defaultUrgency: 'critical' }
        ],
        defaultPurpose: 'payment_issue'
    },
    {
        id: 'hospitality',
        label: 'Hospitality – Guest Experience',
        description: 'Concierge support, recovery, satisfaction outreach',
        purposes: [
            { id: 'service_recovery', label: 'Service Recovery Call', emoji: '🏨', defaultEmotion: 'stressed', defaultUrgency: 'normal' },
            { id: 'general', label: 'General Concierge Support', emoji: '🤵', defaultEmotion: 'positive', defaultUrgency: 'low' }
        ],
        defaultPurpose: 'service_recovery'
    },
    {
        id: 'education_support',
        label: 'Education – Course Support',
        description: 'Student success coaching, lesson walkthroughs',
        purposes: [
            { id: 'education_support', label: 'Course Support Call', emoji: '📚', defaultEmotion: 'confused', defaultUrgency: 'normal' }
        ],
        defaultPurpose: 'education_support'
    },
    {
        id: 'emergency_response',
        label: 'Emergency Response',
        description: 'Critical incident coordination and follow-ups',
        purposes: [
            { id: 'emergency_response', label: 'Emergency Response Call', emoji: '🚨', defaultEmotion: 'urgent', defaultUrgency: 'critical' }
        ],
        defaultPurpose: 'emergency_response'
    },
    {
        id: 'custom',
        label: 'Custom prompt (manual setup)',
        description: 'Provide your own prompt and opening message',
        custom: true
    }
];

const MOOD_OPTIONS = [
    { id: 'auto', label: 'Auto (use recommended)' },
    { id: 'neutral', label: 'Neutral / professional' },
    { id: 'frustrated', label: 'Empathetic troubleshooter' },
    { id: 'urgent', label: 'Urgent / high-priority' },
    { id: 'confused', label: 'Patient explainer' },
    { id: 'positive', label: 'Upbeat / encouraging' },
    { id: 'stressed', label: 'Reassuring & calming' }
];

const URGENCY_OPTIONS = [
    { id: 'auto', label: 'Auto (use recommended)' },
    { id: 'low', label: 'Low – casual follow-up' },
    { id: 'normal', label: 'Normal – timely assistance' },
    { id: 'high', label: 'High – priority handling' },
    { id: 'critical', label: 'Critical – emergency protocol' }
];

const TECH_LEVEL_OPTIONS = [
    { id: 'auto', label: 'Auto (general audience)' },
    { id: 'general', label: 'General audience' },
    { id: 'novice', label: 'Beginner-friendly' },
    { id: 'advanced', label: 'Advanced / technical specialist' }
];

// Simple phone number validation to match E.164 format
function isValidPhoneNumber(number) {
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    return e164Regex.test((number || '').trim());
}

function formatOptionLabel(option) {
    if (option.emoji) {
        return `${option.emoji} ${option.label}`;
    }
    return option.label;
}

function getOptionLabel(options, id) {
    const match = options.find((option) => option.id === id);
    return match ? match.label : id;
}

async function askOptionWithButtons(conversation, ctx, prompt, options, { prefix, columns = 2, formatLabel } = {}) {
    const keyboard = new InlineKeyboard();
    options.forEach((option, index) => {
        const label = formatLabel ? formatLabel(option) : formatOptionLabel(option);
        keyboard.text(label, `${prefix}:${option.id}`);
        if ((index + 1) % columns === 0) {
            keyboard.row();
        }
    });

    const message = await ctx.reply(prompt, { parse_mode: 'Markdown', reply_markup: keyboard });
    const selectionCtx = await conversation.waitFor('callback_query:data', (callbackCtx) => {
        return callbackCtx.callbackQuery.data.startsWith(`${prefix}:`);
    });

    await selectionCtx.answerCallbackQuery();
    await ctx.api.editMessageReplyMarkup(message.chat.id, message.message_id).catch(() => {});

    const selectedId = selectionCtx.callbackQuery.data.split(':')[1];
    return options.find((option) => option.id === selectedId);
}

async function callFlow(conversation, ctx) {
    try {
        // Check if user is authorized
        const user = await new Promise(r => getUser(ctx.from.id, r));
        if (!user) {
            return ctx.reply('❌ You are not authorized to use this bot.');
        }

        // Step 1: Get phone number
        await ctx.reply('📞 Enter phone number (E.164 format, e.g., +16125151442):');

        const numMsg = await conversation.wait();
        const number = numMsg?.message?.text?.trim();

        if (!number) {
            return ctx.reply('❌ Please provide a phone number.');
        }

        if (!isValidPhoneNumber(number)) {
            return ctx.reply('❌ Invalid phone number format. Use E.164 format: +16125151442');
        }

        // Step 2: Select business/persona type with buttons
        const selectedBusiness = await askOptionWithButtons(
            conversation,
            ctx,
            '🎭 *Select service type / persona:*\nTap the option that best matches this call.',
            BUSINESS_OPTIONS,
            {
                prefix: 'persona',
                columns: 2,
                formatLabel: (option) => option.custom ? '✍️ Custom Prompt' : option.label
            }
        );

        let payload = {
            number: number,
            user_chat_id: ctx.from.id.toString()
        };

        let prompt = null;
        let first_message = null;
        let personaSummary = [];
        let emotion = null;
        let urgency = null;
        let technicalLevel = null;
        let purposeId = 'general';

        if (selectedBusiness.custom) {
            // Custom prompt flow (legacy behaviour)
            await ctx.reply('✍️ Enter the agent prompt (describe how the AI should behave):');
            const promptMsg = await conversation.wait();
            prompt = promptMsg?.message?.text?.trim();
            if (!prompt) {
                return ctx.reply('❌ Please provide a valid prompt.');
            }

            await ctx.reply('💬 Enter the first message the agent will say:');
            const firstMsg = await conversation.wait();
            first_message = firstMsg?.message?.text?.trim();
            if (!first_message) {
                return ctx.reply('❌ Please provide a valid first message.');
            }

            payload.prompt = prompt;
            payload.first_message = first_message;
            personaSummary.push('Persona: Custom prompt');
        } else {
            payload.business_id = selectedBusiness.id;
            payload.channel = 'voice';

            // Step 3: Choose purpose if multiple options exist
            const availablePurposes = selectedBusiness.purposes || [];
            let selectedPurpose = availablePurposes.find(p => p.id === selectedBusiness.defaultPurpose) || availablePurposes[0];

            if (availablePurposes.length > 1) {
                selectedPurpose = await askOptionWithButtons(
                    conversation,
                    ctx,
                    '🎯 *Select call purpose:*\nChoose the specific workflow for this call.',
                    availablePurposes,
                    {
                        prefix: 'purpose',
                        columns: 1,
                        formatLabel: (option) => `${option.emoji || '•'} ${option.label}`
                    }
                );
            }

            selectedPurpose = selectedPurpose || availablePurposes[0];

            purposeId = selectedPurpose?.id || selectedBusiness.defaultPurpose || 'general';
            if (purposeId && purposeId !== 'general') {
                payload.purpose = purposeId;
            }

            // Tone (emotion) selection
            const recommendedEmotion = selectedPurpose?.defaultEmotion || 'neutral';
            const moodSelection = await askOptionWithButtons(
                conversation,
                ctx,
                `🎙️ *Tone preference*\nRecommended: *${recommendedEmotion}*.`,
                MOOD_OPTIONS,
                { prefix: 'tone', columns: 2 }
            );
            if (moodSelection.id !== 'auto') {
                emotion = moodSelection.id;
                payload.emotion = moodSelection.id;
            } else {
                emotion = recommendedEmotion;
            }

            // Urgency preference
            const recommendedUrgency = selectedPurpose?.defaultUrgency || 'normal';
            const urgencySelection = await askOptionWithButtons(
                conversation,
                ctx,
                `⏱️ *Urgency level*\nRecommended: *${recommendedUrgency}*.`,
                URGENCY_OPTIONS,
                { prefix: 'urgency', columns: 2 }
            );
            if (urgencySelection.id !== 'auto') {
                urgency = urgencySelection.id;
                payload.urgency = urgencySelection.id;
            } else {
                urgency = recommendedUrgency;
            }

            // Technical comfort level
            const techSelection = await askOptionWithButtons(
                conversation,
                ctx,
                '🧠 *Caller technical level*\nHow comfortable is the caller with technical details?',
                TECH_LEVEL_OPTIONS,
                { prefix: 'tech', columns: 2 }
            );
            technicalLevel = techSelection.id === 'auto' ? 'general' : techSelection.id;
            if (techSelection.id !== 'auto') {
                payload.technical_level = technicalLevel;
            }

            personaSummary.push(`Persona: ${selectedBusiness.label}`);
            personaSummary.push(`Purpose: ${selectedPurpose?.label || 'General assistance'}`);

            const toneSummary = moodSelection.id === 'auto'
                ? `${moodSelection.label} (${getOptionLabel(MOOD_OPTIONS, recommendedEmotion)})`
                : moodSelection.label;
            const urgencySummary = urgencySelection.id === 'auto'
                ? `${urgencySelection.label} (${getOptionLabel(URGENCY_OPTIONS, recommendedUrgency)})`
                : urgencySelection.label;
            const techSummary = techSelection.id === 'auto'
                ? getOptionLabel(TECH_LEVEL_OPTIONS, 'general')
                : techSelection.label;

            personaSummary.push(`Tone: ${toneSummary}`);
            personaSummary.push(`Urgency: ${urgencySummary}`);
            personaSummary.push(`Technical level: ${techSummary}`);
        }

        // Step 4: Confirmation summary
        const summaryLines = [
            '📋 *Call Details:*',
            '',
            `📞 Number: ${number}`,
        ];

        if (selectedBusiness.custom) {
            summaryLines.push(`🤖 Prompt: ${prompt.substring(0, 120)}${prompt.length > 120 ? '...' : ''}`);
            summaryLines.push(`💬 First Message: ${first_message.substring(0, 120)}${first_message.length > 120 ? '...' : ''}`);
        } else {
            summaryLines.push(...personaSummary.map(line => `• ${line}`));
        }
        summaryLines.push('');
        summaryLines.push('⏳ Making the call...');

        await ctx.reply(summaryLines.join('\n'), { parse_mode: 'Markdown' });

        console.log('Sending payload to API:', {
            ...payload,
            prompt: payload.prompt ? `${payload.prompt.substring(0, 50)}...` : null
        });

        // Step 5: Make the API call
        const response = await axios.post(`${config.apiUrl}/outbound-call`, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout
        });

        console.log('API Response:', response.data);

        // Step 6: Handle response
        if (response.data.success && response.data.call_sid) {
            const successMsg = `✅ *Call Placed Successfully!*\n\n` +
                `📞 To: ${response.data.to}\n` +
                `🆔 Call SID: \`${response.data.call_sid}\`\n` +
                `📊 Status: ${response.data.status}\n\n` +
                `🔔 *You'll receive notifications about:*\n` +
                `• Call progress updates\n` +
                `• Complete transcript when call ends\n` +
                `• AI-generated summary\n\n`;

            await ctx.reply(successMsg, { parse_mode: 'Markdown' });
        } else {
            await ctx.reply('⚠️ Call was sent but response format unexpected. Check logs.');
        }

    } catch (error) {
        console.error('Call error details:', {
            message: error.message,
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            config: {
                url: error.config?.url,
                method: error.config?.method,
                headers: error.config?.headers
            }
        });

        let errorMsg = '❌ *Call Failed*\n\n';

        if (error.response) {
            // Server responded with error
            const status = error.response.status;
            const errorData = error.response.data;

            if (status === 400) {
                errorMsg += `Bad Request: ${errorData?.error || 'Invalid data sent'}`;
            } else if (status === 500) {
                errorMsg += `Server Error: ${errorData?.error || 'Internal server error'}`;
            } else {
                errorMsg += `HTTP ${status}: ${errorData?.error || error.response.statusText}`;
            }
        } else if (error.request) {
            // Network error
            errorMsg += `Network Error: Cannot reach API server\nURL: ${config.apiUrl}`;
        } else {
            // Other error
            errorMsg += `Error: ${error.message}`;
        }

        await ctx.reply(errorMsg, { parse_mode: 'Markdown' });
    }
}

function registerCallCommand(bot) {
    // Main call command
    bot.command('call', async (ctx) => {
        try {
            console.log(`Call command started by user ${ctx.from?.id || 'unknown'}`);
            await ctx.conversation.enter("call-conversation");
        } catch (error) {
            console.error('Error starting call conversation:', error);
            await ctx.reply('❌ Could not start call process. Please try again.');
        }
    });
}

module.exports = {
    callFlow,
    registerCallCommand
};
