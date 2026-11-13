"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Menu,
  Moon,
  Printer as PrinterIcon,
  Receipt,
  Sun,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type ConsoleSection =
  | "overview"
  | "jobs"
  | "printers"
  | "api-keys"
  | "billing";

export type PreviewState = "live" | "loading" | "empty" | "error";

export interface SidebarProps {
  activeSection?: ConsoleSection;
  onSelectSection?: (section: ConsoleSection) => void;
  previewState?: PreviewState;
  onPreviewStateChange?: (state: PreviewState) => void;
}

const NAV_ITEMS: Array<{
  id: ConsoleSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "jobs", label: "Print Jobs", icon: ListChecks },
  { id: "printers", label: "Printers", icon: PrinterIcon },
  { id: "api-keys", label: "API Keys", icon: KeyRound },
  { id: "billing", label: "Billing", icon: CreditCard },
];

const PREVIEW_STATES: Array<{ id: PreviewState; label: string }> = [
  { id: "live", label: "Live" },
  { id: "loading", label: "Skeleton" },
  { id: "empty", label: "Empty" },
  { id: "error", label: "Error" },
];

/** Fixed 240px Linear-style developer console sidebar with theme toggle and state switcher. */
export function Sidebar({
  activeSection = "overview",
  onSelectSection,
  previewState = "live",
  onPreviewStateChange,
}: SidebarProps) {
  const pathname = usePathname();
  const isPricing = pathname === "/pricing";
  const [isDark, setIsDark] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = React.useCallback(() => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("printer_api_theme", next ? "dark" : "light");
    } catch {
      // Ignore storage failures
    }
    setIsDark(next);
  }, []);

  const sidebarBody = (
    <div className="flex h-full flex-col justify-between bg-[var(--bg-surface)]">
      <div>
        <div className="flex items-center justify-between gap-2 px-4 py-4 border-b border-[var(--border-subtle)]">
          <Link
            href="/"
            className="flex items-center gap-3 min-w-0"
            onClick={() => setMobileOpen(false)}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--accent-primary)] text-white">
              <Receipt className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-tight text-[var(--text-primary)] truncate">
                PrintRelay
              </p>
              <p className="text-[11px] font-mono-tabular text-[var(--text-muted)] truncate">
                v1.0.0 • ESC/POS
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="md:hidden rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--bg-subtle)]"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="p-3 space-y-1" aria-label="Console navigation">
          <p className="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
            Console
          </p>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = !isPricing && activeSection === item.id;
            if (onSelectSection && !isPricing) {
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectSection(item.id);
                    setMobileOpen(false);
                  }}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors cursor-pointer text-left",
                    active
                      ? "bg-[var(--accent-soft)] text-[var(--accent-primary)] border border-[var(--accent-primary)]/20"
                      : "text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            }

            return (
              <Link
                key={item.id}
                href={item.id === "overview" ? "/" : `/?tab=${item.id}`}
                onClick={() => setMobileOpen(false)}
                className="w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)] transition-colors"
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}

          <div className="pt-3 mt-3 border-t border-[var(--border-subtle)]">
            <p className="px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
              Subscription
            </p>
            <Link
              href="/pricing"
              onClick={() => setMobileOpen(false)}
              aria-current={isPricing ? "page" : undefined}
              className={cn(
                "w-full flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isPricing
                  ? "bg-[var(--accent-soft)] text-[var(--accent-primary)] border border-[var(--accent-primary)]/20"
                  : "text-[var(--text-secondary)] border border-transparent hover:bg-[var(--bg-subtle)] hover:text-[var(--text-primary)]"
              )}
            >
              <span className="flex items-center gap-3">
                <CreditCard className="h-4 w-4 shrink-0" aria-hidden="true" />
                Plans & Pricing
              </span>
              <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                $29+
              </span>
            </Link>
          </div>
        </nav>
      </div>

      <div className="p-3 space-y-3 border-t border-[var(--border-subtle)]">
        {onPreviewStateChange ? (
          <div className="space-y-1">
            <p className="px-1 text-[11px] font-medium text-[var(--text-muted)]">
              UI State Preview
            </p>
            <div
              className="grid grid-cols-2 gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1"
              role="group"
              aria-label="Preview UI data state"
            >
              {PREVIEW_STATES.map((state) => (
                <button
                  key={state.id}
                  type="button"
                  onClick={() => onPreviewStateChange(state.id)}
                  className={cn(
                    "rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    previewState === state.id
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
                      : "text-[var(--text-muted)] border border-transparent hover:text-[var(--text-primary)]"
                  )}
                >
                  {state.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={toggleTheme}
          data-testid="theme-toggle"
          className="w-full flex items-center justify-between rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-subtle)] transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            {isDark ? (
              <Moon className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Sun className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{isDark ? "Dark Theme" : "Light Theme"}</span>
          </span>
          <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
            {isDark ? "09090B" : "FAFAFA"}
          </span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile compact header bar */}
      <div className="md:hidden flex items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-[var(--accent-primary)] text-white">
            <Receipt className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            PrintRelay
          </span>
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-md border border-[var(--border-subtle)] p-2 text-[var(--text-secondary)]"
            aria-label="Toggle theme"
          >
            {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-md border border-[var(--border-subtle)] p-2 text-[var(--text-secondary)]"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-[240px] h-full border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]">
            {sidebarBody}
          </div>
          <button
            type="button"
            className="flex-1 bg-black/40"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation overlay"
          />
        </div>
      ) : null}

      {/* Fixed 240px desktop sidebar */}
      <aside className="hidden md:block w-[240px] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)] sticky top-0 h-screen">
        {sidebarBody}
      </aside>
    </>
  );
}
