/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:workers";
import {
  hashToken,
  MAGIC_LINK_TTL_MS,
  now,
  SESSION_TTL_MS,
} from "@yorozu/core";
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
 * Registers a store via the API and returns its id + the signup magic token.
 * Only a hash of the token is persisted to D1, so the raw value must come
 * from the API response itself (dev-mode verify_url), not a DB read.
 */
async function registerStore(
  name: string,
  email: string,
): Promise<{ storeId: string; memberId: string; signupToken: string }> {
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
    data: { id: string; verify_url?: string };
  };
  const storeId = body.data.id;
  const signupToken = body.data.verify_url
    ? new URL(body.data.verify_url).searchParams.get("token")
    : null;
  if (!signupToken) throw new Error("registerStore: verify_url/token missing");

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
  return { storeId, memberId: tokenRow.member_id, signupToken };
}

/** Verifies a token via the API (follows the 302 redirect internally). */
async function verifyToken(token: string): Promise<Response> {
  return app.request(`/api/auth/verify?token=${token}`, {}, env);
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
// GET /api/auth/verify
// ---------------------------------------------------------------------------

describe("GET /api/auth/verify", () => {
  it("activates the store and creates a session on valid signup token", async () => {
    const email = `verify-ok-${crypto.randomUUID()}@example.com`;
    const { storeId, signupToken } = await registerStore(
      "Verify OK Cafe",
      email,
    );

    const res = await verifyToken(signupToken);

    // Redirects to the admin SPA (absolute URL from env)
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://admin.localhost");

    const db = createDb(env.DB);

    // Store should now be active
    const storeRow = await db
      .select()
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .then((rows) => rows[0]);
    expect(storeRow?.status).toBe("active");
    expect(storeRow?.activated_at).toBeTruthy();

    // The owner member should also be active
    const memberRow = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.store_id, storeId))
      .then((rows) => rows[0]);
    expect(memberRow?.status).toBe("active");
    expect(memberRow?.activated_at).toBeTruthy();
    expect(memberRow?.role).toBe("owner");

    // Session should exist and reference the member
    const sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.store_id, storeId));
    expect(sessionRows).toHaveLength(1);
    expect(sessionRows[0]?.expires_at).toBeGreaterThan(now());
    expect(sessionRows[0]?.member_id).toBe(memberRow?.id);

    // session_token cookie should be set with SameSite=None
    const cookie = res.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain("session_token=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=none");
  });

  it("marks the magic_link_token as used (used_at set, not deleted)", async () => {
    const email = `verify-used-${crypto.randomUUID()}@example.com`;
    const { signupToken } = await registerStore("Used Token Cafe", email);

    await verifyToken(signupToken);

    const db = createDb(env.DB);
    const tokenRow = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.token, await hashToken(signupToken)))
      .then((rows) => rows[0]);
    expect(tokenRow).toBeTruthy();
    expect(tokenRow?.used_at).toBeTruthy();
  });

  it("returns INVALID_TOKEN when the token has already been used", async () => {
    const email = `verify-reuse-${crypto.randomUUID()}@example.com`;
    const { signupToken } = await registerStore("Reuse Cafe", email);

    await verifyToken(signupToken);
    const res2 = await verifyToken(signupToken);

    expect(res2.status).toBe(400);
    const body = (await res2.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns INVALID_TOKEN for an expired token", async () => {
    const email = `verify-expired-${crypto.randomUUID()}@example.com`;
    const { storeId, memberId } = await registerStore("Expired Cafe", email);

    const db = createDb(env.DB);
    const expiredToken = crypto.randomUUID();
    await db.insert(schema.magicLinkTokens).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: memberId,
      token: await hashToken(expiredToken),
      purpose: "login",
      expires_at: now() - 1,
    });

    const res = await verifyToken(expiredToken);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns INVALID_TOKEN for a non-existent token", async () => {
    const res = await verifyToken("completely-fake-token");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns INVALID_TOKEN when token param is absent", async () => {
    const res = await app.request("/api/auth/verify", {}, env);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_TOKEN");
  });

  it("creates a session on valid login token (store already active)", async () => {
    const email = `verify-login-${crypto.randomUUID()}@example.com`;
    const { storeId, memberId, signupToken } = await registerStore(
      "Login Verify Cafe",
      email,
    );

    await verifyToken(signupToken);

    const db = createDb(env.DB);
    const loginToken = crypto.randomUUID();
    await db.insert(schema.magicLinkTokens).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: memberId,
      token: await hashToken(loginToken),
      purpose: "login",
      expires_at: now() + MAGIC_LINK_TTL_MS,
    });

    const res = await verifyToken(loginToken);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://admin.localhost");

    // Two sessions should now exist (signup + login)
    const sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.store_id, storeId));
    expect(sessionRows.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

/** Registers a store and returns a usable login token for its owner. */
async function issueLoginToken(
  name: string,
  devEnv: typeof env,
): Promise<string> {
  const store = await seedStore(name);
  const [member] = await createDb(env.DB)
    .select({ email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.store_id, store.id))
    .limit(1);

  const res = await app.request(
    "/api/auth/login",
    jsonInit("POST", { email: member?.email }),
    devEnv,
  );
  const body = (await res.json()) as { data: { verify_url?: string } };
  return new URL(body.data.verify_url ?? "").searchParams.get("token") ?? "";
}

describe("Magic Link landing app", () => {
  it("sends a shift login back to the shift SPA", async () => {
    const store = await seedStore(`Login App Shift ${crypto.randomUUID()}`);
    const [member] = await createDb(env.DB)
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.store_id, store.id))
      .limit(1);
    const devEnv = { ...env, ENVIRONMENT: "development" };

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: member?.email, app: "shift" }),
      devEnv,
    );
    const body = (await res.json()) as { data: { verify_url?: string } };
    const verifyUrl = body.data.verify_url ?? "";
    expect(verifyUrl).toContain("app=shift");

    const verified = await app.request(
      verifyUrl.replace(new URL(verifyUrl).origin, ""),
      {},
      devEnv,
    );
    expect(verified.status).toBe(302);
    expect(verified.headers.get("Location")).toBe("http://shift.localhost");
  });

  it("lands on admin when the verify link carries no app at all", async () => {
    const devEnv = { ...env, ENVIRONMENT: "development" };
    const token = await issueLoginToken(
      `Login App Missing ${crypto.randomUUID()}`,
      devEnv,
    );

    // Strip the parameter entirely rather than appending a second one: Hono
    // reads the first occurrence, so an appended value proves nothing.
    const verified = await app.request(
      `/api/auth/verify?token=${token}`,
      {},
      devEnv,
    );

    expect(verified.headers.get("Location")).toBe("http://admin.localhost");
  });

  it("lands on admin when the app is one it does not know", async () => {
    const devEnv = { ...env, ENVIRONMENT: "development" };
    const token = await issueLoginToken(
      `Login App Unknown ${crypto.randomUUID()}`,
      devEnv,
    );

    const verified = await app.request(
      `/api/auth/verify?token=${token}&app=https://evil.example.com`,
      {},
      devEnv,
    );

    expect(verified.headers.get("Location")).toBe("http://admin.localhost");
  });

  it("sends a logout back to the SPA it came from", async () => {
    const store = await seedStore(`Logout App ${crypto.randomUUID()}`);

    const res = await app.request(
      "/api/auth/logout?app=shift",
      withAuth(store.session_token, { method: "POST" }),
      env,
    );

    expect(res.headers.get("Location")).toBe("http://shift.localhost/login");
  });

  it("rejects an app value outside the enum", async () => {
    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", {
        email: "someone@example.com",
        app: "evil.example.com",
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

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
    const { storeId, signupToken } = await registerStore(
      "Login Active Cafe",
      email,
    );
    await verifyToken(signupToken);

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

  it("does NOT include verify_url for an active store when ENVIRONMENT=production", async () => {
    const email = `login-prod-${crypto.randomUUID()}@example.com`;
    const { signupToken } = await registerStore("Login Prod Cafe", email);
    await verifyToken(signupToken);

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      { ...env, ENVIRONMENT: "production" },
    );
    const body = (await res.json()) as { data: { verify_url?: string } };
    expect(body.data.verify_url).toBeUndefined();
  });

  it("includes verify_url for an active store when ENVIRONMENT=development", async () => {
    const email = `login-dev-${crypto.randomUUID()}@example.com`;
    const { signupToken } = await registerStore("Login Dev Cafe", email);
    await verifyToken(signupToken);

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      { ...env, ENVIRONMENT: "development" },
    );
    const body = (await res.json()) as { data: { verify_url?: string } };
    expect(body.data.verify_url).toMatch(/\/api\/auth\/verify\?token=.+/);
  });

  it("does NOT include verify_url in dev mode when the email is not registered", async () => {
    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: "ghost-dev@nonexistent.example.com" }),
      { ...env, ENVIRONMENT: "development" },
    );
    const body = (await res.json()) as { data: { verify_url?: string } };
    expect(body.data.verify_url).toBeUndefined();
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
    const { storeId, signupToken: firstToken } = await registerStore(
      "Reissue Cafe",
      email,
    );
    await verifyToken(firstToken);

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
  it("deletes the current session and clears the cookie", async () => {
    const email = `logout-${crypto.randomUUID()}@example.com`;
    const { signupToken, storeId } = await registerStore("Logout Cafe", email);

    const verifyRes = await verifyToken(signupToken);
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
    const { storeId, memberId, signupToken } = await registerStore(
      "Multi Session Cafe",
      email,
    );

    const res1 = await verifyToken(signupToken);
    const token1 = extractSessionToken(res1);

    const db = createDb(env.DB);
    const loginToken = crypto.randomUUID();
    await db.insert(schema.magicLinkTokens).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: memberId,
      token: await hashToken(loginToken),
      purpose: "login",
      expires_at: now() + MAGIC_LINK_TTL_MS,
    });
    await verifyToken(loginToken);

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
    const { signupToken } = await registerStore("Auth Active Cafe", email);
    const verifyRes = await verifyToken(signupToken);
    const sessionToken = extractSessionToken(verifyRes);

    const res = await app.request("/api/seats", withAuth(sessionToken), env);
    // 200 (empty list) — auth passed
    expect(res.status).toBe(200);
  });
});
