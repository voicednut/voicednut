import { type ReactNode } from 'react';

import { classNames } from '@/css/classnames';

import { ProgressArc } from '../ProgressArc/ProgressArc';

import './HeroHeader.css';

interface HeroHeaderCTA {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

interface HeroHeaderProgress {
  value: number;
  /**
   * Optional text rendered within the arc.
   */
  label?: string;
}

export interface HeroHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  helperText?: string;
  className?: string;
  cta?: HeroHeaderCTA;
  progress?: HeroHeaderProgress;
  children?: ReactNode;
}

export function HeroHeader({
  title,
  subtitle,
  eyebrow,
  helperText,
  className,
  cta,
  progress,
  children,
}: HeroHeaderProps) {
  return (
    <section className={classNames('hero-header', className)}>
      {progress ? (
        <ProgressArc
          className="hero-header__progress"
          value={progress.value}
          label={progress.label}
          aria-hidden={!progress.label}
        />
      ) : null}

      <div className="hero-header__content">
        {eyebrow ? <span className="hero-header__eyebrow">{eyebrow}</span> : null}
        <h1 className="hero-header__title">{title}</h1>
        {subtitle ? <p className="hero-header__subtitle">{subtitle}</p> : null}

        {cta ? (
          <button type="button" className="hero-header__cta" onClick={cta.onClick}>
            <span>{cta.label}</span>
            {cta.icon ? <span className="hero-header__cta-icon">{cta.icon}</span> : null}
          </button>
        ) : null}

        {helperText ? <div className="hero-header__helper">{helperText}</div> : null}

        {children ? <div className="hero-header__extra">{children}</div> : null}
      </div>
    </section>
  );
}
