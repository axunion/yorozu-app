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

Only a SHA-256 hash of the session token (`hashToken`, `@yorozu/core` `domain/auth.ts`) is
written to `sessions.session_token`. The same applies to `magic_link_tokens.token`. The raw
value lives solely in the client-facing cookie / email link and is hashed on every lookup
before comparison; a D1 read (backup export, console access, etc.) never yields a value that
could be replayed as a live session or Magic Link.

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

## Magic Link flow

Used for both new store registration (signup) and returning admin login.

```
[Signup SPA]  POST /api/stores { name, email }
                  └─▶ API creates store + magic_link_token, sends email
[Signup SPA]  navigate to /check-email (local SPA route)

[Email link]  GET /api/auth/verify?token=<token>
                  └─▶ API validates token, creates session, sets cookie
                  └─▶ 302 redirect to ADMIN_ORIGIN (e.g. https://admin.example.com)

[Admin SPA]   mounts, AdminGuard calls GET /api/auth/me
                  └─▶ API returns { id, name, email, role } — session valid
                  └─▶ AdminGuard provides StoreContext to child routes
```

The login flow is identical from the `POST /api/auth/login` step onward.
Since Phase 5 (staff accounts), a store's login identity is a **member**
row, not `stores.email` — `stores.email` is fixed at whatever address
created the store, purely historical/display. `email` in the flow above,
and everywhere else in this doc, means the calling **member's** email
unless stated otherwise. A store's first member (created at signup) is
always `role: 'owner'`; `POST /api/staff` (owner-only) invites additional
members with an `invite`-purpose Magic Link, reusing this same flow.

