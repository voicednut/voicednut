const axios = require('axios');
const { InlineKeyboard } = require('grammy');
const { conversations, createConversation } = require('@grammyjs/conversations');

// Simple inline-button selector to replace missing conversation.select helper
async function selectFromOptions(conversation, ctx, prompt, options = [], { columns = 2, prefix = 'campaign_sel' } = {}) {
  const uniquePrefix = `${prefix}:${Math.random().toString(36).slice(2, 8)}`;
  const keyboard = new InlineKeyboard();
  options.forEach((option, idx) => {
    keyboard.text(option.text, `${uniquePrefix}:${option.payload}`);
    if ((idx + 1) % columns === 0) {
      keyboard.row();
    }
  });

  const sent = await ctx.reply(prompt, { reply_markup: keyboard });

  const selectionCtx = await conversation.waitFor('callback_query', (cbCtx) => {
    const data = cbCtx.callbackQuery?.data;
    return Boolean(data && data.startsWith(`${uniquePrefix}:`));
  });

  await selectionCtx.answerCallbackQuery();
  try {
    await ctx.api.editMessageReplyMarkup(sent.chat.id, sent.message_id);
  } catch (error) {
    // best-effort cleanup; ignore failures if message already edited/deleted
  }

  const data = selectionCtx.callbackQuery.data || '';
  return data.split(':').pop();
}

/**
 * Campaign Management Command for Telegram
 * Allows users to create, manage, and monitor outbound call campaigns
 */

async function campaignFlow(conversation, ctx) {
  try {
    // Main menu
    const choice = await selectFromOptions(
      conversation,
      ctx,
      '📞 Campaign Manager\n\nWhat would you like to do?',
      [
        { text: '🚀 Create New Campaign', payload: 'create' },
        { text: '📊 View Active Campaigns', payload: 'list' },
        { text: '📈 Campaign Analytics', payload: 'analytics' },
        { text: '📵 DNC Management', payload: 'dnc' },
        { text: '⬅️ Back', payload: 'back' }
      ]
    );

    if (choice === 'back') return;

    switch (choice) {
      case 'create':
        await createCampaignFlow(conversation, ctx);
        break;
      case 'list':
        await listCampaignsFlow(conversation, ctx);
        break;
      case 'analytics':
        await analyticsFlow(conversation, ctx);
        break;
      case 'dnc':
        await dncManagementFlow(conversation, ctx);
        break;
    }
  } catch (error) {
    console.error('❌ Campaign flow error:', error);
    await ctx.reply(`Error: ${error.message}`);
  }
}

async function createCampaignFlow(conversation, ctx) {
  try {
    // Campaign name
    await ctx.reply('📝 Campaign Details\n\nWhat should we name this campaign?');
    const nameMessage = await conversation.wait();
    const campaignName = nameMessage.message?.text;
    if (!campaignName) {
      await ctx.reply('❌ Invalid input');
      return;
    }

    // Campaign description
    await ctx.reply('📄 Add a description (optional, press /skip to skip):');
    const descMessage = await conversation.wait();
    const description = descMessage.message?.text === '/skip' ? '' : descMessage.message?.text;

    // Select persona/template
    await ctx.reply('🎭 Select Persona:');
    const persona = await selectFromOptions(
      conversation,
      ctx,
      'Which persona for this campaign?',
      [
        { text: '💼 Sales', payload: 'sales' },
        { text: '🏥 Healthcare', payload: 'healthcare' },
        { text: '💰 Finance', payload: 'finance' },
        { text: '🛒 Retail', payload: 'retail' },
        { text: '🏨 Hospitality', payload: 'hospitality' },
        { text: '⚙️ Tech Support', payload: 'tech_support' }
      ]
    );

    // Call frequency
    const frequency = await selectFromOptions(
      conversation,
      ctx,
      'How often should we dial?',
      [
        { text: '🐢 Conservative (0.5 calls/sec)', payload: 'conservative' },
        { text: '⚙️ Normal (1 call/sec)', payload: 'normal' },
        { text: '🚀 Aggressive (2 calls/sec)', payload: 'aggressive' }
      ]
    );

    const frequencyMap = { conservative: 0.5, normal: 1.0, aggressive: 2.0 };

    // Voicemail detection
    const vmDetection = await selectFromOptions(
      conversation,
      ctx,
      'Enable voicemail detection?',
      [
        { text: '✅ Yes', payload: '1' },
        { text: '❌ No', payload: '0' }
      ]
    );

    // DNC filtering
    const dncFilter = await selectFromOptions(
      conversation,
      ctx,
      'Filter against Do-Not-Call registry?',
      [
        { text: '✅ Yes (Recommended)', payload: '1' },
        { text: '❌ No', payload: '0' }
      ]
    );

    // Create campaign API call
    await ctx.reply('⏳ Creating campaign...');

    const apiUrl = process.env.API_URL || 'http://localhost:3001';
    const response = await axios.post(`${apiUrl}/api/campaigns`, {
      businessId: ctx.session?.businessId || 'default',
      userChatId: ctx.chat.id.toString(),
      name: campaignName,
      description,
      persona,
      callFrequency: frequency,
      maxCallsPerSecond: frequencyMap[frequency],
      voicemailDetection: vmDetection === '1',
      doNotCallFilter: dncFilter === '1'
    });

    if (response.data.success) {
      const campaignId = response.data.campaign.campaignId;
      
      await ctx.reply(
        `✅ Campaign Created!\n\n` +
        `📋 ID: \`${campaignId}\`\n` +
        `📝 Name: ${campaignName}\n` +
        `🎭 Persona: ${persona}\n` +
        `⚡ Frequency: ${frequency}\n\n` +
        `Next: Upload contact list`,
        { parse_mode: 'Markdown' }
      );

      // Offer to upload contacts
      const uploadContacts = await selectFromOptions(
        conversation,
        ctx,
        'Upload contact list now?',
        [
          { text: '✅ Yes', payload: 'yes' },
          { text: '⏸️ Later', payload: 'later' }
        ]
      );

      if (uploadContacts === 'yes') {
        await uploadContactsFlow(conversation, ctx, campaignId);
      }
    }
  } catch (error) {
    console.error('❌ Create campaign error:', error);
    await ctx.reply(`❌ Failed to create campaign: ${error.message}`);
  }
}

