import { type FC, useState } from 'react';
import { Button } from '@telegram-apps/telegram-ui';
import { CallInitiationForm } from '../../features/calls/CallInitiationForm';
import { CallMonitoringDashboard } from '../../features/calls/CallMonitoringDashboard';

export const CallsPage: FC = () => {
  const [activeTab, setActiveTab] = useState<'new' | 'monitor'>('monitor');

  return (
    <div className="page">
      <div className="tabs-wrapper" style={{ marginBottom: '1rem' }}>
        <Button
          size="m"
          type={activeTab === 'monitor' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('monitor')}
        >
          Active Calls
        </Button>
        <Button
          size="m"
          type={activeTab === 'new' ? 'primary' : 'secondary'}
          onClick={() => setActiveTab('new')}
          style={{ marginLeft: '0.5rem' }}
        >
          New Call
        </Button>
      </div>

      {activeTab === 'new' ? <CallInitiationForm /> : <CallMonitoringDashboard />}
    </div>
  );
};
