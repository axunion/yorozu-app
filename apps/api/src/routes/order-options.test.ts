/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Item options / modifiers (roadmap Phase 3 item 2): customer bootstrap
 * embedding, order submission validation, snapshot durability, and
 * checkout totals.
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

async function createGroup(
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await app.request(
    "/api/menu/option-groups",
    withAuth(token, jsonInit("POST", body)),
    env,
  );
  const { data } = (await res.json()) as { data: { id: string } };
  return data.id;
}

async function createOption(
  token: string,
  groupId: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await app.request(
    `/api/menu/option-groups/${groupId}/options`,
    withAuth(token, jsonInit("POST", body)),
    env,
  );
  const { data } = (await res.json()) as { data: { id: string } };
  return data.id;
}

async function createItem(
  token: string,
  name: string,
  price: number,
): Promise<string> {
  const res = await app.request(
    "/api/menu/items",
    withAuth(token, jsonInit("POST", { name, price })),
    env,
  );
  const { data } = (await res.json()) as { data: { id: string } };
  return data.id;
}

async function attachGroups(
  token: string,
  itemId: string,
  name: string,
  price: number,
  groupIds: string[],
): Promise<void> {
  await app.request(
    `/api/menu/items/${itemId}`,
    withAuth(
      token,
      jsonInit("PATCH", {
        name,
        price,
        is_available: true,
        option_group_ids: groupIds,
      }),
    ),
    env,
  );
}

async function createSeat(token: string): Promise<string> {
  const res = await app.request(
    "/api/seats",
    withAuth(token, jsonInit("POST", { name: "テーブル1" })),
    env,
  );
  const { data } = (await res.json()) as { data: { qr_token: string } };
  return data.qr_token;
}

/**
 * Builds a store with a "Size" group (exactly-one-choice: min=max=1,
 * options "Small" price_delta -100 / "Large" price_delta +100), attached
 * to a 500 JPY item, plus a seat. Mirrors the common case across tests.
 */
async function setupSizedItem(): Promise<{
  token: string;
  qrToken: string;
  itemId: string;
  groupId: string;
  smallId: string;
  largeId: string;
}> {
  const { session_token: token } = await seedStore(
    `Sized Item ${crypto.randomUUID()}`,
  );
  const groupId = await createGroup(token, {
    name: "Size",
    min_select: 1,
    max_select: 1,
  });
  const smallId = await createOption(token, groupId, {
    name: "Small",
    price_delta: -100,
  });
  const largeId = await createOption(token, groupId, {
    name: "Large",
    price_delta: 100,
  });
  const itemId = await createItem(token, "コーヒー", 500);
  await attachGroups(token, itemId, "コーヒー", 500, [groupId]);
  const qrToken = await createSeat(token);
  return { token, qrToken, itemId, groupId, smallId, largeId };
}

// ---------------------------------------------------------------------------
// Bootstrap embedding
// ---------------------------------------------------------------------------

