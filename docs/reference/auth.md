# Authentication

Cross-origin authentication design for the yorozu-app monorepo.

---

## Overview

The monorepo runs five separate origins:

| App | Domain (production) | Domain (local dev) |
|---|---|---|
| Admin SPA | `admin.example.com` | `localhost:5173` |
| Order SPA | `order.example.com` | `localhost:5174` |
| Signup SPA | `signup.example.com` | `localhost:5175` |
| Shift SPA | `shift.example.com` | `localhost:5176` |
| API Worker | `api.example.com` | `localhost:8787` |

Two authentication mechanisms are used:

1. **Session cookie** (`session_token`) — for admin and signup flows
2. **QR token URL parameter** (`qr_token`) — for the customer ordering screen

---

## Session cookie

### Storage at rest

Only a SHA-256 hash of the session token (`hashToken`, `@yorozu/core`
`domain/auth.ts`) is written to `sessions.session_token`. The raw value lives
solely in the client-facing cookie and is hashed on every lookup before
comparison; a D1 read (backup export, console access, etc.) never yields a
value that could be replayed as a live session. The token is a UUID, so there
is nothing to brute-force the digest back to.

Passcodes cannot rely on that — six digits *is* brute-forceable — so
`magic_link_tokens.token` uses a keyed HMAC instead. See
[Passcode storage at rest](#passcode-storage-at-rest).

### Attributes

```
Set-Cookie: session_token=<value>; HttpOnly; Secure; SameSite=None; Domain=.example.com; Max-Age=2592000
```

| Attribute | Value | Why |
|---|---|---|
| `HttpOnly` | — | Prevents JavaScript from reading the cookie |
| `Secure` | — | Required for `SameSite=None` to work |
| `SameSite=None` | — | Allows the cookie to be sent on cross-origin requests |
| `Domain=.example.com` | env var `COOKIE_DOMAIN` | Shared across all `*.example.com` subdomains |
| `Max-Age=2592000` | 30 days | Sliding — see below, not a fixed clock from login |

### Sliding expiry

`requireStore` (`apps/api/src/middleware.ts`) refreshes both the session
row (`sessions.expires_at`/`last_used_at`) and re-sends `Set-Cookie` with
a fresh `Max-Age=2592000` on every request where the session's
`last_used_at` is `null` or more than `SESSION_REFRESH_INTERVAL_MS` (1
hour, `@yorozu/core` `domain/auth.ts`) old. The throttle bounds the extra
D1 write (and cookie re-send) to at most once/hour of activity even
under 5s-polling admin/order-board traffic. **Both halves matter**: a
session is only durably logged out — by inactivity — after 30 days with
*no* refreshing request, because both the server-side row and the
browser's own cookie lifetime advance together. Refreshing only the DB
row (without re-sending `Set-Cookie`) would leave the browser's cookie on
its original 30-day clock from login regardless of activity, silently
defeating the feature. `POST /api/auth/logout-all` (below) is the
explicit-action path; sliding expiry is the inactivity path.

### CORS and CSRF

The API must allow credentials and enumerate each allowed origin explicitly (`*` is forbidden
when `Access-Control-Allow-Credentials: true`). This is a hand-written middleware
(`corsMiddleware`, `apps/api/src/app.ts`), not Hono's built-in `cors()` helper, because it also
has to defend against CSRF:

```ts
// apps/api/src/app.ts (shape, not verbatim)
const allowed = [
  env.ADMIN_ORIGIN,
  env.ORDER_ORIGIN,
  env.SIGNUP_ORIGIN,
  env.SHIFT_ORIGIN,
];
const origin = c.req.header("Origin") ?? "";
const isAllowedOrigin = allowed.includes(origin);

if (isAllowedOrigin) {
  // set Access-Control-Allow-Origin/Credentials/Methods/Headers, Vary: Origin
}
if (c.req.method === "OPTIONS") return c.body(null, 204);
if (origin && !isAllowedOrigin && STATE_CHANGING_METHODS.has(c.req.method)) {
  return c.body(null, 403); // CSRF guard, see below
}
```

CORS headers alone only control whether client-side JS can *read* a cross-origin response —
they don't stop the browser from *sending* the request in the first place (e.g. a hidden
cross-site form POST). Combined with `SameSite=None` (required below for cross-subdomain
cookie delivery), that gap would let a cross-site page trigger state-changing requests
(`POST`/`PUT`/`PATCH`/`DELETE`) with the victim's session cookie attached. The middleware
closes it by hard-rejecting (403) any such request whose `Origin` header is present but not
in the allowlist. A request with no `Origin` header at all (same-origin navigations,
non-browser clients, most test requests) is left to the route's own auth check instead of
being rejected here.

