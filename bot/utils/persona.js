const { InlineKeyboard } = require('grammy');

const BUSINESS_OPTIONS = [
  {
    id: 'technical_support',
    label: 'Technical Support',
    description: 'Installation help, troubleshooting, escalations',
    purposes: [
      { id: 'technical_support', label: 'Technical Support Call', emoji: '🛠️', defaultEmotion: 'confused', defaultUrgency: 'normal' },
      { id: 'service_recovery', label: 'Service Recovery Follow-up', emoji: '♻️', defaultEmotion: 'frustrated', defaultUrgency: 'high' },
    ],
    defaultPurpose: 'technical_support',
  },
  {
    id: 'dental_clinic',
    label: 'Healthcare – Dental',
    description: 'Appointment reminders, rescheduling, treatment questions',
    purposes: [
      { id: 'appointment_reminder', label: 'Appointment Reminder', emoji: '🗓️', defaultEmotion: 'neutral', defaultUrgency: 'normal' },
      { id: 'service_recovery', label: 'Service Recovery Call', emoji: '💬', defaultEmotion: 'frustrated', defaultUrgency: 'normal' },
    ],
    defaultPurpose: 'appointment_reminder',
  },
  {
    id: 'finance_alerts',
    label: 'Finance – Payments & Security',
    description: 'Payment issues, fraud alerts, verification',
    purposes: [
      { id: 'payment_issue', label: 'Payment Issue Follow-up', emoji: '💳', defaultEmotion: 'frustrated', defaultUrgency: 'high' },
      { id: 'emergency_response', label: 'Urgent Security Alert', emoji: '🚨', defaultEmotion: 'urgent', defaultUrgency: 'critical' },
    ],
    defaultPurpose: 'payment_issue',
  },
  {
    id: 'hospitality',
    label: 'Hospitality – Guest Experience',
    description: 'Concierge support, recovery, satisfaction outreach',
    purposes: [
      { id: 'service_recovery', label: 'Service Recovery Call', emoji: '🏨', defaultEmotion: 'stressed', defaultUrgency: 'normal' },
      { id: 'general', label: 'General Concierge Support', emoji: '🤵', defaultEmotion: 'positive', defaultUrgency: 'low' },
    ],
    defaultPurpose: 'service_recovery',
  },
  {
    id: 'education_support',
    label: 'Education – Course Support',
    description: 'Student success coaching, lesson walkthroughs',
    purposes: [
      { id: 'education_support', label: 'Course Support Call', emoji: '📚', defaultEmotion: 'confused', defaultUrgency: 'normal' },
    ],
    defaultPurpose: 'education_support',
  },
  {
    id: 'emergency_response',
    label: 'Emergency Response',
    description: 'Critical incident coordination and follow-ups',
    purposes: [
      { id: 'emergency_response', label: 'Emergency Response Call', emoji: '🚨', defaultEmotion: 'urgent', defaultUrgency: 'critical' },
    ],
    defaultPurpose: 'emergency_response',
  },
  {
    id: 'custom',
    label: 'Custom prompt (manual setup)',
    description: 'Provide your own prompt and opening message',
    custom: true,
  },
];

const MOOD_OPTIONS = [
  { id: 'auto', label: 'Auto (use recommended)' },
  { id: 'neutral', label: 'Neutral / professional' },
  { id: 'frustrated', label: 'Empathetic troubleshooter' },
  { id: 'urgent', label: 'Urgent / high-priority' },
  { id: 'confused', label: 'Patient explainer' },
  { id: 'positive', label: 'Upbeat / encouraging' },
  { id: 'stressed', label: 'Reassuring & calming' },
];

const URGENCY_OPTIONS = [
  { id: 'auto', label: 'Auto (use recommended)' },
  { id: 'low', label: 'Low – casual follow-up' },
  { id: 'normal', label: 'Normal – timely assistance' },
  { id: 'high', label: 'High – priority handling' },
  { id: 'critical', label: 'Critical – emergency protocol' },
];

const TECH_LEVEL_OPTIONS = [
  { id: 'auto', label: 'Auto (general audience)' },
  { id: 'general', label: 'General audience' },
  { id: 'novice', label: 'Beginner-friendly' },
  { id: 'advanced', label: 'Advanced / technical specialist' },
];

function formatOptionLabel(option) {
  if (option.emoji) {
    return `${option.emoji} ${option.label}`;
  }
  return option.label;
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

function getOptionLabel(options, id) {
  const match = options.find((option) => option.id === id);
  return match ? match.label : id;
}

module.exports = {
  BUSINESS_OPTIONS,
  MOOD_OPTIONS,
  URGENCY_OPTIONS,
  TECH_LEVEL_OPTIONS,
  formatOptionLabel,
  askOptionWithButtons,
  getOptionLabel,
};
