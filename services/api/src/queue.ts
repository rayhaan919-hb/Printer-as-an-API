import { Queue, Worker, type ConnectionOptions, type Job } from 'bullmq';
import { Redis } from 'ioredis';

export interface PrintJobQueuePayload {
  jobId: string;
  orgId: string;
  printerId: string;
}

export type PrintJobProcessor = (payload: PrintJobQueuePayload) => Promise<void>;

export interface PrintJobQueue {
  readonly mode: 'bullmq' | 'memory';
  enqueue(payload: PrintJobQueuePayload): Promise<void>;
  close(): Promise<void>;
}

const PRINT_QUEUE_NAME = 'print-jobs';

function parseRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const parsedPort = url.port ? Number(url.port) : 6379;
  const dbText = url.pathname.replace(/^\//, '');
  const parsedDb = dbText ? Number(dbText) : 0;

  return {
    host: url.hostname || '127.0.0.1',
    port: Number.isFinite(parsedPort) ? parsedPort : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isFinite(parsedDb) ? parsedDb : 0,
    maxRetriesPerRequest: null,
    ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

/**
 * In-memory asynchronous print job queue using immediate event-loop scheduling.
 */
export class InMemoryPrintJobQueue implements PrintJobQueue {
  readonly mode = 'memory' as const;
  private readonly processor: PrintJobProcessor;
  private readonly pendingTimers = new Set<NodeJS.Immediate>();
  private readonly inFlight = new Set<Promise<void>>();
  private closed = false;

  constructor(processor: PrintJobProcessor) {
    this.processor = processor;
  }

  async enqueue(payload: PrintJobQueuePayload): Promise<void> {
    if (this.closed) {
      return;
    }

    const immediate = setImmediate(() => {
      this.pendingTimers.delete(immediate);
      if (this.closed) {
        return;
      }
      const task = this.processor(payload)
        .catch(() => {
          // Dispatch errors are recorded/handled inside processor without crashing event loop.
        })
        .finally(() => {
          this.inFlight.delete(task);
        });
      this.inFlight.add(task);
    });

    this.pendingTimers.add(immediate);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const timer of this.pendingTimers) {
      clearImmediate(timer);
    }
    this.pendingTimers.clear();
    if (this.inFlight.size > 0) {
      await Promise.allSettled(Array.from(this.inFlight));
    }
  }
}

/**
 * BullMQ + Redis print job queue and worker for durable distributed dispatch.
 */
export class BullMqPrintJobQueue implements PrintJobQueue {
  readonly mode = 'bullmq' as const;
  private readonly queue: Queue<PrintJobQueuePayload>;
  private readonly worker: Worker<PrintJobQueuePayload>;

  constructor(redisUrl: string, processor: PrintJobProcessor) {
    const connection = parseRedisConnection(redisUrl);
    this.queue = new Queue<PrintJobQueuePayload>(PRINT_QUEUE_NAME, { connection });
    this.worker = new Worker<PrintJobQueuePayload>(
      PRINT_QUEUE_NAME,
      async (job: Job<PrintJobQueuePayload>) => {
        await processor(job.data);
      },
      { connection, concurrency: 10 },
    );

    this.queue.on('error', () => {
      // Suppress uncaught connection error events; health checks/retries handle recovery.
    });
    this.worker.on('error', () => {
      // Suppress uncaught worker error events.
    });
  }

  async enqueue(payload: PrintJobQueuePayload): Promise<void> {
    await this.queue.add('dispatch-print-job', payload, {
      jobId: payload.jobId,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  async close(): Promise<void> {
    await this.worker.close();
    await this.queue.close();
  }
}

export interface CreatePrintJobQueueOptions {
  redisUrl?: string;
  mockMode?: boolean;
  strictInfra?: boolean;
}

/**
 * Creates a `BullMqPrintJobQueue` when Redis is configured and reachable,
 * otherwise falls back to `InMemoryPrintJobQueue`.
 */
export async function createPrintJobQueue(
  processor: PrintJobProcessor,
  options: CreatePrintJobQueueOptions = {},
): Promise<PrintJobQueue> {
  const mockMode = options.mockMode ?? process.env.MOCK_PRINTER_MODE === 'true';
  const redisUrl = options.redisUrl ?? process.env.REDIS_URL;

  if (mockMode || !redisUrl) {
    return new InMemoryPrintJobQueue(processor);
  }

  const probe = new Redis(redisUrl, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  probe.on('error', () => {
    // Prevent unhandled error event during probe failure.
  });

  try {
    await probe.connect();
    await probe.ping();
    await probe.quit();
    return new BullMqPrintJobQueue(redisUrl, processor);
  } catch (err) {
    probe.disconnect();
    if (options.strictInfra) {
      throw err;
    }
    return new InMemoryPrintJobQueue(processor);
  }
}
