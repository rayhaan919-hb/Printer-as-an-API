import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { generatePairingCode, hashApiKey } from './crypto.js';
import type {
  ApiKey,
  ApiKeyWithMeta,
  BillingEvent,
  JobStatus,
  MonthlyPriceCents,
  Organization,
  PaperWidthMm,
  PayloadType,
  PlanTier,
  PrintJob,
  Printer,
  SubscriptionStatus,
} from './types.js';

export const DEFAULT_ORG_ID = '00000000-0000-4000-8000-000000000001';
export const DEFAULT_ORG_NAME = 'Demo Print Workspace';
export const DEFAULT_API_KEY_ID = '00000000-0000-4000-8000-000000000011';
export const DEFAULT_RAW_API_KEY = 'pk_live_default_test_key_0123456789abcdef';
export const DEFAULT_API_KEY_PREFIX = 'pk_live_defa';
export const DEFAULT_PRINTER_ID = '00000000-0000-4000-8000-000000000101';
export const DEFAULT_PRINTER_NAME = 'Kitchen Counter 80mm';
export const DEFAULT_PAIRING_CODE = '482910';

const VALID_PLAN_TIERS: ReadonlySet<string> = new Set(['STARTER', 'GROWTH']);
const VALID_SUBSCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  'ACTIVE',
  'TRIALING',
  'PAST_DUE',
  'CANCELED',
  'PAUSED',
]);
const VALID_PAYLOAD_TYPES: ReadonlySet<string> = new Set(['JSON_RECEIPT', 'RAW_TEXT', 'HTML']);
const VALID_JOB_STATUSES: ReadonlySet<string> = new Set([
  'QUEUED',
  'DISPATCHED',
  'PRINTING',
  'ACK',
  'FAILED',
]);

export type StoreErrorCode =
  | 'UNIQUE_VIOLATION'
  | 'FOREIGN_KEY_VIOLATION'
  | 'CHECK_VIOLATION'
  | 'NOT_FOUND';

export class StoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode, message: string) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}

export interface PgQueryResult {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
}

export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  end?(): Promise<void>;
  exec?(sql: string): Promise<unknown>;
}

export interface BillingUpdateInput {
  plan_tier?: PlanTier;
  subscription_status?: SubscriptionStatus;
  monthly_price_cents?: MonthlyPriceCents;
  paddle_customer_id?: string | null;
  paddle_subscription_id?: string | null;
  current_period_end?: string | null;
}

export interface CreatePrintJobInput {
  orgId: string;
  printerId: string;
  idempotencyKey: string;
  payloadType: PayloadType;
  payload: Record<string, unknown>;
}

export interface DataStore {
  readonly kind: 'postgres' | 'memory';
  ensureSchema?(schemaSql: string): Promise<void>;
  seedDefaults(): Promise<void>;
  getOrganization(orgId: string): Promise<Organization | null>;
  getOrganizationByPaddleIds(
    customerId?: string | null,
    subscriptionId?: string | null,
  ): Promise<Organization | null>;
  updateOrganizationBilling(orgId: string, update: BillingUpdateInput): Promise<Organization>;
  findApiKeyByHash(keyHash: string): Promise<ApiKey | null>;
  touchApiKeyLastUsed(apiKeyId: string): Promise<void>;
  listApiKeys(orgId: string): Promise<ApiKeyWithMeta[]>;
  createApiKey(input: {
    orgId: string;
    keyPrefix: string;
    keyHash: string;
    name?: string;
  }): Promise<ApiKeyWithMeta>;
  deleteApiKey(orgId: string, apiKeyId: string): Promise<boolean>;
  listPrinters(orgId: string): Promise<Printer[]>;
  getPrinter(printerId: string): Promise<Printer | null>;
  getPrinterByPairingCode(pairingCode: string): Promise<Printer | null>;
  reservePairingCode(input: {
    orgId: string;
    name?: string;
    paperWidthMm?: PaperWidthMm;
  }): Promise<{ pairing_code: string; printer: Printer }>;
  pairPrinter(input: {
    orgId: string;
    pairingCode: string;
    name: string;
    paperWidthMm: PaperWidthMm;
  }): Promise<Printer>;
  setPrinterOnline(printerId: string, isOnline: boolean): Promise<Printer | null>;
  createOrGetPrintJob(
    input: CreatePrintJobInput,
  ): Promise<{ job: PrintJob; deduplicated: boolean }>;
  getPrintJob(jobId: string, orgId?: string): Promise<PrintJob | null>;
  listPrintJobs(
    orgId: string,
    filters?: { printerId?: string; status?: JobStatus; limit?: number },
  ): Promise<PrintJob[]>;
  listQueuedJobsForPrinter(printerId: string): Promise<PrintJob[]>;
  updatePrintJobStatus(
    jobId: string,
    status: JobStatus,
    details?: { errorMessage?: string | null; ackedAt?: string | null },
  ): Promise<PrintJob | null>;
  recordBillingEvent(input: {
    eventId: string;
    orgId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<{ event: BillingEvent; duplicate: boolean }>;
  listBillingEvents(orgId: string): Promise<BillingEvent[]>;
  close(): Promise<void>;
}

const FALLBACK_SCHEMA_SQL = `
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
`.trim();

/**
 * Loads `schema.sql` from repository root, falling back to embedded DDL if unavailable.
 */
export function loadSchemaSql(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const schemaPath = resolve(here, '../../../schema.sql');
    return readFileSync(schemaPath, 'utf8');
  } catch {
    return FALLBACK_SCHEMA_SQL;
  }
}

function toIdempotentDdl(schemaSql: string): string {
  return schemaSql
    .replace(
      /CREATE TYPE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+AS\s+ENUM\s*\(([^;]+)\)\s*;/gi,
      (_match, typeName: string, enumBody: string) =>
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${typeName}') THEN CREATE TYPE ${typeName} AS ENUM (${enumBody}); END IF; END $$;`,
    )
    .replace(/CREATE TABLE\s+(?!IF NOT EXISTS)/gi, 'CREATE TABLE IF NOT EXISTS ')
    .replace(/CREATE INDEX\s+(?!IF NOT EXISTS)/gi, 'CREATE INDEX IF NOT EXISTS ');
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function toNullableIsoString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toIsoString(value);
}

function toJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapPgError(err: unknown): never {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const pgCode = String((err as { code?: unknown }).code);
    const message = err instanceof Error ? err.message : 'Database constraint violation';
    if (pgCode === '23505') {
      throw new StoreError('UNIQUE_VIOLATION', message);
    }
    if (pgCode === '23503') {
      throw new StoreError('FOREIGN_KEY_VIOLATION', message);
    }
    if (pgCode === '23514') {
      throw new StoreError('CHECK_VIOLATION', message);
    }
  }
  throw err;
}

