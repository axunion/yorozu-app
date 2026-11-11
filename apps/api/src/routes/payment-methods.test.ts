/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Cashless payment methods.
 * Covers POST /api/payments' `method` field: default, valid values,
 * validation, and that it's reported back via GET /api/payments.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

async function setupOrder(
  token: string,
): Promise<{ orderId: string; qrToken: string }> {
  const itemRes = await app.request(
    "/api/menu/items",
    withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
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

  return { orderId: orderBody.data.order.id, qrToken };
}

async function setupStore(): Promise<{ token: string }> {
  const { session_token: token } = await seedStore(
    `Payment Methods Test ${crypto.randomUUID()}`,
  );
  return { token };
}

describe("POST /api/payments method", () => {
  it("defaults to 'cash' when method is omitted", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token);

    const res = await app.request(
      "/api/payments",
      withAuth(token, jsonInit("POST", { order_id: orderId })),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { method: string } };
    expect(body.data.method).toBe("cash");
  });

  it.each(["cash", "card", "qr"])(
    "accepts and echoes method '%s'",
    async (method) => {
      const { token } = await setupStore();
      const { orderId } = await setupOrder(token);

      const res = await app.request(
        "/api/payments",
        withAuth(token, jsonInit("POST", { order_id: orderId, method })),
        env,
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { method: string } };
      expect(body.data.method).toBe(method);
    },
  );

  it("returns 400 VALIDATION_ERROR for an unrecognized method value", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token);

    const res = await app.request(
      "/api/payments",
      withAuth(
        token,
        jsonInit("POST", { order_id: orderId, method: "bitcoin" }),
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("reports the recorded method back via GET /api/payments", async () => {
    const { token } = await setupStore();
    const { orderId } = await setupOrder(token);

    const payRes = await app.request(
      "/api/payments",
      withAuth(token, jsonInit("POST", { order_id: orderId, method: "qr" })),
      env,
    );
    const payBody = (await payRes.json()) as { data: { paid_at: number } };

    const res = await app.request(
      `/api/payments?from=${payBody.data.paid_at}&to=${payBody.data.paid_at + 1}`,
      withAuth(token),
      env,
    );
    const body = (await res.json()) as {
      data: { order_id: string; method: string }[];
    };
    const payment = body.data.find((p) => p.order_id === orderId);
    expect(payment?.method).toBe("qr");
  });
});
