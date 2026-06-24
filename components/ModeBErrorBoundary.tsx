"use client";

/**
 * ModeBErrorBoundary — wraps each Mode B chart so that a broken pasted
 * snippet cannot crash the rest of the dashboard.
 *
 * AGENTS.md rule 6: "Every Mode B chart is wrapped in its own error boundary."
 *
 * Must be a class component — React still requires that for error boundaries.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  title: string;
  children: ReactNode;
};

type State = {
  hasError: boolean;
  error: Error | null;
};

export class ModeBErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to console for dev visibility; no external reporting needed.
    console.error(`[ModeBErrorBoundary] "${this.props.title}" crashed:`, error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col gap-3 rounded-xl border border-red-500/25 bg-red-500/10 p-5">
          <div className="flex items-center gap-2">
            {/* Warning icon */}
            <svg
              className="h-4 w-4 shrink-0 text-red-400"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
            >
              <path
                d="M8 6v3M8 11h.01M2.65 13h10.7a1 1 0 00.87-1.5L8.87 3a1 1 0 00-1.74 0L1.78 11.5A1 1 0 002.65 13z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p className="text-xs font-medium text-red-400">
              Mode B render error in &ldquo;{this.props.title}&rdquo;
            </p>
          </div>

          {this.state.error && (
            <pre className="overflow-auto rounded-lg bg-black/20 p-3 text-[10px] leading-relaxed text-red-300/70 whitespace-pre-wrap">
              {this.state.error.message}
              {this.state.error.stack ? `\n\n${this.state.error.stack}` : ""}
            </pre>
          )}

          <button
            type="button"
            onClick={this.handleReset}
            className="self-start rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[11px] font-medium text-red-400 hover:bg-red-500/20 transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