function assertPlanTier(value: unknown): PlanTier {
  if (typeof value === 'string' && VALID_PLAN_TIERS.has(value)) {
    return value as PlanTier;
  }
  throw new StoreError('CHECK_VIOLATION', `Invalid plan_tier: ${String(value)}`);
}

function assertSubscriptionStatus(value: unknown): SubscriptionStatus {
  if (typeof value === 'string' && VALID_SUBSCRIPTION_STATUSES.has(value)) {
    return value as SubscriptionStatus;
  }
  throw new StoreError('CHECK_VIOLATION', `Invalid subscription_status: ${String(value)}`);
}

function assertMonthlyPriceCents(value: unknown): MonthlyPriceCents {
  const num = typeof value === 'string' ? Number(value) : value;
  if (num === 2900 || num === 9900) {
    return num;
  }
  throw new StoreError('CHECK_VIOLATION', `Invalid monthly_price_cents: ${String(value)}`);
}

function assertPaperWidthMm(value: unknown): PaperWidthMm {
  const num = typeof value === 'string' ? Number(value) : value;
  if (num === 58 || num === 80) {
    return num;
  }
  throw new StoreError('CHECK_VIOLATION', `Invalid paper_width_mm: ${String(value)}`);
}

function assertPayloadType(value: unknown): PayloadType {
  if (typeof value === 'string' && VALID_PAYLOAD_TYPES.has(value)) {
    return value as PayloadType;
  }
  throw new StoreError('CHECK_VIOLATION', `Invalid payload_type: ${String(value)}`);
}

function assertJobStatus(value: unknown): JobStatus {
  if (typeof value === 'string' && VALID_JOB_STATUSES.has(value)) {
    return value as JobStatus;
  }
  throw new StoreError('CHECK_VIOLATION', `Invalid job_status: ${String(value)}`);
}

function mapOrganization(row: Record<string, unknown>): Organization {
  return {
    id: String(row.id),
    name: String(row.name),
    plan_tier: assertPlanTier(row.plan_tier),
    subscription_status: assertSubscriptionStatus(row.subscription_status),
    paddle_customer_id:
      row.paddle_customer_id === null || row.paddle_customer_id === undefined
        ? null
        : String(row.paddle_customer_id),
    paddle_subscription_id:
      row.paddle_subscription_id === null || row.paddle_subscription_id === undefined
        ? null
        : String(row.paddle_subscription_id),
    monthly_price_cents: assertMonthlyPriceCents(row.monthly_price_cents),
    current_period_end: toNullableIsoString(row.current_period_end),
    created_at: toIsoString(row.created_at),
  };
}

function mapBillingEvent(row: Record<string, unknown>): BillingEvent {
  return {
    id: String(row.id),
    event_id: String(row.event_id),
    org_id: row.org_id === null || row.org_id === undefined ? null : String(row.org_id),
    event_type: String(row.event_type),
    payload: toJsonObject(row.payload),
    processed_at: toIsoString(row.processed_at),
  };
}

function mapApiKey(row: Record<string, unknown>): ApiKey {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    key_prefix: String(row.key_prefix),
    key_hash: String(row.key_hash),
    last_used_at: toNullableIsoString(row.last_used_at),
    created_at: toIsoString(row.created_at),
  };
}

function mapPrinter(row: Record<string, unknown>): Printer {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    name: String(row.name),
    pairing_code:
      row.pairing_code === null || row.pairing_code === undefined
        ? null
        : String(row.pairing_code).trim(),
    paper_width_mm: assertPaperWidthMm(row.paper_width_mm),
    is_online: Boolean(row.is_online),
    last_seen_at: toNullableIsoString(row.last_seen_at),
    created_at: toIsoString(row.created_at),
  };
}

