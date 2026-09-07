/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Menu item description field (roadmap Phase 3 item 1).
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

describe("POST /api/menu/items description", () => {
  it("persists and returns a trimmed description", async () => {
    const { session_token: token } = await seedStore(
      `Create Description ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/menu/items",
      withAuth(
        token,
        jsonInit("POST", {
          name: "唐揚げ",
          price: 500,
          description: "  国産鶏もも肉を使用。  ",
        }),
      ),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { description: string } };
    expect(body.data.description).toBe("国産鶏もも肉を使用。");
  });

  it("defaults to null when omitted", async () => {
    const { session_token: token } = await seedStore(
      `Create No Description ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "ビール", price: 600 })),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { description: string | null } };
    expect(body.data.description).toBeNull();
  });
});

describe("PATCH /api/menu/items/:id description", () => {
  it("updates the description", async () => {
    const { session_token: token } = await seedStore(
      `Update Description ${crypto.randomUUID()}`,
    );
    const createRes = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
      env,
    );
    const { data: created } = (await createRes.json()) as {
      data: { id: string };
    };

    const res = await app.request(
      `/api/menu/items/${created.id}`,
      withAuth(
        token,
        jsonInit("PATCH", {
          name: "唐揚げ",
          price: 500,
          is_available: true,
          description: "新しい説明文",
        }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { description: string } };
    expect(body.data.description).toBe("新しい説明文");
  });

  it("preserves the existing description when omitted", async () => {
    const { session_token: token } = await seedStore(
      `Preserve Description ${crypto.randomUUID()}`,
    );
    const createRes = await app.request(
      "/api/menu/items",
      withAuth(
        token,
        jsonInit("POST", {
          name: "唐揚げ",
          price: 500,
          description: "元の説明",
        }),
      ),
      env,
    );
    const { data: created } = (await createRes.json()) as {
      data: { id: string };
    };

    const res = await app.request(
      `/api/menu/items/${created.id}`,
      withAuth(
        token,
        jsonInit("PATCH", { name: "唐揚げ改", price: 500, is_available: true }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { description: string } };
    expect(body.data.description).toBe("元の説明");
  });

  it("clears the description when explicitly null", async () => {
    const { session_token: token } = await seedStore(
      `Clear Description ${crypto.randomUUID()}`,
    );
    const createRes = await app.request(
      "/api/menu/items",
      withAuth(
        token,
        jsonInit("POST", {
          name: "唐揚げ",
          price: 500,
          description: "元の説明",
        }),
      ),
      env,
    );
    const { data: created } = (await createRes.json()) as {
      data: { id: string };
    };

    const res = await app.request(
      `/api/menu/items/${created.id}`,
      withAuth(
        token,
        jsonInit("PATCH", {
          name: "唐揚げ",
          price: 500,
          is_available: true,
          description: null,
        }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { description: string | null } };
    expect(body.data.description).toBeNull();
  });
});

describe("Menu item option group attachment", () => {
  async function createGroup(token: string, name: string): Promise<string> {
    const res = await app.request(
      "/api/menu/option-groups",
      withAuth(token, jsonInit("POST", { name })),
      env,
    );
    const { data } = (await res.json()) as { data: { id: string } };
    return data.id;
  }

  async function createItem(token: string, name: string): Promise<string> {
    const res = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name, price: 500 })),
      env,
    );
    const { data } = (await res.json()) as { data: { id: string } };
    return data.id;
  }

  it("POST /api/menu/items always starts with no attached groups", async () => {
    const { session_token: token } = await seedStore(
      `New Item No Groups ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      "/api/menu/items",
      withAuth(token, jsonInit("POST", { name: "唐揚げ", price: 500 })),
      env,
    );
    const body = (await res.json()) as {
      data: { option_group_ids: string[] };
    };
    expect(body.data.option_group_ids).toEqual([]);
  });

  it("attaches groups via PATCH and reflects them on GET /api/menu/items", async () => {
    const { session_token: token } = await seedStore(
      `Attach Groups ${crypto.randomUUID()}`,
    );
    const groupId1 = await createGroup(token, "Size");
    const groupId2 = await createGroup(token, "Toppings");
    const itemId = await createItem(token, "唐揚げ");

    const patchRes = await app.request(
      `/api/menu/items/${itemId}`,
      withAuth(
        token,
        jsonInit("PATCH", {
          name: "唐揚げ",
          price: 500,
          is_available: true,
          option_group_ids: [groupId1, groupId2],
        }),
      ),
      env,
    );
    expect(patchRes.status).toBe(200);
    const patchBody = (await patchRes.json()) as {
      data: { option_group_ids: string[] };
    };
    expect(new Set(patchBody.data.option_group_ids)).toEqual(
      new Set([groupId1, groupId2]),
    );

    const listRes = await app.request("/api/menu/items", withAuth(token), env);
    const { data: items } = (await listRes.json()) as {
      data: { id: string; option_group_ids: string[] }[];
    };
    const item = items.find((i) => i.id === itemId);
    expect(new Set(item?.option_group_ids)).toEqual(
      new Set([groupId1, groupId2]),
    );
  });

  it("preserves current attachments when option_group_ids is omitted", async () => {
    const { session_token: token } = await seedStore(
      `Preserve Groups ${crypto.randomUUID()}`,
    );
    const groupId = await createGroup(token, "Size");
    const itemId = await createItem(token, "唐揚げ");
    await app.request(
      `/api/menu/items/${itemId}`,
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
      `/api/menu/items/${itemId}`,
      withAuth(
        token,
        jsonInit("PATCH", { name: "唐揚げ改", price: 500, is_available: true }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { option_group_ids: string[] };
    };
    expect(body.data.option_group_ids).toEqual([groupId]);
  });

  it("detaches all groups when option_group_ids is an empty array", async () => {
    const { session_token: token } = await seedStore(
      `Detach Groups ${crypto.randomUUID()}`,
    );
    const groupId = await createGroup(token, "Size");
    const itemId = await createItem(token, "唐揚げ");
    await app.request(
      `/api/menu/items/${itemId}`,
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
      `/api/menu/items/${itemId}`,
      withAuth(
        token,
        jsonInit("PATCH", {
          name: "唐揚げ",
          price: 500,
          is_available: true,
          option_group_ids: [],
        }),
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { option_group_ids: string[] };
    };
    expect(body.data.option_group_ids).toEqual([]);

    // The PATCH response is echoed from the request, not re-read from the
    // DB — confirm the detach actually persisted, not just the response shape.
    const listRes = await app.request("/api/menu/items", withAuth(token), env);
    const { data: items } = (await listRes.json()) as {
      data: { id: string; option_group_ids: string[] }[];
    };
    expect(items.find((i) => i.id === itemId)?.option_group_ids).toEqual([]);
  });

  it("rejects an option_group_ids entry from another store", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Owner Attach ${crypto.randomUUID()}`,
    );
    const { session_token: otherToken } = await seedStore(
      `Other Attach ${crypto.randomUUID()}`,
    );
    const foreignGroupId = await createGroup(otherToken, "Other's Size");
    const itemId = await createItem(ownerToken, "唐揚げ");

    const res = await app.request(
      `/api/menu/items/${itemId}`,
      withAuth(
        ownerToken,
        jsonInit("PATCH", {
          name: "唐揚げ",
          price: 500,
          is_available: true,
          option_group_ids: [foreignGroupId],
        }),
      ),
      env,
    );
    expect(res.status).toBe(400);

    // The attach attempt must not have partially applied.
    const listRes = await app.request(
      "/api/menu/items",
      withAuth(ownerToken),
      env,
    );
    const { data: items } = (await listRes.json()) as {
      data: { id: string; option_group_ids: string[] }[];
    };
    expect(items.find((i) => i.id === itemId)?.option_group_ids).toEqual([]);
  });

  it("removes the item's group attachments when the item is deleted", async () => {
    const { session_token: token } = await seedStore(
      `Delete Item Groups ${crypto.randomUUID()}`,
    );
    const groupId = await createGroup(token, "Size");
    const itemId = await createItem(token, "唐揚げ");
    await app.request(
      `/api/menu/items/${itemId}`,
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

    const deleteRes = await app.request(
      `/api/menu/items/${itemId}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(deleteRes.status).toBe(200);

    // The group itself survives — only the attachment is removed.
    const groupsRes = await app.request(
      "/api/menu/option-groups",
      withAuth(token),
      env,
    );
    const { data: groups } = (await groupsRes.json()) as {
      data: { id: string }[];
    };
    expect(groups.find((g) => g.id === groupId)).toBeDefined();

    // menu_item_option_groups has no API surface once the item is gone and
    // no DB-level ON DELETE CASCADE, so check the join row directly.
    const db = createDb(env.DB);
    const remaining = await db
      .select({ id: schema.menuItemOptionGroups.id })
      .from(schema.menuItemOptionGroups)
      .where(eq(schema.menuItemOptionGroups.menu_item_id, itemId));
    expect(remaining).toHaveLength(0);
  });
});
