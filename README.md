# PrintRelay — Printer-as-an-API & Android ESC/POS SDK

**PrintRelay** is a multi-tenant thermal receipt and kitchen ticket orchestration platform ("Printer-as-an-API"). Cloud apps submit print jobs over a single REST API (`POST /v1/print`), and PrintRelay queues, relays over WebSockets, and rasterizes jobs into deterministic 1-bit ESC/POS (`GS v 0`) bitmaps printed over Bluetooth RFCOMM by an Android Print Agent.

---

## Architecture Overview

```text
Your App / POS
   │  POST /v1/print  (Bearer pk_live_... + Idempotency-Key)
   ▼
Fastify REST API (/services/api)
   ├─ SHA-256 API key verification & active Paddle subscription gate
   ├─ Idempotency deduplication (PostgreSQL UNIQUE (org_id, idempotency_key))
   └─ Enqueue job -> BullMQ / Redis
                         │
                         ▼
               WebSocket Relay (/ws, /v1/ws)
                         │  DISPATCHED
                         ▼
      Android Print Agent (/apps/android-agent)
         ├─ PrintAgentForegroundService (persistent connectedDevice relay)
         ├─ OfflineJobQueue (local SQLite / Room-style retry persistence)
         ├─ EscPosRasterizer (1-bit GS v 0 bitmap, 58mm/80mm + RTL Urdu/Arabic Bidi)
         └─ EscPosTransport (BluetoothTransport RFCOMM SPP / InMemoryByteSinkTransport)
                         │
                         ▼  ACK / FAILED
               Status updated & streamed to Web Console (/apps/web)
```

In local development and automated tests (`MOCK_PRINTER_MODE=true` or when `DATABASE_URL` / `REDIS_URL` are unavailable without `strictInfra`), `services/api` automatically falls back to `InMemoryDataStore` and `InMemoryPrintJobQueue` so you can run the API, web console, and Playwright suite without provisioning Postgres or Redis first.

---

## Monorepo Structure

| Path | Stack | Purpose |
| :--- | :--- | :--- |
| [`services/api`](services/api) | TypeScript, Fastify 5, BullMQ, PostgreSQL (`pg`), `ws` | REST API, SHA-256 API key auth, Paddle webhook billing gate, job queue, and WebSocket printer relay |
| [`apps/web`](apps/web) | Next.js 15 (App Router), React 19, Tailwind CSS v4 | Linear-style developer console (`/`) and Starter/Growth plan management (`/pricing`) |
| [`apps/android-agent`](apps/android-agent) | Kotlin, Jetpack Compose Material 3, Android Foreground Service | Persistent WebSocket agent, offline job queue, Bluetooth RFCOMM transport, and 1-bit `GS v 0` ESC/POS bitmap rasterizer |
| [`tests/mocks`](tests/mocks) | TypeScript (`ws`) | Offline Node mock printer agent (`mock_agent.ts`) that connects over WebSocket and sends `ACK` |
| [`tests/e2e`](tests/e2e) | Playwright, TypeScript | End-to-end tests covering `POST /v1/print` -> WebSocket dispatch -> `ACK` and UI flows (`printer_flow.spec.ts`) |

### Root Specification & Contract Files
- [`AGENTS.md`](AGENTS.md) — Monorepo ownership boundaries, verification commands, and agent workflow rules.
- [`DESIGN.md`](DESIGN.md) — Strict UI design tokens and layout spec for `/apps/web`.
- [`api-contract.yaml`](api-contract.yaml) — OpenAPI 3.1.0 contract for `/v1/print` and `/v1/printers/pair`.
- [`schema.sql`](schema.sql) — PostgreSQL schema (`organizations`, `billing_events`, `api_keys`, `printers`, `print_jobs`).
- [`.env.example`](.env.example) — Reference environment variables for API, PostgreSQL, Redis, Paddle, and Web URLs.
- [`tests/mocks.md`](tests/mocks.md) — Offline mocking strategy for WebSocket agent and Bluetooth hardware transport.

---

## Key Features

