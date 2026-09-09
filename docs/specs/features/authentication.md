# Feature: Authentication & Account

Passwordless auth by emailed 6-digit passcode. Technical architecture
(cookie strategy, cross-origin design, how codes are stored) lives in
[reference/auth.md](../../reference/auth.md); this spec covers product
behavior.

## Actors

- **Member** — a login identity on a store (`members` table). Two roles:
  - **Owner** — full access: settings, menu, seats, staff management, plus
    board/checkout.
  - **Staff** — daily operations only: board/checkout (order board, staff
    calls, payments). Cannot manage menu/seats/settings/staff.
- A store's first member (created at signup) is always an owner. A store
  always has at least one owner — see "Staff management" below.

## Current behavior

### Sign-up (`POST /api/stores`, from `apps/signup`)

1. Owner submits store name + email. A URL slug is derived from the name
   with a 5-char random suffix.
2. Store is created with `status = 'pending'`, and its first member is
   created in the same step (`role: 'owner'`, `status: 'pending'`, same
   email). A signup passcode (10 min TTL, single-use, 5 verification
   attempts) is emailed via Resend.
3. Duplicate email → 400 with an explicit "already registered" message
   (checked against both `stores.email` and `members.email` — either can
   independently already hold the address). Failure to issue the token
   compensates by deleting the store + member rows so the owner can retry.
4. Email delivery failure leaves the store `pending`; the owner recovers
   via the login form (which resends the signup link).

### Login (`POST /api/auth/login`, form hosted in `apps/admin`)

- Resolves by **`members.email`**, not `stores.email` — `stores.email` is
  fixed at whatever address created the store and is no longer a login
  identity (see "Store settings" below).
- Always returns 200 with an identical body regardless of whether the
  email exists (anti-enumeration). Email delivery is deferred via
  `waitUntil` so response latency doesn't leak registration status either.
- Per member/store status: member `active`, store `active` → `login`
  code. Member `pending`: resends the `signup` code if the member is
  an `owner` (first-time onboarding), or the `invite` code if
  `staff` (unactivated invite) — **regardless of the store's status**,
  since completing an invite/signup grants no access on its own
  (`requireStore` still blocks on store status), so there's no reason to
  also gate onboarding on suspension. Member `active`, store `suspended`:
  `owner` → `reactivate` code (see "Account lifecycle" below);
  `staff` → silently no email (only an owner can reactivate).
- Rate limited per member: see "Passcode caps" below.

### Verification (`POST /api/auth/verify-code`)

- Takes `{ email, code, app? }`. Validates the code (unused, unexpired,
  under the attempt cap), marks it consumed (kept for audit), creates a
  session (30-day TTL, sliding — see below), sets the `session_token`
  HttpOnly cookie, and returns `{ redirect_to }` for the SPA to navigate to.
- `purpose = 'signup'`: activates both the store and the member.
- `purpose = 'invite'`: activates the member only (the inviting store is
  already active).
- `purpose = 'reactivate'`: activates the store only (the owner member is
  already active) — see "Account lifecycle" below.
- `purpose = 'email_change'` is **not** handled here — its code goes to an
  address not yet on the member, so it verifies against the caller's
  session instead (see "Store settings" below).
- Every failure mode returns the same `INVALID_CODE` 400: an unknown
  address, no live code, a wrong code and an exhausted attempt budget must
  be indistinguishable.

### Session & logout

- `GET /api/auth/me` resolves the session for SPA bootstrapping — returns
  `{ id, name, email, role }` (401 when invalid/expired). `id`/`name` are
  the store's; `email` is the **calling member's own** login email; `role`
  is `'owner'` or `'staff'`. Admin routes are guarded by `requireStore`,
  which additionally rejects (401) if the member itself isn't `active`
  (e.g. a removed or not-yet-verified member) even if the store is.
- `POST /api/auth/logout` deletes only the current session (other devices
  stay logged in), clears the cookie, redirects to the login page.
- `POST /api/auth/logout-all` (`requireStore`) deletes **every** session
  belonging to the calling member — all of that member's own devices —
  and clears the cookie. Does not affect other members' sessions.
