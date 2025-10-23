import { type FC } from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { type Call } from '../../types/call';
import './CallCard.css';

interface CallCardProps {
  call: Call;
  onViewDetails: (callSid: string) => void;
}

const formatDuration = (seconds?: number | null): string => {
  if (typeof seconds !== 'number') return 'N/A';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const statusClassMap: Record<string, string> = {
  'in-progress': 'call-card__status--in-progress',
  ringing: 'call-card__status--ringing',
  completed: 'call-card__status--completed',
  failed: 'call-card__status--failed',
  busy: 'call-card__status--failed',
  'no-answer': 'call-card__status--failed',
  canceled: 'call-card__status--failed',
};

export const CallCard: FC<CallCardProps> = ({ call, onViewDetails }) => {
  return (
    <div className="call-card">
      <div className="call-card__header">
        <h3 className="call-card__title">{call.phone_number}</h3>
        <div
          className={`call-card__status ${statusClassMap[call.status] || 'call-card__status--default'}`}
        >
          {call.status}
        </div>
      </div>

      <div className="call-card__details">
        <span className="call-card__label">Duration:</span>
        <span className="call-card__value">{formatDuration(call.duration)}</span>

        <span className="call-card__label">Messages:</span>
        <span className="call-card__value">{call.transcript_count ?? 0}</span>

        <span className="call-card__label">Call SID:</span>
        <span className="call-card__value">{call.call_sid}</span>
      </div>

      <div className="call-card__actions">
        <Button size="s" onClick={() => onViewDetails(call.call_sid)}>
          View Details
        </Button>
      </div>

      {call.call_summary && <p className="call-card__summary">{call.call_summary}</p>}

      {call.error && <div className="call-card__error">{call.error}</div>}
    </div>
  );
};
