import {
  buildClearSessionCookie,
  buildSessionCookie,
  errorResponse,
  hashOtpCode,
  hashToken,
  LoginInput,
  newId,
  now,
  SESSION_TOKEN_COOKIE,
  SESSION_TTL_MS,
  sendVerificationCodeEmail,
  VerifyCodeInput,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  claimCodeAttempt,
  deleteSession,
  isSecureRequest,
  issueVerificationCode,
} from "../auth";
import { requireStore } from "../middleware";
import { bodyValidator } from "../validator";

/**
 * Maps the caller's `app` to the SPA origin a verified session should land
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
   * POST /api/auth/verify-code
   *
   * Verifies an emailed passcode and creates a session, replacing the browser
   * navigation the Magic Link flow used. Handles signup / login / reactivate /
   * invite.
   *
   * `email_change` is deliberately out of scope: its code is sent to the *new*
   * address, which is not yet in members.email, so the member cannot be
   * resolved from the submitted email. That flow verifies against the caller's
   * session at POST /api/stores/me/email-change/verify instead. Its rows are
   * excluded from both the candidate lookup and the attempt counter below, so
   * a pending email change cannot be burned through this endpoint.
   *
   * Codes cannot be looked up directly: the stored digest is salted with the
   * token row's own id (see issueVerificationCode), so this resolves the
   * member first and then tests each of their live rows.
   *
   * Every failure returns the same INVALID_CODE — an unknown address, no live
   * code, a wrong code and an exhausted attempt budget must be
   * indistinguishable, or the response reveals which addresses are registered
   * and which have a code outstanding.
   */
  .post("/verify-code", bodyValidator(VerifyCodeInput), async (c) => {
    const { email, code, app: targetApp } = c.req.valid("json");
    const db = createDb(c.env.DB);
    const ts = now();
    const pepper = c.env.OTP_PEPPER;
    const invalidCode = () =>
      errorResponse("INVALID_CODE", "Invalid or expired code", 400);

    const memberRows = await db
      .select({ id: schema.members.id, store_id: schema.members.store_id })
      .from(schema.members)
      .where(eq(schema.members.email, email))
      .limit(1);
    const member = memberRows[0];

    if (!member) {
      // Spend one hash so the work done here is not trivially smaller than the
      // registered path. It does not equalize the two — the registered path
      // also makes a D1 write, which dominates — so the defence that actually
      // holds is the identical response below, not this.
      await hashOtpCode(newId(), code, pepper);
      return invalidCode();
    }

    const liveCodes = and(
      eq(schema.magicLinkTokens.member_id, member.id),
      // Redundant while member_id is globally unique, but it is the house rule
      // for every tenant-scoped query and it pins the store this session will
      // be issued against to the member's own.
      eq(schema.magicLinkTokens.store_id, member.store_id),
      // Only codes that went to this member's own address: a non-null
      // new_email means the code was mailed somewhere else, and redeeming it
      // here would mint a session for an address the caller never proved.
      // Stated as the property rather than as `purpose != 'email_change'`, so
      // a later purpose that mails elsewhere is excluded without an edit here.
      isNull(schema.magicLinkTokens.new_email),
      isNull(schema.magicLinkTokens.used_at),
      gt(schema.magicLinkTokens.expires_at, ts),
    );

    const matched = await claimCodeAttempt(db, liveCodes, code, pepper, ts);
    if (!matched) return invalidCode();

    await db
      .update(schema.magicLinkTokens)
      .set({ used_at: ts })
      .where(eq(schema.magicLinkTokens.id, matched.id));

    if (matched.purpose === "signup") {
      await db
        .update(schema.stores)
        .set({ status: "active", activated_at: ts })
        .where(eq(schema.stores.id, matched.store_id));
      await db
        .update(schema.members)
        .set({ status: "active", activated_at: ts })
        .where(eq(schema.members.id, member.id));
    }

    if (matched.purpose === "invite") {
      await db
        .update(schema.members)
        .set({ status: "active", activated_at: ts })
        .where(eq(schema.members.id, member.id));
    }

    if (matched.purpose === "reactivate") {
      await db
        .update(schema.stores)
        .set({ status: "active" })
        .where(eq(schema.stores.id, matched.store_id));
    }

    const sessionToken = newId();
    await db.insert(schema.sessions).values({
      id: newId(),
      store_id: matched.store_id,
      member_id: member.id,
      session_token: await hashToken(sessionToken),
      expires_at: ts + SESSION_TTL_MS,
    });

    const secure = isSecureRequest(c.req.url, c.env.ENVIRONMENT);
    const cookieDomain = c.env.COOKIE_DOMAIN || undefined;
    c.header(
      "Set-Cookie",
      buildSessionCookie(sessionToken, { secure, domain: cookieDomain }),
    );
    // The caller is told where to go rather than redirected: the signup SPA
    // has to cross to the admin origin and does not carry that URL in its own
    // env. Resolved from the same fixed env-backed map the Magic Link redirect
    // through, so this is not a caller-supplied destination.
    return c.json({
      data: { redirect_to: landingOrigin(c.env, targetApp) },
    });
  })

  /**
   * POST /api/auth/login
   *
   * Emails a passcode to the given email address.
   * Always returns 200 with the same message regardless of whether the email
   * is registered, to prevent email enumeration.
   *
   * Behaviour per member/store status:
   *   member active, store active            → sends a "login" code
   *   member pending, role owner              → resends the "signup" code
   *   member pending, role staff              → resends the "invite" code
   *   member active, store suspended, owner   → sends a "reactivate" code
   *   member active, store suspended, staff   → silent (only an owner can reactivate)
   * A pending member's signup/invite resend is unaffected by the store's
   * suspended status — completing an invite doesn't grant any access
   * (requireStore still blocks on store.status), so there's no reason to
   * also lock down onboarding; only an already-active owner can reactivate.
   */
  .post("/login", bodyValidator(LoginInput), async (c) => {
    const { email } = c.req.valid("json");
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
    let issuedCode: string | undefined;

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
        const code = await issueVerificationCode(
          db,
          member.store_id,
          member.member_id,
          purpose,
          c.env.OTP_PEPPER,
        );
        // null means the member hit MAGIC_LINK_HOURLY_CAP — skip sending but
        // keep the response identical to the success case (anti-enumeration).
        if (code) {
          issuedCode = code;

          // Defer email delivery so its latency is not observable to the caller.
          // Without this, response time reveals whether the email address is registered.
          const emailPromise = sendVerificationCodeEmail(
            { to: email, code, purpose },
            {
              resendApiKey: c.env.RESEND_API_KEY,
              mailFrom: c.env.MAIL_FROM,
              environment: c.env.ENVIRONMENT,
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
        // Silent failure — the "always 200" contract must hold even if code
        // issuance fails (e.g., transient D1 error).
        console.error(
          `[auth/login] Passcode issuance failed for member ${member.member_id}`,
        );
      }
    }

    // Always return 200 regardless of email existence. In dev
    // (ENVIRONMENT === "development") only, include the code when one was
    // actually issued — production always returns the identical body.
    // Checked as an explicit opt-in (not "!== production") so an unset or
    // misconfigured ENVIRONMENT never accidentally leaks the passcode.
    const isDev = c.env.ENVIRONMENT === "development";
    return c.json({
      data: {
        sent: true,
        ...(isDev && issuedCode && { code: issuedCode }),
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
