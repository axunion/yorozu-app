/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * GET /api/admin/orders/summary — the counts behind the admin nav badges and
 * the dashboard.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedMember, seedStore, withAuth } from "../test-helpers";

type Summary = {
  unserved_orders: number;
  open_calls: number;
  pending_bills: number;
  today_sales: { total: number; count: number };
};

async function setup() {
  const store = await seedStore(`Summary ${crypto.randomUUID()}`);
  const token = store.session_token;
  const itemRes = await app.request(
    "/api/menu/items",
    withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
    env,
  );
  const menuItemId = ((await itemRes.json()) as { data: { id: string } }).data
    .id;

  const seat = async (name: string) => {
    const res = await app.request(
      "/api/seats",
      withAuth(token, jsonInit("POST", { name })),
      env,
    );
    const qr = ((await res.json()) as { data: { qr_token: string } }).data
      .qr_token;
    const orderRes = await app.request(
      `/api/order/${qr}/items`,
      jsonInit("POST", { items: [{ menu_item_id: menuItemId, quantity: 2 }] }),
      env,
    );
    const orderId = (
      (await orderRes.json()) as { data: { order: { id: string } } }
    ).data.order.id;
    return { qr, orderId };
  };

  return { store, token, seat };
}

async function summary(token: string): Promise<Summary> {
  const res = await app.request(
    "/api/admin/orders/summary",
    withAuth(token),
    env,
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { data: Summary }).data;
}

describe("GET /api/admin/orders/summary", () => {
  it("counts orders with items to serve, open calls, pending bills and today's settled sales", async () => {
    const { store, token, seat } = await setup();
    // Open, with a call.
    const a = await seat("A");
    await app.request(`/api/order/${a.qr}/call`, { method: "POST" }, env);
    // Open but fully served: a table still eating, not work waiting.
    const served = await seat("E");
    const board = await app.request("/api/admin/orders", withAuth(token), env);
    const orders = (await board.json()) as {
      data: { id: string; items: { id: string }[] }[];
    };
    for (const item of orders.data.find((o) => o.id === served.orderId)
      ?.items ?? []) {
      await app.request(
        `/api/admin/orders/items/${item.id}/serve`,
        withAuth(token, { method: "PATCH" }),
        env,
      );
    }
    // Waiting at the register.
    const b = await seat("B");
    await app.request(
      `/api/order/${b.qr}/request-payment`,
      { method: "PATCH" },
      env,
    );
    // Paid today, then a second one paid and voided (excluded).
    for (const name of ["C", "D"]) {
      const paid = await seat(name);
      await app.request(
        `/api/order/${paid.qr}/request-payment`,
        { method: "PATCH" },
        env,
      );
      const payRes = await app.request(
        "/api/payments",
        withAuth(token, jsonInit("POST", { order_id: paid.orderId })),
        env,
      );
      if (name === "D") {
        const paymentId = ((await payRes.json()) as { data: { id: string } })
          .data.id;
        await app.request(
          `/api/payments/${paymentId}/void`,
          withAuth(token, jsonInit("PATCH", { void_reason: "打ち間違い" })),
          env,
        );
      }
    }

    // Staff see the same counts as the owner.
    const staff = await seedMember(store.id, "staff");
    const counts = await summary(staff.session_token);
    // D's void reopens it to payment_requested, so B and D are both waiting
    // — and, with nothing served, still count as work for the kitchen.
    expect(counts).toEqual({
      unserved_orders: 3,
      open_calls: 1,
      pending_bills: 2,
      today_sales: { total: 1000, count: 1 },
    });
  });

  it("shows only the caller's own store", async () => {
    const { seat } = await setup();
    await seat("A");
    const other = await seedStore(`Summary Other ${crypto.randomUUID()}`);

    expect(await summary(other.session_token)).toEqual({
      unserved_orders: 0,
      open_calls: 0,
      pending_bills: 0,
      today_sales: { total: 0, count: 0 },
    });
  });
});
