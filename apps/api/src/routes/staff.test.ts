/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Staff management (roadmap Phase 5 item 1): owner invites/lists/removes
 * members of their own store.
 */
import { env } from "cloudflare:workers";
import { hashToken } from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

describe("POST /api/staff", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request(
      "/api/staff",
      jsonInit("POST", { email: "staff@example.com" }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for a staff-role session (owner-only)", async () => {
    const { session_token: token } = await seedStore(
      `Staff Invite Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request(
      "/api/staff",
      withAuth(
        token,
        jsonInit("POST", { email: `new-${crypto.randomUUID()}@test.internal` }),
      ),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("creates a pending staff member and issues an invite token", async () => {
    const { id: storeId, session_token: token } = await seedStore(
      `Staff Invite OK Test ${crypto.randomUUID()}`,
    );
    const staffEmail = `invitee-${crypto.randomUUID()}@test.internal`;

    const res = await app.request(
      "/api/staff",
      withAuth(token, jsonInit("POST", { email: staffEmail })),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; email: string; role: string; status: string };
    };
    expect(body.data.email).toBe(staffEmail);
    expect(body.data.role).toBe("staff");
    expect(body.data.status).toBe("pending");

    const db = createDb(env.DB);
    const memberRows = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, body.data.id));
    expect(memberRows[0]?.store_id).toBe(storeId);

    const tokens = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.member_id, body.data.id),
          eq(schema.magicLinkTokens.purpose, "invite"),
          isNull(schema.magicLinkTokens.used_at),
        ),
      );
    expect(tokens).toHaveLength(1);
  });

  it("includes the code and landing URL when ENVIRONMENT=development, omits them otherwise", async () => {
    const { session_token: token } = await seedStore(
      `Staff Invite Dev Test ${crypto.randomUUID()}`,
    );

    const prodRes = await app.request(
      "/api/staff",
      withAuth(
        token,
        jsonInit("POST", {
          email: `prod-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      { ...env, ENVIRONMENT: "production" },
    );
    const prodBody = (await prodRes.json()) as {
      data: { code?: string; invite_url?: string };
    };
    expect(prodBody.data.code).toBeUndefined();
    expect(prodBody.data.invite_url).toBeUndefined();

    const devRes = await app.request(
      "/api/staff",
      withAuth(
        token,
        jsonInit("POST", {
          email: `dev-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      { ...env, ENVIRONMENT: "development" },
    );
    const devBody = (await devRes.json()) as {
      data: { code?: string; invite_url?: string };
    };
    expect(devBody.data.code).toMatch(/^\d{6}$/);
    // A plain login page, carrying no credential of its own.
    expect(devBody.data.invite_url).toMatch(
      /^http:\/\/admin\.localhost\/login\?email=/,
    );
  });

  it("defaults role to staff when omitted, and accepts an explicit owner invite", async () => {
    const { session_token: token } = await seedStore(
      `Staff Invite Role Test ${crypto.randomUUID()}`,
    );

    const defaultRes = await app.request(
      "/api/staff",
      withAuth(
        token,
        jsonInit("POST", { email: `def-${crypto.randomUUID()}@test.internal` }),
      ),
      env,
    );
    const defaultBody = (await defaultRes.json()) as { data: { role: string } };
    expect(defaultBody.data.role).toBe("staff");

    const ownerRes = await app.request(
      "/api/staff",
      withAuth(
        token,
        jsonInit("POST", {
          email: `co-owner-${crypto.randomUUID()}@test.internal`,
          role: "owner",
        }),
      ),
      env,
    );
    const ownerBody = (await ownerRes.json()) as { data: { role: string } };
    expect(ownerBody.data.role).toBe("owner");
  });

  it("returns 400 when the email is already used by any member", async () => {
    const storeA = await seedStore(`Staff Dup A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Staff Dup B ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    const memberBEmailRows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, storeB.member_id));
    const memberBEmail = memberBEmailRows[0]?.email;
    if (!memberBEmail) throw new Error("seedStore did not set a member email");

    const res = await app.request(
      "/api/staff",
      withAuth(storeA.session_token, jsonInit("POST", { email: memberBEmail })),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for an invalid email", async () => {
    const { session_token: token } = await seedStore(
      `Staff Invalid Email Test ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      "/api/staff",
      withAuth(token, jsonInit("POST", { email: "not-an-email" })),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 for an invalid role value", async () => {
    const { session_token: token } = await seedStore(
      `Staff Invalid Role Test ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      "/api/staff",
      withAuth(
        token,
        jsonInit("POST", {
          email: `bad-role-${crypto.randomUUID()}@test.internal`,
          role: "admin",
        }),
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects invites past the per-store hourly cap", async () => {
    const {
      id: storeId,
      member_id: ownerMemberId,
      session_token: token,
    } = await seedStore(`Staff Invite Cap Test ${crypto.randomUUID()}`);
    const db = createDb(env.DB);

    // Seed MAGIC_LINK_HOURLY_CAP (5) recent invite tokens for this store,
    // each tied to a distinct member (so the per-member cap in
    // issueVerificationCode can't itself explain the rejection).
    for (let i = 0; i < 5; i++) {
      const seededMemberId = crypto.randomUUID();
      await db.insert(schema.members).values({
        id: seededMemberId,
        store_id: storeId,
        email: `cap-seed-${i}-${crypto.randomUUID()}@test.internal`,
        role: "staff",
      });
      await db.insert(schema.magicLinkTokens).values({
        id: crypto.randomUUID(),
        store_id: storeId,
        member_id: seededMemberId,
        token: crypto.randomUUID(),
        purpose: "invite",
        expires_at: Date.now() + 15 * 60 * 1000,
      });
    }

    const res = await app.request(
      "/api/staff",
      withAuth(
        token,
        jsonInit("POST", {
          email: `over-cap-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");

    // No new member was created for the rejected invite (only the 5 seeded
    // + the original owner exist).
    const members = await db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(eq(schema.members.store_id, storeId));
    expect(members).toHaveLength(6);
    expect(members.map((m) => m.id)).toContain(ownerMemberId);
  });

  it("two concurrent staff invites don't invalidate each other's token", async () => {
    const { session_token: token } = await seedStore(
      `Staff Invite Dedup Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);

    const firstEmail = `invite-a-${crypto.randomUUID()}@test.internal`;
    const firstRes = await app.request(
      "/api/staff",
      withAuth(token, jsonInit("POST", { email: firstEmail })),
      env,
    );
    const firstBody = (await firstRes.json()) as { data: { id: string } };

    const secondEmail = `invite-b-${crypto.randomUUID()}@test.internal`;
    await app.request(
      "/api/staff",
      withAuth(token, jsonInit("POST", { email: secondEmail })),
      env,
    );

    // The first invite's token is still unused — the second invite (a
    // different member) must not have superseded it.
    const firstTokens = await db
      .select({ used_at: schema.magicLinkTokens.used_at })
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, firstBody.data.id));
    expect(firstTokens).toHaveLength(1);
    expect(firstTokens[0]?.used_at).toBeNull();
  });
});

describe("invite → POST /api/auth/verify-code", () => {
  it("activates the invited member and creates a session with the right role, without touching the store", async () => {
    const { id: storeId, session_token: ownerToken } = await seedStore(
      `Staff Invite Verify Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const storeBefore = await db
      .select({ status: schema.stores.status })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .then((rows) => rows[0]);

    const staffEmail = `verify-invite-${crypto.randomUUID()}@test.internal`;
    const inviteRes = await app.request(
      "/api/staff",
      withAuth(ownerToken, jsonInit("POST", { email: staffEmail })),
      { ...env, ENVIRONMENT: "development" },
    );
    const inviteBody = (await inviteRes.json()) as {
      data: { id: string; code?: string };
    };
    const staffMemberId = inviteBody.data.id;
    const inviteCode = inviteBody.data.code;
    if (!inviteCode) throw new Error("invite code missing");

    const verifyRes = await app.request(
      "/api/auth/verify-code",
      jsonInit("POST", { email: staffEmail, code: inviteCode }),
      env,
    );
    expect(verifyRes.status).toBe(200);

    const memberAfter = await db
      .select({
        status: schema.members.status,
        activated_at: schema.members.activated_at,
      })
      .from(schema.members)
      .where(eq(schema.members.id, staffMemberId))
      .then((rows) => rows[0]);
    expect(memberAfter?.status).toBe("active");
    expect(memberAfter?.activated_at).toBeTruthy();

    // The store's own status is untouched by an invite verification.
    const storeAfter = await db
      .select({ status: schema.stores.status })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId))
      .then((rows) => rows[0]);
    expect(storeAfter?.status).toBe(storeBefore?.status);

    const setCookie = verifyRes.headers.get("Set-Cookie") ?? "";
    const staffSessionToken = /session_token=([^;]+)/.exec(setCookie)?.[1];
    if (!staffSessionToken) throw new Error("session_token cookie not set");

    const meRes = await app.request(
      "/api/auth/me",
      withAuth(staffSessionToken),
      env,
    );
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as {
      data: { email: string; role: string };
    };
    expect(meBody.data.email).toBe(staffEmail);
    expect(meBody.data.role).toBe("staff");
  });
});

describe("GET /api/staff", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request("/api/staff", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a staff-role session", async () => {
    const { session_token: token } = await seedStore(
      `Staff List Forbidden Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request("/api/staff", withAuth(token), env);
    expect(res.status).toBe(403);
  });

  it("lists only the calling store's members", async () => {
    const storeA = await seedStore(`Staff List A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Staff List B ${crypto.randomUUID()}`);
    await app.request(
      "/api/staff",
      withAuth(
        storeA.session_token,
        jsonInit("POST", {
          email: `a-staff-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );

    const res = await app.request(
      "/api/staff",
      withAuth(storeA.session_token),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string }[] };
    // Owner + the one invited staff member = 2, none from storeB.
    expect(body.data).toHaveLength(2);

    const storeBRes = await app.request(
      "/api/staff",
      withAuth(storeB.session_token),
      env,
    );
    const storeBBody = (await storeBRes.json()) as { data: { id: string }[] };
    expect(storeBBody.data).toHaveLength(1);
    expect(storeBBody.data[0]?.id).toBe(storeB.member_id);
  });
});

describe("DELETE /api/staff/:id", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request(
      `/api/staff/${crypto.randomUUID()}`,
      { method: "DELETE" },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for a staff-role session", async () => {
    const { session_token: token } = await seedStore(
      `Staff Remove Forbidden Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request(
      `/api/staff/${crypto.randomUUID()}`,
      { method: "DELETE", ...withAuth(token) },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("removes a staff member and deletes their sessions", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Staff Remove OK Test ${crypto.randomUUID()}`,
    );
    const inviteRes = await app.request(
      "/api/staff",
      withAuth(
        ownerToken,
        jsonInit("POST", {
          email: `removable-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );
    const inviteBody = (await inviteRes.json()) as { data: { id: string } };
    const staffMemberId = inviteBody.data.id;

    // Give the staff member a session directly (invite endpoint doesn't
    // activate them — that happens at POST /api/auth/verify-code).
    const db = createDb(env.DB);
    const staffRows = await db
      .select({ store_id: schema.members.store_id })
      .from(schema.members)
      .where(eq(schema.members.id, staffMemberId));
    const storeId = staffRows[0]?.store_id;
    if (!storeId) throw new Error("member not found");
    const staffSessionToken = crypto.randomUUID();
    await db.insert(schema.sessions).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: staffMemberId,
      session_token: await hashToken(staffSessionToken),
      expires_at: Date.now() + 60_000,
    });

    const res = await app.request(
      `/api/staff/${staffMemberId}`,
      { method: "DELETE", ...withAuth(ownerToken) },
      env,
    );
    expect(res.status).toBe(200);

    const memberRows = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, staffMemberId));
    expect(memberRows).toHaveLength(0);

    const sessionRows = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.member_id, staffMemberId));
    expect(sessionRows).toHaveLength(0);

    // The removed member's session no longer authenticates.
    const meRes = await app.request(
      "/api/auth/me",
      withAuth(staffSessionToken),
      env,
    );
    expect(meRes.status).toBe(401);
  });

  it("removes a member who already holds shift-management rows", async () => {
    const { id: storeId, session_token: ownerToken } = await seedStore(
      `Staff Remove With Shifts ${crypto.randomUUID()}`,
    );
    const inviteRes = await app.request(
      "/api/staff",
      withAuth(
        ownerToken,
        jsonInit("POST", {
          email: `shift-staff-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );
    const inviteBody = (await inviteRes.json()) as { data: { id: string } };
    const staffMemberId = inviteBody.data.id;

    // Everything in the shift domain that points at a member. Without these
    // rows the delete succeeds trivially; with them it must still succeed.
    const db = createDb(env.DB);
    const positionId = crypto.randomUUID();
    const periodId = crypto.randomUUID();
    const submissionId = crypto.randomUUID();
    await db
      .insert(schema.positions)
      .values({ id: positionId, store_id: storeId, name: "キッチン" });
    await db.insert(schema.memberPositions).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: staffMemberId,
      position_id: positionId,
    });
    await db.insert(schema.memberWorkProfiles).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: staffMemberId,
      hourly_wage: 1050,
    });
    await db.insert(schema.schedulePeriods).values({
      id: periodId,
      store_id: storeId,
      start_date: "2026-11-01",
      end_date: "2026-11-15",
      submission_deadline: Date.now(),
    });
    await db.insert(schema.availabilitySubmissions).values({
      id: submissionId,
      store_id: storeId,
      period_id: periodId,
      member_id: staffMemberId,
    });
    await db.insert(schema.availabilityEntries).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      submission_id: submissionId,
      work_date: "2026-11-02",
      kind: "day_off",
    });
    await db.insert(schema.shifts).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      period_id: periodId,
      member_id: staffMemberId,
      work_date: "2026-11-03",
      start_minutes: 540,
      end_minutes: 1020,
      break_minutes: 60,
    });

    const res = await app.request(
      `/api/staff/${staffMemberId}`,
      { method: "DELETE", ...withAuth(ownerToken) },
      env,
    );
    expect(res.status).toBe(200);

    // The member's shift rows go with them; the store's own position stays.
    const shiftRows = await db
      .select()
      .from(schema.shifts)
      .where(eq(schema.shifts.member_id, staffMemberId));
    expect(shiftRows).toHaveLength(0);

    const submissionRows = await db
      .select()
      .from(schema.availabilitySubmissions)
      .where(eq(schema.availabilitySubmissions.member_id, staffMemberId));
    expect(submissionRows).toHaveLength(0);

    const entryRows = await db
      .select()
      .from(schema.availabilityEntries)
      .where(eq(schema.availabilityEntries.submission_id, submissionId));
    expect(entryRows).toHaveLength(0);

    const positionLinkRows = await db
      .select()
      .from(schema.memberPositions)
      .where(eq(schema.memberPositions.member_id, staffMemberId));
    expect(positionLinkRows).toHaveLength(0);

    const profileRows = await db
      .select()
      .from(schema.memberWorkProfiles)
      .where(eq(schema.memberWorkProfiles.member_id, staffMemberId));
    expect(profileRows).toHaveLength(0);

    const positionRows = await db
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.id, positionId));
    expect(positionRows).toHaveLength(1);
  });

  it("returns 400 when removing your own member row", async () => {
    const { member_id: ownerMemberId, session_token: token } = await seedStore(
      `Staff Self Remove Test ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      `/api/staff/${ownerMemberId}`,
      { method: "DELETE", ...withAuth(token) },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("allows removing a co-owner (self-removal is the only block)", async () => {
    const { id: storeId, session_token: token } = await seedStore(
      `Staff Co-Owner Remove Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);
    const secondOwnerId = crypto.randomUUID();
    await db.insert(schema.members).values({
      id: secondOwnerId,
      store_id: storeId,
      email: `second-owner-${crypto.randomUUID()}@test.internal`,
      role: "owner",
      status: "active",
      activated_at: Date.now(),
    });

    const res = await app.request(
      `/api/staff/${secondOwnerId}`,
      { method: "DELETE", ...withAuth(token) },
      env,
    );
    expect(res.status).toBe(200);

    const memberRows = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, secondOwnerId));
    expect(memberRows).toHaveLength(0);
  });
});

describe("Tenant isolation for /api/staff", () => {
  // POST /api/staff has no store-targeting parameter — it always invites
  // into the caller's own store_id — so cross-tenant invite isn't a
  // separately testable attack surface; only list and remove are checked.
  it("cannot list or remove another store's members", async () => {
    const storeA = await seedStore(`Isolation A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Isolation B ${crypto.randomUUID()}`);

    // A cannot remove B's owner member.
    const removeRes = await app.request(
      `/api/staff/${storeB.member_id}`,
      { method: "DELETE", ...withAuth(storeA.session_token) },
      env,
    );
    expect(removeRes.status).toBe(404);

    // B's member list is unaffected and doesn't leak into A's list.
    const listARes = await app.request(
      "/api/staff",
      withAuth(storeA.session_token),
      env,
    );
    const listABody = (await listARes.json()) as { data: { id: string }[] };
    expect(listABody.data.map((m) => m.id)).not.toContain(storeB.member_id);
  });
});
