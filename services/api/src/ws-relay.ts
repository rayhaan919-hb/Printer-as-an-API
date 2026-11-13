import type { FastifyRequest } from 'fastify';
import type WebSocket from 'ws';
import type { DataStore } from './store.js';
import type { DispatchedJobFrame, PrintJob } from './types.js';

const WS_OPEN = 1;

function rawDataToString(data: Buffer | ArrayBuffer | Buffer[] | string): string {
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

function extractPrinterIdFromRequest(request: FastifyRequest): string | null {
  const query = request.query as Record<string, unknown> | undefined;
  if (query && typeof query.printer_id === 'string' && query.printer_id.trim().length > 0) {
    return query.printer_id.trim();
  }
  try {
    const url = new URL(request.url, 'http://localhost');
    const param = url.searchParams.get('printer_id');
    return param && param.trim().length > 0 ? param.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Manages live WebSocket connections for Android Print Agents and dispatches print jobs.
 */
export class WsRelay {
  private readonly store: DataStore;
  private readonly socketsByPrinter = new Map<string, Set<WebSocket>>();
  private readonly socketToPrinterId = new Map<WebSocket, string>();
  private readonly dispatchingJobs = new Set<string>();
  private closed = false;

  constructor(store: DataStore) {
    this.store = store;
  }

  isPrinterOnline(printerId: string): boolean {
    const sockets = this.socketsByPrinter.get(printerId);
    if (!sockets) {
      return false;
    }
    for (const sock of sockets) {
      if (sock.readyState === WS_OPEN) {
        return true;
      }
    }
    return false;
  }

  getConnectedPrinterIds(): string[] {
    const ids: string[] = [];
    for (const printerId of this.socketsByPrinter.keys()) {
      if (this.isPrinterOnline(printerId)) {
        ids.push(printerId);
      }
    }
    return ids;
  }

  handleConnection(socket: WebSocket, request: FastifyRequest): void {
    if (this.closed) {
      socket.close(1001, 'Server shutting down');
      return;
    }

    const queryPrinterId = extractPrinterIdFromRequest(request);
    if (queryPrinterId) {
      this.attachSocketSync(socket, queryPrinterId);
    }

    socket.on('message', (rawData) => {
      void this.handleMessage(socket, rawData);
    });

    socket.on('close', () => {
      void this.detachSocket(socket);
    });

    socket.on('error', () => {
      void this.detachSocket(socket);
    });

    if (queryPrinterId) {
      void this.onSocketBound(socket, queryPrinterId);
    }
  }

  async dispatchJobById(jobId: string): Promise<boolean> {
    if (this.closed) {
      return false;
    }
    const job = await this.store.getPrintJob(jobId);
    if (!job || job.status !== 'QUEUED') {
      return false;
    }
    return this.dispatchJob(job);
  }

  async dispatchJob(job: PrintJob): Promise<boolean> {
    if (this.closed || job.status !== 'QUEUED') {
      return false;
    }
    if (this.dispatchingJobs.has(job.id)) {
      return false;
    }

    this.dispatchingJobs.add(job.id);
    try {
      const latestJob = await this.store.getPrintJob(job.id);
      if (!latestJob || latestJob.status !== 'QUEUED') {
        return false;
      }

      const sockets = this.socketsByPrinter.get(latestJob.printer_id);
      if (!sockets || sockets.size === 0) {
        return false;
      }

      const openSockets = Array.from(sockets).filter((s) => s.readyState === WS_OPEN);
      if (openSockets.length === 0) {
        return false;
      }

      // Transition DB status before pushing over socket so instant ACKs never race DISPATCHED.
      await this.store.updatePrintJobStatus(latestJob.id, 'DISPATCHED');

      const frame: DispatchedJobFrame = {
        type: 'DISPATCHED',
        job_id: latestJob.id,
        printer_id: latestJob.printer_id,
        payload_type: latestJob.payload_type,
        payload: latestJob.payload,
        status: 'DISPATCHED',
        created_at: latestJob.created_at,
      };
      const payloadText = JSON.stringify(frame);

      for (let i = openSockets.length - 1; i >= 0; i--) {
        const target = openSockets[i];
        try {
          target.send(payloadText);
          return true;
        } catch {
          // Try next open socket if this one closed right before send.
        }
      }

      return false;
    } finally {
      this.dispatchingJobs.delete(job.id);
    }
  }

  async flushQueuedJobs(printerId: string): Promise<void> {
    if (this.closed || !this.isPrinterOnline(printerId)) {
      return;
    }
    const queuedJobs = await this.store.listQueuedJobsForPrinter(printerId);
    for (const job of queuedJobs) {
      if (this.closed || !this.isPrinterOnline(printerId)) {
        break;
      }
      await this.dispatchJob(job);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const allSockets = Array.from(this.socketToPrinterId.keys());
    this.socketToPrinterId.clear();
    this.socketsByPrinter.clear();

    for (const socket of allSockets) {
      try {
        if (socket.readyState === WS_OPEN) {
          socket.close(1001, 'Server shutting down');
        }
      } catch {
        // Ignore close errors during shutdown.
      }
    }
  }

  private attachSocketSync(socket: WebSocket, printerId: string): void {
    const previousPrinterId = this.socketToPrinterId.get(socket);
    if (previousPrinterId && previousPrinterId !== printerId) {
      const prevSet = this.socketsByPrinter.get(previousPrinterId);
      if (prevSet) {
        prevSet.delete(socket);
        if (prevSet.size === 0) {
          this.socketsByPrinter.delete(previousPrinterId);
        }
      }
    }

    let set = this.socketsByPrinter.get(printerId);
    if (!set) {
      set = new Set<WebSocket>();
      this.socketsByPrinter.set(printerId, set);
    }
    set.add(socket);
    this.socketToPrinterId.set(socket, printerId);
  }

  private async onSocketBound(socket: WebSocket, printerId: string): Promise<void> {
    if (this.closed || socket.readyState !== WS_OPEN) {
      return;
    }
    await this.store.setPrinterOnline(printerId, true).catch(() => null);
    if (this.closed || socket.readyState !== WS_OPEN) {
      return;
    }
    await this.flushQueuedJobs(printerId).catch(() => undefined);
  }

  private async detachSocket(socket: WebSocket): Promise<void> {
    const printerId = this.socketToPrinterId.get(socket);
    if (!printerId) {
      return;
    }
    this.socketToPrinterId.delete(socket);

    const set = this.socketsByPrinter.get(printerId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) {
        this.socketsByPrinter.delete(printerId);
      }
    }

    if (!this.closed && !this.isPrinterOnline(printerId)) {
      await this.store.setPrinterOnline(printerId, false).catch(() => null);
    }
  }

  private async handleMessage(
    socket: WebSocket,
    rawData: Buffer | ArrayBuffer | Buffer[] | string,
  ): Promise<void> {
    if (this.closed) {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawDataToString(rawData));
    } catch {
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return;
    }

    const frame = parsed as Record<string, unknown>;
    const frameType = typeof frame.type === 'string' ? frame.type.toUpperCase() : '';
    const frameStatus = typeof frame.status === 'string' ? frame.status.toUpperCase() : '';

    if (frameType === 'REGISTER') {
      const printerId = typeof frame.printer_id === 'string' ? frame.printer_id.trim() : '';
      if (!printerId) {
        return;
      }
      const alreadyBound = this.socketToPrinterId.get(socket) === printerId;
      this.attachSocketSync(socket, printerId);
      if (!alreadyBound) {
        await this.onSocketBound(socket, printerId);
      } else {
        await this.store.setPrinterOnline(printerId, true).catch(() => null);
      }
      if (socket.readyState === WS_OPEN) {
        try {
          socket.send(JSON.stringify({ type: 'REGISTERED', printer_id: printerId }));
        } catch {
          // Ignore send errors on closing socket.
        }
      }
      return;
    }

    if (frameType === 'PING' || frameType === 'HEARTBEAT') {
      const boundPrinterId = this.socketToPrinterId.get(socket);
      if (boundPrinterId) {
        await this.store.setPrinterOnline(boundPrinterId, true).catch(() => null);
      }
      if (socket.readyState === WS_OPEN) {
        try {
          socket.send(JSON.stringify({ type: 'PONG', timestamp: new Date().toISOString() }));
        } catch {
          // Ignore send errors on closing socket.
        }
      }
      return;
    }

    const jobId = typeof frame.job_id === 'string' ? frame.job_id.trim() : '';
    if (!jobId) {
      return;
    }

    if (frameType === 'PRINTING' || frameStatus === 'PRINTING') {
      await this.store.updatePrintJobStatus(jobId, 'PRINTING');
      return;
    }

    if (frameType === 'ACK' || frameStatus === 'ACK') {
      const ackedAt =
        typeof frame.acked_at === 'string' ? frame.acked_at : new Date().toISOString();
      await this.store.updatePrintJobStatus(jobId, 'ACK', { ackedAt });
      const boundPrinterId = this.socketToPrinterId.get(socket);
      if (boundPrinterId) {
        await this.store.setPrinterOnline(boundPrinterId, true).catch(() => null);
      }
      return;
    }

    if (frameType === 'FAILED' || frameStatus === 'FAILED') {
      const errorMessage =
        typeof frame.error_message === 'string' && frame.error_message.trim().length > 0
          ? frame.error_message.trim()
          : 'Print agent reported failure';
      await this.store.updatePrintJobStatus(jobId, 'FAILED', { errorMessage });
    }
  }
}
