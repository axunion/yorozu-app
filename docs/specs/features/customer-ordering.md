# Feature: Customer Ordering

The `apps/order` SPA, reached by scanning a seat QR code
(`/order/:qr_token`). Anonymous; the token in the URL path is the only
credential (`requireSeat` middleware).

## Current behavior

### Bootstrap (`GET /api/order/:seatToken`)

Returns seat name, the menu (categories + **available items only**), and
the active order with items and running total, or `order: null`. Invalid
tokens → 404 and the SPA shows a not-found page. Voided items stay in the
returned `items` array with `status: 'cancelled'` (for a strikethrough
display) rather than disappearing; the order `total` already excludes
them.

Bootstrap also embeds `call: { id, status, created_at } | null` — the
seat's open call-staff request, if any (see "Calling staff" below).

Each menu item also carries `description`, `image_key` (both nullable),
and `option_groups` — only the groups attached to that item, each with
its options embedded (keeps the payload small; see
[menu-management.md](./menu-management.md#item-options--modifiers-apimenuoption-groups)
for how groups/options are managed). The order screen (`MenuList.tsx`)
renders a fixed-aspect photo thumbnail — sized independently of the
`<img>` load state, so it never causes layout shift — only when
`image_key` is present; items without one keep a compact card with no
reserved thumbnail space. Description text renders independently of
the photo. Photo `alt` text carries the item name (the description
doesn't describe what the dish looks like, so an empty `alt` would
drop that information for screen reader users). See
[menu-management.md](./menu-management.md#item-photos-apimenuitemsidimage-apimenuimageskey)
for how `image_key` resolves to a servable URL.

An item with no attached option groups keeps the one-tap add button
(`MenuList.tsx`); an item with one or more groups instead opens an
item detail sheet (`ItemDetailSheet.tsx`) — a group with `max_select
=== 1` renders as radios (plus a "no selection" option when
`min_select === 0`), otherwise as checkboxes disabled once
`max_select` is reached — plus a quantity stepper and a free-text note
field (≤ 200 chars).

### Adding items (`POST /api/order/:seatToken/items`)

- Accepts 1..n items of `{ menu_item_id, quantity 1–99, option_ids?:
  string[], note?: string | null }`.
- The first submission lazily creates the order (`status = 'open'`,
  201); later submissions append to it (200). A partial unique index
  makes concurrent first-orders safe.
- All items are validated up front (exists in this store, available);
  any failure rejects the whole request so no orphaned orders are
  created. Unavailable item → 409 with the item name. Per item, every
  `option_id` must belong to a group attached to that `menu_item_id`;
  each attached group's selected count must be within
  `[min_select, max_select]`; `unit_price + Σ selected price_delta`
  must stay `> 0` — any violation is 400 `VALIDATION_ERROR` with a
  specific message, and (like the availability check) rejects the
  whole request.
- Once the order is `payment_requested`, adding items → 409.
- Item snapshots (name, unit price) are taken at insert time; per-item
  timestamp offsets keep a stable display order. Selected options are
  snapshotted the same way into `order_item_options`
  (`name_snapshot`, `group_name_snapshot`, `price_delta_snapshot`) —
  later edits to the live option never change a placed order's total.
  The line total shown everywhere is
  `(unit_price_snapshot + Σ price_delta_snapshot) × quantity`
  (`sumOrderItems`, `@yorozu/core`).

### Calling staff (`POST /api/order/:seatToken/call`)

- Creates an `open` call for the seat. **Idempotent per seat**: if an
  open call already exists, returns it unchanged with 200 instead of
  creating a duplicate (201 for a genuinely new call) — this also caps
  a table to one outstanding call, so repeated taps can't flood the
  board. A partial unique index on `staff_calls.seat_id WHERE status =
  'open'` makes concurrent first-taps safe at the DB level, mirroring
  the one-active-order-per-seat pattern.
- The Header's "スタッフを呼ぶ" button stays enabled even while a call is
  open (re-tapping is a safe no-op); a separate status line reads "呼ん
  でいます" while the call is open. `OrderScreen` polls only the `call`
  field of the bootstrap response every 5s to pick up a staff resolve —
  deliberately not the full bootstrap, so in-progress UI (e.g. an open
  item detail sheet) isn't disturbed by the poll.
- Resolved by staff from the order board (see
  [order-fulfillment.md](./order-fulfillment.md#staff-calls-apiadmincalls)).

### Order progress

- Each line on the order summary (`OrderSummary.tsx`) is tagged
  `注文済み` (`ordered`) or `提供済み` (`served`); a `cancelled` line
  keeps its existing `取消済み` strikethrough treatment instead.
- `OrderScreen` gently polls the order status every 10s, **only while
  an active order exists** — a customer still browsing the menu
  generates no extra traffic. Unlike the call poll, this replaces the
  whole `order` field (not just one sub-field), since the order
  summary's rows have no nested interactive state to protect the way
  an open item detail sheet would.
- Every request that can set `order` (initial load, add-items, request-
  payment, and the poll) is guarded by a monotonic sequence number: the
  most recently *started* request always wins, so a slow poll response
  can't overwrite a mutation's fresher result if it resolves after it
  (e.g. reverting the screen post-会計をお願いする).

### Requesting the bill (`PATCH /api/order/:seatToken/request-payment`)

- Transitions `open → payment_requested`. Idempotent (repeat → 200).
- No active order → 409.
- After this, the customer's screen shows the locked bill; staff sees the
  order appear on the checkout screen.

### Digital receipt (`GET /api/order/:seatToken/receipt/:orderId`)

- Seat-scoped: the order must belong to the requesting seat *and* be
  `paid` — wrong seat, wrong/nonexistent order id, and not-yet-paid all
  collapse to the same generic 404, so the URL leaks no more than the
  QR code already grants. Returns store name, seat name, line items
  (with options and per-item tax rate), the pre-discount items total,
  any discount, the charged total, a tax breakdown (see
  [checkout.md](./checkout.md#completing-payment-post-apipayments)),
  payment method, and `paid_at`.
- `OrderScreen` detects "just paid" itself: when the active order
  disappears (bootstrap or the 10s poll returns `order: null`) right
  after it was `payment_requested`, the screen calls this same receipt
  endpoint to check whether that's because it was paid or because staff
  cancelled it — both clear the active order client-side, and a 404 vs.
  200 is the only way to tell them apart. Only on 200 does a "レシート
  を表示" banner appear, linking to `/:seatToken/receipt/:orderId`. That
  check is itself guarded by the same monotonic sequence number as
  `order`, so a slow/stale check can't resurrect the banner after the
  customer has already started a new order.

### Session model

"One table visit = one order" — the order stays active across page
reloads and multiple diners at the same table (everyone scans the same
QR). The check clears when staff completes payment; the next scan starts
fresh. The seat's `qr_token` stays valid afterward, so the digital
receipt above remains reachable.

## Known limitations (→ roadmap)

- **No customer self-cancel** — once an order reaches the kitchen,
  voiding an item or the whole order is staff-mediated only
  (`docs/specs/features/order-fulfillment.md`); a "call staff"
  button is the intended UX for customer-initiated corrections.
  (Deliberate v1 decision — revisit with pilot feedback)
- **Japanese only.** (Backlog)
- **No formal 領収書 (addressee receipt)** — the digital receipt above
  covers レシート only; a 領収書 needs the store's registered
  name/address and an addressee line. Not built speculatively;
  revisit only if demanded. (Backlog)
