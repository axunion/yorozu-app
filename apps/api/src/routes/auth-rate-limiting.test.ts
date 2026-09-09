/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Auth rate limiting (roadmap Phase 2 item 6, production-deploy gate):
 * per-member hourly cap on Magic Link issuance, and the supersede-not-delete
 * prerequisite that makes the cap countable.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

const devEnv = { ...env, ENVIRONMENT: "development" };
const HOUR_MS = 60 * 60 * 1000;

/** Directly seeds `count` magic_link_tokens rows for a member, `ageMs` old. */
async function seedRecentTokens(
  storeId: string,
  memberId: string,
  count: number,
  ageMs: number,
) {
  const db = createDb(env.DB);
  const createdAt = Date.now() - ageMs;
  await db.insert(schema.magicLinkTokens).values(
    Array.from({ length: count }, (_, i) => ({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: memberId,
      token: crypto.randomUUID(),
      purpose: "login" as const,
      expires_at: createdAt + 15 * 60 * 1000,
      created_at: createdAt + i, // stable ordering, all still "recent"
    })),
  );
}

/** Looks up the login email (members.email) for a seeded store's owner. */
async function memberEmail(memberId: string): Promise<string> {
  const db = createDb(env.DB);
  const rows = await db
    .select({ email: schema.members.email })
    .from(schema.members)
    .where(eq(schema.members.id, memberId));
  const email = rows[0]?.email;
  if (!email) throw new Error("seedStore did not set a member email");
  return email;
}

describe("issueVerificationCode dedup is member-scoped, not store-scoped", () => {
  it("two members of the same store requesting codes don't invalidate each other", async () => {
    const { id: storeId, member_id: ownerMemberId } = await seedStore(
      `Multi Member Store ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const ownerEmail = await memberEmail(ownerMemberId);

    // Directly seed a second (staff) member under the same store — the
    // invite endpoint ships in a later slice.
    const staffMemberId = crypto.randomUUID();
    const staffEmail = `staff-${crypto.randomUUID()}@test.internal`;
    await db.insert(schema.members).values({
      id: staffMemberId,
      store_id: storeId,
      email: staffEmail,
      role: "staff",
      status: "active",
      activated_at: Date.now(),
    });

    const ownerRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: ownerEmail }),
      devEnv,
    );
    const ownerBody = (await ownerRes.json()) as { data: { code?: string } };
    const ownerCode = ownerBody.data.code;
    if (!ownerCode) throw new Error("owner code missing");

    // The staff member's login request must NOT supersede the owner's
    // still-unused code — under the old store-scoped dedup (store_id +
    // purpose), this second request would have marked the owner's row
    // used_at, breaking it. member-scoped dedup must leave it untouched.
    const staffRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: staffEmail }),
      devEnv,
    );
    const staffBody = (await staffRes.json()) as { data: { code?: string } };
    expect(staffBody.data.code).toBeTruthy();

    // The digest is salted with the row id, so the owner's row is found by
    // member rather than by hashing the code they were handed.
    const ownerTokenRow = await db
      .select({ used_at: schema.magicLinkTokens.used_at })
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, ownerMemberId))
      .then((rows) => rows[0]);
    expect(ownerTokenRow?.used_at).toBeNull();

    // The owner's code still verifies — the definitive proof.
    const ownerVerifyRes = await app.request(
      "/api/auth/verify-code",
      jsonInit("POST", { email: ownerEmail, code: ownerCode }),
      env,
    );
    expect(ownerVerifyRes.status).toBe(200);
  });

  it("caps one member of a store without affecting another member of the same store", async () => {
    const { id: storeId, member_id: ownerMemberId } = await seedStore(
      `Same Store Cap Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const ownerEmail = await memberEmail(ownerMemberId);

    const staffMemberId = crypto.randomUUID();
    const staffEmail = `staff-cap-${crypto.randomUUID()}@test.internal`;
    await db.insert(schema.members).values({
      id: staffMemberId,
      store_id: storeId,
      email: staffEmail,
      role: "staff",
      status: "active",
      activated_at: Date.now(),
    });

    // Cap only the owner member (a store-scoped cap would also block staff).
    await seedRecentTokens(storeId, ownerMemberId, 5, 5 * 60 * 1000);

    const ownerRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: ownerEmail }),
      devEnv,
    );
    const ownerBody = (await ownerRes.json()) as { data: { code?: string } };
    expect(ownerBody.data.code).toBeUndefined();

    const staffRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: staffEmail }),
      devEnv,
    );
    const staffBody = (await staffRes.json()) as { data: { code?: string } };
    expect(staffBody.data.code).toBeTruthy();
  });
});

