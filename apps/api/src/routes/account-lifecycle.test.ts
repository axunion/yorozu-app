/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Account lifecycle (roadmap Phase 5 item 2): owner self-service
 * suspend/reactivate, and delete + export.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

const devEnv = { ...env, ENVIRONMENT: "development" };

/**
 * Seeds one row into every store-scoped table (beyond stores/members,
 * already created by seedStore) so delete-everything tests can assert
 * nothing is left behind.
 */
async function seedFullStore(storeId: string) {
  const db = createDb(env.DB);
  const now = Date.now();

  const categoryId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  const groupId = crypto.randomUUID();
  const optionId = crypto.randomUUID();
  const seatId = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const orderItemId = crypto.randomUUID();

  const [owner] = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(eq(schema.members.store_id, storeId))
    .limit(1);
  if (!owner) throw new Error("seedFullStore requires an existing member");
  await db.insert(schema.magicLinkTokens).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    member_id: owner.id,
    token: crypto.randomUUID(),
    purpose: "login",
    expires_at: now + 15 * 60 * 1000,
  });

  await db.insert(schema.menuCategories).values({
    id: categoryId,
    store_id: storeId,
    name: "Category",
  });
  await db.insert(schema.menuItems).values({
    id: itemId,
    store_id: storeId,
    category_id: categoryId,
    name: "Item",
    price: 500,
  });
  await db.insert(schema.optionGroups).values({
    id: groupId,
    store_id: storeId,
    name: "Group",
  });
  await db.insert(schema.options).values({
    id: optionId,
    store_id: storeId,
    group_id: groupId,
    name: "Option",
  });
  await db.insert(schema.menuItemOptionGroups).values({
    id: crypto.randomUUID(),
    menu_item_id: itemId,
    group_id: groupId,
  });
  await db.insert(schema.seats).values({
    id: seatId,
    store_id: storeId,
    name: "Seat",
    qr_token: crypto.randomUUID(),
  });
  await db.insert(schema.staffCalls).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    seat_id: seatId,
    status: "resolved",
    resolved_at: now,
  });
  await db.insert(schema.orders).values({
    id: orderId,
    store_id: storeId,
    seat_id: seatId,
    status: "paid",
    closed_at: now,
  });
  await db.insert(schema.orderItems).values({
    id: orderItemId,
    store_id: storeId,
    order_id: orderId,
    menu_item_id: itemId,
    name_snapshot: "Item",
    unit_price_snapshot: 500,
    quantity: 1,
    status: "served",
  });
  await db.insert(schema.orderItemOptions).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    order_item_id: orderItemId,
    name_snapshot: "Option",
    group_name_snapshot: "Group",
    price_delta_snapshot: 0,
  });
  await db.insert(schema.payments).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    order_id: orderId,
    method: "cash",
    total_amount: 500,
    paid_at: now,
  });

  // Shift-management rows: a store that uses the second product must still be
  // deletable, and every one of these tables references stores or members.
  const positionId = crypto.randomUUID();
  const periodId = crypto.randomUUID();
  const submissionId = crypto.randomUUID();

  await db.insert(schema.positions).values({
    id: positionId,
    store_id: storeId,
    name: "ホール",
  });
  await db.insert(schema.memberPositions).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    member_id: owner.id,
    position_id: positionId,
  });
  await db.insert(schema.memberWorkProfiles).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    member_id: owner.id,
    hourly_wage: 1100,
  });
  await db.insert(schema.shiftPatterns).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    name: "早番",
    start_minutes: 540,
    end_minutes: 1020,
  });
  await db.insert(schema.staffingRequirements).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    weekday: 5,
    position_id: positionId,
    start_minutes: 1020,
    end_minutes: 1320,
    required_headcount: 2,
  });
  await db.insert(schema.schedulePeriods).values({
    id: periodId,
    store_id: storeId,
    start_date: "2026-09-01",
    end_date: "2026-09-15",
    submission_deadline: now,
  });
  await db.insert(schema.availabilitySubmissions).values({
    id: submissionId,
    store_id: storeId,
    period_id: periodId,
    member_id: owner.id,
    status: "submitted",
    submitted_at: now,
  });
  await db.insert(schema.availabilityEntries).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    submission_id: submissionId,
    work_date: "2026-09-01",
    kind: "available",
    start_minutes: 540,
    end_minutes: 1020,
  });
  await db.insert(schema.shifts).values({
    id: crypto.randomUUID(),
    store_id: storeId,
    period_id: periodId,
    member_id: owner.id,
    position_id: positionId,
    work_date: "2026-09-01",
    start_minutes: 540,
    end_minutes: 1020,
    break_minutes: 60,
  });

  return { itemId, groupId };
}

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
      created_at: createdAt + i,
    })),
  );
}

