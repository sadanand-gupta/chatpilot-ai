import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Changing this key resets the boundary (e.g. pass location.pathname). */
  resetKey?: string;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    const isChunkError = /Failed to fetch dynamically imported module|Loading chunk/i.test(this.state.error.message);
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            {isChunkError ? 'A new version is available' : 'Something went wrong'}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {isChunkError
              ? 'Please reload the page to get the latest version.'
              : 'An unexpected error occurred while showing this page. Try again, or reload if it keeps happening.'}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            {!isChunkError && (
              <Button variant="outline" onClick={() => this.setState({ error: null })}>
                Try again
              </Button>
            )}
            <Button onClick={() => window.location.reload()}>
              <RotateCw /> Reload page
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
