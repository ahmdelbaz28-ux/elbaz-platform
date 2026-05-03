import { Component, type ReactNode, type ErrorInfo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * ✅ CRITICAL FIX: React Error Boundary
 * Previously, any unhandled error would crash the entire app to a white screen.
 * Now, errors are caught and a friendly recovery UI is shown.
 *
 * Usage: Wrap any component tree with <ErrorBoundary>
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log to external error tracking service (e.g., Sentry) in production
    console.error(JSON.stringify({
      level: "error",
      timestamp: new Date().toISOString(),
      message: "React Error Boundary caught an error",
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    }));
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex min-h-[400px] items-center justify-center bg-[#0a0e17] p-8">
          <div className="max-w-md text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(244,63,94,0.1)]">
              <AlertTriangle className="h-8 w-8 text-[#f43f5e]" />
            </div>
            <h2 className="mt-4 text-xl font-bold text-[#f0f4f8]">
              Something went wrong
            </h2>
            <p className="mt-2 text-sm text-[#94a3b8]">
              An unexpected error occurred. This has been logged and our team will investigate.
              You can try again or reload the page.
            </p>
            {process.env.NODE_ENV === "development" && this.state.error && (
              <div className="mt-4 rounded-lg border border-[#f43f5e]/20 bg-[rgba(244,63,94,0.05)] p-3 text-left">
                <p className="text-xs font-mono text-[#f43f5e]">
                  {this.state.error.message}
                </p>
              </div>
            )}
            <div className="mt-6 flex items-center justify-center gap-3">
              <Button
                variant="outline"
                onClick={this.handleRetry}
                className="border-[#1f2d44] text-[#94a3b8] hover:text-[#f0f4f8]"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Try Again
              </Button>
              <Button
                onClick={this.handleReload}
                className="bg-[#06b6d4] text-[#0a0e17] hover:bg-[#0891b2]"
              >
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
