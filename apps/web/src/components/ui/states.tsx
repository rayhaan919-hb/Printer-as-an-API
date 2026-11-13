"use client";

import * as React from "react";
import { AlertCircle, Check, Copy, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Exact-dimension skeleton shimmer placeholder using tonal surface variables. */
export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "animate-pulse rounded bg-[var(--bg-subtle)]",
        className
      )}
    />
  );
}

export interface InlineErrorBannerProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  isRetrying?: boolean;
  action?: React.ReactNode;
  testId?: string;
}

/** Inline Rose error banner with mandatory Retry button per DESIGN.md. */
export function InlineErrorBanner({
  title = "Request Error",
  message,
  onRetry,
  retryLabel = "Retry",
  isRetrying = false,
  action,
  testId = "error-banner",
}: InlineErrorBannerProps) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-[var(--status-offline)]/40 bg-[var(--status-offline-soft)] px-4 py-3"
    >
      <div className="flex items-start gap-3 min-w-0">
        <AlertCircle
          className="h-4 w-4 shrink-0 text-[var(--status-offline)] mt-1"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)]">
            {title}
          </p>
          <p className="text-xs text-[var(--text-secondary)] break-words">
            {message}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {action}
        {onRetry ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={onRetry}
            disabled={isRetrying}
            data-testid="retry-button"
          >
            <RotateCw
              className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")}
              aria-hidden="true"
            />
            {retryLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export interface EmptyStateCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  ctaLabel: string;
  onCtaClick: () => void;
  testId?: string;
}

/** Actionable empty state: icon + 1-line explanation + primary Cobalt CTA button. */
export function EmptyStateCard({
  icon,
  title,
  description,
  ctaLabel,
  onCtaClick,
  testId,
}: EmptyStateCardProps) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center justify-center gap-4 px-6 py-8 text-center"
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]">
        {icon}
      </div>
      <div className="space-y-1 max-w-md">
        <h3 className="text-sm font-medium text-[var(--text-primary)]">
          {title}
        </h3>
        <p className="text-xs text-[var(--text-secondary)]">{description}</p>
      </div>
      <Button variant="primary" size="sm" onClick={onCtaClick}>
        {ctaLabel}
      </Button>
    </div>
  );
}

/** One-click clipboard copy button with subtle inline confirmation state. */
export function CopyButton({
  value,
  label = "Copy",
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored if clipboard permissions are denied
    }
  }, [value]);

  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={handleCopy}
      className={className}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? (
        <>
          <Check className="h-3.5 w-3.5 text-[var(--status-online)]" />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3.5 w-3.5" />
          {label}
        </>
      )}
    </Button>
  );
}
