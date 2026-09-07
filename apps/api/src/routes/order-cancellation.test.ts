/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Order cancellation & correction (roadmap Phase 2 item 1).
 * Covers the transition matrix, idempotency, cross-tenant isolation, and
 * paid-order guards for the four new endpoints, plus the checkout guard
 * extension in POST /api/payments.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

async function setupOrderWithItem(): Promise<{
  token: string;
  qrToken: string;
  orderId: string;
  itemId: string;
}> {
  const { session_token: token } = await seedStore(
    `Cancel Test ${crypto.randomUUID()}`,
  );

  const itemRes = await app.request(
    "/api/menu/items",
    withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
    env,
  );
  const itemBody = (await itemRes.json()) as { data: { id: string } };

  const seatRes = await app.request(
    "/api/seats",
    withAuth(token, jsonInit("POST", { name: "テーブル1" })),
    env,
  );
  const seatBody = (await seatRes.json()) as { data: { qr_token: string } };
  const qrToken = seatBody.data.qr_token;

  const orderRes = await app.request(
    `/api/order/${qrToken}/items`,
    jsonInit("POST", {
      items: [{ menu_item_id: itemBody.data.id, quantity: 1 }],
    }),
    env,
  );
  const orderBody = (await orderRes.json()) as {
    data: { order: { id: string; items: { id: string }[] } };
  };
  const firstItem = orderBody.data.order.items[0];
  if (!firstItem) throw new Error("Order response contained no items");

  return {
    token,
    qrToken,
    orderId: orderBody.data.order.id,
    itemId: firstItem.id,
  };
}

/** Forces an order into a terminal status directly via D1, bypassing the API. */
async function forceOrderStatus(orderId: string, status: "paid" | "cancelled") {
  const db = createDb(env.DB);
  await db
    .update(schema.orders)
    .set({ status, closed_at: Date.now() })
    .where(eq(schema.orders.id, orderId));
}

