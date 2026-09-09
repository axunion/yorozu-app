/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Store settings (roadmap Phase 2 item 4): rename and owner email change.
 */
import { env } from "cloudflare:workers";
import {
  EMAIL_CHANGE_HOURLY_CAP,
  EMAIL_CHANGE_WINDOW_MS,
  hashToken,
  now,
  OTP_MAX_ATTEMPTS,
  SESSION_TTL_MS,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

// Email-change responses only include the code when ENVIRONMENT=development
// (see stores.ts / auth.ts's isDev gate). Tests that need to extract a token
// from the response body must pass this override explicitly — relying on
// .dev.vars's default is not safe in CI/fresh-checkout environments.
const devEnv = { ...env, ENVIRONMENT: "development" };

// ---------------------------------------------------------------------------
// PATCH /api/stores/me — rename
// ---------------------------------------------------------------------------

describe("PATCH /api/stores/me", () => {
  it("updates the store name and returns id/name/slug", async () => {
    const { id, session_token: token } = await seedStore(
      `Rename Test ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("PATCH", { name: "新しい店名" })),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; name: string; slug: string };
    };
    expect(body.data.id).toBe(id);
    expect(body.data.name).toBe("新しい店名");
  });

  it("does not regenerate the slug", async () => {
    const { session_token: token } = await seedStore(
      `Slug Test ${crypto.randomUUID()}`,
    );

    const beforeRes = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("PATCH", { name: "変更前" })),
      env,
    );
    const before = (await beforeRes.json()) as { data: { slug: string } };

    const afterRes = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("PATCH", { name: "変更後" })),
      env,
    );
    const after = (await afterRes.json()) as { data: { slug: string } };

    expect(after.data.slug).toBe(before.data.slug);
  });

  it("returns 400 for an empty name", async () => {
    const { session_token: token } = await seedStore(
      `Validation Test ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("PATCH", { name: "" })),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 401 without a session", async () => {
    const res = await app.request(
      "/api/stores/me",
      jsonInit("PATCH", { name: "無認証" }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("only renames the calling store, leaving other stores untouched", async () => {
    const storeA = await seedStore(`Store A ${crypto.randomUUID()}`);
    const storeBName = `Store B ${crypto.randomUUID()}`;
    const storeB = await seedStore(storeBName);

    await app.request(
      "/api/stores/me",
      withAuth(storeA.session_token, jsonInit("PATCH", { name: "Aの新名前" })),
      env,
    );

    const db = createDb(env.DB);
    const rows = await db
      .select({ name: schema.stores.name })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeB.id));
    expect(rows[0]?.name).toBe(storeBName);
  });
});

// ---------------------------------------------------------------------------
// POST /api/stores/me/email-change
// ---------------------------------------------------------------------------

describe("POST /api/stores/me/email-change", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request(
      "/api/stores/me/email-change",
      jsonInit("POST", { new_email: "new@example.com" }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 when new_email equals the current email", async () => {
    const { member_id: memberId, session_token: token } = await seedStore(
      `Unchanged Email Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const rows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberId));
    const currentEmail = rows[0]?.email;
    if (!currentEmail) throw new Error("seedStore did not set a member email");

    const res = await app.request(
      "/api/stores/me/email-change",
      withAuth(token, jsonInit("POST", { new_email: currentEmail })),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when new_email is already registered to another member", async () => {
    const storeA = await seedStore(`Store A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Store B ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    const rows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, storeB.member_id));
    const storeBEmail = rows[0]?.email;
    if (!storeBEmail) throw new Error("seedStore did not set a member email");

    const res = await app.request(
      "/api/stores/me/email-change",
      withAuth(
        storeA.session_token,
        jsonInit("POST", { new_email: storeBEmail }),
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("issues an email_change passcode row with new_email set", async () => {
    const { member_id: memberId, session_token: token } = await seedStore(
      `Issue Test ${crypto.randomUUID()}`,
    );
    const newEmail = `new-${crypto.randomUUID()}@test.internal`;

    const res = await app.request(
      "/api/stores/me/email-change",
      withAuth(token, jsonInit("POST", { new_email: newEmail })),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { sent: true } };
    expect(body.data.sent).toBe(true);

    const db = createDb(env.DB);
    const tokenRows = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, memberId));
    const emailChangeToken = tokenRows.find(
      (t) => t.purpose === "email_change" && t.used_at === null,
    );
    expect(emailChangeToken?.new_email).toBe(newEmail);
  });

  it("invalidates the previous unused token on re-request", async () => {
    const { member_id: memberId, session_token: token } = await seedStore(
      `Reissue Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);

    const firstEmail = `first-${crypto.randomUUID()}@test.internal`;
    const firstRes = await app.request(
      "/api/stores/me/email-change",
      withAuth(token, jsonInit("POST", { new_email: firstEmail })),
      devEnv,
    );
    const firstBody = (await firstRes.json()) as { data: { code?: string } };
    const firstCode = firstBody.data.code;
    if (!firstCode) {
      throw new Error("code missing (ENVIRONMENT dev bypass off?)");
    }

    const secondEmail = `second-${crypto.randomUUID()}@test.internal`;
    await app.request(
      "/api/stores/me/email-change",
      withAuth(token, jsonInit("POST", { new_email: secondEmail })),
      env,
    );

    // The first code was superseded by the re-request.
    const verifyRes = await app.request(
      "/api/stores/me/email-change/verify",
      withAuth(token, jsonInit("POST", { code: firstCode })),
      env,
    );
    expect(verifyRes.status).toBe(400);

    const memberRows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberId));
    expect(memberRows[0]?.email).not.toBe(firstEmail);
  });

  it("end-to-end: request, verify, then login works only via the new email", async () => {
    const { member_id: memberId, session_token: token } = await seedStore(
      `E2E Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const beforeRows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberId));
    const oldEmail = beforeRows[0]?.email;
    if (!oldEmail) throw new Error("seedStore did not set a member email");
    const newEmail = `new-${crypto.randomUUID()}@test.internal`;

    const changeRes = await app.request(
      "/api/stores/me/email-change",
      withAuth(token, jsonInit("POST", { new_email: newEmail })),
      devEnv,
    );
    const changeBody = (await changeRes.json()) as { data: { code?: string } };
    const changeCode = changeBody.data.code;
    if (!changeCode) {
      throw new Error("code missing (ENVIRONMENT dev bypass off?)");
    }

    const verifyRes = await app.request(
      "/api/stores/me/email-change/verify",
      withAuth(token, jsonInit("POST", { code: changeCode })),
      env,
    );
    expect(verifyRes.status).toBe(200);

    const afterRows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberId));
    expect(afterRows[0]?.email).toBe(newEmail);

    // Login with the old email issues no token (member no longer found by it).
    const oldLoginRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: oldEmail }),
      devEnv,
    );
    expect(oldLoginRes.status).toBe(200);
    const oldLoginBody = (await oldLoginRes.json()) as {
      data: { sent: true; code?: string };
    };
    expect(oldLoginBody.data.code).toBeUndefined();

    // Login with the new email issues a real token.
    const newLoginRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: newEmail }),
      devEnv,
    );
    expect(newLoginRes.status).toBe(200);
    const newLoginBody = (await newLoginRes.json()) as {
      data: { sent: true; code?: string };
    };
    expect(newLoginBody.data.code).toBeTruthy();
  });

  it("does not affect a second member's session or login when one member changes email", async () => {
    const { id: storeId, session_token: tokenA } = await seedStore(
      `Isolation Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);

    // A second (staff) member of the same store, with its own session.
    const memberBId = crypto.randomUUID();
    const memberBEmail = `member-b-${crypto.randomUUID()}@test.internal`;
    const tokenB = crypto.randomUUID();
    await db.insert(schema.members).values({
      id: memberBId,
      store_id: storeId,
      email: memberBEmail,
      role: "staff",
      status: "active",
      activated_at: now(),
    });
    await db.insert(schema.sessions).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: memberBId,
      session_token: await hashToken(tokenB),
      expires_at: now() + SESSION_TTL_MS,
    });

    // Member A changes their own email end-to-end.
    const newEmailA = `new-a-${crypto.randomUUID()}@test.internal`;
    const changeRes = await app.request(
      "/api/stores/me/email-change",
      withAuth(tokenA, jsonInit("POST", { new_email: newEmailA })),
      devEnv,
    );
    const changeBody = (await changeRes.json()) as { data: { code?: string } };
    const changeCodeA = changeBody.data.code;
    if (!changeCodeA) {
      throw new Error("code missing (ENVIRONMENT dev bypass off?)");
    }
    await app.request(
      "/api/stores/me/email-change/verify",
      withAuth(tokenA, jsonInit("POST", { code: changeCodeA })),
      env,
    );

    // Member B's own email is untouched.
    const memberBRow = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberBId))
      .then((rows) => rows[0]);
    expect(memberBRow?.email).toBe(memberBEmail);

    // Member B's existing session still authenticates.
    const meRes = await app.request("/api/auth/me", withAuth(tokenB), env);
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as { data: { email: string } };
    expect(meBody.data.email).toBe(memberBEmail);

    // Member B can still log in with their own unchanged email.
    const loginRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: memberBEmail }),
      devEnv,
    );
    const loginBody = (await loginRes.json()) as {
      data: { code?: string };
    };
    expect(loginBody.data.code).toBeTruthy();
  });

  it("fails at verify when a UNIQUE race claims the email first", async () => {
    const { member_id: memberId, session_token: token } = await seedStore(
      `Race Test ${crypto.randomUUID()}`,
    );
    const raceEmail = `race-${crypto.randomUUID()}@test.internal`;

    const changeRes = await app.request(
      "/api/stores/me/email-change",
      withAuth(token, jsonInit("POST", { new_email: raceEmail })),
      devEnv,
    );
    const changeBody = (await changeRes.json()) as { data: { code?: string } };
    const raceCode = changeBody.data.code;
    if (!raceCode) {
      throw new Error("code missing (ENVIRONMENT dev bypass off?)");
    }

    // Simulate a concurrent claim: another member takes the target email
    // after the token was issued but before it's verified.
    const racer = await seedStore(`Racer ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    await db
      .update(schema.members)
      .set({ email: raceEmail })
      .where(eq(schema.members.id, racer.member_id));

    const verifyRes = await app.request(
      "/api/stores/me/email-change/verify",
      withAuth(token, jsonInit("POST", { code: raceCode })),
      env,
    );
    expect(verifyRes.status).toBe(400);
    const verifyBody = (await verifyRes.json()) as {
      error: { code: string };
    };
    // Authenticated caller, so the reason can be specific — unlike the
    // anti-enumeration INVALID_CODE the unauthenticated route returns.
    expect(verifyBody.error.code).toBe("VALIDATION_ERROR");

    // The original member's email was NOT changed.
    const rows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberId));
    expect(rows[0]?.email).not.toBe(raceEmail);
  });
});

