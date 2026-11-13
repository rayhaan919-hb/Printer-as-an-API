"use client";

import * as React from "react";
import { Plus, Printer as PrinterIcon, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import {
  EmptyStateCard,
  InlineErrorBanner,
  SkeletonBlock,
} from "@/components/ui/states";
import type { Printer } from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";

export interface PrintersSectionProps {
  printers: Printer[];
  loading: boolean;
  onPairPrinter: (input: {
    pairing_code: string;
    name: string;
    paper_width_mm: 58 | 80;
  }) => Promise<void>;
  onQuickTestPrint?: (printerId: string) => void;
}

/** Printers list & 6-digit pairing UI per POST /v1/printers/pair. */
export function PrintersSection({
  printers,
  loading,
  onPairPrinter,
  onQuickTestPrint,
}: PrintersSectionProps) {
  const [showForm, setShowForm] = React.useState(false);
  const [pairingCode, setPairingCode] = React.useState("");
  const [printerName, setPrinterName] = React.useState("");
  const [paperWidth, setPaperWidth] = React.useState<58 | 80>(80);
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = React.useState<{
    pairing_code: string;
    name: string;
    paper_width_mm: 58 | 80;
  } | null>(null);

  const submitPairing = React.useCallback(
    async (payload: {
      pairing_code: string;
      name: string;
      paper_width_mm: 58 | 80;
    }) => {
      setErrorMsg(null);
      setLastAttempt(payload);
      setSubmitting(true);
      try {
        await onPairPrinter(payload);
        setPairingCode("");
        setPrinterName("");
        setPaperWidth(80);
        setShowForm(false);
        setLastAttempt(null);
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to pair printer."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [onPairPrinter]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanedCode = pairingCode.trim();
    const cleanedName = printerName.trim();

    if (!/^\d{6}$/.test(cleanedCode)) {
      setErrorMsg("Pairing code must be a 6-digit numeric code.");
      return;
    }
    if (!cleanedName) {
      setErrorMsg("Printer name is required.");
      return;
    }

    await submitPairing({
      pairing_code: cleanedCode,
      name: cleanedName,
      paper_width_mm: paperWidth,
    });
  };

  if (loading) {
    return (
      <Card data-testid="printers-skeleton">
        <CardHeader>
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-8 w-28" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1, 2].map((idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-4 rounded-md border border-[var(--border-subtle)] p-4"
            >
              <div className="space-y-2">
                <SkeletonBlock className="h-4 w-56" />
                <SkeletonBlock className="h-3 w-40" />
              </div>
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-6 w-16" />
                <SkeletonBlock className="h-6 w-16" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <PrinterIcon
            className="h-4 w-4 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Paired Thermal Printers
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Android ESC/POS Print Agents connected over WebSocket relay
            </p>
          </div>
        </div>
        <Button
          variant={showForm ? "secondary" : "primary"}
          size="sm"
          data-testid="pair-printer-btn"
          onClick={() => {
            setShowForm((prev) => !prev);
            setErrorMsg(null);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {showForm ? "Cancel" : "Pair Printer"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {errorMsg ? (
          <InlineErrorBanner
            title="Printer Pairing Failed"
            message={errorMsg}
            testId="printers-error-banner"
            isRetrying={submitting}
            onRetry={
              lastAttempt
                ? () => {
                    void submitPairing(lastAttempt);
                  }
                : () => setErrorMsg(null)
            }
          />
        ) : null}

        {showForm ? (
          <form
            onSubmit={handleSubmit}
            data-testid="pair-printer-form"
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <label
                  htmlFor="pairing-code-input"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  6-Digit Pairing Code
                </label>
                <Input
                  id="pairing-code-input"
                  value={pairingCode}
                  onChange={(e) =>
                    setPairingCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="482910"
                  maxLength={6}
                  inputMode="numeric"
                  className="font-mono-tabular tracking-widest"
                  required
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="printer-name-input"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Printer Label
                </label>
                <Input
                  id="printer-name-input"
                  value={printerName}
                  onChange={(e) => setPrinterName(e.target.value)}
                  placeholder="Kitchen Thermal #04"
                  required
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="paper-width-select"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Paper Width
                </label>
                <Select
                  id="paper-width-select"
                  value={String(paperWidth)}
                  onChange={(e) =>
                    setPaperWidth(e.target.value === "58" ? 58 : 80)
                  }
                >
                  <option value="80">80mm (576 dots @ 203 DPI)</option>
                  <option value="58">58mm (384 dots @ 203 DPI)</option>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowForm(false)}
              >
                Close
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={submitting}
                data-testid="pair-printer-submit"
              >
                {submitting ? "Pairing..." : "Complete Pairing"}
              </Button>
            </div>
          </form>
        ) : null}

        {printers.length === 0 ? (
          <EmptyStateCard
            testId="printers-empty"
            icon={<PrinterIcon className="h-5 w-5" aria-hidden="true" />}
            title="No paired printers yet"
            description="Enter the 6-digit code shown in the Android Print Agent app to bind your first thermal printer."
            ctaLabel="Pair Printer"
            onCtaClick={() => setShowForm(true)}
          />
        ) : (
          <div data-testid="printers-list" className="space-y-3">
            {printers.map((printer) => {
              const isOnline = printer.status === "ONLINE";
              return (
                <div
                  key={printer.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: isOnline
                            ? "var(--status-online)"
                            : "var(--status-offline)",
                        }}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {printer.name}
                      </span>
                      <Badge tone={isOnline ? "emerald" : "rose"} mono>
                        {printer.status}
                      </Badge>
                      <Badge tone="neutral" mono>
                        {printer.paper_width_mm}mm
                      </Badge>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono-tabular text-[var(--text-muted)]">
                      <span>ID: {printer.id}</span>
                      <span>Code: {printer.pairing_code}</span>
                      <span>Agent: {printer.agent_version}</span>
                      <span>
                        Last seen: {formatTimestamp(printer.last_seen_at)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <p className="text-[11px] text-[var(--text-muted)]">
                        RTT Latency
                      </p>
                      <p className="font-mono-tabular text-xs font-medium text-[var(--text-primary)]">
                        {isOnline ? `${printer.latency_ms} ms` : "—"}
                      </p>
                    </div>
                    {onQuickTestPrint ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => onQuickTestPrint(printer.id)}
                      >
                        <Send className="h-3.5 w-3.5" aria-hidden="true" />
                        Print
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
