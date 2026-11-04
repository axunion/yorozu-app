/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Whole-check discounts (roadmap Phase 4 item 3).
 * Covers POST /api/payments' `discount_amount`/`discount_reason`:
 * bounds, the reason requirement, server-computed totals, and that
 * both are reported back via GET /api/payments.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

async function setupOrder(
  token: string,
  price = 1000,
): Promise<{ orderId: string }> {
  const itemRes = await app.request(
    "/api/menu/items",
    withAuth(token, jsonInit("POST", { name: "唐揚げ", price })),
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
    data: { order: { id: string } };
  };

  await app.request(
    `/api/order/${qrToken}/request-payment`,
    { method: "PATCH" },
    env,
  );

  return { orderId: orderBody.data.order.id };
}

async function setupStore(): Promise<{ token: string }> {
  const { session_token: token } = await seedStore(
    `Payment Adjustments Test ${crypto.randomUUID()}`,
  );
  return { token };
}

describe("POST /api/payments discount", () => {
  it("defaults to no discount when omitted", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const res = await app.request(
      "/api/payments",
      withAuth(token, jsonInit("POST", { order_id: orderId })),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        total_amount: number;
        discount_amount: number;
        discount_reason: string | null;
      };
    };
    expect(body.data.total_amount).toBe(1000);
    expect(body.data.discount_amount).toBe(0);
    expect(body.data.discount_reason).toBeNull();
  });

  it("subtracts a valid discount from the charged total", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const res = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", {
          order_id: orderId,
          discount_amount: 200,
          discount_reason: "常連割引",
        }),
      ),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        total_amount: number;
        discount_amount: number;
        discount_reason: string | null;
      };
    };
    expect(body.data.total_amount).toBe(800);
    expect(body.data.discount_amount).toBe(200);
    expect(body.data.discount_reason).toBe("常連割引");
  });

  it("ignores a client-supplied total_amount and always recomputes it server-side", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const res = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", {
          order_id: orderId,
          discount_amount: 200,
          discount_reason: "常連割引",
          total_amount: 1, // must be ignored; server always computes 1000 - 200
        }),
      ),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { total_amount: number } };
    expect(body.data.total_amount).toBe(800);
  });

  it("allows a discount exactly equal to the items total (free check)", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const res = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", {
          order_id: orderId,
          discount_amount: 1000,
          discount_reason: "サービス",
        }),
      ),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { total_amount: number } };
    expect(body.data.total_amount).toBe(0);
  });

  it("returns 400 when the discount exceeds the items total", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const res = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", {
          order_id: orderId,
          discount_amount: 1001,
          discount_reason: "常連割引",
        }),
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when discount_amount > 0 but discount_reason is missing", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const res = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", { order_id: orderId, discount_amount: 200 }),
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when discount_amount is negative", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const res = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", {
          order_id: orderId,
          discount_amount: -100,
          discount_reason: "x",
        }),
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("ignores a whitespace-only discount_reason as if none were given (400)", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const res = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", {
          order_id: orderId,
          discount_amount: 200,
          discount_reason: "   ",
        }),
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("reports the recorded discount back via GET /api/payments", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token, 1000);

    const payRes = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", {
          order_id: orderId,
          discount_amount: 300,
          discount_reason: "団体割引",
        }),
      ),
      env,
    );
    const payBody = (await payRes.json()) as { data: { paid_at: number } };

    const res = await app.request(
      `/api/payments?from=${payBody.data.paid_at}&to=${payBody.data.paid_at + 1}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as {
      data: {
        order_id: string;
        discount_amount: number;
        discount_reason: string | null;
      }[];
    };
    const payment = body.data.find((p) => p.order_id === orderId);
    expect(payment?.discount_amount).toBe(300);
    expect(payment?.discount_reason).toBe("団体割引");
  });
});