describe("POST /api/stores/me/suspend", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request(
      "/api/stores/me/suspend",
      { method: "POST" },
      env,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for a staff-role session", async () => {
    const { session_token: token } = await seedStore(
      `Suspend Forbidden Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(token) },
      env,
    );
    expect(res.status).toBe(403);
  });

  it("sets stores.status to suspended", async () => {
    const { id: storeId, session_token: token } = await seedStore(
      `Suspend OK Test ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(token) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("suspended");

    const db = createDb(env.DB);
    const storeRows = await db
      .select({ status: schema.stores.status })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId));
    expect(storeRows[0]?.status).toBe("suspended");
  });

  it("locks out the same session on the next request", async () => {
    const { session_token: token } = await seedStore(
      `Suspend Lockout Test ${crypto.randomUUID()}`,
    );
    await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(token) },
      env,
    );

    const res = await app.request("/api/auth/me", withAuth(token), env);
    expect(res.status).toBe(401);
  });

  it("only suspends the caller's own store, leaving other stores active", async () => {
    const storeA = await seedStore(
      `Suspend Isolation A ${crypto.randomUUID()}`,
    );
    const storeB = await seedStore(
      `Suspend Isolation B ${crypto.randomUUID()}`,
    );

    await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(storeA.session_token) },
      env,
    );

    const db = createDb(env.DB);
    const storeBRows = await db
      .select({ status: schema.stores.status })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeB.id));
    expect(storeBRows[0]?.status).toBe("active");

    // Store B's session still authenticates.
    const res = await app.request(
      "/api/auth/me",
      withAuth(storeB.session_token),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("deletes every session for the store, not just the caller's own", async () => {
    const { id: storeId, session_token: ownerToken } = await seedStore(
      `Suspend Session Wipe Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);

    const staffMemberId = crypto.randomUUID();
    await db.insert(schema.members).values({
      id: staffMemberId,
      store_id: storeId,
      email: `staff-${crypto.randomUUID()}@test.internal`,
      role: "staff",
      status: "active",
      activated_at: Date.now(),
    });
    const staffSessionToken = crypto.randomUUID();
    await db.insert(schema.sessions).values({
      id: crypto.randomUUID(),
      store_id: storeId,
      member_id: staffMemberId,
      session_token: staffSessionToken,
      expires_at: Date.now() + 60_000,
    });

    await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(ownerToken) },
      env,
    );

    const remaining = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.store_id, storeId));
    expect(remaining).toHaveLength(0);

    const staffRes = await app.request(
      "/api/auth/me",
      withAuth(staffSessionToken),
      env,
    );
    expect(staffRes.status).toBe(401);
  });
});

describe("POST /api/auth/login on a suspended store", () => {
  it("issues a reactivate-purpose token for an owner-role member", async () => {
    const {
      id: storeId,
      member_id: ownerMemberId,
      session_token: ownerToken,
    } = await seedStore(`Reactivate Login Test ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    const ownerEmailRows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, ownerMemberId));
    const ownerEmail = ownerEmailRows[0]?.email;
    if (!ownerEmail) throw new Error("seedStore did not set a member email");

    await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(ownerToken) },
      env,
    );

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: ownerEmail }),
      devEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toBeTruthy();

    const tokens = await db
      .select({ purpose: schema.magicLinkTokens.purpose })
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.store_id, storeId),
          eq(schema.magicLinkTokens.member_id, ownerMemberId),
          isNull(schema.magicLinkTokens.used_at),
        ),
      );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe("reactivate");
  });

  it("stays silent for a staff-role member on a suspended store", async () => {
    const { id: storeId, session_token: ownerToken } = await seedStore(
      `Reactivate Staff Silent Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);

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

    await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(ownerToken) },
      env,
    );

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: staffEmail }),
      devEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toBeUndefined();

    const tokens = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.member_id, staffMemberId));
    expect(tokens).toHaveLength(0);
  });

  it("resends invite (not reactivate) for a still-pending owner-role invite", async () => {
    // A second owner who was invited but hasn't verified yet must keep
    // completing their own onboarding, not accidentally reactivate the
    // store — reactivate only applies to an already-active owner.
    const { id: storeId, session_token: ownerToken } = await seedStore(
      `Reactivate Pending Owner Test ${crypto.randomUUID()}`,
    );
    const db = createDb(env.DB);

    const pendingOwnerId = crypto.randomUUID();
    const pendingOwnerEmail = `pending-owner-${crypto.randomUUID()}@test.internal`;
    await db.insert(schema.members).values({
      id: pendingOwnerId,
      store_id: storeId,
      email: pendingOwnerEmail,
      role: "owner",
      status: "pending",
    });

    await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(ownerToken) },
      env,
    );

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: pendingOwnerEmail }),
      devEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toBeTruthy();

    const tokens = await db
      .select({ purpose: schema.magicLinkTokens.purpose })
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.member_id, pendingOwnerId),
          isNull(schema.magicLinkTokens.used_at),
        ),
      );
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe("signup");
  });

  it("shares the per-member hourly cap with other purposes", async () => {
    const {
      id: storeId,
      member_id: ownerMemberId,
      session_token: ownerToken,
    } = await seedStore(`Reactivate Cap Test ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    const ownerEmailRows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, ownerMemberId));
    const ownerEmail = ownerEmailRows[0]?.email;
    if (!ownerEmail) throw new Error("seedStore did not set a member email");

    await seedRecentTokens(storeId, ownerMemberId, 5, 5 * 60 * 1000);

    // Suspend after seeding the cap-triggering tokens (the sessions those
    // tokens belong to aren't involved — seedRecentTokens only inserts
    // magic_link_tokens rows, not sessions).
    await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(ownerToken) },
      env,
    );

    const res = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: ownerEmail }),
      devEnv,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toBeUndefined();

    const reactivateTokens = await db
      .select({ id: schema.magicLinkTokens.id })
      .from(schema.magicLinkTokens)
      .where(
        and(
          eq(schema.magicLinkTokens.member_id, ownerMemberId),
          eq(schema.magicLinkTokens.purpose, "reactivate"),
        ),
      );
    expect(reactivateTokens).toHaveLength(0);
  });
});

