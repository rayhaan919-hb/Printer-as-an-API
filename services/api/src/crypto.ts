import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export interface GeneratedApiKey {
  rawKey: string;
  keyPrefix: string;
  keyHash: string;
}

/**
 * Hashes a raw API key using SHA-256 hex encoding for database storage and lookup.
 */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

/**
 * Generates a new live API key with prefix metadata and its SHA-256 hash.
 */
export function generateApiKey(prefix = 'pk_live_'): GeneratedApiKey {
  const randomSecret = randomBytes(24).toString('hex');
  const rawKey = `${prefix}${randomSecret}`;
  const keyPrefix = rawKey.slice(0, Math.min(rawKey.length, 12));
  const keyHash = hashApiKey(rawKey);
  return { rawKey, keyPrefix, keyHash };
}

/**
 * Generates a random 6-digit numeric pairing code ('000000'-'999999').
 */
export function generatePairingCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * Produces a Paddle Billing v2 webhook signature header: `ts=<unix>;h1=<hex_hmac_sha256>`.
 */
export function signPaddleWebhook(rawBody: string, timestamp: string, secret: string): string {
  const hmac = createHmac('sha256', secret)
    .update(`${timestamp}:${rawBody}`, 'utf8')
    .digest('hex');
  return `ts=${timestamp};h1=${hmac}`;
}

/**
 * Verifies Paddle's `paddle-signature` header (`ts=<unix>;h1=<hex_hmac_sha256>`)
 * using constant-time comparison and replay timestamp tolerance.
 */
export function verifyPaddleWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  toleranceSeconds = 300,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!signatureHeader || !secret) {
    return false;
  }

  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of signatureHeader.split(';')) {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key === 'ts' && /^\d+$/.test(value)) {
      timestamp = value;
    } else if (key === 'h1' && value.length > 0) {
      signatures.push(value);
    }
  }

  if (!timestamp || signatures.length === 0) {
    return false;
  }

  const tsSeconds = Number(timestamp);
  if (!Number.isSafeInteger(tsSeconds)) {
    return false;
  }

  if (toleranceSeconds > 0 && Math.abs(nowSeconds - tsSeconds) > toleranceSeconds) {
    return false;
  }

  const expectedHex = createHmac('sha256', secret)
    .update(`${timestamp}:${rawBody}`, 'utf8')
    .digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  for (const candidate of signatures) {
    if (!/^[0-9a-fA-F]+$/.test(candidate) || candidate.length !== expectedHex.length) {
      continue;
    }
    const actualBuf = Buffer.from(candidate, 'hex');
    if (actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf)) {
      return true;
    }
  }

  return false;
}
