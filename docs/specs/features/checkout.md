# Feature: Checkout & Payments

The admin CheckoutPage / CheckoutPanel: settling bills that customers
have requested. Requires the `session_token` cookie (`requireStore`).

## Current behavior

### Pending bills (`GET /api/payments/pending`)

Returns all `payment_requested` orders with seat name, items, and total,
oldest first. Polled every 5 seconds by the UI. Each line item includes
its selected options and note, same as the order board — CheckoutPanel
renders both so staff can double-check the bill before settling it.

### Completing payment (`POST /api/payments`)

- Input: `order_id`, `method` (`'cash' | 'card' | 'qr'`, defaults to
  `'cash'` — recorded at a staff-operated terminal, no processor
  integration), and an optional `discount_amount`/`discount_reason`
  whole-check discount. The client sends only intents (method,
  discount) — every amount is always recomputed server-side from item
  snapshots, never trusted from the request.
- Guards: order must exist in this store (404), be `payment_requested`
  (409 otherwise, with a distinct "already paid" message), and have at
  least one non-`cancelled` item (409, same message as zero items —
  voided-out bills cannot be checked out). `discount_amount` is bounded
  to `[0, items total]` (400 if it would exceed the bill);
  `discount_reason` is required whenever `discount_amount > 0` (400 and
  a DB CHECK constraint both enforce this). `total_amount = items total
  − discount_amount`.
- Writes payment INSERT + order UPDATE (`paid`, `closed_at`) atomically
  via `db.batch()`. Concurrent double-payment is blocked by a partial
  unique index on `payments.order_id WHERE voided_at IS NULL` → 409 (see
  "Voiding a payment" below for why it's partial, not a plain UNIQUE).
- CheckoutPanel: a one-tap method selector (radiogroup, defaults to
  現金) always visible per pending bill; a discount entry hidden behind
  a "割引を追加" tap (deliberate friction against casual misuse) that
  blocks checkout until a reason is entered whenever an amount is.

### Voiding a payment (`PATCH /api/payments/:id/void`)

- All-or-nothing — no partial refunds. Input: `void_reason` (required,
  ≤ 200 chars, trimmed). Idempotent: voiding an already-voided payment
  re-reads and returns the persisted state unchanged (also the
  authoritative response under a race between two concurrent voids of
  the same payment — the loser reports the winner's reason, never its
  own unpersisted guess).
- Atomically (same `db.batch()`) sets `voided_at`/`void_reason` and
  reopens the order to `payment_requested` (`closed_at` cleared) so it
  can be corrected — via the existing reopen (`open`) and item
  endpoints, then re-settled — or cancelled via
  [order-fulfillment.md](./order-fulfillment.md)'s whole-order cancel.
- 409 if reopening would violate the one-active-order-per-seat
  invariant: paying frees the seat (same as cancelling does), so by the
  time staff voids a stale payment, the seat may have already started a
  genuinely new order.
- SalesHistory: void is behind the same extra-tap pattern as
  discounts — a reason field, then a `ConfirmDialog` (required for
  every destructive action in this codebase) disabled until the reason
  is non-empty.

### Sending a bill back to the table (`PATCH /api/admin/orders/:id/reopen`)

- Transitions `payment_requested → open`, e.g. when a customer wants to
  add more items before paying, or staff is correcting a voided
  payment's order. Idempotent if already `open`; 409 if `paid` or
  `cancelled`.

### Sales history (`GET /api/payments?from=<unix_ms>&to=<unix_ms>`)

- Returns completed payments with `paid_at` in `[from, to)`, newest
  first, each joined with its order's seat name and line items —
  **including voided ones**, so staff can see void history. Cancelled
  lines are included and flagged by status — they explain the bill, but
  their amounts are already excluded from `total_amount`. Line items
  carry the same selected-options/note fields as the board and
  pending-bills endpoints, but the admin SalesPage does not render them
  yet (not required by the proposal that shipped options/notes; only
  OrderBoard and CheckoutPanel display them).
- Validation (400): both params required, integers, `from < to`, range
  ≤ 62 days.
- No pagination and no server-side aggregation — the admin SalesPage
  computes totals client-side from the list; a two-month window at
  small-restaurant volume stays well under response limits. Voided
  payments are excluded from every client-computed aggregate (revenue
  total, average per check, per-method breakdown) but still render in
  the list — struck through, badged "取消済み" — for audit visibility.
- The admin SalesPage (`/sales`) scopes each query to a JST calendar
  day via `jstDayRange` (`@yorozu/core`, `domain/time.ts`), with
  prev/next-day navigation and a date picker (defaults to today JST).

### Sales reports (`/reports`, `apps/admin`)

- Separate page from `/sales`; same access (open to both roles, not
  `requireOwner`-gated). Reuses `GET /api/payments?from&to` as-is — no
  new server endpoints or schema changes; all aggregation below runs
  client-side over the returned payments.
- **Date range**: presets 今週 (`jstWeekRange`, Monday-start) and 今月
  (`jstMonthRange`), plus a custom `from`/`to` date-picker pair
  (`jstDayRange`, same ≤ 62-day validation as `/sales`). Defaults to
  今週.
- **Item ranking**: aggregates non-voided payments' non-`cancelled`
  line items by `name_snapshot`, summing `quantity` and revenue
  (`(unit_price_snapshot + Σ price_delta_snapshot) × quantity`, same
  formula as receipts). Sortable by 売上金額 (default) or 数量; no
  pagination, same volume assumption as `/sales`.
- **Weekday / hourly breakdown**: buckets non-voided payments'
  `total_amount` by JST weekday (`toJstWeekday`, 7 buckets) and JST
  hour-of-day (`toJstHour`, 24 buckets), rendered as simple `%`-width
  bars (no charting dependency).
- **CSV export**: item ranking and weekday breakdown each have a
  "CSVダウンロード" button (`downloadCsv`, `apps/admin/src/lib/download.ts`
  — BOM-prefixed, CRLF rows, shared with the account-data export). The
  hourly breakdown has no export button (24 rows is easy to eyeball;
  not requested).

### Tax breakdown

- `menu_items.tax_rate` (8 or 10, default 10) is snapshotted onto
  `order_items.tax_rate_snapshot` at order time, same rule as price —
  not exposed in the admin UI in v1 (every item is dine-in
  standard-rate today), it exists so receipts stay correct if takeout
  or a rate change ever arrives.
- `computeTaxBreakdown` (`@yorozu/core`) buckets **pre-discount** line
  totals by rate, then derives each bucket's tax portion via the
  inclusive-tax formula (`tax = total − round(total / (1 + rate/100))`)
  — rounded once per bucket (half down), never per line item. Used by
  the customer receipt (see
  [customer-ordering.md](./customer-ordering.md#digital-receipt-get-apiorderseattokenreceiptorderid));
  not currently surfaced on the admin side.

## Known limitations (→ roadmap)

- **No split billing** — one order, one payment. Deferred to backlog;
  revisit only on real demand (see
  `docs/proposals/payments-expansion.md`).
- **No true payment-processor integration** — card/QR are recorded, not
  actually charged through a processor. (Backlog; evaluate only if
  pilot restaurants don't already own a terminal.)
- **No per-staff audit trail** — discount/void reasons are recorded,
  but `payments` has no column capturing which member applied them.
  Sessions are per-member since Phase 5 item 1, so the acting member is
  known at request time; it just isn't persisted onto the payment row.
  Deferred to backlog; revisit only on real demand.
