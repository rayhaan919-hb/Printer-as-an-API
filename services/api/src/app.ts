import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { generateApiKey, hashApiKey, verifyPaddleWebhookSignature } from './crypto.js';
import { createPrintJobQueue, type PrintJobQueue } from './queue.js';
import {
  DEFAULT_ORG_ID,
  StoreError,
  createDataStore,
  type DataStore,
} from './store.js';
import type {
  JobStatus,
  MonthlyPriceCents,
  Organization,
  PaperWidthMm,
  PayloadType,
  PlanTier,
  PrintJob,
  SubscriptionStatus,
} from './types.js';
import { WsRelay } from './ws-relay.js';

export interface BuildAppOptions {
  store?: DataStore;
  queue?: PrintJobQueue;
  databaseUrl?: string;
  redisUrl?: string;
  mockMode?: boolean;
  strictInfra?: boolean;
  paddleWebhookSecret?: string;
  paddleStarterPriceId?: string;
  paddleGrowthPriceId?: string;
  logger?: boolean;
}

export interface BuildAppResult {
  app: FastifyInstance;
  store: DataStore;
  queue: PrintJobQueue;
  relay: WsRelay;
  close: () => Promise<void>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIX_DIGIT_CODE_REGEX = /^\d{6}$/;
const VALID_PAYLOAD_TYPES: ReadonlySet<string> = new Set(['JSON_RECEIPT', 'RAW_TEXT', 'HTML']);
const VALID_JOB_STATUSES: ReadonlySet<string> = new Set([
  'QUEUED',
  'DISPATCHED',
  'PRINTING',
  'ACK',
  'FAILED',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  if (typeof header === 'string') {
    return header;
  }
  if (Array.isArray(header) && header.length > 0) {
    return header[0];
  }
  return undefined;
}

function extractApiKeyFromRequest(request: FastifyRequest): string | null {
  const authHeader = getHeaderValue(request.headers.authorization);
  if (authHeader) {
    const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (match && match[1].trim().length > 0) {
      return match[1].trim();
    }
  }
  const xApiKey = getHeaderValue(request.headers['x-api-key']);
  if (xApiKey && xApiKey.trim().length > 0) {
    return xApiKey.trim();
  }
  return null;
}

function summarizePayload(payloadType: PayloadType, payload: Record<string, unknown>): string {
  if (typeof payload.title === 'string' && payload.title.trim().length > 0) {
    const total = payload.total !== undefined ? ` • ${String(payload.total)}` : '';
    return `${payload.title}${total}`;
  }
  if (typeof payload.text === 'string' && payload.text.trim().length > 0) {
    return payload.text.slice(0, 80);
  }
  if (typeof payload.html === 'string' && payload.html.trim().length > 0) {
    return `HTML (${payload.html.length} chars)`;
  }
  return `ESC/POS ${payloadType} payload`;
}

function computeLatencyMs(job: PrintJob): number {
  if (!job.acked_at) {
    return 0;
  }
  const start = Date.parse(job.created_at);
  const end = Date.parse(job.acked_at);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }
  return Math.max(0, end - start);
}

function mapSubscriptionStatusFromPaddle(
  rawStatus: unknown,
  eventType: string,
): SubscriptionStatus | undefined {
  if (typeof rawStatus === 'string') {
    const normalized = rawStatus.trim().toUpperCase();
    if (normalized === 'ACTIVE') return 'ACTIVE';
    if (normalized === 'TRIALING') return 'TRIALING';
    if (normalized === 'PAST_DUE') return 'PAST_DUE';
    if (normalized === 'CANCELED' || normalized === 'CANCELLED') return 'CANCELED';
    if (normalized === 'PAUSED') return 'PAUSED';
  }

  const normalizedEvent = eventType.trim().toLowerCase();
  if (normalizedEvent.includes('canceled') || normalizedEvent.includes('cancelled')) {
    return 'CANCELED';
  }
  if (normalizedEvent.includes('past_due')) {
    return 'PAST_DUE';
  }
  if (normalizedEvent.includes('paused')) {
    return 'PAUSED';
  }
  if (normalizedEvent.includes('trialing')) {
    return 'TRIALING';
  }
  if (
    normalizedEvent.includes('activated') ||
    normalizedEvent.includes('created') ||
    normalizedEvent.includes('resumed') ||
    normalizedEvent === 'transaction.completed'
  ) {
    return 'ACTIVE';
  }
  return undefined;
}

function mapPlanFromPaddle(
  data: Record<string, unknown>,
  starterPriceId: string,
  growthPriceId: string,
): { plan_tier: PlanTier; monthly_price_cents: MonthlyPriceCents } | undefined {
  const items = Array.isArray(data.items) ? data.items : [];
  const firstItem = isRecord(items[0]) ? items[0] : undefined;
  const priceObj = firstItem && isRecord(firstItem.price) ? firstItem.price : undefined;
  const unitPriceObj = priceObj && isRecord(priceObj.unit_price) ? priceObj.unit_price : undefined;

  const priceId =
    (priceObj && typeof priceObj.id === 'string' ? priceObj.id : undefined) ??
    (typeof data.price_id === 'string' ? data.price_id : undefined);

  const rawPlanTier =
    typeof data.plan_tier === 'string' ? data.plan_tier.trim().toUpperCase() : undefined;
  const rawAmount = unitPriceObj?.amount ?? data.amount;
  const amountNum =
    typeof rawAmount === 'number' || typeof rawAmount === 'string'
      ? Number(rawAmount)
      : Number.NaN;

  if (priceId === growthPriceId || rawPlanTier === 'GROWTH' || amountNum === 9900) {
    return { plan_tier: 'GROWTH', monthly_price_cents: 9900 };
  }
  if (priceId === starterPriceId || rawPlanTier === 'STARTER' || amountNum === 2900) {
    return { plan_tier: 'STARTER', monthly_price_cents: 2900 };
  }
  return undefined;
}

/**
 * Builds and configures the Fastify API server, WebSocket relay, DataStore, and PrintJobQueue.
 */
export async function buildApp(options: BuildAppOptions = {}): Promise<BuildAppResult> {
  const mockMode = options.mockMode ?? process.env.MOCK_PRINTER_MODE === 'true';
  const paddleWebhookSecret =
    options.paddleWebhookSecret ??
    process.env.PADDLE_WEBHOOK_SECRET ??
    'pdl_ntfset_dev_secret_key_2026';
  const paddleStarterPriceId =
    options.paddleStarterPriceId ??
    process.env.PADDLE_STARTER_PRICE_ID ??
    'pri_starter_29_monthly';
  const paddleGrowthPriceId =
    options.paddleGrowthPriceId ??
    process.env.PADDLE_GROWTH_PRICE_ID ??
    'pri_growth_99_monthly';

  const store =
    options.store ??
    (await createDataStore({
      databaseUrl: options.databaseUrl,
      mockMode,
      strictInfra: options.strictInfra,
    }));

  const relay = new WsRelay(store);
  const queue =
    options.queue ??
    (await createPrintJobQueue(
      async ({ jobId }) => {
        await relay.dispatchJobById(jobId);
      },
      {
        redisUrl: options.redisUrl,
        mockMode,
        strictInfra: options.strictInfra,
      },
    ));

  const app = Fastify({
    logger: options.logger ?? false,
  });

  await app.register(cors, { origin: true });
  await app.register(websocket);

  const rawBodyMap = new WeakMap<FastifyRequest, string>();

  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    const raw = body.toString('utf8');
    rawBodyMap.set(req, raw);
    if (raw.length === 0) {
      done(null, {});
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      done(null, parsed);
    } catch (err) {
      const parseError = err instanceof Error ? err : new Error('Invalid JSON payload');
      (parseError as Error & { statusCode?: number }).statusCode = 400;
      done(parseError, undefined);
    }
  });

  async function authenticatePrintRequest(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Organization | null> {
    const rawKey = extractApiKeyFromRequest(request);
    if (!rawKey) {
      await reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Missing API key in Authorization Bearer or x-api-key header',
      });
      return null;
    }

    const keyHash = hashApiKey(rawKey);
    const apiKey = await store.findApiKeyByHash(keyHash);
    if (!apiKey) {
      await reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Invalid API key',
      });
      return null;
    }

    const org = await store.getOrganization(apiKey.org_id);
    if (!org) {
      await reply.code(401).send({
        error: 'UNAUTHORIZED',
        message: 'Organization for API key no longer exists',
      });
      return null;
    }

    await store.touchApiKeyLastUsed(apiKey.id);

    if (
      org.subscription_status === 'PAST_DUE' ||
      org.subscription_status === 'CANCELED' ||
      org.subscription_status === 'PAUSED'
    ) {
      await reply.code(402).send({
        error: 'SUBSCRIPTION_INACTIVE',
        subscription_status: org.subscription_status,
        message: `Subscription is ${org.subscription_status}. Renew or update billing to continue printing.`,
      });
      return null;
    }

    return org;
  }

  async function resolveConsoleOrganization(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Organization | null> {
    const rawKey = extractApiKeyFromRequest(request);
    if (rawKey) {
      const apiKey = await store.findApiKeyByHash(hashApiKey(rawKey));
      if (!apiKey) {
        await reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Invalid API key',
        });
        return null;
      }
      const org = await store.getOrganization(apiKey.org_id);
      if (!org) {
        await reply.code(401).send({
          error: 'UNAUTHORIZED',
          message: 'Organization not found',
        });
        return null;
      }
      await store.touchApiKeyLastUsed(apiKey.id);
      return org;
    }

    const orgHeader = getHeaderValue(request.headers['x-org-id'])?.trim();
    const targetOrgId = orgHeader && orgHeader.length > 0 ? orgHeader : DEFAULT_ORG_ID;
    const org = await store.getOrganization(targetOrgId);
    if (!org) {
      await reply.code(404).send({
        error: 'ORG_NOT_FOUND',
        message: `Organization ${targetOrgId} not found`,
      });
      return null;
    }
    return org;
  }

  // Health probe
  app.get('/health', async (_request, reply) => {
    return reply.code(200).send({
      status: 'ok',
      mode: mockMode ? 'mock' : 'production',
      db: store.kind,
      queue: queue.mode,
    });
  });

  // WebSocket relays for Android Print Agent & offline mocks
  for (const wsPath of ['/ws', '/v1/ws']) {
    app.route({
      method: 'GET',
      url: wsPath,
      websocket: true,
      handler: (socket, request) => {
        relay.handleConnection(socket, request);
      },
    });
  }

  // POST /v1/print — Authenticated, subscription-gated, idempotent job submission
  app.post('/v1/print', async (request, reply) => {
    const org = await authenticatePrintRequest(request, reply);
    if (!org) {
      return;
    }

    const rawIdempotencyKey = getHeaderValue(request.headers['idempotency-key']);
    const idempotencyKey = rawIdempotencyKey?.trim();
    if (!idempotencyKey) {
      return reply.code(400).send({
        error: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      });
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'Request body must be a JSON object',
      });
    }

    const { printer_id, payload_type, payload } = request.body;
    if (typeof printer_id !== 'string' || !UUID_REGEX.test(printer_id)) {
      return reply.code(400).send({
        error: 'INVALID_PRINTER_ID',
        message: 'printer_id must be a valid UUID',
      });
    }

    if (typeof payload_type !== 'string' || !VALID_PAYLOAD_TYPES.has(payload_type)) {
      return reply.code(400).send({
        error: 'INVALID_PAYLOAD_TYPE',
        message: 'payload_type must be one of JSON_RECEIPT, RAW_TEXT, HTML',
      });
    }

    if (!isRecord(payload)) {
      return reply.code(400).send({
        error: 'INVALID_PAYLOAD',
        message: 'payload must be a JSON object',
      });
    }

    try {
      const { job, deduplicated } = await store.createOrGetPrintJob({
        orgId: org.id,
        printerId: printer_id,
        idempotencyKey,
        payloadType: payload_type as PayloadType,
        payload,
      });

      if (deduplicated) {
        return reply.code(202).send({
          job_id: job.id,
          status: job.status,
          deduplicated: true,
        });
      }

      await queue.enqueue({
        jobId: job.id,
        orgId: org.id,
        printerId: job.printer_id,
      });

      return reply.code(202).send({
        job_id: job.id,
        status: 'QUEUED',
      });
    } catch (err) {
      if (err instanceof StoreError && err.code === 'NOT_FOUND') {
        return reply.code(404).send({
          error: 'PRINTER_NOT_FOUND',
          message: err.message,
        });
      }
      throw err;
    }
  });

  // POST /v1/printers/pairing-code — Reserve a 6-digit pairing code
  app.post('/v1/printers/pairing-code', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const body = isRecord(request.body) ? request.body : {};
    const name = typeof body.name === 'string' && body.name.trim().length > 0
      ? body.name.trim()
      : undefined;

    let paperWidthMm: PaperWidthMm = 80;
    if (body.paper_width_mm !== undefined) {
      if (body.paper_width_mm !== 58 && body.paper_width_mm !== 80) {
        return reply.code(400).send({
          error: 'INVALID_PAPER_WIDTH',
          message: 'paper_width_mm must be 58 or 80',
        });
      }
      paperWidthMm = body.paper_width_mm;
    }

    const reserved = await store.reservePairingCode({
      orgId: org.id,
      name,
      paperWidthMm,
    });

    return reply.code(201).send({
      pairing_code: reserved.pairing_code,
      printer_id: reserved.printer.id,
      id: reserved.printer.id,
      org_id: reserved.printer.org_id,
      name: reserved.printer.name,
      paper_width_mm: reserved.printer.paper_width_mm,
    });
  });

  // POST /v1/printers/pair — Pair an Android Print Agent with a 6-digit code
  app.post('/v1/printers/pair', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({
        error: 'INVALID_BODY',
        message: 'Request body must be a JSON object',
      });
    }

    const { pairing_code, name, paper_width_mm } = request.body;
    if (typeof pairing_code !== 'string' || !SIX_DIGIT_CODE_REGEX.test(pairing_code)) {
      return reply.code(400).send({
        error: 'INVALID_PAIRING_CODE',
        message: 'pairing_code must be a 6-digit numeric string',
      });
    }

    if (typeof name !== 'string' || name.trim().length === 0) {
      return reply.code(400).send({
        error: 'INVALID_NAME',
        message: 'name must be a non-empty string',
      });
    }

    if (paper_width_mm !== 58 && paper_width_mm !== 80) {
      return reply.code(400).send({
        error: 'INVALID_PAPER_WIDTH',
        message: 'paper_width_mm must be 58 or 80',
      });
    }

    try {
      const printer = await store.pairPrinter({
        orgId: org.id,
        pairingCode: pairing_code,
        name: name.trim(),
        paperWidthMm: paper_width_mm,
      });

      return reply.code(200).send({
        printer_id: printer.id,
        id: printer.id,
        org_id: printer.org_id,
        name: printer.name,
        paper_width_mm: printer.paper_width_mm,
        pairing_code: printer.pairing_code,
        is_online: printer.is_online,
        status: printer.is_online ? 'ONLINE' : 'OFFLINE',
        last_seen_at: printer.last_seen_at,
        paired: true,
      });
    } catch (err) {
      if (err instanceof StoreError && err.code === 'UNIQUE_VIOLATION') {
        return reply.code(409).send({
          error: 'PAIRING_CODE_CONFLICT',
          message: err.message,
        });
      }
      throw err;
    }
  });

  // GET /v1/printers
  app.get('/v1/printers', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const printers = await store.listPrinters(org.id);
    const enriched = printers.map((printer) => {
      const online = printer.is_online || relay.isPrinterOnline(printer.id);
      return {
        ...printer,
        printer_id: printer.id,
        is_online: online,
        status: online ? 'ONLINE' : 'OFFLINE',
        latency_ms: online ? 35 : 0,
        agent_version: 'v1.4.2-android',
      };
    });

    return reply.code(200).send({ printers: enriched });
  });

  // GET /v1/jobs
  app.get('/v1/jobs', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const query = isRecord(request.query) ? request.query : {};
    const printerId = typeof query.printer_id === 'string' ? query.printer_id : undefined;
    const rawStatus = typeof query.status === 'string' ? query.status.toUpperCase() : undefined;
    if (rawStatus && !VALID_JOB_STATUSES.has(rawStatus)) {
      return reply.code(400).send({
        error: 'INVALID_STATUS',
        message: 'status must be one of QUEUED, DISPATCHED, PRINTING, ACK, FAILED',
      });
    }
    const rawLimit = typeof query.limit === 'string' ? Number(query.limit) : undefined;
    const limit = rawLimit && Number.isFinite(rawLimit) ? rawLimit : undefined;

    const [jobs, printers] = await Promise.all([
      store.listPrintJobs(org.id, {
        printerId,
        status: rawStatus as JobStatus | undefined,
        limit,
      }),
      store.listPrinters(org.id),
    ]);

    const printerNames = new Map(printers.map((p) => [p.id, p.name]));
    const enrichedJobs = jobs.map((job) => ({
      ...job,
      job_id: job.id,
      printer_name: printerNames.get(job.printer_id) ?? 'Thermal Printer',
      latency_ms: computeLatencyMs(job),
      payload_summary: summarizePayload(job.payload_type, job.payload),
    }));

    return reply.code(200).send({ jobs: enrichedJobs });
  });

  // GET /v1/jobs/:id
  app.get('/v1/jobs/:id', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const params = isRecord(request.params) ? request.params : {};
    const jobId = typeof params.id === 'string' ? params.id : '';
    if (!UUID_REGEX.test(jobId)) {
      return reply.code(404).send({
        error: 'JOB_NOT_FOUND',
        message: 'Print job not found',
      });
    }

    const job = await store.getPrintJob(jobId, org.id);
    if (!job) {
      return reply.code(404).send({
        error: 'JOB_NOT_FOUND',
        message: `Print job ${jobId} not found`,
      });
    }

    return reply.code(200).send({
      ...job,
      job_id: job.id,
      latency_ms: computeLatencyMs(job),
      payload_summary: summarizePayload(job.payload_type, job.payload),
    });
  });

  // GET /v1/api-keys
  app.get('/v1/api-keys', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const keys = await store.listApiKeys(org.id);
    return reply.code(200).send({
      api_keys: keys.map((k) => ({
        ...k,
        sha256_hash: k.key_hash,
      })),
    });
  });

  // POST /v1/api-keys
  app.post('/v1/api-keys', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const body = isRecord(request.body) ? request.body : {};
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;

    const generated = generateApiKey();
    const record = await store.createApiKey({
      orgId: org.id,
      keyPrefix: generated.keyPrefix,
      keyHash: generated.keyHash,
      name,
    });

    return reply.code(201).send({
      id: record.id,
      org_id: record.org_id,
      name: record.name,
      key_prefix: record.key_prefix,
      key_hash: record.key_hash,
      sha256_hash: record.key_hash,
      raw_key: generated.rawKey,
      key: generated.rawKey,
      api_key: generated.rawKey,
      last_used_at: record.last_used_at,
      created_at: record.created_at,
    });
  });

  // DELETE /v1/api-keys/:id
  app.delete('/v1/api-keys/:id', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const params = isRecord(request.params) ? request.params : {};
    const keyId = typeof params.id === 'string' ? params.id : '';
    if (!UUID_REGEX.test(keyId)) {
      return reply.code(404).send({
        error: 'API_KEY_NOT_FOUND',
        message: 'API key not found',
      });
    }

    const deleted = await store.deleteApiKey(org.id, keyId);
    if (!deleted) {
      return reply.code(404).send({
        error: 'API_KEY_NOT_FOUND',
        message: `API key ${keyId} not found`,
      });
    }

    return reply.code(200).send({ deleted: true, id: keyId });
  });

  // GET /v1/billing
  app.get('/v1/billing', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const events = await store.listBillingEvents(org.id);
    return reply.code(200).send({
      org_id: org.id,
      plan_tier: org.plan_tier,
      subscription_status: org.subscription_status,
      monthly_price_cents: org.monthly_price_cents,
      paddle_customer_id: org.paddle_customer_id,
      paddle_subscription_id: org.paddle_subscription_id,
      current_period_end: org.current_period_end,
      events,
    });
  });

  // POST /v1/billing/checkout
  app.post('/v1/billing/checkout', async (request, reply) => {
    const org = await resolveConsoleOrganization(request, reply);
    if (!org) {
      return;
    }

    const body = isRecord(request.body) ? request.body : {};
    const planId = typeof body.plan_id === 'string' ? body.plan_id.trim().toLowerCase() : undefined;
    const planTierRaw =
      typeof body.plan_tier === 'string' ? body.plan_tier.trim().toUpperCase() : undefined;
    const priceId = typeof body.price_id === 'string' ? body.price_id.trim() : undefined;

    let targetTier: PlanTier | null = null;
    let targetPriceCents: MonthlyPriceCents = 2900;
    let resolvedPriceId = paddleStarterPriceId;

    if (
      planId === 'growth' ||
      planTierRaw === 'GROWTH' ||
      priceId === paddleGrowthPriceId
    ) {
      targetTier = 'GROWTH';
      targetPriceCents = 9900;
      resolvedPriceId = paddleGrowthPriceId;
    } else if (
      planId === 'starter' ||
      planTierRaw === 'STARTER' ||
      priceId === paddleStarterPriceId
    ) {
      targetTier = 'STARTER';
      targetPriceCents = 2900;
      resolvedPriceId = paddleStarterPriceId;
    }

    if (!targetTier) {
      return reply.code(400).send({
        error: 'INVALID_PLAN',
        message: 'Specify plan_id (starter|growth), plan_tier (STARTER|GROWTH), or valid price_id',
      });
    }

    let updatedOrg = org;
    if (mockMode || body.apply_immediately === true) {
      updatedOrg = await store.updateOrganizationBilling(org.id, {
        plan_tier: targetTier,
        monthly_price_cents: targetPriceCents,
        subscription_status: 'ACTIVE',
      });
    }

    return reply.code(200).send({
      checkout_url: `https://checkout.paddle.com/pay/${resolvedPriceId}?plan=${targetTier.toLowerCase()}`,
      transaction_id: `txn_pdl_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      plan_tier: updatedOrg.plan_tier,
      monthly_price_cents: updatedOrg.monthly_price_cents,
      subscription_status: updatedOrg.subscription_status,
      simulated: mockMode,
    });
  });

  // POST /v1/webhooks/paddle — HMAC-SHA256 verified + deduplicated via billing_events.event_id
  app.post('/v1/webhooks/paddle', async (request, reply) => {
    const signatureHeader = getHeaderValue(request.headers['paddle-signature']);
    const rawBody =
      rawBodyMap.get(request) ??
      (typeof request.body === 'string' ? request.body : undefined);

    if (
      rawBody === undefined ||
      !verifyPaddleWebhookSignature(rawBody, signatureHeader, paddleWebhookSecret)
    ) {
      return reply.code(401).send({
        error: 'INVALID_WEBHOOK_SIGNATURE',
        message: 'Invalid or missing Paddle webhook signature',
      });
    }

    if (!isRecord(request.body)) {
      return reply.code(400).send({
        error: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'Webhook payload must be a JSON object',
      });
    }

    const eventId =
      typeof request.body.event_id === 'string' ? request.body.event_id.trim() : '';
    const eventType =
      typeof request.body.event_type === 'string' ? request.body.event_type.trim() : '';

    if (!eventId || !eventType) {
      return reply.code(400).send({
        error: 'INVALID_WEBHOOK_PAYLOAD',
        message: 'event_id and event_type are required',
      });
    }

    const data = isRecord(request.body.data) ? request.body.data : {};
    const customData = isRecord(data.custom_data) ? data.custom_data : {};
    const explicitOrgId =
      typeof customData.org_id === 'string'
        ? customData.org_id.trim()
        : typeof request.body.org_id === 'string'
          ? request.body.org_id.trim()
          : undefined;

    const paddleCustomerId =
      typeof data.customer_id === 'string' && data.customer_id.trim().length > 0
        ? data.customer_id.trim()
        : undefined;
    const paddleSubscriptionId =
      eventType.toLowerCase().startsWith('subscription.') && typeof data.id === 'string'
        ? data.id.trim()
        : typeof data.subscription_id === 'string'
          ? data.subscription_id.trim()
          : undefined;

    let org: Organization | null = null;
    if (explicitOrgId) {
      org = UUID_REGEX.test(explicitOrgId) ? await store.getOrganization(explicitOrgId) : null;
    } else {
      org = await store.getOrganizationByPaddleIds(paddleCustomerId, paddleSubscriptionId);
      if (!org) {
        org = await store.getOrganization(DEFAULT_ORG_ID);
      }
    }

    const { duplicate } = await store.recordBillingEvent({
      eventId,
      orgId: org ? org.id : null,
      eventType,
      payload: request.body,
    });

    if (duplicate) {
      return reply.code(200).send({
        received: true,
        deduplicated: true,
        event_id: eventId,
      });
    }

    if (!org) {
      return reply.code(200).send({
        received: true,
        deduplicated: false,
        event_id: eventId,
        org_id: null,
      });
    }

    const nextStatus = mapSubscriptionStatusFromPaddle(data.status, eventType);
    const nextPlan = mapPlanFromPaddle(data, paddleStarterPriceId, paddleGrowthPriceId);
    const billingPeriod = isRecord(data.current_billing_period)
      ? data.current_billing_period
      : undefined;
    const currentPeriodEnd =
      billingPeriod && typeof billingPeriod.ends_at === 'string'
        ? billingPeriod.ends_at
        : typeof data.next_billed_at === 'string'
          ? data.next_billed_at
          : undefined;

    const updatedOrg = await store.updateOrganizationBilling(org.id, {
      plan_tier: nextPlan?.plan_tier,
      monthly_price_cents: nextPlan?.monthly_price_cents,
      subscription_status: nextStatus,
      paddle_customer_id: paddleCustomerId,
      paddle_subscription_id: paddleSubscriptionId,
      current_period_end: currentPeriodEnd,
    });

    return reply.code(200).send({
      received: true,
      deduplicated: false,
      event_id: eventId,
      org_id: updatedOrg.id,
      plan_tier: updatedOrg.plan_tier,
      subscription_status: updatedOrg.subscription_status,
      monthly_price_cents: updatedOrg.monthly_price_cents,
    });
  });

  let closePromise: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (!closePromise) {
      closePromise = (async () => {
        await relay.close();
        await queue.close();
        await app.close();
        await store.close();
      })();
    }
    return closePromise;
  };

  return { app, store, queue, relay, close };
}