- **Idempotent Print API (`POST /v1/print`):** Requires an `Idempotency-Key` header and prevents duplicate receipt prints per organization (`UNIQUE (org_id, idempotency_key)`). Supports `JSON_RECEIPT`, `RAW_TEXT`, and `HTML` payloads.
- **Zero-Plaintext API Keys:** API keys (`pk_live_...`) are hashed with SHA-256 before storage (`api_keys.key_hash`) and accepted via `Authorization: Bearer <key>` or `x-api-key`.
- **6-Digit Printer Pairing:** Generate pairing codes via `POST /v1/printers/pairing-code` and bind Android devices via `POST /v1/printers/pair` with `58` mm or `80` mm paper widths.
- **Hardware-Independent 1-Bit `GS v 0` Rasterizer:** Renders UTF-8 text, structured receipts, and HTML to 1-bit packed monochrome ESC/POS rasters (`384 px` / `48 bytes` for 58mm; `576 px` / `72 bytes` for 80mm) with RTL layout detection (`java.text.Bidi`) for Urdu and Arabic scripts.
- **Testable Transport & Queue Abstractions:** `EscPosTransport` separates physical Bluetooth SPP (`BluetoothTransport`) from `InMemoryByteSinkTransport`, and `PrintJobDao` provides `InMemoryPrintJobDao` alongside Android SQLite persistence so unit tests verify exact ESC/POS byte headers without physical printer hardware.
- **Paddle Subscription Gating:** Enforces active billing status (`Starter` `$29/mo` or `Growth` `$99/mo`) on `/v1/print`, verified via HMAC-SHA256 webhooks on `POST /v1/webhooks/paddle` and deduplicated in `billing_events`.

---

## API Endpoints

| Method & Path | Description |
| :--- | :--- |
| `GET /health` | Health check |
| `WS /ws`, `WS /v1/ws` | Android Print Agent / mock WebSocket relay (`printer_id` binding, `DISPATCHED` -> `ACK` / `FAILED`) |
| `POST /v1/print` | Enqueue a thermal print job (requires API key, active subscription, `Idempotency-Key`) |
| `GET /v1/printers` | List paired/registered printers |
| `POST /v1/printers/pairing-code` | Reserve a 6-digit pairing code |
| `POST /v1/printers/pair` | Pair an Android Print Agent using a 6-digit code and `paper_width_mm` (`58` or `80`) |
| `GET /v1/jobs`, `GET /v1/jobs/:id` | List print jobs or fetch status for a single job |
| `GET /v1/api-keys`, `POST /v1/api-keys`, `DELETE /v1/api-keys/:id` | List, create, and revoke API keys |
| `GET /v1/billing`, `POST /v1/billing/checkout` | Inspect workspace subscription tier and create checkout session |
| `POST /v1/webhooks/paddle` | HMAC-SHA256 signed Paddle webhook receiver |

---

## Quick Start (Local Development)

### 1. Environment Variables
Copy `.env.example` to `.env` if you want to customize database, Redis, or Paddle settings:

```bash
cp .env.example .env
```

For quick local runs without PostgreSQL or Redis, set `MOCK_PRINTER_MODE=true` (also enabled by default in `.env.example`). To run with PostgreSQL, apply [`schema.sql`](schema.sql) to your database and set `DATABASE_URL` and `REDIS_URL`.

### 2. Start the API Server (`http://localhost:4000`)

```bash
cd services/api
npm install
MOCK_PRINTER_MODE=true npm start
```

### 3. Start the Developer Console (`http://localhost:3000`)

```bash
cd apps/web
npm install
npm run dev
```

Open `http://localhost:3000` for the developer console and `http://localhost:3000/pricing` for plan comparison.

### 4. Send a Test Print Job (Seeded Dev Workspace)
When running in `InMemoryDataStore` / `MOCK_PRINTER_MODE=true` dev mode, a seeded workspace, printer (`00000000-0000-4000-8000-000000000101`), and dev API key (`pk_live_default_test_key_0123456789abcdef`) are available:

```bash
curl -X POST http://localhost:4000/v1/print \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer pk_live_default_test_key_0123456789abcdef" \
  -H "Idempotency-Key: demo-order-001" \
  -d '{
    "printer_id": "00000000-0000-4000-8000-000000000101",
    "payload_type": "JSON_RECEIPT",
    "payload": {
      "title": "PrintRelay Cafe",
      "items": [{ "name": "Espresso", "qty": 1, "price": "$4.50" }],
      "total": "$4.50"
    }
  }'
```

---

## Verification & Tests

Run each package verification gate from the repository root:

```bash
# 1. API typecheck, lint, and unit/integration tests (Vitest)
cd services/api && npm run typecheck && npm run lint && npm test

# 2. Web console typecheck, lint, and production build
cd apps/web && npm run typecheck && npm run lint && npm run build

# 3. Android SDK & ESC/POS unit tests (macOS/Linux; use .\gradlew.bat on Windows)
cd apps/android-agent && ./gradlew testDebugUnitTest

# 4. Playwright end-to-end tests with mock WebSocket printer agent
cd tests/e2e && npm run typecheck && npx playwright test
```
