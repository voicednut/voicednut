import { useEffect } from 'react';
import { useCallStore } from '../../stores/callStore';
import { useWebSocketConnection } from '../../hooks/useWebSocketConnection';
import { CallCard } from './CallCard';
import './CallMonitoringDashboard.css';

export const CallMonitoringDashboard = () => {
  useWebSocketConnection(true);
  const { calls, error, loading, fetchActiveCalls } = useCallStore();

  useEffect(() => {
    void fetchActiveCalls();
  }, [fetchActiveCalls]);

  const handleViewDetails = (callId: string): void => {
    // TODO: Implement call details view navigation
    console.log('View details:', callId);
  };

  if (loading) {
    return <div className="call-dashboard__loading">Loading active calls...</div>;
  }

  if (error) {
    return <div className="call-dashboard__error">{error}</div>;
  }

  if (calls.length === 0) {
    return <div className="call-dashboard__empty">No active calls</div>;
  }

  return (
    <div className="call-dashboard">
      {calls.map((call) => (
        <CallCard key={call.call_sid} call={call} onViewDetails={handleViewDetails} />
      ))}
    </div>
  );
};

// Styles
