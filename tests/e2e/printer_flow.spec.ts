import { createHmac } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { startMockPrinterAgent } from '../mocks/mock_agent.js';

const ROOT_DIR = path.resolve(process.cwd(), '../..');
const API_DIR = path.join(ROOT_DIR, 'services', 'api');
const WEB_DIR = path.join(ROOT_DIR, 'apps', 'web');

const API_URL = process.env.API_BASE_URL ?? 'http://127.0.0.1:4000';
const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:4000/ws';
const WEB_URL = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
const DEFAULT_API_KEY = 'pk_live_default_test_key_0123456789abcdef';
const DEFAULT_PRINTER_ID = '00000000-0000-4000-8000-000000000101';
const PADDLE_SECRET = 'pdl_ntfset_dev_secret_key_2026';

function signPaddleBody(rawBody: string, secret = PADDLE_SECRET): string {
  const ts = Math.floor(Date.now() / 1000).toString();
  const h1 = createHmac('sha256', secret).update(`${ts}:${rawBody}`).digest('hex');
  return `ts=${ts};h1=${h1}`;
}

async function waitForHttpReady(url: string, timeoutMs = 25_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // Retry until ready
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function spawnService(command: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/c', command, ...args], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
  }
  return spawn(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
}

async function stopProcess(proc: ChildProcess | null): Promise<void> {
  if (!proc || proc.killed || proc.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32' && proc.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
    });
  } else {
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      proc.once('exit', () => resolve());
      setTimeout(resolve, 2000);
    });
  }
}

