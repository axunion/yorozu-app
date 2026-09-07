/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Digital receipt (roadmap Phase 4 item 2).
 * Covers GET /api/order/:seatToken/receipt/:orderId: content, seat
 * scoping, paid-only availability, and the tax breakdown.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

/**
 * Directly overrides a menu item's tax_rate in D1 — there's no admin API
 * for this by design (v1 never exposes it), so a reduced-rate item can
 * only be produced this way in tests.
 */
async function forceMenuItemTaxRate(itemId: string, taxRate: number) {
  const db = createDb(env.DB);
  await db
    .update(schema.menuItems)
    .set({ tax_rate: taxRate })
    .where(eq(schema.menuItems.id, itemId));
}

async function payOneOrder(
  storeToken: string,
  itemName: string,
  price: number,
  opts: { discount_amount?: number; discount_reason?: string } = {},
  taxRate = 10,
): Promise<{ orderId: string; qrToken: string }> {
  const itemRes = await app.request(
    "/api/menu/items",
    withAuth(storeToken, jsonInit("POST", { name: itemName, price })),
    env,
  );
  const itemBody = (await itemRes.json()) as { data: { id: string } };
  if (taxRate !== 10) {
    await forceMenuItemTaxRate(itemBody.data.id, taxRate);
  }

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
  await app.request(
    "/api/payments",
    withAuth(storeToken, jsonInit("POST", { order_id: orderId, ...opts })),
    env,
  );

  return { orderId, qrToken };
}

async function setupStore(): Promise<{ token: string }> {
  const { session_token: token } = await seedStore(
    `Receipt Test ${crypto.randomUUID()}`,
  );
  return { token };
}

describe("GET /api/order/:seatToken/receipt/:orderId", () => {
  it("returns the receipt for a paid order with a correct tax breakdown", async () => {
    const { token } = await setupStore();
    const { orderId, qrToken } = await payOneOrder(token, "唐揚げ", 1100);

    const res = await app.request(
      `/api/order/${qrToken}/receipt/${orderId}`,
      undefined,
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        order_id: string;
        store_name: string;
        seat_name: string;
        items: { name_snapshot: string }[];
        items_total: number;
        discount_amount: number;
        discount_reason: string | null;
        total_amount: number;
        tax_breakdown: {
          rate: number;
          taxable_amount: number;
          tax_amount: number;
        }[];
        method: string;
        paid_at: number;
      };
    };
    expect(body.data.order_id).toBe(orderId);
    expect(body.data.store_name).toBeTruthy();
    expect(body.data.seat_name).toBeTruthy();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0]?.name_snapshot).toBe("唐揚げ");
    expect(body.data.items_total).toBe(1100);
    expect(body.data.total_amount).toBe(1100);
    expect(body.data.discount_amount).toBe(0);
    expect(body.data.discount_reason).toBeNull();
    expect(body.data.method).toBe("cash");
    expect(body.data.paid_at).toEqual(expect.any(Number));
    expect(body.data.tax_breakdown).toEqual([
      { rate: 10, taxable_amount: 1000, tax_amount: 100 },
    ]);
  });

  it("propagates a non-default (8%) tax_rate through to the receipt's tax breakdown", async () => {
    const { token } = await setupStore();
    const { orderId, qrToken } = await payOneOrder(
      token,
      "お土産",
      1080,
      {},
      8,
    );

    const res = await app.request(
      `/api/order/${qrToken}/receipt/${orderId}`,
      undefined,
      env,
    );
    const body = (await res.json()) as {
      data: {
        tax_breakdown: {
          rate: number;
          taxable_amount: number;
          tax_amount: number;
        }[];
      };
    };
    expect(body.data.tax_breakdown).toEqual([
      { rate: 8, taxable_amount: 1000, tax_amount: 80 },
    ]);
  });

  it("reflects the applied discount in items_total vs total_amount; the tax breakdown stays pre-discount", async () => {
    const { token } = await setupStore();
    const { orderId, qrToken } = await payOneOrder(token, "ビール", 1000, {
      discount_amount: 200,
      discount_reason: "常連割引",
    });

    const res = await app.request(
      `/api/order/${qrToken}/receipt/${orderId}`,
      undefined,
      env,
    );
    const body = (await res.json()) as {
      data: {
        items_total: number;
        discount_amount: number;
        discount_reason: string | null;
        total_amount: number;
        tax_breakdown: {
          rate: number;
          taxable_amount: number;
          tax_amount: number;
        }[];
      };
    };
    expect(body.data.items_total).toBe(1000);
    expect(body.data.discount_amount).toBe(200);
    expect(body.data.discount_reason).toBe("常連割引");
    expect(body.data.total_amount).toBe(800);
    // computeTaxBreakdown buckets pre-discount line totals (items_total),
    // not the post-discount charge — 1000/1.1 = 909.09..., not 800/1.1.
    expect(body.data.tax_breakdown).toEqual([
      { rate: 10, taxable_amount: 909, tax_amount: 91 },
    ]);
  });

  it("returns 404 for an order that hasn't been paid yet", async () => {
    const { token } = await setupStore();

    const itemRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
      env,
    );
    const itemBody = (await itemRes.json()) as { data: { id: string } };
    const seatRes = await app.request(
      "/api/seats",
      withAuth(
        token,
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

    const res = await app.request(
      `/api/order/${qrToken}/receipt/${orderBody.data.order.id}`,
      undefined,
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for a nonexistent order id", async () => {
    const { token } = await setupStore();
    const { qrToken } = await payOneOrder(token, "唐揚げ", 500);

    const res = await app.request(
      `/api/order/${qrToken}/receipt/does-not-exist`,
      undefined,
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the order belongs to a different seat", async () => {
    const { token } = await setupStore();
    const { orderId } = await payOneOrder(token, "唐揚げ", 500);

    const otherSeatRes = await app.request(
      "/api/seats",
      withAuth(
        token,
        jsonInit("POST", { name: `Seat ${crypto.randomUUID()}` }),
      ),
      env,
    );
    const otherSeatBody = (await otherSeatRes.json()) as {
      data: { qr_token: string };
    };

    const res = await app.request(
      `/api/order/${otherSeatBody.data.qr_token}/receipt/${orderId}`,
      undefined,
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown seat token regardless of order id", async () => {
    const { token } = await setupStore();
    const { orderId } = await payOneOrder(token, "唐揚げ", 500);

    const res = await app.request(
      `/api/order/not-a-real-token/receipt/${orderId}`,
      undefined,
      env,
    );
    expect(res.status).toBe(404);
  });
});
