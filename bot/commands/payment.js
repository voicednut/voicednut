const axios = require('axios');
const config = require('../config');
const { getUser } = require('../db/db');
const {
  startOperation,
  ensureOperationActive,
  registerAbortController,
  guardAgainstCommandInterrupt,
} = require('../utils/sessionState');
const { askOptionWithButtons } = require('../utils/persona');

function isValidPhoneNumber(number) {
  const e164 = /^\+[1-9]\d{1,14}$/;
  return e164.test((number || '').trim());
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
    const interrupted = await guardAgainstCommandInterrupt(ctx, paymentLink);
    if (interrupted) {
      return;
    }
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
  const collectCard = collectCardChoice?.id === 'yes';

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
    } else {
      await ctx.reply('⚠️ Payment call sent but response was unexpected. Check logs.');
    }
  } catch (error) {
    const detail =
      error.response?.data?.error ||
      error.response?.statusText ||
      error.message ||
      'Unknown error';
    await ctx.reply(`❌ Failed to place payment call: ${detail}`);
  } finally {
    release();
  }
}

function registerPaymentCommand(bot) {
  bot.command('payment', async (ctx) => {
    await ctx.reply('Starting payment call process…');
    await ctx.conversation.enter('payment-flow');
  });
}

module.exports = {
  paymentFlow,
  registerPaymentCommand,
};