async function uploadContactsFlow(conversation, ctx, campaignId) {
  try {
    await ctx.reply(
      '📱 Upload Contact List\n\n' +
      'Send a JSON file or text with contacts.\n\n' +
      'Format:\n' +
      '```json\n' +
      '[\n' +
      '  {"phoneNumber": "+1234567890", "name": "John", "segment": "vip"},\n' +
      '  {"phoneNumber": "+0987654321", "name": "Jane", "segment": "regular"}\n' +
      ']\n' +
      '```',
      { parse_mode: 'Markdown' }
    );

    const contactMsg = await conversation.wait();
    const contactText = contactMsg.message?.text;

    if (!contactText) {
      await ctx.reply('❌ Invalid input');
      return;
    }

    // Parse JSON
    let contacts;
    try {
      contacts = JSON.parse(contactText);
    } catch {
      await ctx.reply('❌ Invalid JSON format');
      return;
    }

    if (!Array.isArray(contacts)) {
      await ctx.reply('❌ Must be an array of contacts');
      return;
    }

    // Validate and add contacts
    await ctx.reply(`⏳ Validating ${contacts.length} contacts...`);

    const apiUrl = process.env.API_URL || 'http://localhost:3001';

    // Validate against DNC
    const validateResponse = await axios.post(
      `${apiUrl}/api/campaigns/${campaignId}/contacts/validate`,
      { contacts }
    );

    const { allowed, blocked } = validateResponse.data;

    await ctx.reply(
      `✅ Validation Complete\n\n` +
      `✅ Allowed: ${allowed.length}\n` +
      `📵 DNC Blocked: ${blocked.length}\n\n` +
      `${blocked.length > 0 ? '⚠️ ' + blocked.length + ' numbers are on DNC list\n' : ''}` +
      `Proceed with upload?`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Add All Allowed', callback_data: `campaign:add_contacts:${campaignId}:all` },
              { text: '❌ Cancel', callback_data: 'campaign:cancel' }
            ]
          ]
        }
      }
    );
  } catch (error) {
    console.error('❌ Upload contacts error:', error);
    await ctx.reply(`❌ Failed to upload contacts: ${error.message}`);
  }
}

async function listCampaignsFlow(conversation, ctx) {
  try {
    const apiUrl = process.env.API_URL || 'http://localhost:3001';
    const businessId = ctx.session?.businessId || 'default';

    const response = await axios.get(`${apiUrl}/api/campaigns/business/${businessId}`);
    const campaigns = response.data.campaigns || [];

    if (campaigns.length === 0) {
      await ctx.reply('📭 No campaigns found');
      return;
    }

    let message = '📊 Your Campaigns\n\n';
    let keyboard = [];

    campaigns.forEach((campaign, idx) => {
      const status = campaign.status || 'draft';
      const statusEmoji = {
        draft: '📝',
        active: '🟢',
        paused: '⏸️',
        completed: '✅',
        cancelled: '❌'
      }[status] || '❓';

      message += `${statusEmoji} **${campaign.name}**\n`;
      message += `Status: ${status}\n`;
      message += `Persona: ${campaign.persona}\n`;
      message += `Created: ${new Date(campaign.created_at).toLocaleDateString()}\n\n`;

      keyboard.push([
        { text: `📊 ${campaign.name}`, callback_data: `campaign:view:${campaign.campaign_id}` }
      ]);
    });

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  } catch (error) {
    console.error('❌ List campaigns error:', error);
    await ctx.reply(`❌ Failed to list campaigns: ${error.message}`);
  }
}