// ---------------------------------------------------------------------------
// POST /api/stores/me/email-change — rate limiting
// ---------------------------------------------------------------------------

describe("POST /api/stores/me/email-change rate limiting", () => {
  it("rejects the 6th attempt within the hour with 429 RATE_LIMITED", async () => {
    const { member_id: memberId, session_token: token } = await seedStore(
      `Email Change Cap Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    await db
      .update(schema.members)
      .set({
        email_change_attempt_count: EMAIL_CHANGE_HOURLY_CAP,
        email_change_window_started_at: now() - 5 * 60 * 1000,
      })
      .where(eq(schema.members.id, memberId));

    const res = await app.request(
      "/api/stores/me/email-change",
      withAuth(
        token,
        jsonInit("POST", {
          new_email: `blocked-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });

  it("still succeeds at one below the cap (boundary)", async () => {
    const { member_id: memberId, session_token: token } = await seedStore(
      `Email Change Below Cap Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    await db
      .update(schema.members)
      .set({
        email_change_attempt_count: EMAIL_CHANGE_HOURLY_CAP - 1,
        email_change_window_started_at: now() - 5 * 60 * 1000,
      })
      .where(eq(schema.members.id, memberId));

    const res = await app.request(
      "/api/stores/me/email-change",
      withAuth(
        token,
        jsonInit("POST", {
          new_email: `allowed-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("resets the window once it has expired", async () => {
    const { member_id: memberId, session_token: token } = await seedStore(
      `Email Change Window Reset Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    await db
      .update(schema.members)
      .set({
        email_change_attempt_count: EMAIL_CHANGE_HOURLY_CAP,
        email_change_window_started_at: now() - EMAIL_CHANGE_WINDOW_MS - 1,
      })
      .where(eq(schema.members.id, memberId));

    const res = await app.request(
      "/api/stores/me/email-change",
      withAuth(
        token,
        jsonInit("POST", {
          new_email: `fresh-window-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );
    expect(res.status).toBe(200);

    const rows = await db
      .select({
        count: schema.members.email_change_attempt_count,
        window_started_at: schema.members.email_change_window_started_at,
      })
      .from(schema.members)
      .where(eq(schema.members.id, memberId));
    expect(rows[0]?.count).toBe(1);
    expect(rows[0]?.window_started_at).toBeGreaterThan(
      now() - EMAIL_CHANGE_WINDOW_MS,
    );
  });

  it("counts a conflicting (already-registered) attempt toward the cap", async () => {
    const storeA = await seedStore(`Conflict Cap A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Conflict Cap B ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    const storeBEmail = (
      await db
        .select({ email: schema.members.email })
        .from(schema.members)
        .where(eq(schema.members.id, storeB.member_id))
    )[0]?.email;
    if (!storeBEmail) throw new Error("seedStore did not set a member email");

    await db
      .update(schema.members)
      .set({
        email_change_attempt_count: EMAIL_CHANGE_HOURLY_CAP - 1,
        email_change_window_started_at: now() - 5 * 60 * 1000,
      })
      .where(eq(schema.members.id, storeA.member_id));

    // 5th attempt: conflicts (already used by store B's member) but still
    // counts toward the cap.
    const conflictRes = await app.request(
      "/api/stores/me/email-change",
      withAuth(
        storeA.session_token,
        jsonInit("POST", { new_email: storeBEmail }),
      ),
      env,
    );
    expect(conflictRes.status).toBe(400);

    // 6th attempt: a perfectly valid new email, but the cap was already hit
    // by the conflicting attempt above.
    const blockedRes = await app.request(
      "/api/stores/me/email-change",
      withAuth(
        storeA.session_token,
        jsonInit("POST", {
          new_email: `never-sent-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );
    expect(blockedRes.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// POST /api/stores/me/email-change/verify
//
// A separate handler from POST /api/auth/verify-code — it resolves the member
// from the session rather than a submitted address — so its own copy of the
// attempt accounting needs its own coverage.
// ---------------------------------------------------------------------------

/** Requests a change and returns the passcode the dev echo hands back. */
async function requestEmailChange(
  sessionToken: string,
  newEmail: string,
): Promise<string> {
  const res = await app.request(
    "/api/stores/me/email-change",
    withAuth(sessionToken, jsonInit("POST", { new_email: newEmail })),
    devEnv,
  );
  const body = (await res.json()) as { data: { code?: string } };
  if (!body.data.code) throw new Error("email-change code missing");
  return body.data.code;
}

async function verifyEmailChange(
  sessionToken: string,
  code: string,
): Promise<Response> {
  return app.request(
    "/api/stores/me/email-change/verify",
    withAuth(sessionToken, jsonInit("POST", { code })),
    env,
  );
}

async function changeTokenFor(memberId: string) {
  const rows = await createDb(env.DB)
    .select({
      id: schema.magicLinkTokens.id,
      used_at: schema.magicLinkTokens.used_at,
      attempt_count: schema.magicLinkTokens.attempt_count,
    })
    .from(schema.magicLinkTokens)
    .where(eq(schema.magicLinkTokens.member_id, memberId))
    .limit(1);
  return rows[0];
}

describe("POST /api/stores/me/email-change/verify", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request(
      "/api/stores/me/email-change/verify",
      jsonInit("POST", { code: "123456" }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("rejects a wrong code and counts the attempt", async () => {
    const { member_id, session_token } = await seedStore(
      `変更誤入力店 ${crypto.randomUUID()}`,
    );
    const code = await requestEmailChange(
      session_token,
      `wrong-${crypto.randomUUID()}@test.internal`,
    );

    const res = await verifyEmailChange(
      session_token,
      code === "000000" ? "111111" : "000000",
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_CODE");

    const row = await changeTokenFor(member_id);
    expect(row?.attempt_count).toBe(1);
    expect(row?.used_at).toBeNull();
  });

  it("consumes the code after OTP_MAX_ATTEMPTS failures", async () => {
    const { member_id, session_token } = await seedStore(
      `変更総当り店 ${crypto.randomUUID()}`,
    );
    const code = await requestEmailChange(
      session_token,
      `burn-${crypto.randomUUID()}@test.internal`,
    );
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      expect((await verifyEmailChange(session_token, wrong)).status).toBe(400);
    }

    const row = await changeTokenFor(member_id);
    expect(row?.used_at).not.toBeNull();
    // The genuine code is spent along with the budget.
    expect((await verifyEmailChange(session_token, code)).status).toBe(400);
  });

  it("never lets a concurrent burst exceed the attempt budget", async () => {
    const { member_id, session_token } = await seedStore(
      `変更同時攻撃店 ${crypto.randomUUID()}`,
    );
    const code = await requestEmailChange(
      session_token,
      `race-${crypto.randomUUID()}@test.internal`,
    );
    const wrong = code === "000000" ? "111111" : "000000";

    await Promise.all(
      Array.from({ length: 20 }, () => verifyEmailChange(session_token, wrong)),
    );

    const row = await changeTokenFor(member_id);
    expect(row?.attempt_count).toBeLessThanOrEqual(OTP_MAX_ATTEMPTS);
    expect(row?.used_at).not.toBeNull();
  });

  it("rejects an expired code", async () => {
    const { member_id, session_token } = await seedStore(
      `変更期限切れ店 ${crypto.randomUUID()}`,
    );
    const code = await requestEmailChange(
      session_token,
      `expired-${crypto.randomUUID()}@test.internal`,
    );
    const row = await changeTokenFor(member_id);
    if (!row) throw new Error("no token row");
    await createDb(env.DB)
      .update(schema.magicLinkTokens)
      .set({ expires_at: Date.now() - 1000 })
      .where(eq(schema.magicLinkTokens.id, row.id));

    expect((await verifyEmailChange(session_token, code)).status).toBe(400);
  });

  it("rejects a malformed code before touching the database", async () => {
    const { session_token } = await seedStore(
      `変更不正形式店 ${crypto.randomUUID()}`,
    );

    expect((await verifyEmailChange(session_token, "12345")).status).toBe(400);
    expect((await verifyEmailChange(session_token, "abcdef")).status).toBe(400);
  });

  it("does not accept another member's email_change code", async () => {
    const storeA = await seedStore(`変更A店 ${crypto.randomUUID()}`);
    const storeB = await seedStore(`変更B店 ${crypto.randomUUID()}`);
    const codeForA = await requestEmailChange(
      storeA.session_token,
      `cross-${crypto.randomUUID()}@test.internal`,
    );

    expect(
      (await verifyEmailChange(storeB.session_token, codeForA)).status,
    ).toBe(400);
  });
});
