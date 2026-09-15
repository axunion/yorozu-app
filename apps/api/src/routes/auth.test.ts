/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:workers";
import { hashToken, now, SESSION_TTL_MS } from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  extractSessionToken,
  jsonInit,
  seedStore,
  withAuth,
} from "../test-helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Registers a store via the API and returns its ids + the signup passcode.
 * Only a keyed digest of the code is persisted to D1, so the raw value has to
 * come from the API response itself (dev-mode `code`), not a DB read.
 */
async function registerStore(
  name: string,
  email: string,
): Promise<{ storeId: string; memberId: string; signupCode: string }> {
  const res = await app.request(
    "/api/stores",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name, email }),
    },
    { ...env, ENVIRONMENT: "development" },
  );
  if (!res.ok) throw new Error(`registerStore failed: ${res.status}`);
  const body = (await res.json()) as {
    data: { id: string; code?: string };
  };
  const storeId = body.data.id;
  const signupCode = body.data.code;
  if (!signupCode) throw new Error("registerStore: code missing");

  const db = createDb(env.DB);
  const tokenRow = await db
    .select({ member_id: schema.magicLinkTokens.member_id })
    .from(schema.magicLinkTokens)
    .where(
      and(
        eq(schema.magicLinkTokens.store_id, storeId),
        eq(schema.magicLinkTokens.purpose, "signup"),
        isNull(schema.magicLinkTokens.used_at),
      ),
    )
    .then((rows) => rows[0]);

  if (!tokenRow) throw new Error("signup magic_link_token not found");
  return { storeId, memberId: tokenRow.member_id, signupCode };
}

