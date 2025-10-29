const config = require('../config');
const axios = require('axios');
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
    // Basic E.164 validation: starts with + followed by 1-15 digits
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    return e164Regex.test(number.trim());
}

function parseNumericSelection(text, optionsLength) {
    const choice = parseInt((text || '').trim(), 10);
    if (Number.isNaN(choice) || choice < 1 || choice > optionsLength) {
        return null;
    }
    return choice - 1;
}

function buildOptionsMessage(options) {
    return options
        .map((option, idx) => `${idx + 1}. ${option.label}${option.description ? ` – ${option.description}` : ''}`)
        .join('\n');
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

        // Step 2: Select business/persona type
        const businessOptionsMessage =
            '🎭 *Select service type / persona:*\n\n' +
            buildOptionsMessage(BUSINESS_OPTIONS) +
            '\n\nReply with the number of your choice.';
        await ctx.reply(businessOptionsMessage, { parse_mode: 'Markdown' });

        const businessMsg = await conversation.wait();
        const businessSelectionIdx = parseNumericSelection(businessMsg?.message?.text, BUSINESS_OPTIONS.length);
        if (businessSelectionIdx === null) {
            return ctx.reply('❌ Invalid selection. Please start again and reply with the number of your choice.');
        }

        const selectedBusiness = BUSINESS_OPTIONS[businessSelectionIdx];

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
                const purposeOptionsMessage =
                    '🎯 *Select call purpose:*\n\n' +
                    availablePurposes.map((option, idx) => `${idx + 1}. ${option.emoji || '•'} ${option.label}`).join('\n') +
                    '\n\nReply with the number of your choice.';
                await ctx.reply(purposeOptionsMessage, { parse_mode: 'Markdown' });

                const purposeMsg = await conversation.wait();
                const purposeIdx = parseNumericSelection(purposeMsg?.message?.text, availablePurposes.length);
                if (purposeIdx !== null) {
                    selectedPurpose = availablePurposes[purposeIdx];
                }
            }

            purposeId = selectedPurpose?.id || selectedBusiness.defaultPurpose || 'general';
            if (purposeId && purposeId !== 'general') {
                payload.purpose = purposeId;
            }

            // Tone (emotion) selection
            const recommendedEmotion = selectedPurpose?.defaultEmotion || 'neutral';
            const moodOptionsMessage =
                '🎙️ *Tone preference:*\n\n' +
                MOOD_OPTIONS.map((option, idx) => `${idx + 1}. ${option.label}`).join('\n') +
                `\n\nRecommended: ${recommendedEmotion}. Reply with the number or choose Auto.`;
            await ctx.reply(moodOptionsMessage, { parse_mode: 'Markdown' });

            const moodMsg = await conversation.wait();
            const moodIdx = parseNumericSelection(moodMsg?.message?.text, MOOD_OPTIONS.length);
            const moodSelection = moodIdx !== null ? MOOD_OPTIONS[moodIdx] : MOOD_OPTIONS[0];
            if (moodSelection.id !== 'auto') {
                emotion = moodSelection.id;
                payload.emotion = emotion;
            } else {
                emotion = recommendedEmotion;
            }

            // Urgency preference
            const recommendedUrgency = selectedPurpose?.defaultUrgency || 'normal';
            const urgencyOptionsMessage =
                '⏱️ *Urgency level:*\n\n' +
                URGENCY_OPTIONS.map((option, idx) => `${idx + 1}. ${option.label}`).join('\n') +
                `\n\nRecommended: ${recommendedUrgency}. Reply with the number or choose Auto.`;
            await ctx.reply(urgencyOptionsMessage, { parse_mode: 'Markdown' });

            const urgencyMsg = await conversation.wait();
            const urgencyIdx = parseNumericSelection(urgencyMsg?.message?.text, URGENCY_OPTIONS.length);
            const urgencySelection = urgencyIdx !== null ? URGENCY_OPTIONS[urgencyIdx] : URGENCY_OPTIONS[0];
            if (urgencySelection.id !== 'auto') {
                urgency = urgencySelection.id;
                payload.urgency = urgency;
            } else {
                urgency = recommendedUrgency;
            }

            // Technical comfort level
            const techOptionsMessage =
                '🧠 *Caller technical level:*\n\n' +
                TECH_LEVEL_OPTIONS.map((option, idx) => `${idx + 1}. ${option.label}`).join('\n') +
                '\n\nReply with the number of your choice.';
            await ctx.reply(techOptionsMessage, { parse_mode: 'Markdown' });

            const techMsg = await conversation.wait();
            const techIdx = parseNumericSelection(techMsg?.message?.text, TECH_LEVEL_OPTIONS.length);
            const techSelection = techIdx !== null ? TECH_LEVEL_OPTIONS[techIdx] : TECH_LEVEL_OPTIONS[0];
            if (techSelection.id !== 'auto') {
                technicalLevel = techSelection.id;
                payload.technical_level = technicalLevel;
            } else {
                technicalLevel = 'general';
            }

            personaSummary.push(`Persona: ${selectedBusiness.label}`);
            personaSummary.push(`Purpose: ${selectedPurpose?.label || 'General assistance'}`);
            personaSummary.push(`Tone: ${emotion}`);
            personaSummary.push(`Urgency: ${urgency}`);
            personaSummary.push(`Technical level: ${technicalLevel}`);
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
