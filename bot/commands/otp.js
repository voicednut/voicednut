const axios = require('axios');
const config = require('../config');
const { getUser } = require('../db/db');
const {
  startOperation,
  ensureOperationActive,
  registerAbortController,
  OperationCancelledError,
  guardAgainstCommandInterrupt,
} = require('../utils/sessionState');
const { askOptionWithButtons } = require('../utils/persona');

const templatesApiBase = config.templatesApiUrl.replace(/\/+$/, '');

function isValidPhoneNumber(number) {
  return /^\+[1-9]\d{1,14}$/.test((number || '').trim());
}

async function safeTemplatesRequest(method, url, options = {}) {
  const endpoint = `${templatesApiBase}${url}`;
  const response = await axios.request({
    method,
    url: endpoint,
    timeout: 12000,
    ...options,
  });
  const contentType = response.headers?.['content-type'] || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Templates API returned non-JSON response');
  }
  if (response.data?.success === false) {
    throw new Error(response.data?.error || 'Templates API reported failure');
  }
  return response.data;
}

async function fetchOtpTemplates() {
  const data = await safeTemplatesRequest('get', '/api/call-templates');
  const templates = data.templates || [];
  return templates.filter((t) => {
    const name = (t.name || '').toLowerCase();
    const desc = (t.description || '').toLowerCase();
    return name.includes('otp') || name.includes('verify') || desc.includes('otp') || desc.includes('verify');
  });
}

async function fetchTemplateDetail(id) {
  const data = await safeTemplatesRequest('get', `/api/call-templates/${id}`);
  return data.template;
}

async function selectOtpTemplate(conversation, ctx, ensureActive) {
  let templates = [];
  try {
    templates = await fetchOtpTemplates();
    ensureActive();
  } catch (error) {
    await ctx.reply(`⚠️ Could not load templates: ${error.message || error}`);
  }

  const options = [];
  if (templates && templates.length > 0) {
    options.push(
      ...(templates || []).slice(0, 10).map((template) => ({
        id: template.id.toString(),
        label: `📄 ${template.name}`,
      }))
    );
    options.push({ id: 'create_new', label: '➕ Add OTP template' });
    options.push({ id: 'custom', label: '✨ Custom script' });
  } else {
    options.push({ id: 'create_new', label: '➕ Add OTP template' });
    options.push({ id: 'custom', label: '✨ Custom script' });
  }

  const selection = await askOptionWithButtons(
    conversation,
    ctx,
    options.length
      ? 'Choose an OTP call template or provide a custom script:'
      : 'No OTP templates found. Use a custom script.',
    options,
    { prefix: 'otp-template', columns: 1 }
  );
  ensureActive();

  if (!selection || selection.id === 'custom') {
    return { template: null };
  }

  const templateId = Number(selection.id);
  if (Number.isNaN(templateId)) {
    return { templateId: selection.id };
  }

  try {
    const template = await fetchTemplateDetail(templateId);
    ensureActive();
    return { template };
  } catch (error) {
    await ctx.reply(`⚠️ Failed to load template details. Using custom script. (${error.message || error})`);
    return { template: null };
  }
}

async function promptForValue(conversation, ctx, prompt, validator, errorMsg, ensureActive) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    await ctx.reply(prompt);
    const update = await conversation.wait();
    ensureActive();
    const text = update?.message?.text?.trim();
    if (text) {
      const interrupted = await guardAgainstCommandInterrupt(ctx, text);
      if (interrupted) {
        continue;
      }
    }
    if (validator(text)) {
      return text.trim();
    }
    await ctx.reply(errorMsg);
  }
}

async function promptForCustomScript(conversation, ctx, ensureActive) {
  await ctx.reply(
    '✏️ Paste the script the bot should use to ask for the OTP. Keep it concise; the model will guide the call.'
  );
  const update = await conversation.wait();
  ensureActive();
  const text = update?.message?.text?.trim();
  if (text) {
    const interrupted = await guardAgainstCommandInterrupt(ctx, text);
    if (interrupted) {
      return null;
    }
  }
  return text || 'You are calling to verify a one-time passcode. Politely ask the user for their OTP.';
}

async function promptForTemplateCreation(conversation, ctx, ensureActive) {
  await ctx.reply('➕ Provide a name for the new OTP template:');
  const nameUpdate = await conversation.wait();
  ensureActive();
  const name = nameUpdate?.message?.text?.trim();
  if (name) {
    const interrupted = await guardAgainstCommandInterrupt(ctx, name);
    if (interrupted) {
      return null;
    }
  }
  if (!name) {
    await ctx.reply('❌ Template name is required. Falling back to custom.');
    return null;
  }

  await ctx.reply('✏️ Paste the script/content for this OTP template (will be used as prompt and first message):');
  const scriptUpdate = await conversation.wait();
  ensureActive();
  const script = scriptUpdate?.message?.text?.trim();
  if (script) {
    const interrupted = await guardAgainstCommandInterrupt(ctx, script);
    if (interrupted) {
      return null;
    }
  }
  if (!script) {
    await ctx.reply('❌ Template content required. Falling back to custom.');
    return null;
  }

  try {
    const resp = await axios.post(
      `${config.templatesApiUrl.replace(/\/+$/, '')}/api/call-templates`,
      {
        name,
        description: 'OTP template created from bot',
        prompt: script,
        first_message: script,
        business_id: config.defaultBusinessId,
        voice_model: config.defaultVoiceModel,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-admin-token': config.admin.apiToken,
        },
        timeout: 15000,
      }
    );
    const template = resp.data?.template;
    if (template) {
      await ctx.reply(`✅ Created OTP template "${template.name}".`);
      return template;
    }
  } catch (error) {
    const detail =
      error.response?.data?.error ||
      error.message ||
      'Unknown error creating template';
    await ctx.reply(`⚠️ Failed to create template: ${detail}`);
  }
  return null;
}