/** Submits a passcode the way the SPAs do. */
async function verifyCode(email: string, code: string): Promise<Response> {
  return app.request(
    "/api/auth/verify-code",
    jsonInit("POST", { email, code }),
    env,
  );
}

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe("GET /api/auth/me", () => {
  it("returns the calling member's own email and role, not stores.email", async () => {
    const {
      id,
      member_id,
      session_token: token,
    } = await seedStore(`Me Test ${crypto.randomUUID()}`, "owner");
    const db = createDb(env.DB);
    const storeRows = await db
      .select({ email: schema.stores.email })
      .from(schema.stores)
      .where(eq(schema.stores.id, id));
    const memberRows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, member_id));
    const storeEmail = storeRows[0]?.email;
    const memberEmail = memberRows[0]?.email;
    if (!storeEmail || !memberEmail) {
      throw new Error("seedStore did not set store/member emails");
    }
    // seedStore gives the store and its member distinct emails, so this
    // proves /me reads members.email, not stores.email.
    expect(memberEmail).not.toBe(storeEmail);

    const res = await app.request("/api/auth/me", withAuth(token), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; name: string; email: string; role: string };
    };
    expect(body.data.email).toBe(memberEmail);
    expect(body.data.role).toBe("owner");
  });

  it("returns role=staff for a staff-role session", async () => {
    const { session_token: token } = await seedStore(
      `Me Staff Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request("/api/auth/me", withAuth(token), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { role: string } };
    expect(body.data.role).toBe("staff");
  });

  it("returns 401 without a session", async () => {
    const res = await app.request("/api/auth/me", {}, env);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe("POST /api/auth/login", () => {
  it("always returns 200 with { data: { sent: true } }", async () => {
    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: "ghost@nonexistent.example.com" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sent: boolean } };
    expect(body.data.sent).toBe(true);
  });

  it("issues a login token for an active store", async () => {
    const email = `login-active-${crypto.randomUUID()}@example.com`;
    const { storeId, signupCode } = await registerStore(
      "Login Active Cafe",
      email,
    );
    await verifyCode(email, signupCode);

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      env,
    );
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const tokens = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.store_id, storeId),
          eq(schema.magicLinkTokens.purpose, "login"),
          isNull(schema.magicLinkTokens.used_at),
        ),
      );
    expect(tokens).toHaveLength(1);
  });

  it("does NOT include the code for an active store when ENVIRONMENT=production", async () => {
    const email = `login-prod-${crypto.randomUUID()}@example.com`;
    const { signupCode } = await registerStore("Login Prod Cafe", email);
    await verifyCode(email, signupCode);

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      { ...env, ENVIRONMENT: "production" },
    );
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toBeUndefined();
  });

  it("includes the code for an active store when ENVIRONMENT=development", async () => {
    const email = `login-dev-${crypto.randomUUID()}@example.com`;
    const { signupCode } = await registerStore("Login Dev Cafe", email);
    await verifyCode(email, signupCode);

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      { ...env, ENVIRONMENT: "development" },
    );
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toMatch(/^\d{6}$/);
  });

  it("does NOT include a code in dev mode when the email is not registered", async () => {
    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: "ghost-dev@nonexistent.example.com" }),
      { ...env, ENVIRONMENT: "development" },
    );
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toBeUndefined();
  });

  it("issues a signup token (recovery) for a pending store", async () => {
    const email = `login-pending-${crypto.randomUUID()}@example.com`;
    const { storeId } = await registerStore("Login Pending Cafe", email);

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      env,
    );
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const tokens = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.store_id, storeId),
          eq(schema.magicLinkTokens.purpose, "signup"),
          isNull(schema.magicLinkTokens.used_at),
        ),
      );
    // The old token is deleted and replaced by a new one
    expect(tokens).toHaveLength(1);
  });

  it("issues an invite token (not signup) for a pending staff member", async () => {
    const { id: storeId } = await seedStore(
      `Pending Staff Login Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);

    // Directly seed a pending staff member — the invite endpoint that
    // creates these ships in a later slice.
    const staffMemberId = crypto.randomUUID();
    const staffEmail = `staff-pending-${crypto.randomUUID()}@test.internal`;
    await db.insert(schema.members).values({
      id: staffMemberId,
      store_id: storeId,
      email: staffEmail,
      role: "staff",
      status: "pending",
    });

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: staffEmail }),
      env,
    );
    expect(res.status).toBe(200);

    const tokens = await db
      .select({ purpose: schema.magicLinkTokens.purpose })
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.member_id, staffMemberId),
          isNull(schema.magicLinkTokens.used_at),
        ),
      );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe("invite");
  });

  it("invalidates the old token when reissuing for the same purpose", async () => {
    const email = `login-reissue-${crypto.randomUUID()}@example.com`;
    const { storeId, signupCode } = await registerStore("Reissue Cafe", email);
    await verifyCode(email, signupCode);

    await app.request("/api/auth/login", jsonInit("POST", { email }), env);

    const db = createDb(env.DB);
    const tokens = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.store_id, storeId),
          eq(schema.magicLinkTokens.purpose, "login"),
          isNull(schema.magicLinkTokens.used_at),
        ),
      );
    // Only one valid login token should exist regardless of how many times login was called
    expect(tokens).toHaveLength(1);
  });

  it("returns 400 for invalid email format", async () => {
    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: "not-an-email" }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------

describe("POST /api/auth/logout", () => {
  it("sends a logout back to the SPA it came from", async () => {
    const res = await app.request(
      "/api/auth/logout?app=shift",
      { method: "POST" },
      env,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://shift.localhost/login");
  });

  it("lands a logout on admin when the caller names no app", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" }, env);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://admin.localhost/login");
  });

  it("lands a logout on admin when the app is one it does not know", async () => {
    // landingOrigin maps through a fixed env-backed table, so an unrecognised
    // value can never become an open redirect.
    const res = await app.request(
      "/api/auth/logout?app=https://evil.example.com",
      { method: "POST" },
      env,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://admin.localhost/login");
  });

  it("deletes the current session and clears the cookie", async () => {
    const email = `logout-${crypto.randomUUID()}@example.com`;
    const { signupCode, storeId } = await registerStore("Logout Cafe", email);

    const verifyRes = await verifyCode(email, signupCode);
    const sessionToken = extractSessionToken(verifyRes);

    const logoutRes = await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { Cookie: `session_token=${sessionToken}` } },
      env,
    );

    // Redirects to the admin SPA login page
    expect(logoutRes.status).toBe(302);
    expect(logoutRes.headers.get("Location")).toBe(
      "http://admin.localhost/login",
    );

    // Cookie should be cleared
    const cookie = logoutRes.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("Max-Age=0");

    // Session should be deleted from DB
    const db = createDb(env.DB);
    const sessions = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.store_id, storeId));
    expect(sessions).toHaveLength(0);
  });

  it("succeeds even when no cookie is present", async () => {
    const res = await app.request("/api/auth/logout", { method: "POST" }, env);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://admin.localhost/login");
  });

  it("only deletes the session matching the cookie (other sessions remain)", async () => {
    const email = `logout-multi-${crypto.randomUUID()}@example.com`;
    const { storeId, signupCode } = await registerStore(
      "Multi Session Cafe",
      email,
    );

    const res1 = await verifyCode(email, signupCode);
    const token1 = extractSessionToken(res1);

    const db = createDb(env.DB);
    // A second device: ask for a login code and redeem it, rather than
    // planting a row — the digest depends on the row id, so a hand-written
    // token would not verify.
    const loginRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      { ...env, ENVIRONMENT: "development" },
    );
    const loginBody = (await loginRes.json()) as { data: { code?: string } };
    if (!loginBody.data.code) throw new Error("login code missing");
    await verifyCode(email, loginBody.data.code);

    await app.request(
      "/api/auth/logout",
      { method: "POST", headers: { Cookie: `session_token=${token1}` } },
      env,
    );

    const remaining = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.store_id, storeId));
    expect(remaining).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout-all
