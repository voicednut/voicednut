import { miniApp } from '@tma.js/sdk-react';
import { type PropsWithChildren, useCallback } from 'react';
import { NavLink } from 'react-router-dom';

import { classNames } from '@/css/classnames';

import './EnterpriseShell.css';

interface NavIconProps {
  active: boolean;
}

type NavIcon = (props: NavIconProps) => JSX.Element;

interface NavItem {
  key: string;
  label: string;
  path: string;
  icon: NavIcon;
}

const WalletIcon: NavIcon = ({ active }) => (
  <svg
    width="26"
    height="26"
    viewBox="0 0 26 26"
    aria-hidden
    style={{ transition: 'fill 0.2s ease' }}
  >
    <path
      d="M5.5 7.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1.25h1.5a2 2 0 0 1 2 2V18c0 1.105-.895 2-2 2H5.5c-1.105 0-2-.895-2-2V7.5a2 2 0 0 1 2-2h1.25V7.5H5.5Zm15 3H21a.5.5 0 0 1 .5.5v3.75a.5.5 0 0 1-.5.5h-.5a1.75 1.75 0 1 1 0-3.5Zm-3.5 1.25a1.25 1.25 0 1 0 0 2.5h2.5v-2.5h-2.5Z"
      fill={active ? 'var(--vo-color-primary)' : 'var(--vo-color-text-muted)'}
    />
    <rect
      x="4.5"
      y="6.5"
      width="15.5"
      height="4"
      rx="1.5"
      fill={active ? 'rgba(77, 141, 255, 0.22)' : 'rgba(255, 255, 255, 0.06)'}
    />
  </svg>
);

const ActivityIcon: NavIcon = ({ active }) => (
  <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
    <path
      d="M4 17c2.2-1.5 4.3-2.5 5.5-4l2.5 3 3.5-5 6 8"
      fill="none"
      stroke={active ? 'var(--vo-color-primary)' : 'var(--vo-color-text-muted)'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle
      cx="4"
      cy="17"
      r="1.2"
      fill={active ? 'var(--vo-color-primary)' : 'var(--vo-color-text-muted)'}
    />
    <circle
      cx="21.5"
      cy="19"
      r="1.2"
      fill={active ? 'var(--vo-color-primary)' : 'var(--vo-color-text-muted)'}
    />
  </svg>
);

const ClockIcon: NavIcon = ({ active }) => (
  <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
    <circle
      cx="13"
      cy="13"
      r="9.5"
      fill={active ? 'rgba(77, 141, 255, 0.18)' : 'rgba(255, 255, 255, 0.06)'}
      stroke={active ? 'var(--vo-color-primary)' : 'var(--vo-color-text-muted)'}
      strokeWidth="1.5"
    />
    <path
      d="M13 8v5l3 3"
      stroke={active ? 'var(--vo-color-primary)' : 'var(--vo-color-text-muted)'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const navItems: NavItem[] = [
  { key: 'wallet', label: 'Wallet', path: '/', icon: WalletIcon },
  { key: 'activity', label: 'Trade', path: '/calls', icon: ActivityIcon },
  { key: 'history', label: 'History', path: '/transcripts', icon: ClockIcon },
];

export function EnterpriseShell({ children }: PropsWithChildren) {
  const handleClose = useCallback(() => {
    try {
      miniApp.close();
    } catch (error) {
      console.warn('Unable to close mini app via Telegram API', error);
      if (window.history.length > 1) {
        window.history.back();
      }
    }
  }, []);

  return (
    <div className="enterprise-shell">
      <header className="enterprise-shell__top">
        <button type="button" className="enterprise-shell__close" onClick={handleClose}>
          Close
        </button>

        <div className="enterprise-shell__status">
          <span className="enterprise-shell__avatar" aria-hidden>
            VD
          </span>
          <div>
            <div className="enterprise-shell__status-title">
              Wallet <span className="enterprise-shell__verified">mini app</span>
            </div>
            <span className="enterprise-shell__status-caption">VoiceDnut · Connected</span>
          </div>
        </div>

        <div className="enterprise-shell__actions">
          <button type="button" className="enterprise-shell__action-button" aria-label="Show menu">
            <span className="enterprise-shell__action-dots" />
          </button>
          <button
            type="button"
            className="enterprise-shell__action-button"
            aria-label="Open scanner"
          >
            <span className="enterprise-shell__action-qr" />
          </button>
        </div>
      </header>

      <main className="enterprise-shell__main">{children}</main>

      <nav className="enterprise-shell__nav" aria-label="Primary navigation">
        {navItems.map((item) => (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) =>
              classNames('enterprise-shell__nav-item', { 'is-active': isActive })
            }
          >
            {({ isActive }) => (
              <>
                <span className="enterprise-shell__nav-icon">
                  {item.icon({ active: isActive })}
                </span>
                <span className="enterprise-shell__nav-label">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