describe("GET /api/order/:seatToken option group embedding", () => {
  it("embeds attached groups and their options for an item", async () => {
    const { qrToken, groupId, smallId, largeId } = await setupSizedItem();

    const res = await app.request(`/api/order/${qrToken}`, {}, env);
    const body = (await res.json()) as {
      data: {
        menu: {
          items: {
            id: string;
            option_groups: {
              id: string;
              name: string;
              min_select: number;
              max_select: number;
              options: { id: string; name: string; price_delta: number }[];
            }[];
          }[];
        };
      };
    };
    const item = body.data.menu.items[0];
    expect(item?.option_groups).toHaveLength(1);
    const group = item?.option_groups[0];
    expect(group?.id).toBe(groupId);
    expect(group?.min_select).toBe(1);
    expect(group?.max_select).toBe(1);
    const optionIds = group?.options.map((o) => o.id).sort();
    expect(optionIds).toEqual([largeId, smallId].sort());
  });

  it("returns an empty array for items with no attached groups", async () => {
    const { session_token: token } = await seedStore(
      `No Groups ${crypto.randomUUID()}`,
    );
    await createItem(token, "ビール", 600);
    const qrToken = await createSeat(token);

    const res = await app.request(`/api/order/${qrToken}`, {}, env);
    const body = (await res.json()) as {
      data: { menu: { items: { option_groups: unknown[] }[] } };
    };
    expect(body.data.menu.items[0]?.option_groups).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Order submission validation matrix
// ---------------------------------------------------------------------------

describe("POST /api/order/:seatToken/items option validation", () => {
  it("accepts a valid option selection and a note", async () => {
    const { qrToken, itemId, largeId } = await setupSizedItem();

    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [
          {
            menu_item_id: itemId,
            quantity: 1,
            option_ids: [largeId],
            note: "  氷少なめ  ",
          },
        ],
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        order: {
          total: number;
          items: {
            options: { name_snapshot: string; price_delta_snapshot: number }[];
            note: string | null;
          }[];
        };
      };
    };
    const item = body.data.order.items[0];
    expect(item?.note).toBe("氷少なめ");
    expect(item?.options).toHaveLength(1);
    expect(item?.options[0]?.name_snapshot).toBe("Large");
    expect(item?.options[0]?.price_delta_snapshot).toBe(100);
    expect(body.data.order.total).toBe(600); // 500 + 100
  });

  it("rejects a nonexistent option id", async () => {
    const { qrToken, itemId } = await setupSizedItem();
    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [
          { menu_item_id: itemId, quantity: 1, option_ids: ["nonexistent"] },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an option belonging to a group attached to a different item (unattached option)", async () => {
    const { session_token: token } = await seedStore(
      `Cross Item Option ${crypto.randomUUID()}`,
    );
    const groupId = await createGroup(token, { name: "Milk", max_select: 1 });
    const milkOptionId = await createOption(token, groupId, {
      name: "Oat Milk",
      price_delta: 50,
    });
    const itemWithMilkId = await createItem(token, "ラテ", 500);
    await attachGroups(token, itemWithMilkId, "ラテ", 500, [groupId]);
    // A second item that does NOT have the Milk group attached.
    const itemWithoutMilkId = await createItem(token, "紅茶", 400);
    const qrToken = await createSeat(token);

    // Order both items in the same request so the Milk group (and its
    // option) resolve via itemWithMilkId — otherwise milkOptionId would
    // never enter the query's candidate set at all, and this test would
    // pass for the wrong reason (indistinguishable from a nonexistent id).
    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [
          { menu_item_id: itemWithMilkId, quantity: 1, option_ids: [] },
          {
            menu_item_id: itemWithoutMilkId,
            quantity: 1,
            option_ids: [milkOptionId],
          },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects an option belonging to another store, even if somehow attached (foreign store's option)", async () => {
    const { qrToken, itemId } = await setupSizedItem();
    const { session_token: otherToken } = await seedStore(
      `Other Store Option ${crypto.randomUUID()}`,
    );
    const otherGroupId = await createGroup(otherToken, {
      name: "Size",
      max_select: 1,
    });
    const foreignOptionId = await createOption(otherToken, otherGroupId, {
      name: "XL",
      price_delta: 200,
    });

    // The admin attach API (validateOptionGroupIds) would never let a
    // cross-store group attach to itemId — write the join row directly to
    // simulate that guard failing, so this test actually exercises the
    // order-submission layer's own store_id filters (order.ts's
    // attachedGroupRows/optionRows queries) rather than passing only
    // because the option was never resolvable in the first place.
    const db = createDb(env.DB);
    await db.insert(schema.menuItemOptionGroups).values({
      id: crypto.randomUUID(),
      menu_item_id: itemId,
      group_id: otherGroupId,
      sort_order: 0,
    });

    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [
          {
            menu_item_id: itemId,
            quantity: 1,
            option_ids: [foreignOptionId],
          },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a selection count under min_select", async () => {
    const { qrToken, itemId } = await setupSizedItem();
    // Size group has min_select=1 — selecting nothing must fail.
    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemId, quantity: 1, option_ids: [] }],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects a selection count over max_select", async () => {
    const { qrToken, itemId, smallId, largeId } = await setupSizedItem();
    // Size group has max_select=1 — selecting both must fail.
    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [
          {
            menu_item_id: itemId,
            quantity: 1,
            option_ids: [smallId, largeId],
          },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("rejects when the item's price plus selected deltas is 0 or negative", async () => {
    const { session_token: token } = await seedStore(
      `Negative Price ${crypto.randomUUID()}`,
    );
    const groupId = await createGroup(token, {
      name: "Discount",
      max_select: 1,
    });
    const discountId = await createOption(token, groupId, {
      name: "Huge Discount",
      price_delta: -500,
    });
    const itemId = await createItem(token, "コーヒー", 400);
    await attachGroups(token, itemId, "コーヒー", 400, [groupId]);
    const qrToken = await createSeat(token);

    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [
          { menu_item_id: itemId, quantity: 1, option_ids: [discountId] },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("価格が0円以下");
  });

  it("rejects when price plus deltas is exactly 0 (boundary)", async () => {
    const { session_token: token } = await seedStore(
      `Zero Price ${crypto.randomUUID()}`,
    );
    const groupId = await createGroup(token, {
      name: "Discount",
      max_select: 1,
    });
    // 500 + (-500) === 0, must still be rejected (invariant is "> 0").
    const discountId = await createOption(token, groupId, {
      name: "Exact Discount",
      price_delta: -500,
    });
    const itemId = await createItem(token, "コーヒー", 500);
    await attachGroups(token, itemId, "コーヒー", 500, [groupId]);
    const qrToken = await createSeat(token);

    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [
          { menu_item_id: itemId, quantity: 1, option_ids: [discountId] },
        ],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("does not create an order when option validation fails", async () => {
    const { qrToken, itemId } = await setupSizedItem();
    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemId, quantity: 1, option_ids: [] }],
      }),
      env,
    );
    expect(res.status).toBe(400);

    const bootstrapRes = await app.request(`/api/order/${qrToken}`, {}, env);
    const bootstrapBody = (await bootstrapRes.json()) as {
      data: { order: null };
    };
    expect(bootstrapBody.data.order).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Snapshot durability
// ---------------------------------------------------------------------------

describe("Option snapshots survive later edits", () => {
  it("keeps the order's option snapshot unchanged after the option is edited", async () => {
    const { token, qrToken, itemId, groupId, largeId } = await setupSizedItem();

    const orderRes = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemId, quantity: 1, option_ids: [largeId] }],
      }),
      env,
    );
    expect(orderRes.status).toBe(201);
    const orderBody = (await orderRes.json()) as {
      data: { order: { total: number } };
    };
    expect(orderBody.data.order.total).toBe(600); // 500 + 100

    // Edit the option's name and price_delta after the order was placed.
    const editRes = await app.request(
      `/api/menu/option-groups/${groupId}/options/${largeId}`,
      withAuth(
        token,
        jsonInit("PATCH", { name: "Large (renamed)", price_delta: 999 }),
      ),
      env,
    );
    expect(editRes.status).toBe(200);
    const editBody = (await editRes.json()) as {
      data: { name: string; price_delta: number };
    };
    // Confirm the edit actually landed before checking the order didn't
    // move — otherwise a broken PATCH would make this test pass vacuously.
    expect(editBody.data.name).toBe("Large (renamed)");
    expect(editBody.data.price_delta).toBe(999);

    const bootstrapRes = await app.request(`/api/order/${qrToken}`, {}, env);
    const bootstrapBody = (await bootstrapRes.json()) as {
      data: {
        order: {
          total: number;
          items: {
            options: { name_snapshot: string; price_delta_snapshot: number }[];
          }[];
        };
      };
    };
    expect(bootstrapBody.data.order.total).toBe(600);
    expect(bootstrapBody.data.order.items[0]?.options[0]?.name_snapshot).toBe(
      "Large",
    );
    expect(
      bootstrapBody.data.order.items[0]?.options[0]?.price_delta_snapshot,
    ).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Totals correct at checkout
// ---------------------------------------------------------------------------

describe("Totals with options are correct end-to-end", () => {
  it("reflects option deltas in the admin board, pending checkout, and payment total", async () => {
    const { token, qrToken, itemId, largeId } = await setupSizedItem();

    await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemId, quantity: 2, option_ids: [largeId] }],
      }),
      env,
    );

    // Admin board total: (500 + 100) x 2 = 1200
    const boardRes = await app.request(
      "/api/admin/orders",
      withAuth(token),
      env,
    );
    const boardBody = (await boardRes.json()) as {
      data: { total: number }[];
    };
    expect(boardBody.data[0]?.total).toBe(1200);

    await app.request(
      `/api/order/${qrToken}/request-payment`,
      { method: "PATCH" },
      env,
    );

    const pendingRes = await app.request(
      "/api/payments/pending",
      withAuth(token),
      env,
    );
    const pendingBody = (await pendingRes.json()) as {
      data: { id: string; total: number }[];
    };
    expect(pendingBody.data[0]?.total).toBe(1200);
    const orderId = pendingBody.data[0]?.id as string;

    const payRes = await app.request(
      "/api/payments",
      withAuth(token, jsonInit("POST", { order_id: orderId })),
      env,
    );
    expect(payRes.status).toBe(201);
    const payBody = (await payRes.json()) as { data: { total_amount: number } };
    expect(payBody.data.total_amount).toBe(1200);

    // Sales history reflects the same total, with the option snapshot intact.
    const from = Date.now() - 60_000;
    const to = Date.now() + 60_000;
    const historyRes = await app.request(
      `/api/payments?from=${from}&to=${to}`,
      withAuth(token),
      env,
    );
    const historyBody = (await historyRes.json()) as {
      data: {
        total_amount: number;
        items: { options: { name_snapshot: string }[] }[];
      }[];
    };
    expect(historyBody.data[0]?.total_amount).toBe(1200);
    expect(historyBody.data[0]?.items[0]?.options[0]?.name_snapshot).toBe(
      "Large",
    );
  });
});

// ---------------------------------------------------------------------------
// Multi-select groups (0..N, e.g. "up to 3 toppings")
// ---------------------------------------------------------------------------

describe("Multi-select option groups (min_select=0, max_select>1)", () => {
  it("accepts zero, one, or several selections within max_select", async () => {
    const { session_token: token } = await seedStore(
      `Toppings ${crypto.randomUUID()}`,
    );
    const groupId = await createGroup(token, {
      name: "Toppings",
      min_select: 0,
      max_select: 3,
    });
    const cheeseId = await createOption(token, groupId, {
      name: "Cheese",
      price_delta: 50,
    });
    const baconId = await createOption(token, groupId, {
      name: "Bacon",
      price_delta: 80,
    });
    const itemId = await createItem(token, "ラーメン", 800);
    await attachGroups(token, itemId, "ラーメン", 800, [groupId]);
    const qrToken = await createSeat(token);

    // Zero toppings is allowed (min_select=0).
    const zeroRes = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemId, quantity: 1, option_ids: [] }],
      }),
      env,
    );
    expect(zeroRes.status).toBe(201);

    // Two toppings (within max_select=3) is also allowed.
    const twoRes = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [
          {
            menu_item_id: itemId,
            quantity: 1,
            option_ids: [cheeseId, baconId],
          },
        ],
      }),
      env,
    );
    expect(twoRes.status).toBe(200);
    const twoBody = (await twoRes.json()) as {
      data: { order: { total: number } };
    };
    // First line: 800 (no toppings). Second line: 800 + 50 + 80 = 930.
    expect(twoBody.data.order.total).toBe(800 + 930);
  });

  it("rejects a selection count over max_select for a multi-select group", async () => {
    const { session_token: token } = await seedStore(
      `Too Many Toppings ${crypto.randomUUID()}`,
    );
    const groupId = await createGroup(token, {
      name: "Toppings",
      min_select: 0,
      max_select: 2,
    });
    const optionIds = await Promise.all(
      ["Cheese", "Bacon", "Egg"].map((name) =>
        createOption(token, groupId, { name, price_delta: 50 }),
      ),
    );
    const itemId = await createItem(token, "ラーメン", 800);
    await attachGroups(token, itemId, "ラーメン", 800, [groupId]);
    const qrToken = await createSeat(token);

    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemId, quantity: 1, option_ids: optionIds }],
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Miscellaneous: item without options still works (regression guard)
// ---------------------------------------------------------------------------

describe("Items without option groups", () => {
  it("still order normally with an empty option_ids array", async () => {
    const { session_token: token } = await seedStore(
      `Plain Item ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "ビール", 600);
    const qrToken = await createSeat(token);

    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemId, quantity: 1 }],
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { order: { total: number; items: { options: unknown[] }[] } };
    };
    expect(body.data.order.total).toBe(600);
    expect(body.data.order.items[0]?.options).toEqual([]);
  });
});

// Sanity: direct DB check that order_item_options rows are actually written.
describe("order_item_options rows", () => {
  it("are created for each selected option", async () => {
    const { qrToken, itemId, largeId } = await setupSizedItem();
    const res = await app.request(
      `/api/order/${qrToken}/items`,
      jsonInit("POST", {
        items: [{ menu_item_id: itemId, quantity: 1, option_ids: [largeId] }],
      }),
      env,
    );
    const body = (await res.json()) as {
      data: { order: { items: { id: string }[] } };
    };
    const orderItemId = body.data.order.items[0]?.id as string;

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(schema.orderItemOptions)
      .where(eq(schema.orderItemOptions.order_item_id, orderItemId));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name_snapshot).toBe("Large");
    expect(rows[0]?.price_delta_snapshot).toBe(100);
  });
});