describe("POST /api/auth/verify-code with a reactivate code", () => {
  it("reactivates the store and creates a working session", async () => {
    const {
      id: storeId,
      member_id: ownerMemberId,
      session_token: ownerToken,
    } = await seedStore(`Reactivate Verify Test ${crypto.randomUUID()}`);
    const db = createDb(env.DB);
    const ownerEmailRows = await db
      .select({ email: schema.members.email })
      .from(schema.members)
      .where(eq(schema.members.id, ownerMemberId));
    const ownerEmail = ownerEmailRows[0]?.email;
    if (!ownerEmail) throw new Error("seedStore did not set a member email");

    await app.request(
      "/api/stores/me/suspend",
      { method: "POST", ...withAuth(ownerToken) },
      env,
    );

    const loginRes = await app.request(
      "/api/auth/login",
      jsonInit("POST", { email: ownerEmail }),
      devEnv,
    );
    const loginBody = (await loginRes.json()) as { data: { code?: string } };
    const reactivateCode = loginBody.data.code;
    if (!reactivateCode) throw new Error("reactivate code missing");

    const verifyRes = await app.request(
      "/api/auth/verify-code",
      jsonInit("POST", { email: ownerEmail, code: reactivateCode }),
      env,
    );
    expect(verifyRes.status).toBe(200);

    const storeRows = await db
      .select({ status: schema.stores.status })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId));
    expect(storeRows[0]?.status).toBe("active");

    const setCookie = verifyRes.headers.get("Set-Cookie") ?? "";
    const newSessionToken = /session_token=([^;]+)/.exec(setCookie)?.[1];
    if (!newSessionToken) throw new Error("session_token cookie not set");

    const meRes = await app.request(
      "/api/auth/me",
      withAuth(newSessionToken),
      env,
    );
    expect(meRes.status).toBe(200);
    const meBody = (await meRes.json()) as {
      data: { id: string; email: string; role: string };
    };
    expect(meBody.data.id).toBe(storeId);
    expect(meBody.data.email).toBe(ownerEmail);
    expect(meBody.data.role).toBe("owner");
  });
});

