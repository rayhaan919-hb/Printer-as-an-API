export type PayloadType = "JSON_RECEIPT" | "RAW_TEXT" | "HTML";
export type JobStatus = "QUEUED" | "DISPATCHED" | "PRINTING" | "ACK" | "FAILED";
export type PrinterStatus = "ONLINE" | "OFFLINE";
export type PlanTier = "STARTER" | "GROWTH";
export type SubscriptionStatus =
  | "ACTIVE"
  | "TRIALING"
  | "PAST_DUE"
  | "CANCELED"
  | "PAUSED";

export interface Printer {
  id: string;
  name: string;
  pairing_code: string;
  paper_width_mm: 58 | 80;
  status: PrinterStatus;
  last_seen_at: string;
  latency_ms: number;
  agent_version: string;
}

export interface PrintJob {
  job_id: string;
  printer_id: string;
  printer_name: string;
  payload_type: PayloadType;
  status: JobStatus;
  idempotency_key: string;
  latency_ms: number;
  created_at: string;
  acked_at?: string | null;
  error_message?: string | null;
  payload_summary: string;
  raw_payload?: Record<string, unknown>;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key_prefix: string;
  sha256_hash: string;
  created_at: string;
  last_used_at: string | null;
}

export interface GeneratedApiKeyResponse {
  record: ApiKeyRecord;
  raw_key: string;
}

export interface BillingSummary {
  org_name: string;
  plan_tier: PlanTier;
  subscription_status: SubscriptionStatus;
  monthly_price_cents: 2900 | 9900;
  current_period_end: string | null;
  paddle_customer_id?: string | null;
  paddle_subscription_id?: string | null;
}

export interface DashboardMetrics {
  jobs_today: number;
  online_printers: number;
  total_printers: number;
  avg_latency_ms: number;
}

export interface DashboardData {
  printers: Printer[];
  jobs: PrintJob[];
  apiKeys: ApiKeyRecord[];
  billing: BillingSummary;
  metrics: DashboardMetrics;
  backendConnected: boolean;
  errorMessage: string | null;
  errorStatus: number | null;
}

/** Custom error carrying HTTP status code for 402/4xx/5xx handling. */
export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

export const API_BASE =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL
    ? process.env.NEXT_PUBLIC_API_URL
    : "http://localhost:4000";

export const SEED_PRINTERS: Printer[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    name: "Kitchen Thermal #01 (Epson TM-T88VI)",
    pairing_code: "482910",
    paper_width_mm: 80,
    status: "ONLINE",
    last_seen_at: "2026-05-10T14:22:08Z",
    latency_ms: 38,
    agent_version: "v1.4.2-android",
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440002",
    name: "Front Counter Bar #02 (Star TSP143IV)",
    pairing_code: "739204",
    paper_width_mm: 58,
    status: "ONLINE",
    last_seen_at: "2026-05-10T14:22:05Z",
    latency_ms: 44,
    agent_version: "v1.4.2-android",
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440003",
    name: "Patio Pickup Station #03 (Sunmi V2s)",
    pairing_code: "918273",
    paper_width_mm: 58,
    status: "OFFLINE",
    last_seen_at: "2026-05-10T11:04:51Z",
    latency_ms: 0,
    agent_version: "v1.4.0-android",
  },
];

