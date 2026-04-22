import React, { Component, ErrorInfo, ReactNode } from 'react';
import Button from './ui/Button';

interface ErrorBoundaryProps {
  children?: ReactNode;
  variant?: 'fullscreen' | 'widget';
  label?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    // Remove splash screen if it's still there to show the error UI
    const splash = document.getElementById('titan-splash');
    if (splash) splash.style.display = 'none';
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    // If it's a global fullscreen error, a hard reload might be safer, 
    // but we can try a soft remount first. If it crashes again, the error boundary catches it.
    if (this.props.variant === 'fullscreen') {
      window.location.reload(); 
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.variant === 'widget') {
        return (
          <div className="flex flex-col items-center justify-center h-full p-4 bg-red-900/20 border border-red-500/30 rounded">
            <span className="text-2xl mb-2">⚠️</span>
            <span className="text-xs text-red-400 font-mono text-center mb-2">
              Сбой модуля: {this.props.label || 'Widget'}
            </span>
            <button 
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-3 py-1 bg-red-800 hover:bg-red-700 text-white text-[10px] rounded"
            >
              Перезапуск
            </button>
          </div>
        );
      }

      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white p-6 font-mono">
          <h1 className="text-3xl font-bold text-red-500 mb-4">SYSTEM FAILURE</h1>
          <div className="bg-gray-900 p-4 rounded border border-gray-700 max-w-lg w-full overflow-auto mb-6">
            <p className="text-red-300 text-sm whitespace-pre-wrap">
              {this.state.error?.message || "Unknown Error"}
            </p>
          </div>
          <Button onClick={this.handleRetry} variant="danger" className="px-8 py-3">
            ПЕРЕЗАГРУЗИТЬ СИСТЕМУ
          </Button>
        </div>
      );
    }

    return (
      <>
        {this.props.children}
      </>
    );
  }
}

export default ErrorBoundary;