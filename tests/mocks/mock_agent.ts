export interface DispatchedJobMessage {
  type?: string;
  job_id: string;
  printer_id: string;
  payload_type: 'JSON_RECEIPT' | 'RAW_TEXT' | 'HTML';
  payload: Record<string, unknown>;
  status?: string;
  created_at?: string;
}

export interface MockAgentOptions {
  wsUrl?: string;
  printerId?: string;
  ackDelayMs?: number;
}

export interface MockAgentHandle {
  printerId: string;
  receivedJobs: DispatchedJobMessage[];
  ackedJobIds: string[];
  waitForReady: () => Promise<void>;
  waitForAck: (jobId: string, timeoutMs?: number) => Promise<DispatchedJobMessage>;
  close: () => Promise<void>;
}

/**
 * Offline Android Agent WebSocket Mock (`tests/mocks/mock_agent.ts`)
 * Connects with a test `printer_id`, receives `DISPATCHED` jobs, waits 50ms, and emits `ACK`.
 */
export function startMockPrinterAgent(options: MockAgentOptions = {}): MockAgentHandle {
  const printerId =
    options.printerId ?? process.env.MOCK_PRINTER_ID ?? '00000000-0000-4000-8000-000000000101';
  const baseWsUrl = options.wsUrl ?? process.env.WS_URL ?? 'ws://127.0.0.1:4000/ws';
  const ackDelayMs = options.ackDelayMs ?? 50;

  const separator = baseWsUrl.includes('?') ? '&' : '?';
  const fullUrl = `${baseWsUrl}${separator}printer_id=${encodeURIComponent(printerId)}`;

  const receivedJobs: DispatchedJobMessage[] = [];
  const ackedJobIds: string[] = [];
  const ackListeners = new Map<string, (job: DispatchedJobMessage) => void>();

  const ws = new globalThis.WebSocket(fullUrl);

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Mock agent WebSocket connection timed out: ${fullUrl}`));
    }, 5000);

    ws.addEventListener('open', () => {
      clearTimeout(timer);
      ws.send(JSON.stringify({ type: 'REGISTER', printer_id: printerId }));
      resolve();
    }, { once: true });

    ws.addEventListener('error', (event: Event) => {
      clearTimeout(timer);
      reject(new Error(`Mock agent WebSocket error (${event.type}): ${fullUrl}`));
    }, { once: true });
  });

  ws.addEventListener('message', (event: MessageEvent) => {
    try {
      const text = typeof event.data === 'string' ? event.data : String(event.data);
      const parsed = JSON.parse(text) as Partial<DispatchedJobMessage>;
      if (
        (parsed.type === 'DISPATCHED' ||
          parsed.type === 'PRINT_JOB' ||
          parsed.status === 'DISPATCHED') &&
        typeof parsed.job_id === 'string'
      ) {
        const job: DispatchedJobMessage = {
          type: 'DISPATCHED',
          job_id: parsed.job_id,
          printer_id: parsed.printer_id ?? printerId,
          payload_type: parsed.payload_type ?? 'JSON_RECEIPT',
          payload: (parsed.payload as Record<string, unknown>) ?? {},
          status: 'DISPATCHED',
          created_at: parsed.created_at,
        };
        receivedJobs.push(job);

        setTimeout(() => {
          if (ws.readyState === globalThis.WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'ACK',
                status: 'ACK',
                job_id: job.job_id,
                printer_id: printerId,
                acked_at: new Date().toISOString(),
              }),
            );
            ackedJobIds.push(job.job_id);
            const listener = ackListeners.get(job.job_id);
            if (listener) {
              ackListeners.delete(job.job_id);
              listener(job);
            }
          }
        }, ackDelayMs);
      }
    } catch {
      // Ignore non-JSON frames
    }
  });

  return {
    printerId,
    receivedJobs,
    ackedJobIds,
    waitForReady: () => readyPromise,
    waitForAck: (jobId: string, timeoutMs = 5000) =>
      new Promise<DispatchedJobMessage>((resolve, reject) => {
        const existing = receivedJobs.find((j) => j.job_id === jobId);
        if (existing && ackedJobIds.includes(jobId)) {
          resolve(existing);
          return;
        }
        const timer = setTimeout(() => {
          ackListeners.delete(jobId);
          reject(new Error(`Timed out waiting for mock agent ACK on job ${jobId}`));
        }, timeoutMs);

        ackListeners.set(jobId, (job) => {
          clearTimeout(timer);
          resolve(job);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (ws.readyState === globalThis.WebSocket.CLOSED) {
          resolve();
          return;
        }
        ws.addEventListener('close', () => resolve(), { once: true });
        ws.close();
      }),
  };
}

// Allow standalone CLI execution: `npx tsx tests/mocks/mock_agent.ts`
const invokedScript = typeof process !== 'undefined' ? process.argv[1]?.replace(/\\/g, '/') ?? '' : '';
if (invokedScript.endsWith('tests/mocks/mock_agent.ts') || invokedScript.endsWith('tests/mocks/mock_agent.js')) {
  const agent = startMockPrinterAgent();
  agent
    .waitForReady()
    .then(() => {
      console.log(`[mock_agent] Connected for printer_id=${agent.printerId}`);
    })
    .catch((err: unknown) => {
      console.error('[mock_agent] Connection failed:', err);
      process.exitCode = 1;
    });
}