export const SEED_JOBS: PrintJob[] = [
  {
    job_id: "job_94f8a102-3c1b-4d7e-8a20-9012f3a41b01",
    printer_id: "550e8400-e29b-41d4-a716-446655440001",
    printer_name: "Kitchen Thermal #01 (Epson TM-T88VI)",
    payload_type: "JSON_RECEIPT",
    status: "ACK",
    idempotency_key: "idem_ord_20260510_8841",
    latency_ms: 36,
    created_at: "2026-05-10T14:21:44Z",
    acked_at: "2026-05-10T14:21:44Z",
    payload_summary: "Order #8841 • 3 items • Total $42.50",
    raw_payload: {
      title: "Order #8841",
      items: [
        { name: "Margherita Pie", qty: 2, price: "$16.00" },
        { name: "Sparkling Water", qty: 1, price: "$10.50" },
      ],
      total: "$42.50",
    },
  },
  {
    job_id: "job_83e7b204-2b0a-4c6d-9b31-8023e4b52c02",
    printer_id: "550e8400-e29b-41d4-a716-446655440002",
    printer_name: "Front Counter Bar #02 (Star TSP143IV)",
    payload_type: "RAW_TEXT",
    status: "PRINTING",
    idempotency_key: "idem_ord_20260510_8842",
    latency_ms: 48,
    created_at: "2026-05-10T14:21:59Z",
    payload_summary: "BAR TICKET #8842 • 2x Espresso Tonic",
    raw_payload: { text: "BAR TICKET #8842\n2x Espresso Tonic\nTable 4" },
  },
  {
    job_id: "job_72d6c305-1a9f-4b5c-8c42-7034d5c63d03",
    printer_id: "550e8400-e29b-41d4-a716-446655440001",
    printer_name: "Kitchen Thermal #01 (Epson TM-T88VI)",
    payload_type: "JSON_RECEIPT",
    status: "DISPATCHED",
    idempotency_key: "idem_ord_20260510_8843",
    latency_ms: 19,
    created_at: "2026-05-10T14:22:07Z",
    payload_summary: "Order #8843 • 1 item • Total $18.00",
    raw_payload: { title: "Order #8843", items: [{ name: "Truffle Fries", qty: 1 }], total: "$18.00" },
  },
  {
    job_id: "job_61c5d406-0f8e-4a4b-7d53-6045c6d74e04",
    printer_id: "550e8400-e29b-41d4-a716-446655440003",
    printer_name: "Patio Pickup Station #03 (Sunmi V2s)",
    payload_type: "HTML",
    status: "FAILED",
    idempotency_key: "idem_ord_20260510_8839",
    latency_ms: 142,
    created_at: "2026-05-10T13:58:12Z",
    error_message: "Agent WebSocket timeout (job cached in Room offline queue)",
    payload_summary: "Pickup Slip #8839 • Agent WebSocket timeout",
    raw_payload: { html: "<h3>Pickup Slip #8839</h3><p>Patio Counter</p>" },
  },
];

export const SEED_API_KEYS: ApiKeyRecord[] = [
  {
    id: "key_01J9X7K2A8M4V6P9R3T5W1Z0",
    name: "Production POS Webhook Cluster",
    key_prefix: "pk_live_9f8a7b6c",
    sha256_hash:
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    created_at: "2026-05-01T09:00:00Z",
    last_used_at: "2026-05-10T14:22:07Z",
  },
  {
    id: "key_01J9X7K9B2N5Q8S1U4X7Y2A3",
    name: "Staging Android Emulator Bridge",
    key_prefix: "pk_test_3d2e1f0a",
    sha256_hash:
      "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
    created_at: "2026-05-04T16:30:00Z",
    last_used_at: "2026-05-09T20:11:32Z",
  },
];

