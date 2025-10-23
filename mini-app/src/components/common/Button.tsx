import { type ButtonHTMLAttributes, type FC } from 'react';
import { bem } from '../../css/bem';

const [b, element] = bem('button');

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger';
  loading?: boolean;
  fullWidth?: boolean;
}

export const Button: FC<ButtonProps> = ({
  children,
  variant = 'primary',
  loading = false,
  fullWidth = false,
  className = '',
  disabled,
  ...props
}) => {
  const classes = [
    b(),
    element(variant),
    fullWidth ? element('full-width') : '',
    loading ? element('loading') : '',
    disabled ? element('disabled') : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button {...props} className={classes} disabled={disabled || loading}>
      {loading ? (
        <span className={element('loading-text')}>
          {typeof children === 'string' ? `${children}...` : children}
        </span>
      ) : (
        children
      )}
    </button>
  );
};