function mapPrintJob(row: Record<string, unknown>): PrintJob {
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    printer_id: String(row.printer_id),
    idempotency_key: String(row.idempotency_key),
    payload_type: assertPayloadType(row.payload_type),
    payload: toJsonObject(row.payload),
    status: assertJobStatus(row.status),
    error_message:
      row.error_message === null || row.error_message === undefined
        ? null
        : String(row.error_message),
    created_at: toIsoString(row.created_at),
    acked_at: toNullableIsoString(row.acked_at),
  };
}

function canTransitionStatus(current: JobStatus, next: JobStatus): boolean {
  if (current === 'ACK' || current === 'FAILED') {
    return current === next;
  }
  if (current === 'PRINTING' && (next === 'QUEUED' || next === 'DISPATCHED')) {
    return false;
  }
  if (current === 'DISPATCHED' && next === 'QUEUED') {
    return false;
  }
  return true;
}

/**
 * PostgreSQL-backed DataStore compatible with `pg.Pool` or `PGlite` adapters.
 */
export class PostgresDataStore implements DataStore {
  readonly kind = 'postgres' as const;
  private readonly db: PgQueryable;
  private readonly keyLabels = new Map<string, string>([
    [DEFAULT_API_KEY_ID, 'Default Workspace Key'],
  ]);

  constructor(db: PgQueryable) {
    this.db = db;
  }

  async ensureSchema(schemaSql = loadSchemaSql()): Promise<void> {
    const idempotentDdl = toIdempotentDdl(schemaSql);
    if (this.db.exec) {
      await this.db.exec(idempotentDdl);
      return;
    }
    await this.db.query(idempotentDdl);
  }

  async seedDefaults(): Promise<void> {
    await this.db.query(
      `INSERT INTO organizations (id, name, plan_tier, subscription_status, monthly_price_cents)
       VALUES ($1, $2, 'STARTER', 'ACTIVE', 2900)
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_ORG_ID, DEFAULT_ORG_NAME],
    );

    const defaultKeyHash = hashApiKey(DEFAULT_RAW_API_KEY);
    await this.db.query(
      `INSERT INTO api_keys (id, org_id, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (key_hash) DO NOTHING`,
      [DEFAULT_API_KEY_ID, DEFAULT_ORG_ID, DEFAULT_API_KEY_PREFIX, defaultKeyHash],
    );

    await this.db.query(
      `INSERT INTO printers (id, org_id, name, pairing_code, paper_width_mm, is_online)
       VALUES ($1, $2, $3, $4, 80, FALSE)
       ON CONFLICT (id) DO NOTHING`,
      [DEFAULT_PRINTER_ID, DEFAULT_ORG_ID, DEFAULT_PRINTER_NAME, DEFAULT_PAIRING_CODE],
    );
  }

  async getOrganization(orgId: string): Promise<Organization | null> {
    const res = await this.db.query(`SELECT * FROM organizations WHERE id = $1`, [orgId]);
    return res.rows[0] ? mapOrganization(res.rows[0]) : null;
  }

  async getOrganizationByPaddleIds(
    customerId?: string | null,
    subscriptionId?: string | null,
  ): Promise<Organization | null> {
    if (subscriptionId) {
      const bySub = await this.db.query(
        `SELECT * FROM organizations WHERE paddle_subscription_id = $1`,
        [subscriptionId],
      );
      if (bySub.rows[0]) {
        return mapOrganization(bySub.rows[0]);
      }
    }
    if (customerId) {
      const byCust = await this.db.query(
        `SELECT * FROM organizations WHERE paddle_customer_id = $1`,
        [customerId],
      );
      if (byCust.rows[0]) {
        return mapOrganization(byCust.rows[0]);
      }
    }
    return null;
  }

  async updateOrganizationBilling(
    orgId: string,
    update: BillingUpdateInput,
  ): Promise<Organization> {
    const current = await this.getOrganization(orgId);
    if (!current) {
      throw new StoreError('NOT_FOUND', `Organization ${orgId} not found`);
    }

    const planTier = update.plan_tier ?? current.plan_tier;
    const subscriptionStatus = update.subscription_status ?? current.subscription_status;
    const monthlyPriceCents = update.monthly_price_cents ?? current.monthly_price_cents;
    const paddleCustomerId =
      update.paddle_customer_id !== undefined
        ? update.paddle_customer_id
        : current.paddle_customer_id;
    const paddleSubscriptionId =
      update.paddle_subscription_id !== undefined
        ? update.paddle_subscription_id
        : current.paddle_subscription_id;
    const currentPeriodEnd =
      update.current_period_end !== undefined
        ? update.current_period_end
        : current.current_period_end;

    try {
      const res = await this.db.query(
        `UPDATE organizations
         SET plan_tier = $2,
             subscription_status = $3,
             monthly_price_cents = $4,
             paddle_customer_id = $5,
             paddle_subscription_id = $6,
             current_period_end = $7::timestamptz
         WHERE id = $1
         RETURNING *`,
        [
          orgId,
          planTier,
          subscriptionStatus,
          monthlyPriceCents,
          paddleCustomerId,
          paddleSubscriptionId,
          currentPeriodEnd,
        ],
      );
      return mapOrganization(res.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async findApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    const res = await this.db.query(`SELECT * FROM api_keys WHERE key_hash = $1`, [keyHash]);
    return res.rows[0] ? mapApiKey(res.rows[0]) : null;
  }

  async touchApiKeyLastUsed(apiKeyId: string): Promise<void> {
    await this.db.query(`UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`, [apiKeyId]);
  }

  async listApiKeys(orgId: string): Promise<ApiKeyWithMeta[]> {
    const res = await this.db.query(
      `SELECT * FROM api_keys WHERE org_id = $1 ORDER BY created_at DESC`,
      [orgId],
    );
    return res.rows.map((row) => {
      const key = mapApiKey(row);
      return {
        ...key,
        name: this.keyLabels.get(key.id) ?? `Key ${key.key_prefix}`,
      };
    });
  }

  async createApiKey(input: {
    orgId: string;
    keyPrefix: string;
    keyHash: string;
    name?: string;
  }): Promise<ApiKeyWithMeta> {
    try {
      const res = await this.db.query(
        `INSERT INTO api_keys (org_id, key_prefix, key_hash)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [input.orgId, input.keyPrefix, input.keyHash],
      );
      const created = mapApiKey(res.rows[0]);
      const label = input.name?.trim() || `API Key (${created.key_prefix})`;
      this.keyLabels.set(created.id, label);
      return { ...created, name: label };
    } catch (err) {
      mapPgError(err);
    }
  }

