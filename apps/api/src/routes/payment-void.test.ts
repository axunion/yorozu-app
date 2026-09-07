/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Payment void/refund (roadmap Phase 4 item 5).
 * Covers PATCH /api/payments/:id/void: reversal, order reopening,
 * idempotency, the reason requirement, and the one-active-order-per-seat
 * conflict when the seat has already moved on.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

async function payOneOrder(
  storeToken: string,
  itemName: string,
  price: number,
): Promise<{ orderId: string; paymentId: string; qrToken: string }> {
  const itemRes = await app.request(
    "/api/menu/items",
    withAuth(storeToken, jsonInit("POST", { name: itemName, price })),
    env,
  );
  const itemBody = (await itemRes.json()) as { data: { id: string } };

  const seatRes = await app.request(
    "/api/seats",
    withAuth(
      storeToken,
      jsonInit("POST", { name: `Seat ${crypto.randomUUID()}` }),
    ),
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
    data: { order: { id: string } };
  };
  const orderId = orderBody.data.order.id;

  await app.request(
    `/api/order/${qrToken}/request-payment`,
    { method: "PATCH" },
    env,
  );
  const payRes = await app.request(
    "/api/payments",
    withAuth(storeToken, jsonInit("POST", { order_id: orderId })),
    env,
  );
  const payBody = (await payRes.json()) as { data: { id: string } };

  return { orderId, paymentId: payBody.data.id, qrToken };
}

async function setupStore(): Promise<{ token: string }> {
  const { session_token: token } = await seedStore(
    `Payment Void Test ${crypto.randomUUID()}`,
  );
  return { token };
}

