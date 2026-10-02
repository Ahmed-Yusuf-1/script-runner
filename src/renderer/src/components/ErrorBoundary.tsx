import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Last line of defence: show what went wrong and a way out instead of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('UI crashed', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>Script Runner hit an unexpected error. Your saved flows are safe. Reloading usually fixes it.</p>
        <pre>{error.message}</pre>
        <div className="row gap">
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <button className="btn" onClick={() => void navigator.clipboard.writeText(`${error.message}\n\n${error.stack ?? ''}`)}>
            Copy details
          </button>
        </div>
      </div>
    );
  }
}
