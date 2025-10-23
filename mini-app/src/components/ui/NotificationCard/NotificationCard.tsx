import { type ButtonHTMLAttributes, type ReactNode } from 'react';

import { classNames } from '@/css/classnames';

import './NotificationCard.css';

export interface NotificationCardProps {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: ReactNode;
  tone?: 'default' | 'info' | 'warning';
  className?: string;
  footerActionProps?: ButtonHTMLAttributes<HTMLButtonElement>;
}

export function NotificationCard({
  title,
  body,
  actionLabel,
  onAction,
  icon,
  tone = 'default',
  className,
  footerActionProps,
}: NotificationCardProps) {
  return (
    <article className={classNames('notification-card', `notification-card--${tone}`, className)}>
      {icon ? <div className="notification-card__icon">{icon}</div> : null}

      <div className="notification-card__content">
        <h3 className="notification-card__title">{title}</h3>
        <p className="notification-card__body">{body}</p>
      </div>

      {actionLabel ? (
        <button
          type="button"
          className="notification-card__action"
          onClick={onAction}
          {...footerActionProps}
        >
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}
