/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Seat lifecycle (roadmap Phase 2 item 5): rename, soft-delete, QR rotation.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

async function createSeat(
  token: string,
  name: string,
): Promise<{ id: string; qr_token: string }> {
  const res = await app.request(
    "/api/seats",
    withAuth(token, jsonInit("POST", { name })),
    env,
  );
  const body = (await res.json()) as { data: { id: string; qr_token: string } };
  return body.data;
}

// ---------------------------------------------------------------------------
// PATCH /api/seats/:id — rename
// ---------------------------------------------------------------------------

describe("PATCH /api/seats/:id", () => {
  it("renames the seat and returns the updated row", async () => {
    const { session_token: token } = await seedStore(
      `Rename Test ${crypto.randomUUID()}`,
    );
    const seat = await createSeat(token, "テーブル1");

    const res = await app.request(
      `/api/seats/${seat.id}`,
      withAuth(token, jsonInit("PATCH", { name: "テーブル1改" })),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe("テーブル1改");
  });

  it("returns 400 for an empty name", async () => {
    const { session_token: token } = await seedStore(
      `Validation Test ${crypto.randomUUID()}`,
    );
    const seat = await createSeat(token, "テーブル1");

    const res = await app.request(
      `/api/seats/${seat.id}`,
      withAuth(token, jsonInit("PATCH", { name: "" })),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 for another store's seat", async () => {
    const storeA = await seedStore(`Store A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Store B ${crypto.randomUUID()}`);
    const seat = await createSeat(storeA.session_token, "テーブル1");

    const res = await app.request(
      `/api/seats/${seat.id}`,
      withAuth(storeB.session_token, jsonInit("PATCH", { name: "乗っ取り" })),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/seats/:id — soft-delete (retire)
// ---------------------------------------------------------------------------

describe("DELETE /api/seats/:id", () => {
  it("soft-deletes the seat (is_active becomes false, row survives)", async () => {
    const { session_token: token } = await seedStore(
      `Retire Test ${crypto.randomUUID()}`,
    );
    const seat = await createSeat(token, "テーブル1");

    const res = await app.request(
      `/api/seats/${seat.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(schema.seats)
      .where(eq(schema.seats.id, seat.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_active).toBe(false);
    expect(rows[0]?.name).toBe("テーブル1");
  });

  it("is idempotent on an already-inactive seat", async () => {
    const { session_token: token } = await seedStore(
      `Idempotent Retire Test ${crypto.randomUUID()}`,
    );
    const seat = await createSeat(token, "テーブル1");

    await app.request(
      `/api/seats/${seat.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    const secondRes = await app.request(
      `/api/seats/${seat.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(secondRes.status).toBe(200);
    const secondBody = (await secondRes.json()) as {
      data: { id: string; is_active: boolean };
    };
    expect(secondBody.data.id).toBe(seat.id);
    expect(secondBody.data.is_active).toBe(false);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(schema.seats)
      .where(eq(schema.seats.id, seat.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_active).toBe(false);
    expect(rows[0]?.name).toBe("テーブル1");
  });

  it("returns 409 when the seat has an active order", async () => {
    const { session_token: token } = await seedStore(
      `Active Order Retire Test ${crypto.randomUUID()}`,
    );
    const seat = await createSeat(token, "テーブル1");

    const itemRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
      env,
    );
    const itemBody = (await itemRes.json()) as { data: { id: string } };
    await app.request(
      `/api/order/${seat.qr_token}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemBody.data.id, quantity: 1 }],
      }),
      env,
    );

    const res = await app.request(
      `/api/seats/${seat.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(409);

    const db = createDb(env.DB);
    const rows = await db
      .select({ is_active: schema.seats.is_active })
      .from(schema.seats)
      .where(eq(schema.seats.id, seat.id));
    expect(rows[0]?.is_active).toBe(true);
  });

  it("returns 404 for another store's seat", async () => {
    const storeA = await seedStore(`Store A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Store B ${crypto.randomUUID()}`);
    const seat = await createSeat(storeA.session_token, "テーブル1");

    const res = await app.request(
      `/api/seats/${seat.id}`,
      withAuth(storeB.session_token, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/seats/:id/rotate-qr
// ---------------------------------------------------------------------------

describe("POST /api/seats/:id/rotate-qr", () => {
  it("issues a new qr_token; the old one 404s and the new one works", async () => {
    const { session_token: token } = await seedStore(
      `Rotate Test ${crypto.randomUUID()}`,
    );
    const seat = await createSeat(token, "テーブル1");
    const oldQrToken = seat.qr_token;

    const res = await app.request(
      `/api/seats/${seat.id}/rotate-qr`,
      withAuth(token, { method: "POST" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { qr_token: string } };
    expect(body.data.qr_token).not.toBe(oldQrToken);

    const oldRes = await app.request(`/api/order/${oldQrToken}`, {}, env);
    expect(oldRes.status).toBe(404);

    const newRes = await app.request(
      `/api/order/${body.data.qr_token}`,
      {},
      env,
    );
    expect(newRes.status).toBe(200);
  });

  it("returns 409 when the seat has an active order", async () => {
    const { session_token: token } = await seedStore(
      `Active Order Rotate Test ${crypto.randomUUID()}`,
    );
    const seat = await createSeat(token, "テーブル1");

    const itemRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
      env,
    );
    const itemBody = (await itemRes.json()) as { data: { id: string } };
    await app.request(
      `/api/order/${seat.qr_token}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemBody.data.id, quantity: 1 }],
      }),
      env,
    );

    const res = await app.request(
      `/api/seats/${seat.id}/rotate-qr`,
      withAuth(token, { method: "POST" }),
      env,
    );
    expect(res.status).toBe(409);

    // The original QR still works (rotation did not happen).
    const stillWorksRes = await app.request(
      `/api/order/${seat.qr_token}`,
      {},
      env,
    );
    expect(stillWorksRes.status).toBe(200);
  });

  it("returns 404 for another store's seat", async () => {
    const storeA = await seedStore(`Store A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Store B ${crypto.randomUUID()}`);
    const seat = await createSeat(storeA.session_token, "テーブル1");

    const res = await app.request(
      `/api/seats/${seat.id}/rotate-qr`,
      withAuth(storeB.session_token, { method: "POST" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/seats — active-only default, ?include_inactive
// ---------------------------------------------------------------------------

describe("GET /api/seats", () => {
  it("excludes retired seats by default", async () => {
    const { session_token: token } = await seedStore(
      `List Test ${crypto.randomUUID()}`,
    );
    const active = await createSeat(token, "テーブル1");
    const retired = await createSeat(token, "テーブル2");
    await app.request(
      `/api/seats/${retired.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );

    const res = await app.request("/api/seats", withAuth(token), env);
    const body = (await res.json()) as { data: { id: string }[] };
    const ids = body.data.map((s) => s.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(retired.id);
  });

  it("includes retired seats when include_inactive=true", async () => {
    const { session_token: token } = await seedStore(
      `List Include Test ${crypto.randomUUID()}`,
    );
    const active = await createSeat(token, "テーブル1");
    const retired = await createSeat(token, "テーブル2");
    await app.request(
      `/api/seats/${retired.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );

    const res = await app.request(
      "/api/seats?include_inactive=true",
      withAuth(token),
      env,
    );
    const body = (await res.json()) as {
      data: { id: string; is_active: boolean }[];
    };
    const ids = body.data.map((s) => s.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(retired.id);
    expect(body.data.find((s) => s.id === retired.id)?.is_active).toBe(false);
  });

  it("does not include another store's seats, in either branch", async () => {
    const storeA = await seedStore(`Store A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Store B ${crypto.randomUUID()}`);
    const seatA = await createSeat(storeA.session_token, "Aのテーブル");
    const seatB = await createSeat(storeB.session_token, "Bのテーブル");

    const defaultRes = await app.request(
      "/api/seats",
      withAuth(storeA.session_token),
      env,
    );
    const defaultBody = (await defaultRes.json()) as { data: { id: string }[] };
    const defaultIds = defaultBody.data.map((s) => s.id);
    expect(defaultIds).toContain(seatA.id);
    expect(defaultIds).not.toContain(seatB.id);

    const includeInactiveRes = await app.request(
      "/api/seats?include_inactive=true",
      withAuth(storeA.session_token),
      env,
    );
    const includeInactiveBody = (await includeInactiveRes.json()) as {
      data: { id: string }[];
    };
    const includeInactiveIds = includeInactiveBody.data.map((s) => s.id);
    expect(includeInactiveIds).toContain(seatA.id);
    expect(includeInactiveIds).not.toContain(seatB.id);
  });
});

// ---------------------------------------------------------------------------
// Customer order screen rejects retired seats
// ---------------------------------------------------------------------------

describe("GET /api/order/:seatToken with a retired seat", () => {
  it("returns 404, same as an unknown token", async () => {
    const { session_token: token } = await seedStore(
      `Retired Order Test ${crypto.randomUUID()}`,
    );
    const seat = await createSeat(token, "テーブル1");
    await app.request(
      `/api/seats/${seat.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );

    const res = await app.request(`/api/order/${seat.qr_token}`, {}, env);
    expect(res.status).toBe(404);
  });
});
