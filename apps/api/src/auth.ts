import type { SeatSession, StoreSession } from "@yorozu/core";
import {
  hashToken,
  MAGIC_LINK_HOURLY_CAP,
  MAGIC_LINK_TTL_MS,
  newId,
  now,
} from "@yorozu/core";
import type { Database } from "@yorozu/db";
import { schema } from "@yorozu/db";
import { and, eq, gt, isNull, ne } from "drizzle-orm";

const HOUR_MS = 60 * 60 * 1000;

/**
 * Whether the Set-Cookie Secure attribute should be set for this request.
 *
 * True over real HTTPS, or in any non-production environment — local dev is
 * treated as a secure context by browsers, and SameSite=None (required for
 * cross-origin cookie delivery) needs Secure to be honored at all, otherwise
 * the cookie is silently dropped. Gated on ENVIRONMENT rather than hostname
 * so it covers 127.0.0.1, devcontainer/LAN addresses, etc., not just
 * "localhost" literally.
 *
 * Deliberately fails toward `true` (unlike the `verify_url` dev-bypass gate,
 * which fails toward `false`): an unexpected ENVIRONMENT value here only
 * risks a harmless extra Secure attribute, never a leak.
 */
export function isSecureRequest(
  requestUrl: string,
  environment: string,
): boolean {
  return (
    new URL(requestUrl).protocol === "https:" || environment !== "production"
  );
}

/**
 * Issues a Magic Link token for the given member and purpose, or returns
 * null if the member has hit MAGIC_LINK_HOURLY_CAP issuances in the last
 * rolling hour (login, signup-resend, email-change, and invite combined) —
 * callers must treat null as "silently skip sending" and keep their
 * response identical to the success case (anti-enumeration; a visible 429
 * would leak that the email/member exists).
 *
 * Scoped per member_id (not store_id): a store can have multiple members
 * now, and two members of the same store issuing unrelated tokens (e.g.
 * concurrent logins, or two simultaneous staff invites) must not
 * invalidate each other's link.
 *
 * Supersedes (not deletes) any previous unused token for the same
 * member+purpose so only one link is valid at a time: consumed tokens are
 * already kept for audit, and `verify` already rejects any token with
 * `used_at` set, so marking a superseded token used is equally safe —
 * but unlike DELETE, the row (and its created_at) survives for the cap
 * count above to see.
 *
 * `newEmail` is required for purpose 'email_change' — it is the pending
 * target address, applied to members.email only once the token is verified.
 *
 * Insert-first ordering: the new token is written before old ones are
 * superseded so an UPDATE failure leaves two temporarily valid tokens
 * (harmless — the old one expires naturally) while an INSERT failure
 * leaves the old token intact.
 *
 * Only a SHA-256 hash of the token is persisted (`hashToken`) — the raw
 * value returned here is the one that goes into the email link and must
 * never be written to D1.
 */
export async function issueMagicLink(
  db: Database,
  storeId: string,
  memberId: string,
  purpose: "signup" | "login" | "email_change" | "invite" | "reactivate",
  newEmail?: string,
): Promise<string | null> {
  const ts = now();

  const recent = await db
    .select({ id: schema.magicLinkTokens.id })
    .from(schema.magicLinkTokens)
    .where(
      and(
        eq(schema.magicLinkTokens.member_id, memberId),
        gt(schema.magicLinkTokens.created_at, ts - HOUR_MS),
      ),
    )
    .limit(MAGIC_LINK_HOURLY_CAP);
  if (recent.length >= MAGIC_LINK_HOURLY_CAP) {
    console.log(`[auth] rate-limited magic link for member ${memberId}`);
    return null;
  }

  const token = newId();
  const tokenHash = await hashToken(token);
  const expires_at = ts + MAGIC_LINK_TTL_MS;

  await db.insert(schema.magicLinkTokens).values({
    id: newId(),
    store_id: storeId,
    member_id: memberId,
    token: tokenHash,
    purpose,
    new_email: newEmail ?? null,
    expires_at,
  });

  await db
    .update(schema.magicLinkTokens)
    .set({ used_at: ts })
    .where(
      and(
        eq(schema.magicLinkTokens.member_id, memberId),
        eq(schema.magicLinkTokens.purpose, purpose),
        isNull(schema.magicLinkTokens.used_at),
        ne(schema.magicLinkTokens.token, tokenHash),
      ),
    );

  return token;
}

/**
 * Looks up the store + member matching the given session token.
 *
 * Returns a StoreSession (plus the member's own status) or null when:
 *   - the token does not exist in the sessions table
 *   - the session has expired (expires_at <= now)
 *
 * Callers are responsible for enforcing stores.status === "active" and
 * member_status === "active". No code path today can mint a session for a
 * non-active member (GET /verify only creates one right after activating
 * it), but member_status is returned so requireStore can assert it
 * explicitly rather than relying on that invariant implicitly.
 * Expired sessions are NOT deleted here; callers should call deleteSession.
 */
export async function getStoreBySession(
  db: Database,
  token: string,
): Promise<
  | (StoreSession & {
      member_status: "pending" | "active";
      last_used_at: number | null;
    })
  | null
> {
  const tokenHash = await hashToken(token);
  const result = await db
    .select({
      id: schema.stores.id,
      name: schema.stores.name,
      status: schema.stores.status,
      member_id: schema.members.id,
      role: schema.members.role,
      member_status: schema.members.status,
      last_used_at: schema.sessions.last_used_at,
    })
    .from(schema.sessions)
    .innerJoin(schema.members, eq(schema.sessions.member_id, schema.members.id))
    .innerJoin(schema.stores, eq(schema.sessions.store_id, schema.stores.id))
    .where(
      and(
        eq(schema.sessions.session_token, tokenHash),
        gt(schema.sessions.expires_at, now()),
      ),
    )
    .limit(1);
  return result[0] ?? null;
}

/**
 * Deletes the session identified by the given token.
 * Used to clean up expired sessions or on logout.
 * Silently succeeds if the session does not exist.
 */
export async function deleteSession(
  db: Database,
  token: string,
): Promise<void> {
  const tokenHash = await hashToken(token);
  await db
    .delete(schema.sessions)
    .where(eq(schema.sessions.session_token, tokenHash));
}

/**
 * Looks up the seat matching the given qr_token.
 * Returns a SeatSession (id, store_id, name) or null if the token is
 * invalid OR the seat has been retired (is_active = false) — a retired
 * table's printed QR must 404 exactly like an unknown one.
 *
 * Selects only the columns needed — qr_token is never returned to callers.
 */
export async function getSeatByQrToken(
  db: Database,
  token: string,
): Promise<SeatSession | null> {
  const result = await db
    .select({
      id: schema.seats.id,
      store_id: schema.seats.store_id,
      name: schema.seats.name,
    })
    .from(schema.seats)
    .where(
      and(eq(schema.seats.qr_token, token), eq(schema.seats.is_active, true)),
    )
    .limit(1);
  return result[0] ?? null;
}
