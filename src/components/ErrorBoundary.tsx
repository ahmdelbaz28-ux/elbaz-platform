import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary — Bilingual (AR/EN) with recovery UI.
 * Catches unhandled errors and displays a friendly message
 * with reload and homepage buttons.
 */
class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private isArabic = () =>
    document.documentElement.dir === "rtl" ||
    document.documentElement.lang === "ar";

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const ar = this.isArabic();

      return (
        <div className="min-h-screen bg-[#070b12] flex items-center justify-center p-4">
          <div className="text-center max-w-md w-full">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(239,68,68,0.1)] border border-[rgba(239,68,68,0.2)]">
              <svg className="h-8 w-8 text-[#ef4444]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>

            <h1 className="text-2xl font-bold text-[#f0f4f8] mb-3">
              {ar ? "حدث خطأ ما" : "Something went wrong"}
            </h1>

            <p className="text-sm text-[#94a3b8] mb-2 leading-relaxed">
              {ar
                ? "حدث خطأ غير متوقع. يمكنك إعادة تحميل الصفحة أو العودة للرئيسية."
                : "An unexpected error occurred. You can reload the page or go back to the homepage."}
            </p>

            {this.state.error && process.env.NODE_ENV === "development" && (
              <div className="mt-3 rounded-lg bg-[rgba(239,68,68,0.05)] border border-[rgba(239,68,68,0.15)] p-3 text-left">
                <p className="text-xs text-[#f87171] font-mono break-all">{this.state.error.message}</p>
              </div>
            )}

            <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2.5 bg-gradient-to-r from-[#06b6d4] to-[#0891b2] text-[#0a0e17] font-semibold rounded-lg hover:shadow-[0_0_16px_rgba(6,182,212,0.3)] transition-all"
              >
                {ar ? "إعادة تحميل" : "Reload Page"}
              </button>
              <a
                href="/"
                onClick={(e) => {
                  e.preventDefault();
                  this.handleReset();
                  window.location.href = "/";
                }}
                className="px-6 py-2.5 border border-[#1e2d3d] text-[#94a3b8] font-medium rounded-lg hover:border-[#06b6d4] hover:text-[#06b6d4] transition-all"
              >
                {ar ? "الصفحة الرئيسية" : "Go to Homepage"}
              </a>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
