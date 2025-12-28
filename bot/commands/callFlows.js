const axios = require('axios');
const config = require('../config');
const { getUser, setWizardCallSid, clearWizardState } = require('../db/db');
const {
  startOperation,
  ensureOperationActive,
  registerAbortController,
  guardAgainstCommandInterrupt,
  OperationCancelledError
} = require('../utils/sessionState');
const { askOptionWithButtons } = require('../utils/persona');
const { extractTemplateVariables } = require('../utils/templates');

const templatesApiBase = config.templatesApiUrl.replace(/\/+$/, '');

function isValidPhoneNumber(number) {
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test((number || '').trim());
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

async function fetchCallTemplates() {
  const data = await safeTemplatesRequest('get', '/api/call-templates');
  return data.templates || [];
}

async function fetchTemplateDetail(id) {
  const data = await safeTemplatesRequest('get', `/api/call-templates/${id}`);
  return data.template;
}

async function collectPlaceholderValues(conversation, ctx, placeholders, ensureActive) {
  const values = {};
  for (const placeholder of placeholders) {
    await ctx.reply(`✏️ Enter value for *${placeholder}* (type skip to leave unchanged):`, { parse_mode: 'Markdown' });
    const update = await conversation.wait();
    ensureActive();
    const text = update?.message?.text?.trim();
    if (text) {
      await guardAgainstCommandInterrupt(ctx, text);
    }
    if (!text || text.toLowerCase() === 'skip') {
      continue;
    }
    values[placeholder] = text;
  }
  return values;
}

async function selectOtpTemplate(conversation, ctx, ensureActive) {
  let templates = [];
  try {
    templates = await fetchCallTemplates();
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
      await guardAgainstCommandInterrupt(ctx, text);
    }
    if (validator(text)) {
      return text.trim();
    }
    await ctx.reply(errorMsg);
  }
}

async function otpFlow(conversation, ctx) {
  const user = await new Promise((resolve) => getUser(ctx.from.id, resolve));
  if (!user) {
    await ctx.reply('❌ You are not authorized to use this bot.');
    return;
  }

  const opId = startOperation(ctx, 'otp-call');
  const ensureActive = () => ensureOperationActive(ctx, opId);

  const number = await promptForValue(
    conversation,
    ctx,
    '📞 Enter the destination phone number (E.164, e.g., +1234567890):',
    isValidPhoneNumber,
    '⚠️ Please provide a valid E.164 phone number.',
    ensureActive
  );

  const templateChoice = await selectOtpTemplate(conversation, ctx, ensureActive);

  let script = null;
  let templateName = 'Custom';
  if (templateChoice.template) {
    script = templateChoice.template.prompt || templateChoice.template.first_message;
    templateName = templateChoice.template.name || 'Template';
  }

  if (!script) {
    await ctx.reply('✏️ Paste the script/prompt to use for this OTP verification call:');
    const scriptUpdate = await conversation.wait();
    ensureActive();
    script = scriptUpdate?.message?.text?.trim();
    if (script) {
      await guardAgainstCommandInterrupt(ctx, script);
    }
  }

  const placeholders = extractTemplateVariables(script || '');
  let values = {};
  if (placeholders.length > 0) {
    values = await collectPlaceholderValues(conversation, ctx, placeholders, ensureActive);
    ensureActive();
  }

  const codeLength = await promptForValue(
    conversation,
    ctx,
    '🔢 Enter expected OTP length (e.g., 6):',
    (v) => !!v && /^\d+$/.test(v),
    '⚠️ Please provide a numeric length.',
    ensureActive
  );

  const maxAttempts = await promptForValue(
    conversation,
    ctx,
    '🔁 Enter max attempts before failing (e.g., 3):',
    (v) => !!v && /^\d+$/.test(v),
    '⚠️ Please provide a numeric value.',
    ensureActive
  );

  const filledScript = Object.entries(values || {}).reduce((acc, [key, value]) => {
    const pattern = new RegExp(`{${key}}`, 'g');
    return acc.replace(pattern, value);
  }, script || '');

  const payload = {
    number,
    user_chat_id: ctx.from.id.toString(),
    telegram_chat_id: ctx.chat.id.toString(),
    call_type: 'collect_input',
    purpose: 'otp_verification',
    business_function: 'otp_verification',
    template: templateName,
    business_id: config.defaultBusinessId,
    prompt: filledScript,
    first_message: filledScript,
    voice_model: config.defaultVoiceModel,
    channel: 'voice',
    collect_digits: Number(codeLength),
    max_dtmf_attempts: Number(maxAttempts),
    input_sequence: [
      { stage: 'OTP', label: 'Verification code', numDigits: Number(codeLength), pattern: `^\\d{${codeLength}}$` },
    ],
    requires_input: 1,
    has_transcript: 1,
    has_recording: 1,
  };

  await ctx.reply(
    [
      '🧾 OTP Call Summary:',
      `• Number: ${number}`,
      `• Template: ${templateName}`,
      `• Expected digits: ${codeLength}`,
      `• Max attempts: ${maxAttempts}`,
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
      if (ctx.session?.wizardCategory) {
        await setWizardCallSid(ctx.from.id, ctx.chat.id, response.data.call_sid);
        await clearWizardState(ctx.from.id, ctx.chat.id);
        delete ctx.session.wizardCategory;
        delete ctx.session.wizardCardMode;
      }
    } else {
      await ctx.reply('⚠️ Call sent but response was unexpected. Check logs.');
    }
  } catch (error) {
    if (error instanceof OperationCancelledError) {
      await ctx.reply('⚠️ OTP call cancelled.');
      return;
    }
    
    if (error.response) {
      const status = error.response.status;
      const apiError = (error.response.data?.error || '').toString();
      
      if (apiError.includes('Invalid phone number format')) {
        await ctx.reply('❌ Invalid phone number format. Please use E.164 format (e.g., +1234567890).');
      } else if (apiError.includes('Missing required field')) {
        await ctx.reply('❌ Missing required information for OTP call. Please provide all details.');
      } else if (status === 400) {
        await ctx.reply(`❌ Invalid request: ${apiError || 'Check the provided details and try again.'}`);
      } else if (status === 401) {
        await ctx.reply('❌ Authentication failed. Your API credentials may be invalid.');
      } else if (status === 404) {
        await ctx.reply('❌ Resource not found. The service may no longer exist.');
      } else if (status === 429) {
        await ctx.reply('⚠️ Too many requests. Please wait a moment before trying again.');
      } else if (status === 500) {
        await ctx.reply('❌ Server error occurred. Please try again or contact support.');
      } else if (status === 503) {
        await ctx.reply('⚠️ Service temporarily unavailable. Please try again shortly.');
      } else {
        await ctx.reply(`❌ Failed to place OTP call (Error ${status}): ${apiError || 'Unknown error'}`);
      }
    } else if (error.request) {
      await ctx.reply('🔄 Network error: Could not reach the server. Please check your connection.');
    } else {
      await ctx.reply(`❌ Unexpected error: ${error.message}. Please try again.`);
    }
  } finally {
    release();
  }
}

