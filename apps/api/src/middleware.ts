import type { SeatSession, StoreSession } from "@yorozu/core";
import {
  buildSessionCookie,
  errorResponse,
  hashToken,
  now,
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_TOKEN_COOKIE,
  SESSION_TTL_MS,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import {
  deleteSession,
  getSeatByQrToken,
  getStoreBySession,
  isSecureRequest,
} from "./auth";

/**
 * Shared Hono environment type for admin-authenticated routes.
 * Extends Bindings with a Variables map that holds the resolved store session.
 */
export type AuthEnv = { Bindings: Env; Variables: { store: StoreSession } };

/**
 * Hono environment type for customer-facing order routes.
 * Extends Bindings with a Variables map that holds the resolved seat session.
 * The seat session includes both seat.id and seat.store_id so that every
 * DB query can apply a store_id filter without joining through orders.
 */
export type SeatEnv = { Bindings: Env; Variables: { seat: SeatSession } };

/**
 * Hono middleware that resolves the session_token cookie to a StoreSession.
 *
 * Rejects with 401 if:
 *   - the cookie is absent
 *   - the session does not exist or is expired (expired sessions are deleted)
 *   - the store is not in "active" status
 *
 * Sets c.var.store on success.
 *
 * Usage: router.use(requireStore) — applies to all subsequent handlers.
 */
export const requireStore = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_TOKEN_COOKIE)?.trim() ?? "";
  if (!token) {
    return errorResponse("UNAUTHORIZED", "Authentication required", 401);
  }

  const db = createDb(c.env.DB);
  const store = await getStoreBySession(db, token);

  if (!store) {
    // Session missing or expired — clean up if the token was a real (but expired) session.
    await deleteSession(db, token);
    return errorResponse("UNAUTHORIZED", "Authentication required", 401);
  }

  if (store.status !== "active" || store.member_status !== "active") {
    return errorResponse("UNAUTHORIZED", "Authentication required", 401);
  }

  // Sliding expiry: refresh expires_at/last_used_at, throttled to once per
  // SESSION_REFRESH_INTERVAL_MS so 5s-polling admin/order-board traffic
  // doesn't write on every single request. Must also re-send Set-Cookie:
  // the browser's cookie Max-Age is fixed at the value from the last
  // Set-Cookie response, so without resending it here the cookie would
  // still hard-expire 30 days after the *original* login regardless of
  // how fresh the server-side session row is — silently defeating the
  // whole point of sliding expiry.
  if (
    store.last_used_at === null ||
    now() - store.last_used_at >= SESSION_REFRESH_INTERVAL_MS
  ) {
    const ts = now();
    await db
      .update(schema.sessions)
      .set({ last_used_at: ts, expires_at: ts + SESSION_TTL_MS })
      .where(eq(schema.sessions.session_token, await hashToken(token)));

    const secure = isSecureRequest(c.req.url, c.env.ENVIRONMENT);
    const cookieDomain = c.env.COOKIE_DOMAIN || undefined;
    c.header(
      "Set-Cookie",
      buildSessionCookie(token, { secure, domain: cookieDomain }),
    );
  }

  c.set("store", store);
  await next();
});

/**
 * Hono middleware that restricts a route to owner-role members.
 * Must run after requireStore (reads c.var.store.role). Returns 403 for
 * a staff-role session.
 *
 * Usage: router.use(requireStore, requireOwner) or inline per-route after
 * requireStore, e.g. on storesRouter's PATCH /me (rename).
 */
export const requireOwner = createMiddleware<AuthEnv>(async (c, next) => {
  if (c.var.store.role !== "owner") {
    return errorResponse("FORBIDDEN", "Owner access required", 403);
  }
  await next();
});

/**
 * Hono middleware factory restricting a route to stores that subscribe to
 * `product`. Must run after requireStore (reads c.var.store.id).
 *
 * Returns 403 for a store without an active subscription — the same category
 * as requireOwner's role failure. 404 (the cross-tenant convention) would be
 * wrong here: the store, the session and the route all exist.
 *
 * Usage: new Hono<AuthEnv>().use(requireStore).use(requireEntitlement("shift"))
 */
export function requireEntitlement(product: "order" | "shift") {
  return createMiddleware<AuthEnv>(async (c, next) => {
    const db = createDb(c.env.DB);
    const rows = await db
      .select({ id: schema.subscriptions.id })
      .from(schema.subscriptions)
      .where(
        and(
          eq(schema.subscriptions.store_id, c.var.store.id),
          eq(schema.subscriptions.product, product),
          eq(schema.subscriptions.status, "active"),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return errorResponse(
        "FORBIDDEN",
        `The ${product} product is not enabled for this store`,
        403,
      );
    }

    await next();
  });
}

/**
 * Hono middleware that resolves the :seatToken URL parameter to a SeatSession.
 * Sets c.var.seat on success; returns 404 if the token is missing or invalid.
 *
 * Use as inline middleware on individual routes so the :seatToken path
 * parameter is guaranteed to be resolved before the middleware runs:
 *   router.get("/:seatToken", requireSeat, handler)
 *
 * Returns 404 (not 403) for unrecognised tokens to prevent cross-tenant
 * enumeration, consistent with the NOT_FOUND convention for other resources.
 */
export const requireSeat = createMiddleware<SeatEnv>(async (c, next) => {
  const seatToken = c.req.param("seatToken");
  if (!seatToken) {
    // seatToken param is absent — requireSeat must be used as inline per-route
    // middleware on a route that contains :seatToken, not as a global .use().
    return errorResponse(
      "INTERNAL_ERROR",
      "Server misconfiguration: seatToken route parameter missing",
      500,
    );
  }

  const seat = await getSeatByQrToken(createDb(c.env.DB), seatToken);
  if (!seat) {
    return errorResponse("NOT_FOUND", "Seat not found", 404);
  }

  c.set("seat", seat);
  await next();
});