### Frontend fetch

All API calls from frontend SPAs must include credentials so the browser sends the cookie:

```ts
// packages/core/src/client/index.ts
fetch(url, { credentials: "include", ...init })
```

`apiFetch` and `jsonFetch` from `@yorozu/core/client` do this automatically.

---

## Passcode flow

Every purpose — signup, login, staff invite, email change and reactivation —
is verified by a 6-digit code emailed to the address being proved. There is no
`GET /api/auth/verify`; nothing in an email is a credential any more.

```
[Signup SPA]  POST /api/stores { name, email }
                  └─▶ API creates store + member + code, emails the code
[Signup SPA]  navigate to /check-email (local SPA route)
[Signup SPA]  POST /api/auth/verify-code { email, code }
                  └─▶ API activates, creates session, sets cookie
                  └─▶ 200 { redirect_to: ADMIN_ORIGIN }
[Signup SPA]  window.location.href = redirect_to

[Admin SPA]   mounts, AdminGuard calls GET /api/auth/me
                  └─▶ API returns { id, name, email, role } — session valid
```

Login is the same from `POST /api/auth/login` onward. A store's login identity
is a **member** row, not `stores.email` — that column is fixed at whatever
address created the store and is historical/display only. A store's first
member is always `role: 'owner'`; `POST /api/staff` (owner-only) invites more.

### Why codes rather than links

1. **The device that reads the mail is not always the device signing in.** A
   link puts the session wherever the mail was opened; an owner reading it on
   a phone could not use it to sign in on the shop's PC.
2. **Carrier mail filtering.** Japanese carrier domains routinely reject mail
   containing URLs.
3. **Link scanners.** Corporate mail security (Defender for Office 365 Safe
   Links, Proofpoint URL Defense) follows links before the recipient does,
   consuming a single-use credential.

It also closed a structural gap: `GET /verify` changed state (activating
stores, applying email changes, minting sessions) over a method the CSRF guard
in `apps/api/src/app.ts` does not cover. Verification is a `POST` now, so it
sits behind that guard like every other mutation.

### Passcode storage at rest

`magic_link_tokens.token` holds `hashOtpCode(rowId, code, OTP_PEPPER)` —
HMAC-SHA-256, not the bare `hashToken` used for sessions. Two reasons:

- **Keyed.** Six digits is 10⁶ possibilities; an unkeyed digest of one falls
  to brute force in well under a second, so a D1 backup export would hand an
  attacker every live passcode. The pepper is a Worker secret and lives
  outside the database, so reading D1 alone yields nothing to attack.
- **Salted with the row's own id.** Two rows can therefore never produce the
  same digest, which keeps the UNIQUE index on `token` intact. Salting on
  `member_id` instead would leave a 1-in-10⁶ chance of a member drawing a code
  they had used before, and that INSERT failure would surface as a login that
  silently never arrives.

Because the digest depends on the row id, a code **cannot be looked up
directly**. Verification resolves the member first, then tests each of their
live rows. That is also why the two verify routes are split by how the member
is identified (below).

### The two verify routes

| Route | Auth | Purposes | Member found by |
|---|---|---|---|
| `POST /api/auth/verify-code` `{ email, code, app? }` | none | signup, login, invite, reactivate | the submitted `email` |
| `POST /api/stores/me/email-change/verify` `{ code }` | `requireStore` | email_change | the caller's session |

`email_change` cannot use the first route: its code goes to the **new**
address, which is not yet in `members.email`, so there is nothing to resolve
the member by. Requiring a live session *and* the code is strictly stronger
than the link it replaces, which proved only the latter. Being authenticated,
it can also return specific errors, and it issues no new session — the change
lands on the settings screen instead of bouncing the caller through a redirect.

`email_change` rows are excluded from the unauthenticated route's lookup *and*
its attempt counter, so a pending email change cannot be burned by failed
login guesses.

### Where the browser goes next

`POST /verify-code` returns `redirect_to` rather than issuing a 302. The value
comes from `landingOrigin` — the same fixed env-backed map the old redirect
used, so it can never become an open redirect. It is returned rather than
followed because the signup SPA has to cross to the admin origin and does not
carry that URL in its own env; `app` (`"admin" | "shift"`) selects it, and
moved from `LoginInput` to `VerifyCodeInput` when the mail stopped carrying a
URL to aim.

### Invite is the one email with a link

`POST /api/staff` emails a code **and** a plain
`ADMIN_ORIGIN/login?email=<invitee>` URL. The invitee is the only recipient
with no screen already waiting for a code, so they need to be told where to
type it. That URL carries no credential: a scanner that follows it loads a
login form and consumes nothing. The admin login page reads `?email=` and
opens on the code step.

