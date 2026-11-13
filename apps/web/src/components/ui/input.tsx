import * as React from "react";
import { cn } from "@/lib/utils";

const FIELD_BASE =
  "w-full rounded-md bg-[var(--bg-canvas)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] border border-[var(--border-subtle)] px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:border-[var(--accent-primary)] focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)] disabled:opacity-50";

/** Minimalist 1px bordered text input aligned to the 4/8/12/16px scale. */
export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
});

/** Minimalist 1px bordered select element. */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
});

/** Minimalist 1px bordered textarea for JSON/RAW_TEXT/HTML print payloads. */
export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(FIELD_BASE, className)} {...props} />;
});
