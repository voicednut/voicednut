// Call initiation form data
export interface CallFormData {
  phoneNumber: string;
  prompt: string;
  firstMessage: string;
}

// Call initiation response
export { type CallInitiateResponse as CallInitiationResponse } from '../../types/call';

// Call status types (matching the backend)
export type CallStatus =
  | 'initiated'
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'busy'
  | 'no-answer'
  | 'canceled';

// Validation error type
export interface ValidationErrors {
  phoneNumber?: string;
  prompt?: string;
  firstMessage?: string;
}

// Phone number validation helper (matching bot implementation)
export const isValidPhoneNumber = (number: string): boolean => {
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(number.trim());
};