test.describe('Printer-as-an-API End-to-End Flow', () => {
  let apiProc: ChildProcess | null = null;
  let webProc: ChildProcess | null = null;
  let startedApiHere = false;
  let startedWebHere = false;

  test.beforeAll(async () => {
    const apiAlreadyRunning = await fetch(`${API_URL}/health`)
      .then((r) => r.ok)
      .catch(() => false);

    if (!apiAlreadyRunning) {
      startedApiHere = true;
      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      apiProc = spawnService(
        npxBin,
        ['tsx', 'src/index.ts'],
        API_DIR,
        {
          PORT: '4000',
          MOCK_PRINTER_MODE: 'true',
          PADDLE_WEBHOOK_SECRET: PADDLE_SECRET,
        },
      );
      await waitForHttpReady(`${API_URL}/health`);
    }

    const webAlreadyRunning = await fetch(WEB_URL)
      .then((r) => r.ok)
      .catch(() => false);

    if (!webAlreadyRunning) {
      startedWebHere = true;
      const npxBin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      webProc = spawnService(
        npxBin,
        ['next', 'start', '-p', '3000'],
        WEB_DIR,
        {
          PORT: '3000',
          NEXT_PUBLIC_API_URL: 'http://localhost:4000',
        },
      );
      await waitForHttpReady(WEB_URL);
    }
  });

  test.afterAll(async () => {
    if (startedWebHere) {
      await stopProcess(webProc);
    }
    if (startedApiHere) {
      await stopProcess(apiProc);
    }
  });

  test('POST /v1/print -> WebSocket dispatch -> mock agent ACK with Idempotency-Key & Paddle gating', async () => {
    const agent = startMockPrinterAgent({
      wsUrl: WS_URL,
      printerId: DEFAULT_PRINTER_ID,
      ackDelayMs: 50,
    });
    await agent.waitForReady();

    try {
      // 1. Pair a new 58mm printer using 6-digit code
      const pairRes = await fetch(`${API_URL}/v1/printers/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairing_code: '654321',
          name: 'E2E Bar 58mm',
          paper_width_mm: 58,
        }),
      });
      expect(pairRes.status).toBe(200);
      const pairedJson = (await pairRes.json()) as { pairing_code: string; paper_width_mm: number };
      expect(pairedJson.pairing_code).toBe('654321');
      expect(pairedJson.paper_width_mm).toBe(58);

      // 2. Dispatch print job with Idempotency-Key -> 202 QUEUED -> WebSocket DISPATCHED -> 50ms -> ACK
      const idempotencyKey = `e2e-idem-${Date.now()}`;
      const printRes = await fetch(`${API_URL}/v1/print`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_API_KEY}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'JSON_RECEIPT',
          payload: {
            title: 'E2E Receipt #101',
            items: [{ name: 'Chai Karak', qty: 2, price: '$6.00' }],
            total: '$6.00',
          },
        }),
      });
      expect(printRes.status).toBe(202);
      const printJson = (await printRes.json()) as { job_id: string; status: string };
      expect(printJson.status).toBe('QUEUED');
      expect(printJson.job_id).toBeTruthy();

      // 3. Idempotent replay returns identical job_id
      const replayRes = await fetch(`${API_URL}/v1/print`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_API_KEY}`,
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'JSON_RECEIPT',
          payload: { title: 'Duplicate' },
        }),
      });
      expect(replayRes.status).toBe(202);
      const replayJson = (await replayRes.json()) as { job_id: string; deduplicated?: boolean };
      expect(replayJson.job_id).toBe(printJson.job_id);
      expect(replayJson.deduplicated).toBe(true);

      // 4. Wait for offline mock agent to receive DISPATCHED and emit ACK
      const ackedJob = await agent.waitForAck(printJson.job_id, 5000);
      expect(ackedJob.job_id).toBe(printJson.job_id);
      expect(ackedJob.payload_type).toBe('JSON_RECEIPT');

      // Poll GET /v1/jobs/:id until persisted ACK state is visible
      let finalStatus = 'QUEUED';
      let ackedAt: string | null = null;
      for (let i = 0; i < 20; i++) {
        const jobRes = await fetch(`${API_URL}/v1/jobs/${printJson.job_id}`);
        expect(jobRes.status).toBe(200);
        const jobJson = (await jobRes.json()) as { status: string; acked_at: string | null };
        finalStatus = jobJson.status;
        ackedAt = jobJson.acked_at;
        if (finalStatus === 'ACK') break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(finalStatus).toBe('ACK');
      expect(ackedAt).toBeTruthy();

      // 5. Paddle webhook gating: PAST_DUE blocks POST /v1/print with 402; ACTIVE Growth restores 202
      const pastDueBody = JSON.stringify({
        event_id: `evt_past_due_${Date.now()}`,
        event_type: 'subscription.past_due',
        data: {
          id: 'sub_e2e_001',
          customer_id: 'ctm_e2e_001',
          status: 'past_due',
        },
      });
      const pastDueWebhook = await fetch(`${API_URL}/v1/webhooks/paddle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'paddle-signature': signPaddleBody(pastDueBody),
        },
        body: pastDueBody,
      });
      expect(pastDueWebhook.status).toBe(200);

      const blockedRes = await fetch(`${API_URL}/v1/print`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${DEFAULT_API_KEY}`,
          'Idempotency-Key': `e2e-blocked-${Date.now()}`,
        },
        body: JSON.stringify({
          printer_id: DEFAULT_PRINTER_ID,
          payload_type: 'RAW_TEXT',
          payload: { text: 'Blocked' },
        }),
      });
      expect(blockedRes.status).toBe(402);

      // Restore ACTIVE + Growth ($99/mo)
      const activeBody = JSON.stringify({
        event_id: `evt_active_${Date.now()}`,
        event_type: 'subscription.activated',
        data: {
          id: 'sub_e2e_001',
          customer_id: 'ctm_e2e_001',
          status: 'active',
          items: [{ price: { id: 'pri_growth_99_monthly', unit_price: { amount: '9900' } } }],
        },
      });
      const activeWebhook = await fetch(`${API_URL}/v1/webhooks/paddle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'paddle-signature': signPaddleBody(activeBody),
        },
        body: activeBody,
      });
      expect(activeWebhook.status).toBe(200);
    } finally {
      await agent.close();
    }
  });

  test('Developer console UI: KPI strip, API key generation, printer pairing, Test Print -> ACK, and /pricing', async ({
    page,
  }) => {
    const agent = startMockPrinterAgent({
      wsUrl: WS_URL,
      printerId: DEFAULT_PRINTER_ID,
      ackDelayMs: 50,
    });
    await agent.waitForReady();

    try {
      await page.goto('/');

      // Verify 3-card KPI strip & jobs table load cleanly
      await expect(page.getByText('Jobs Today')).toBeVisible();
      await expect(page.getByText('Online Printers')).toBeVisible();
      await expect(page.getByText('Avg Latency ms')).toBeVisible();
      await expect(page.getByTestId('jobs-table')).toBeVisible();

      // Generate a fresh SHA-256 backed API key from UI
      await page.getByTestId('generate-api-key-btn').click();
      await page.locator('#api-key-name-input').fill('Playwright E2E Key');
      await page.getByTestId('generate-api-key-submit').click();
      await expect(page.getByTestId('new-api-key-banner')).toBeVisible();

      // Pair a printer from UI
      await page.getByTestId('pair-printer-btn').click();
      await page.locator('#pairing-code-input').fill('778899');
      await page.locator('#printer-name-input').fill('Playwright Counter 80mm');
      await page.getByTestId('pair-printer-submit').click();
      await expect(page.getByText('Playwright Counter 80mm').first()).toBeVisible();

      // Dispatch a test print via UI to the connected mock agent printer
      await page.getByTestId('send-test-print-btn').click();
      await page.locator('#test-print-printer').selectOption(DEFAULT_PRINTER_ID);
      const uiIdemKey = `ui-e2e-${Date.now()}`;
      await page.locator('#test-print-idempotency').fill(uiIdemKey);
      await page.getByTestId('dispatch-print-submit').click();

      // Verify row appears and transitions to ACK after mock agent replies
      await expect(page.getByText(uiIdemKey)).toBeVisible();
      await expect
        .poll(
          async () => {
            await page.getByTestId('refresh-jobs-btn').click();
            const row = page.locator('tr', { hasText: uiIdemKey });
            return await row.innerText();
          },
          { timeout: 10_000, intervals: [400, 600, 1000] },
        )
        .toContain('ACK');

      // Check /pricing page ($29/mo Starter & $99/mo Growth)
      await page.goto('/pricing');
      const starterCard = page.getByTestId('plan-card-starter');
      const growthCard = page.getByTestId('plan-card-growth');
      await expect(starterCard).toBeVisible();
      await expect(starterCard).toContainText('$29');
      await expect(starterCard).toContainText('Starter');
      await expect(growthCard).toBeVisible();
      await expect(growthCard).toContainText('$99');
      await expect(growthCard).toContainText('Growth');
    } finally {
      await agent.close();
    }
  });
});
