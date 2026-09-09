# Domain Model

Source of truth: `packages/db/src/schema.ts`. This document explains the
*why* behind the schema and the rules that every feature must respect.

## Entity overview

```
stores 1 ──── * menu_categories 1 ──── * menu_items 1 ──── * menu_item_option_groups * ──── 1 option_groups 1 ──── * options
   │                                        │ (snapshot at order time)
   ├──── * seats 1 ──── * orders 1 ──── * order_items 1 ──── * order_item_options
   │        │               │
   │        └──── * staff_calls
   └──── * members 1 ──── * sessions
            │
            └──── * magic_link_tokens

stores 1 ──── * subscriptions          (which products this store has bought)
   │
   ├──── * positions 1 ──── * member_positions * ──── 1 members
   │        └──── * staffing_requirements       (weekly template)
   ├──── * shift_patterns                       (named bands)
   ├──── * member_work_profiles 1 ──── 1 members
   └──── * schedule_periods 1 ──┬── * availability_submissions 1 ──── * availability_entries
                                └── * shifts
```

- **stores** — one row per tenant. `email` is fixed at whatever address
  created the store — historical/display only, not a login identity (see
  **members** below; it used to double as the login id before Phase 5).
- **members** — one row per person who can log in to a store. `email` is
  **UNIQUE globally** (same constraint shape stores.email used to have —
  one email = one member, across all stores; a person can't be staff at
  two stores with the same email). `role` (`'owner' | 'staff'`) gates
  settings/menu/seats/staff-management (owner) vs. board/checkout (both);
  see [features/authentication.md](./features/authentication.md). A
  store's first member (created at signup) is always an owner; the API
  enforces at least one owner remains (see Invariants).
