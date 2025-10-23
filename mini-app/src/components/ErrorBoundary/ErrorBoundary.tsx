import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div style={containerStyle}>
          <h2 style={headingStyle}>Something went wrong</h2>
          <p style={messageStyle}>{this.state.error?.message || 'An unexpected error occurred'}</p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={buttonStyle}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const containerStyle: React.CSSProperties = {
  padding: '20px',
  textAlign: 'center',
  color: 'var(--tg-theme-text-color)',
};

const headingStyle: React.CSSProperties = {
  marginBottom: '12px',
  fontSize: '1.5rem',
  fontWeight: 600,
};

const messageStyle: React.CSSProperties = {
  marginBottom: '20px',
  color: 'var(--tg-theme-hint-color)',
};

const buttonStyle: React.CSSProperties = {
  padding: '10px 20px',
  borderRadius: '8px',
  border: 'none',
  background: 'var(--tg-theme-button-color)',
  color: 'var(--tg-theme-button-text-color)',
  cursor: 'pointer',
  fontSize: '1rem',
};