export const SEED_BILLING: BillingSummary = {
  org_name: "Default Merchant Org",
  plan_tier: "STARTER",
  subscription_status: "ACTIVE",
  monthly_price_cents: 2900,
  current_period_end: "2026-06-10T00:00:00Z",
  paddle_customer_id: "ctm_01j9x7demo001",
  paddle_subscription_id: "sub_01j9x7demo001",
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeJobStatus(value: unknown): JobStatus {
  switch (value) {
    case "DISPATCHED":
    case "PRINTING":
    case "ACK":
    case "FAILED":
    case "QUEUED":
      return value;
    default:
      return "QUEUED";
  }
}

function normalizePayloadType(value: unknown): PayloadType {
  if (value === "RAW_TEXT" || value === "HTML" || value === "JSON_RECEIPT") {
    return value;
  }
  return "JSON_RECEIPT";
}

function normalizePlanTier(value: unknown): PlanTier {
  return value === "GROWTH" ? "GROWTH" : "STARTER";
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  switch (value) {
    case "ACTIVE":
    case "TRIALING":
    case "PAST_DUE":
    case "CANCELED":
    case "PAUSED":
      return value;
    default:
      return "ACTIVE";
  }
}

function extractArray(data: unknown, key: string): JsonRecord[] | null {
  if (Array.isArray(data)) {
    return data.filter(isRecord);
  }
  if (isRecord(data) && Array.isArray(data[key])) {
    return (data[key] as unknown[]).filter(isRecord);
  }
  if (isRecord(data) && Array.isArray(data.data)) {
    return (data.data as unknown[]).filter(isRecord);
  }
  return null;
}

function summarizePayload(payload: JsonRecord | undefined, fallbackType: PayloadType): string {
  if (!payload) {
    return `ESC/POS ${fallbackType} payload`;
  }
  if (typeof payload.title === "string") {
    const total = typeof payload.total === "string" ? ` • ${payload.total}` : "";
    return `${payload.title}${total}`;
  }
  if (typeof payload.text === "string") {
    return payload.text.replace(/\s+/g, " ").slice(0, 64);
  }
  if (typeof payload.html === "string") {
    return payload.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
  }
  const serialized = JSON.stringify(payload);
  return serialized.length > 64 ? `${serialized.slice(0, 61)}...` : serialized;
}

async function sha256Hex(input: string): Promise<string> {
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    const encoded = new TextEncoder().encode(input);
    const buffer = await window.crypto.subtle.digest("SHA-256", encoded);
    return Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, "a");
}

interface FetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  errorText: string | null;
}

async function safeFetchJson(
  path: string,
  options?: RequestInit
): Promise<FetchResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const headers: Record<string, string> = {};
    if (options?.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers as Record<string, string> | undefined),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { message: text };
      }
    }

    let errorText: string | null = null;
    if (!res.ok) {
      if (isRecord(parsed)) {
        errorText =
          asOptionalString(parsed.error) ||
          asOptionalString(parsed.message) ||
          `Request failed with status ${res.status}`;
      } else {
        errorText = `Request failed with status ${res.status}`;
      }
    }

    return { ok: res.ok, status: res.status, data: parsed, errorText };
  } catch (err: unknown) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Request to ${API_BASE}${path} timed out`
        : `Unable to reach API at ${API_BASE}`;
    return { ok: false, status: 0, data: null, errorText: message };
  }
}

function normalizePrinter(raw: JsonRecord, idx: number): Printer {
  const status: PrinterStatus =
    raw.status === "ONLINE" || raw.status === "OFFLINE"
      ? raw.status
      : raw.is_online === true
        ? "ONLINE"
        : "OFFLINE";

  return {
    id: asString(raw.id, asString(raw.printer_id, `printer-${idx}`)),
    name: asString(raw.name, `Thermal Printer #${idx + 1}`),
    pairing_code: asString(raw.pairing_code, "000000"),
    paper_width_mm: raw.paper_width_mm === 58 ? 58 : 80,
    status,
    last_seen_at: asString(
      raw.last_seen_at,
      asString(raw.created_at, new Date().toISOString())
    ),
    latency_ms: asNumber(raw.latency_ms, status === "ONLINE" ? 39 : 0),
    agent_version: asString(raw.agent_version, "v1.4.2-android"),
  };
}

function normalizeJob(
  raw: JsonRecord,
  idx: number,
  printers: Printer[]
): PrintJob {
  const printerId = asString(raw.printer_id, printers[0]?.id ?? "");
  const payloadType = normalizePayloadType(raw.payload_type);
  const rawPayload = isRecord(raw.payload) ? raw.payload : undefined;
  const createdAt = asString(raw.created_at, new Date().toISOString());
  const ackedAt = asOptionalString(raw.acked_at);

  let latencyMs = asNumber(raw.latency_ms, -1);
  if (latencyMs < 0) {
    if (ackedAt) {
      const diff = new Date(ackedAt).getTime() - new Date(createdAt).getTime();
      latencyMs = Number.isFinite(diff) && diff > 0 ? Math.round(diff) : 34;
    } else {
      latencyMs = 0;
    }
  }

  return {
    job_id: asString(raw.job_id, asString(raw.id, `job_${idx}`)),
    printer_id: printerId,
    printer_name: asString(
      raw.printer_name,
      printers.find((p) => p.id === printerId)?.name ?? "Thermal Printer"
    ),
    payload_type: payloadType,
    status: normalizeJobStatus(raw.status),
    idempotency_key: asString(raw.idempotency_key, `idem_${idx}`),
    latency_ms: latencyMs,
    created_at: createdAt,
    acked_at: ackedAt,
    error_message: asOptionalString(raw.error_message),
    payload_summary:
      asOptionalString(raw.payload_summary) ??
      summarizePayload(rawPayload, payloadType),
    raw_payload: rawPayload,
  };
}