### Rate limiting — two independent axes

**Issuance.** `issueVerificationCode` (`apps/api/src/auth.ts`) caps issuance at
`MAGIC_LINK_HOURLY_CAP` (5) per **member** per rolling hour across all
purposes, returning `null` instead of a code once hit. Every call site then
skips sending but returns its normal success response (anti-enumeration).
Scoped per member because a store has several, and unrelated members must not
invalidate each other's code. Superseding an unused code is a `used_at`
UPDATE, not a DELETE, so the row survives for that count. `POST /api/staff`
additionally enforces a **store**-scoped cap, since each invite creates a
brand-new member with no history for the per-member cap to see.

**Verification (new with passcodes).** `OTP_MAX_ATTEMPTS` (5) failed attempts
consume a member's live codes. A 122-bit link needed no such limit; six digits
does.

Both routes **claim the attempt before comparing anything**, and only compare
the rows the claim returned:

```sql
UPDATE magic_link_tokens SET attempt_count = attempt_count + 1
WHERE <live codes for this member> AND attempt_count < 5
RETURNING id, token, ...
```

Reading the rows first and incrementing afterwards keeps the counter
consistent but does nothing about the limit it exists to enforce: D1 has no
transactions, so a burst of concurrent requests would all read the same live
row and each spend a free guess. Against a 10⁶ space that is the difference
between 25 tries an hour and as many as an attacker can open connections for.
Putting the `attempt_count <` predicate inside the UPDATE makes D1 serialize
them, so only the first `OTP_MAX_ATTEMPTS` requests get a row back to compare
at all. Rows that reach the limit are then consumed with `used_at`.

`POST /api/stores/me/email-change` keeps its own third cap
(`EMAIL_CHANGE_HOURLY_CAP`, tracked on `members.email_change_attempt_count`)
bounding attempts regardless of outcome: its "address already in use" check
never reaches issuance, so neither cap above bounds it.

Complementary per-IP WAF rate limiting is deploy config, not Worker code — see
[deploy.md](./deploy.md).

### Accepted trade-offs

- **Availability is lower than with links.** Anyone who knows a victim's
  address can burn their live code with 5 wrong guesses, and repeating that
  against re-sends reaches the hourly issuance cap — roughly an hour of denied
  login. A link had no such surface, since its token could not be guessed at.
  Targeted harassment only, and self-healing, but real.
- **A passcode is recoverable from a live database plus the pepper.** The
  pepper is what keeps a database read alone insufficient; anyone holding both
  can brute-force a 10⁶ space. TTL is 10 minutes, codes are single-use, and
  attempts are capped, which is what bounds the exposure.
- **Verification is a new surface keyed by email.** `POST /verify-code` takes
  an arbitrary address, which the old flow never did. A missing member spends
  one dummy `hashOtpCode` so the branch is not trivially cheaper, but that
  does **not** equalize the two: the registered path also makes a D1 write,
  which dominates an HMAC by orders of magnitude, so response time still
  distinguishes them. The defence that actually holds is the identical
  response body and status.
- **`OTP_PEPPER` strength is an operational property.** `hashOtpCode` only
  refuses an empty pepper; nothing checks that it is long or random. The
  at-rest argument above assumes the value follows the guidance in
  [deploy.md](./deploy.md).

### Local dev: skipping email delivery

Resend delivery is implemented (`packages/core/src/domain/email.ts` calls the
Resend REST API when `RESEND_API_KEY` is set), but reading a real inbox is
unnecessary friction locally. Two fallbacks exist, gated on `ENVIRONMENT`
(`"production"` in deployed environments; set to `"development"` in
`apps/api/.dev.vars`):

1. **Console fallback (any environment)** — `sendVerificationCodeEmail` logs
   the code to the Worker console whenever `RESEND_API_KEY` is unset.
2. **`code` in the response (`ENVIRONMENT === "development"` only)** —
   `POST /api/stores`, `POST /api/auth/login`, `POST /api/stores/me/email-change`
   and `POST /api/staff` include the passcode they just issued. Each SPA
   renders it as a `[DEV]` note beside the code input. The check is an explicit
   opt-in (`=== "development"`, not `!== "production"`) so an unset or
   misconfigured `ENVIRONMENT` in some future deploy target never leaks a code.

`POST /api/auth/login`'s "always return 200 with an identical body regardless
of whether the email is registered" contract (asserted in
`apps/api/src/routes/auth.test.ts`) holds **in production**, since `code` is
only ever added in development. In dev the field naturally reveals whether an
account exists, which is acceptable because dev mode is never public.
---

