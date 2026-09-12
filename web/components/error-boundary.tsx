"use client";

import { RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { describeError } from "@/lib/format";

type Props = {
  children: ReactNode;
  /** Name of the panel, shown in the fallback so a user can say what broke. */
  title?: string;
  /** Custom fallback; receives the error and a reset callback. */
  fallback?: (error: unknown, reset: () => void) => ReactNode;
};

type State = { error: unknown };

/**
 * A panel-level error boundary.
 *
 * Next's `app/error.tsx` catches a whole route; this catches one card, so a
 * failing RPC read on the lender panel does not blank the credit panel next to
 * it. Every data view on the site is wrapped in one.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced in the browser console; there is no telemetry backend and this
    // app deliberately collects nothing about its users.
    console.error(`[humanline] ${this.props.title ?? "panel"} failed`, error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);

    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium">
              {this.props.title ? `${this.props.title} failed to render` : "Something broke"}
            </p>
            <p className="font-mono text-xs break-words text-muted-foreground">
              {describeError(error)}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={this.reset}>
          <RefreshCwIcon />
          Try again
        </Button>
      </div>
    );
  }
}
