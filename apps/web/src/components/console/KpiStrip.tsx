import { Activity, Clock, Printer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/ui/states";
import type { DashboardMetrics, PrintJob } from "@/lib/api";

export interface KpiStripProps {
  metrics: DashboardMetrics;
  jobs: PrintJob[];
  loading: boolean;
}

/** 3-card KPI strip displaying Jobs Today, Online Printers, and Avg Latency ms. */
export function KpiStrip({ metrics, jobs, loading }: KpiStripProps) {
  if (loading) {
    return (
      <section
        aria-label="Key performance metrics loading"
        data-testid="kpi-skeleton"
        className="grid grid-cols-1 md:grid-cols-3 gap-4"
      >
        {[0, 1, 2].map((idx) => (
          <Card key={idx} className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="h-4 w-4" />
            </div>
            <SkeletonBlock className="h-8 w-20" />
            <SkeletonBlock className="h-3 w-36" />
          </Card>
        ))}
      </section>
    );
  }

  const ackedCount = jobs.filter((j) => j.status === "ACK").length;
  const failedCount = jobs.filter((j) => j.status === "FAILED").length;
  const pendingCount = jobs.length - ackedCount - failedCount;

  return (
    <section
      aria-label="Key performance metrics"
      data-testid="kpi-strip"
      className="grid grid-cols-1 md:grid-cols-3 gap-4"
    >
      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Jobs Today
          </span>
          <Activity
            className="h-4 w-4 text-[var(--accent-primary)]"
            aria-hidden="true"
          />
        </div>
        <p className="font-mono-tabular text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          {metrics.jobs_today}
        </p>
        <p className="font-mono-tabular text-xs text-[var(--text-muted)]">
          {ackedCount} ACK • {pendingCount} In-flight • {failedCount} Failed
        </p>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Online Printers
          </span>
          <Printer
            className="h-4 w-4 text-[var(--status-online)]"
            aria-hidden="true"
          />
        </div>
        <div className="flex items-baseline gap-2">
          <p className="font-mono-tabular text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
            {metrics.online_printers}
            <span className="text-base font-normal text-[var(--text-muted)]">
              {" "}
              / {metrics.total_printers}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{
              backgroundColor:
                metrics.online_printers > 0
                  ? "var(--status-online)"
                  : "var(--status-offline)",
            }}
            aria-hidden="true"
          />
          <span>
            {metrics.online_printers > 0
              ? "WebSocket relay active"
              : "No active agent sockets"}
          </span>
        </div>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            Avg Latency ms
          </span>
          <Clock
            className="h-4 w-4 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
        </div>
        <p className="font-mono-tabular text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
          {metrics.avg_latency_ms}
          <span className="text-sm font-normal text-[var(--text-muted)]">
            {" "}
            ms
          </span>
        </p>
        <p className="text-xs text-[var(--text-muted)]">
          API enqueue to ESC/POS hardware ACK
        </p>
      </Card>
    </section>
  );
}
