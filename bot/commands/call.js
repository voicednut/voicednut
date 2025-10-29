const config = require('../config');
const axios = require('axios');
const { getUser } = require('../db/db');
const {
    BUSINESS_OPTIONS,
    MOOD_OPTIONS,
    URGENCY_OPTIONS,
    TECH_LEVEL_OPTIONS,
    askOptionWithButtons,
    getOptionLabel
} = require('../utils/persona');

// Simple phone number validation to match E.164 format
function isValidPhoneNumber(number) {
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    return e164Regex.test((number || '').trim());
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