async function otpFlow(conversation, ctx) {
  const user = await new Promise((resolve) => getUser(ctx.from.id, resolve));
  if (!user) {
    await ctx.reply('❌ You are not authorized to use this bot.');
    return;
  }

  startOperation(ctx, 'otp-call');
  const ensureActive = () => {};

  const number = await promptForValue(
    conversation,
    ctx,
    '📞 Enter the destination phone number (E.164, e.g., +1234567890):',
    isValidPhoneNumber,
    '⚠️ Please provide a valid E.164 phone number.',
    ensureActive
  );

  const { template, templateId } = await selectOtpTemplate(conversation, ctx, ensureActive);
  let selectedTemplate = template;

  if (!selectedTemplate && templateId === 'create_new') {
    selectedTemplate = await promptForTemplateCreation(conversation, ctx, ensureActive);
  }

  let prompt = selectedTemplate?.prompt;
  let firstMessage = selectedTemplate?.first_message;
  let templateName = selectedTemplate?.name || 'Custom';
  let businessId = selectedTemplate?.business_id || config.defaultBusinessId;
  const otpDigits = 6;
  if (!template) {
    const customScript = await promptForCustomScript(conversation, ctx, ensureActive);
    prompt = `You are calling to verify a one-time passcode. Follow this script faithfully, sound human, and ask the user for their OTP:\n${customScript}`;
    firstMessage = customScript;
    templateName = 'Custom Script';
  } else if (!prompt && firstMessage) {
    prompt = `You are calling to verify a one-time passcode. Use the provided first message as your opening, then guide the caller to share their OTP. First message:\n${firstMessage}`;
  } else if (!firstMessage && prompt) {
    firstMessage = 'Hello! I’m calling to verify your one-time passcode. Please share the OTP when ready.';
  }

  const payload = {
    number,
    call_type: 'service',
    purpose: 'otp_verification',
    business_function: 'otp_verification',
    template: templateName,
    business_id: businessId,
    prompt,
    first_message: firstMessage,
    voice_model: selectedTemplate?.voice_model || config.defaultVoiceModel,
    channel: 'voice',
    collect_digits: otpDigits,
    input_sequence: [
      {
        stage: 'OTP',
        label: 'One-Time Passcode',
        numDigits: otpDigits,
        pattern: '^\\d+$',
        successMessage: 'Thanks, that looks good.',
        failureMessage: 'That did not look like an OTP. Please try again.',
      },
    ],
    metadata_json: JSON.stringify({
      enable_structured_inputs: true,
      otp_mode: true,
      otp_prompt: 'Please share the one-time passcode you received.',
      otp_template: templateName,
      business_id: businessId,
      default_digit_length: otpDigits,
      otp_length: otpDigits,
      input_sequence: [
        {
          stage: 'OTP',
          label: 'One-Time Passcode',
          numDigits: otpDigits,
          pattern: '^\\d+$',
        },
      ],
    }),
  };

  await ctx.reply(
    [
      '🪪 OTP Call Summary:',
      `• Number: ${number}`,
      `• Template: ${templateName}`,
    ].join('\n')
  );
  await ctx.reply('⏳ Placing the OTP call…');

  const controller = new AbortController();
  const release = registerAbortController(ctx, controller);
  try {
    const response = await axios.post(`${config.apiUrl}/outbound-call`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
      signal: controller.signal,
    });
    ensureActive();

    if (response.data?.success && response.data.call_sid) {
      await ctx.reply(
        [
          '✅ OTP call placed.',
          `📞 To: ${response.data.to}`,
          `🆔 Call SID: \`${response.data.call_sid}\``,
          `📊 Status: ${response.data.status || 'initiated'}`,
        ].join('\n'),
        { parse_mode: 'Markdown' }
      );
      flow.touch('completed');
    } else {
      await ctx.reply('⚠️ OTP call sent but response was unexpected. Check logs.');
    }
  } catch (error) {
    if (error instanceof OperationCancelledError || error?.name === 'AbortError' || error?.name === 'CanceledError') {
      return;
    }
    const detail =
      error.response?.data?.error ||
      error.response?.statusText ||
      error.message ||
      'Unknown error';
    await ctx.reply(`❌ Failed to place OTP call: ${detail}`);
  } finally {
    release();
  }
}

function registerOtpCommand(bot) {
  bot.command('otp', async (ctx) => {
    await ctx.conversation.enter('otp-flow');
  });
}

module.exports = {
  otpFlow,
  registerOtpCommand,
};