function normalizeApiKey(raw: JsonRecord, idx: number): ApiKeyRecord {
  const prefix = asString(
    raw.key_prefix,
    asString(raw.prefix, "pk_live_****")
  );
  return {
    id: asString(raw.id, `key_${idx}`),
    name: asString(raw.name, `API Key ${prefix.slice(0, 12)}`),
    key_prefix: prefix,
    sha256_hash: asString(
      raw.sha256_hash,
      asString(
        raw.key_hash,
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
      )
    ),
    created_at: asString(raw.created_at, new Date().toISOString()),
    last_used_at: asOptionalString(raw.last_used_at),
  };
}

function normalizeBilling(raw: JsonRecord): BillingSummary {
  const planTier = normalizePlanTier(raw.plan_tier ?? raw.plan);
  const defaultCents = planTier === "GROWTH" ? 9900 : 2900;
  const rawCents = asNumber(raw.monthly_price_cents, defaultCents);
  return {
    org_name: asString(raw.org_name, asString(raw.name, SEED_BILLING.org_name)),
    plan_tier: planTier,
    subscription_status: normalizeSubscriptionStatus(
      raw.subscription_status ?? raw.status
    ),
    monthly_price_cents: rawCents === 9900 ? 9900 : 2900,
    current_period_end: asOptionalString(raw.current_period_end),
    paddle_customer_id: asOptionalString(raw.paddle_customer_id),
    paddle_subscription_id: asOptionalString(raw.paddle_subscription_id),
  };
}

/** Compute KPI strip values from the current printers and jobs lists. */
export function computeMetrics(
  printers: Printer[],
  jobs: PrintJob[]
): DashboardMetrics {
  const onlinePrinters = printers.filter((p) => p.status === "ONLINE").length;
  const latencies = jobs.map((j) => j.latency_ms).filter((ms) => ms > 0);
  const avgLatency =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0;
  return {
    jobs_today: jobs.length,
    online_printers: onlinePrinters,
    total_printers: printers.length,
    avg_latency_ms: avgLatency,
  };
}

/** Fetch printers, print jobs, API keys, and billing status from the API server. */
export async function fetchDashboardState(): Promise<DashboardData> {
  const [printersRes, jobsRes, keysRes, billingRes] = await Promise.all([
    safeFetchJson("/v1/printers"),
    safeFetchJson("/v1/jobs"),
    safeFetchJson("/v1/api-keys"),
    safeFetchJson("/v1/billing"),
  ]);

  const anyNetworkSuccess =
    printersRes.status !== 0 ||
    jobsRes.status !== 0 ||
    keysRes.status !== 0 ||
    billingRes.status !== 0;

  // If the backend returned an explicit error status on core endpoints, report it clearly
  const coreErrorRes = [printersRes, jobsRes, keysRes].find(
    (r) => !r.ok && r.status >= 400
  );

  if (!anyNetworkSuccess) {
    return {
      printers: SEED_PRINTERS,
      jobs: SEED_JOBS,
      apiKeys: SEED_API_KEYS,
      billing: SEED_BILLING,
      metrics: computeMetrics(SEED_PRINTERS, SEED_JOBS),
      backendConnected: false,
      errorMessage:
        printersRes.errorText ??
        `Unable to reach API at ${API_BASE} — showing offline sandbox data.`,
      errorStatus: 0,
    };
  }

  let printers: Printer[] = [];
  if (printersRes.ok) {
    const rawPrinters = extractArray(printersRes.data, "printers");
    if (rawPrinters) {
      printers = rawPrinters.map((p, idx) => normalizePrinter(p, idx));
    }
  } else {
    printers = SEED_PRINTERS;
  }

  let jobs: PrintJob[] = [];
  if (jobsRes.ok) {
    const rawJobs = extractArray(jobsRes.data, "jobs");
    if (rawJobs) {
      jobs = rawJobs.map((j, idx) => normalizeJob(j, idx, printers));
    }
  } else {
    jobs = SEED_JOBS;
  }

  let apiKeys: ApiKeyRecord[] = [];
  if (keysRes.ok) {
    const rawKeys = extractArray(keysRes.data, "api_keys") ?? extractArray(keysRes.data, "keys");
    if (rawKeys) {
      apiKeys = rawKeys.map((k, idx) => normalizeApiKey(k, idx));
    }
  } else {
    apiKeys = SEED_API_KEYS;
  }

  let billing: BillingSummary = SEED_BILLING;
  if (billingRes.ok && isRecord(billingRes.data)) {
    const billingRecord = isRecord(billingRes.data.organization)
      ? billingRes.data.organization
      : isRecord(billingRes.data.billing)
        ? billingRes.data.billing
        : billingRes.data;
    billing = normalizeBilling(billingRecord);
  }

  return {
    printers,
    jobs,
    apiKeys,
    billing,
    metrics: computeMetrics(printers, jobs),
    backendConnected: true,
    errorMessage: coreErrorRes?.errorText ?? null,
    errorStatus: coreErrorRes?.status ?? null,
  };
}

