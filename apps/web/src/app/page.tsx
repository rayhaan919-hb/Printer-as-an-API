"use client";

import * as React from "react";
import { Server, WifiOff } from "lucide-react";
import { ApiKeysSection } from "@/components/console/ApiKeysSection";
import { BillingSummaryCard } from "@/components/console/BillingSummaryCard";
import { JobsSection } from "@/components/console/JobsSection";
import { KpiStrip } from "@/components/console/KpiStrip";
import { PrintersSection } from "@/components/console/PrintersSection";
import {
  Sidebar,
  type ConsoleSection,
  type PreviewState,
} from "@/components/console/Sidebar";
import { Badge } from "@/components/ui/badge";
import { InlineErrorBanner } from "@/components/ui/states";
import {
  API_BASE,
  computeMetrics,
  dispatchPrintJobRequest,
  fetchDashboardState,
  generateApiKeyRequest,
  pairPrinterRequest,
  revokeApiKeyRequest,
  SEED_API_KEYS,
  SEED_BILLING,
  SEED_JOBS,
  SEED_PRINTERS,
  type DashboardData,
  type GeneratedApiKeyResponse,
  type PayloadType,
  type PrintJob,
} from "@/lib/api";

const SECTION_TITLES: Record<ConsoleSection, string> = {
  overview: "Developer Console",
  jobs: "Print Jobs",
  printers: "Paired Printers",
  "api-keys": "API Keys",
  billing: "Billing & Subscription",
};

const EMPTY_DASHBOARD: DashboardData = {
  printers: [],
  jobs: [],
  apiKeys: [],
  billing: SEED_BILLING,
  metrics: {
    jobs_today: 0,
    online_printers: 0,
    total_printers: 0,
    avg_latency_ms: 0,
  },
  backendConnected: false,
  errorMessage: null,
  errorStatus: null,
};

