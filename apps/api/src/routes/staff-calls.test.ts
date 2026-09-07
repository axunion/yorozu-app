/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function setupSeat(
  seatName = "テーブル1",
): Promise<{ token: string; qrToken: string }> {
  const { session_token: token } = await seedStore(
    `Staff Call Test ${crypto.randomUUID()}`,
  );
  const seatRes = await app.request(
    "/api/seats",
    withAuth(token, jsonInit("POST", { name: seatName })),
    env,
  );
  const seatBody = (await seatRes.json()) as { data: { qr_token: string } };
  return { token, qrToken: seatBody.data.qr_token };
}

/** Adds a second seat to an already-seeded store. */
async function addSeat(
  token: string,
  seatName: string,
): Promise<{ qrToken: string }> {
  const seatRes = await app.request(
    "/api/seats",
    withAuth(token, jsonInit("POST", { name: seatName })),
    env,
  );
  const seatBody = (await seatRes.json()) as { data: { qr_token: string } };
  return { qrToken: seatBody.data.qr_token };
}

async function callStaff(qrToken: string) {
  return app.request(`/api/order/${qrToken}/call`, { method: "POST" }, env);
}

/** Forces a call's created_at directly via D1, for deterministic order tests. */
async function forceCallCreatedAt(callId: string, created_at: number) {
  const db = createDb(env.DB);
  await db
    .update(schema.staffCalls)
    .set({ created_at })
    .where(eq(schema.staffCalls.id, callId));
}

// ---------------------------------------------------------------------------
// POST /api/order/:seatToken/call
// ---------------------------------------------------------------------------

