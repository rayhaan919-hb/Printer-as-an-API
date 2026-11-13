"use client";

import * as React from "react";
import Link from "next/link";
import {
  Eye,
  FileText,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  X,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import {
  CopyButton,
  EmptyStateCard,
  InlineErrorBanner,
  SkeletonBlock,
} from "@/components/ui/states";
import {
  ApiRequestError,
  type JobStatus,
  type PayloadType,
  type Printer,
  type PrintJob,
} from "@/lib/api";
import { cn, formatTimestamp, generateIdempotencyKey } from "@/lib/utils";

export type JobFilterStatus = "ALL" | JobStatus;

const STATUS_FILTERS: JobFilterStatus[] = [
  "ALL",
  "QUEUED",
  "DISPATCHED",
  "PRINTING",
  "ACK",
  "FAILED",
];

const PAYLOAD_TEMPLATES: Record<PayloadType, string> = {
  JSON_RECEIPT: JSON.stringify(
    {
      title: "Order #8850",
      items: [
        { name: "Flat White", qty: 2, price: "$9.00" },
        { name: "Almond Croissant", qty: 1, price: "$5.50" },
      ],
      total: "$14.50",
    },
    null,
    2
  ),
  RAW_TEXT: "KITCHEN TICKET #8850\n2x Flat White\n1x Almond Croissant\n----------------\nCUT",
  HTML: "<h2>Order #8850</h2><p>2x Flat White — <strong>$9.00</strong></p>",
};

function jobStatusTone(status: JobStatus): BadgeTone {
  switch (status) {
    case "ACK":
      return "emerald";
    case "PRINTING":
    case "DISPATCHED":
      return "cobalt";
    case "QUEUED":
      return "amber";
    case "FAILED":
      return "rose";
  }
}

export interface JobsSectionProps {
  jobs: PrintJob[];
  printers: Printer[];
  loading: boolean;
  activeApiKey: string;
  autoRefresh: boolean;
  onToggleAutoRefresh: () => void;
  onRefresh: () => Promise<void>;
  isRefreshing: boolean;
  externalComposerPrinterId?: string | null;
  onClearExternalComposer?: () => void;
  onDispatchPrint: (input: {
    printer_id: string;
    printer_name: string;
    payload_type: PayloadType;
    payload: Record<string, unknown>;
    idempotency_key: string;
    api_key?: string;
  }) => Promise<PrintJob>;
}

/** Live filterable print job table with Send Test Print form, job inspector, and Retry action. */
export function JobsSection({
  jobs,
  printers,
  loading,
  activeApiKey,
  autoRefresh,
  onToggleAutoRefresh,
  onRefresh,
  isRefreshing,
  externalComposerPrinterId,
  onClearExternalComposer,
  onDispatchPrint,
}: JobsSectionProps) {
  const [statusFilter, setStatusFilter] =
    React.useState<JobFilterStatus>("ALL");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [composerOpen, setComposerOpen] = React.useState(false);
  const [selectedPrinterId, setSelectedPrinterId] = React.useState("");
  const [payloadType, setPayloadType] =
    React.useState<PayloadType>("JSON_RECEIPT");
  const [payloadText, setPayloadText] = React.useState(
    PAYLOAD_TEMPLATES.JSON_RECEIPT
  );
  const [apiKeyInput, setApiKeyInput] = React.useState(activeApiKey);
  const [idempotencyKey, setIdempotencyKey] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [retryingJobId, setRetryingJobId] = React.useState<string | null>(null);
  const [inspectedJobId, setInspectedJobId] = React.useState<string | null>(
    null
  );
  const [actionError, setActionError] = React.useState<{
    message: string;
    isPaymentRequired: boolean;
  } | null>(null);

  React.useEffect(() => {
    setIdempotencyKey(generateIdempotencyKey());
  }, []);

  React.useEffect(() => {
    if (activeApiKey) {
      setApiKeyInput(activeApiKey);
    }
  }, [activeApiKey]);

  React.useEffect(() => {
    if (printers.length === 0) {
      if (selectedPrinterId !== "") {
        setSelectedPrinterId("");
      }
      return;
    }
    const stillExists = printers.some((p) => p.id === selectedPrinterId);
    if (!stillExists) {
      const online = printers.find((p) => p.status === "ONLINE");
      setSelectedPrinterId((online ?? printers[0]).id);
    }
  }, [printers, selectedPrinterId]);

  React.useEffect(() => {
    if (externalComposerPrinterId) {
      setSelectedPrinterId(externalComposerPrinterId);
      setComposerOpen(true);
      setActionError(null);
      onClearExternalComposer?.();
    }
  }, [externalComposerPrinterId, onClearExternalComposer]);

  const handlePayloadTypeChange = (nextType: PayloadType) => {
    setPayloadType(nextType);
    setPayloadText(PAYLOAD_TEMPLATES[nextType]);
  };

  const buildPayloadObject = React.useCallback((): Record<string, unknown> => {
    if (payloadType === "JSON_RECEIPT") {
      const parsed: unknown = JSON.parse(payloadText);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        throw new Error("JSON_RECEIPT payload must be a JSON object.");
      }
      return parsed as Record<string, unknown>;
    }
    if (payloadType === "RAW_TEXT") {
      return { text: payloadText };
    }
    return { html: payloadText };
  }, [payloadText, payloadType]);

  const submitTestPrint = React.useCallback(async () => {
    setActionError(null);
    const targetPrinter = printers.find((p) => p.id === selectedPrinterId);
    if (!targetPrinter) {
      setActionError({
        message: "Pair or select a target printer before dispatching a job.",
        isPaymentRequired: false,
      });
      return;
    }

    let payloadObj: Record<string, unknown>;
    try {
      payloadObj = buildPayloadObject();
    } catch (err: unknown) {
      setActionError({
        message:
          err instanceof Error ? err.message : "Invalid JSON payload body.",
        isPaymentRequired: false,
      });
      return;
    }

    setSubmitting(true);
    try {
      await onDispatchPrint({
        printer_id: targetPrinter.id,
        printer_name: targetPrinter.name,
        payload_type: payloadType,
        payload: payloadObj,
        idempotency_key: idempotencyKey.trim() || generateIdempotencyKey(),
        api_key: apiKeyInput.trim() || undefined,
      });
      setIdempotencyKey(generateIdempotencyKey());
      setComposerOpen(false);
    } catch (err: unknown) {
      const is402 = err instanceof ApiRequestError && err.status === 402;
      setActionError({
        message:
          err instanceof Error ? err.message : "Failed to dispatch print job.",
        isPaymentRequired: is402,
      });
    } finally {
      setSubmitting(false);
    }
  }, [
    apiKeyInput,
    buildPayloadObject,
    idempotencyKey,
    onDispatchPrint,
    payloadType,
    printers,
    selectedPrinterId,
  ]);

  const handleRetryFailedJob = React.useCallback(
    async (job: PrintJob) => {
      setActionError(null);
      setRetryingJobId(job.job_id);
      try {
        await onDispatchPrint({
          printer_id: job.printer_id,
          printer_name: job.printer_name,
          payload_type: job.payload_type,
          payload: job.raw_payload ?? {
            title: "Retry Job",
            original_job_id: job.job_id,
          },
          idempotency_key: generateIdempotencyKey("idem_retry"),
          api_key: apiKeyInput.trim() || undefined,
        });
      } catch (err: unknown) {
        const is402 = err instanceof ApiRequestError && err.status === 402;
        setActionError({
          message:
            err instanceof Error ? err.message : "Failed to retry print job.",
          isPaymentRequired: is402,
        });
      } finally {
        setRetryingJobId(null);
      }
    },
    [apiKeyInput, onDispatchPrint]
  );

  const statusCounts = React.useMemo(() => {
    const counts: Record<JobFilterStatus, number> = {
      ALL: jobs.length,
      QUEUED: 0,
      DISPATCHED: 0,
      PRINTING: 0,
      ACK: 0,
      FAILED: 0,
    };
    for (const job of jobs) {
      counts[job.status] += 1;
    }
    return counts;
  }, [jobs]);

  const filteredJobs = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return jobs.filter((job) => {
      if (statusFilter !== "ALL" && job.status !== statusFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        job.job_id.toLowerCase().includes(q) ||
        job.printer_name.toLowerCase().includes(q) ||
        job.idempotency_key.toLowerCase().includes(q) ||
        job.payload_summary.toLowerCase().includes(q) ||
        job.payload_type.toLowerCase().includes(q)
      );
    });
  }, [jobs, searchQuery, statusFilter]);

  const inspectedJob = React.useMemo(
    () => jobs.find((j) => j.job_id === inspectedJobId) ?? null,
    [inspectedJobId, jobs]
  );

  if (loading) {
    return (
      <Card data-testid="jobs-skeleton">
        <CardHeader>
          <SkeletonBlock className="h-5 w-44" />
          <div className="flex items-center gap-2">
            <SkeletonBlock className="h-8 w-24" />
            <SkeletonBlock className="h-8 w-32" />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SkeletonBlock className="h-8 w-80" />
            <SkeletonBlock className="h-9 w-64" />
          </div>
          <div className="rounded-md border border-[var(--border-subtle)] overflow-hidden">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex items-center justify-between gap-4 px-4 py-3 border-b last:border-b-0 border-[var(--border-subtle)]"
              >
                <SkeletonBlock className="h-4 w-36" />
                <SkeletonBlock className="h-4 w-44" />
                <SkeletonBlock className="h-5 w-24" />
                <SkeletonBlock className="h-5 w-20" />
                <SkeletonBlock className="h-4 w-16" />
                <SkeletonBlock className="h-4 w-32" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div className="flex items-center gap-3">
          <FileText
            className="h-4 w-4 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Live Print Jobs
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Idempotent queue telemetry from POST /v1/print to ESC/POS ACK
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleAutoRefresh}
            className={cn(
              "inline-flex items-center gap-2 h-8 px-3 rounded-md border text-xs font-medium transition-colors cursor-pointer",
              autoRefresh
                ? "border-[var(--status-online)]/30 bg-[var(--status-online-soft)] text-[var(--status-online)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-secondary)]"
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                autoRefresh && "animate-pulse"
              )}
              style={{
                backgroundColor: autoRefresh
                  ? "var(--status-online)"
                  : "var(--text-muted)",
              }}
              aria-hidden="true"
            />
            {autoRefresh ? "Live Sync (2s)" : "Sync Paused"}
          </button>

          <Button
            size="sm"
            variant="secondary"
            data-testid="refresh-jobs-btn"
            disabled={isRefreshing}
            onClick={() => {
              void onRefresh();
            }}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              aria-hidden="true"
            />
            Refresh
          </Button>

          <Button
            size="sm"
            variant={composerOpen ? "secondary" : "primary"}
            data-testid="send-test-print-btn"
            onClick={() => {
              setComposerOpen((prev) => !prev);
              setActionError(null);
            }}
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            {composerOpen ? "Close Runner" : "Send Test Print"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {actionError ? (
          <InlineErrorBanner
            title={
              actionError.isPaymentRequired
                ? "402 Payment Required"
                : "Print Dispatch Failed"
            }
            message={actionError.message}
            testId="jobs-error-banner"
            isRetrying={submitting}
            action={
              actionError.isPaymentRequired ? (
                <Link href="/pricing">
                  <Button size="sm" variant="primary">
                    Update Billing
                  </Button>
                </Link>
              ) : undefined
            }
            onRetry={() => {
              void submitTestPrint();
            }}
          />
        ) : null}

        {composerOpen ? (
          <form
            data-testid="send-test-print-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submitTestPrint();
            }}
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                POST /v1/print Test Runner
              </p>
              <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                202 Accepted • Idempotent Enqueue
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label
                  htmlFor="test-print-printer"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Target Printer
                </label>
                <Select
                  id="test-print-printer"
                  value={selectedPrinterId}
                  onChange={(e) => setSelectedPrinterId(e.target.value)}
                  disabled={printers.length === 0}
                >
                  {printers.length === 0 ? (
                    <option value="">No paired printers available</option>
                  ) : (
                    printers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.paper_width_mm}mm • {p.status})
                      </option>
                    ))
                  )}
                </Select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="test-print-payload-type"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Payload Type
                </label>
                <Select
                  id="test-print-payload-type"
                  value={payloadType}
                  onChange={(e) =>
                    handlePayloadTypeChange(e.target.value as PayloadType)
                  }
                >
                  <option value="JSON_RECEIPT">JSON_RECEIPT</option>
                  <option value="RAW_TEXT">RAW_TEXT</option>
                  <option value="HTML">HTML</option>
                </Select>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="test-print-api-key"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Authorization Bearer Token
                </label>
                <Input
                  id="test-print-api-key"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="pk_live_... (generated in API Keys)"
                  className="font-mono-tabular text-xs"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="test-print-idempotency"
                  className="block text-xs font-medium text-[var(--text-secondary)]"
                >
                  Idempotency-Key Header
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    id="test-print-idempotency"
                    value={idempotencyKey}
                    onChange={(e) => setIdempotencyKey(e.target.value)}
                    className="font-mono-tabular text-xs"
                    required
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setIdempotencyKey(generateIdempotencyKey())}
                  >
                    New Key
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <label
                htmlFor="test-print-payload"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Payload Body ({payloadType})
              </label>
              <Textarea
                id="test-print-payload"
                rows={4}
                value={payloadText}
                onChange={(e) => setPayloadText(e.target.value)}
                className="font-mono-tabular text-xs"
                required
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setComposerOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={submitting || printers.length === 0}
                data-testid="dispatch-print-submit"
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {submitting ? "Dispatching..." : "Dispatch Print Job"}
              </Button>
            </div>
          </form>
        ) : null}

        {/* Filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Filter print jobs by status"
            className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-1"
          >
            {STATUS_FILTERS.map((status) => {
              const active = statusFilter === status;
              return (
                <button
                  key={status}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setStatusFilter(status)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors cursor-pointer",
                    active
                      ? "bg-[var(--bg-surface)] text-[var(--text-primary)] border border-[var(--border-subtle)]"
                      : "text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)]"
                  )}
                >
                  <span>{status}</span>
                  <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                    {statusCounts[status]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-72">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--text-muted)]"
              aria-hidden="true"
            />
            <Input
              id="jobs-search-input"
              aria-label="Search print jobs"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search job ID, printer, key..."
              className="pl-8 h-8 text-xs"
            />
          </div>
        </div>

        {/* Table / Empty state */}
        {filteredJobs.length === 0 ? (
          <EmptyStateCard
            testId="jobs-empty"
            icon={<FileText className="h-5 w-5" aria-hidden="true" />}
            title={
              jobs.length === 0
                ? "No print jobs enqueued yet"
                : "No jobs match the active filter"
            }
            description={
              jobs.length === 0
                ? "Dispatch a test receipt via POST /v1/print to verify live queue telemetry and ESC/POS delivery."
                : "Adjust the status filter or clear your search query to inspect all print jobs."
            }
            ctaLabel={jobs.length === 0 ? "Send Test Print" : "Reset Filters"}
            onCtaClick={() => {
              if (jobs.length === 0) {
                setComposerOpen(true);
              } else {
                setStatusFilter("ALL");
                setSearchQuery("");
              }
            }}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-[var(--border-subtle)]">
            <table
              data-testid="jobs-table"
              className="w-full border-collapse text-left text-xs"
            >
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]">
                  <th className="px-4 py-3 font-medium">Job ID</th>
                  <th className="px-4 py-3 font-medium">Printer</th>
                  <th className="px-4 py-3 font-medium">Payload Type</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Latency</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.map((job) => (
                  <tr
                    key={job.job_id}
                    className="border-b last:border-b-0 border-[var(--border-subtle)] hover:bg-[var(--bg-canvas)] transition-colors"
                  >
                    <td className="px-4 py-3 align-top">
                      <p className="font-mono-tabular font-medium text-[var(--text-primary)]">
                        {job.job_id.slice(0, 18)}
                        {job.job_id.length > 18 ? "…" : ""}
                      </p>
                      <p className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
                        {job.idempotency_key}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-[var(--text-primary)]">
                        {job.printer_name}
                      </p>
                      <p className="text-[11px] text-[var(--text-secondary)] truncate max-w-[220px]">
                        {job.payload_summary}
                      </p>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge tone="neutral" mono>
                        {job.payload_type}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <Badge tone={jobStatusTone(job.status)} mono>
                        {job.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 align-top text-right font-mono-tabular text-[var(--text-primary)]">
                      {job.latency_ms > 0 ? `${job.latency_ms} ms` : "—"}
                    </td>
                    <td className="px-4 py-3 align-top font-mono-tabular text-[var(--text-secondary)] whitespace-nowrap">
                      {formatTimestamp(job.created_at)}
                    </td>
                    <td className="px-4 py-3 align-top text-right">
                      <div className="inline-flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setInspectedJobId((cur) =>
                              cur === job.job_id ? null : job.job_id
                            )
                          }
                        >
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                          Inspect
                        </Button>
                        {job.status === "FAILED" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={retryingJobId === job.job_id}
                            onClick={() => {
                              void handleRetryFailedJob(job);
                            }}
                          >
                            <RotateCw
                              className={cn(
                                "h-3.5 w-3.5",
                                retryingJobId === job.job_id && "animate-spin"
                              )}
                              aria-hidden="true"
                            />
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Job payload & cURL inspector panel */}
        {inspectedJob ? (
          <div
            data-testid="job-inspector"
            className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  Job Inspector
                </span>
                <Badge tone={jobStatusTone(inspectedJob.status)} mono>
                  {inspectedJob.status}
                </Badge>
                <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                  {inspectedJob.job_id}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton value={inspectedJob.job_id} label="Copy ID" />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setInspectedJobId(null)}
                  aria-label="Close job inspector"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            {inspectedJob.error_message ? (
              <p className="rounded border border-[var(--status-offline)]/30 bg-[var(--status-offline-soft)] px-3 py-2 text-xs text-[var(--status-offline)]">
                Error: {inspectedJob.error_message}
              </p>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-[11px] font-medium text-[var(--text-muted)]">
                  Metadata
                </p>
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 space-y-1 font-mono-tabular text-xs">
                  <p>printer_id: {inspectedJob.printer_id}</p>
                  <p>idempotency_key: {inspectedJob.idempotency_key}</p>
                  <p>
                    created_at: {formatTimestamp(inspectedJob.created_at)}
                  </p>
                  <p>
                    acked_at:{" "}
                    {inspectedJob.acked_at
                      ? formatTimestamp(inspectedJob.acked_at)
                      : "Pending"}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[11px] font-medium text-[var(--text-muted)]">
                  Payload ({inspectedJob.payload_type})
                </p>
                <pre className="rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3 font-mono-tabular text-xs overflow-x-auto max-h-40">
                  {JSON.stringify(
                    inspectedJob.raw_payload ?? {
                      summary: inspectedJob.payload_summary,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
