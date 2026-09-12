import type { SeatSession, StoreSession } from "@yorozu/core";
import {
  generateOtpCode,
  hashOtpCode,
  hashToken,
  MAGIC_LINK_HOURLY_CAP,
  newId,
  now,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MS,
} from "@yorozu/core";
import type { Database } from "@yorozu/db";
import { schema } from "@yorozu/db";
import type { SQL } from "drizzle-orm";
import { and, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";

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
 * Deliberately fails toward `true` (unlike the dev passcode-echo gate,
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
 * Issues an emailed passcode for the given member and purpose, or returns
 * null when the member has hit MAGIC_LINK_HOURLY_CAP issuances in the last
 * rolling hour. Callers must treat null as "skip sending" and keep their
 * response identical to the success case — a visible 429 would leak that the
 * address belongs to someone.
 *
 * Rows live in `magic_link_tokens`, which kept its name through the move off
 * Magic Links: renaming it would touch every query and migration for no
 * behavioural gain. The stored value is `hashOtpCode(rowId, code, pepper)`
 * rather than the `hashToken(uuid)` that table used to hold:
 *
 *  - keyed on the pepper, because a 6-digit code has 10^6 possibilities and
 *    an unkeyed digest of one falls to brute force from a database read;
 *  - salted with the row's own id, so two rows can never produce the same
 *    digest and the UNIQUE index on `token` still holds. Salting on
 *    `member_id` instead would leave a 1-in-10^6 chance of one member drawing
 *    a code they have used before, and that INSERT failure would surface as a
 *    login that silently never arrives.
 *
 * Because the digest depends on the row id, verification cannot look a code
 * up directly — it resolves the member first, then tests the candidate rows.
 * See `POST /api/auth/verify-code`.
 *
 * Insert-first ordering: the new row is written before the old ones are
 * superseded, so an UPDATE failure leaves two briefly valid codes (harmless —
 * both expire), while an INSERT failure leaves the previous one intact.
 */
export async function issueVerificationCode(
  db: Database,
  storeId: string,
  memberId: string,
  purpose: "signup" | "login" | "email_change" | "invite" | "reactivate",
  pepper: string,
  newEmail?: string,
): Promise<string | null> {
  const ts = now();

  const recent = await db
    .select({ id: schema.magicLinkTokens.id })
    .from(schema.magicLinkTokens)
    .where(
      and(
        eq(schema.magicLinkTokens.store_id, storeId),
        eq(schema.magicLinkTokens.member_id, memberId),
        gt(schema.magicLinkTokens.created_at, ts - HOUR_MS),
      ),
    )
    .limit(MAGIC_LINK_HOURLY_CAP);
  if (recent.length >= MAGIC_LINK_HOURLY_CAP) {
    console.log(`[auth] rate-limited passcode for member ${memberId}`);
    return null;
  }

  const rowId = newId();
  const code = generateOtpCode();

  await db.insert(schema.magicLinkTokens).values({
    id: rowId,
    store_id: storeId,
    member_id: memberId,
    token: await hashOtpCode(rowId, code, pepper),
    purpose,
    new_email: newEmail ?? null,
    expires_at: ts + OTP_TTL_MS,
  });

  await db
    .update(schema.magicLinkTokens)
    .set({ used_at: ts })
    .where(
      and(
        eq(schema.magicLinkTokens.store_id, storeId),
        eq(schema.magicLinkTokens.member_id, memberId),
        eq(schema.magicLinkTokens.purpose, purpose),
        isNull(schema.magicLinkTokens.used_at),
        ne(schema.magicLinkTokens.id, rowId),
      ),
    );

  return code;
}

/**
 * Claims one verification attempt against the live rows matching `scope`, and
 * consumes and returns the row whose digest is `code` — or undefined when none
 * matches, none is left, or the attempt budget is spent.
 *
 * `scope` is the caller's alone: which member, store and purpose the code has
 * to belong to. Everything that makes a row *redeemable* — unused, unexpired,
 * still inside the attempt budget — is this function's, so a third caller
 * cannot weaken the contract by forgetting a predicate.
 *
 * The attempt is claimed *before* anything is compared, and only rows this
 * statement returned are compared. Selecting first and incrementing after
 * would keep the counter consistent while doing nothing about the limit it
 * exists to enforce: a burst of concurrent requests would all read the same
 * live row and each get a free guess, which against a 10^6 space is the
 * difference between OTP_MAX_ATTEMPTS an hour and as many as the attacker can
 * open connections for. Putting `attempt_count < OTP_MAX_ATTEMPTS` inside the
 * UPDATE makes D1 serialize them, so only the first OTP_MAX_ATTEMPTS get a
 * row back at all.
 *
 * On a miss, rows that just reached the limit are consumed, so they cannot be
 * retried once the `attempt_count <` predicate stops matching them.
 *
 * Consuming the match belongs here rather than to the caller, for the same
 * reason the claim does: `used_at IS NULL` sits inside the consuming UPDATE
 * and its row count decides the redemption, so two requests carrying the same
 * correct code cannot both be told they redeemed it. A caller setting
 * `used_at` by id afterwards would be re-testing a condition it had already
 * passed, and both would mint a session.
 *
 * Every write here re-states `scope` rather than addressing rows by the id it
 * just read. The ids are already tenant-verified, so this changes no outcome
 * today; it keeps the tenant predicate a property of each statement instead of
 * an invariant a later edit could quietly break.
 *
 * Shared by the two verify routes rather than written in each: they differ in
 * how they scope candidates and what they do with a match, but this sequence
 * is the attempt limit itself, and a fix to it has to reach both.
 */
export async function redeemCode(
  db: Database,
  scope: SQL | undefined,
  code: string,
  pepper: string,
  ts: number,
) {
  // `and()` is typed `SQL | undefined`, so a caller assembling its predicates
  // conditionally can land on undefined — which would drop the WHERE clause
  // entirely and burn an attempt against every live passcode in every store.
  // Refused rather than defaulted, on the same reasoning as hashOtpCode's
  // missing pepper: a silent loss of scoping here is invisible in production.
  if (!scope) {
    throw new Error("redeemCode called without a scope");
  }

  const redeemable = and(
    scope,
    isNull(schema.magicLinkTokens.used_at),
    gt(schema.magicLinkTokens.expires_at, ts),
  );

  const candidates = await db
    .update(schema.magicLinkTokens)
    .set({ attempt_count: sql`${schema.magicLinkTokens.attempt_count} + 1` })
    .where(
      and(
        redeemable,
        lt(schema.magicLinkTokens.attempt_count, OTP_MAX_ATTEMPTS),
      ),
    )
    .returning({
      id: schema.magicLinkTokens.id,
      token: schema.magicLinkTokens.token,
      purpose: schema.magicLinkTokens.purpose,
      store_id: schema.magicLinkTokens.store_id,
      new_email: schema.magicLinkTokens.new_email,
      attempt_count: schema.magicLinkTokens.attempt_count,
    });

  for (const row of candidates) {
    if ((await hashOtpCode(row.id, code, pepper)) !== row.token) continue;
    const consumed = await db
      .update(schema.magicLinkTokens)
      .set({ used_at: ts })
      .where(and(redeemable, eq(schema.magicLinkTokens.id, row.id)))
      .returning({ id: schema.magicLinkTokens.id });
    // Empty means another request holding the same code consumed the row
    // between this one claiming its attempt and reaching here. It was a valid
    // code, but it is spent now, so the loser is told the same as any miss.
    return consumed.length > 0 ? row : undefined;
  }

  const exhausted = candidates
    .filter((row) => row.attempt_count >= OTP_MAX_ATTEMPTS)
    .map((row) => row.id);
  if (exhausted.length > 0) {
    await db
      .update(schema.magicLinkTokens)
      .set({ used_at: ts })
      .where(and(redeemable, inArray(schema.magicLinkTokens.id, exhausted)));
  }

  return undefined;
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
 * non-active member (the verify-code routes only create one right after
 * activating it), but member_status is returned so requireStore can assert
 * it explicitly rather than relying on that invariant implicitly.
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