  async deleteApiKey(orgId: string, apiKeyId: string): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM api_keys WHERE id = $1 AND org_id = $2 RETURNING id`,
      [apiKeyId, orgId],
    );
    if (res.rows.length > 0) {
      this.keyLabels.delete(apiKeyId);
      return true;
    }
    return false;
  }

  async listPrinters(orgId: string): Promise<Printer[]> {
    const res = await this.db.query(
      `SELECT * FROM printers WHERE org_id = $1 ORDER BY created_at ASC`,
      [orgId],
    );
    return res.rows.map(mapPrinter);
  }

  async getPrinter(printerId: string): Promise<Printer | null> {
    const res = await this.db.query(`SELECT * FROM printers WHERE id = $1`, [printerId]);
    return res.rows[0] ? mapPrinter(res.rows[0]) : null;
  }

  async getPrinterByPairingCode(pairingCode: string): Promise<Printer | null> {
    const res = await this.db.query(`SELECT * FROM printers WHERE pairing_code = $1`, [
      pairingCode,
    ]);
    return res.rows[0] ? mapPrinter(res.rows[0]) : null;
  }

  async reservePairingCode(input: {
    orgId: string;
    name?: string;
    paperWidthMm?: PaperWidthMm;
  }): Promise<{ pairing_code: string; printer: Printer }> {
    const paperWidth = assertPaperWidthMm(input.paperWidthMm ?? 80);
    const printerName = input.name?.trim() || 'Pending Thermal Printer';

    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generatePairingCode();
      try {
        const res = await this.db.query(
          `INSERT INTO printers (org_id, name, pairing_code, paper_width_mm, is_online)
           VALUES ($1, $2, $3, $4, FALSE)
           RETURNING *`,
          [input.orgId, printerName, code, paperWidth],
        );
        return { pairing_code: code, printer: mapPrinter(res.rows[0]) };
      } catch (err) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          String((err as { code?: unknown }).code) === '23505'
        ) {
          continue;
        }
        mapPgError(err);
      }
    }
    throw new StoreError('UNIQUE_VIOLATION', 'Failed to allocate unique 6-digit pairing code');
  }

  async pairPrinter(input: {
    orgId: string;
    pairingCode: string;
    name: string;
    paperWidthMm: PaperWidthMm;
  }): Promise<Printer> {
    assertPaperWidthMm(input.paperWidthMm);
    const existing = await this.getPrinterByPairingCode(input.pairingCode);
    if (existing) {
      if (existing.org_id !== input.orgId) {
        throw new StoreError(
          'UNIQUE_VIOLATION',
          'Pairing code belongs to a different organization',
        );
      }
      const updated = await this.db.query(
        `UPDATE printers
         SET name = $2,
             paper_width_mm = $3,
             is_online = TRUE,
             last_seen_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existing.id, input.name, input.paperWidthMm],
      );
      return mapPrinter(updated.rows[0]);
    }

    try {
      const inserted = await this.db.query(
        `INSERT INTO printers (org_id, name, pairing_code, paper_width_mm, is_online, last_seen_at)
         VALUES ($1, $2, $3, $4, TRUE, NOW())
         RETURNING *`,
        [input.orgId, input.name, input.pairingCode, input.paperWidthMm],
      );
      return mapPrinter(inserted.rows[0]);
    } catch (err) {
      mapPgError(err);
    }
  }

  async setPrinterOnline(printerId: string, isOnline: boolean): Promise<Printer | null> {
    const res = await this.db.query(
      `UPDATE printers
       SET is_online = $2,
           last_seen_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [printerId, isOnline],
    );
    return res.rows[0] ? mapPrinter(res.rows[0]) : null;
  }

  async createOrGetPrintJob(
    input: CreatePrintJobInput,
  ): Promise<{ job: PrintJob; deduplicated: boolean }> {
    assertPayloadType(input.payloadType);

    const existing = await this.db.query(
      `SELECT * FROM print_jobs WHERE org_id = $1 AND idempotency_key = $2`,
      [input.orgId, input.idempotencyKey],
    );
    if (existing.rows[0]) {
      return { job: mapPrintJob(existing.rows[0]), deduplicated: true };
    }

    const printerCheck = await this.db.query(
      `SELECT id FROM printers WHERE id = $1 AND org_id = $2`,
      [input.printerId, input.orgId],
    );
    if (printerCheck.rows.length === 0) {
      throw new StoreError(
        'NOT_FOUND',
        `Printer ${input.printerId} not found for organization ${input.orgId}`,
      );
    }

    try {
      const inserted = await this.db.query(
        `INSERT INTO print_jobs (org_id, printer_id, idempotency_key, payload_type, payload, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'QUEUED')
         ON CONFLICT (org_id, idempotency_key) DO NOTHING
         RETURNING *`,
        [
          input.orgId,
          input.printerId,
          input.idempotencyKey,
          input.payloadType,
          JSON.stringify(input.payload),
        ],
      );
      if (inserted.rows[0]) {
        return { job: mapPrintJob(inserted.rows[0]), deduplicated: false };
      }

      const raceWinner = await this.db.query(
        `SELECT * FROM print_jobs WHERE org_id = $1 AND idempotency_key = $2`,
        [input.orgId, input.idempotencyKey],
      );
      return { job: mapPrintJob(raceWinner.rows[0]), deduplicated: true };
    } catch (err) {
      mapPgError(err);
    }
  }

  async getPrintJob(jobId: string, orgId?: string): Promise<PrintJob | null> {
    const res = orgId
      ? await this.db.query(`SELECT * FROM print_jobs WHERE id = $1 AND org_id = $2`, [
          jobId,
          orgId,
        ])
      : await this.db.query(`SELECT * FROM print_jobs WHERE id = $1`, [jobId]);
    return res.rows[0] ? mapPrintJob(res.rows[0]) : null;
  }

  async listPrintJobs(
    orgId: string,
    filters?: { printerId?: string; status?: JobStatus; limit?: number },
  ): Promise<PrintJob[]> {
    const conditions: string[] = ['org_id = $1'];
    const params: unknown[] = [orgId];

    if (filters?.printerId) {
      params.push(filters.printerId);
      conditions.push(`printer_id = $${params.length}`);
    }
    if (filters?.status) {
      assertJobStatus(filters.status);
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }
    const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 500);
    params.push(limit);

    const res = await this.db.query(
      `SELECT * FROM print_jobs
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return res.rows.map(mapPrintJob);
  }

  async listQueuedJobsForPrinter(printerId: string): Promise<PrintJob[]> {
    const res = await this.db.query(
      `SELECT * FROM print_jobs
       WHERE printer_id = $1 AND status = 'QUEUED'
       ORDER BY created_at ASC`,
      [printerId],
    );
    return res.rows.map(mapPrintJob);
  }

  async updatePrintJobStatus(
    jobId: string,
    status: JobStatus,
    details?: { errorMessage?: string | null; ackedAt?: string | null },
  ): Promise<PrintJob | null> {
    assertJobStatus(status);
    const current = await this.getPrintJob(jobId);
    if (!current) {
      return null;
    }
    if (!canTransitionStatus(current.status, status)) {
      return current;
    }

    const ackedAt =
      status === 'ACK' ? details?.ackedAt ?? current.acked_at ?? new Date().toISOString() : current.acked_at;
    const errorMessage =
      status === 'FAILED'
        ? details?.errorMessage ?? current.error_message ?? 'Print failed'
        : details?.errorMessage !== undefined
          ? details.errorMessage
          : current.error_message;

    const res = await this.db.query(
      `UPDATE print_jobs
       SET status = $2,
           error_message = $3,
           acked_at = $4::timestamptz
       WHERE id = $1
       RETURNING *`,
      [jobId, status, errorMessage, ackedAt],
    );
    return res.rows[0] ? mapPrintJob(res.rows[0]) : null;
  }

  async recordBillingEvent(input: {
    eventId: string;
    orgId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<{ event: BillingEvent; duplicate: boolean }> {
    try {
      const inserted = await this.db.query(
        `INSERT INTO billing_events (event_id, org_id, event_type, payload)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING *`,
        [input.eventId, input.orgId, input.eventType, JSON.stringify(input.payload)],
      );
      if (inserted.rows[0]) {
        return { event: mapBillingEvent(inserted.rows[0]), duplicate: false };
      }

      const existing = await this.db.query(
        `SELECT * FROM billing_events WHERE event_id = $1`,
        [input.eventId],
      );
      return { event: mapBillingEvent(existing.rows[0]), duplicate: true };
    } catch (err) {
      mapPgError(err);
    }
  }

  async listBillingEvents(orgId: string): Promise<BillingEvent[]> {
    const res = await this.db.query(
      `SELECT * FROM billing_events WHERE org_id = $1 ORDER BY processed_at DESC LIMIT 50`,
      [orgId],
    );
    return res.rows.map(mapBillingEvent);
  }

  async close(): Promise<void> {
    if (this.db.end) {
      await this.db.end();
    }
  }
}

/**
 * In-memory DataStore strictly enforcing every `schema.sql` constraint for mock/test execution.
 */
export class InMemoryDataStore implements DataStore {
  readonly kind = 'memory' as const;
  private readonly organizations = new Map<string, Organization>();
  private readonly billingEvents = new Map<string, BillingEvent>();
  private readonly apiKeys = new Map<string, ApiKeyWithMeta>();
  private readonly printers = new Map<string, Printer>();
  private readonly printJobs = new Map<string, PrintJob>();

  constructor() {
    this.seedDefaultsSync();
  }

  async seedDefaults(): Promise<void> {
    this.seedDefaultsSync();
  }

  private seedDefaultsSync(): void {
    const now = new Date().toISOString();
    if (!this.organizations.has(DEFAULT_ORG_ID)) {
      this.organizations.set(DEFAULT_ORG_ID, {
        id: DEFAULT_ORG_ID,
        name: DEFAULT_ORG_NAME,
        plan_tier: 'STARTER',
        subscription_status: 'ACTIVE',
        paddle_customer_id: null,
        paddle_subscription_id: null,
        monthly_price_cents: 2900,
        current_period_end: null,
        created_at: now,
      });
    }

    const defaultKeyHash = hashApiKey(DEFAULT_RAW_API_KEY);
    const hasDefaultHash = Array.from(this.apiKeys.values()).some(
      (key) => key.key_hash === defaultKeyHash,
    );
    if (!hasDefaultHash) {
      this.apiKeys.set(DEFAULT_API_KEY_ID, {
        id: DEFAULT_API_KEY_ID,
        org_id: DEFAULT_ORG_ID,
        name: 'Default Workspace Key',
        key_prefix: DEFAULT_API_KEY_PREFIX,
        key_hash: defaultKeyHash,
        last_used_at: null,
        created_at: now,
      });
    }

    if (!this.printers.has(DEFAULT_PRINTER_ID)) {
      const pairingTaken = Array.from(this.printers.values()).some(
        (p) => p.pairing_code === DEFAULT_PAIRING_CODE,
      );
      this.printers.set(DEFAULT_PRINTER_ID, {
        id: DEFAULT_PRINTER_ID,
        org_id: DEFAULT_ORG_ID,
        name: DEFAULT_PRINTER_NAME,
        pairing_code: pairingTaken ? null : DEFAULT_PAIRING_CODE,
        paper_width_mm: 80,
        is_online: false,
        last_seen_at: null,
        created_at: now,
      });
    }
  }

  async getOrganization(orgId: string): Promise<Organization | null> {
    const org = this.organizations.get(orgId);
    return org ? { ...org } : null;
  }

  async getOrganizationByPaddleIds(
    customerId?: string | null,
    subscriptionId?: string | null,
  ): Promise<Organization | null> {
    for (const org of this.organizations.values()) {
      if (subscriptionId && org.paddle_subscription_id === subscriptionId) {
        return { ...org };
      }
      if (customerId && org.paddle_customer_id === customerId) {
        return { ...org };
      }
    }
    return null;
  }

  async updateOrganizationBilling(
    orgId: string,
    update: BillingUpdateInput,
  ): Promise<Organization> {
    const current = this.organizations.get(orgId);
    if (!current) {
      throw new StoreError('NOT_FOUND', `Organization ${orgId} not found`);
    }

    const nextPlanTier =
      update.plan_tier !== undefined ? assertPlanTier(update.plan_tier) : current.plan_tier;
    const nextStatus =
      update.subscription_status !== undefined
        ? assertSubscriptionStatus(update.subscription_status)
        : current.subscription_status;
    const nextPrice =
      update.monthly_price_cents !== undefined
        ? assertMonthlyPriceCents(update.monthly_price_cents)
        : current.monthly_price_cents;
    const nextCustomerId =
      update.paddle_customer_id !== undefined
        ? update.paddle_customer_id
        : current.paddle_customer_id;
    const nextSubscriptionId =
      update.paddle_subscription_id !== undefined
        ? update.paddle_subscription_id
        : current.paddle_subscription_id;
    const nextPeriodEnd =
      update.current_period_end !== undefined
        ? update.current_period_end
        : current.current_period_end;

    for (const other of this.organizations.values()) {
      if (other.id === orgId) {
        continue;
      }
      if (nextCustomerId && other.paddle_customer_id === nextCustomerId) {
        throw new StoreError('UNIQUE_VIOLATION', 'Duplicate paddle_customer_id');
      }
      if (nextSubscriptionId && other.paddle_subscription_id === nextSubscriptionId) {
        throw new StoreError('UNIQUE_VIOLATION', 'Duplicate paddle_subscription_id');
      }
    }

    const updated: Organization = {
      ...current,
      plan_tier: nextPlanTier,
      subscription_status: nextStatus,
      monthly_price_cents: nextPrice,
      paddle_customer_id: nextCustomerId,
      paddle_subscription_id: nextSubscriptionId,
      current_period_end: nextPeriodEnd,
    };
    this.organizations.set(orgId, updated);
    return { ...updated };
  }

  async findApiKeyByHash(keyHash: string): Promise<ApiKey | null> {
    for (const key of this.apiKeys.values()) {
      if (key.key_hash === keyHash) {
        return {
          id: key.id,
          org_id: key.org_id,
          key_prefix: key.key_prefix,
          key_hash: key.key_hash,
          last_used_at: key.last_used_at,
          created_at: key.created_at,
        };
      }
    }
    return null;
  }

  async touchApiKeyLastUsed(apiKeyId: string): Promise<void> {
    const existing = this.apiKeys.get(apiKeyId);
    if (existing) {
      existing.last_used_at = new Date().toISOString();
    }
  }

  async listApiKeys(orgId: string): Promise<ApiKeyWithMeta[]> {
    return Array.from(this.apiKeys.values())
      .filter((k) => k.org_id === orgId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((k) => ({ ...k }));
  }

  async createApiKey(input: {
    orgId: string;
    keyPrefix: string;
    keyHash: string;
    name?: string;
  }): Promise<ApiKeyWithMeta> {
    if (!this.organizations.has(input.orgId)) {
      throw new StoreError('FOREIGN_KEY_VIOLATION', `Organization ${input.orgId} does not exist`);
    }
    for (const existing of this.apiKeys.values()) {
      if (existing.key_hash === input.keyHash) {
        throw new StoreError('UNIQUE_VIOLATION', 'API key hash already exists');
      }
    }
    const created: ApiKeyWithMeta = {
      id: randomUUID(),
      org_id: input.orgId,
      name: input.name?.trim() || `API Key (${input.keyPrefix})`,
      key_prefix: input.keyPrefix,
      key_hash: input.keyHash,
      last_used_at: null,
      created_at: new Date().toISOString(),
    };
    this.apiKeys.set(created.id, created);
    return { ...created };
  }

  async deleteApiKey(orgId: string, apiKeyId: string): Promise<boolean> {
    const existing = this.apiKeys.get(apiKeyId);
    if (!existing || existing.org_id !== orgId) {
      return false;
    }
    this.apiKeys.delete(apiKeyId);
    return true;
  }

  async listPrinters(orgId: string): Promise<Printer[]> {
    return Array.from(this.printers.values())
      .filter((p) => p.org_id === orgId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((p) => ({ ...p }));
  }

  async getPrinter(printerId: string): Promise<Printer | null> {
    const printer = this.printers.get(printerId);
    return printer ? { ...printer } : null;
  }

  async getPrinterByPairingCode(pairingCode: string): Promise<Printer | null> {
    for (const printer of this.printers.values()) {
      if (printer.pairing_code === pairingCode) {
        return { ...printer };
      }
    }
    return null;
  }

  async reservePairingCode(input: {
    orgId: string;
    name?: string;
    paperWidthMm?: PaperWidthMm;
  }): Promise<{ pairing_code: string; printer: Printer }> {
    if (!this.organizations.has(input.orgId)) {
      throw new StoreError('FOREIGN_KEY_VIOLATION', `Organization ${input.orgId} does not exist`);
    }
    const paperWidth = assertPaperWidthMm(input.paperWidthMm ?? 80);
    const printerName = input.name?.trim() || 'Pending Thermal Printer';

    for (let attempt = 0; attempt < 12; attempt++) {
      const code = generatePairingCode();
      const conflict = Array.from(this.printers.values()).some(
        (p) => p.pairing_code === code,
      );
      if (conflict) {
        continue;
      }
      const created: Printer = {
        id: randomUUID(),
        org_id: input.orgId,
        name: printerName,
        pairing_code: code,
        paper_width_mm: paperWidth,
        is_online: false,
        last_seen_at: null,
        created_at: new Date().toISOString(),
      };
      this.printers.set(created.id, created);
      return { pairing_code: code, printer: { ...created } };
    }
    throw new StoreError('UNIQUE_VIOLATION', 'Failed to allocate unique 6-digit pairing code');
  }

  async pairPrinter(input: {
    orgId: string;
    pairingCode: string;
    name: string;
    paperWidthMm: PaperWidthMm;
  }): Promise<Printer> {
    if (!this.organizations.has(input.orgId)) {
      throw new StoreError('FOREIGN_KEY_VIOLATION', `Organization ${input.orgId} does not exist`);
    }
    assertPaperWidthMm(input.paperWidthMm);
    if (input.pairingCode.length !== 6) {
      throw new StoreError('CHECK_VIOLATION', 'pairing_code must be 6 characters');
    }

    const now = new Date().toISOString();
    for (const printer of this.printers.values()) {
      if (printer.pairing_code === input.pairingCode) {
        if (printer.org_id !== input.orgId) {
          throw new StoreError(
            'UNIQUE_VIOLATION',
            'Pairing code belongs to a different organization',
          );
        }
        const updated: Printer = {
          ...printer,
          name: input.name,
          paper_width_mm: input.paperWidthMm,
          is_online: true,
          last_seen_at: now,
        };
        this.printers.set(updated.id, updated);
        return { ...updated };
      }
    }

    const created: Printer = {
      id: randomUUID(),
      org_id: input.orgId,
      name: input.name,
      pairing_code: input.pairingCode,
      paper_width_mm: input.paperWidthMm,
      is_online: true,
      last_seen_at: now,
      created_at: now,
    };
    this.printers.set(created.id, created);
    return { ...created };
  }

  async setPrinterOnline(printerId: string, isOnline: boolean): Promise<Printer | null> {
    const existing = this.printers.get(printerId);
    if (!existing) {
      return null;
    }
    const updated: Printer = {
      ...existing,
      is_online: isOnline,
      last_seen_at: new Date().toISOString(),
    };
    this.printers.set(printerId, updated);
    return { ...updated };
  }

  async createOrGetPrintJob(
    input: CreatePrintJobInput,
  ): Promise<{ job: PrintJob; deduplicated: boolean }> {
    assertPayloadType(input.payloadType);
    if (!this.organizations.has(input.orgId)) {
      throw new StoreError('FOREIGN_KEY_VIOLATION', `Organization ${input.orgId} does not exist`);
    }

    for (const existing of this.printJobs.values()) {
      if (
        existing.org_id === input.orgId &&
        existing.idempotency_key === input.idempotencyKey
      ) {
        return { job: structuredClone(existing), deduplicated: true };
      }
    }

    const printer = this.printers.get(input.printerId);
    if (!printer || printer.org_id !== input.orgId) {
      throw new StoreError(
        'NOT_FOUND',
        `Printer ${input.printerId} not found for organization ${input.orgId}`,
      );
    }

    const created: PrintJob = {
      id: randomUUID(),
      org_id: input.orgId,
      printer_id: input.printerId,
      idempotency_key: input.idempotencyKey,
      payload_type: input.payloadType,
      payload: structuredClone(input.payload),
      status: 'QUEUED',
      error_message: null,
      created_at: new Date().toISOString(),
      acked_at: null,
    };
    this.printJobs.set(created.id, created);
    return { job: structuredClone(created), deduplicated: false };
  }

  async getPrintJob(jobId: string, orgId?: string): Promise<PrintJob | null> {
    const job = this.printJobs.get(jobId);
    if (!job) {
      return null;
    }
    if (orgId && job.org_id !== orgId) {
      return null;
    }
    return structuredClone(job);
  }

  async listPrintJobs(
    orgId: string,
    filters?: { printerId?: string; status?: JobStatus; limit?: number },
  ): Promise<PrintJob[]> {
    if (filters?.status) {
      assertJobStatus(filters.status);
    }
    const limit = Math.min(Math.max(filters?.limit ?? 100, 1), 500);
    return Array.from(this.printJobs.values())
      .filter((job) => {
        if (job.org_id !== orgId) {
          return false;
        }
        if (filters?.printerId && job.printer_id !== filters.printerId) {
          return false;
        }
        if (filters?.status && job.status !== filters.status) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map((job) => structuredClone(job));
  }

  async listQueuedJobsForPrinter(printerId: string): Promise<PrintJob[]> {
    return Array.from(this.printJobs.values())
      .filter((job) => job.printer_id === printerId && job.status === 'QUEUED')
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((job) => structuredClone(job));
  }

  async updatePrintJobStatus(
    jobId: string,
    status: JobStatus,
    details?: { errorMessage?: string | null; ackedAt?: string | null },
  ): Promise<PrintJob | null> {
    assertJobStatus(status);
    const existing = this.printJobs.get(jobId);
    if (!existing) {
      return null;
    }
    if (!canTransitionStatus(existing.status, status)) {
      return structuredClone(existing);
    }

    const updated: PrintJob = {
      ...existing,
      status,
      acked_at:
        status === 'ACK'
          ? details?.ackedAt ?? existing.acked_at ?? new Date().toISOString()
          : existing.acked_at,
      error_message:
        status === 'FAILED'
          ? details?.errorMessage ?? existing.error_message ?? 'Print failed'
          : details?.errorMessage !== undefined
            ? details.errorMessage
            : existing.error_message,
    };
    this.printJobs.set(jobId, updated);
    return structuredClone(updated);
  }

  async recordBillingEvent(input: {
    eventId: string;
    orgId: string | null;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<{ event: BillingEvent; duplicate: boolean }> {
    const existing = this.billingEvents.get(input.eventId);
    if (existing) {
      return { event: structuredClone(existing), duplicate: true };
    }
    if (input.orgId !== null && !this.organizations.has(input.orgId)) {
      throw new StoreError('FOREIGN_KEY_VIOLATION', `Organization ${input.orgId} does not exist`);
    }

    const created: BillingEvent = {
      id: randomUUID(),
      event_id: input.eventId,
      org_id: input.orgId,
      event_type: input.eventType,
      payload: structuredClone(input.payload),
      processed_at: new Date().toISOString(),
    };
    this.billingEvents.set(input.eventId, created);
    return { event: structuredClone(created), duplicate: false };
  }

  async listBillingEvents(orgId: string): Promise<BillingEvent[]> {
    return Array.from(this.billingEvents.values())
      .filter((e) => e.org_id === orgId)
      .sort((a, b) => b.processed_at.localeCompare(a.processed_at))
      .slice(0, 50)
      .map((e) => structuredClone(e));
  }

  async close(): Promise<void> {
    // Nothing to release for in-memory store.
  }
}

export interface CreateDataStoreOptions {
  databaseUrl?: string;
  mockMode?: boolean;
  strictInfra?: boolean;
}

/**
 * Initializes `PostgresDataStore` when configured and reachable, otherwise uses `InMemoryDataStore`.
 */
export async function createDataStore(options: CreateDataStoreOptions = {}): Promise<DataStore> {
  const mockMode = options.mockMode ?? process.env.MOCK_PRINTER_MODE === 'true';
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;

  if (mockMode || !databaseUrl) {
    const memoryStore = new InMemoryDataStore();
    await memoryStore.seedDefaults();
    return memoryStore;
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 2500,
  });

  try {
    await pool.query('SELECT 1');
    const pgStore = new PostgresDataStore(pool);
    await pgStore.ensureSchema(loadSchemaSql());
    await pgStore.seedDefaults();
    return pgStore;
  } catch (err) {
    await pool.end().catch(() => undefined);
    if (options.strictInfra) {
      throw err;
    }
    const memoryStore = new InMemoryDataStore();
    await memoryStore.seedDefaults();
    return memoryStore;
  }
}
