/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Staff-side order handling: sending an order to the register on the
 * customer's behalf, and entering items for a seat without the seat's QR.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedMember, seedStore, withAuth } from "../test-helpers";

type OrderBody = {
  data: {
    order: {
      id: string;
      status: string;
      items: {
        id: string;
        name_snapshot: string;
        quantity: number;
        note: string | null;
        options: { name_snapshot: string }[];
      }[];
      total: number;
    };
  };
};

async function setupStore() {
  const store = await seedStore(`Staff Entry ${crypto.randomUUID()}`);
  const token = store.session_token;

  const itemRes = await app.request(
    "/api/menu/items",
    withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
    env,
  );
  const menuItemId = ((await itemRes.json()) as { data: { id: string } }).data
    .id;

  const seatRes = await app.request(
    "/api/seats",
    withAuth(token, jsonInit("POST", { name: "テーブル1" })),
    env,
  );
  const seat = (
    (await seatRes.json()) as {
      data: { id: string; qr_token: string };
    }
  ).data;

  return { store, token, menuItemId, seat };
}

async function staffToken(storeId: string): Promise<string> {
  const staff = await seedMember(storeId, "staff");
  return staff.session_token;
}

async function customerOrder(qrToken: string, menuItemId: string) {
  const res = await app.request(
    `/api/order/${qrToken}/items`,
    jsonInit("POST", { items: [{ menu_item_id: menuItemId, quantity: 1 }] }),
    env,
  );
  return (await res.json()) as OrderBody;
}

