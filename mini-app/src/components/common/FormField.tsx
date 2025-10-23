import { type FC, type InputHTMLAttributes } from 'react';
import { bem } from '../../css/bem';

const [block, element] = bem('form-field');

interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement | HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
}

export const FormField: FC<FormFieldProps> = ({
  label,
  error,
  hint,
  multiline,
  className = '',
  rows = 3,
  ...props
}) => {
  const inputClasses =
    `${element('input')} ${error ? element('input--error') : ''} ${className}`.trim();

  return (
    <div className={block()}>
      <label className={element('label')}>{label}</label>
      {multiline ? (
        <textarea
          {...(props as InputHTMLAttributes<HTMLTextAreaElement>)}
          className={inputClasses}
          rows={rows}
        />
      ) : (
        <input {...props} className={inputClasses} />
      )}
      {error && <div className={element('error')}>{error}</div>}
      {hint && <div className={element('hint')}>{hint}</div>}
    </div>
  );
};
