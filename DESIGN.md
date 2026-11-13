# Modern Minimalistic UI & Design Tokens (`DESIGN.md`)

## Core Aesthetic Rules (Strict)
1. **No AI Clutter:** Avoid rainbow gradients, heavy drop shadows, or unnecessary glassmorphism. Use flat tonal surfaces with crisp `1px` borders (`#E2E8F0` light / `#27272A` dark).
2. **Typography:** `Inter` (UI) + `JetBrains Mono` (IDs, timestamps, currency, API keys). Use `tabular-nums` on all numbers.
3. **Spacing Scale:** Strictly use `4px`, `8px`, `12px`, `16px`, `24px`, `32px`. Max container width: `1200px`.
4. **States:** Every data-fetching view MUST implement:
   - Skeleton loader (matching exact layout dimensions)
   - Actionable empty state (icon + 1-line explanation + primary CTA button)
   - Inline error banner with a "Retry" button

## Brand & Color Tokens (Developer Console — Linear Style)
- `--bg-canvas`: `#FAFAFA` (light) / `#09090B` (dark)
- `--bg-surface`: `#FFFFFF` (light) / `#18181B` (dark)
- `--accent-primary`: `#2563EB` (Cobalt)
- `--status-online`: `#10B981` (Emerald)
- `--status-offline`: `#EF4444` (Rose)
- **Layout:** Left sidebar (`240px` fixed) with Printers, Print Jobs, API Keys, Billing. Main canvas uses a 3-card KPI strip (`Jobs Today`, `Online Printers`, `Avg Latency ms`) above a live filterable data table.
