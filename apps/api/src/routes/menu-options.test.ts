/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Item options / modifiers (roadmap Phase 3 item 2): option group and
 * option CRUD, plus tenant isolation and cascade-delete behavior.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

async function createGroup(
  token: string,
  body: Record<string, unknown> = { name: "Size" },
): Promise<{ id: string }> {
  const res = await app.request(
    "/api/menu/option-groups",
    withAuth(token, jsonInit("POST", body)),
    env,
  );
  const { data } = (await res.json()) as { data: { id: string } };
  return data;
}

async function createOption(
  token: string,
  groupId: string,
  body: Record<string, unknown> = { name: "Large", price_delta: 100 },
): Promise<{ id: string }> {
  const res = await app.request(
    `/api/menu/option-groups/${groupId}/options`,
    withAuth(token, jsonInit("POST", body)),
    env,
  );
  const { data } = (await res.json()) as { data: { id: string } };
  return data;
}

// ---------------------------------------------------------------------------
// Option groups
// ---------------------------------------------------------------------------

describe("POST /api/menu/option-groups", () => {
  it("creates a group with min_select/max_select defaults", async () => {
    const { session_token: token } = await seedStore(
      `Create Group ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      "/api/menu/option-groups",
      withAuth(token, jsonInit("POST", { name: "Size" })),
      env,
    );
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as {
      data: { name: string; min_select: number; max_select: number };
    };
    expect(data.name).toBe("Size");
    expect(data.min_select).toBe(0);
    expect(data.max_select).toBe(1);
  });

  it("rejects min_select greater than max_select", async () => {
    const { session_token: token } = await seedStore(
      `Reject Group ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      "/api/menu/option-groups",
      withAuth(
        token,
        jsonInit("POST", { name: "Size", min_select: 2, max_select: 1 }),
      ),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/menu/option-groups", () => {
  it("only returns the authenticated store's groups", async () => {
    const { session_token: tokenA } = await seedStore(
      `Store A Groups ${crypto.randomUUID()}`,
    );
    const { session_token: tokenB } = await seedStore(
      `Store B Groups ${crypto.randomUUID()}`,
    );
    await createGroup(tokenA, { name: "A's Size" });
    await createGroup(tokenB, { name: "B's Size" });

    const res = await app.request(
      "/api/menu/option-groups",
      withAuth(tokenA),
      env,
    );
    const { data } = (await res.json()) as { data: { name: string }[] };
    expect(data.map((g) => g.name)).toEqual(["A's Size"]);
  });
});

describe("PATCH /api/menu/option-groups/:id", () => {
  it("updates a group's fields", async () => {
    const { session_token: token } = await seedStore(
      `Update Group ${crypto.randomUUID()}`,
    );
    const group = await createGroup(token);
    const res = await app.request(
      `/api/menu/option-groups/${group.id}`,
      withAuth(
        token,
        jsonInit("PATCH", {
          name: "Toppings",
          min_select: 0,
          max_select: 3,
          sort_order: 1,
        }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { name: string; max_select: number };
    };
    expect(data.name).toBe("Toppings");
    expect(data.max_select).toBe(3);
  });

  it("returns 404 for another store's group", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Owner Group ${crypto.randomUUID()}`,
    );
    const { session_token: otherToken } = await seedStore(
      `Other Group ${crypto.randomUUID()}`,
    );
    const group = await createGroup(ownerToken);

    const res = await app.request(
      `/api/menu/option-groups/${group.id}`,
      withAuth(otherToken, jsonInit("PATCH", { name: "Hijacked" })),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/menu/option-groups/:id", () => {
  it("deletes the group, its options, and its item attachments", async () => {
    const { session_token: token } = await seedStore(
      `Delete Group ${crypto.randomUUID()}`,
    );
    const group = await createGroup(token);
    const option = await createOption(token, group.id);

    const itemRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "Latte", price: 500 })),
      env,
    );
    const { data: item } = (await itemRes.json()) as { data: { id: string } };
    await app.request(
      `/api/menu/items/${item.id}`,
      withAuth(
        token,
        jsonInit("PATCH", {
          name: "Latte",
          price: 500,
          is_available: true,
          option_group_ids: [group.id],
        }),
      ),
      env,
    );

    const deleteRes = await app.request(
      `/api/menu/option-groups/${group.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(deleteRes.status).toBe(200);

    // The group is gone.
    const listRes = await app.request(
      "/api/menu/option-groups",
      withAuth(token),
      env,
    );
    const { data: groups } = (await listRes.json()) as {
      data: { id: string }[];
    };
    expect(groups.find((g) => g.id === group.id)).toBeUndefined();

    // Fetching options under the deleted group 404s.
    const optionsRes = await app.request(
      `/api/menu/option-groups/${group.id}/options`,
      withAuth(token),
      env,
    );
    expect(optionsRes.status).toBe(404);

    // The option row itself is gone, not just unreachable via the group.
    const db = createDb(env.DB);
    const remaining = await db
      .select({ id: schema.options.id })
      .from(schema.options)
      .where(eq(schema.options.id, option.id));
    expect(remaining).toHaveLength(0);

    // The item's attachment is gone too.
    const itemGetRes = await app.request(
      "/api/menu/items",
      withAuth(token),
      env,
    );
    const { data: items } = (await itemGetRes.json()) as {
      data: { id: string; option_group_ids: string[] }[];
    };
    expect(items.find((i) => i.id === item.id)?.option_group_ids).toEqual([]);
  });

  it("returns 404 for another store's group", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Owner Delete Group ${crypto.randomUUID()}`,
    );
    const { session_token: otherToken } = await seedStore(
      `Other Delete Group ${crypto.randomUUID()}`,
    );
    const group = await createGroup(ownerToken);

    const res = await app.request(
      `/api/menu/option-groups/${group.id}`,
      withAuth(otherToken, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(404);

    const listRes = await app.request(
      "/api/menu/option-groups",
      withAuth(ownerToken),
      env,
    );
    const { data: groups } = (await listRes.json()) as {
      data: { id: string }[];
    };
    expect(groups.find((g) => g.id === group.id)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Options (nested under a group)
// ---------------------------------------------------------------------------

describe("POST /api/menu/option-groups/:groupId/options", () => {
  it("creates an option with a negative price_delta", async () => {
    const { session_token: token } = await seedStore(
      `Create Option ${crypto.randomUUID()}`,
    );
    const group = await createGroup(token);
    const res = await app.request(
      `/api/menu/option-groups/${group.id}/options`,
      withAuth(token, jsonInit("POST", { name: "Small", price_delta: -100 })),
      env,
    );
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as {
      data: { name: string; price_delta: number; group_id: string };
    };
    expect(data.price_delta).toBe(-100);
    expect(data.group_id).toBe(group.id);
  });

  it("returns 404 when the group belongs to another store", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Owner Option Group ${crypto.randomUUID()}`,
    );
    const { session_token: otherToken } = await seedStore(
      `Other Option Group ${crypto.randomUUID()}`,
    );
    const group = await createGroup(ownerToken);

    const res = await app.request(
      `/api/menu/option-groups/${group.id}/options`,
      withAuth(
        otherToken,
        jsonInit("POST", { name: "Large", price_delta: 100 }),
      ),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/menu/option-groups/:groupId/options", () => {
  it("lists options for the group, ordered by sort_order", async () => {
    const { session_token: token } = await seedStore(
      `List Options ${crypto.randomUUID()}`,
    );
    const group = await createGroup(token);
    await createOption(token, group.id, {
      name: "Large",
      price_delta: 100,
      sort_order: 1,
    });
    await createOption(token, group.id, {
      name: "Small",
      price_delta: -50,
      sort_order: 0,
    });

    const res = await app.request(
      `/api/menu/option-groups/${group.id}/options`,
      withAuth(token),
      env,
    );
    const { data } = (await res.json()) as { data: { name: string }[] };
    expect(data.map((o) => o.name)).toEqual(["Small", "Large"]);
  });

  it("returns 404 when the group belongs to another store", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Owner List Options ${crypto.randomUUID()}`,
    );
    const { session_token: otherToken } = await seedStore(
      `Other List Options ${crypto.randomUUID()}`,
    );
    const group = await createGroup(ownerToken);

    const res = await app.request(
      `/api/menu/option-groups/${group.id}/options`,
      withAuth(otherToken),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/menu/option-groups/:groupId/options/:optionId", () => {
  it("updates an option's fields", async () => {
    const { session_token: token } = await seedStore(
      `Update Option ${crypto.randomUUID()}`,
    );
    const group = await createGroup(token);
    const option = await createOption(token, group.id);

    const res = await app.request(
      `/api/menu/option-groups/${group.id}/options/${option.id}`,
      withAuth(
        token,
        jsonInit("PATCH", { name: "Extra Large", price_delta: 200 }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { name: string; price_delta: number };
    };
    expect(data.name).toBe("Extra Large");
    expect(data.price_delta).toBe(200);
  });

  it("returns 404 when the option belongs to a different group", async () => {
    const { session_token: token } = await seedStore(
      `Wrong Group Option ${crypto.randomUUID()}`,
    );
    const group1 = await createGroup(token, { name: "Size" });
    const group2 = await createGroup(token, { name: "Toppings" });
    const option = await createOption(token, group1.id);

    const res = await app.request(
      `/api/menu/option-groups/${group2.id}/options/${option.id}`,
      withAuth(token, jsonInit("PATCH", { name: "Hijacked", price_delta: 0 })),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the option belongs to another store", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Owner Option ${crypto.randomUUID()}`,
    );
    const { session_token: otherToken } = await seedStore(
      `Other Option ${crypto.randomUUID()}`,
    );
    const group = await createGroup(ownerToken);
    const option = await createOption(ownerToken, group.id);

    const res = await app.request(
      `/api/menu/option-groups/${group.id}/options/${option.id}`,
      withAuth(
        otherToken,
        jsonInit("PATCH", { name: "Hijacked", price_delta: 0 }),
      ),
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/menu/option-groups/:groupId/options/:optionId", () => {
  it("deletes the option", async () => {
    const { session_token: token } = await seedStore(
      `Delete Option ${crypto.randomUUID()}`,
    );
    const group = await createGroup(token);
    const option = await createOption(token, group.id);

    const res = await app.request(
      `/api/menu/option-groups/${group.id}/options/${option.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(200);

    const listRes = await app.request(
      `/api/menu/option-groups/${group.id}/options`,
      withAuth(token),
      env,
    );
    const { data } = (await listRes.json()) as { data: { id: string }[] };
    expect(data).toEqual([]);
  });

  it("returns 404 for another store's option", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Owner Delete Option ${crypto.randomUUID()}`,
    );
    const { session_token: otherToken } = await seedStore(
      `Other Delete Option ${crypto.randomUUID()}`,
    );
    const group = await createGroup(ownerToken);
    const option = await createOption(ownerToken, group.id);

    const res = await app.request(
      `/api/menu/option-groups/${group.id}/options/${option.id}`,
      withAuth(otherToken, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it("returns 404 when the option belongs to a different group", async () => {
    const { session_token: token } = await seedStore(
      `Wrong Group Delete Option ${crypto.randomUUID()}`,
    );
    const group1 = await createGroup(token, { name: "Size" });
    const group2 = await createGroup(token, { name: "Toppings" });
    const option = await createOption(token, group1.id);

    const res = await app.request(
      `/api/menu/option-groups/${group2.id}/options/${option.id}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(404);
  });
});
