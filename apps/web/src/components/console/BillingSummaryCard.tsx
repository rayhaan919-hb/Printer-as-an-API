import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CreditCard } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SkeletonBlock } from "@/components/ui/states";
import type { BillingSummary, SubscriptionStatus } from "@/lib/api";
import { formatMonthlyPrice, formatTimestamp } from "@/lib/utils";

export interface BillingSummaryCardProps {
  billing: BillingSummary;
  loading: boolean;
}

function subscriptionTone(status: SubscriptionStatus): BadgeTone {
  switch (status) {
    case "ACTIVE":
      return "emerald";
    case "TRIALING":
      return "cobalt";
    case "PAST_DUE":
      return "amber";
    case "CANCELED":
    case "PAUSED":
      return "rose";
  }
}

/** Billing summary section displaying Paddle plan tier, status, and 402 gating notice. */
export function BillingSummaryCard({
  billing,
  loading,
}: BillingSummaryCardProps) {
  if (loading) {
    return (
      <Card data-testid="billing-skeleton">
        <CardHeader>
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-8 w-28" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SkeletonBlock className="h-16 w-full" />
            <SkeletonBlock className="h-16 w-full" />
            <SkeletonBlock className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const isLapsed =
    billing.subscription_status !== "ACTIVE" &&
    billing.subscription_status !== "TRIALING";

  return (
    <Card data-testid="billing-summary">
      <CardHeader>
        <div className="flex items-center gap-3">
          <CreditCard
            className="h-4 w-4 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Billing & Subscription
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Paddle Merchant of Record • {billing.org_name}
            </p>
          </div>
        </div>
        <Link href="/pricing">
          <Button variant="secondary" size="sm">
            Manage Plans
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </Link>
      </CardHeader>

      <CardContent className="space-y-4">
        {isLapsed ? (
          <div
            role="alert"
            className="flex items-start justify-between gap-4 rounded-md border border-[var(--status-offline)]/40 bg-[var(--status-offline-soft)] px-4 py-3"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="h-4 w-4 shrink-0 text-[var(--status-offline)] mt-1"
                aria-hidden="true"
              />
              <div>
                <p className="text-xs font-semibold text-[var(--text-primary)]">
                  HTTP 402 Payment Required — Print Dispatch Gated
                </p>
                <p className="text-xs text-[var(--text-secondary)]">
                  Subscription status is {billing.subscription_status}. Renew via
                  Paddle checkout to restore POST /v1/print throughput.
                </p>
              </div>
            </div>
            <Link href="/pricing">
              <Button variant="primary" size="sm">
                Restore Plan
              </Button>
            </Link>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 space-y-1">
            <p className="text-xs text-[var(--text-muted)]">Current Plan</p>
            <div className="flex items-center gap-2">
              <span className="font-mono-tabular text-base font-semibold text-[var(--text-primary)]">
                {billing.plan_tier}
              </span>
              <Badge tone="cobalt" mono>
                {formatMonthlyPrice(billing.monthly_price_cents)}
              </Badge>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 space-y-1">
            <p className="text-xs text-[var(--text-muted)]">
              Subscription Status
            </p>
            <div className="flex items-center gap-2">
              <Badge tone={subscriptionTone(billing.subscription_status)} mono>
                {billing.subscription_status}
              </Badge>
            </div>
          </div>

          <div className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 space-y-1">
            <p className="text-xs text-[var(--text-muted)]">
              Current Period End
            </p>
            <p className="font-mono-tabular text-xs font-medium text-[var(--text-primary)] pt-1">
              {billing.current_period_end
                ? formatTimestamp(billing.current_period_end)
                : "Active monthly cycle"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
