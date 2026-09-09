/**
 * Hashes a session or Magic Link token for storage at rest (SHA-256, hex).
 * Only the hash is ever persisted to D1; the raw token lives only in the
 * client-facing cookie / email link, so a DB read (backup export, console
 * access, etc.) never yields a value usable to impersonate a session.
 */
export async function hashToken(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Name of the HttpOnly cookie used to authenticate admin sessions. */
export const SESSION_TOKEN_COOKIE = "session_token";

/** Session lifetime: 30 days in milliseconds. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Minimum interval between sliding-expiry refreshes of a session's
 * `expires_at`/`last_used_at`. Bounds the extra D1 write to once/hour per
 * session even under 5s-polling admin/order-board traffic, rather than
 * writing on every single request.
 */
export const SESSION_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

/** Number of digits in an emailed one-time passcode. */
export const OTP_CODE_LENGTH = 6;

/**
 * One-time passcode lifetime: 10 minutes in milliseconds.
 *
 * Shorter than the 15 minutes the Magic Link used, because a 6-digit code is
 * guessable in a way a 122-bit UUID is not — but not so short that Resend's
 * delivery latency or a receiving server's greylisting eats the whole window.
 */
export const OTP_TTL_MS = 10 * 60 * 1000;

/**
 * Verification attempts allowed against a member's live passcodes before they
 * are consumed. Bounds online guessing to OTP_MAX_ATTEMPTS * the issuance cap
 * (25 tries per member per hour) against a 10^6 space.
 *
 * Distinct from MAGIC_LINK_HOURLY_CAP, which caps *issuance* and does nothing
 * to stop an attacker guessing at a code that has already been sent.
 */
export const OTP_MAX_ATTEMPTS = 5;

/**
 * Generates a uniformly random passcode of OTP_CODE_LENGTH digits, keeping
 * any leading zeros.
 *
 * Rejection sampling, not `% max` on a raw uint32: 2^32 is not a multiple of
 * 10^6, so the plain modulo would make the lowest ~4967 codes slightly more
 * likely than the rest. The bias is small but free to avoid, and this value
 * is an authentication secret.
 */
export function generateOtpCode(): string {
  const max = 10 ** OTP_CODE_LENGTH;
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  let value = limit;
  while (value >= limit) {
    crypto.getRandomValues(buf);
    // buf[0] cannot actually be undefined; falling back to `limit` retries
    // rather than letting noUncheckedIndexedAccess push us to a fixed code.
    value = buf[0] ?? limit;
  }
  return String(value % max).padStart(OTP_CODE_LENGTH, "0");
}

/**
 * Derives the value stored in `magic_link_tokens.token` for a passcode.
 *
 * HMAC keyed on a Worker secret (`OTP_PEPPER`), not a bare SHA-256 like
 * `hashToken`. A 6-digit code only has 10^6 possibilities, so an unkeyed
 * digest of one is reversible by brute force in well under a second — a D1
 * backup export would hand an attacker every live passcode. The pepper lives
 * outside the database, so reading D1 alone yields nothing to brute-force
 * against.
 *
 * `rowId` (the token row's own primary key) is mixed in so two rows never
 * share a digest, which keeps the UNIQUE index on `token` intact: without it,
 * a member drawing the same 6-digit code twice would fail the INSERT.
 *
 * Throws when the pepper is missing rather than falling back to an unkeyed
 * hash — a silent downgrade here would be invisible in production.
 */
export async function hashOtpCode(
  rowId: string,
  code: string,
  pepper: string,
): Promise<string> {
  if (!pepper) {
    throw new Error("OTP_PEPPER is not configured");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${rowId}:${code}`),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Max Magic Link tokens issued per member per rolling hour (login,
 * signup-resend, email-change, and invite combined). Protects the Resend
 * quota and a victim's inbox from abuse. Issuance beyond the cap is
 * silently skipped — the anti-enumeration response contract must not
 * change.
 */
export const MAGIC_LINK_HOURLY_CAP = 5;

/**
 * Max POST /me/email-change attempts per member per rolling hour, counted
 * regardless of outcome (including "new_email already in use" conflicts).
 * Bounds using the endpoint as an oracle to probe whether an arbitrary
 * email belongs to some other member — MAGIC_LINK_HOURLY_CAP alone doesn't
 * cover this, since a conflicting request never reaches token issuance.
 */
export const EMAIL_CHANGE_HOURLY_CAP = 5;

/** Rolling window size for EMAIL_CHANGE_HOURLY_CAP, in milliseconds. */
export const EMAIL_CHANGE_WINDOW_MS = 60 * 60 * 1000;

/** API path (no origin) that verifies a Magic Link token. */
export const MAGIC_LINK_VERIFY_PATH = "/api/auth/verify";

/**
 * Minimum store + member fields needed for authentication.
 * Includes status so that API middleware can enforce the active-only invariant.
 * member_id/role identify the logged-in member for requireOwner and
 * member-scoped operations (email change, logout-all, session ownership).
 */
export type StoreSession = {
  id: string;
  name: string;
  status: "pending" | "active" | "suspended";
  member_id: string;
  role: "owner" | "staff";
};

/**
 * Minimum seat fields needed to identify the seat and its owning store.
 * Used by the customer order screen to resolve a qr_token URL parameter.
 */
export type SeatSession = {
  id: string;
  store_id: string;
  name: string;
};

/**
 * Builds a Set-Cookie header value for the admin session token.
 *
 * Cross-origin deployment note:
 *   The admin SPA and the API run on separate subdomains (e.g. admin.example.com
 *   and api.example.com). SameSite=None is required to allow the browser to send
 *   the cookie across origins. SameSite=None REQUIRES Secure=true (HTTPS), so
 *   always pass secure=true in production. Local dev typically runs on HTTP so
 *   set secure=false and use a workaround (same port proxy or --local-protocol https).
 *
 *   Pass domain=".example.com" to share the cookie across all subdomains.
 *   In local dev, omit domain so the cookie is scoped to localhost only.
 *
 * Attributes:
 *  - HttpOnly: prevents JS access (XSS mitigation)
 *  - SameSite=None: required for cross-origin fetch with credentials
 *  - Path=/: cookie sent for all paths
 *  - Max-Age: explicit 30-day expiry so the cookie survives browser restarts
 *  - Secure: required with SameSite=None (HTTPS only)
 *  - Domain: optional; set to parent domain to share across subdomains
 */
export function buildSessionCookie(
  token: string,
  options: { secure?: boolean; domain?: string } = {},
): string {
  return buildCookieHeader(token, Math.floor(SESSION_TTL_MS / 1000), options);
}

/**
 * Builds a Set-Cookie header value that clears the admin session token.
 * Sets Max-Age=0 so the browser immediately deletes the cookie.
 */
export function buildClearSessionCookie(
  options: { secure?: boolean; domain?: string } = {},
): string {
  return buildCookieHeader("", 0, options);
}

function buildCookieHeader(
  token: string,
  maxAge: number,
  options: { secure?: boolean; domain?: string } = {},
): string {
  const { secure = false, domain } = options;
  const parts = [
    `${SESSION_TOKEN_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=None",
    "Path=/",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}