async function getItemStatus(itemId: string): Promise<string | undefined> {
  const db = createDb(env.DB);
  const rows = await db
    .select({ status: schema.orderItems.status })
    .from(schema.orderItems)
    .where(eq(schema.orderItems.id, itemId));
  return rows[0]?.status;
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/items/:id/cancel
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/orders/items/:id/cancel", () => {
  it("transitions an ordered item to cancelled", async () => {
    const { token, itemId } = await setupOrderWithItem();
    const res = await app.request(
      `/api/admin/orders/items/${itemId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("cancelled");
  });

  it("transitions a served item to cancelled", async () => {
    const { token, itemId } = await setupOrderWithItem();
    await app.request(
      `/api/admin/orders/items/${itemId}/serve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    const res = await app.request(
      `/api/admin/orders/items/${itemId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await getItemStatus(itemId)).toBe("cancelled");
  });

  it("is idempotent when the item is already cancelled", async () => {
    const { token, itemId } = await setupOrderWithItem();
    await app.request(
      `/api/admin/orders/items/${itemId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    const res = await app.request(
      `/api/admin/orders/items/${itemId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("cancelled");
  });

  it("returns 409 when the parent order is paid", async () => {
    const { token, orderId, itemId } = await setupOrderWithItem();
    await forceOrderStatus(orderId, "paid");
    const res = await app.request(
      `/api/admin/orders/items/${itemId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(409);
    expect(await getItemStatus(itemId)).toBe("ordered");
  });

  it("returns 404 for another store's item (cross-tenant)", async () => {
    const owner = await setupOrderWithItem();
    const { session_token: otherToken } = await seedStore(
      `Other Store ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      `/api/admin/orders/items/${owner.itemId}/cancel`,
      withAuth(otherToken, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/items/:id/unserve
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/orders/items/:id/unserve", () => {
  it("transitions a served item back to ordered", async () => {
    const { token, itemId } = await setupOrderWithItem();
    await app.request(
      `/api/admin/orders/items/${itemId}/serve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    const res = await app.request(
      `/api/admin/orders/items/${itemId}/unserve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ordered");
  });

  it("is idempotent when the item is already ordered", async () => {
    const { token, itemId } = await setupOrderWithItem();
    const res = await app.request(
      `/api/admin/orders/items/${itemId}/unserve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("ordered");
  });

  it("returns 409 when the item is cancelled", async () => {
    const { token, itemId } = await setupOrderWithItem();
    await app.request(
      `/api/admin/orders/items/${itemId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    const res = await app.request(
      `/api/admin/orders/items/${itemId}/unserve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 409 when the parent order is not active (paid)", async () => {
    const { token, orderId, itemId } = await setupOrderWithItem();
    await app.request(
      `/api/admin/orders/items/${itemId}/serve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    await forceOrderStatus(orderId, "paid");
    const res = await app.request(
      `/api/admin/orders/items/${itemId}/unserve`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for another store's item (cross-tenant)", async () => {
    const owner = await setupOrderWithItem();
    const { session_token: otherToken } = await seedStore(
      `Other Store ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      `/api/admin/orders/items/${owner.itemId}/unserve`,
      withAuth(otherToken, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/reopen
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/orders/:id/reopen", () => {
  it("transitions payment_requested back to open", async () => {
    const { token, qrToken, orderId } = await setupOrderWithItem();
    await app.request(
      `/api/order/${qrToken}/request-payment`,
      { method: "PATCH" },
      env,
    );
    const res = await app.request(
      `/api/admin/orders/${orderId}/reopen`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("open");
  });

  it("is idempotent when the order is already open", async () => {
    const { token, orderId } = await setupOrderWithItem();
    const res = await app.request(
      `/api/admin/orders/${orderId}/reopen`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("open");
  });

  it("returns 409 when the order is paid", async () => {
    const { token, orderId } = await setupOrderWithItem();
    await forceOrderStatus(orderId, "paid");
    const res = await app.request(
      `/api/admin/orders/${orderId}/reopen`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 409 when the order is cancelled", async () => {
    const { token, orderId } = await setupOrderWithItem();
    await forceOrderStatus(orderId, "cancelled");
    const res = await app.request(
      `/api/admin/orders/${orderId}/reopen`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for another store's order (cross-tenant)", async () => {
    const owner = await setupOrderWithItem();
    const { session_token: otherToken } = await seedStore(
      `Other Store ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      `/api/admin/orders/${owner.orderId}/reopen`,
      withAuth(otherToken, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/cancel
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/orders/:id/cancel", () => {
  it("cancels an open order and cascades to its non-cancelled items", async () => {
    const { token, orderId, itemId } = await setupOrderWithItem();
    const res = await app.request(
      `/api/admin/orders/${orderId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("cancelled");
    expect(await getItemStatus(itemId)).toBe("cancelled");
  });

  it("cancels a payment_requested order", async () => {
    const { token, qrToken, orderId } = await setupOrderWithItem();
    await app.request(
      `/api/order/${qrToken}/request-payment`,
      { method: "PATCH" },
      env,
    );
    const res = await app.request(
      `/api/admin/orders/${orderId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("cancelled");
  });

  it("is idempotent when the order is already cancelled", async () => {
    const { token, orderId } = await setupOrderWithItem();
    await app.request(
      `/api/admin/orders/${orderId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    const res = await app.request(
      `/api/admin/orders/${orderId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe("cancelled");
  });

  it("returns 409 when the order is paid", async () => {
    const { token, orderId } = await setupOrderWithItem();
    await forceOrderStatus(orderId, "paid");
    const res = await app.request(
      `/api/admin/orders/${orderId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for another store's order (cross-tenant)", async () => {
    const owner = await setupOrderWithItem();
    const { session_token: otherToken } = await seedStore(
      `Other Store ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      `/api/admin/orders/${owner.orderId}/cancel`,
      withAuth(otherToken, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /api/payments — zero non-cancelled items guard
// ---------------------------------------------------------------------------

describe("POST /api/payments with cancelled items", () => {
  it("returns 409 when every item on the order is cancelled", async () => {
    const { token, qrToken, orderId, itemId } = await setupOrderWithItem();
    await app.request(
      `/api/admin/orders/items/${itemId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    await app.request(
      `/api/order/${qrToken}/request-payment`,
      { method: "PATCH" },
      env,
    );
    const res = await app.request(
      "/api/payments",
      withAuth(token, jsonInit("POST", { order_id: orderId })),
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });
});
