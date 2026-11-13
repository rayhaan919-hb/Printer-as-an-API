import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp, type BuildAppResult } from '../src/app.js';
import {
  generateApiKey,
  generatePairingCode,
  hashApiKey,
  signPaddleWebhook,
  verifyPaddleWebhookSignature,
} from '../src/crypto.js';
import {
  DEFAULT_ORG_ID,
  DEFAULT_PAIRING_CODE,
  DEFAULT_PRINTER_ID,
  DEFAULT_RAW_API_KEY,
  InMemoryDataStore,
  StoreError,
} from '../src/store.js';

const WEBHOOK_SECRET = 'pdl_ntfset_test_secret_2026';

function wsDataToString(data: Buffer | ArrayBuffer | Buffer[] | string): string {
  if (typeof data === 'string') {
    return data;
  }
  if (Buffer.isBuffer(data)) {
    return data.toString('utf8');
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  return Buffer.from(data).toString('utf8');
}

async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  timeoutMs = 3000,
  intervalMs = 20,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

function openWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`WebSocket connection timeout: ${url}`));
    }, 3000);

    ws.once('open', () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function closeWebSocket(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    if (ws.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    ws.once('close', () => resolve());
    ws.close();
  });
}

describe('Printer-as-an-API Service', () => {
  const activeApps: BuildAppResult[] = [];
  const activeSockets: WebSocket[] = [];

  async function setupApp(): Promise<BuildAppResult> {
    const built = await buildApp({
      mockMode: true,
      paddleWebhookSecret: WEBHOOK_SECRET,
    });
    activeApps.push(built);
    return built;
  }

  afterEach(async () => {
    while (activeSockets.length > 0) {
      const sock = activeSockets.pop();
      if (sock) {
        await closeWebSocket(sock);
      }
    }
    while (activeApps.length > 0) {
      const built = activeApps.pop();
      if (built) {
        await built.close();
      }
    }
  });

  describe('1. Crypto & API Key Authentication', () => {
    it('hashes API keys with SHA-256 and generates prefixed keys + 6-digit codes', () => {
      const generated = generateApiKey();
      const expectedHash = createHash('sha256').update(generated.rawKey, 'utf8').digest('hex');

      expect(generated.rawKey.startsWith(generated.keyPrefix)).toBe(true);
      expect(generated.keyPrefix).toMatch(/^pk_live_/);
      expect(generated.keyHash).toBe(expectedHash);
      expect(hashApiKey(generated.rawKey)).toBe(expectedHash);

      const code = generatePairingCode();
      expect(code).toMatch(/^\d{6}$/);
    });

    it('creates API key storing only prefix/hash, rejects invalid keys with 401, and accepts valid keys with 202', async () => {
      const { app, store } = await setupApp();

      const missingAuthRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: { 'idempotency-key': 'idem-no-auth' },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Test' },
        },
      });
      expect(missingAuthRes.statusCode).toBe(401);

      const badAuthRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: 'Bearer pk_live_completely_invalid_key',
          'idempotency-key': 'idem-bad-auth',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Test' },
        },
      });
      expect(badAuthRes.statusCode).toBe(401);

      const createKeyRes = await app.inject({
        method: 'POST',
        url: '/v1/api-keys',
        payload: { name: 'POS Terminal #1' },
      });
      expect(createKeyRes.statusCode).toBe(201);
      const createdKey = createKeyRes.json<{
        id: string;
        key_prefix: string;
        key_hash: string;
        raw_key: string;
      }>();
      expect(createdKey.raw_key.startsWith(createdKey.key_prefix)).toBe(true);
      expect(createdKey.key_hash).toBe(hashApiKey(createdKey.raw_key));

      const stored = await store.findApiKeyByHash(createdKey.key_hash);
      expect(stored).not.toBeNull();
      expect(stored?.key_prefix).toBe(createdKey.key_prefix);

      const listKeysRes = await app.inject({
        method: 'GET',
        url: '/v1/api-keys',
      });
      expect(listKeysRes.statusCode).toBe(200);
      const listed = listKeysRes.json<{ api_keys: Array<Record<string, unknown>> }>();
      const matched = listed.api_keys.find((k: Record<string, unknown>) => k.id === createdKey.id);
      expect(matched).toBeDefined();
      expect(matched?.raw_key).toBeUndefined();

      const validPrintRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${createdKey.raw_key}`,
          'idempotency-key': 'idem-valid-new-key',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'JSON_RECEIPT',
          payload: { title: 'Cafe Order', total: '$12.00' },
        },
      });
      expect(validPrintRes.statusCode).toBe(202);
      expect(validPrintRes.json()).toMatchObject({ status: 'QUEUED' });

      // Default seeded key via x-api-key header also works
      const defaultKeyRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          'x-api-key': DEFAULT_RAW_API_KEY,
          'idempotency-key': 'idem-default-seed-key',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Hello' },
        },
      });
      expect(defaultKeyRes.statusCode).toBe(202);

      // Revoking key invalidates subsequent print requests
      const revokeRes = await app.inject({
        method: 'DELETE',
        url: `/v1/api-keys/${createdKey.id}`,
      });
      expect(revokeRes.statusCode).toBe(200);

      const revokedPrintRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${createdKey.raw_key}`,
          'idempotency-key': 'idem-after-revoke',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Should fail' },
        },
      });
      expect(revokedPrintRes.statusCode).toBe(401);
    });
  });

  describe('2. Print Idempotency-Key & Payload Validation', () => {
    it('enforces Idempotency-Key (400 if missing) and returns exact same job_id on replay', async () => {
      const { app } = await setupApp();

      const missingHeader = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: { authorization: `Bearer ${DEFAULT_RAW_API_KEY}` },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Missing header' },
        },
      });
      expect(missingHeader.statusCode).toBe(400);

      const blankHeader = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${DEFAULT_RAW_API_KEY}`,
          'idempotency-key': '   ',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Blank header' },
        },
      });
      expect(blankHeader.statusCode).toBe(400);

      const firstRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${DEFAULT_RAW_API_KEY}`,
          'idempotency-key': 'order-8891-print-1',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'JSON_RECEIPT',
          payload: { order_id: '8891', total: 29.0 },
        },
      });
      expect(firstRes.statusCode).toBe(202);
      const firstBody = firstRes.json<{ job_id: string; status: string }>();
      expect(firstBody.status).toBe('QUEUED');
      expect(firstBody.job_id).toMatch(/^[0-9a-f-]{36}$/i);

      const replayRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${DEFAULT_RAW_API_KEY}`,
          'idempotency-key': 'order-8891-print-1',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'JSON_RECEIPT',
          payload: { order_id: '8891', total: 29.0 },
        },
      });
      expect(replayRes.statusCode).toBe(202);
      const replayBody = replayRes.json<{
        job_id: string;
        status: string;
        deduplicated?: boolean;
      }>();
      expect(replayBody.job_id).toBe(firstBody.job_id);
      expect(replayBody.deduplicated).toBe(true);

      const jobsListRes = await app.inject({ method: 'GET', url: '/v1/jobs' });
      const jobsList = jobsListRes.json<{ jobs: Array<{ job_id: string }> }>();
      expect(jobsList.jobs.filter((j: { job_id: string }) => j.job_id === firstBody.job_id)).toHaveLength(1);
    });
  });

  describe('3. Printer Pairing & Validation', () => {
    it('validates 6-digit pairing codes and 58/80mm paper widths', async () => {
      const { app } = await setupApp();

      const shortCode = await app.inject({
        method: 'POST',
        url: '/v1/printers/pair',
        payload: { pairing_code: '12345', name: 'Counter', paper_width_mm: 80 },
      });
      expect(shortCode.statusCode).toBe(400);

      const alphaCode = await app.inject({
        method: 'POST',
        url: '/v1/printers/pair',
        payload: { pairing_code: '12AB56', name: 'Counter', paper_width_mm: 80 },
      });
      expect(alphaCode.statusCode).toBe(400);

      const badWidth = await app.inject({
        method: 'POST',
        url: '/v1/printers/pair',
        payload: { pairing_code: '654321', name: 'Counter', paper_width_mm: 72 },
      });
      expect(badWidth.statusCode).toBe(400);

      const pairNew = await app.inject({
        method: 'POST',
        url: '/v1/printers/pair',
        payload: {
          pairing_code: '654321',
          name: 'Bar Station 58mm',
          paper_width_mm: 58,
        },
      });
      expect(pairNew.statusCode).toBe(200);
      expect(pairNew.json()).toMatchObject({
        org_id: DEFAULT_ORG_ID,
        name: 'Bar Station 58mm',
        paper_width_mm: 58,
        pairing_code: '654321',
        paired: true,
      });

      // Reserve a code first via /v1/printers/pairing-code then pair it
      const reserveRes = await app.inject({
        method: 'POST',
        url: '/v1/printers/pairing-code',
        payload: { name: 'Pending Receipt Printer', paper_width_mm: 80 },
      });
      expect(reserveRes.statusCode).toBe(201);
      const reserved = reserveRes.json<{ pairing_code: string; printer_id: string }>();
      expect(reserved.pairing_code).toMatch(/^\d{6}$/);

      const pairReserved = await app.inject({
        method: 'POST',
        url: '/v1/printers/pair',
        payload: {
          pairing_code: reserved.pairing_code,
          name: 'Patio Printer 80mm',
          paper_width_mm: 80,
        },
      });
      expect(pairReserved.statusCode).toBe(200);
      expect(pairReserved.json()).toMatchObject({
        printer_id: reserved.printer_id,
        name: 'Patio Printer 80mm',
        paper_width_mm: 80,
        pairing_code: reserved.pairing_code,
        paired: true,
      });

      // Re-pairing seeded pairing code updates default printer cleanly
      const pairSeeded = await app.inject({
        method: 'POST',
        url: '/v1/printers/pair',
        payload: {
          pairing_code: DEFAULT_PAIRING_CODE,
          name: 'Kitchen Counter 80mm Paired',
          paper_width_mm: 80,
        },
      });
      expect(pairSeeded.statusCode).toBe(200);
      expect(pairSeeded.json()).toMatchObject({
        printer_id: DEFAULT_PRINTER_ID,
        paired: true,
      });
    });
  });

  describe('4. Paddle Webhooks, Plan Transitions & 402 Subscription Gating', () => {
    it('verifies Paddle HMAC signatures, transitions Starter ($29) <-> Growth ($99), deduplicates event_id, and enforces 402 gating', async () => {
      const { app } = await setupApp();
      const nowTs = String(Math.floor(Date.now() / 1000));

      const rawGrowthBody = JSON.stringify({
        event_id: 'evt_paddle_growth_001',
        event_type: 'subscription.updated',
        data: {
          id: 'sub_01j9growth',
          customer_id: 'ctm_01j9demo',
          status: 'active',
          custom_data: { org_id: DEFAULT_ORG_ID },
          current_billing_period: { ends_at: '2026-12-13T00:00:00Z' },
          items: [
            {
              price: {
                id: 'pri_growth_99_monthly',
                unit_price: { amount: '9900', currency_code: 'USD' },
              },
            },
          ],
        },
      });

      // Tampered signature must return 401
      const tamperedRes = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/paddle',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': `ts=${nowTs};h1=${'0'.repeat(64)}`,
        },
        payload: rawGrowthBody,
      });
      expect(tamperedRes.statusCode).toBe(401);

      // Expired timestamp must fail verification
      const staleTs = String(Number(nowTs) - 900);
      const staleSig = signPaddleWebhook(rawGrowthBody, staleTs, WEBHOOK_SECRET);
      expect(verifyPaddleWebhookSignature(rawGrowthBody, staleSig, WEBHOOK_SECRET)).toBe(false);

      // Valid signed Growth transition ($99/mo)
      const validGrowthSig = signPaddleWebhook(rawGrowthBody, nowTs, WEBHOOK_SECRET);
      const growthRes = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/paddle',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': validGrowthSig,
        },
        payload: rawGrowthBody,
      });
      expect(growthRes.statusCode).toBe(200);
      expect(growthRes.json()).toMatchObject({
        received: true,
        deduplicated: false,
        plan_tier: 'GROWTH',
        monthly_price_cents: 9900,
        subscription_status: 'ACTIVE',
      });

      const billingGrowth = await app.inject({ method: 'GET', url: '/v1/billing' });
      expect(billingGrowth.json()).toMatchObject({
        plan_tier: 'GROWTH',
        monthly_price_cents: 9900,
        subscription_status: 'ACTIVE',
        paddle_customer_id: 'ctm_01j9demo',
        paddle_subscription_id: 'sub_01j9growth',
      });

      // Duplicate webhook event_id must deduplicate without mutating state
      const duplicateGrowthRes = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/paddle',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': validGrowthSig,
        },
        payload: rawGrowthBody,
      });
      expect(duplicateGrowthRes.statusCode).toBe(200);
      expect(duplicateGrowthRes.json()).toMatchObject({
        received: true,
        deduplicated: true,
        event_id: 'evt_paddle_growth_001',
      });

      // Downgrade back to Starter ($29/mo)
      const rawStarterBody = JSON.stringify({
        event_id: 'evt_paddle_starter_002',
        event_type: 'subscription.updated',
        data: {
          id: 'sub_01j9growth',
          customer_id: 'ctm_01j9demo',
          status: 'active',
          items: [
            {
              price: {
                id: 'pri_starter_29_monthly',
                unit_price: { amount: '2900', currency_code: 'USD' },
              },
            },
          ],
        },
      });
      const starterRes = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/paddle',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signPaddleWebhook(rawStarterBody, nowTs, WEBHOOK_SECRET),
        },
        payload: rawStarterBody,
      });
      expect(starterRes.statusCode).toBe(200);
      expect(starterRes.json()).toMatchObject({
        plan_tier: 'STARTER',
        monthly_price_cents: 2900,
      });

      // Transition to PAST_DUE -> /v1/print returns 402
      const rawPastDueBody = JSON.stringify({
        event_id: 'evt_paddle_past_due_003',
        event_type: 'subscription.past_due',
        data: {
          id: 'sub_01j9growth',
          customer_id: 'ctm_01j9demo',
          status: 'past_due',
        },
      });
      const pastDueRes = await app.inject({
        method: 'POST',
        url: '/v1/webhooks/paddle',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signPaddleWebhook(rawPastDueBody, nowTs, WEBHOOK_SECRET),
        },
        payload: rawPastDueBody,
      });
      expect(pastDueRes.statusCode).toBe(200);

      const gatedPastDue = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${DEFAULT_RAW_API_KEY}`,
          'idempotency-key': 'idem-blocked-past-due',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Blocked' },
        },
      });
      expect(gatedPastDue.statusCode).toBe(402);
      expect(gatedPastDue.json()).toMatchObject({
        error: 'SUBSCRIPTION_INACTIVE',
        subscription_status: 'PAST_DUE',
      });

      // Transition to CANCELED -> /v1/print returns 402
      const rawCanceledBody = JSON.stringify({
        event_id: 'evt_paddle_canceled_004',
        event_type: 'subscription.canceled',
        data: {
          id: 'sub_01j9growth',
          customer_id: 'ctm_01j9demo',
          status: 'canceled',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/v1/webhooks/paddle',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signPaddleWebhook(rawCanceledBody, nowTs, WEBHOOK_SECRET),
        },
        payload: rawCanceledBody,
      });

      const gatedCanceled = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${DEFAULT_RAW_API_KEY}`,
          'idempotency-key': 'idem-blocked-canceled',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Blocked' },
        },
      });
      expect(gatedCanceled.statusCode).toBe(402);
      expect(gatedCanceled.json()).toMatchObject({
        error: 'SUBSCRIPTION_INACTIVE',
        subscription_status: 'CANCELED',
      });

      // Reactivate -> /v1/print returns 202 again
      const rawReactivatedBody = JSON.stringify({
        event_id: 'evt_paddle_reactivated_005',
        event_type: 'subscription.activated',
        data: {
          id: 'sub_01j9growth',
          customer_id: 'ctm_01j9demo',
          status: 'active',
        },
      });
      await app.inject({
        method: 'POST',
        url: '/v1/webhooks/paddle',
        headers: {
          'content-type': 'application/json',
          'paddle-signature': signPaddleWebhook(rawReactivatedBody, nowTs, WEBHOOK_SECRET),
        },
        payload: rawReactivatedBody,
      });

      const restoredPrint = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${DEFAULT_RAW_API_KEY}`,
          'idempotency-key': 'idem-restored-active',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Restored' },
        },
      });
      expect(restoredPrint.statusCode).toBe(202);
    });
  });

  describe('5. End-to-End WebSocket Relay Dispatch & ACK Flow', () => {
    it('dispatches live print jobs over WebSocket and transitions QUEUED -> DISPATCHED -> PRINTING -> ACK', async () => {
      const { app } = await setupApp();
      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      if (typeof address !== 'object' || address === null) {
        throw new Error('Expected listening address object');
      }
      const wsUrl = `ws://127.0.0.1:${address.port}/ws?printer_id=${DEFAULT_PRINTER_ID}`;
      const ws = await openWebSocket(wsUrl);
      activeSockets.push(ws);

      const receivedFrames: Array<Record<string, unknown>> = [];
      ws.on('message', (raw) => {
        try {
          const parsed = JSON.parse(wsDataToString(raw)) as Record<string, unknown>;
          receivedFrames.push(parsed);
        } catch {
          // ignore
        }
      });

      ws.send(JSON.stringify({ type: 'REGISTER', printer_id: DEFAULT_PRINTER_ID }));

      // Wait until printer is marked online
      await waitFor(async () => {
        const res = await app.inject({ method: 'GET', url: '/v1/printers' });
        const body = res.json<{ printers: Array<{ id: string; is_online: boolean }> }>();
        const printer = body.printers.find((p: { id: string; is_online: boolean }) => p.id === DEFAULT_PRINTER_ID);
        return printer?.is_online === true;
      });

      const printRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${DEFAULT_RAW_API_KEY}`,
          'idempotency-key': 'idem-ws-live-001',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'JSON_RECEIPT',
          payload: { title: 'Receipt #101', total: '$24.50' },
        },
      });
      expect(printRes.statusCode).toBe(202);
      const { job_id: jobId } = printRes.json<{ job_id: string; status: string }>();

      const dispatchedFrame = await waitFor(async () =>
        receivedFrames.find((f) => f.type === 'DISPATCHED' && f.job_id === jobId),
      );
      expect(dispatchedFrame).toMatchObject({
        type: 'DISPATCHED',
        job_id: jobId,
        printer_id: DEFAULT_PRINTER_ID,
        payload_type: 'JSON_RECEIPT',
        payload: { title: 'Receipt #101', total: '$24.50' },
        status: 'DISPATCHED',
      });

      ws.send(JSON.stringify({ type: 'PRINTING', job_id: jobId }));
      await waitFor(async () => {
        const res = await app.inject({ method: 'GET', url: `/v1/jobs/${jobId}` });
        const job = res.json<{ status: string }>();
        return job.status === 'PRINTING';
      });

      ws.send(JSON.stringify({ type: 'ACK', job_id: jobId }));
      const ackedJob = await waitFor(async () => {
        const res = await app.inject({ method: 'GET', url: `/v1/jobs/${jobId}` });
        const job = res.json<{ status: string; acked_at: string | null }>();
        return job.status === 'ACK' ? job : null;
      });
      expect(ackedJob.acked_at).not.toBeNull();
    });

    it('flushes queued jobs when agent connects later on /v1/ws and handles FAILED frames', async () => {
      const { app } = await setupApp();
      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      if (typeof address !== 'object' || address === null) {
        throw new Error('Expected listening address object');
      }

      // Enqueue while printer is offline
      const offlinePrintRes = await app.inject({
        method: 'POST',
        url: '/v1/print',
        headers: {
          authorization: `Bearer ${DEFAULT_RAW_API_KEY}`,
          'idempotency-key': 'idem-ws-offline-flush-002',
        },
        payload: {
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Queued while offline' },
        },
      });
      expect(offlinePrintRes.statusCode).toBe(202);
      const { job_id: jobId } = offlinePrintRes.json<{ job_id: string }>();

      // Connect via /v1/ws and register via frame (without query parameter)
      const ws = await openWebSocket(`ws://127.0.0.1:${address.port}/v1/ws`);
      activeSockets.push(ws);

      const receivedFrames: Array<Record<string, unknown>> = [];
      ws.on('message', (raw) => {
        try {
          const parsed = JSON.parse(wsDataToString(raw)) as Record<string, unknown>;
          receivedFrames.push(parsed);
        } catch {
          // ignore
        }
      });

      ws.send(JSON.stringify({ type: 'REGISTER', printer_id: DEFAULT_PRINTER_ID }));

      const flushed = await waitFor(async () =>
        receivedFrames.find((f) => f.type === 'DISPATCHED' && f.job_id === jobId),
      );
      expect(flushed.job_id).toBe(jobId);

      ws.send(
        JSON.stringify({
          type: 'FAILED',
          job_id: jobId,
          error_message: 'Paper cover open',
        }),
      );

      const failedJob = await waitFor(async () => {
        const res = await app.inject({ method: 'GET', url: `/v1/jobs/${jobId}` });
        const job = res.json<{ status: string; error_message: string | null }>();
        return job.status === 'FAILED' ? job : null;
      });
      expect(failedJob.error_message).toBe('Paper cover open');
    });
  });

  describe('6. InMemoryDataStore Schema Constraint Enforcement', () => {
    it('enforces UNIQUE constraints on key_hash, pairing_code, and billing event_id', async () => {
      const store = new InMemoryDataStore();
      await store.seedDefaults();

      await expect(
        store.createApiKey({
          orgId: DEFAULT_ORG_ID,
          keyPrefix: 'pk_live_dupl',
          keyHash: hashApiKey(DEFAULT_RAW_API_KEY),
        }),
      ).rejects.toBeInstanceOf(StoreError);

      const firstEvt = await store.recordBillingEvent({
        eventId: 'evt_unique_1',
        orgId: DEFAULT_ORG_ID,
        eventType: 'subscription.created',
        payload: { test: true },
      });
      expect(firstEvt.duplicate).toBe(false);

      const secondEvt = await store.recordBillingEvent({
        eventId: 'evt_unique_1',
        orgId: DEFAULT_ORG_ID,
        eventType: 'subscription.created',
        payload: { test: true },
      });
      expect(secondEvt.duplicate).toBe(true);
    });
  });
});
