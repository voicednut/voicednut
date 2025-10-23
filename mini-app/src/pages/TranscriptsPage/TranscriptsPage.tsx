import { EnterpriseShell } from '@/components/layout';
import { NotificationCard } from '@/components/ui';

import './TranscriptsPage.css';

const transcriptEntries = [
  {
    id: 't1',
    title: 'Follow-up with Lana Martinez',
    timestamp: 'Today · 14:32',
    sentiment: 'Positive · 92%',
    summary: 'AI concierge handled pricing objection and scheduled a human callback for 4 PM.',
    highlights: ['Marked as hot lead', 'Requested enterprise pricing sheet'],
  },
  {
    id: 't2',
    title: 'Onboarding check-in · Beacon Solar',
    timestamp: 'Today · 11:18',
    sentiment: 'Neutral · 76%',
    summary: 'Customer validated IVR routing and shared that two numbers still bounce.',
    highlights: ['Updated monitor playbook', 'Assigned to Ops queue'],
  },
  {
    id: 't3',
    title: 'Voicemail drop · Andrew Kim',
    timestamp: 'Yesterday · 19:05',
    sentiment: 'Pending · Awaiting reply',
    summary: 'Conversation converted to SMS follow-up with auto-sequenced reminder.',
    highlights: ['AI recommended follow-up template', 'Escalation SLA set to 2 hours'],
  },
];

const filters = ['All', 'AI flagged', 'Needs review', 'Escalated'];

export function TranscriptsPage() {
  return (
    <EnterpriseShell>
      <div className="transcripts">
        <header className="transcripts__header">
          <div>
            <h1>Conversation History</h1>
            <p>Audit transcripts, AI annotations, and follow-up actions from recent calls.</p>
          </div>
          <div className="transcripts__filters">
            {filters.map((filter, index) => (
              <button key={filter} type="button" className={index === 0 ? 'is-active' : undefined}>
                {filter}
              </button>
            ))}
          </div>
        </header>

        <section className="transcripts__timeline">
          {transcriptEntries.map((entry, index) => (
            <article key={entry.id} className="transcripts__item">
              <div className="transcripts__marker" aria-hidden />
              <div className="transcripts__meta">
                <span className="transcripts__timestamp">{entry.timestamp}</span>
                <span className="transcripts__sentiment">{entry.sentiment}</span>
              </div>
              <h2>{entry.title}</h2>
              <p>{entry.summary}</p>
              <ul className="transcripts__highlights">
                {entry.highlights.map((highlight) => (
                  <li key={highlight}>{highlight}</li>
                ))}
              </ul>
              {index < transcriptEntries.length - 1 ? (
                <span className="transcripts__divider" />
              ) : null}
            </article>
          ))}
        </section>

        <NotificationCard
          className="transcripts__announcement"
          title="Real-time transcription sync"
          body="Live transcript streaming and human review flows are shipping next. Join the pilot to annotate conversations and trigger automations straight from this view."
          actionLabel="Request early access"
          tone="info"
          onAction={() => {
            const link = 'https://t.me/voicednut';
            const webApp = window.Telegram?.WebApp as unknown as {
              openLink?: (url: string) => void;
            };
            if (webApp?.openLink) {
              webApp.openLink(link);
            } else {
              window.open(link, '_blank', 'noopener');
            }
          }}
        />
      </div>
    </EnterpriseShell>
  );
}
