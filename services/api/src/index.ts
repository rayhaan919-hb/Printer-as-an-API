import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

function loadEnvFileIfPresent(filePath: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  loadEnvFileIfPresent(resolve(here, '../../../.env'));
  loadEnvFileIfPresent(resolve(here, '../.env'));

  const port = Number(process.env.PORT ?? '4000');
  const host = process.env.HOST ?? '0.0.0.0';

  const { app, store, queue, close } = await buildApp({
    logger: process.env.LOG_LEVEL === 'debug' || process.env.NODE_ENV !== 'test',
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[api] Received ${signal}, shutting down cleanly...`);
    await close();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await app.listen({
    port: Number.isFinite(port) ? port : 4000,
    host,
  });

  console.log(
    `[api] Listening on http://${host}:${Number.isFinite(port) ? port : 4000} (db=${store.kind}, queue=${queue.mode})`,
  );
}

main().catch((err: unknown) => {
  console.error('[api] Fatal startup error:', err);
  process.exit(1);
});
