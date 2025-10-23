import axios, { AxiosError } from 'axios';
import { config } from '../../services/config';
import {
  type Call,
  type CallDetailResponse,
  type CallInitiateResponse,
  type CallListResponse,
  type TranscriptEntry,
  type APIErrorResponse,
} from '../../types/call';
import type { CallFormData } from './types';

const api = axios.create({
  baseURL: config.api.baseUrl,
  headers: {
    'Content-Type': 'application/json',
  },
});

const toNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toStringValue = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  return fallback;
};

const isCallStatus = (value: unknown): value is Call['status'] => {
  const allowed: Call['status'][] = [
    'initiated',
    'queued',
    'ringing',
    'in-progress',
    'completed',
    'failed',
    'busy',
    'no-answer',
    'canceled',
  ];
  return typeof value === 'string' && allowed.includes(value as Call['status']);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeCall = (input: Record<string, unknown>): Call => {
  const status = isCallStatus(input.status) ? input.status : 'queued';
  const businessContext = input.business_context;

  return {
    call_sid: toStringValue(input.call_sid),
    phone_number: toStringValue(input.phone_number ?? input.to),
    status,
    duration: toNumber(input.duration ?? input.duration_seconds ?? input.call_duration),
    transcript_count: toNumber(input.transcript_count ?? input.messages_count) ?? 0,
    error: typeof input.error === 'string' ? input.error : null,
    created_at: toStringValue(input.created_at, new Date().toISOString()),
    updated_at: input.updated_at ? toStringValue(input.updated_at) : null,
    ended_at: input.ended_at ? toStringValue(input.ended_at) : null,
    first_message: typeof input.first_message === 'string' ? input.first_message : null,
    prompt: typeof input.prompt === 'string' ? input.prompt : null,
    call_summary: typeof input.call_summary === 'string' ? input.call_summary : null,
    business_context: isRecord(businessContext) ? businessContext : null,
  };
};

const extractCalls = (payload: unknown): Call[] => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const candidate = payload as Partial<CallListResponse> & {
    data?: unknown;
    calls?: unknown;
  };

  const rawCalls =
    (Array.isArray(candidate.calls) && candidate.calls) ||
    (Array.isArray((candidate.data as { calls?: unknown })?.calls)
      ? ((candidate.data as { calls: unknown }).calls as unknown[])
      : []);

  return rawCalls
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => normalizeCall(item));
};

const isApiErrorPayload = (value: unknown): value is APIErrorResponse & { message?: string } =>
  typeof value === 'object' &&
  value !== null &&
  ('error' in value || 'details' in value || 'message' in value);

const parseError = (error: unknown): never => {
  if (error instanceof AxiosError) {
    const payload: unknown = error.response?.data;
    if (isApiErrorPayload(payload)) {
      const message = payload.error || (payload as { message?: string }).message;
      throw new Error(message || 'Request failed');
    }
    if (typeof error.message === 'string' && error.message.length > 0) {
      throw new Error(error.message);
    }
  }

  if (error instanceof Error) {
    throw error;
  }

  throw new Error('Unexpected error');
};

const withInitData = (): string | undefined => {
  const webApp = window.Telegram?.WebApp as unknown;
  if (webApp && typeof webApp === 'object' && 'initData' in webApp) {
    const initData = (webApp as { initData?: unknown }).initData;
    return typeof initData === 'string' ? initData : undefined;
  }
  return undefined;
};

const resolveUserChatId = (): string | undefined => {
  const webApp = window.Telegram?.WebApp as unknown;
  if (webApp && typeof webApp === 'object' && 'initDataUnsafe' in webApp) {
    const unsafe = (webApp as { initDataUnsafe?: unknown }).initDataUnsafe;
    if (unsafe && typeof unsafe === 'object' && 'user' in unsafe) {
      const user = (unsafe as { user?: { id?: number | string } }).user;
      if (user) {
        if (typeof user.id === 'number') {
          return String(user.id);
        }
        if (typeof user.id === 'string') {
          return user.id;
        }
      }
    }
  }
  return undefined;
};

const buildInitiatePayload = (form: CallFormData) => ({
  number: form.phoneNumber,
  prompt: form.prompt,
  first_message: form.firstMessage,
  user_chat_id: resolveUserChatId(),
  init_data: withInitData(),
});

export const callService = {
  async listActive(limit = 12): Promise<Call[]> {
    try {
      const response = await api.get<CallListResponse>('/api/calls/list', {
        params: { status: 'in-progress', limit },
      });
      return extractCalls(response.data);
    } catch (error) {
      return parseError(error);
    }
  },

  async listRecent(limit = 10, offset = 0): Promise<Call[]> {
    try {
      const response = await api.get<CallListResponse>('/api/calls', {
        params: { limit, offset },
      });
      return extractCalls(response.data);
    } catch (error) {
      return parseError(error);
    }
  },

  async initiateCall(formData: CallFormData): Promise<CallInitiateResponse> {
    try {
      const response = await api.post<CallInitiateResponse>(
        '/outbound-call',
        buildInitiatePayload(formData)
      );
      return response.data;
    } catch (error) {
      return parseError(error);
    }
  },

  async getCallDetails(callSid: string): Promise<CallDetailResponse> {
    try {
      const response = await api.get<CallDetailResponse>(`/api/calls/${callSid}`);
      const data = response.data;
      if (data?.call) {
        data.call = normalizeCall(data.call as unknown as Record<string, unknown>);
      }
      return data;
    } catch (error) {
      return parseError(error);
    }
  },

  async getTranscripts(callSid: string): Promise<TranscriptEntry[]> {
    const details = await callService.getCallDetails(callSid);
    return details.transcripts ?? [];
  },
};

export default callService;