export default function ConsolePage() {
  const [activeSection, setActiveSection] =
    React.useState<ConsoleSection>("overview");
  const [previewState, setPreviewState] = React.useState<PreviewState>("live");
  const [dashboard, setDashboard] = React.useState<DashboardData>({
    printers: SEED_PRINTERS,
    jobs: SEED_JOBS,
    apiKeys: SEED_API_KEYS,
    billing: SEED_BILLING,
    metrics: computeMetrics(SEED_PRINTERS, SEED_JOBS),
    backendConnected: false,
    errorMessage: null,
    errorStatus: null,
  });
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [autoRefresh, setAutoRefresh] = React.useState(true);
  const [activeApiKey, setActiveApiKey] = React.useState("");
  const [composerPrinterId, setComposerPrinterId] = React.useState<
    string | null
  >(null);

  // Sync optional ?tab= query parameter without Next.js Suspense bailout
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (
      tab === "overview" ||
      tab === "jobs" ||
      tab === "printers" ||
      tab === "api-keys" ||
      tab === "billing"
    ) {
      setActiveSection(tab);
    }
    try {
      const savedKey = sessionStorage.getItem("printer_api_active_key");
      if (savedKey) {
        setActiveApiKey(savedKey);
      }
    } catch {
      // Ignore storage failures
    }
  }, []);

  const loadDashboard = React.useCallback(async (showSkeleton = false) => {
    if (showSkeleton) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    try {
      const next = await fetchDashboardState();
      setDashboard((prev) => {
        if (next.backendConnected) {
          return next;
        }
        // In offline sandbox mode, preserve locally created mutations unless initial load
        if (showSkeleton) {
          return next;
        }
        return {
          ...next,
          printers: prev.printers,
          jobs: prev.jobs,
          apiKeys: prev.apiKeys,
          metrics: computeMetrics(prev.printers, prev.jobs),
        };
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void loadDashboard(true);
  }, [loadDashboard]);

  // Live 2s polling when Live Sync is active and backend is connected
  React.useEffect(() => {
    if (!autoRefresh || previewState !== "live" || !dashboard.backendConnected) {
      return;
    }
    const timer = setInterval(() => {
      void loadDashboard(false);
    }, 2000);
    return () => clearInterval(timer);
  }, [autoRefresh, dashboard.backendConnected, loadDashboard, previewState]);

  const handlePairPrinter = React.useCallback(
    async (input: {
      pairing_code: string;
      name: string;
      paper_width_mm: 58 | 80;
    }) => {
      const created = await pairPrinterRequest(input);
      setDashboard((prev) => {
        const nextPrinters = [created, ...prev.printers];
        return {
          ...prev,
          printers: nextPrinters,
          metrics: computeMetrics(nextPrinters, prev.jobs),
        };
      });
      if (dashboard.backendConnected) {
        await loadDashboard(false);
      }
    },
    [dashboard.backendConnected, loadDashboard]
  );

  const handleDispatchPrint = React.useCallback(
    async (input: {
      printer_id: string;
      printer_name: string;
      payload_type: PayloadType;
      payload: Record<string, unknown>;
      idempotency_key: string;
      api_key?: string;
    }): Promise<PrintJob> => {
      const created = await dispatchPrintJobRequest(input);
      setDashboard((prev) => {
        const deduped = prev.jobs.filter((j) => j.job_id !== created.job_id);
        const nextJobs = [created, ...deduped];
        return {
          ...prev,
          jobs: nextJobs,
          metrics: computeMetrics(prev.printers, nextJobs),
        };
      });

      if (dashboard.backendConnected) {
        // Poll promptly so Playwright E2E sees QUEUED -> DISPATCHED -> ACK cleanly
        setTimeout(() => {
          void loadDashboard(false);
        }, 350);
      } else {
        // Offline sandbox visual lifecycle demonstration
        setTimeout(() => {
          setDashboard((prev) => {
            const nextJobs = prev.jobs.map((j) =>
              j.job_id === created.job_id
                ? { ...j, status: "DISPATCHED" as const }
                : j
            );
            return { ...prev, jobs: nextJobs };
          });
        }, 450);
        setTimeout(() => {
          setDashboard((prev) => {
            const nextJobs = prev.jobs.map((j) =>
              j.job_id === created.job_id
                ? {
                    ...j,
                    status: "ACK" as const,
                    latency_ms: 34,
                    acked_at: new Date().toISOString(),
                  }
                : j
            );
            return {
              ...prev,
              jobs: nextJobs,
              metrics: computeMetrics(prev.printers, nextJobs),
            };
          });
        }, 1200);
      }

      return created;
    },
    [dashboard.backendConnected, loadDashboard]
  );

  const handleGenerateKey = React.useCallback(
    async (name: string): Promise<GeneratedApiKeyResponse> => {
      const result = await generateApiKeyRequest({ name });
      setActiveApiKey(result.raw_key);
      try {
        sessionStorage.setItem("printer_api_active_key", result.raw_key);
      } catch {
        // Ignore storage errors
      }
      setDashboard((prev) => ({
        ...prev,
        apiKeys: [result.record, ...prev.apiKeys],
      }));
      if (dashboard.backendConnected) {
        await loadDashboard(false);
      }
      return result;
    },
    [dashboard.backendConnected, loadDashboard]
  );

  const handleRevokeKey = React.useCallback(
    async (id: string) => {
      await revokeApiKeyRequest(id);
      setDashboard((prev) => ({
        ...prev,
        apiKeys: prev.apiKeys.filter((k) => k.id !== id),
      }));
      if (dashboard.backendConnected) {
        await loadDashboard(false);
      }
    },
    [dashboard.backendConnected, loadDashboard]
  );

  const handleRetryGlobal = React.useCallback(async () => {
    setPreviewState("live");
    await loadDashboard(true);
  }, [loadDashboard]);

  const effectiveLoading = loading || previewState === "loading";
  const effectiveData =
    previewState === "empty" ? EMPTY_DASHBOARD : dashboard;

  const globalErrorMessage =
    previewState === "error"
      ? "Simulated API fault (503 Service Unavailable): PostgreSQL connection pool exhausted."
      : dashboard.errorMessage;

  const showAll = activeSection === "overview";

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[var(--bg-canvas)]">
      <Sidebar
        activeSection={activeSection}
        onSelectSection={setActiveSection}
        previewState={previewState}
        onPreviewStateChange={setPreviewState}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Minimal Linear-style top bar */}
        <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                {SECTION_TITLES[activeSection]}
              </h1>
              <Badge
                tone={dashboard.backendConnected ? "emerald" : "amber"}
                mono
              >
                {dashboard.backendConnected ? (
                  <>
                    <Server className="h-3 w-3" aria-hidden="true" />
                    API Connected
                  </>
                ) : (
                  <>
                    <WifiOff className="h-3 w-3" aria-hidden="true" />
                    Offline Sandbox
                  </>
                )}
              </Badge>
            </div>

            <div className="flex items-center gap-3 text-xs font-mono-tabular text-[var(--text-muted)]">
              <span>Endpoint: {API_BASE}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1200px] mx-auto p-6 space-y-6">
          {globalErrorMessage && !effectiveLoading ? (
            <InlineErrorBanner
              title={
                dashboard.errorStatus === 0
                  ? "Backend API Unreachable (Sandbox Active)"
                  : "API Sync Error"
              }
              message={globalErrorMessage}
              isRetrying={refreshing || loading}
              onRetry={() => {
                void handleRetryGlobal();
              }}
            />
          ) : null}

          {showAll ||
          activeSection === "jobs" ||
          activeSection === "printers" ? (
            <KpiStrip
              metrics={effectiveData.metrics}
              jobs={effectiveData.jobs}
              loading={effectiveLoading}
            />
          ) : null}

          {showAll || activeSection === "jobs" ? (
            <JobsSection
              jobs={effectiveData.jobs}
              printers={effectiveData.printers}
              loading={effectiveLoading}
              activeApiKey={activeApiKey}
              autoRefresh={autoRefresh}
              onToggleAutoRefresh={() => setAutoRefresh((prev) => !prev)}
              onRefresh={() => loadDashboard(false)}
              isRefreshing={refreshing}
              externalComposerPrinterId={composerPrinterId}
              onClearExternalComposer={() => setComposerPrinterId(null)}
              onDispatchPrint={handleDispatchPrint}
            />
          ) : null}

          {showAll || activeSection === "printers" ? (
            <PrintersSection
              printers={effectiveData.printers}
              loading={effectiveLoading}
              onPairPrinter={handlePairPrinter}
              onQuickTestPrint={(printerId) => {
                setComposerPrinterId(printerId);
                if (activeSection !== "overview") {
                  setActiveSection("jobs");
                }
              }}
            />
          ) : null}

          {showAll || activeSection === "api-keys" ? (
            <ApiKeysSection
              apiKeys={effectiveData.apiKeys}
              loading={effectiveLoading}
              onGenerateKey={handleGenerateKey}
              onRevokeKey={handleRevokeKey}
            />
          ) : null}

          {showAll || activeSection === "billing" ? (
            <BillingSummaryCard
              billing={effectiveData.billing}
              loading={effectiveLoading}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
