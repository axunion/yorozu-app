# Manual Smoke Test (Local)

A simple checklist for walking the full business cycle by hand across the
SPAs before/after making changes locally. Mirrors the flow already
covered by `apps/api/src/routes/business-cycle.test.ts`, but exercised
through the actual UIs instead of raw API calls.

## Setup

1. Copy `apps/api/.dev.vars.example` to `apps/api/.dev.vars` (gitignored).
   `ENVIRONMENT=development` echoes the passcode in the API response, which
   is what the `[DEV]` notes below display — without it you'd need to read
   the code from the Worker console log instead. `OTP_PEPPER` must be set to
   any non-empty value or passcode issuance fails outright.
2. `pnpm db:reset` — start from a clean local D1.
3. Start the dev servers (separate terminals, or `pnpm dev` to run them
   in parallel):
   - `pnpm dev:api` — Worker API, `http://localhost:8787`
   - `pnpm dev:signup` — `http://localhost:5175`
   - `pnpm dev:admin` — `http://localhost:5173`
   - `pnpm dev:order` — `http://localhost:5174`
   - `pnpm dev:shift` — `http://localhost:5176` (only for the shift
     walkthrough below)

## Walkthrough

1. **Sign up** (`localhost:5175`) — register a store with a name and
   email. On the passcode screen, type the code from the `[DEV]` note
   instead of checking an inbox.
2. **Log in to admin** (`localhost:5173`) — you should already be
   redirected in as the new owner after verifying; if not, use the login
   form, which shows its own `[DEV]` code once you request one.
3. **Menu setup** (admin → Menu) — add at least one category-free menu
   item with a price. Optionally add a description/photo and an option
   group to touch Phase 3 behavior.
4. **Seat/QR issuance** (admin → Seats) — create a seat and open its QR
   / order link.
5. **Customer order** (`localhost:5174`, using the seat link from step 4)
   — browse the menu, add the item to the cart, submit the order.
6. **Order board** (admin → Board) — confirm the new order appears
   (within the 5s poll) with a new-order alert, then mark item(s) served.
7. **Customer requests payment** (order app) — request the bill from the
   customer screen.
8. **Checkout** (admin → Board or the order's detail view) — complete a
   cash payment for the order; confirm it moves to paid/settled.
9. **Sales report** (admin → `/reports`) — confirm the completed order's
   total shows up in today's numbers.

## Shift management (separate product)

Only worth walking when you have touched `apps/shift`, the shift routes, or
`packages/core/src/domain/shift.ts`. It needs a store that has bought the
product, which registration does not grant:

1. **Grant the entitlement** — the store gets `order` at registration but
   not `shift`, so insert one row by hand:

   ```sh
   pnpm --filter @yorozu/api exec wrangler d1 execute yorozu-app-db --local      --command "INSERT INTO subscriptions (id, store_id, product, plan, status, created_at)
                SELECT lower(hex(randomblob(16))), id, 'shift', NULL, 'active',
                       CAST(strftime('%s','now') AS INTEGER) * 1000 FROM stores;"
   ```

   Without it, `localhost:5176` renders the "not enabled" screen — which is
   itself worth seeing once, before you run the insert.
2. **Settings** (`localhost:5176` → 設定) — add a position, a shift pattern,
   and a staffing requirement for the weekday you are about to schedule.
   Give a staff member an hourly wage.
3. **Create a period** — pick any date; the form derives the half-month.
4. **Submit availability** — log in as a staff member (admin → Staff can
   invite one) and fill in the form at `/periods/:id/availability`. Save a
   draft, then submit. Check that reopening it shows what you saved.
5. **Close submissions and build** — back as the owner, close submissions,
   then assign shifts from the pattern buttons. Watch the coverage badges
   move between 不足 / 過剰, and give somebody a 10-hour shift to see the
   labour warning appear without blocking anything.
6. **Publish and read it back** — publish, then log in as the staff member
   again: their own shifts should be listed, and nobody else's.
7. **CSV** — export from the builder and open the file; the Japanese must
   not be mojibake in Excel.

An overnight shift (21:00–25:00) is the case worth eyeballing every time:
it must read `25:00` in both apps, never `01:00`.

## What to watch for

This is a manual check, not a substitute for automated tests — use it to
catch what tests don't: layout/UI regressions, console errors/warnings in
the browser devtools, and the 5s polling actually reflecting cross-app
state changes (order board picking up the customer's order, customer
screen picking up served status).

## Resetting between runs

`pnpm db:reset` wipes local D1 and re-applies migrations, so you can
repeat the walkthrough from a clean slate.
