-- MODEL HINT: Use Orchestrator (Argon) or Gemini 4 Argon (High) when modifying constraints, ledgers, or indexes.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE job_status AS ENUM ('QUEUED', 'DISPATCHED', 'PRINTING', 'ACK', 'FAILED');

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  plan_tier TEXT NOT NULL DEFAULT 'STARTER' CHECK (plan_tier IN ('STARTER', 'GROWTH')),
  subscription_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (subscription_status IN ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'PAUSED')),
  paddle_customer_id TEXT UNIQUE,
  paddle_subscription_id TEXT UNIQUE,
  monthly_price_cents INTEGER NOT NULL DEFAULT 2900 CHECK (monthly_price_cents IN (2900, 9900)),
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL UNIQUE,
  org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE printers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  pairing_code CHAR(6) UNIQUE,
  paper_width_mm SMALLINT NOT NULL CHECK (paper_width_mm IN (58, 80)),
  is_online BOOLEAN NOT NULL DEFAULT FALSE,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE print_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  printer_id UUID NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  payload_type TEXT NOT NULL CHECK (payload_type IN ('JSON_RECEIPT', 'RAW_TEXT', 'HTML')),
  payload JSONB NOT NULL,
  status job_status NOT NULL DEFAULT 'QUEUED',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acked_at TIMESTAMPTZ,
  UNIQUE (org_id, idempotency_key)
);

CREATE INDEX idx_print_jobs_printer_status ON print_jobs(printer_id, status);