## SPA route guard (admin)

Since the admin app has no SSR, page-level auth is enforced client-side by `AdminGuard.tsx`.
It calls `GET /api/auth/me` on every protected route mount:

- **401** → navigate to `/login` (replace history entry so Back does not loop)
- **200** → render children with `StoreContext.Provider` providing
  `{ id, name, email, role }` — `email` is the calling member's own login
  email (see Passcode flow above), `role` is `'owner' | 'staff'`

`GET /api/auth/me` is a lightweight session check endpoint added for this purpose.

Child pages access the store info via `useStoreInfo()` (wraps `useContext(StoreContext)`).
`role` gates the Staff page's nav link (`DashboardPage.tsx`) client-side;
the real enforcement is server-side (`requireOwner` middleware).

### Logout

```ts
// apps/admin/src/layouts/AdminLayout.tsx
await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
navigate("/login");
```

`navigate("/login")` is used instead of relying on the server's redirect response. A
cross-origin 302 redirect to `SIGNUP_ORIGIN` would be followed by the browser transparently,
but that behavior is inconsistent across CORS preflight caching — using client-side navigation
is more predictable.

`POST /api/auth/logout-all` (Settings page, "log out everywhere" button)
deletes every session for the calling member (all of their own devices,
not other members') the same way; `StoreSettings.tsx` uses a hard
`window.location.href` redirect instead of `navigate()` for this one,
since that component is unit-tested standalone without a Router context.

---

## QR token flow (customer ordering)

The customer ordering screen authenticates via a `qr_token` embedded in the seat QR code URL:

```
https://order.example.com/<qr_token>
```

No session cookie is involved. Every API call for the order screen includes the token in the
path:

```
GET /api/order/<qr_token>           — bootstrap (seat + menu + current order)
POST /api/order/<qr_token>/items    — add items
PATCH /api/order/<qr_token>/request-payment
```

The `requireSeat` middleware in `apps/api` looks up the seat by `qr_token` and stores it on
the Hono context for downstream handlers.

**`credentials: "include"` is still sent** (from `apiFetch`), but the API ignores the cookie
for `/api/order/*` routes — they use `requireSeat` not `requireStore`.

---

## Required environment variables

### `apps/api` (wrangler.jsonc / .dev.vars)

| Variable | Example | Purpose |
|---|---|---|
| `ADMIN_ORIGIN` | `https://admin.example.com` | Default `verify`/`logout` redirect target; CORS allowlist |
| `ORDER_ORIGIN` | `https://order.example.com` | CORS allowlist |
| `SIGNUP_ORIGIN` | `https://signup.example.com` | CORS allowlist |
| `SHIFT_ORIGIN` | `https://shift.example.com` | `verify`/`logout` redirect target when the login carried `app: "shift"`; CORS allowlist |
| `COOKIE_DOMAIN` | `.example.com` | Cookie `Domain` attribute |
| `RESEND_API_KEY` | `re_...` | Passcode email delivery (secret) |
| `MAIL_FROM` | `noreply@example.com` | Passcode email `From` address |
| `ENVIRONMENT` | `production` / `development` | Gates the dev passcode echo — see [Local dev: skipping email delivery](#local-dev-skipping-email-delivery) |
| `OTP_PEPPER` | long random string | HMAC key for passcodes (secret). **Required** — issuance throws without it. Rotating it invalidates every outstanding code, which is harmless given the 10-minute TTL |

### Frontend SPAs (`.env` / wrangler.jsonc `[vars]`)

| Variable | Used by | Purpose |
|---|---|---|
| `VITE_API_BASE` | all SPAs | API base URL (e.g. `https://api.example.com`) |
| `VITE_ORDER_BASE` | admin SPA only | Order SPA base URL for QR code generation |

When `VITE_API_BASE` is unset, `apiFetch` sends relative requests (`/api/...`), which works
for local dev when a proxy forwards `/api/*` to the Wrangler dev server.

---

## Local development notes

`SameSite=None; Secure` requires HTTPS. For local development:

- Run all four servers on `localhost` with different ports. `localhost` is treated as a secure
  context by browsers, so cookies work without TLS.
- The cookie `Domain` attribute (`Domain=.example.com`) does **not** apply to `localhost` —
  the browser stores the cookie per `localhost` origin instead. This means cookie sharing
  across separate ports does not work with `Domain` set to `localhost`.
- **Workaround**: Set `COOKIE_DOMAIN` to an empty string (or omit it) in `wrangler.test.jsonc`
  and local `.dev.vars`, so the cookie is scoped to `localhost` without a `Domain` attribute.
  This is a local-only concern — production always uses `Domain=.example.com`.
