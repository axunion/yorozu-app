# Feature: Seats & QR Codes

Physical tables registered in `apps/admin` (SeatsPage / SeatManager).
Each seat's QR code is the customer's only credential.

## Current behavior

All endpoints require the `session_token` cookie (`requireStore`) and an
owner session (`requireOwner`; a staff session gets 403).

- `GET /api/seats` — active seats only, ordered by creation time.
  `?include_inactive=true` also returns retired seats (admin history
  views; the admin SeatManager uses this to power a "show retired"
  toggle, filtering client-side into active/retired lists from one
  fetch).
- `POST /api/seats` — creates an active seat with a fresh `qr_token`
  (UUID v4). The admin UI renders the QR code client-side (`qrcode`
  package) linking to `{VITE_ORDER_BASE}/{qr_token}` for printing (the
  order SPA's only route is `/:seatToken`, no `/order/` path segment).
- `PATCH /api/seats/:id` — renames the seat (same 1–100 char rule as
  create).
- Seat names are unique among a store's **active** seats: create or
  rename to a name another active seat holds → 409, since two
  「テーブル1」 make printed QR cards easy to swap. A retired seat's name is
  free to reuse.
- **Printing** (`/seats/print`, owner-only, linked from 座席管理): every
  active seat's QR as a cut-out table card — store name, QR, seat name and
  a one-line instruction — three across and three down per A4 page via
  print CSS, with the admin chrome hidden. 「印刷する」 opens the browser's
  print dialog.
- `DELETE /api/seats/:id` — soft-deletes (retires): sets
  `seats.is_active = false`. The row — and its name — survives forever
  so historical orders/sales stay intact. Idempotent on an
  already-retired seat. Returns 409 if the seat has an active
  (`open`/`payment_requested`) order. **No un-retire** in v1; create a
  new seat instead.
- `POST /api/seats/:id/rotate-qr` — generates a fresh `qr_token`. The
  old printed QR 404s immediately (see below). Returns 409 while the
  seat has an active order (rotating mid-meal would strand the
  customer).
- The customer-facing bootstrap (`GET /api/order/:seatToken`, via
  `requireSeat`) rejects a retired seat's `qr_token` with the same 404
  as an unknown token — a retired table's printed QR is dead.

The `qr_token` is the security boundary for customers: possession of the
URL grants ordering rights for that seat. Tokens are unguessable UUIDs
and never expire on their own (only replaced via rotation, or made
unusable via retirement).

## Known limitations

- **No occupancy view** — admin cannot see "which tables are currently
  active" at a glance outside the order board.