- **menu_categories / menu_items** — the sellable catalog. Items may be
  uncategorized (`category_id` nullable). Prices are tax-inclusive JPY
  integers; `tax_rate` (8 or 10, default 10) is not exposed in the
  admin UI in v1 but exists so receipts stay correct if takeout or a
  rate change ever arrives. Items also carry a nullable `description`
  (≤ 500 chars) and a nullable `image_key` — an R2 object key, not a
  URL, so the serving origin can change without touching data (see
  [features/menu-management.md](./features/menu-management.md#item-photos-apimenuitemsidimage-apimenuimageskey)).
- **option_groups / options** — store-level, reusable across items (a
  "Size" group attaches to every drink; per-item groups would force
  duplication). A group has `min_select`/`max_select` (e.g. 1/1 = choose
  exactly one size, 0/3 = up to three toppings). An option carries a
  `price_delta` (int JPY, may be negative). `menu_item_option_groups`
  joins groups to items (see
  [features/menu-management.md](./features/menu-management.md#item-options--modifiers-apimenuoption-groups)).
- **seats** — physical tables. Each has an unguessable `qr_token` (UUID)
  that authenticates the customer order screen; `is_active` soft-deletes
  a retired seat (row and name survive forever for historical
  orders/sales) instead of a hard `DELETE`, which `orders.seat_id NOT
  NULL` would block anyway once the seat has any order history.
- **orders** — one "check" per table visit, not per submission. Items
  accumulate on the same order until it is paid.
- **order_items** — line items with `name_snapshot` /
  `unit_price_snapshot` / `tax_rate_snapshot` copied at order time, so
  later menu edits never change a bill. Also carries a nullable
  free-text `note` (≤ 200 chars, e.g. "no onions"). `order_item_options`
  snapshots each selected option (`name_snapshot`, `group_name_snapshot`,
  `price_delta_snapshot`) so editing or deleting the live option later
  never changes a past bill.
- **staff_calls** — a seat's "call staff" request, independent of
  `orders` (a table can call staff with no order yet). At most one
  `open` call per seat is enforced by a partial unique index; see
  [features/customer-ordering.md](./features/customer-ordering.md#calling-staff-post-apiorderseattokencall)
  and
  [features/order-fulfillment.md](./features/order-fulfillment.md#staff-calls-apiadmincalls).
- **payments** — at most one *settled* (non-voided) row per order
  (partial unique index on `order_id`, see invariant 3). Records
  `method` (`'cash' | 'card' | 'qr'`), an optional whole-check
  `discount_amount`/`discount_reason`, and — once voided —
  `voided_at`/`void_reason`. A voided row's order reopens to
  `payment_requested` and the row itself is kept (not deleted) for
  audit history; see
  [features/checkout.md](./features/checkout.md#voiding-a-payment-patch-apipaymentsidvoid).
- **sessions / magic_link_tokens** — auth artifacts; see
  [features/authentication.md](./features/authentication.md). Both carry
  `member_id` (the dedup/rate-cap key — see below) and a denormalized
  `store_id` (avoids a join on every `requireStore`-guarded request).
  `magic_link_tokens.purpose` is `'signup' | 'login' | 'email_change' |
  'invite'`; the nullable `new_email` column holds the pending target
  address for `email_change` tokens only. `issueMagicLink`'s supersede
  (only one valid link per purpose) and hourly rate cap are scoped by
  `member_id`, not `store_id` — a store can have multiple members now,
  and unrelated members issuing tokens concurrently must not invalidate
  each other's link.

- **subscriptions** — one row per `(store_id, product)`, unique on that
  pair. `product` is `'order' | 'shift'`, `status` is
  `'active' | 'suspended'`, and `plan` is reserved and unused. Every
  pre-existing store was grandfathered into `order`, so the order product
  needs no gate; `requireEntitlement('shift')` reads this table.
- **positions** — a store's named roles. **Retired** (`is_active = false`),
  never deleted: `shifts.position_id` and
  `staffing_requirements.position_id` reference them, so an old schedule
  still has to render.
- **shift_patterns** — named time bands, templates only: a shift copies
  the times and never references a pattern, so there is no FK to protect.
  Retired rather than deleted all the same, so that retiring one does not
  quietly change what an existing schedule was built from.
- **staffing_requirements** — the weekly template the coverage grid
  measures a schedule against: per weekday, position and band, a required
  headcount. Hard-deleted, because a stale one keeps reporting a shortage
  that no longer exists.
- **member_work_profiles** — hourly wage, weekly cap and a minor flag.
  Owner-only on the API: none of it may reach a staff session. A null
  wage means *not recorded*, not free.
- **schedule_periods** — a whole half-month (1st–15th, or 16th–end of
  month) with a status (see State machines below).
- **availability_submissions / availability_entries** — one submission per
  `(period, member)`; entries carry `work_date` plus a band or a day-off
  marker. The schema allows several entries per `(submission, work_date)`;
  the v1 staff form writes one.
- **shifts** — an assignment of a member to a band on a business date,
  optionally in a position. Coverage, labour warnings and cost are
  **computed from these rows, never stored** — see
  [features/shift-management.md](./features/shift-management.md).

## State machines

### stores.status

```
pending ──(passcode verified)──▶ active ──(owner: POST /me/suspend)──▶ suspended
                                       ▲                                     │
                                     └──(owner: reactivate passcode)──────┘
```

- `pending` — registered, email unverified. Login resends the signup code.
- `active` — normal operation.
- `suspended` — set by the store's own owner (`POST /api/stores/me/suspend`
  — owner self-service only, no billing/platform-admin trigger exists;
  see [features/authentication.md](./features/authentication.md#account-lifecycle-appsadmin-settingspage-owner-only-danger-zone)).
  All sessions for the store are deleted in the same batch. An
  owner-role member's next login attempt issues a `reactivate` Magic
  Link instead of the usual silent no-op for a suspended store; verifying
  it sets the store back to `active`. A store row can also be deleted
  entirely (`DELETE /api/stores/me`, hard delete, no retention) — not
  a `stores.status` transition, the row stops existing.
- **`stores.status` and `subscriptions.status` are different switches.**
  `stores.status = 'suspended'` means the account is disabled: nothing in
  any product works and `requireStore` rejects with 401.
  `subscriptions.status` says whether an *active* store has bought a
  particular product: a miss is a 403 from `requireEntitlement` and
  affects only that product's routes. A store can be perfectly healthy and
  still have no shift management, and suspending an account never touches
  its subscriptions.

### members.status

```
pending ──(passcode verified: signup or invite)──▶ active
```

- `pending` — created at store signup (owner) or by `POST /api/staff`
  (staff invite); email unverified. Login resends the `signup` (owner) or
  `invite` (staff) passcode. No `suspended` state at member level —
  removing access is `DELETE /api/staff/:id` (deletes the row), not a
  status transition.
- `active` — can log in. `requireStore` rejects (401) if either the
  member or the store isn't `active`.

### orders.status

```
open ──(customer requests payment)──▶ payment_requested ──(staff checkout)──▶ paid
  ▲                    │                                                        │
  └───(staff reopens)──┘                                                        │
                        ▲                                                       │
                        └──────────────────(staff voids the payment)────────────┘

open, payment_requested ──(staff cancels)──▶ cancelled
```

- `open` — items can be added by the customer.
- `payment_requested` — bill locked; adding items returns 409. Set by the
  customer; staff can send it back to `open` (`PATCH
  /api/admin/orders/:id/reopen`, idempotent if already `open`).
- `paid` — normally terminal (`closed_at` must be set, DB CHECK
  constraint) but reachable back to `payment_requested` if staff voids
  the payment (`closed_at` cleared) — see
  [features/checkout.md](./features/checkout.md#voiding-a-payment-patch-apipaymentsidvoid).
- `cancelled` — terminal (walkout, mistaken table). Reachable from `open`
  or `payment_requested` via `PATCH /api/admin/orders/:id/cancel`, never
  from `paid`. Sets `closed_at`; frees the seat like `paid` does (the
  one-active-order-per-seat partial index excludes it). Cancelling an
  order cascades to all its non-`cancelled` items in one `db.batch`.

### order_items.status

```
ordered ──(staff marks served)──▶ served
   │                                  │
   └──(staff voids)──▶ cancelled ◀────┘
```

- `ordered → served` and `served → ordered` (un-serve, `PATCH
  .../unserve`) are idempotent at the API level.
- `ordered | served → cancelled` (void, `PATCH .../cancel`) is terminal
  and idempotent; rejected (409) once the parent order is `paid` or
  `cancelled`. `sumOrderItems` excludes `cancelled` items from every
  total, so voiding a line never requires recomputation elsewhere.

### staff_calls.status

```
open ──(staff resolves)──▶ resolved
```

- `open → resolved` (`PATCH /api/admin/calls/:id/resolve`) is terminal
  and idempotent. `resolved_at` must be set once `resolved` (DB CHECK
  constraint, same pattern as `orders.closed_at`). A resolved call
  frees the seat for a fresh `open` call — the partial unique index
  only covers `status = 'open'`.

### schedule_periods.status

```
collecting ──close-submissions──▶ building ──publish──▶ published
```

- `collecting` — staff may save and submit availability; the availability
  PUT is **409** from any later state. `submission_deadline` is advisory
  in v1: closing submissions is the enforcement, not the timestamp.
- `building` — availability is frozen and the owner assigns shifts.
- `published` — staff can read their own shifts. **Terminal**: publishing
  again is a 409, and later edits to a published period's shifts take
  effect immediately without a republish.
- Both transitions are owner-only and conditional on the current state, so
  a wrong-state transition is **409** while a foreign or missing period is
  **404** — distinguished by a second read after the guarded UPDATE
  matches nothing.

## Invariants (DB-enforced)

1. **One active order per seat** — partial unique index on
   `orders.seat_id WHERE status IN ('open','payment_requested')`. Handles
   concurrent Workers racing to create the first order.
2. **One open call per seat** — partial unique index on
   `staff_calls.seat_id WHERE status = 'open'`, same pattern as
   invariant 1. Concurrent taps of the call-staff button race safely:
   the loser's INSERT fails the constraint and the API re-reads the
   winner's row instead of erroring.
3. **One settled payment per order** — partial unique index on
   `payments.order_id WHERE voided_at IS NULL`. Concurrent
   double-checkout is caught by the constraint and surfaced as 409; a
   voided row doesn't count, so a corrected order can be re-settled
   with a second row.
4. **Paid or cancelled orders have `closed_at`; resolved calls have
   `resolved_at`; voided payments have `void_reason`** — CHECK
   constraints (the last mirrors the discount pattern: `discount_amount
   > 0` requires `discount_reason`).
5. **Positive amounts** — `menu_items.price > 0`,
   `order_items.quantity > 0` (also capped at 99 by Zod),
   `payments.total_amount >= 0`, `payments.discount_amount >= 0`.
6. **One subscription per product per store** — unique index on
   `(store_id, product)`, which doubles as the entitlement lookup index.
7. **Canonical time encoding on every band** (`shifts`, `shift_patterns`,
   `staffing_requirements`, `availability_entries`) — CHECK constraints
   require `start_minutes < 1440`, `end_minutes > start_minutes`, and
   `end_minutes <= start_minutes + 1440`. A shift ending at 1am the next
   morning is therefore `1500` (25:00) and never `60`: one encoding, so
   overnight comparisons are plain arithmetic.
8. **Business dates are real dates** — `work_date` and the period bounds
   are `YYYY-MM-DD` enforced by a GLOB CHECK, with calendar validity
   checked by Zod (`2026-02-30` is rejected, not rolled over).
9. **A day-off availability entry carries no times** — CHECK: `kind =
   'day_off'` requires both minute columns null, `kind = 'available'`
   requires both set.

## Invariants (API-enforced)

- **A store always has at least one owner member** — not a DB constraint
  (D1 has no cross-row trigger support here). `DELETE /api/staff/:id`
  rejects self-removal (400) **and** rejects removing the target if it's
  the store's last `role: 'owner'` member (counts other owners in the
  store, excluding the target; 400 if none remain). Both checks are
  needed: self-removal alone doesn't prevent two distinct owner sessions
  from concurrently removing each other, which would leave zero owners
  despite each individual request passing the self-removal check. This
  is a check-then-act guard, not a transactional one — same accepted
  tradeoff as the slug/email uniqueness checks elsewhere in this
  codebase. See
  [features/authentication.md](./features/authentication.md#staff-management-appsapisrcroutesstaffts-owner-only).

- **A member never has two overlapping shifts** — `POST`/`PATCH
  /api/shift/shifts` scan the member's other shifts on the adjacent dates
  and return **409** on any overlap, overnight bands included (compared
  through `absoluteRange`, so a 21:00–25:00 shift is adjacent to, not
  overlapping with, the next morning's 09:00 start). A check-then-act
  guard, like the owner-count rule above: D1 offers no range-exclusion
  constraint to lean on.
- **A submission never contradicts itself on one date** — a `day_off`
  entry and an `available` band for the same `work_date` in one PUT is
  **400**, and every entry must fall inside the period.
- **Foreign keys in a request body are verified against the caller's
  store, not trusted** — a `period_id`, `member_id` or `position_id`
  belonging to another store answers **404**, the same as an id that does
  not exist. The FK columns alone would not catch this: they point at
  rows that really exist, just in someone else's store.
- **Entitlement is 403, not 404** — `requireEntitlement` refuses a store
  without an active subscription for the product. The store, session and
  route all exist, so this is the `requireOwner` category of refusal, not
  the cross-tenant existence-leak category.

## Multi-tenant isolation rule

Every query in `apps/api` MUST filter by `store_id`. To make this cheap,
`store_id` is denormalized onto `order_items` and `payments` so no query
needs a join just to apply the tenant filter. Cross-tenant lookups return
**404 (not 403)** to avoid existence leaks. Isolation is regression-tested
in `business-cycle.test.ts` by running two stores through the full cycle
concurrently.

## Money and time conventions

- All amounts are **tax-inclusive JPY integers** (no decimals, no
  separate tax column) — `menu_items.tax_rate`/`order_items.tax_rate_snapshot`
  exist only to *decompose* an already-charged total into a receipt's
  tax breakdown (`computeTaxBreakdown`, `@yorozu/core`); they never
  change what's charged.
- All timestamps are **Unix milliseconds** (`integer` columns), generated
  in the Worker via `Date.now()` — D1 has no native datetime. The API
  stays timezone-agnostic; business-day boundaries (JST, UTC+9) are a
  client concern via `jstDayRange`/`toJstDateString` (`@yorozu/core`,
  `domain/time.ts`), used by the sales-history date range.
- Billing totals are always computed from
  `(unit_price_snapshot + Σ price_delta_snapshot) × quantity` per line
  (`sumOrderItems`, `@yorozu/core`), never from live menu or option
  prices.
