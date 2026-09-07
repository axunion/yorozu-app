/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Sales history & daily summary (roadmap Phase 2 item 2).
 * Covers GET /api/payments range filtering, validation, tenant
 * isolation, and cancelled-item handling.
 */
import { env } from "cloudflare:workers";
import { jstDayRange } from "@yorozu/core";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

// ---------------------------------------------------------------------------
// Setup helper
// ---------------------------------------------------------------------------

/**
 * Seeds a store, one menu item, one seat, places an order, and pays it —
 * driving the whole cycle via HTTP so `payments.paid_at` is a real
 * server-generated timestamp.
 */
async function payOneOrder(
  token: string,
  itemName: string,
  price: number,
): Promise<{ orderId: string; paidAt: number; itemId: string }> {
  const itemRes = await app.request(
    "/api/menu/items",
    withAuth(token, jsonInit("POST", { name: itemName, price })),
    env,
  );
  const itemBody = (await itemRes.json()) as { data: { id: string } };

  const seatRes = await app.request(
    "/api/seats",
    withAuth(token, jsonInit("POST", { name: `Seat ${crypto.randomUUID()}` })),
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
  const orderId = orderBody.data.order.id;
  const firstItem = orderBody.data.order.items[0];
  if (!firstItem) throw new Error("Order response contained no items");

  await app.request(
    `/api/order/${qrToken}/request-payment`,
    { method: "PATCH" },
    env,
  );

  const payRes = await app.request(
    "/api/payments",
    withAuth(token, jsonInit("POST", { order_id: orderId })),
    env,
  );
  const payBody = (await payRes.json()) as { data: { paid_at: number } };

  return { orderId, paidAt: payBody.data.paid_at, itemId: firstItem.id };
}

async function setupStore(): Promise<{ token: string }> {
  const { session_token: token } = await seedStore(
    `Sales History Test ${crypto.randomUUID()}`,
  );
  return { token };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("GET /api/payments validation", () => {
  it("returns 400 when from is missing", async () => {
    const { token } = await setupStore();
    const res = await app.request(
      "/api/payments?to=1000",
      withAuth(token),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when to is missing", async () => {
    const { token } = await setupStore();
    const res = await app.request("/api/payments?from=0", withAuth(token), env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when from or to is not an integer", async () => {
    const { token } = await setupStore();
    const res = await app.request(
      "/api/payments?from=abc&to=1000",
      withAuth(token),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when from equals to", async () => {
    const { token } = await setupStore();
    const res = await app.request(
      "/api/payments?from=1000&to=1000",
      withAuth(token),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when from is after to", async () => {
    const { token } = await setupStore();
    const res = await app.request(
      "/api/payments?from=2000&to=1000",
      withAuth(token),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the range exceeds 62 days", async () => {
    const { token } = await setupStore();
    const from = 0;
    const to = 63 * 24 * 60 * 60 * 1000;
    const res = await app.request(
      `/api/payments?from=${from}&to=${to}`,
      withAuth(token),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("accepts a range of exactly 62 days", async () => {
    const { token } = await setupStore();
    const from = 0;
    const to = 62 * 24 * 60 * 60 * 1000;
    const res = await app.request(
      `/api/payments?from=${from}&to=${to}`,
      withAuth(token),
      env,
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Range filtering
// ---------------------------------------------------------------------------

describe("GET /api/payments range filtering", () => {
  it("includes a payment at exactly the from bound and excludes one at the to bound", async () => {
    const { token } = await setupStore();
    const { orderId, paidAt } = await payOneOrder(token, "唐揚げ", 500);

    const inclusiveRes = await app.request(
      `/api/payments?from=${paidAt}&to=${paidAt + 1}`,
      withAuth(token),
      env,
    );
    expect(inclusiveRes.status).toBe(200);
    const inclusiveBody = (await inclusiveRes.json()) as {
      data: { order_id: string }[];
    };
    expect(inclusiveBody.data.map((p) => p.order_id)).toContain(orderId);

    const exclusiveRes = await app.request(
      `/api/payments?from=${paidAt - 100}&to=${paidAt}`,
      withAuth(token),
      env,
    );
    expect(exclusiveRes.status).toBe(200);
    const exclusiveBody = (await exclusiveRes.json()) as {
      data: { order_id: string }[];
    };
    expect(exclusiveBody.data.map((p) => p.order_id)).not.toContain(orderId);
  });

  it("excludes payments outside the requested range", async () => {
    const { token } = await setupStore();
    const { orderId, paidAt } = await payOneOrder(token, "ビール", 600);

    const res = await app.request(
      `/api/payments?from=${paidAt + 1000}&to=${paidAt + 2000}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as { data: { order_id: string }[] };
    expect(body.data.map((p) => p.order_id)).not.toContain(orderId);
  });

  it("returns payments newest first", async () => {
    const { token } = await setupStore();
    const first = await payOneOrder(token, "唐揚げ", 500);
    const second = await payOneOrder(token, "ビール", 600);

    const res = await app.request(
      `/api/payments?from=${first.paidAt}&to=${second.paidAt + 1}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as { data: { order_id: string }[] };
    const orderIds = body.data.map((p) => p.order_id);
    expect(orderIds.indexOf(second.orderId)).toBeLessThan(
      orderIds.indexOf(first.orderId),
    );
  });

  it("returns seat_name and full item detail for each payment", async () => {
    const { token } = await setupStore();
    const { orderId, paidAt } = await payOneOrder(token, "唐揚げ", 500);

    const res = await app.request(
      `/api/payments?from=${paidAt}&to=${paidAt + 1}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as {
      data: {
        order_id: string;
        seat_name: string;
        total_amount: number;
        method: string;
        items: { name_snapshot: string; status: string }[];
      }[];
    };
    const payment = body.data.find((p) => p.order_id === orderId);
    expect(payment).toBeDefined();
    expect(payment?.seat_name).toBeTruthy();
    expect(payment?.total_amount).toBe(500);
    expect(payment?.method).toBe("cash");
    expect(payment?.items).toHaveLength(1);
    expect(payment?.items[0]?.name_snapshot).toBe("唐揚げ");
  });

  it("works with a jstDayRange window", async () => {
    const { token } = await setupStore();
    const { orderId, paidAt } = await payOneOrder(token, "唐揚げ", 500);
    const jstDate = new Date(paidAt).toISOString().slice(0, 10);
    const { from, to } = jstDayRange(jstDate);

    const res = await app.request(
      `/api/payments?from=${from - 24 * 60 * 60 * 1000}&to=${to + 24 * 60 * 60 * 1000}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as { data: { order_id: string }[] };
    expect(body.data.map((p) => p.order_id)).toContain(orderId);
  });
});

// ---------------------------------------------------------------------------
// Cancelled items
// ---------------------------------------------------------------------------

describe("GET /api/payments with a voided item on the bill", () => {
  it("includes the cancelled item flagged by status but excludes it from total_amount", async () => {
    const { token } = await setupStore();

    const item1Res = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
      env,
    );
    const item1Body = (await item1Res.json()) as { data: { id: string } };
    const item2Res = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "ビール", price: 600 })),
      env,
    );
    const item2Body = (await item2Res.json()) as { data: { id: string } };

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
        items: [
          { menu_item_id: item1Body.data.id, quantity: 1 },
          { menu_item_id: item2Body.data.id, quantity: 1 },
        ],
      }),
      env,
    );
    const orderBody = (await orderRes.json()) as {
      data: {
        order: { id: string; items: { id: string; name_snapshot: string }[] };
      };
    };
    const orderId = orderBody.data.order.id;
    const beerItem = orderBody.data.order.items.find(
      (i) => i.name_snapshot === "ビール",
    );
    if (!beerItem) throw new Error("Beer item not found");

    await app.request(
      `/api/admin/orders/items/${beerItem.id}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    await app.request(
      `/api/order/${qrToken}/request-payment`,
      { method: "PATCH" },
      env,
    );
    const payRes = await app.request(
      "/api/payments",
      withAuth(token, jsonInit("POST", { order_id: orderId })),
      env,
    );
    const payBody = (await payRes.json()) as {
      data: { paid_at: number; total_amount: number };
    };
    expect(payBody.data.total_amount).toBe(500);

    const res = await app.request(
      `/api/payments?from=${payBody.data.paid_at}&to=${payBody.data.paid_at + 1}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as {
      data: {
        order_id: string;
        total_amount: number;
        items: { name_snapshot: string; status: string }[];
      }[];
    };
    const payment = body.data.find((p) => p.order_id === orderId);
    expect(payment?.total_amount).toBe(500);
    expect(payment?.items).toHaveLength(2);
    const voided = payment?.items.find((i) => i.name_snapshot === "ビール");
    expect(voided?.status).toBe("cancelled");
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

describe("GET /api/payments tenant isolation", () => {
  it("does not include another store's payments in the same window", async () => {
    const storeA = await setupStore();
    const storeB = await setupStore();

    const a = await payOneOrder(storeA.token, "唐揚げ", 500);
    const b = await payOneOrder(storeB.token, "ビール", 600);

    const from = Math.min(a.paidAt, b.paidAt);
    const to = Math.max(a.paidAt, b.paidAt) + 1;

    const resA = await app.request(
      `/api/payments?from=${from}&to=${to}`,
      withAuth(storeA.token),
      env,
    );
    const bodyA = (await resA.json()) as { data: { order_id: string }[] };
    expect(bodyA.data.map((p) => p.order_id)).toContain(a.orderId);
    expect(bodyA.data.map((p) => p.order_id)).not.toContain(b.orderId);

    const resB = await app.request(
      `/api/payments?from=${from}&to=${to}`,
      withAuth(storeB.token),
      env,
    );
    const bodyB = (await resB.json()) as { data: { order_id: string }[] };
    expect(bodyB.data.map((p) => p.order_id)).toContain(b.orderId);
    expect(bodyB.data.map((p) => p.order_id)).not.toContain(a.orderId);
  });
});
