"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CreditCard,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { Sidebar } from "@/components/console/Sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  CopyButton,
  InlineErrorBanner,
  SkeletonBlock,
} from "@/components/ui/states";
import {
  createBillingCheckoutRequest,
  fetchBillingStatus,
  SEED_BILLING,
  type BillingSummary,
} from "@/lib/api";
import { formatMonthlyPrice } from "@/lib/utils";

interface PricingPlan {
  id: "starter" | "growth";
  tier: "STARTER" | "GROWTH";
  name: string;
  priceDisplay: string;
  priceId: string;
  description: string;
  printVolume: string;
  printerLimit: string;
  sla: string;
  features: string[];
}

const PLANS: PricingPlan[] = [
  {
    id: "starter",
    tier: "STARTER",
    name: "Starter",
    priceDisplay: "$29",
    priceId: "pri_starter_29_monthly",
    description:
      "For single-venue kitchens, cafes, and POS integrations shipping deterministic ESC/POS receipts.",
    printVolume: "25,000 jobs / month",
    printerLimit: "Up to 5 paired printers",
    sla: "99.9% API uptime",
    features: [
      "25,000 print jobs included monthly",
      "Up to 5 paired Android Print Agents (58mm & 80mm)",
      "Idempotency-Key deduplication & Room offline retry",
      "JSON_RECEIPT, RAW_TEXT, and HTML raster payloads",
      "99.9% dispatch uptime SLA",
    ],
  },
  {
    id: "growth",
    tier: "GROWTH",
    name: "Growth",
    priceDisplay: "$99",
    priceId: "pri_growth_99_monthly",
    description:
      "For multi-location restaurant groups and cloud POS platforms requiring high-throughput lanes.",
    printVolume: "250,000 jobs / month",
    printerLimit: "Unlimited paired printers",
    sla: "99.95% API uptime",
    features: [
      "250,000 print jobs included monthly",
      "Unlimited paired thermal printers across locations",
      "Priority BullMQ worker queues & WebSocket relay",
      "Unlimited SHA-256 scoped API keys & audit trail",
      "99.95% SLA + priority engineering support",
    ],
  },
];

const COMPARISON_ROWS = [
  {
    metric: "Monthly Print Volume",
    starter: "25,000 jobs",
    growth: "250,000 jobs",
  },
  {
    metric: "Paired Thermal Printers",
    starter: "5 printers",
    growth: "Unlimited",
  },
  {
    metric: "Paper Widths Supported",
    starter: "58mm & 80mm ESC/POS",
    growth: "58mm & 80mm ESC/POS",
  },
  {
    metric: "Offline Android Queue (Room DB)",
    starter: "Included",
    growth: "Included",
  },
  {
    metric: "API Uptime SLA",
    starter: "99.9%",
    growth: "99.95%",
  },
];

