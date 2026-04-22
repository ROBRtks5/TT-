import React, { Component, ErrorInfo, ReactNode } from 'react';
import Button from './ui/Button';

interface WidgetBoundaryProps {
  children?: ReactNode;
  label?: string;
  onRetry?: () => void;
  className?: string;
}

interface WidgetBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class WidgetBoundary extends Component<WidgetBoundaryProps, WidgetBoundaryState> {
  public state: WidgetBoundaryState = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): Partial<WidgetBoundaryState> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`WidgetBoundary (${this.props.label}) caught error:`, error, errorInfo);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onRetry) {
        this.props.onRetry();
    }
  };

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className={`flex flex-col items-center justify-center h-full min-h-[150px] p-4 bg-gray-900/50 border border-red-500/30 rounded ${this.props.className || ''}`}>
          <span className="text-xl mb-2">⚡</span>
          <span className="text-xs text-gray-400 font-mono text-center mb-3">
            {this.props.label || 'Module'} Offline
          </span>
          <Button 
            onClick={this.handleRetry} 
            variant="secondary"
            className="text-[10px] py-1 px-3"
          >
            RESTART
          </Button>
        </div>
      );
    }

    return (
        <div className={this.props.className}>
            {this.props.children}
        </div>
    );
  }
}

export default WidgetBoundary;