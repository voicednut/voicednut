require('dotenv').config();
const fs = require('fs');
const path = require('path');

const isProduction = process.env.NODE_ENV === 'production';

function readEnv(name) {
  const value = process.env[name];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return undefined;
}

function ensure(name, fallback) {
  const value = readEnv(name);
  if (value !== undefined) {
    return value;
  }
  if (fallback !== undefined) {
    if (!isProduction) {
      console.warn(`Environment variable "${name}" is missing. Using fallback value in development.`);
    }
    return fallback;
  }
  const message = `Missing required environment variable "${name}".`;
  throw new Error(message);
}

function ensureBoolean(name, fallback = false) {
  const value = readEnv(name);
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function ensureNumber(name, fallback) {
  const value = readEnv(name);
  if (value === undefined || Number.isNaN(Number(value))) {
    if (fallback === undefined) {
      throw new Error(`Missing or invalid number for environment variable "${name}".`);
    }
    return Number(fallback);
  }
  return Number(value);
}

function ensureRequired(name, providerLabel) {
  const value = readEnv(name);
  if (value !== undefined) {
    return value;
  }
  const providerNote = providerLabel ? ` for ${providerLabel}` : '';
  throw new Error(`Missing required environment variable "${name}"${providerNote}.`);
}

function loadPrivateKey(rawValue) {
  if (!rawValue) {
    return undefined;
  }

  const normalized = rawValue.replace(/\\n/g, '\n');
  if (normalized.includes('-----BEGIN')) {
    return normalized;
  }

  try {
    const filePath = path.isAbsolute(normalized)
      ? normalized
      : path.join(process.cwd(), normalized);
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    console.warn(`Unable to load Vonage private key from path "${normalized}": ${error.message}`);
    return undefined;
  }
}

const corsOriginsRaw = ensure('CORS_ORIGINS', process.env.WEB_APP_URL || '');
const corsOrigins = corsOriginsRaw
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const callProvider = ensure('CALL_PROVIDER', 'twilio').toLowerCase();
const isAwsProvider = callProvider === 'aws';
const awsRegion = ensure('AWS_REGION', 'us-east-1');
const adminApiToken = readEnv('ADMIN_API_TOKEN');
const databasePath = ensure('DATABASE_PATH', path.join(__dirname, 'db', 'data.db'));

const complianceModeRaw = (readEnv('CONFIG_COMPLIANCE_MODE') || 'safe').toLowerCase();
const allowedComplianceModes = new Set(['safe', 'dev_insecure']);
const complianceMode = allowedComplianceModes.has(complianceModeRaw) ? complianceModeRaw : 'safe';
if (!allowedComplianceModes.has(complianceModeRaw) && !isProduction) {
  console.warn(`Invalid CONFIG_COMPLIANCE_MODE "${complianceModeRaw}". Falling back to "safe".`);
}
const dtmfEncryptionKey = readEnv('DTMF_ENCRYPTION_KEY');
const complianceDefaultPolicyRaw = (readEnv('COMPLIANCE_DEFAULT_POLICY') || 'safe').toLowerCase();
const allowedCompliancePolicies = new Set(['safe', 'pii', 'pci']);
const complianceDefaultPolicy = allowedCompliancePolicies.has(complianceDefaultPolicyRaw)
  ? complianceDefaultPolicyRaw
  : 'safe';
if (!allowedCompliancePolicies.has(complianceDefaultPolicyRaw) && !isProduction) {
  console.warn(`Invalid COMPLIANCE_DEFAULT_POLICY "${complianceDefaultPolicyRaw}". Falling back to "safe".`);
}
const complianceRetentionDaysRaw = readEnv('COMPLIANCE_RETENTION_DAYS');
const complianceRetentionDays = Number.isFinite(Number(complianceRetentionDaysRaw))
  ? Number(complianceRetentionDaysRaw)
  : 30;

const serverHostname = ensure('SERVER');
const serverPort = ensureNumber('PORT', 3000);
const publicBaseUrl = serverHostname ? `https://${serverHostname}` : `http://localhost:${serverPort}`;
const statusCallbackEvents = (readEnv('STATUS_CALLBACK_EVENTS') || 'initiated,ringing,answered,completed')
  .split(',')
  .map((entry) => entry.trim().toLowerCase())
  .filter(Boolean);

const twilioAccountSid = ensureRequired('TWILIO_ACCOUNT_SID', 'twilio');
const twilioAuthToken = ensureRequired('TWILIO_AUTH_TOKEN', 'twilio');
const twilioFromNumber = ensureRequired('FROM_NUMBER', 'twilio');
const transferNumber = readEnv('TRANSFER_NUMBER');

const telegramBotToken = ensureRequired('TELEGRAM_BOT_TOKEN');
if (!telegramBotToken) {
  throw new Error('Missing required Telegram bot token. Set TELEGRAM_BOT_TOKEN or BOT_TOKEN.');
}
const telegramApiUrl = ensure('TELEGRAM_API_URL', 'https://api.telegram.org');

const openRouterApiKey = readEnv('OPENROUTER_API_KEY');
const openRouterModel = ensure('OPENROUTER_MODEL', 'meta-llama/llama-3.1-8b-instruct:free');
const openRouterSiteUrl = ensure('YOUR_SITE_URL', 'http://localhost:3000');
const openRouterSiteName = ensure('YOUR_SITE_NAME', 'Voice Call Bot');

const openAiApiKey = readEnv('OPENAI_API_KEY');
const openAiModel = ensure('OPENAI_MODEL', 'gpt-4o-mini');
if (!openAiApiKey && !openRouterApiKey) {
  const message = 'Missing required API key: set OPENAI_API_KEY or OPENROUTER_API_KEY.';
  throw new Error(message);
}

const deepgramApiKey = ensureRequired('DEEPGRAM_API_KEY');
const deepgramVoiceModel = ensure('VOICE_MODEL', 'aura-asteria-en');
const deepgramStreamingModel = ensure('DEEPGRAM_STREAMING_MODEL', 'nova-2');

const recordingEnabled = ensureBoolean('RECORDING_ENABLED', false);

const smsBusinessId = readEnv('DEFAULT_SMS_BUSINESS_ID') || null;

const vonagePrivateKey = loadPrivateKey(readEnv('VONAGE_PRIVATE_KEY'));

const awsConnectInstanceId = isAwsProvider
  ? ensureRequired('AWS_CONNECT_INSTANCE_ID', 'aws')
  : readEnv('AWS_CONNECT_INSTANCE_ID') || '';
const awsConnectContactFlowId = isAwsProvider
  ? ensureRequired('AWS_CONNECT_CONTACT_FLOW_ID', 'aws')
  : readEnv('AWS_CONNECT_CONTACT_FLOW_ID') || '';
const awsPinpointApplicationId = isAwsProvider
  ? ensureRequired('AWS_PINPOINT_APPLICATION_ID', 'aws')
  : readEnv('AWS_PINPOINT_APPLICATION_ID');
const awsPinpointOriginationNumber =
  readEnv('AWS_PINPOINT_ORIGINATION_NUMBER') || readEnv('AWS_CONNECT_SOURCE_PHONE_NUMBER');

if (isAwsProvider && !awsPinpointOriginationNumber) {
  throw new Error('Missing required environment variable "AWS_PINPOINT_ORIGINATION_NUMBER" or "AWS_CONNECT_SOURCE_PHONE_NUMBER" for provider "aws".');
}

module.exports = {
  platform: {
    provider: callProvider,
  },
  twilio: {
    accountSid: twilioAccountSid,
    authToken: twilioAuthToken,
    fromNumber: twilioFromNumber,
    transferNumber,
    statusCallbackEvents,
    statusCallbackMethod: 'POST',
  },
  aws: {
    region: awsRegion,
    connect: {
      instanceId: awsConnectInstanceId,
      contactFlowId: awsConnectContactFlowId,
      queueId: readEnv('AWS_CONNECT_QUEUE_ID'),
      sourcePhoneNumber: readEnv('AWS_CONNECT_SOURCE_PHONE_NUMBER'),
      transcriptsQueueUrl: readEnv('AWS_TRANSCRIPTS_QUEUE_URL'),
      eventBusName: readEnv('AWS_EVENT_BUS_NAME'),
    },
    polly: {
      voiceId: ensure('AWS_POLLY_VOICE_ID', 'Joanna'),
      outputBucket: readEnv('AWS_POLLY_OUTPUT_BUCKET'),
      outputPrefix: readEnv('AWS_POLLY_OUTPUT_PREFIX') || 'tts/',
    },
    s3: {
      mediaBucket: readEnv('AWS_MEDIA_BUCKET') || readEnv('AWS_POLLY_OUTPUT_BUCKET'),
    },
    pinpoint: {
      applicationId: awsPinpointApplicationId,
      originationNumber: awsPinpointOriginationNumber,
      region: readEnv('AWS_PINPOINT_REGION') || awsRegion,
    },
    transcribe: {
      languageCode: ensure('AWS_TRANSCRIBE_LANGUAGE_CODE', 'en-US'),
      vocabularyFilterName: readEnv('AWS_TRANSCRIBE_VOCABULARY_FILTER_NAME'),
    },
  },
  vonage: {
    apiKey: readEnv('VONAGE_API_KEY'),
    apiSecret: readEnv('VONAGE_API_SECRET'),
    applicationId: readEnv('VONAGE_APPLICATION_ID'),
    privateKey: vonagePrivateKey,
    voice: {
      fromNumber: readEnv('VONAGE_VOICE_FROM_NUMBER'),
      answerUrl: readEnv('VONAGE_ANSWER_URL'),
      eventUrl: readEnv('VONAGE_EVENT_URL'),
    },
    sms: {
      fromNumber: readEnv('VONAGE_SMS_FROM_NUMBER'),
    },
  },
  telegram: {
    botToken: telegramBotToken,
    apiUrl: telegramApiUrl,
  },
  openRouter: {
    apiKey: openRouterApiKey || null,
    model: openRouterModel,
    siteUrl: openRouterSiteUrl,
    siteName: openRouterSiteName,
  },
  openai: {
    apiKey: openAiApiKey || null,
    model: openAiModel,
  },
  deepgram: {
    apiKey: deepgramApiKey,
    voiceModel: deepgramVoiceModel,
    streamingModel: deepgramStreamingModel,
  },
  server: {
    port: serverPort,
    hostname: serverHostname,
    publicBaseUrl,
    corsOrigins,
    rateLimit: {
      windowMs: ensureNumber('RATE_LIMIT_WINDOW_MS', 60000),
      max: ensureNumber('RATE_LIMIT_MAX', 300),
    },
  },
  admin: {
    apiToken: adminApiToken,
  },
  compliance: {
    mode: complianceMode,
    encryptionKey: dtmfEncryptionKey,
    isSafe: complianceMode !== 'dev_insecure',
    defaultPolicy: complianceDefaultPolicy,
    retentionDays: complianceRetentionDays,
  },
  recording: {
    enabled: recordingEnabled,
  },
  database: {
    path: databasePath,
  },
  sms: {
    defaultBusinessId: smsBusinessId,
  },
};
