const config = require('../config');

const templatesApiBase = config.templatesApiUrl.replace(/\/+$/, '');
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
const { extractTemplateVariables } = require('../utils/templates');

function isValidPhoneNumber(number) {
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    return e164Regex.test((number || '').trim());
}

function replacePlaceholders(text = '', values = {}) {
    let output = text;
    for (const [token, value] of Object.entries(values)) {
        const pattern = new RegExp(`{${token}}`, 'g');
        output = output.replace(pattern, value);
    }
    return output;
}

async function collectPlaceholderValues(conversation, ctx, placeholders) {
    const values = {};
    for (const placeholder of placeholders) {
        await ctx.reply(`✏️ Enter value for *${placeholder}* (type skip to leave unchanged):`, { parse_mode: 'Markdown' });
        const response = await conversation.wait();
        const text = response?.message?.text?.trim();
        if (!text || text.toLowerCase() === 'skip') {
            continue;
        }
        values[placeholder] = text;
    }
    return values;
}

function formatTemplatesApiError(error, action) {
    const baseHelp = `Ensure the templates service is reachable at ${templatesApiBase} or update TEMPLATES_API_URL.`;

    if (error.response) {
        const status = error.response.status;
        const contentType = error.response.headers?.['content-type'] || '';
        if (!contentType.includes('application/json')) {
            return `❌ ${action}: Templates API responded with HTTP ${status}. ${baseHelp}`;
        }
        const details = error.response.data?.error || error.response.data?.message || `HTTP ${status}`;
        return `❌ ${action}: ${details}`;
    }

    if (error.request) {
        return `❌ ${action}: No response from Templates API. ${baseHelp}`;
    }

    if (error.message) {
        return `❌ ${action}: ${error.message}`;
    }

    return `❌ ${action}: Unknown error contacting Templates API.`;
}

async function fetchCallTemplates() {
    try {
        const response = await axios.get(`${templatesApiBase}/api/call-templates`, { timeout: 15000 });
        const contentType = response.headers?.['content-type'] || '';
        if (!contentType.includes('application/json')) {
            throw new Error('Templates API returned non-JSON response');
        }
        if (response.data && response.data.success === false) {
            throw new Error(response.data.error || 'Templates API reported failure');
        }
        return response.data.templates || [];
    } catch (error) {
        throw new Error(formatTemplatesApiError(error, 'Failed to load call templates'));
    }
}

async function fetchCallTemplateById(id) {
    try {
        const response = await axios.get(`${templatesApiBase}/api/call-templates/${id}`, { timeout: 15000 });
        const contentType = response.headers?.['content-type'] || '';
        if (!contentType.includes('application/json')) {
            throw new Error('Templates API returned non-JSON response');
        }
        if (response.data && response.data.success === false) {
            throw new Error(response.data.error || 'Templates API reported failure');
        }
        return response.data.template;
    } catch (error) {
        throw new Error(formatTemplatesApiError(error, 'Failed to load template details'));
    }
}