- Multiple concurrent sessions per member are allowed by design (e.g. a
  phone and a register terminal).
- **Sliding expiry:** each authenticated request refreshes the session's
  `expires_at` to 30 days out and updates `last_used_at`, throttled to at
  most once per hour of activity (so 5s-polling admin/order-board traffic
  doesn't write on every request). A session is durably logged out only
  by explicit action (`logout`, `logout-all`, or being removed via staff
  management) or 30 days of total inactivity — not a fixed clock from
  issuance.

### Roles & route gating

- **Owner-gated** (`requireOwner`, 403 for a `staff`-role session):
  `PATCH /api/stores/me` (rename), all of `menu`/`menu-options`/`seats`,
  and all of staff management (below).
- **Open to both roles:** the order board, staff calls, payments/checkout,
  and `POST /api/stores/me/email-change` (any active member manages their
  own login email; gated by "is this your own account", not role).

### Staff management (`apps/api/src/routes/staff.ts`, owner-only)

- `POST /api/staff` — invites a member into the caller's store: body
  `{ email, role }` (`role` defaults `'staff'`; an owner can also invite a
  co-owner). Creates a `pending` member and emails an `invite` passcode
  alongside the plain admin login URL to enter it at — the invitee is the
  one recipient with no screen already waiting, and that URL carries no
  credential. 400 if the email already belongs to any member (global
  uniqueness — the caller is authenticated/owner here, so anti-enumeration
  doesn't apply). Rate-limited to `MAGIC_LINK_HOURLY_CAP` invites per
  **store** per rolling hour (the per-member cap can't apply here — each
  invite is a brand-new member with no prior history).
- `GET /api/staff` — lists the calling store's members (`id, email, role,
  status, created_at, activated_at`).
- `DELETE /api/staff/:id` — revokes a member's access: deletes the member
  row and cascades their sessions and passcode rows. For a store with
  shift management it also deletes that member's shift rows — their
  availability submissions and entries, assigned shifts, position
  assignments and work profile. Removing somebody therefore erases their
  scheduling history as well as their access; export the schedule first
  (the builder's CSV) if that history matters. Rejects 400 for
  self-removal (use logout instead) and for removing the store's last
  remaining owner (a co-owner can still be removed, leaving one owner) —
  a store always keeps at least one owner.
- Managed from `apps/admin`'s Staff page (owner-only nav item): invite
  form, member list with role/status, remove button (disabled client-side
  for self and the sole remaining owner — the API check above is the
  actual guard, this is UX only).

### Account lifecycle (`apps/admin` SettingsPage, owner-only "danger zone")

Owner self-service only — this project has no billing integration and no
platform-admin auth (roadmap Phase 5 item 5), so there is no external
actor to trigger suspension. Billing-triggered suspension is deferred
until a real billing system exists to trigger it.

- **Suspend** — `POST /api/stores/me/suspend` (`requireStore`,
  `requireOwner`) sets `stores.status = 'suspended'` and, in the same
  batch, deletes **every session for the store** (all members, all
  devices) — not just the caller's own. This is required, not optional:
  without it, reactivating later would silently hand back every
  pre-suspension session with no re-authentication, and `requireStore`'s
  sliding-expiry refresh (which runs before this handler in the same
  request) could otherwise extend the very session being "shut down."
  Takes effect immediately — the request itself succeeds (the store was
  still active when `requireStore` admitted it), but every subsequent
  request is rejected, including from the session that just suspended it.
  There is no separate unsuspend endpoint, since no session survives
  suspension to call one — see "Login" above for how an owner reactivates.
- **Delete + export** — `DELETE /api/stores/me` (`requireStore`,
  `requireOwner`), body `{ confirm_name }` must exactly match the store's
  current name (400 otherwise) — a server-side safeguard independent of
  whatever client-side confirmation UI exists. On match: reads every
  store-scoped row, then hard-deletes all of it plus the `stores` row
  itself in one `db.batch` (no soft-delete/retention — no accounting/audit
  requirement exists for this project; revisit if a real pilot's
  accounting needs surface one). Response is `200 { data: { export: {...} } }`
  — the pre-deletion data **is** the response body (one key per table,
  `sessions`/`magic_link_tokens`/`seats.qr_token` excluded as secrets, not
  business data — `qr_token` is a bearer credential for the customer order
  API), produced atomically with the delete rather than via a separate
  export endpoint, so the frontend can offer it as a download in the same
  action.
- **What the export does not carry:** `subscriptions` (entitlement
  records, not the store's own data) and the shift-management tables.
  Both are deleted with everything else. Leaving schedules out is a
  deliberate v1 call rather than an oversight: a schedule is already
  exportable in a more useful shape from the builder's per-period CSV,
  and the delete path is a single ~25-statement batch whose response is
  the export body, so adding nine more tables to it should be driven by
  somebody actually asking. Revisit if a pilot store asks to take its
  scheduling history with it.
- Frontend: "一時停止" (suspend, `ConfirmDialog`) redirects to `/login`
  afterward (the session is about to stop working anyway — same reasoning
  as the logout-all button). "アカウントを削除" (delete) requires typing the
  store's exact name before its `ConfirmDialog` trigger enables (mirrors
  the Staff page's self/last-owner disable pattern: client-side
  convenience, the server's `confirm_name` check is the real guard); on
  confirm, downloads the response's `export` as a JSON file before
  redirecting, with the download attached to the document and the
  redirect delayed slightly so a same-tick navigation can't cancel it —
  this export is the owner's only copy of the data.

### Store settings — rename & email change (`apps/admin` SettingsPage)

- `PATCH /api/stores/me` (`requireStore`, `requireOwner`) updates the
  store's display name only; the slug is never regenerated (a stable
  identifier, not currently used by any feature).
- `POST /api/stores/me/email-change` (`requireStore`) changes the
  **calling member's own** login email — not `stores.email`. Any active
  member (owner or staff) can change their own email. Emails a passcode
  with `purpose = 'email_change'` to the **new** address, proving control
  before the change applies. Rejects 400 if the address equals the
  current one or is already registered to another member — the caller is
  authenticated here, so anti-enumeration doesn't apply (unlike
  `/api/auth/login`). Because that conflict check reveals whether an
  arbitrary address belongs to another member (across the whole
  `members.email` namespace, not just this store) and — unlike issuing a
  passcode — never touches `magic_link_tokens`, it has its own cap
  (`EMAIL_CHANGE_HOURLY_CAP`, `@yorozu/core` `domain/auth.ts`, 5/rolling
  hour) tracked on `members.email_change_attempt_count` /
  `email_change_window_started_at`, counted regardless of outcome
  (conflict or not) — `MAGIC_LINK_HOURLY_CAP` alone doesn't bound this
  path since a conflicting request never reaches token issuance. Past the
  cap: 429 `RATE_LIMITED`.
- `POST /api/stores/me/email-change/verify` (`requireStore`, body
  `{ code }`) applies the pending address to `members.email`. It is
  session-authenticated rather than keyed on a submitted email because the
  code went to an address not yet in `members.email` — there is nothing to
  resolve the member by. Requiring both a live session and the code is
  strictly stronger than the link it replaces, which proved only the
  latter. **No new session is issued** — the caller already has one, so the
  change lands on the settings screen rather than bouncing them through a
  redirect. Being authenticated, errors are specific: a UNIQUE-constraint
  race (the address claimed by another member after the code was issued)
  returns `VALIDATION_ERROR` with the same wording as the up-front
  conflict check, not a generic invalid-code response.
- `stores.email` itself has no edit path — it stays fixed at whatever
  address created the store, now purely historical/display. If a "store
  contact email" distinct from any member's login email is ever needed,
  that's a new field, not `stores.email` reused.
- `magic_link_tokens.purpose` includes `'email_change'` (and `'invite'`,
  above); a nullable `new_email` column holds the pending target address
  for `email_change` tokens only (see [domain-model.md](../domain-model.md)).

### Passcode caps (rate limiting)

- `issueVerificationCode` (`apps/api/src/auth.ts`) refuses to issue a code —
  returning `null` instead — once a **member** has reached
  `MAGIC_LINK_HOURLY_CAP` (5, `@yorozu/core` `domain/auth.ts`) issuances
  in the last rolling hour, across signup-resend, login, email-change,
  invite, and reactivate combined. Scoped per member (not per store): a
  store can
  have multiple members now, and two members issuing unrelated tokens
  (concurrent logins, or two simultaneous staff invites) must not
  invalidate each other's link. Callers (`POST /api/auth/login`,
  `POST /api/stores/me/email-change`) skip sending on `null` but return
  the exact same response as success — the anti-enumeration contract
  must not change shape when a member is rate-limited.
  `POST /api/stores` (initial signup) treats `null` as an issuance
  failure (compensating store+member row delete, 500) since a brand-new
  `member_id` can never realistically hit the cap. `POST /api/staff`
  (invite) has its own separate store-scoped cap — see "Staff management"
  above.
- Superseding the previous unused token for a member+purpose (so only
  one link is valid at a time) is done via `UPDATE ... SET used_at =
  now()`, not `DELETE` — the row must survive for the cap's count
  query to see it. `verify` already rejects any token with `used_at`
  set, so this changes nothing about which tokens are accepted.
- Complementary per-IP flood protection is Cloudflare WAF config, not
  Worker code — see
  [reference/deploy.md](../../reference/deploy.md).
- Known gaps (both accepted trade-offs, not oversights): concurrent
  requests can each pass the count check before any of their inserts
  commit, so a client firing many requests in parallel can exceed the
  cap (the original design explicitly accepts this — "an attacker
  squeezing 6 instead of 5 emails changes nothing" — but unbounded
  concurrency was not separately modeled); and the extra DB
  read/write on the "issued" path versus the single read on the
  "rate-limited" or "not-found" paths is a residual timing side
  channel that a sufficiently patient attacker could use to infer
  when a target has been rate-limited. Both are candidates for
  hardening if abuse is observed in practice.

### Dev conveniences

When `ENVIRONMENT === "development"` (explicit opt-in, never inferred),
signup/login/email-change/invite responses include the passcode as `code`
so local dev works without email delivery. The invite response also carries
`invite_url` — the plain admin login page the invitee is pointed at, which
holds no credential of its own.

## Known limitations (→ roadmap)

- **Passcodes are easier to deny than links were** — anyone who knows a
  member's address can burn their live code with 5 wrong guesses, and
  repeating that against re-sends reaches the hourly issuance cap, denying
  that member login for roughly an hour. A Magic Link had no equivalent
  surface: its token could not be guessed at, so a third party could not
  touch it. Accepted because it is targeted harassment only and self-heals
  within the hour, but it is a real regression against the previous design,
  not a neutral swap.
- **A live passcode is recoverable from the database plus the pepper** —
  six digits is a 10⁶ space, so the keyed HMAC is what makes a D1 read alone
  insufficient. Anyone holding both the data and `OTP_PEPPER` can brute-force
  a code. The 10-minute TTL, single use and attempt cap are what bound the
  exposure. Session tokens have no such property (they are UUIDs), so this is
  specific to passcodes.
- **No notification to the old email address on email change** — a
  hijacked session could silently redirect future login links to an
  attacker's inbox with no signal to the legitimate member. Deliberate
  v1 scope decision (proof of control of the *new* address is
  required; the old address is not). Hardening follow-up, tracked
  here — no roadmap phase assigned yet.
- **No billing-triggered suspension** — only owner self-service pause
  exists; there is no billing system or platform-admin actor to suspend a
  store externally. Revisit if/when a real billing integration exists.
- **Account deletion has no recovery path** — hard delete, no
  soft-delete/tombstone window, no notice to co-owners/staff before a
  single owner deletes the store. The response's JSON export is the only
  copy of the data once deleted. Acceptable for the current pre-launch
  scope (no real merchant data exists yet); revisit before a real pilot
  if this needs a grace period or co-owner confirmation.
- **Delete reads and deletes are not one atomic transaction** — the
  pre-delete export reads run before the destructive `db.batch`, not
  inside it. A row created for the store in that narrow window (e.g. a
  customer placing an order via `qr_token` at the exact moment of
  deletion) would be deleted without ever appearing in the export.
  Accepted trade-off given D1's batch API doesn't support reading
  batch-internal state to build a response.