// ---------------------------------------------------------------------------

describe("POST /api/auth/logout-all", () => {
  it("deletes all of the caller's own sessions and clears the cookie", async () => {
    const { member_id: memberId, session_token: token1 } = await seedStore(
      `Logout All Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const token2 = crypto.randomUUID();
    await db.insert(schema.sessions).values({
      id: crypto.randomUUID(),
      store_id: (
        await db
          .select({ store_id: schema.members.store_id })
          .from(schema.members)
          .where(eq(schema.members.id, memberId))
      )[0]?.store_id as string,
      member_id: memberId,
      session_token: await hashToken(token2),
      expires_at: now() + SESSION_TTL_MS,
    });

    const res = await app.request(
      "/api/auth/logout-all",
      { method: "POST", headers: { Cookie: `session_token=${token1}` } },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://admin.localhost/login");
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("Max-Age=0");

    const remaining = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.member_id, memberId));
    expect(remaining).toHaveLength(0);
  });

  it("does not delete another member's sessions in the same store", async () => {
    const { id: storeId, session_token: token } = await seedStore(
      `Logout All Isolation Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const otherMemberId = crypto.randomUUID();
    await db.insert(schema.members).values({
      id: otherMemberId,
      store_id: storeId,
      email: `other-${crypto.randomUUID()}@test.internal`,
      role: "staff",
      status: "active",
      activated_at: now(),
    });
    const otherSessionToken = crypto.randomUUID();
    await db.insert(schema.sessions).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: otherMemberId,
      session_token: await hashToken(otherSessionToken),
      expires_at: now() + SESSION_TTL_MS,
    });

    await app.request(
      "/api/auth/logout-all",
      { method: "POST", headers: { Cookie: `session_token=${token}` } },
      env,
    );

    const remaining = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.member_id, otherMemberId));
    expect(remaining).toHaveLength(1);
  });

  it("returns 401 without a session", async () => {
    const res = await app.request(
      "/api/auth/logout-all",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// requireStore middleware (session-based auth)
// ---------------------------------------------------------------------------

describe("requireStore middleware (session-based)", () => {
  it("returns 401 for requests without a session cookie", async () => {
    const res = await app.request("/api/seats", {}, env);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("returns 401 for an invalid session token", async () => {
    const res = await app.request(
      "/api/seats",
      withAuth("fake-token-that-doesnt-exist"),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("refreshes expires_at/last_used_at when last_used_at is null (fresh session)", async () => {
    const { session_token: token } = await seedStore(
      `Sliding Fresh Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const before = await db
      .select({
        expires_at: schema.sessions.expires_at,
        last_used_at: schema.sessions.last_used_at,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.session_token, await hashToken(token)))
      .then((rows) => rows[0]);
    expect(before?.last_used_at).toBeNull();

    const res = await app.request("/api/seats", withAuth(token), env);

    const after = await db
      .select({
        expires_at: schema.sessions.expires_at,
        last_used_at: schema.sessions.last_used_at,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.session_token, await hashToken(token)))
      .then((rows) => rows[0]);
    expect(after?.last_used_at).toBeTruthy();
    // expires_at and last_used_at are set from the same now() call in the
    // middleware, so this exact relationship is a non-flaky way to prove a
    // refresh happened (a >-than-before comparison can tie when two now()
    // calls land in the same millisecond).
    expect(after?.expires_at).toBe((after?.last_used_at ?? 0) + SESSION_TTL_MS);

    // The browser's cookie Max-Age must also be refreshed — otherwise it
    // would still hard-expire 30 days after the original login regardless
    // of the server-side session row being extended.
    expect(res.headers.get("Set-Cookie")).toContain(`session_token=${token}`);
  });

  it("does not rewrite last_used_at/expires_at when refreshed less than an hour ago", async () => {
    const { session_token: token } = await seedStore(
      `Sliding Recent Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const recentTs = now() - 5 * 60 * 1000; // 5 minutes ago
    const originalExpiresAt = now() + SESSION_TTL_MS;
    await db
      .update(schema.sessions)
      .set({ last_used_at: recentTs, expires_at: originalExpiresAt })
      .where(eq(schema.sessions.session_token, await hashToken(token)));

    const res = await app.request("/api/seats", withAuth(token), env);

    const after = await db
      .select({
        expires_at: schema.sessions.expires_at,
        last_used_at: schema.sessions.last_used_at,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.session_token, await hashToken(token)))
      .then((rows) => rows[0]);
    expect(after?.last_used_at).toBe(recentTs);
    expect(after?.expires_at).toBe(originalExpiresAt);
    // No refresh happened, so no Set-Cookie should be sent either.
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("rewrites last_used_at/expires_at when the last refresh was over an hour ago", async () => {
    const { session_token: token } = await seedStore(
      `Sliding Stale Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const staleTs = now() - 2 * 60 * 60 * 1000; // 2 hours ago
    const originalExpiresAt = now() + SESSION_TTL_MS;
    await db
      .update(schema.sessions)
      .set({ last_used_at: staleTs, expires_at: originalExpiresAt })
      .where(eq(schema.sessions.session_token, await hashToken(token)));

    const res = await app.request("/api/seats", withAuth(token), env);

    const after = await db
      .select({
        expires_at: schema.sessions.expires_at,
        last_used_at: schema.sessions.last_used_at,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.session_token, await hashToken(token)))
      .then((rows) => rows[0]);
    expect(after?.last_used_at).toBeGreaterThan(staleTs);
    // Same non-flaky relationship check as the "fresh session" test above.
    expect(after?.expires_at).toBe((after?.last_used_at ?? 0) + SESSION_TTL_MS);
    expect(res.headers.get("Set-Cookie")).toContain(`session_token=${token}`);
  });

  it("grants access to an active store with a valid session", async () => {
    const email = `auth-active-${crypto.randomUUID()}@example.com`;
    const { signupCode } = await registerStore("Auth Active Cafe", email);
    const verifyRes = await verifyCode(email, signupCode);
    const sessionToken = extractSessionToken(verifyRes);

    const res = await app.request("/api/seats", withAuth(sessionToken), env);
    // 200 (empty list) — auth passed
    expect(res.status).toBe(200);
  });
});
