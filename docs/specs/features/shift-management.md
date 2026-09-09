# Feature: Shift Management

A second product sold to the same stores, in its own SPA (`apps/shift`,
dev port 5176). Requires the `session_token` cookie (`requireStore`) **and**
an active `shift` subscription; every route is behind
`requireEntitlement("shift")`.

Owner and staff see different products on the same routes. The API is the
guard — every building endpoint is `requireOwner` — and the UI only decides
what to offer.

## Entitlement

`subscriptions` records which products a store has bought:
`(store_id, product, plan, status)`, unique on `(store_id, product)`.
Registration writes the `order` subscription, and every store that existed
before the table was grandfathered into it, so the order product needs no
gate and carries no extra read per request.

`requireEntitlement(product)` returns **403 `FORBIDDEN`** on a miss — not
404. The store, the session and the route all exist; this is the same
category of refusal as `requireOwner`. The SPA reads that 403 on its first
shift request and renders a "not enabled" screen instead of an error alert:
a store cannot fix this by logging in again.

## Time encoding

A shift belongs to a JST **business date** (`work_date`, `YYYY-MM-DD`) and is
stored as minute offsets from that date's 00:00. `start_minutes` is always
`0…1439`; `end_minutes` may run past midnight, so a shift ending at 1am the
next morning is `1500` (25:00), never `60`. DB CHECK constraints enforce the
canonical form, and the UI renders `25:00` for exactly this reason — an
overnight band shown as `01:00` reads as the wrong day.

Consequence in the staff form: a band ending at or past midnight has no
`<input type="time">` representation, so it is shown read-only with a
"入力し直す" button rather than being wrapped and silently re-saved as an
invalid band.

## Setup (owner, `/settings`)

- **Positions** (`/api/shift/positions`) — named roles (ホール, キッチン…).
  `DELETE` **retires** (`is_active = false`) rather than deletes: shifts and
  staffing requirements reference them, so an old schedule still has to
  render. Idempotent.
- **Shift patterns** (`/api/shift/templates/patterns`) — named bands the
  builder offers as one-click buttons. Also retired, not deleted. A pattern
  entered as 22:00–01:00 is stored as `1320`–`1500`.
- **Staffing requirements** (`/api/shift/templates/requirements`) — the
  weekly template the coverage grid measures against: per weekday, position
  and band, a required headcount. `0` is meaningful (it closes a band that
  used to need staff). Hard-deleted, because a stale one keeps reporting a
  shortage that no longer exists. **v1 has no per-date override** — a public
  holiday is handled by the manager reading the grid, not by the template.
- **Member work profiles** (`PUT /api/shift/members/:id/work-profile`) —
  hourly wage, weekly cap, and a minor flag. Owner-only on the API as well
  as in the UI: wages and the minor flag must never reach a staff session.
  A null wage means *not recorded*, never free.
- **Member positions** (`PUT /api/shift/members/:id/positions`) — replaces
  the assignment list; an empty list clears it.

## The period cycle

A period covers a **whole half-month** — the 1st–15th or the 16th–end of
month. `POST /api/shift/periods` rejects any other range, so the owner form
asks for one date the period should contain and derives the bounds.

```
collecting ──close-submissions──▶ building ──publish──▶ published
```

- `collecting` — staff can save and submit availability.
- `building` — availability is frozen; the owner assigns shifts.
- `published` — staff can see their own shifts. Terminal.

Every transition is owner-only, and a transition from the wrong state is
**409**, distinguished from a foreign or missing period (404) by a second
read. `submission_deadline` is **advisory in v1**: closing submissions is
the enforcement, not the timestamp.

Publishing is not a snapshot. Later edits to a published period's shifts
take effect immediately, with no republish.

## Availability (staff, `/periods/:id/availability`)

`GET /api/shift/availability/:periodId/me` returns the caller's own
submission, or an empty draft rather than a 404 so the form has something to
render. `PUT` replaces every entry for the period and takes `submit: false`
for a draft or `true` to submit.

