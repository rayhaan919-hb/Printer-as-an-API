"use client";

import * as React from "react";
import { KeyRound, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  CopyButton,
  EmptyStateCard,
  InlineErrorBanner,
  SkeletonBlock,
} from "@/components/ui/states";
import type { ApiKeyRecord, GeneratedApiKeyResponse } from "@/lib/api";
import { formatTimestamp } from "@/lib/utils";

export interface ApiKeysSectionProps {
  apiKeys: ApiKeyRecord[];
  loading: boolean;
  onGenerateKey: (name: string) => Promise<GeneratedApiKeyResponse>;
  onRevokeKey: (id: string) => Promise<void>;
}

/** API Key Generator & SHA-256 prefix table supporting POST /v1/api-keys and DELETE /v1/api-keys/:id. */
export function ApiKeysSection({
  apiKeys,
  loading,
  onGenerateKey,
  onRevokeKey,
}: ApiKeysSectionProps) {
  const [keyName, setKeyName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [revokingId, setRevokingId] = React.useState<string | null>(null);
  const [revealedKey, setRevealedKey] = React.useState<string | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const [showGenerator, setShowGenerator] = React.useState(false);

  const handleGenerate = React.useCallback(
    async (requestedName: string) => {
      setErrorMsg(null);
      setCreating(true);
      try {
        const result = await onGenerateKey(
          requestedName.trim() || "POS Integration Key"
        );
        setRevealedKey(result.raw_key);
        setKeyName("");
        setShowGenerator(false);
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to generate API key."
        );
      } finally {
        setCreating(false);
      }
    },
    [onGenerateKey]
  );

  const handleRevoke = React.useCallback(
    async (id: string) => {
      setErrorMsg(null);
      setRevokingId(id);
      try {
        await onRevokeKey(id);
      } catch (err: unknown) {
        setErrorMsg(
          err instanceof Error ? err.message : "Failed to revoke API key."
        );
      } finally {
        setRevokingId(null);
      }
    },
    [onRevokeKey]
  );

  if (loading) {
    return (
      <Card data-testid="apikeys-skeleton">
        <CardHeader>
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBlock className="h-8 w-36" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[0, 1].map((idx) => (
            <div
              key={idx}
              className="flex items-center justify-between gap-4 rounded-md border border-[var(--border-subtle)] p-4"
            >
              <div className="space-y-2">
                <SkeletonBlock className="h-4 w-48" />
                <SkeletonBlock className="h-3 w-64" />
              </div>
              <SkeletonBlock className="h-8 w-20" />
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
          <KeyRound
            className="h-4 w-4 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              API Keys
            </h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Bearer tokens hashed with SHA-256 at rest for POST /v1/print
            </p>
          </div>
        </div>
        <Button
          variant={showGenerator ? "secondary" : "primary"}
          size="sm"
          data-testid="generate-api-key-btn"
          onClick={() => {
            setShowGenerator((prev) => !prev);
            setErrorMsg(null);
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {showGenerator ? "Cancel" : "Generate API Key"}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {errorMsg ? (
          <InlineErrorBanner
            title="API Key Operation Failed"
            message={errorMsg}
            testId="apikeys-error-banner"
            isRetrying={creating}
            onRetry={() => {
              void handleGenerate(keyName);
            }}
          />
        ) : null}

        {showGenerator ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleGenerate(keyName);
            }}
            className="flex flex-wrap items-end gap-3 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4"
          >
            <div className="flex-1 min-w-[220px] space-y-1">
              <label
                htmlFor="api-key-name-input"
                className="block text-xs font-medium text-[var(--text-secondary)]"
              >
                Key Name
              </label>
              <Input
                id="api-key-name-input"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                placeholder="Production POS Cluster"
                required
              />
            </div>
            <Button
              type="submit"
              variant="primary"
              size="md"
              disabled={creating}
              data-testid="generate-api-key-submit"
            >
              {creating ? "Generating..." : "Create Key"}
            </Button>
          </form>
        ) : null}

        {revealedKey ? (
          <div
            data-testid="new-api-key-banner"
            className="rounded-md border border-[var(--status-online)]/40 bg-[var(--status-online-soft)] p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck
                  className="h-4 w-4 text-[var(--status-online)]"
                  aria-hidden="true"
                />
                <span className="text-xs font-semibold text-[var(--text-primary)]">
                  API Key Created — Copy Once
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRevealedKey(null)}
              >
                Dismiss
              </Button>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              This raw secret is displayed once and stored only as a SHA-256
              digest. It has also been populated into the Test Print runner for
              this session.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2">
              <code className="font-mono-tabular text-xs text-[var(--text-primary)] break-all">
                {revealedKey}
              </code>
              <CopyButton value={revealedKey} label="Copy Key" />
            </div>
          </div>
        ) : null}

        {apiKeys.length === 0 ? (
          <EmptyStateCard
            testId="apikeys-empty"
            icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
            title="No API keys provisioned"
            description="Generate a Bearer token to authenticate your backend POS webhooks against POST /v1/print."
            ctaLabel="Generate API Key"
            onCtaClick={() => setShowGenerator(true)}
          />
        ) : (
          <div data-testid="apikeys-list" className="space-y-3">
            {apiKeys.map((item) => (
              <div
                key={item.id}
                className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-[var(--text-primary)]">
                      {item.name}
                    </span>
                    <Badge tone="cobalt" mono>
                      {item.key_prefix}••••
                    </Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-mono-tabular text-[var(--text-muted)]">
                    <span>SHA-256: {item.sha256_hash.slice(0, 16)}…</span>
                    <span>Created: {formatTimestamp(item.created_at)}</span>
                    <span>
                      Last used:{" "}
                      {item.last_used_at
                        ? formatTimestamp(item.last_used_at)
                        : "Never"}
                    </span>
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="danger"
                  disabled={revokingId === item.id}
                  onClick={() => {
                    void handleRevoke(item.id);
                  }}
                  aria-label={`Revoke ${item.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {revokingId === item.id ? "Revoking..." : "Revoke"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
