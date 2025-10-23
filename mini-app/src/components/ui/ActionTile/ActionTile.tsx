import { type ButtonHTMLAttributes, type ReactNode } from 'react';

import { classNames } from '@/css/classnames';

import './ActionTile.css';

export interface ActionTileProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  description?: string;
  badge?: string | ReactNode;
}

export function ActionTile({
  icon,
  label,
  description,
  badge,
  className,
  type = 'button',
  ...props
}: ActionTileProps) {
  return (
    <button type={type} className={classNames('action-tile', className)} {...props}>
      <span className="action-tile__icon" aria-hidden>
        {icon}
      </span>
      <span className="action-tile__label">
        {label}
        {badge ? <span className="action-tile__badge">{badge}</span> : null}
      </span>
      {description ? <span className="action-tile__description">{description}</span> : null}
    </button>
  );
}
