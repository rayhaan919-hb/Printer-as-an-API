# AGENTS.md — Printer-as-an-API & Android ESC/POS SDK

## 1. Monorepo Structure
- `/services/api` — TypeScript + Fastify + BullMQ + Redis + WebSocket relay
- `/apps/web` — Next.js (App Router) + Tailwind CSS v4 + shadcn/ui developer console
- `/apps/android-agent` — Kotlin + Foreground Service + Room DB + ESC/POS Rasterizer
- `/tests/e2e` — Playwright + Vitest integration tests

## 2. Sub-Agent Delegation Rules
Spawn 3 parallel sub-agents when building or modifying features:
- **Sub-Agent 1 (`api-agent`):** Owns `/services/api`. Implements REST endpoints, API key hashing (SHA-256), BullMQ job queue, and WebSocket push.
- **Sub-Agent 2 (`web-agent`):** Owns `/apps/web`. Implements developer dashboard, printer pairing UI, live job logs, and API key management.
- **Sub-Agent 3 (`android-agent`):** Owns `/apps/android-agent`. Implements Foreground Service, WebSocket client, Room offline queue, and 1-bit Canvas bitmap ESC/POS rasterizer.

## 3. Mandatory Verification Gates (Zero-Error Policy)
Do NOT mark any task complete until ALL of these pass with exit code 0:
1. `cd services/api && npm run typecheck && npm run lint && npm test`
2. `cd apps/web && npm run typecheck && npm run lint && npm run build`
3. `cd apps/android-agent && ./gradlew testDebugUnitTest`
4. `cd tests/e2e && npx playwright test`
## Model Routing & Escalation Policy (Google AI Pro)
- **Default Mode:** Run this workspace on `Orchestrator (Argon)` (plans/reviews with `Gemini 4 Argon`, executes/tests with `Gemini 4 Hydrogen`).
- **UI & Sub-Agent Execution:** Use `Gemini 4 Hydrogen (High)` for parallel sub-agents, boilerplate, tests, and minimalistic frontend UI components.
- **Prompt User to Switch to `Gemini 4 Hydrogen (Extra / xhigh)` IF:**
  - Any build, typecheck, or test gate fails twice in a row.
  - You are debugging subtle async/WebSocket/race-condition bugs or complex responsive UI layouts.
- **Prompt User to Switch to `Gemini 4 Argon (High)` IF:**
  - You are implementing or modifying high-stakes cryptographic signing, fiscal/VAT compliance rules, double-entry financial ledgers, or database exclusion constraints.
- **Quota Fallback:** If Gemini 5-hour or weekly limits are reached, pause and prompt the user to switch to `Claude Sonnet 5.5 (Thinking)` or `Claude Opus 5.5 (Thinking)`.
