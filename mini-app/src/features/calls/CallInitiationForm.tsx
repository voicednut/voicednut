import { useState, type FC, type FormEvent } from 'react';
import { Section } from '@telegram-apps/telegram-ui';
import { FormField } from '../../components/common/FormField';
import { Button } from '../../components/common/Button';
import { DisplayData } from '../../components/DisplayData/DisplayData';
import { callService } from './callService';
import { sendTelegramAction } from '../../services/telegramBridge';
import { type CallFormData, type ValidationErrors, isValidPhoneNumber } from './types';

const INITIAL_FORM_DATA: CallFormData = {
  phoneNumber: '',
  prompt: '',
  firstMessage: '',
};

export const CallInitiationForm: FC = () => {
  const [formData, setFormData] = useState<CallFormData>(INITIAL_FORM_DATA);
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Validate form data
  const validateForm = (): boolean => {
    const newErrors: ValidationErrors = {};

    if (!formData.phoneNumber) {
      newErrors.phoneNumber = 'Phone number is required';
    } else if (!isValidPhoneNumber(formData.phoneNumber)) {
      newErrors.phoneNumber = 'Invalid phone number format. Use E.164 format: +16125151442';
    }

    if (!formData.prompt.trim()) {
      newErrors.prompt = 'Agent prompt is required';
    }

    if (!formData.firstMessage.trim()) {
      newErrors.firstMessage = 'First message is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setSubmitError(null);

    if (!validateForm()) {
      return;
    }

    if (!showConfirmation) {
      setShowConfirmation(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await callService.initiateCall(formData);

      if (!response.success) {
        throw new Error(response.error || 'Call initiation failed');
      }

      sendTelegramAction('call_initiated', {
        callSid: response.call_sid,
        to: response.to,
        status: response.status,
      });

      setSuccessMessage(`Call placed successfully! SID: ${response.call_sid}`);
      setFormData(INITIAL_FORM_DATA);
      setShowConfirmation(false);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to initiate call');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (successMessage) {
    return (
      <Section>
        <DisplayData
          rows={[
            { title: 'Status', value: '✅ Success' },
            { title: 'Message', value: successMessage },
          ]}
        />
        <Button
          onClick={() => {
            setSuccessMessage(null);
            setFormData(INITIAL_FORM_DATA);
          }}
        >
          Start New Call
        </Button>
      </Section>
    );
  }

  return (
    <Section>
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
      >
        {submitError && <div style={errorStyle}>{submitError}</div>}

        {showConfirmation ? (
          <>
            <DisplayData
              header="Confirm Call Details"
              rows={[
                { title: 'Phone Number', value: formData.phoneNumber },
                { title: 'AI Prompt', value: formData.prompt },
                { title: 'First Message', value: formData.firstMessage },
              ]}
            />
            <div style={buttonContainerStyle}>
              <Button
                variant="secondary"
                onClick={() => setShowConfirmation(false)}
                disabled={isSubmitting}
              >
                Edit
              </Button>
              <Button type="submit" loading={isSubmitting} disabled={isSubmitting}>
                Confirm & Call
              </Button>
            </div>
          </>
        ) : (
          <>
            <FormField
              label="Phone Number"
              type="tel"
              placeholder="+16125151442"
              value={formData.phoneNumber}
              onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
              error={errors.phoneNumber}
              hint="Use E.164 format: +[country code][number]"
              required
            />

            <FormField
              label="Agent Prompt"
              multiline
              rows={4}
              placeholder="Describe how the AI should behave during the call..."
              value={formData.prompt}
              onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
              error={errors.prompt}
              required
            />

            <FormField
              label="First Message"
              multiline
              rows={3}
              placeholder="Enter the first message the agent will say..."
              value={formData.firstMessage}
              onChange={(e) => setFormData({ ...formData, firstMessage: e.target.value })}
              error={errors.firstMessage}
              required
            />

            <Button type="submit" disabled={isSubmitting} fullWidth>
              Preview Call
            </Button>
          </>
        )}
      </form>
    </Section>
  );
};

const errorStyle: React.CSSProperties = {
  padding: '12px',
  marginBottom: '16px',
  borderRadius: '8px',
  background: 'rgba(255, 82, 82, 0.12)',
  color: 'rgb(255, 82, 82)',
};

const buttonContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: '12px',
  marginTop: '16px',
};