async function analyticsFlow(conversation, ctx) {
  try {
    const apiUrl = process.env.API_URL || 'http://localhost:3001';

    // Get list of campaigns first
    const businessId = ctx.session?.businessId || 'default';
    const response = await axios.get(`${apiUrl}/api/campaigns/business/${businessId}`);
    const campaigns = response.data.campaigns || [];

    if (campaigns.length === 0) {
      await ctx.reply('📭 No campaigns found');
      return;
    }

    // Build selection keyboard
    const campaignOptions = campaigns.map(c => ({
      text: `📊 ${c.name}`,
      payload: c.campaign_id
    }));

    const campaignId = await selectFromOptions(
      conversation,
      ctx,
      'Select campaign for analytics:',
      campaignOptions
    );

    // Fetch analytics
    await ctx.reply('⏳ Loading analytics...');

    const analyticsResponse = await axios.get(
      `${apiUrl}/api/campaigns/${campaignId}/analytics?days=7`
    );

    const { summary, breakdown } = analyticsResponse.data;

    let message = `📈 Campaign Analytics (Last 7 Days)\n\n`;
    message += `📞 Total Dialed: ${summary.totalCalls}\n`;
    message += `✅ Conversions: ${summary.conversions}\n`;
    message += `📊 Conversion Rate: ${summary.conversionRate}%\n`;
    message += `⏱️ Avg Duration: ${summary.avgDuration}s\n\n`;

    if (breakdown.byOutcome && breakdown.byOutcome.length > 0) {
      message += `📊 By Outcome:\n`;
      breakdown.byOutcome.forEach(item => {
        message += `  • ${item.outcome}: ${item.count}\n`;
      });
    }

    await ctx.reply(message);
  } catch (error) {
    console.error('❌ Analytics error:', error);
    await ctx.reply(`❌ Failed to load analytics: ${error.message}`);
  }
}

async function dncManagementFlow(conversation, ctx) {
  try {
    const dncChoice = await selectFromOptions(
      conversation,
      ctx,
      '📵 DNC Management',
      [
        { text: '📊 View DNC Stats', payload: 'stats' },
        { text: '➕ Add Number', payload: 'add' },
        { text: '📤 Import List', payload: 'import' },
        { text: '⬅️ Back', payload: 'back' }
      ]
    );

    if (dncChoice === 'back') return;

    const apiUrl = process.env.API_URL || 'http://localhost:3001';

    switch (dncChoice) {
      case 'stats':
        const statsResponse = await axios.get(`${apiUrl}/api/dnc/stats`);
        const stats = statsResponse.data;

        let statsMessage = `📵 DNC Registry Statistics\n\n`;
        statsMessage += `📊 Total Numbers: ${stats.total}\n`;
        statsMessage += `🔒 Permanent: ${stats.permanent}\n`;
        statsMessage += `⏰ Temporary: ${stats.temporary}\n\n`;

        if (Object.keys(stats.byReason || {}).length > 0) {
          statsMessage += `By Reason:\n`;
          Object.entries(stats.byReason).forEach(([reason, count]) => {
            statsMessage += `  • ${reason}: ${count}\n`;
          });
        }

        await ctx.reply(statsMessage);
        break;

      case 'add':
        await ctx.reply('📱 Enter phone number to add to DNC:');
        const phoneMsg = await conversation.wait();
        const phoneNumber = phoneMsg.message?.text;

        if (!phoneNumber) {
          await ctx.reply('❌ Invalid input');
          return;
        }

        await ctx.reply('📝 Enter reason:');
        const reasonMsg = await conversation.wait();
        const reason = reasonMsg.message?.text || 'manual_request';

        await axios.post(`${apiUrl}/api/dnc/add`, {
          phoneNumber,
          reason,
          source: 'manual'
        });

        await ctx.reply(`✅ Added ${phoneNumber} to DNC list (Reason: ${reason})`);
        break;

      case 'import':
        await ctx.reply(
          '📤 Import DNC List\n\n' +
          'Send JSON array of phone numbers:\n' +
          '```json\n' +
          '["+1234567890", "+0987654321"]\n' +
          '```',
          { parse_mode: 'Markdown' }
        );

        const importMsg = await conversation.wait();
        const importText = importMsg.message?.text;

        if (!importText) {
          await ctx.reply('❌ Invalid input');
          return;
        }

        let phoneNumbers;
        try {
          phoneNumbers = JSON.parse(importText);
        } catch {
          await ctx.reply('❌ Invalid JSON format');
          return;
        }

        if (!Array.isArray(phoneNumbers)) {
          await ctx.reply('❌ Must be an array');
          return;
        }

        const importResponse = await axios.post(`${apiUrl}/api/dnc/import`, {
          phoneNumbers,
          source: 'manual_import',
          reason: 'user_request'
        });

        await ctx.reply(
          `✅ Import Complete\n\n` +
          `➕ Added: ${importResponse.data.added}\n` +
          `⚠️ Duplicates: ${importResponse.data.duplicates}`
        );
        break;
    }
  } catch (error) {
    console.error('❌ DNC management error:', error);
    await ctx.reply(`❌ Error: ${error.message}`);
  }
}