async function selectCallTemplate(conversation, ctx) {
    let templates;
    try {
        templates = await fetchCallTemplates();
    } catch (error) {
        await ctx.reply(error.message || '❌ Failed to load call templates.');
        return null;
    }

    if (!templates.length) {
        await ctx.reply('ℹ️ No call templates available. Use /templates to create one.');
        return null;
    }

    const options = templates.map((template) => ({ id: template.id.toString(), label: `📄 ${template.name}` }));
    options.push({ id: 'back', label: '⬅️ Back' });

    const selection = await askOptionWithButtons(
        conversation,
        ctx,
        `📚 *Call Templates*\nChoose a template to use for this call.`,
        options,
        { prefix: 'call-template', columns: 1 }
    );

    if (selection.id === 'back') {
        return null;
    }

    const templateId = Number(selection.id);
    if (Number.isNaN(templateId)) {
        await ctx.reply('❌ Invalid template selection.');
        return null;
    }

    let template;
    try {
        template = await fetchCallTemplateById(templateId);
    } catch (error) {
        await ctx.reply(error.message || '❌ Failed to load template.');
        return null;
    }

    if (!template) {
        await ctx.reply('❌ Template not found.');
        return null;
    }

    if (!template.first_message) {
        await ctx.reply('⚠️ This template does not define a first message. Please edit it before using.');
        return null;
    }

    const placeholderSet = new Set();
    extractTemplateVariables(template.prompt || '').forEach((token) => placeholderSet.add(token));
    extractTemplateVariables(template.first_message || '').forEach((token) => placeholderSet.add(token));

    const placeholderValues = {};
    if (placeholderSet.size > 0) {
        await ctx.reply('🧩 This template contains placeholders. Provide values where applicable (type skip to leave as-is).');
        Object.assign(placeholderValues, await collectPlaceholderValues(conversation, ctx, Array.from(placeholderSet)));
    }

    const filledPrompt = template.prompt ? replacePlaceholders(template.prompt, placeholderValues) : undefined;
    const filledFirstMessage = replacePlaceholders(template.first_message, placeholderValues);

    const payloadUpdates = {
        channel: 'voice',
        business_id: template.business_id || undefined,
        prompt: filledPrompt,
        first_message: filledFirstMessage,
        voice_model: template.voice_model || undefined
    };

    const summary = [`Template: ${template.name}`];
    if (template.description) {
        summary.push(`Description: ${template.description}`);
    }

    if (template.business_id) {
        const business = BUSINESS_OPTIONS.find((option) => option.id === template.business_id);
        summary.push(`Persona: ${business ? business.label : template.business_id}`);
    }

    const personaConfig = template.persona_config || {};
    if (personaConfig.purpose) {
        summary.push(`Purpose: ${personaConfig.purpose}`);
        payloadUpdates.purpose = personaConfig.purpose;
    }
    if (personaConfig.emotion) {
        summary.push(`Tone: ${personaConfig.emotion}`);
        payloadUpdates.emotion = personaConfig.emotion;
    }
    if (personaConfig.urgency) {
        summary.push(`Urgency: ${personaConfig.urgency}`);
        payloadUpdates.urgency = personaConfig.urgency;
    }
    if (personaConfig.technical_level) {
        summary.push(`Technical level: ${personaConfig.technical_level}`);
        payloadUpdates.technical_level = personaConfig.technical_level;
    }

    if (template.voice_model) {
        summary.push(`Voice: ${template.voice_model}`);
    }

    if (filledPrompt) {
        summary.push(`Prompt: ${filledPrompt.substring(0, 120)}${filledPrompt.length > 120 ? '…' : ''}`);
    }
    if (filledFirstMessage) {
        summary.push(`First message: ${filledFirstMessage.substring(0, 120)}${filledFirstMessage.length > 120 ? '…' : ''}`);
    }

    if (Object.keys(placeholderValues).length > 0) {
        summary.push(`Variables: ${Object.entries(placeholderValues).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }

    return {
        payloadUpdates,
        summary
    };
}

async function buildCustomCallConfig(conversation, ctx) {
    const selectedBusiness = await askOptionWithButtons(
        conversation,
        ctx,
        `🎭 *Select service type / persona:*\nTap the option that best matches this call.`,
        BUSINESS_OPTIONS,
        {
            prefix: 'persona',
            columns: 2,
            formatLabel: (option) => (option.custom ? '✍️ Custom Prompt' : option.label)
        }
    );

    const payloadUpdates = {
        channel: 'voice'
    };
    const summary = [];

    if (selectedBusiness.custom) {
        await ctx.reply('✍️ Enter the agent prompt (describe how the AI should behave):');
        const promptMsg = await conversation.wait();
        const prompt = promptMsg?.message?.text?.trim();
        if (!prompt) {
            await ctx.reply('❌ Please provide a valid prompt.');
            return null;
        }

        await ctx.reply('💬 Enter the first message the agent will say:');
        const firstMsg = await conversation.wait();
        const firstMessage = firstMsg?.message?.text?.trim();
        if (!firstMessage) {
            await ctx.reply('❌ Please provide a valid first message.');
            return null;
        }

        payloadUpdates.prompt = prompt;
        payloadUpdates.first_message = firstMessage;
        summary.push('Persona: Custom prompt');
        summary.push(`Prompt: ${prompt.substring(0, 120)}${prompt.length > 120 ? '…' : ''}`);
        summary.push(`First message: ${firstMessage.substring(0, 120)}${firstMessage.length > 120 ? '…' : ''}`);
    } else {
        payloadUpdates.business_id = selectedBusiness.id;

        const availablePurposes = selectedBusiness.purposes || [];
        let selectedPurpose = availablePurposes.find((p) => p.id === selectedBusiness.defaultPurpose) || availablePurposes[0];

        if (availablePurposes.length > 1) {
            selectedPurpose = await askOptionWithButtons(
                conversation,
                ctx,
                `🎯 *Select call purpose:*\nChoose the specific workflow for this call.`,
                availablePurposes,
                {
                    prefix: 'purpose',
                    columns: 1,
                    formatLabel: (option) => `${option.emoji || '•'} ${option.label}`
                }
            );
        }

        selectedPurpose = selectedPurpose || availablePurposes[0];
        if (selectedPurpose?.id && selectedPurpose.id !== 'general') {
            payloadUpdates.purpose = selectedPurpose.id;
        }

        const recommendedEmotion = selectedPurpose?.defaultEmotion || 'neutral';
        const moodSelection = await askOptionWithButtons(
            conversation,
            ctx,
            `🎙️ *Tone preference*\nRecommended: *${recommendedEmotion}*.`,
            MOOD_OPTIONS,
            { prefix: 'tone', columns: 2 }
        );
        if (moodSelection.id !== 'auto') {
            payloadUpdates.emotion = moodSelection.id;
        }

        const recommendedUrgency = selectedPurpose?.defaultUrgency || 'normal';
        const urgencySelection = await askOptionWithButtons(
            conversation,
            ctx,
            `⏱️ *Urgency level*\nRecommended: *${recommendedUrgency}*.`,
            URGENCY_OPTIONS,
            { prefix: 'urgency', columns: 2 }
        );
        if (urgencySelection.id !== 'auto') {
            payloadUpdates.urgency = urgencySelection.id;
        }

        const techSelection = await askOptionWithButtons(
            conversation,
            ctx,
            `🧠 *Caller technical level*\nHow comfortable is the caller with technical details?`,
            TECH_LEVEL_OPTIONS,
            { prefix: 'tech', columns: 2 }
        );
        if (techSelection.id !== 'auto') {
            payloadUpdates.technical_level = techSelection.id;
        }

        summary.push(`Persona: ${selectedBusiness.label}`);
        if (selectedPurpose?.label) {
            summary.push(`Purpose: ${selectedPurpose.label}`);
        }

        const toneSummary = moodSelection.id === 'auto'
            ? `${moodSelection.label} (${getOptionLabel(MOOD_OPTIONS, recommendedEmotion)})`
            : moodSelection.label;
        const urgencySummary = urgencySelection.id === 'auto'
            ? `${urgencySelection.label} (${getOptionLabel(URGENCY_OPTIONS, recommendedUrgency)})`
            : urgencySelection.label;
        const techSummary = techSelection.id === 'auto'
            ? getOptionLabel(TECH_LEVEL_OPTIONS, 'general')
            : techSelection.label;

        summary.push(`Tone: ${toneSummary}`);
        summary.push(`Urgency: ${urgencySummary}`);
        summary.push(`Technical level: ${techSummary}`);
    }

    return {
        payloadUpdates,
        summary
    };
}

async function callFlow(conversation, ctx) {
    try {
        const user = await new Promise((resolve) => getUser(ctx.from.id, resolve));
        if (!user) {
            await ctx.reply('❌ You are not authorized to use this bot.');
            return;
        }

        await ctx.reply('📞 Enter phone number (E.164 format, e.g., +16125151442):');
        const numMsg = await conversation.wait();
        const number = numMsg?.message?.text?.trim();

        if (!number) {
            await ctx.reply('❌ Please provide a phone number.');
            return;
        }

        if (!isValidPhoneNumber(number)) {
            await ctx.reply('❌ Invalid phone number format. Use E.164 format: +16125151442');
            return;
        }

        const configurationMode = await askOptionWithButtons(
            conversation,
            ctx,
            '⚙️ *How would you like to configure this call?*',
            [
                { id: 'template', label: '📁 Use call template' },
                { id: 'custom', label: '🛠️ Build custom persona' }
            ],
            { prefix: 'call-config', columns: 1 }
        );

        let configuration = null;
        if (configurationMode.id === 'template') {
            configuration = await selectCallTemplate(conversation, ctx);
            if (!configuration) {
                await ctx.reply('ℹ️ No template selected. Switching to custom persona builder.');
            }
        }

        if (!configuration) {
            configuration = await buildCustomCallConfig(conversation, ctx);
        }

        if (!configuration) {
            await ctx.reply('❌ Call setup cancelled.');
            return;
        }

        const payload = {
            number,
            user_chat_id: ctx.from.id.toString(),
            ...configuration.payloadUpdates
        };

        const summaryLines = [
            '📋 *Call Details:*',
            '',
            `📞 Number: ${number}`
        ];

        configuration.summary.forEach((line) => summaryLines.push(`• ${line}`));
        summaryLines.push('');
        summaryLines.push('⏳ Making the call...');

        await ctx.reply(summaryLines.join('\n'), { parse_mode: 'Markdown' });

        const payloadForLog = { ...payload };
        if (payloadForLog.prompt) {
            payloadForLog.prompt = `${payloadForLog.prompt.substring(0, 50)}${payloadForLog.prompt.length > 50 ? '…' : ''}`;
        }

        console.log('Sending payload to API:', payloadForLog);

        const response = await axios.post(`${config.apiUrl}/outbound-call`, payload, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        console.log('API Response:', response.data);

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
            errorMsg += `Network Error: Cannot reach API server\nURL: ${config.apiUrl}`;
        } else {
            errorMsg += `Error: ${error.message}`;
        }

        await ctx.reply(errorMsg, { parse_mode: 'Markdown' });
    }
}

function registerCallCommand(bot) {
    bot.command('call', async (ctx) => {
        try {
            console.log(`Call command started by user ${ctx.from?.id || 'unknown'}`);
            await ctx.conversation.enter('call-conversation');
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
