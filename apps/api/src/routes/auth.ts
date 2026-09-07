import {
  buildClearSessionCookie,
  buildSessionCookie,
  errorResponse,
  hashToken,
  LoginInput,
  MAGIC_LINK_VERIFY_PATH,
  newId,
  now,
  SESSION_TOKEN_COOKIE,
  SESSION_TTL_MS,
  sendMagicLinkEmail,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { deleteSession, isSecureRequest, issueMagicLink } from "../auth";
import { requireStore } from "../middleware";
import { bodyValidator } from "../validator";

/**
 * Maps the `app` query parameter to the SPA origin the Magic Link should land
 * in. A fixed env-backed allowlist rather than a caller-supplied URL, so this
 * can never become an open redirect; anything unrecognised lands on admin.
 */
function landingOrigin(env: Env, app: string | undefined): string {
  return app === "shift" && env.SHIFT_ORIGIN
    ? env.SHIFT_ORIGIN
    : env.ADMIN_ORIGIN;
}

export const authRouter = new Hono<{ Bindings: Env }>()
  /**
   * GET /api/auth/me
   * Returns the authenticated store's id, name, the calling member's own
   * email, and their role.
   * Used by the admin SPA on initial load to resolve the session (and by
   * SettingsPage to show the current email without a second endpoint).
   * Returns 401 if not authenticated or session has expired.
   */
  .get("/me", requireStore, async (c) => {
    const { id, name, member_id, role } = c.var.store;
    const db = createDb(c.env.DB);
    const rows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, member_id))
      .limit(1);
    return c.json({ data: { id, name, email: rows[0]?.email ?? "", role } });
  })

  /**
   * GET /api/auth/verify?token=<token>
   *
   * Verifies a Magic Link token (signup or login).
   * On success: marks the token used, activates the store if signing up,
   * creates a session, sets the session_token cookie, and redirects to
   * c.env.ADMIN_ORIGIN (absolute URL — required for cross-origin deployment).
   *
   * All failure modes return the same INVALID_TOKEN error to prevent
   * enumeration attacks (no information about whether the token ever existed).
   */
  .get("/verify", async (c) => {
    const token = c.req.query("token")?.trim() ?? "";
    if (!token) {
      return errorResponse("INVALID_TOKEN", "Invalid or expired link", 400);
    }

    const db = createDb(c.env.DB);
    const ts = now();
    const tokenHash = await hashToken(token);

    // Look up the token — must be unused and not expired.
    const rows = await db
      .select({
        id: schema.magicLinkTokens.id,
        store_id: schema.magicLinkTokens.store_id,
        member_id: schema.magicLinkTokens.member_id,
        purpose: schema.magicLinkTokens.purpose,
        new_email: schema.magicLinkTokens.new_email,
      })
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.token, tokenHash),
          isNull(schema.magicLinkTokens.used_at),
          gt(schema.magicLinkTokens.expires_at, ts),
        ),
      )
      .limit(1);

    const linkToken = rows[0];

    if (!linkToken) {
      return errorResponse("INVALID_TOKEN", "Invalid or expired link", 400);
    }

    // Mark the token as consumed (kept for audit trail, not deleted).
    await db
      .update(schema.magicLinkTokens)
      .set({ used_at: ts })
      .where(eq(schema.magicLinkTokens.id, linkToken.id));

    // For signup tokens, transition both the store and the (owner) member
    // to active.
    if (linkToken.purpose === "signup") {
      await db
        .update(schema.stores)
        .set({ status: "active", activated_at: ts })
        .where(eq(schema.stores.id, linkToken.store_id));
      await db
        .update(schema.members)
        .set({ status: "active", activated_at: ts })
        .where(eq(schema.members.id, linkToken.member_id));
    }

    // For invite tokens, the store is already active — only the new staff
    // member transitions to active.
    if (linkToken.purpose === "invite") {
      await db
        .update(schema.members)
        .set({ status: "active", activated_at: ts })
        .where(eq(schema.members.id, linkToken.member_id));
    }

    // For reactivate tokens, the owner is already active — only the
    // suspended store transitions back to active.
    if (linkToken.purpose === "reactivate") {
      await db
        .update(schema.stores)
        .set({ status: "active" })
        .where(eq(schema.stores.id, linkToken.store_id));
    }

    // For email_change tokens, apply the pending address now that the
    // member has proven control of it. A UNIQUE race (the address was
    // claimed by another member after this token was issued) fails
    // generically — the token is already consumed, so the member must
    // re-request the change.
    if (linkToken.purpose === "email_change") {
      if (!linkToken.new_email) {
        return errorResponse("INVALID_TOKEN", "Invalid or expired link", 400);
      }
      try {
        await db
          .update(schema.members)
          .set({ email: linkToken.new_email })
          .where(eq(schema.members.id, linkToken.member_id));
      } catch {
        return errorResponse("INVALID_TOKEN", "Invalid or expired link", 400);
      }
    }

    // Create a new session.
    const sessionToken = newId();
    await db.insert(schema.sessions).values({
      id: newId(),
      store_id: linkToken.store_id,
      member_id: linkToken.member_id,
      session_token: await hashToken(sessionToken),
      expires_at: ts + SESSION_TTL_MS,
    });

    const secure = isSecureRequest(c.req.url, c.env.ENVIRONMENT);
    const cookieDomain = c.env.COOKIE_DOMAIN || undefined;
    c.header(
      "Set-Cookie",
      buildSessionCookie(sessionToken, { secure, domain: cookieDomain }),
    );
    // Absolute URL required for cross-origin deploy. The target comes from a
    // fixed env-backed map, never from a caller-supplied URL, so there is no
    // open-redirect surface: an unknown or missing value lands on admin.
    return c.redirect(landingOrigin(c.env, c.req.query("app")), 302);
  })

  /**
   * POST /api/auth/login
   *
   * Sends a Magic Link to the given email address.
   * Always returns 200 with the same message regardless of whether the email
   * is registered, to prevent email enumeration.
   *
   * Behaviour per member/store status:
   *   member active, store active            → sends a "login" Magic Link
   *   member pending, role owner              → resends the "signup" Magic Link
   *   member pending, role staff              → resends the "invite" Magic Link
   *   member active, store suspended, owner   → sends a "reactivate" Magic Link
   *   member active, store suspended, staff   → silent (only an owner can reactivate)
   * A pending member's signup/invite resend is unaffected by the store's
   * suspended status — completing an invite doesn't grant any access
   * (requireStore still blocks on store.status), so there's no reason to
   * also lock down onboarding; only an already-active owner can reactivate.
   */
  .post("/login", bodyValidator(LoginInput), async (c) => {
    const { email, app: targetApp } = c.req.valid("json");
    const db = createDb(c.env.DB);

    const rows = await db
      .select({
        member_id: schema.members.id,
        store_id: schema.members.store_id,
        role: schema.members.role,
        member_status: schema.members.status,
        store_status: schema.stores.status,
      })
      .from(schema.members)
      .innerJoin(schema.stores, eq(schema.members.store_id, schema.stores.id))
      .where(eq(schema.members.email, email))
      .limit(1);

    const member = rows[0];
    let magicLinkUrl: string | undefined;

    // null means "stay silent" (an active staff member on a suspended
    // store — only an active owner may reactivate).
    const purpose = member
      ? member.store_status === "suspended" && member.member_status === "active"
        ? member.role === "owner"
          ? "reactivate"
          : null
        : member.member_status === "active"
          ? "login"
          : member.role === "owner"
            ? "signup"
            : "invite"
      : null;

    if (member && purpose) {
      try {
        const token = await issueMagicLink(
          db,
          member.store_id,
          member.member_id,
          purpose,
        );
        // null means the store hit MAGIC_LINK_HOURLY_CAP — skip sending but
        // keep the response identical to the success case (anti-enumeration).
        if (token) {
          // Magic Link verify URL is always on the API origin.
          const baseUrl = new URL(c.req.url).origin;
          magicLinkUrl = `${baseUrl}${MAGIC_LINK_VERIFY_PATH}?token=${token}&app=${targetApp}`;

          // Defer email delivery so its latency is not observable to the caller.
          // Without this, response time reveals whether the email address is registered.
          const emailPromise = sendMagicLinkEmail(
            { to: email, magicLinkUrl, purpose },
            {
              resendApiKey: c.env.RESEND_API_KEY,
              mailFrom: c.env.MAIL_FROM,
            },
          ).catch(() => {
            console.error(
              `[auth/login] Email delivery failed for member ${member.member_id}`,
            );
          });
          if (c.executionCtx?.waitUntil) {
            c.executionCtx.waitUntil(emailPromise);
          } else {
            await emailPromise;
          }
        }
      } catch {
        // Silent failure — the "always 200" contract must hold even if token
        // issuance fails (e.g., transient D1 error).
        console.error(
          `[auth/login] Magic link issuance failed for member ${member.member_id}`,
        );
      }
    }

    // Always return 200 regardless of email existence. In dev
    // (ENVIRONMENT === "development") only, include verify_url when a token
    // was actually issued — production always returns the identical body.
    // Checked as an explicit opt-in (not "!== production") so an unset or
    // misconfigured ENVIRONMENT never accidentally leaks the Magic Link.
    const isDev = c.env.ENVIRONMENT === "development";
    return c.json({
      data: {
        sent: true,
        ...(isDev && magicLinkUrl && { verify_url: magicLinkUrl }),
      },
    });
  })

  /**
   * POST /api/auth/logout
   *
   * Deletes the current session and clears the cookie.
   * Only the session identified by the current cookie is removed;
   * sessions on other devices remain active.
   * Redirects to the signup SPA (which hosts the login form).
   */
  .post("/logout", async (c) => {
    const token = getCookie(c, SESSION_TOKEN_COOKIE)?.trim() ?? "";
    if (token) {
      const db = createDb(c.env.DB);
      await deleteSession(db, token);
    }

    const secure = isSecureRequest(c.req.url, c.env.ENVIRONMENT);
    const cookieDomain = c.env.COOKIE_DOMAIN || undefined;
    c.header(
      "Set-Cookie",
      buildClearSessionCookie({ secure, domain: cookieDomain }),
    );
    // Back to the login page of whichever SPA the caller logged out from.
    return c.redirect(`${landingOrigin(c.env, c.req.query("app"))}/login`, 302);
  })

  /**
   * POST /api/auth/logout-all
   *
   * Deletes every session belonging to the calling member (all of their
   * own devices), then clears the cookie same as /logout. Scoped to the
   * caller's own member_id only — does not affect other members of the
   * same store.
   */
  .post("/logout-all", requireStore, async (c) => {
    const { member_id: memberId } = c.var.store;
    const db = createDb(c.env.DB);
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.member_id, memberId));

    const secure = isSecureRequest(c.req.url, c.env.ENVIRONMENT);
    const cookieDomain = c.env.COOKIE_DOMAIN || undefined;
    c.header(
      "Set-Cookie",
      buildClearSessionCookie({ secure, domain: cookieDomain }),
    );
    return c.redirect(`${landingOrigin(c.env, c.req.query("app"))}/login`, 302);
  });