function registerCampaignCommand(bot, allowedChatIds = new Set()) {
  // Register campaign conversation
  bot.use(conversations());
  bot.use(createConversation(campaignFlow, 'campaign_flow'));

  // Register campaign command
  bot.command('campaign', async (ctx) => {
    try {
      // Check if user is authorized
      if (!allowedChatIds.has(ctx.chat.id.toString())) {
        return ctx.reply('❌ You do not have permission to use this command');
      }

      await ctx.conversation.enter('campaign_flow');
    } catch (error) {
      console.error('❌ Campaign command error:', error);
      await ctx.reply(`❌ Error: ${error.message}`);
    }
  });

  // Handle campaign callbacks
  bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;

    if (data.startsWith('campaign:')) {
      const [action, subaction, campaignId] = data.split(':');

      try {
        const apiUrl = process.env.API_URL || 'http://localhost:3001';

        switch (subaction) {
          case 'view':
            const campaign = await axios.get(`${apiUrl}/api/campaigns/${campaignId}`);
            const campaignData = campaign.data.campaign;

            let viewMessage = `📊 Campaign: ${campaignData.name}\n\n`;
            viewMessage += `Status: ${campaignData.status}\n`;
            viewMessage += `Persona: ${campaignData.persona}\n`;
            viewMessage += `Frequency: ${campaignData.call_frequency}\n`;
            viewMessage += `Created: ${new Date(campaignData.created_at).toLocaleDateString()}\n`;

            const buttons = [];
            if (campaignData.status === 'draft') {
              buttons.push(
                { text: '🚀 Start Campaign', callback_data: `campaign:start:${campaignId}` }
              );
            } else if (campaignData.status === 'active') {
              buttons.push(
                { text: '⏸️ Pause', callback_data: `campaign:pause:${campaignId}` }
              );
            }
            buttons.push(
              { text: '📊 Analytics', callback_data: `campaign:analytics:${campaignId}` }
            );

            await ctx.editMessageText(viewMessage, {
              reply_markup: {
                inline_keyboard: [buttons]
              }
            });
            break;

          case 'start':
            await axios.post(`${apiUrl}/api/campaigns/${campaignId}/start`);
            await ctx.answerCallbackQuery('✅ Campaign started!', { show_alert: true });
            break;

          case 'pause':
            await axios.post(`${apiUrl}/api/campaigns/${campaignId}/pause`);
            await ctx.answerCallbackQuery('⏸️ Campaign paused', { show_alert: true });
            break;

          case 'analytics':
            const analytics = await axios.get(`${apiUrl}/api/campaigns/${campaignId}/analytics`);
            const summary = analytics.data.summary;

            let analyticsMsg = `📈 Campaign Analytics\n\n`;
            analyticsMsg += `📞 Dialed: ${summary.totalCalls}\n`;
            analyticsMsg += `✅ Conversions: ${summary.conversions}\n`;
            analyticsMsg += `📊 Rate: ${summary.conversionRate}%\n`;
            analyticsMsg += `⏱️ Avg: ${summary.avgDuration}s`;

            await ctx.editMessageText(analyticsMsg);
            break;
        }
      } catch (error) {
        await ctx.answerCallbackQuery(`❌ Error: ${error.message}`, { show_alert: true });
      }
    }
  });

  console.log('✅ Campaign command registered'.green);
}

module.exports = {
  campaignFlow,
  registerCampaignCommand
};