describe("POST /api/order/:seatToken/call", () => {
  it("creates a new open call and returns 201", async () => {
    const { qrToken } = await setupSeat();
    const res = await callStaff(qrToken);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; status: string; created_at: number };
    };
    expect(body.data.status).toBe("open");
    expect(typeof body.data.id).toBe("string");
    expect(typeof body.data.created_at).toBe("number");
  });

  it("is idempotent per seat: a second call returns the same open call with 200", async () => {
    const { qrToken } = await setupSeat();
    const first = await callStaff(qrToken);
    const firstBody = (await first.json()) as { data: { id: string } };

    const second = await callStaff(qrToken);
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { data: { id: string } };
    expect(secondBody.data.id).toBe(firstBody.data.id);
  });

  it("allows a fresh call after the previous one is resolved", async () => {
    const { token, qrToken } = await setupSeat();
    const first = await callStaff(qrToken);
    const firstBody = (await first.json()) as { data: { id: string } };

    await app.request(
      `/api/admin/calls/${firstBody.data.id}/resolve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );

    const second = await callStaff(qrToken);
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as { data: { id: string } };
    expect(secondBody.data.id).not.toBe(firstBody.data.id);
  });

  it("returns 404 for an unknown seat token", async () => {
    const res = await callStaff("nonexistent-token");
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/calls
// ---------------------------------------------------------------------------

describe("GET /api/admin/calls", () => {
  it("lists an open call with the seat name", async () => {
    const { token, qrToken } = await setupSeat();
    await callStaff(qrToken);

    const res = await app.request("/api/admin/calls", withAuth(token), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { seat_name: string; status: string }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.seat_name).toBe("テーブル1");
    expect(body.data[0]?.status).toBe("open");
  });

  it("orders calls oldest first", async () => {
    const { token, qrToken } = await setupSeat("テーブル1");
    const { qrToken: qrToken2 } = await addSeat(token, "テーブル2");

    // Created in reverse order, then forced to their intended created_at,
    // so the response order can only match if the query actually sorts
    // rather than happening to return insertion order.
    const second = await callStaff(qrToken2);
    const secondBody = (await second.json()) as { data: { id: string } };
    const first = await callStaff(qrToken);
    const firstBody = (await first.json()) as { data: { id: string } };
    await forceCallCreatedAt(firstBody.data.id, 1000);
    await forceCallCreatedAt(secondBody.data.id, 2000);

    const res = await app.request("/api/admin/calls", withAuth(token), env);
    const body = (await res.json()) as { data: { seat_name: string }[] };
    expect(body.data.map((c) => c.seat_name)).toEqual([
      "テーブル1",
      "テーブル2",
    ]);
  });

  it("defaults to open calls only, excluding resolved ones", async () => {
    const { token, qrToken } = await setupSeat();
    const created = await callStaff(qrToken);
    const createdBody = (await created.json()) as { data: { id: string } };
    await app.request(
      `/api/admin/calls/${createdBody.data.id}/resolve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );

    const res = await app.request("/api/admin/calls", withAuth(token), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  it("includes resolved calls when status=all", async () => {
    const { token, qrToken } = await setupSeat();
    const created = await callStaff(qrToken);
    const createdBody = (await created.json()) as { data: { id: string } };
    await app.request(
      `/api/admin/calls/${createdBody.data.id}/resolve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );

    const res = await app.request(
      "/api/admin/calls?status=all",
      withAuth(token),
      env,
    );
    const body = (await res.json()) as { data: { status: string }[] };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.status).toBe("resolved");
  });

  it("does not include another store's calls (tenant isolation)", async () => {
    const { qrToken } = await setupSeat();
    await callStaff(qrToken);

    const other = await setupSeat();
    const res = await app.request(
      "/api/admin/calls",
      withAuth(other.token),
      env,
    );
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(0);
  });

  it("returns 401 without a session", async () => {
    const res = await app.request("/api/admin/calls", {}, env);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/calls/:id/resolve
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/calls/:id/resolve", () => {
  it("resolves an open call", async () => {
    const { token, qrToken } = await setupSeat();
    const created = await callStaff(qrToken);
    const createdBody = (await created.json()) as { data: { id: string } };

    const res = await app.request(
      `/api/admin/calls/${createdBody.data.id}/resolve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; resolved_at: number };
    };
    expect(body.data.status).toBe("resolved");
    expect(typeof body.data.resolved_at).toBe("number");
  });

  it("is idempotent when the call is already resolved", async () => {
    const { token, qrToken } = await setupSeat();
    const created = await callStaff(qrToken);
    const createdBody = (await created.json()) as { data: { id: string } };

    await app.request(
      `/api/admin/calls/${createdBody.data.id}/resolve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    const res = await app.request(
      `/api/admin/calls/${createdBody.data.id}/resolve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("resolved");
  });

  it("returns 404 for a nonexistent call", async () => {
    const { token } = await setupSeat();
    const res = await app.request(
      "/api/admin/calls/nonexistent-id/resolve",
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for another store's call (tenant isolation)", async () => {
    const { qrToken } = await setupSeat();
    const created = await callStaff(qrToken);
    const createdBody = (await created.json()) as { data: { id: string } };

    const other = await setupSeat();
    const res = await app.request(
      `/api/admin/calls/${createdBody.data.id}/resolve`,
      withAuth(other.token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Bootstrap embedding
// ---------------------------------------------------------------------------

describe("GET /api/order/:seatToken call embedding", () => {
  it("embeds null when there is no open call", async () => {
    const { qrToken } = await setupSeat();
    const res = await app.request(`/api/order/${qrToken}`, {}, env);
    const body = (await res.json()) as { data: { call: unknown } };
    expect(body.data.call).toBeNull();
  });

  it("embeds the open call after one is created", async () => {
    const { qrToken } = await setupSeat();
    await callStaff(qrToken);

    const res = await app.request(`/api/order/${qrToken}`, {}, env);
    const body = (await res.json()) as {
      data: { call: { status: string } | null };
    };
    expect(body.data.call?.status).toBe("open");
  });

  it("embeds null again after the call is resolved", async () => {
    const { token, qrToken } = await setupSeat();
    const created = await callStaff(qrToken);
    const createdBody = (await created.json()) as { data: { id: string } };
    await app.request(
      `/api/admin/calls/${createdBody.data.id}/resolve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );

    const res = await app.request(`/api/order/${qrToken}`, {}, env);
    const body = (await res.json()) as { data: { call: unknown } };
    expect(body.data.call).toBeNull();
  });
});
