import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { EnterpriseShell } from '@/components/layout';
import { ActionTile, HeroHeader, NotificationCard } from '@/components/ui';

import './IndexPage.css';

const quickActions = [
  {
    icon: '📞',
    label: 'Start Call',
    description: 'Spin up an AI concierge call flow with one tap.',
    path: '/calls',
  },
  {
    icon: '💬',
    label: 'Send SMS',
    description: 'Trigger the latest nurture template on demand.',
    path: '/sms',
  },
  {
    icon: '📡',
    label: 'Monitor',
    description: 'Follow live conversations and intervene instantly.',
    path: '/monitor',
  },
  {
    icon: '📝',
    label: 'Transcripts',
    description: 'Audit routed calls and annotate key takeaways.',
    path: '/transcripts',
  },
];

const metrics = [
  { value: '86', label: 'Voice engagements completed today', badge: '+18% vs yesterday' },
  { value: '4.7 ★', label: 'Average satisfaction over the last 24h', badge: 'Top quartile' },
  { value: '12', label: 'High-intent leads escalated to humans', badge: '3 pending reviews' },
];

export function IndexPage() {
  const navigate = useNavigate();
  const [channel, setChannel] = useState<'voice' | 'sms'>('voice');

  return (
    <EnterpriseShell>
      <div className="dashboard">
        <HeroHeader
          eyebrow="1 step remaining"
          title="Add Your First Automation"
          subtitle="Connect VoiceDnut to your sales workflows and monitor AI conversations in real time."
          helperText="Go to Calls to launch the concierge and route hot leads instantly."
          progress={{ value: 0.4 }}
          cta={{
            label: 'Start a Call',
            onClick: () => navigate('/calls'),
          }}
        >
          <div className="dashboard__hero-footer">
            <div className="dashboard__segmented" role="group" aria-label="Engagement channel">
              <button
                type="button"
                className={channel === 'voice' ? 'is-active' : undefined}
                onClick={() => setChannel('voice')}
              >
                Voice
              </button>
              <button
                type="button"
                className={channel === 'sms' ? 'is-active' : undefined}
                onClick={() => setChannel('sms')}
              >
                SMS
              </button>
            </div>

            <div className="dashboard__hero-pills">
              <span className="dashboard__pill">Priority queue active</span>
              <span className="dashboard__pill">Playbook v2.1</span>
            </div>
          </div>
        </HeroHeader>

        <section className="dashboard__section">
          <header className="dashboard__section-header">
            <h2>Quick Actions</h2>
            <button
              type="button"
              className="dashboard__section-link"
              onClick={() => navigate('/settings')}
            >
              Customize
            </button>
          </header>
          <div className="dashboard__actions">
            {quickActions.map((action) => (
              <ActionTile
                key={action.label}
                icon={<span aria-hidden>{action.icon}</span>}
                label={action.label}
                description={action.description}
                onClick={() => navigate(action.path)}
              />
            ))}
          </div>
        </section>

        <section className="dashboard__section">
          <header className="dashboard__section-header">
            <h2>Announcements</h2>
          </header>
          <NotificationCard
            title="New Terms of Service"
            body="We’ve updated our terms. By using VoiceDnut, you accept the latest User Agreement and Privacy Policy."
            actionLabel="Review changes"
            onAction={() => navigate('/settings')}
            tone="info"
          />
        </section>

        <section className="dashboard__section">
          <header className="dashboard__section-header">
            <h2>Operational Insights</h2>
            <span className="dashboard__section-subtle">Refreshed 2 minutes ago</span>
          </header>
          <div className="dashboard__metrics">
            {metrics.map((metric) => (
              <div key={metric.label} className="dashboard__metric">
                <strong>{metric.value}</strong>
                <p>{metric.label}</p>
                <span>{metric.badge}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </EnterpriseShell>
  );
}
