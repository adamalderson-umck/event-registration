import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * Top-level error boundary that catches unhandled React errors
 * and renders a user-friendly fallback instead of a blank screen.
 */
export default class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
        // TODO: Send to Sentry or other error monitoring service
    }

    handleReload = () => {
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
                    <div className="max-w-md w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8 text-center">
                        <div className="inline-flex bg-red-50 p-4 rounded-full mb-6">
                            <AlertTriangle className="w-10 h-10 text-red-500" />
                        </div>
                        <h1 className="text-xl font-bold text-slate-900 mb-2">
                            Something went wrong
                        </h1>
                        <p className="text-slate-500 mb-6">
                            An unexpected error occurred. Please try refreshing the page.
                        </p>
                        {import.meta.env.DEV && this.state.error && (
                            <pre className="text-left text-xs bg-slate-100 border border-slate-200 rounded-lg p-3 mb-6 overflow-auto max-h-40 text-red-700">
                                {this.state.error.toString()}
                            </pre>
                        )}
                        <button
                            onClick={this.handleReload}
                            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-white font-medium rounded-lg hover:bg-primary/90 transition-colors cursor-pointer"
                        >
                            <RefreshCw className="w-4 h-4" />
                            Refresh Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