describe("PATCH /api/payments/:id/void", () => {
  it("voids the payment and reopens the order to payment_requested", async () => {
    const { token } = await setupStore();
    const { orderId, paymentId, qrToken } = await payOneOrder(
      token,
      "唐揚げ",
      500,
    );

    const res = await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        id: string;
        order_id: string;
        voided_at: number;
        void_reason: string;
      };
    };
    expect(body.data.order_id).toBe(orderId);
    expect(body.data.voided_at).toEqual(expect.any(Number));
    expect(body.data.void_reason).toBe("誤会計");

    // The order is back on the checkout screen, not the sales history.
    const pendingRes = await app.request(
      "/api/payments/pending",
      withAuth(token),
      env,
    );
    const pendingBody = (await pendingRes.json()) as {
      data: { id: string; status: string }[];
    };
    const reopened = pendingBody.data.find((o) => o.id === orderId);
    expect(reopened?.status).toBe("payment_requested");

    // The customer's order screen sees it as payment_requested again too.
    const bootstrapRes = await app.request(
      `/api/order/${qrToken}`,
      undefined,
      env,
    );
    const bootstrapBody = (await bootstrapRes.json()) as {
      data: { order: { status: string } | null };
    };
    expect(bootstrapBody.data.order?.status).toBe("payment_requested");

    // closed_at must be cleared too — the order is no longer closed, and
    // no API response currently exposes this, so check D1 directly.
    const db = createDb(env.DB);
    const orderRows = await db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId));
    expect(orderRows[0]?.closed_at).toBeNull();
  });

  it("returns 400 when void_reason is missing", async () => {
    const { token } = await setupStore();
    const { paymentId } = await payOneOrder(token, "唐揚げ", 500);

    const res = await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", {})),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when void_reason is whitespace-only", async () => {
    const { token } = await setupStore();
    const { paymentId } = await payOneOrder(token, "唐揚げ", 500);

    const res = await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "   " })),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("is idempotent: voiding an already-voided payment returns the original void state", async () => {
    const { token } = await setupStore();
    const { paymentId } = await payOneOrder(token, "唐揚げ", 500);

    const first = await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );
    const firstBody = (await first.json()) as {
      data: { voided_at: number; void_reason: string };
    };

    const second = await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "別の理由" })),
      env,
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      data: { voided_at: number; void_reason: string };
    };
    // The second call's reason is ignored — the original void state wins.
    expect(secondBody.data.voided_at).toBe(firstBody.data.voided_at);
    expect(secondBody.data.void_reason).toBe("誤会計");
  });

  it("agrees on a single persisted void state under concurrent requests with different reasons", async () => {
    const { token } = await setupStore();
    const { paymentId } = await payOneOrder(token, "唐揚げ", 500);

    // Both requests race against the same not-yet-voided payment; whichever
    // wins, both responses must report that same persisted state — neither
    // may report its own locally-computed reason if it actually lost.
    const [resA, resB] = await Promise.all([
      app.request(
        `/api/payments/${paymentId}/void`,
        withAuth(token, jsonInit("PATCH", { void_reason: "理由A" })),
        env,
      ),
      app.request(
        `/api/payments/${paymentId}/void`,
        withAuth(token, jsonInit("PATCH", { void_reason: "理由B" })),
        env,
      ),
    ]);
    const bodyA = (await resA.json()) as {
      data: { voided_at: number; void_reason: string };
    };
    const bodyB = (await resB.json()) as {
      data: { voided_at: number; void_reason: string };
    };
    expect(bodyA.data.voided_at).toBe(bodyB.data.voided_at);
    expect(bodyA.data.void_reason).toBe(bodyB.data.void_reason);
    expect(["理由A", "理由B"]).toContain(bodyA.data.void_reason);
  });

  it("returns 409 when the seat has already started a new order since payment", async () => {
    const { token } = await setupStore();
    const { paymentId, qrToken } = await payOneOrder(token, "唐揚げ", 500);

    // Paying frees the seat; start a fresh order on it before voiding.
    const itemRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "ビール", price: 600 })),
      env,
    );
    expect(itemRes.status).toBe(201);
    const itemBody = (await itemRes.json()) as { data: { id: string } };
    const newOrderRes = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemBody.data.id, quantity: 1 }],
      }),
      env,
    );
    expect(newOrderRes.status).toBe(201);

    const res = await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for a payment belonging to a different store", async () => {
    const storeA = await setupStore();
    const storeB = await setupStore();
    const { paymentId } = await payOneOrder(storeA.token, "唐揚げ", 500);

    const res = await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(storeB.token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent payment id", async () => {
    const { token } = await setupStore();

    const res = await app.request(
      "/api/payments/does-not-exist/void",
      withAuth(token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("reports the voided payment back via GET /api/payments", async () => {
    const { token } = await setupStore();
    const { orderId, paymentId } = await payOneOrder(token, "唐揚げ", 500);

    const voidRes = await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );
    const voidBody = (await voidRes.json()) as {
      data: { voided_at: number };
    };

    const res = await app.request(
      `/api/payments?from=${voidBody.data.voided_at - 100_000}&to=${voidBody.data.voided_at + 1}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as {
      data: {
        order_id: string;
        voided_at: number | null;
        void_reason: string | null;
      }[];
    };
    const payment = body.data.find((p) => p.order_id === orderId);
    expect(payment?.voided_at).toBe(voidBody.data.voided_at);
    expect(payment?.void_reason).toBe("誤会計");
  });

  it("does not affect a second, unrelated paid order in the same store", async () => {
    const { token } = await setupStore();
    const { paymentId: paymentA } = await payOneOrder(token, "唐揚げ", 500);
    const { orderId: orderIdB, paymentId: paymentB } = await payOneOrder(
      token,
      "ビール",
      600,
    );

    await app.request(
      `/api/payments/${paymentA}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );

    // Order B's payment is untouched, and it never reappears as a pending
    // (payment_requested) check.
    const res = await app.request(
      `/api/payments?from=${Date.now() - 60_000}&to=${Date.now() + 60_000}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as {
      data: { order_id: string; voided_at: number | null }[];
    };
    const paymentBRow = body.data.find((p) => p.order_id === orderIdB);
    expect(paymentBRow?.voided_at).toBeNull();

    const pendingRes = await app.request(
      "/api/payments/pending",
      withAuth(token),
      env,
    );
    const pendingBody = (await pendingRes.json()) as {
      data: { id: string }[];
    };
    expect(pendingBody.data.some((o) => o.id === orderIdB)).toBe(false);
    // Sanity: paymentB is a real id, distinct from paymentA.
    expect(paymentB).not.toBe(paymentA);
  });

  it("lets a voided order be corrected (reopen + add item) and re-settled", async () => {
    const { token } = await setupStore();
    const { orderId, paymentId, qrToken } = await payOneOrder(
      token,
      "唐揚げ",
      500,
    );

    await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );

    // Correct the check: reopen payment_requested → open (existing Phase 2
    // admin flow), add a missed item, then request payment again.
    const reopenRes = await app.request(
      `/api/admin/orders/${orderId}/reopen`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(reopenRes.status).toBe(200);

    const itemRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "ビール", price: 600 })),
      env,
    );
    const itemBody = (await itemRes.json()) as { data: { id: string } };
    const addItemRes = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemBody.data.id, quantity: 1 }],
      }),
      env,
    );
    expect(addItemRes.status).toBe(200);

    await app.request(
      `/api/order/${qrToken}/request-payment`,
      { method: "PATCH" },
      env,
    );

    // Re-settled for the corrected (higher) total.
    const rePayRes = await app.request(
      "/api/payments",
      withAuth(token, jsonInit("POST", { order_id: orderId })),
      env,
    );
    expect(rePayRes.status).toBe(201);
    const rePayBody = (await rePayRes.json()) as {
      data: { total_amount: number };
    };
    expect(rePayBody.data.total_amount).toBe(1100);

    const bootstrapRes = await app.request(
      `/api/order/${qrToken}`,
      undefined,
      env,
    );
    const bootstrapBody = (await bootstrapRes.json()) as {
      data: { order: unknown };
    };
    expect(bootstrapBody.data.order).toBeNull();
  });

  it("lets a voided order be cancelled instead of re-settled", async () => {
    const { token } = await setupStore();
    const { orderId, paymentId, qrToken } = await payOneOrder(
      token,
      "唐揚げ",
      500,
    );

    await app.request(
      `/api/payments/${paymentId}/void`,
      withAuth(token, jsonInit("PATCH", { void_reason: "誤会計" })),
      env,
    );

    const cancelRes = await app.request(
      `/api/admin/orders/${orderId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(cancelRes.status).toBe(200);

    // The seat is free again — a new order can start on the same seat.
    const itemRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "ビール", price: 600 })),
      env,
    );
    const itemBody = (await itemRes.json()) as { data: { id: string } };
    const newOrderRes = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemBody.data.id, quantity: 1 }],
      }),
      env,
    );
    expect(newOrderRes.status).toBe(201);
  });
});
