# Browser E2E (Playwright)

Automates the golden path from
[manual-smoke-test.md](./manual-smoke-test.md) through the SPAs in a real
browser. Lives in `apps/e2e`.

`apps/api/src/routes/business-cycle.test.ts` already covers the same cycle at
the API level, so this suite exists for what sits between those endpoints and
the user: client-side routing, forms that don't submit, and the cross-app
polling that carries one app's write into another app's screen.

## Running it

```sh
cp apps/api/.dev.vars.example apps/api/.dev.vars   # once; ENVIRONMENT=development
pnpm exec playwright install chromium              # once
pnpm e2e
```

Playwright starts all five processes itself (API Worker + the four Vite dev
servers) and waits on their ports. `reuseExistingServer` is on, so a `pnpm dev`
you already have running is reused instead of conflicting.

`ENVIRONMENT=development` is required: it makes the API echo the passcode as
`code` in the registration response, which the signup screen renders as the
`[DEV]` note the run reads and types in. Without it there is no way to verify
the store without an inbox. See
[auth.md](./auth.md#local-dev-skipping-email-delivery).

Other entry points: `pnpm --filter @yorozu/e2e e2e:ui` for the Playwright UI,
and `pnpm exec playwright show-trace <path>` for a failed run's trace (traces
and screenshots are retained on failure only).

## No database reset

Unlike the manual checklist, the suite does **not** need `pnpm db:reset`. Each
spec registers its own store with a unique email, and store scoping keeps it
from seeing any other store's menu, seats, orders or sales. Runs are therefore
repeatable against a dirty local D1, and the suite never destroys local data.

## What the specs assert

### `tests/business-cycle.spec.ts`

One spec covering the full cycle — matching `business-cycle.test.ts`'s own
scope choice — with `test.step` names doing the work of localizing a failure
to a stage:

1. Register a store, verify by typing in the `[DEV]` passcode.
2. Land in admin as the owner (proves the session cookie the API set on the
   verify response is sent back on the admin origin).
3. Menu setup: one category, one categorized item, one uncategorized item.
4. Seat creation, QR render, and the order link it issues.
5. Staff open the order board — asserted still empty.
6. Customer orders both items from the seat link; totals reconcile.
7. The order appears on the board and both items are marked served.
8. The customer screen picks up the served status.
9. Staff open the register — asserted still empty.
10. The customer requests the bill.
11. The slip appears on the register and is paid in cash.
12. The customer sees the paid confirmation and receipt link.
13. The sale appears in the item ranking report.

### `tests/staff-call.spec.ts`

The staff-call round trip, kept separate because it is an independent polling
channel that the order/payment cycle never touches: customer presses
「スタッフを呼ぶ」, the call reaches the order board, staff clear it, and the
customer's screen stops showing 「呼んでいます」. Needs only a store and a
seat — a call is raised against the seat, not against an order.

### `tests/shift-login.spec.ts`

Passcode login on the shift origin, which neither cycle spec reaches: they
only ever see the code screen through signup, so `apps/shift`'s own login had
no browser coverage and its unit tests mock `fetch`.

The login runs in a **fresh browser context**, because cookies ignore ports —
the session the registration step sets on `localhost` would otherwise be sent
to :5176 too, and the spec would pass with the passcode doing nothing.

It ends on 「シフト管理は未契約です」, which is the success condition rather than
a failure: registration subscribes a new store to `order` only, so `ShiftGuard`
takes a 403 from `/api/shift/periods`. That screen renders inside
`<Show when={store()}>`, reached only once `/api/auth/me` has returned a store,
so it appears if and only if the passcode established a session on this origin.
The entitled shift screens behind it are out of scope here, as they are for the
suite generally — see *Not in scope*.

### Why the ordering matters

The two cycle specs keep two pages open on one browser context and open each
screen
*before* the other side writes the state it should pick up. That ordering is
load-bearing: navigating to a screen after the write would satisfy the same
assertion from the component's own `onMount` load and prove nothing about
polling. The "still empty" assertions before each hand-off are what keep it
honest.

Between them the specs cover all five polling channels in the product, each
verified by mutation (breaking the interval makes exactly one step fail):

| Channel | Interval | Asserted by |
|---|---|---|
| `OrderBoard.loadOrders` | 5s | business-cycle step 7 |
| `OrderBoard.loadCalls` | 5s | staff-call step 4 |
| `CheckoutPanel.loadPending` | 5s | business-cycle step 11 |
| `OrderScreen.pollOrder` | 10s | business-cycle step 8 |
| `OrderScreen.pollCall` | 5s | staff-call step 6 |

Waits use auto-retrying assertions rather than fixed sleeps. A passing run
takes roughly a minute for all three specs.

## Not in scope

- Cross-browser matrix — Chromium only.
- The shift product's own screens (period list, builder grid, availability
  form): reaching them needs a `shift` subscription, which no API grants —
  only a direct database write does, and the suite deliberately holds no
  database machinery.
- Visual regression / screenshot diffing (that's the `inspector` agent's
  per-change job, and it is deliberately not automated here).
- Load/performance testing.

## Not in CI yet

`pnpm e2e` is deliberately not part of `pnpm test`, so neither the lefthook
pre-commit hook nor `.github/workflows/ci.yml` runs it — booting five servers
and a browser on every commit is not worth the wall-clock cost until the suite
has a track record. `pnpm check` does typecheck the workspace. Add it to CI as
its own job once it has proven stable.