export default function PricingPage() {
  const [billing, setBilling] = React.useState<BillingSummary>(SEED_BILLING);
  const [loading, setLoading] = React.useState(true);
  const [fetchError, setFetchError] = React.useState<string | null>(null);
  const [checkoutPlan, setCheckoutPlan] = React.useState<
    "starter" | "growth" | null
  >(null);
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [lastAttemptedPlan, setLastAttemptedPlan] =
    React.useState<PricingPlan | null>(null);
  const [checkoutResult, setCheckoutResult] = React.useState<{
    planName: string;
    priceDisplay: string;
    checkoutUrl: string;
    transactionId: string;
  } | null>(null);

  const loadBilling = React.useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    const res = await fetchBillingStatus();
    setBilling(res.billing);
    if (res.backendConnected && res.errorMessage) {
      setFetchError(res.errorMessage);
    }
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const handleCheckout = React.useCallback(async (plan: PricingPlan) => {
    setCheckoutError(null);
    setLastAttemptedPlan(plan);
    setCheckoutPlan(plan.id);
    try {
      const session = await createBillingCheckoutRequest({
        plan_id: plan.id,
        price_id: plan.priceId,
      });
      setCheckoutResult({
        planName: plan.name,
        priceDisplay: `${plan.priceDisplay}/mo`,
        checkoutUrl: session.checkout_url,
        transactionId: session.transaction_id,
      });
    } catch (err: unknown) {
      setCheckoutError(
        err instanceof Error
          ? err.message
          : "Unable to create Paddle checkout session."
      );
    } finally {
      setCheckoutPlan(null);
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[var(--bg-canvas)]">
      <Sidebar />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
          <div className="max-w-[1200px] mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/">
                <Button size="sm" variant="secondary">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Console
                </Button>
              </Link>
              <h1 className="text-base font-semibold tracking-tight text-[var(--text-primary)]">
                Plans & Paddle Billing
              </h1>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Current:</span>
              <Badge tone="cobalt" mono>
                {billing.plan_tier}{" "}
                {formatMonthlyPrice(billing.monthly_price_cents)}
              </Badge>
              <Badge
                tone={
                  billing.subscription_status === "ACTIVE" ||
                  billing.subscription_status === "TRIALING"
                    ? "emerald"
                    : "rose"
                }
                mono
              >
                {billing.subscription_status}
              </Badge>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-[1200px] mx-auto p-6 space-y-6">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]">
              Transparent usage-tiered pricing
            </h2>
            <p className="text-sm text-[var(--text-secondary)] max-w-2xl">
              Managed via Paddle Merchant of Record with verified webhook sync.
              Upgrade or switch plans without re-pairing Android Print Agents.
            </p>
          </div>

          {fetchError ? (
            <InlineErrorBanner
              title="Failed to Load Billing Status"
              message={fetchError}
              testId="pricing-error-banner"
              onRetry={() => {
                void loadBilling();
              }}
            />
          ) : null}

          {checkoutError ? (
            <InlineErrorBanner
              title="Paddle Checkout Failed"
              message={checkoutError}
              testId="checkout-error-banner"
              isRetrying={checkoutPlan !== null}
              onRetry={() => {
                if (lastAttemptedPlan) {
                  void handleCheckout(lastAttemptedPlan);
                }
              }}
            />
          ) : null}

          {/* 402 Payment Required Billing Gating Notice */}
          <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 flex items-start gap-3">
            <AlertTriangle
              className="h-4 w-4 shrink-0 text-[var(--status-warning)] mt-1"
              aria-hidden="true"
            />
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[var(--text-primary)]">
                Subscription Status Gating (HTTP 402 Payment Required)
              </p>
              <p className="text-xs text-[var(--text-secondary)]">
                Organizations with{" "}
                <code className="font-mono-tabular">PAST_DUE</code>,{" "}
                <code className="font-mono-tabular">CANCELED</code>, or{" "}
                <code className="font-mono-tabular">PAUSED</code> status receive{" "}
                <code className="font-mono-tabular">402 Payment Required</code>{" "}
                on <code className="font-mono-tabular">POST /v1/print</code>{" "}
                until a valid Paddle subscription event restores{" "}
                <code className="font-mono-tabular">ACTIVE</code> status.
              </p>
            </div>
          </div>

          {checkoutResult ? (
            <Card
              data-testid="checkout-result"
              className="border-[var(--status-online)]/40 bg-[var(--status-online-soft)]"
            >
              <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <ShieldCheck
                    className="h-5 w-5 shrink-0 text-[var(--status-online)] mt-1"
                    aria-hidden="true"
                  />
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">
                      Paddle Checkout Initialized — {checkoutResult.planName} (
                      <span className="font-mono-tabular">
                        {checkoutResult.priceDisplay}
                      </span>
                      )
                    </p>
                    <p className="font-mono-tabular text-xs text-[var(--text-secondary)]">
                      transaction_id: {checkoutResult.transactionId}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <CopyButton
                    value={checkoutResult.checkoutUrl}
                    label="Copy URL"
                  />
                  <a
                    href={checkoutResult.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button size="sm" variant="primary">
                      Open Paddle Checkout
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </a>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* Plan Comparison Cards */}
          {loading ? (
            <div
              data-testid="pricing-skeleton"
              className="grid grid-cols-1 md:grid-cols-2 gap-6"
            >
              {[0, 1].map((idx) => (
                <Card key={idx} className="p-6 space-y-4">
                  <SkeletonBlock className="h-6 w-28" />
                  <SkeletonBlock className="h-10 w-32" />
                  <SkeletonBlock className="h-4 w-full" />
                  <SkeletonBlock className="h-24 w-full" />
                  <SkeletonBlock className="h-9 w-full" />
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {PLANS.map((plan) => {
                const isCurrent = billing.plan_tier === plan.tier;
                const isGrowth = plan.id === "growth";
                const isSubmitting = checkoutPlan === plan.id;

                return (
                  <Card
                    key={plan.id}
                    data-testid={`plan-card-${plan.id}`}
                    className={
                      isGrowth
                        ? "border-[var(--accent-primary)] flex flex-col justify-between"
                        : "flex flex-col justify-between"
                    }
                  >
                    <div>
                      <CardHeader>
                        <div className="flex items-center gap-2">
                          <CreditCard
                            className="h-4 w-4 text-[var(--accent-primary)]"
                            aria-hidden="true"
                          />
                          <h3 className="text-base font-semibold text-[var(--text-primary)]">
                            {plan.name}
                          </h3>
                        </div>
                        <div className="flex items-center gap-2">
                          {isCurrent ? (
                            <Badge tone="emerald" mono>
                              Current Plan
                            </Badge>
                          ) : null}
                          {isGrowth ? (
                            <Badge tone="cobalt" mono>
                              Recommended
                            </Badge>
                          ) : null}
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-6">
                        <div className="space-y-2">
                          <div className="flex items-baseline gap-1">
                            <span className="font-mono-tabular text-3xl font-semibold text-[var(--text-primary)]">
                              {plan.priceDisplay}
                            </span>
                            <span className="font-mono-tabular text-sm text-[var(--text-muted)]">
                              /mo
                            </span>
                          </div>
                          <p className="text-xs text-[var(--text-secondary)]">
                            {plan.description}
                          </p>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3">
                          <div>
                            <p className="text-[11px] text-[var(--text-muted)]">
                              Volume
                            </p>
                            <p className="font-mono-tabular text-xs font-medium text-[var(--text-primary)]">
                              {plan.printVolume}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-[var(--text-muted)]">
                              Printers
                            </p>
                            <p className="font-mono-tabular text-xs font-medium text-[var(--text-primary)]">
                              {plan.printerLimit}
                            </p>
                          </div>
                          <div>
                            <p className="text-[11px] text-[var(--text-muted)]">
                              SLA
                            </p>
                            <p className="font-mono-tabular text-xs font-medium text-[var(--text-primary)]">
                              {plan.sla}
                            </p>
                          </div>
                        </div>

                        <ul className="space-y-2">
                          {plan.features.map((feat) => (
                            <li
                              key={feat}
                              className="flex items-start gap-2 text-xs text-[var(--text-secondary)]"
                            >
                              <Check
                                className="h-3.5 w-3.5 shrink-0 text-[var(--status-online)] mt-1"
                                aria-hidden="true"
                              />
                              <span>{feat}</span>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </div>

                    <div className="px-6 pb-6">
                      <Button
                        variant={isGrowth ? "primary" : "secondary"}
                        size="md"
                        className="w-full"
                        disabled={checkoutPlan !== null}
                        data-testid={`checkout-btn-${plan.id}`}
                        onClick={() => {
                          void handleCheckout(plan);
                        }}
                      >
                        {isSubmitting
                          ? "Creating Paddle Session..."
                          : isCurrent
                            ? `Renew ${plan.name} (${plan.priceDisplay}/mo)`
                            : `Select ${plan.name} (${plan.priceDisplay}/mo)`}
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Crisp 1px bordered Plan Matrix */}
          <Card>
            <CardHeader>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Plan Capabilities Comparison
              </h3>
              <span className="font-mono-tabular text-xs text-[var(--text-muted)]">
                USD Monthly Billing
              </span>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--text-muted)]">
                    <th className="px-6 py-3 font-medium">Capability</th>
                    <th className="px-6 py-3 font-medium font-mono-tabular">
                      Starter ($29/mo)
                    </th>
                    <th className="px-6 py-3 font-medium font-mono-tabular">
                      Growth ($99/mo)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row) => (
                    <tr
                      key={row.metric}
                      className="border-b last:border-b-0 border-[var(--border-subtle)]"
                    >
                      <td className="px-6 py-3 font-medium text-[var(--text-primary)]">
                        {row.metric}
                      </td>
                      <td className="px-6 py-3 font-mono-tabular text-[var(--text-secondary)]">
                        {row.starter}
                      </td>
                      <td className="px-6 py-3 font-mono-tabular text-[var(--text-primary)]">
                        {row.growth}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </main>
      </div>
    </div>
  );
}
