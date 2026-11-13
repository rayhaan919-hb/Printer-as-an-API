import * as React from "react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "cobalt"
  | "emerald"
  | "rose"
  | "amber";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  mono?: boolean;
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral:
    "bg-[var(--bg-subtle)] text-[var(--text-secondary)] border-[var(--border-subtle)]",
  cobalt:
    "bg-[var(--accent-soft)] text-[var(--accent-primary)] border-[var(--accent-primary)]/25",
  emerald:
    "bg-[var(--status-online-soft)] text-[var(--status-online)] border-[var(--status-online)]/25",
  rose:
    "bg-[var(--status-offline-soft)] text-[var(--status-offline)] border-[var(--status-offline)]/25",
  amber:
    "bg-[var(--status-warning-soft)] text-[var(--status-warning)] border-[var(--status-warning)]/25",
};

/** Flat status pill with 1px tonal border and optional JetBrains Mono tabular alignment. */
export function Badge({
  className,
  tone = "neutral",
  mono = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium leading-none border whitespace-nowrap",
        mono && "font-mono-tabular",
        TONE_CLASSES[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