async function paymentFlow(conversation, ctx) {
  const user = await new Promise((resolve) => getUser(ctx.from.id, resolve));
  if (!user) {
    await ctx.reply('❌ You are not authorized to use this bot.');
    return;
  }

  const opId = startOperation(ctx, 'payment-call');
  const ensureActive = () => ensureOperationActive(ctx, opId);

  const number = await promptForValue(
    conversation,
    ctx,
    '📞 Enter the destination phone number (E.164, e.g., +1234567890):',
    isValidPhoneNumber,
    '⚠️ Please provide a valid E.164 phone number.',
    ensureActive
  );

  const amount = await promptForValue(
    conversation,
    ctx,
    '💵 Enter the amount due (e.g., 149.99):',
    (v) => !!v && !Number.isNaN(Number(v)),
    '⚠️ Please provide a numeric amount.',
    ensureActive
  );

  await ctx.reply('🔗 Paste a payment link (optional). Type skip to omit.');
  const linkUpdate = await conversation.wait();
  ensureActive();
  let paymentLink = linkUpdate?.message?.text?.trim() || '';
  if (paymentLink) {
    await guardAgainstCommandInterrupt(ctx, paymentLink);
  }
  if (paymentLink.toLowerCase() === 'skip') {
    paymentLink = '';
  }

  const collectCardChoice = await askOptionWithButtons(
    conversation,
    ctx,
    'Do you want to collect card last 4 via keypad?',
    [
      { id: 'yes', label: '✅ Yes' },
      { id: 'no', label: '❌ No' },
    ],
    { prefix: 'collect-card', columns: 2, ensureActive }
  );
  const collectCard = ctx.session?.wizardCardMode ? true : collectCardChoice?.id === 'yes';

  const prompt = [
    'You are calling to collect a payment over the phone.',
    `Amount due: $${Number(amount).toFixed(2)}.`,
    paymentLink ? `Offer to send or reference this payment link: ${paymentLink}.` : 'If no link is provided, ask to pay now or send a link later.',
    collectCard
      ? 'If the caller prefers, ask for the card last 4 digits and billing ZIP via keypad, confirm politely, and proceed.'
      : 'Avoid asking for card digits; keep it conversational and offer to pay via link.',
    'Be concise, human, and guide the caller step by step.',
  ].join(' ');

  const firstMessage = `Hi! I’m calling about your payment of $${Number(amount).toFixed(2)}. I can help you complete it now${paymentLink ? ' or share a secure link' : ''}. How would you like to proceed?`;

  const metadata = {
    payment_mode: true,
    payment_amount: Number(amount),
    payment_link: paymentLink || undefined,
    enable_structured_inputs: collectCard,
    input_sequence: collectCard
      ? [
          { stage: 'CARD_LAST4', label: 'Card Last 4', numDigits: 4, pattern: '^\\d{4}$' },
          { stage: 'ZIP', label: 'Billing ZIP', numDigits: 5, pattern: '^\\d{5}$' },
        ]
      : [],
  };

  const payload = {
    number,
    user_chat_id: ctx.from.id.toString(),
    telegram_chat_id: ctx.chat.id.toString(),
    call_type: collectCard ? 'collect_input' : 'service',
    purpose: 'payment_collection',
    business_function: 'payment_collection',
    template: 'Payment Collection',
    business_id: config.defaultBusinessId,
    prompt,
    first_message: firstMessage,
    voice_model: config.defaultVoiceModel,
    channel: 'voice',
    collect_digits: collectCard ? 4 : undefined,
    input_sequence: metadata.input_sequence,
    metadata_json: JSON.stringify(metadata),
    requires_input: collectCard ? 1 : 0,
    has_transcript: 1,
    has_recording: 1,
  };

  await ctx.reply(
    [
      '🧾 Payment Call Summary:',
      `• Number: ${number}`,
      `• Amount: $${Number(amount).toFixed(2)}`,
      `• Payment link: ${paymentLink || 'not provided'}`,
      `• Collect card via DTMF: ${collectCard ? 'Yes' : 'No'}`,
    ].join('\n')
  );
  await ctx.reply('⏳ Placing the payment call…');

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
          '✅ Payment call placed.',
          `📞 To: ${response.data.to}`,
          `🆔 Call SID: \`${response.data.call_sid}\``,
          `📊 Status: ${response.data.status || 'initiated'}`,
        ].join('\n'),
        { parse_mode: 'Markdown' }
      );
      if (ctx.session?.wizardCategory) {
        await setWizardCallSid(ctx.from.id, ctx.chat.id, response.data.call_sid);
        await clearWizardState(ctx.from.id, ctx.chat.id);
        delete ctx.session.wizardCategory;
        delete ctx.session.wizardCardMode;
      }
    } else {
      await ctx.reply('⚠️ Payment call sent but response was unexpected. Check logs.');
    }
  } catch (error) {
    if (error.response) {
      const status = error.response.status;
      const apiError = (error.response.data?.error || '').toString();
      
      if (apiError.includes('Invalid phone number format')) {
        await ctx.reply('❌ Invalid phone number format. Please use E.164 format (e.g., +1234567890).');
      } else if (apiError.includes('Missing required field')) {
        await ctx.reply('❌ Missing required information for payment call. Please provide all details.');
      } else if (status === 400) {
        await ctx.reply(`❌ Invalid request: ${apiError || 'Check the provided details and try again.'}`);
      } else if (status === 401) {
        await ctx.reply('❌ Authentication failed. Your API credentials may be invalid.');
      } else if (status === 404) {
        await ctx.reply('❌ Resource not found. The service may no longer exist.');
      } else if (status === 429) {
        await ctx.reply('⚠️ Too many requests. Please wait a moment before trying again.');
      } else if (status === 500) {
        await ctx.reply('❌ Server error occurred. Please try again or contact support.');
      } else if (status === 503) {
        await ctx.reply('⚠️ Service temporarily unavailable. Please try again shortly.');
      } else {
        await ctx.reply(`❌ Failed to place payment call (Error ${status}): ${apiError || 'Unknown error'}`);
      }
    } else if (error.request) {
      await ctx.reply('🔄 Network error: Could not reach the server. Please check your connection.');
    } else {
      await ctx.reply(`❌ Unexpected error: ${error.message}. Please try again.`);
    }
  } finally {
    release();
  }
}

module.exports = {
  otpFlow,
  paymentFlow,
};
