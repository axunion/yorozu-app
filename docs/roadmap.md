# Roadmap

What is not built yet: a demand-driven backlog and the engineering track.
Shipped behavior is documented in `specs/` (source of truth, kept current);
how and when each item was built lives in git history.

## Backlog (demand-driven)

Revisit only on a concrete demand signal from a real store. Nothing below is
designed in detail — when one is picked up, decide the design with the user
first and put the outcome in `specs/`. Earlier design sketches for items 1–3
are in git history (`git log --diff-filter=D -- docs/proposals`).

1. **Split billing** — more than one settled payment per order, split by
   amount only (not by items). Needs a constraint-backed remainder check
   (D1 has no row locks) and a decision on what voiding one settlement
   means for the order.
2. **Real-time push** — replace the polling with SSE/Durable Objects
   only if pilot feedback shows latency or request cost hurting; polling
   stays as the fallback.
3. **Platform admin** — a minimal internal view of stores/health once
   store count makes SQL-by-hand impractical. How it authenticates is open.
4. **Shift management v2** — post-publish changes: absence reporting,
   staff-to-staff swap with manager approval, and an open-shift board.
   Two more state machines and a notification channel; revisit once a
   store has run a published schedule for a few periods. Shipped v1
   behavior and its deliberate gaps:
   [shift-management](specs/features/shift-management.md).

## Engineering track

- **Production deployment** — the runbook is
  [reference/deploy.md](reference/deploy.md); the WAF per-IP rate-limit
  config is still a required manual step before public exposure.
- **CI deploy** — manual `wrangler deploy` is fine until the pilot;
  automate on `main` once deploys become routine.
- **Browser E2E in CI** — the suite is shipped as `apps/e2e`
  (`pnpm e2e`, [reference/browser-e2e.md](reference/browser-e2e.md));
  wiring it into CI is the remaining step, once it has a track record.
- **Observability** — Workers analytics/log tail is enough now; add
  error alerting before the pilot goes unattended.
- **Backups** — document the D1 time-travel/export procedure before
  real sales data exists (i.e., before the pilot).

## Explicitly not planned (non-goals)

See [product-overview.md](specs/product-overview.md): POS hardware,
reservations, inventory, multi-location, native apps, takeout/delivery.
Revisit only with concrete user demand.