**Third purpose — email change**: `POST /api/stores/me/email-change`
(`requireStore`, any active member) issues a `magic_link_tokens` row with
`purpose = 'email_change'` and `new_email` set, and emails it to the
**new** address instead of the current one (proof of control before the
change applies). `GET /api/auth/verify` handles this purpose by setting
`members.email = new_email` (the calling member's own row) — right after
marking the token consumed, before session creation — then continues
through the same session-creation and redirect steps as signup/login. A
UNIQUE-constraint race (the address claimed by another member between
issuance and verify) falls back to the same generic `INVALID_TOKEN` 400
as any other invalid token, never a 500 or a distinguishing message.

**Fourth purpose — invite**: `POST /api/staff` (`requireStore`,
`requireOwner`) creates a `pending` member under the caller's store and
issues a `magic_link_tokens` row with `purpose = 'invite'`, emailed to
the invitee. `GET /api/auth/verify` handles this purpose by activating
only the member (`status: 'active'`) — the inviting store is already
active, unlike `signup` which activates both.

**Fifth purpose — reactivate**: `POST /api/stores/me/suspend`
(`requireStore`, `requireOwner`) sets `stores.status = 'suspended'` and
deletes every session for the store (all members) in the same
`db.batch` — required so reactivating doesn't silently hand back
pre-suspension sessions, and so the request's own sliding-expiry
refresh (which runs before the handler) can't extend the session being
shut down. There is no unsuspend endpoint; `POST /api/auth/login`
carves out an exception to the normal "suspended → silent" rule: an
owner-role member's login attempt on a suspended store issues a
`magic_link_tokens` row with `purpose = 'reactivate'` instead. A
staff-role member on a suspended store still gets silence — only an
owner can reactivate. `GET /api/auth/verify` handles `reactivate` by
setting `stores.status = 'active'` (the member is already active) and
continuing through the normal session-creation steps. This is a
deliberate exception to anti-enumeration (an owner login attempt now
takes a visibly different code path than the previous always-silent
one for a suspended store), accepted because it doesn't bypass any
billing/compliance gate — there is none in this project — see
[specs/features/authentication.md](../specs/features/authentication.md#account-lifecycle-appsadmin-settingspage-owner-only-danger-zone).

Account deletion (`DELETE /api/stores/me`, same file) is unrelated to
the Magic Link flow — it's a direct `requireStore`+`requireOwner`
action with a `confirm_name` body check, not a token-based flow, since
there's nothing to prove control of (the caller is already
authenticated as the store's owner).

**Key point**: The `verify` redirect must be an absolute URL (`c.env.ADMIN_ORIGIN`) because the
verify endpoint is served from `api.example.com`, not `admin.example.com`.

**Rate limiting**: `issueMagicLink` (`apps/api/src/auth.ts`) caps
issuance at `MAGIC_LINK_HOURLY_CAP` (5) per **member** per rolling hour,
combining signup-resend/login/email-change/invite/reactivate, and
returns `null` instead of a token once hit — every call site skips
sending but returns
its normal success response (anti-enumeration). Scoped per member (not
per store) because a store can have multiple members, and unrelated
members issuing tokens concurrently must not invalidate each other's
link. `POST /api/staff` (invite) additionally enforces its own
**store**-scoped cap of `MAGIC_LINK_HOURLY_CAP` invites/hour — the
per-member cap can't apply there since each invite is a brand-new member
with no prior history, so without a separate check an owner session
could mint unlimited invite emails. Superseding the previous unused
token per member+purpose is a `used_at` `UPDATE`, not a `DELETE`, so the
row survives for that count query. See
[specs/features/authentication.md](../specs/features/authentication.md#magic-link-issuance-cap-rate-limiting)
for the accepted concurrency/timing trade-offs. Complementary per-IP
WAF rate limiting is deploy config, not Worker code — see
[deploy.md](./deploy.md).

`POST /api/stores/me/email-change` has a third, independent cap
(`EMAIL_CHANGE_HOURLY_CAP`, tracked on `members.email_change_attempt_count`
/ `email_change_window_started_at`) bounding attempts regardless of
outcome — its "address already in use" conflict check never touches
`magic_link_tokens`, so the two caps above don't bound it. See
[specs/features/authentication.md](../specs/features/authentication.md#store-settings--rename--email-change-appsadmin-settingspage).

### Local dev: skipping email delivery

Resend delivery is implemented (`packages/core/src/domain/email.ts` calls the Resend REST
API when `RESEND_API_KEY` is set), but clicking a real email is unnecessary friction
during local development. Two fallbacks exist, gated by the `ENVIRONMENT` env var
(`"production"` in deployed environments; set to `"development"` in `apps/api/.dev.vars`
for local dev):

1. **Console fallback (always on, any environment)** — `sendMagicLinkEmail`
   (`packages/core/src/domain/email.ts`) logs the Magic Link URL to the Worker console
   instead of calling the Resend API whenever `RESEND_API_KEY` is unset.
2. **`verify_url` in the signup, login, email-change, and invite responses
   (`ENVIRONMENT === "development"` only)** — `POST /api/stores`,
   `POST /api/stores/me/email-change` (both `apps/api/src/routes/stores.ts`),
   `POST /api/auth/login` (`apps/api/src/routes/auth.ts`), and
   `POST /api/staff` (`apps/api/src/routes/staff.ts`) include the same Magic
   Link URL as `verify_url` in their JSON response whenever a token was
   actually issued. The signup SPA (`RegisterForm.tsx`) forwards it to
   `/check-email?verify_url=...`, and `CheckEmailPage.tsx` renders a `[DEV]`
   link that goes straight to `GET /api/auth/verify`. The admin `LoginForm.tsx`
   and `StoreSettings.tsx` render the same kind of `[DEV]` link inline after
   submitting — no console log copy/paste required either way. The check is
   an explicit opt-in (`=== "development"`, not `!== "production"`) so an
   unset or misconfigured `ENVIRONMENT` in some future deploy target never
   accidentally leaks the Magic Link.

`POST /api/auth/login`'s "always return 200 with an identical body regardless of whether the
email is registered" anti-enumeration contract (asserted in `apps/api/src/routes/auth.test.ts`)
is preserved **in production**, since `verify_url` is only ever added when
`ENVIRONMENT === "development"` — the response body is always identical in production
regardless of the email's existence. In dev, the field naturally reveals whether an account
exists (present only when a token was issued), which is an acceptable trade-off since dev-mode
is never exposed publicly.

---

## SPA route guard (admin)

Since the admin app has no SSR, page-level auth is enforced client-side by `AdminGuard.tsx`.
It calls `GET /api/auth/me` on every protected route mount:

- **401** → navigate to `/login` (replace history entry so Back does not loop)
- **200** → render children with `StoreContext.Provider` providing
  `{ id, name, email, role }` — `email` is the calling member's own login
  email (see Magic Link flow above), `role` is `'owner' | 'staff'`

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
| `RESEND_API_KEY` | `re_...` | Magic Link email delivery (secret) |
| `MAIL_FROM` | `noreply@example.com` | Magic Link `From` address |
| `ENVIRONMENT` | `production` / `development` | Gates the `verify_url` dev convenience — see [Local dev: skipping email delivery](#local-dev-skipping-email-delivery) |

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