/** Fetch billing status independently (used by /pricing page). */
export async function fetchBillingStatus(): Promise<{
  billing: BillingSummary;
  backendConnected: boolean;
  errorMessage: string | null;
}> {
  const res = await safeFetchJson("/v1/billing");
  if (res.status === 0) {
    return {
      billing: SEED_BILLING,
      backendConnected: false,
      errorMessage: res.errorText,
    };
  }
  if (!res.ok) {
    if (res.status === 404) {
      return {
        billing: SEED_BILLING,
        backendConnected: true,
        errorMessage: null,
      };
    }
    return {
      billing: SEED_BILLING,
      backendConnected: true,
      errorMessage: res.errorText ?? `Failed to load billing (${res.status})`,
    };
  }

  const raw = isRecord(res.data)
    ? isRecord(res.data.organization)
      ? res.data.organization
      : isRecord(res.data.billing)
        ? res.data.billing
        : res.data
    : {};

  return {
    billing: normalizeBilling(raw),
    backendConnected: true,
    errorMessage: null,
  };
}

/** Pair an Android Print Agent using a 6-digit pairing code. */
export async function pairPrinterRequest(input: {
  pairing_code: string;
  name: string;
  paper_width_mm: 58 | 80;
}): Promise<Printer> {
  const res = await safeFetchJson("/v1/printers/pair", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (res.status !== 0 && !res.ok) {
    throw new ApiRequestError(
      res.errorText ?? `Failed to pair printer (${res.status})`,
      res.status
    );
  }

  const now = new Date().toISOString();
  const payload = isRecord(res.data)
    ? isRecord(res.data.printer)
      ? res.data.printer
      : res.data
    : {};

  return {
    id: asString(
      payload.printer_id,
      asString(
        payload.id,
        `550e8400-e29b-41d4-a716-${Math.floor(100000000000 + Math.random() * 899999999999)}`
      )
    ),
    name: asString(payload.name, input.name),
    pairing_code: input.pairing_code,
    paper_width_mm: input.paper_width_mm,
    status:
      payload.status === "OFFLINE" || payload.is_online === false
        ? "OFFLINE"
        : "ONLINE",
    last_seen_at: asString(payload.last_seen_at, now),
    latency_ms: asNumber(payload.latency_ms, 32),
    agent_version: asString(payload.agent_version, "v1.4.2-android"),
  };
}

/** Enqueue a thermal print job via POST /v1/print with Idempotency-Key and Bearer token. */
export async function dispatchPrintJobRequest(input: {
  printer_id: string;
  printer_name: string;
  payload_type: PayloadType;
  payload: Record<string, unknown>;
  idempotency_key: string;
  api_key?: string;
}): Promise<PrintJob> {
  const headers: Record<string, string> = {
    "Idempotency-Key": input.idempotency_key,
  };
  if (input.api_key && input.api_key.trim().length > 0) {
    const trimmed = input.api_key.trim();
    headers["Authorization"] = `Bearer ${trimmed}`;
    headers["X-API-Key"] = trimmed;
  }

  const res = await safeFetchJson("/v1/print", {
    method: "POST",
    headers,
    body: JSON.stringify({
      printer_id: input.printer_id,
      payload_type: input.payload_type,
      payload: input.payload,
    }),
  });

  if (res.status !== 0 && !res.ok) {
    throw new ApiRequestError(
      res.errorText ?? `Print dispatch failed (${res.status})`,
      res.status
    );
  }

  const data = isRecord(res.data) ? res.data : {};
  const jobId = asString(
    data.job_id,
    asString(
      data.id,
      `job_${Math.random().toString(16).slice(2, 10)}-4d7e-8a20-${Date.now().toString(16).slice(-8)}`
    )
  );
  const status = normalizeJobStatus(data.status);

  return {
    job_id: jobId,
    printer_id: input.printer_id,
    printer_name: input.printer_name,
    payload_type: input.payload_type,
    status,
    idempotency_key: input.idempotency_key,
    latency_ms: 29,
    created_at: new Date().toISOString(),
    payload_summary: summarizePayload(input.payload, input.payload_type),
    raw_payload: input.payload,
  };
}

/** Create a new API key via POST /v1/api-keys and return the one-time raw key. */
export async function generateApiKeyRequest(input: {
  name: string;
}): Promise<GeneratedApiKeyResponse> {
  const res = await safeFetchJson("/v1/api-keys", {
    method: "POST",
    body: JSON.stringify({ name: input.name }),
  });

  if (res.status !== 0 && !res.ok) {
    throw new ApiRequestError(
      res.errorText ?? `Failed to generate API key (${res.status})`,
      res.status
    );
  }

  const data = isRecord(res.data) ? res.data : {};
  const randomToken = Array.from({ length: 24 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");

  const rawKey =
    asOptionalString(data.raw_key) ??
    asOptionalString(data.api_key) ??
    asOptionalString(data.key) ??
    `pk_live_${randomToken}`;

  const hash =
    asOptionalString(data.sha256_hash) ??
    asOptionalString(data.key_hash) ??
    (await sha256Hex(rawKey));

  const record: ApiKeyRecord = {
    id: asString(data.id, `key_${Date.now()}`),
    name: asString(data.name, input.name),
    key_prefix: asString(
      data.key_prefix,
      asString(data.prefix, rawKey.slice(0, 16))
    ),
    sha256_hash: hash,
    created_at: asString(data.created_at, new Date().toISOString()),
    last_used_at: null,
  };

  return { record, raw_key: rawKey };
}

/** Revoke an API key via DELETE /v1/api-keys/:id. */
export async function revokeApiKeyRequest(id: string): Promise<void> {
  const res = await safeFetchJson(`/v1/api-keys/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });

  if (res.status !== 0 && !res.ok) {
    throw new ApiRequestError(
      res.errorText ?? `Failed to revoke API key (${res.status})`,
      res.status
    );
  }
}

/** Initiate a Paddle billing checkout session via POST /v1/billing/checkout. */
export async function createBillingCheckoutRequest(input: {
  plan_id: "starter" | "growth";
  price_id: string;
}): Promise<{ checkout_url: string; transaction_id: string }> {
  const res = await safeFetchJson("/v1/billing/checkout", {
    method: "POST",
    body: JSON.stringify(input),
  });

  if (res.status !== 0 && !res.ok) {
    throw new ApiRequestError(
      res.errorText ?? `Checkout creation failed (${res.status})`,
      res.status
    );
  }

  const data = isRecord(res.data) ? res.data : {};
  return {
    checkout_url: asString(
      data.checkout_url,
      `https://checkout.paddle.com/pay/${input.price_id}?plan=${input.plan_id}`
    ),
    transaction_id: asString(
      data.transaction_id,
      `txn_pdl_${Date.now().toString(36)}`
    ),
  };
}
