import { useId, type SVGAttributes } from 'react';

import { classNames } from '@/css/classnames';

import './ProgressArc.css';

const ARC_START = 150;
const ARC_END = 390;

function clamp(value: number, min = 0, max = 1) {
  return Math.min(Math.max(value, min), max);
}

function polarToCartesian(
  centerX: number,
  centerY: number,
  radius: number,
  angleInDegrees: number
) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians),
  };
}

function describeArc(x: number, y: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(x, y, radius, endAngle);
  const end = polarToCartesian(x, y, radius, startAngle);
  const sweepAngle = Math.abs(endAngle - startAngle);
  const largeArcFlag = sweepAngle <= 180 ? '0' : '1';

  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export interface ProgressArcProps extends Omit<SVGAttributes<SVGSVGElement>, 'children'> {
  /**
   * The progress value, between 0 and 1.
   */
  value: number;
  /**
   * Overall SVG size in pixels.
   */
  size?: number;
  /**
   * Thickness of the stroke.
   */
  strokeWidth?: number;
  /**
   * Optional label rendered in the middle of the arc.
   */
  label?: string;
}

export function ProgressArc({
  value,
  size = 320,
  strokeWidth = 22,
  label,
  className,
  ...props
}: ProgressArcProps) {
  const clamped = clamp(value);
  const radius = (size - strokeWidth) / 2;
  const normalizedEnd = ARC_END < ARC_START ? ARC_END + 360 : ARC_END;
  const sweep = normalizedEnd - ARC_START;
  const currentAngle = ARC_START + sweep * clamped;
  const progressPath = describeArc(size / 2, size / 2, radius, ARC_START, currentAngle);
  const trackPath = describeArc(size / 2, size / 2, radius, ARC_START, normalizedEnd);
  const gradientId = useId();

  return (
    <svg
      className={classNames('progress-arc', className)}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(109, 162, 255, 0.85)" />
          <stop offset="100%" stopColor="rgba(72, 121, 255, 1)" />
        </linearGradient>
      </defs>

      <path
        className="progress-arc__track"
        d={trackPath}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />

      <path
        className="progress-arc__indicator"
        d={progressPath}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        stroke={`url(#${gradientId})`}
      />

      {label ? (
        <text
          className="progress-arc__label"
          x="50%"
          y="50%"
          dominantBaseline="middle"
          textAnchor="middle"
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}