Guards on the PUT: **409** once the period has left `collecting`; **400**
for a `work_date` outside the period, or for two contradicting entries on
the same date. An `available` entry needs a band that runs forwards and no
longer than 24 hours; a `day_off` entry carries no times at all.

The whole save runs as one `db.batch`, chunked at 12 entries per statement —
a routine half-month submission otherwise exceeds D1's limit of 100 bound
parameters per query.

The form offers **"copy the previous period"**, matched by weekday: it is
what stands in for the standing weekday availability rules v1 deliberately
does not store. The first entry for a weekday wins, and the copy only
prefills the form — nothing is written until the member saves.

**Known limitation:** `availability_entries` allows several bands per
`(submission, work_date)`, but the staff form offers one per day. It renders
the first and a re-save drops the rest. Nothing in v1 writes a second band,
so this is a form limitation rather than data loss.

## Building a schedule (owner, `/periods/:id`)

`GET /api/shift/schedule/:periodId` answers the whole screen in one request.
For an owner that is the period, its shifts, every availability submission,
and the staffing requirements. For a staff member it is only their own
shifts, and only once published — before that they get `200` with an empty
list and `published: false`, since the period's existence is no secret from
its own store's staff.

Shifts are written through `POST`/`PATCH`/`DELETE /api/shift/shifts`:

- **404** when the period, member or position belongs to another store —
  the body's foreign keys are verified against the caller's store, not
  trusted.
- **400** when `work_date` falls outside the period.
- **409** when the member already has an overlapping shift, overnight bands
  included.

Coverage, labour warnings and cost are **computed, never persisted**. The
API returns rows; the SPA calls the pure functions in
`packages/core/src/domain/shift.ts`, so the judgement lives in one
unit-tested place and the routes stay thin.

- **Coverage** — required vs. assigned per date, position and band. A shift
  counts towards a band when it overlaps it at all: a manager wants "who is
  here during this band", not "who is here for all of it". The grid marks
  a shortage and a surplus differently, by colour token *and* by wording.
- **Labour warnings** — `DAILY_OVER_8H`, `WEEKLY_OVER_40H`,
  `BREAK_REQUIRED_45` / `_60`, `NO_REST_DAY`, `OVER_WEEKLY_CAP`,
  `MINOR_LATE_NIGHT`. Weeks are JST Monday–Sunday. Over 8 hours only the
  60-minute break rule is reported, since it subsumes the 45-minute one.
  **Warnings are advisory and never block a save or a publish.**
- **Cost** — hourly wage × worked minutes. A member with no recorded wage is
  named as unpriced rather than counted as free, so a total is never quietly
  too low.
- **Non-submitters** — members with no `submitted` submission. A *draft*
  submission does not count. v1 shows the list; it sends no reminders.

**CSV export** of the period's shifts (date, staff, position, start, end,
break, worked minutes), BOM-prefixed so Excel reads the Japanese correctly.

## Staff's own schedule (`/`)

The newest period's published shifts, with worked hours per row, plus a link
to the submission form while a period is collecting. An unpublished period
says so rather than rendering nothing — "not published yet" and "no shifts
assigned" are different states and read differently.

## Login

The shift SPA sends `app: "shift"` when verifying its passcode, which the
API maps to `SHIFT_ORIGIN` from its own env and returns as `redirect_to`, so
a verified login lands back in this SPA rather than in admin. See [authentication](./authentication.md).

## Not in v1

- **Post-publish changes** — absence reporting, staff-to-staff swaps with
  manager approval, and the open-shift board. These need two more state
  machines and a notification channel.
- **Submission reminders.** The non-submitter list is what v1 offers
  instead; sending mail would mean a second outbound path beyond passcodes.
- **Standing per-member availability rules.** "Copy the previous period"
  carries the same information without a table.
- **Per-date requirement overrides** (holidays).
- **Plan/pricing enforcement.** `subscriptions.plan` exists and is unused.
- No time clock, attendance or payroll.