// ---------------------------------------------------------------------------
// PATCH /api/admin/orders/:id/request-payment
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/orders/:id/request-payment", () => {
  it("lets staff move an open order to payment_requested, which the customer then sees", async () => {
    const { store, menuItemId, seat } = await setupStore();
    const order = await customerOrder(seat.qr_token, menuItemId);

    const res = await app.request(
      `/api/admin/orders/${order.data.order.id}/request-payment`,
      withAuth(await staffToken(store.id), { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data: { id: order.data.order.id, status: "payment_requested" },
    });

    const bootstrap = await app.request(`/api/order/${seat.qr_token}`, {}, env);
    const body = (await bootstrap.json()) as {
      data: { order: { status: string } };
    };
    expect(body.data.order.status).toBe("payment_requested");
  });

  it("is idempotent when the bill is already requested", async () => {
    const { token, menuItemId, seat } = await setupStore();
    const order = await customerOrder(seat.qr_token, menuItemId);
    const path = `/api/admin/orders/${order.data.order.id}/request-payment`;

    await app.request(path, withAuth(token, { method: "PATCH" }), env);
    const res = await app.request(
      path,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("returns 409 when every item on the order is cancelled", async () => {
    const { token, menuItemId, seat } = await setupStore();
    const order = await customerOrder(seat.qr_token, menuItemId);
    const itemId = order.data.order.items[0]?.id ?? "";
    await app.request(
      `/api/admin/orders/items/${itemId}/cancel`,
      withAuth(token, { method: "PATCH" }),
      env,
    );

    const res = await app.request(
      `/api/admin/orders/${order.data.order.id}/request-payment`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 409 for a paid order", async () => {
    const { token, menuItemId, seat } = await setupStore();
    const order = await customerOrder(seat.qr_token, menuItemId);
    await createDb(env.DB)
      .update(schema.orders)
      .set({ status: "paid", closed_at: Date.now() })
      .where(eq(schema.orders.id, order.data.order.id));

    const res = await app.request(
      `/api/admin/orders/${order.data.order.id}/request-payment`,
      withAuth(token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for another store's order (cross-tenant)", async () => {
    const { menuItemId, seat } = await setupStore();
    const order = await customerOrder(seat.qr_token, menuItemId);
    const other = await seedStore(`Other ${crypto.randomUUID()}`);

    const res = await app.request(
      `/api/admin/orders/${order.data.order.id}/request-payment`,
      withAuth(other.session_token, { method: "PATCH" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/orders/entry
// ---------------------------------------------------------------------------

describe("GET /api/admin/orders/entry", () => {
  it("gives staff the active seats and the orderable menu", async () => {
    const { store, token, menuItemId, seat } = await setupStore();
    // A sold-out item and a retired seat must not be offered.
    const soldOutRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "品切れ", price: 300 })),
      env,
    );
    const soldOutId = ((await soldOutRes.json()) as { data: { id: string } })
      .data.id;
    await app.request(
      `/api/menu/items/${soldOutId}`,
      withAuth(
        token,
        jsonInit("PATCH", {
          name: "品切れ",
          price: 300,
          is_available: false,
        }),
      ),
      env,
    );
    const retiredRes = await app.request(
      "/api/seats",
      withAuth(token, jsonInit("POST", { name: "撤去済み" })),
      env,
    );
    const retiredId = ((await retiredRes.json()) as { data: { id: string } })
      .data.id;
    await app.request(
      `/api/seats/${retiredId}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );

    const res = await app.request(
      "/api/admin/orders/entry",
      withAuth(await staffToken(store.id), {}),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        seats: { id: string; name: string }[];
        menu: { items: { id: string; option_groups: unknown[] }[] };
      };
    };
    expect(body.data.seats).toEqual([{ id: seat.id, name: "テーブル1" }]);
    expect(body.data.menu.items.map((i) => i.id)).toEqual([menuItemId]);
    expect(body.data.menu.items[0]?.option_groups).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/orders/seats/:seatId/items
// ---------------------------------------------------------------------------

describe("POST /api/admin/orders/seats/:seatId/items", () => {
  it("creates the seat's order, which the customer's screen then shows", async () => {
    const { store, menuItemId, seat } = await setupStore();

    const res = await app.request(
      `/api/admin/orders/seats/${seat.id}/items`,
      withAuth(
        await staffToken(store.id),
        jsonInit("POST", {
          items: [{ menu_item_id: menuItemId, quantity: 2, note: "辛め" }],
        }),
      ),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as OrderBody;
    expect(body.data.order.total).toBe(1000);
    expect(body.data.order.items[0]?.note).toBe("辛め");

    const bootstrap = await app.request(`/api/order/${seat.qr_token}`, {}, env);
    const seen = (await bootstrap.json()) as {
      data: { order: { id: string } };
    };
    expect(seen.data.order.id).toBe(body.data.order.id);
  });

  it("appends to the customer's existing order (200)", async () => {
    const { token, menuItemId, seat } = await setupStore();
    const order = await customerOrder(seat.qr_token, menuItemId);

    const res = await app.request(
      `/api/admin/orders/seats/${seat.id}/items`,
      withAuth(
        token,
        jsonInit("POST", {
          items: [{ menu_item_id: menuItemId, quantity: 1 }],
        }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as OrderBody;
    expect(body.data.order.id).toBe(order.data.order.id);
    expect(body.data.order.items).toHaveLength(2);
  });

  it("applies the customer path's validation (required option group)", async () => {
    const { token, menuItemId, seat } = await setupStore();
    const groupRes = await app.request(
      "/api/menu/option-groups",
      withAuth(
        token,
        jsonInit("POST", { name: "サイズ", min_select: 1, max_select: 1 }),
      ),
      env,
    );
    const groupId = ((await groupRes.json()) as { data: { id: string } }).data
      .id;
    await app.request(
      `/api/menu/option-groups/${groupId}/options`,
      withAuth(token, jsonInit("POST", { name: "大", price_delta: 100 })),
      env,
    );
    await app.request(
      `/api/menu/items/${menuItemId}`,
      withAuth(
        token,
        jsonInit("PATCH", {
          name: "唐揚げ",
          price: 500,
          is_available: true,
          option_group_ids: [groupId],
        }),
      ),
      env,
    );

    const res = await app.request(
      `/api/admin/orders/seats/${seat.id}/items`,
      withAuth(
        token,
        jsonInit("POST", {
          items: [{ menu_item_id: menuItemId, quantity: 1 }],
        }),
      ),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 409 once the bill is requested", async () => {
    const { token, menuItemId, seat } = await setupStore();
    await customerOrder(seat.qr_token, menuItemId);
    await app.request(
      `/api/order/${seat.qr_token}/request-payment`,
      { method: "PATCH" },
      env,
    );

    const res = await app.request(
      `/api/admin/orders/seats/${seat.id}/items`,
      withAuth(
        token,
        jsonInit("POST", {
          items: [{ menu_item_id: menuItemId, quantity: 1 }],
        }),
      ),
      env,
    );
    expect(res.status).toBe(409);
  });

  it("returns 404 for another store's seat (cross-tenant)", async () => {
    const { seat } = await setupStore();
    const other = await setupStore();

    const res = await app.request(
      `/api/admin/orders/seats/${seat.id}/items`,
      withAuth(
        other.token,
        jsonInit("POST", {
          items: [{ menu_item_id: other.menuItemId, quantity: 1 }],
        }),
      ),
      env,
    );
    expect(res.status).toBe(404);
  });
});