describe("DELETE /api/stores/me", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request(
      "/api/stores/me",
      jsonInit("DELETE", { confirm_name: "anything" }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for a staff-role session", async () => {
    const { session_token: token } = await seedStore(
      `Delete Forbidden Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("DELETE", { confirm_name: "anything" })),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("returns 400 when confirm_name does not match", async () => {
    const storeName = `Delete Mismatch Test ${crypto.randomUUID()}`;
    const { id: storeId, session_token: token } = await seedStore(storeName);
    const res = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("DELETE", { confirm_name: "wrong name" })),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");

    // Nothing was deleted.
    const db = createDb(env.DB);
    const storeRows = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId));
    expect(storeRows).toHaveLength(1);
  });

  it("deletes the store and every row across all business tables on confirm_name match", async () => {
    const storeName = `Delete Everything Test ${crypto.randomUUID()}`;
    const { id: storeId, session_token: token } = await seedStore(storeName);
    const { itemId } = await seedFullStore(storeId);

    const res = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("DELETE", { confirm_name: storeName })),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { export: Record<string, unknown[]> };
    };

    // The export captured the pre-deletion data for every table.
    expect(body.data.export.store).toHaveLength(1);
    expect(body.data.export.members).toHaveLength(1);
    expect(body.data.export.menu_categories).toHaveLength(1);
    expect(body.data.export.menu_items).toHaveLength(1);
    expect(body.data.export.option_groups).toHaveLength(1);
    expect(body.data.export.options).toHaveLength(1);
    expect(body.data.export.menu_item_option_groups).toHaveLength(1);
    expect(body.data.export.seats).toHaveLength(1);
    expect(body.data.export.orders).toHaveLength(1);
    expect(body.data.export.order_items).toHaveLength(1);
    expect(body.data.export.order_item_options).toHaveLength(1);
    expect(body.data.export.staff_calls).toHaveLength(1);
    expect(body.data.export.payments).toHaveLength(1);

    // sessions and magic_link_tokens are auth artifacts containing secrets
    // (session/magic-link token values) — must never appear in the export.
    expect(body.data.export).not.toHaveProperty("sessions");
    expect(body.data.export).not.toHaveProperty("magic_link_tokens");

    // subscriptions are entitlement records, not the store's own data —
    // deleted below, but deliberately absent from the export. The shift
    // tables are deleted and unexported for now too; whether a published
    // schedule belongs in the export is settled when that product ships.
    for (const absent of [
      "subscriptions",
      "positions",
      "member_positions",
      "member_work_profiles",
      "shift_patterns",
      "staffing_requirements",
      "schedule_periods",
      "availability_submissions",
      "availability_entries",
      "shifts",
    ]) {
      expect(body.data.export).not.toHaveProperty(absent);
    }

    // Every row is actually gone from D1.
    const db = createDb(env.DB);
    const storeRows = await db
      .select()
      .from(schema.stores)
      .where(eq(schema.stores.id, storeId));
    expect(storeRows).toHaveLength(0);

    const storeScopedTables = [
      schema.members,
      schema.sessions,
      schema.magicLinkTokens,
      schema.menuCategories,
      schema.menuItems,
      schema.optionGroups,
      schema.options,
      schema.seats,
      schema.orders,
      schema.orderItems,
      schema.orderItemOptions,
      schema.staffCalls,
      schema.payments,
      schema.subscriptions,
      schema.positions,
      schema.memberPositions,
      schema.memberWorkProfiles,
      schema.shiftPatterns,
      schema.staffingRequirements,
      schema.schedulePeriods,
      schema.availabilitySubmissions,
      schema.availabilityEntries,
      schema.shifts,
    ];
    for (const table of storeScopedTables) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.store_id, storeId));
      expect(rows).toHaveLength(0);
    }

    const menuItemOptionGroupRows = await db
      .select()
      .from(schema.menuItemOptionGroups)
      .where(eq(schema.menuItemOptionGroups.menu_item_id, itemId));
    expect(menuItemOptionGroupRows).toHaveLength(0);
  });

  it("does not affect a second store's data (tenant isolation)", async () => {
    const storeAName = `Delete Isolation A ${crypto.randomUUID()}`;
    const storeA = await seedStore(storeAName);
    const storeB = await seedStore(`Delete Isolation B ${crypto.randomUUID()}`);
    await seedFullStore(storeB.id);

    const res = await app.request(
      "/api/stores/me",
      withAuth(
        storeA.session_token,
        jsonInit("DELETE", { confirm_name: storeAName }),
      ),
      env,
    );
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const storeBRows = await db
      .select({ id: schema.stores.id })
      .from(schema.stores)
      .where(eq(schema.stores.id, storeB.id));
    expect(storeBRows).toHaveLength(1);

    const storeBSeats = await db
      .select()
      .from(schema.seats)
      .where(eq(schema.seats.store_id, storeB.id));
    expect(storeBSeats).toHaveLength(1);

    const storeBSubscriptions = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.store_id, storeB.id));
    expect(storeBSubscriptions).toHaveLength(1);

    // Store B's shift rows survive too: a delete that lost its store_id filter
    // on any of these tables would pass every assertion above.
    for (const table of [
      schema.positions,
      schema.memberPositions,
      schema.memberWorkProfiles,
      schema.shiftPatterns,
      schema.staffingRequirements,
      schema.schedulePeriods,
      schema.availabilitySubmissions,
      schema.availabilityEntries,
      schema.shifts,
    ]) {
      const rows = await db
        .select()
        .from(table)
        .where(eq(table.store_id, storeB.id));
      expect(rows).toHaveLength(1);
    }
  });
});