describe("issueVerificationCode supersession (UPDATE, not DELETE)", () => {
  it("fails a superseded login code at verify exactly like a consumed one", async () => {
    const { member_id: memberId } = await seedStore(
      `Supersede Login Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const email = await memberEmail(memberId);

    const firstRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      devEnv,
    );
    const firstBody = (await firstRes.json()) as { data: { code?: string } };
    const firstCode = firstBody.data.code;
    if (!firstCode) throw new Error("first code missing");

    // Re-request supersedes the first code.
    await app.request("/api/auth/login", jsonInit("POST", { email }), devEnv);

    const firstVerifyRes = await app.request(
      "/api/auth/verify-code",
      jsonInit("POST", { email, code: firstCode }),
      env,
    );
    expect(firstVerifyRes.status).toBe(400);

    // Both rows still exist (UPDATE, not DELETE) and exactly one is live —
    // the count is what the hourly cap reads, so a DELETE here would let a
    // caller mint codes past it.
    const rows = await db
      .select({ used_at: schema.magicLinkTokens.used_at })
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, memberId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.used_at === null)).toHaveLength(1);
  });
});

describe("POST /api/auth/login rate limiting", () => {
  it("issues no token on the 6th request within an hour, yet still returns sent:true", async () => {
    const { id: storeId, member_id: memberId } = await seedStore(
      `Cap Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const email = await memberEmail(memberId);

    await seedRecentTokens(storeId, memberId, 5, 5 * 60 * 1000); // 5 tokens, 5 min old

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      devEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { sent: true; code?: string };
    };
    expect(body.data.sent).toBe(true);
    expect(body.data.code).toBeUndefined();

    // No 6th row was inserted.
    const rows = await db
      .select({ id: schema.magicLinkTokens.id })
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, memberId));
    expect(rows).toHaveLength(5);
  });

  it("still issues a token at 4 recent requests (boundary below the cap)", async () => {
    const { id: storeId, member_id: memberId } = await seedStore(
      `Below Cap Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const email = await memberEmail(memberId);

    await seedRecentTokens(storeId, memberId, 4, 5 * 60 * 1000);

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      devEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { sent: true; code?: string };
    };
    expect(body.data.code).toBeTruthy();

    const rows = await db
      .select({ id: schema.magicLinkTokens.id })
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, memberId));
    expect(rows).toHaveLength(5);
  });

  it("caps only the affected member — a different member is unaffected", async () => {
    const capped = await seedStore(`Capped Store ${crypto.randomUUID()}`);
    const other = await seedStore(`Other Store ${crypto.randomUUID()}`);
    const [cappedEmail, otherEmail] = await Promise.all([
      memberEmail(capped.member_id),
      memberEmail(other.member_id),
    ]);

    await seedRecentTokens(capped.id, capped.member_id, 5, 5 * 60 * 1000);

    const cappedRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: cappedEmail }),
      devEnv,
    );
    const cappedBody = (await cappedRes.json()) as {
      data: { code?: string };
    };
    expect(cappedBody.data.code).toBeUndefined();

    const otherRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: otherEmail }),
      devEnv,
    );
    const otherBody = (await otherRes.json()) as {
      data: { code?: string };
    };
    expect(otherBody.data.code).toBeTruthy();
  });

  it("resets outside the rolling hour window", async () => {
    const { id: storeId, member_id: memberId } = await seedStore(
      `Cap Reset Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const email = await memberEmail(memberId);

    // 5 tokens, all older than the 1-hour window.
    await seedRecentTokens(storeId, memberId, 5, HOUR_MS + 5 * 60 * 1000);

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      devEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { sent: true; code?: string };
    };
    expect(body.data.code).toBeTruthy();

    const rows = await db
      .select({ id: schema.magicLinkTokens.id })
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, memberId));
    expect(rows).toHaveLength(6);
  });

  it("does not leak registration status via the response shape when rate-limited", async () => {
    // Anti-enumeration: a rate-limited existing member and an unregistered
    // email must be indistinguishable in production mode (no code
    // either way, identical status/body shape).
    const { id: storeId, member_id: memberId } = await seedStore(
      `Anti Enum Test ${crypto.randomUUID()}`,
    );
    const email = await memberEmail(memberId);
    await seedRecentTokens(storeId, memberId, 5, 5 * 60 * 1000);

    const rateLimitedRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email }),
      env, // production mode: no dev bypass
    );
    const unknownRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", {
        email: `unknown-${crypto.randomUUID()}@test.internal`,
      }),
      env,
    );

    expect(rateLimitedRes.status).toBe(unknownRes.status);
    const rateLimitedBody = await rateLimitedRes.json();
    const unknownBody = await unknownRes.json();
    expect(rateLimitedBody).toEqual(unknownBody);
  });
});

describe("POST /api/stores/me/email-change rate limiting", () => {
  it("shares the same per-member cap as login", async () => {
    const {
      id: storeId,
      member_id: memberId,
      session_token: token,
    } = await seedStore(`Email Change Cap Test ${crypto.randomUUID()}`);
    await seedRecentTokens(storeId, memberId, 5, 5 * 60 * 1000);

    const res = await app.request(
      "/api/stores/me/email-change",
      withAuth(
        token,
        jsonInit("POST", {
          new_email: `new-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      devEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { sent: true; code?: string };
    };
    expect(body.data.sent).toBe(true);
    expect(body.data.code).toBeUndefined();

    // The member's email is unchanged — no token was ever issued to verify.
    const db = createDb(env.DB);
    const rows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, memberId));
    const emailChangeTokens = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.member_id, memberId),
          eq(schema.magicLinkTokens.purpose, "email_change"),
        ),
      );
    expect(emailChangeTokens).toHaveLength(0);
    expect(rows[0]?.email).toBeTruthy();
  });
});
