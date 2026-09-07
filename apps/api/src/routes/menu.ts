import {
  CreateCategoryInput,
  CreateItemInput,
  errorResponse,
  newId,
  UpdateCategoryInput,
  UpdateItemInput,
} from "@yorozu/core";
import { createDb, type Database, schema } from "@yorozu/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthEnv, requireOwner, requireStore } from "../middleware";
import { bodyValidator } from "../validator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IMAGE_MAX_BYTES = 1024 * 1024; // 1 MB

const IMAGE_CONTENT_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Best-effort delete of an R2 object; failures are logged, never thrown. */
async function deleteImageObject(bucket: R2Bucket, key: string): Promise<void> {
  try {
    await bucket.delete(key);
  } catch {
    console.error(`[menu] Failed to delete R2 object ${key}`);
  }
}

/**
 * Runs `promise` via waitUntil when available so its latency isn't observed
 * by the caller; falls back to awaiting it inline when executionCtx is
 * unavailable. Accessing `c.executionCtx` itself throws (rather than being
 * undefined) in some test environments, so the access is guarded too.
 */
async function background(
  c: { executionCtx?: { waitUntil: (promise: Promise<unknown>) => void } },
  promise: Promise<unknown>,
): Promise<void> {
  try {
    if (c.executionCtx?.waitUntil) {
      c.executionCtx.waitUntil(promise);
      return;
    }
  } catch {
    // executionCtx unavailable — fall through to awaiting inline below.
  }
  await promise;
}

/**
 * Verifies that categoryId belongs to storeId.
 * Returns an error Response if the category is invalid; undefined otherwise.
 * Call when categoryId is a non-null string received from client input.
 */
async function validateCategoryOwnership(
  db: Database,
  categoryId: string,
  storeId: string,
): Promise<Response | undefined> {
  const cat = await db
    .select({ id: schema.menuCategories.id })
    .from(schema.menuCategories)
    .where(
      and(
        eq(schema.menuCategories.id, categoryId),
        eq(schema.menuCategories.store_id, storeId),
      ),
    )
    .limit(1);
  if (cat.length === 0) {
    return errorResponse("VALIDATION_ERROR", "category_id is invalid", 400);
  }
  return undefined;
}

/**
 * Verifies that every id in groupIds is an option group belonging to storeId.
 * Returns an error Response if any id is invalid; undefined otherwise.
 * Empty input is always valid (detaches all groups).
 */
async function validateOptionGroupIds(
  db: Database,
  groupIds: string[],
  storeId: string,
): Promise<Response | undefined> {
  if (groupIds.length === 0) return undefined;
  const uniqueIds = [...new Set(groupIds)];
  const rows = await db
    .select({ id: schema.optionGroups.id })
    .from(schema.optionGroups)
    .where(
      and(
        inArray(schema.optionGroups.id, uniqueIds),
        eq(schema.optionGroups.store_id, storeId),
      ),
    );
  if (rows.length !== uniqueIds.length) {
    return errorResponse(
      "VALIDATION_ERROR",
      "option_group_ids contains an invalid group",
      400,
    );
  }
  return undefined;
}

/** Fetches attached option_group_ids for each item id, grouped by menu_item_id. */
async function fetchOptionGroupIdsByItemId(
  db: Database,
  itemIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (itemIds.length === 0) return map;
  const rows = await db
    .select({
      menu_item_id: schema.menuItemOptionGroups.menu_item_id,
      group_id: schema.menuItemOptionGroups.group_id,
    })
    .from(schema.menuItemOptionGroups)
    .where(inArray(schema.menuItemOptionGroups.menu_item_id, itemIds));
  for (const row of rows) {
    const list = map.get(row.menu_item_id) ?? [];
    list.push(row.group_id);
    map.set(row.menu_item_id, list);
  }
  return map;
}

/** Replaces an item's attached option groups with exactly groupIds. */
async function setItemOptionGroups(
  db: Database,
  itemId: string,
  groupIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(groupIds)];
  await db.batch([
    db
      .delete(schema.menuItemOptionGroups)
      .where(eq(schema.menuItemOptionGroups.menu_item_id, itemId)),
    ...uniqueIds.map((groupId, index) =>
      db.insert(schema.menuItemOptionGroups).values({
        id: newId(),
        menu_item_id: itemId,
        group_id: groupId,
        sort_order: index,
      }),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const menuRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireOwner)

  // ──────────────────── Categories ────────────────────

  /**
   * GET /api/menu/categories
   * Returns all categories for the authenticated store, ordered by sort_order.
   */
  .get("/categories", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(schema.menuCategories)
      .where(eq(schema.menuCategories.store_id, storeId))
      .orderBy(asc(schema.menuCategories.sort_order));
    return c.json({ data: rows });
  })

  /**
   * POST /api/menu/categories
   * Creates a new category for the authenticated store.
   * Response: 201 { data: { id, store_id, name, sort_order } }
   */
  .post("/categories", bodyValidator(CreateCategoryInput), async (c) => {
    const { id: storeId } = c.var.store;
    const { name, sort_order } = c.req.valid("json");
    const id = newId();
    const db = createDb(c.env.DB);
    await db
      .insert(schema.menuCategories)
      .values({ id, store_id: storeId, name, sort_order });
    return c.json({ data: { id, store_id: storeId, name, sort_order } }, 201);
  })

  /**
   * PATCH /api/menu/categories/:id
   * Updates name and sort_order of a category owned by the authenticated store.
   * Returns 404 if not found or owned by a different store.
   */
  .patch("/categories/:id", bodyValidator(UpdateCategoryInput), async (c) => {
    const { id: storeId } = c.var.store;
    const catId = c.req.param("id");
    const { name, sort_order } = c.req.valid("json");
    const db = createDb(c.env.DB);
    const updated = await db
      .update(schema.menuCategories)
      .set({ name, sort_order })
      .where(
        and(
          eq(schema.menuCategories.id, catId),
          eq(schema.menuCategories.store_id, storeId),
        ),
      )
      .returning();
    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Category not found", 404);
    }
    return c.json({ data: result });
  })

  /**
   * DELETE /api/menu/categories/:id
   * Deletes a category owned by the authenticated store.
   * First nullifies category_id on all child items (schema allows nullable).
   * Returns 404 if not found or owned by a different store.
   */
  .delete("/categories/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const catId = c.req.param("id");
    const db = createDb(c.env.DB);

    // Verify ownership before touching child records.
    const existing = await db
      .select({ id: schema.menuCategories.id })
      .from(schema.menuCategories)
      .where(
        and(
          eq(schema.menuCategories.id, catId),
          eq(schema.menuCategories.store_id, storeId),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      return errorResponse("NOT_FOUND", "Category not found", 404);
    }

    // Nullify category_id on child items, then delete the category atomically.
    await db.batch([
      db
        .update(schema.menuItems)
        .set({ category_id: null })
        .where(
          and(
            eq(schema.menuItems.category_id, catId),
            eq(schema.menuItems.store_id, storeId),
          ),
        ),
      db
        .delete(schema.menuCategories)
        .where(
          and(
            eq(schema.menuCategories.id, catId),
            eq(schema.menuCategories.store_id, storeId),
          ),
        ),
    ]);

    return c.json({ data: { id: catId } });
  })

  // ──────────────────── Items ────────────────────

  /**
   * GET /api/menu/items
   * Returns all menu items for the authenticated store, ordered by sort_order.
   */
  .get("/items", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(schema.menuItems)
      .where(eq(schema.menuItems.store_id, storeId))
      .orderBy(asc(schema.menuItems.sort_order));
    const groupIdsByItem = await fetchOptionGroupIdsByItemId(
      db,
      rows.map((row) => row.id),
    );
    return c.json({
      data: rows.map((row) => ({
        ...row,
        option_group_ids: groupIdsByItem.get(row.id) ?? [],
      })),
    });
  })

  /**
   * POST /api/menu/items
   * Creates a new menu item for the authenticated store.
   * If category_id is provided it must belong to the same store.
   * Response: 201 { data: { ... } }
   */
  .post("/items", bodyValidator(CreateItemInput), async (c) => {
    const { id: storeId } = c.var.store;
    const input = c.req.valid("json");
    const db = createDb(c.env.DB);

    if (input.category_id != null) {
      const err = await validateCategoryOwnership(
        db,
        input.category_id,
        storeId,
      );
      if (err) return err;
    }

    const id = newId();
    const { name, price, is_available, category_id, sort_order, description } =
      input;
    await db.insert(schema.menuItems).values({
      id,
      store_id: storeId,
      name,
      price,
      is_available,
      category_id,
      sort_order,
      description,
    });
    return c.json(
      {
        data: {
          id,
          store_id: storeId,
          name,
          price,
          is_available,
          category_id,
          sort_order,
          description,
          image_key: null,
          // New items start with no option groups attached; use the
          // dedicated attach flow on PATCH /items/:id to add some.
          option_group_ids: [],
        },
      },
      201,
    );
  })

  /**
   * PATCH /api/menu/items/:id
   * Updates a menu item owned by the authenticated store.
   * If category_id is provided it must belong to the same store.
   * Omitting category_id preserves the current value; passing null clears it.
   * Returns 404 if not found or owned by a different store.
   */
  .patch("/items/:id", bodyValidator(UpdateItemInput), async (c) => {
    const { id: storeId } = c.var.store;
    const itemId = c.req.param("id");
    const input = c.req.valid("json");
    const db = createDb(c.env.DB);

    // category_id is undefined when omitted → preserve existing DB value.
    // Validate only when explicitly provided (string, not null/undefined).
    if (input.category_id != null) {
      const err = await validateCategoryOwnership(
        db,
        input.category_id,
        storeId,
      );
      if (err) return err;
    }

    // option_group_ids is undefined when omitted → preserve current attachments.
    if (input.option_group_ids !== undefined) {
      const err = await validateOptionGroupIds(
        db,
        input.option_group_ids,
        storeId,
      );
      if (err) return err;
    }

    const { name, price, is_available, category_id, sort_order, description } =
      input;
    // Drizzle skips undefined fields in .set(), so omitting category_id
    // (or description) in the request body leaves the column unchanged in the DB.
    const updated = await db
      .update(schema.menuItems)
      .set({ name, price, is_available, category_id, sort_order, description })
      .where(
        and(
          eq(schema.menuItems.id, itemId),
          eq(schema.menuItems.store_id, storeId),
        ),
      )
      .returning();
    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Menu item not found", 404);
    }

    if (input.option_group_ids !== undefined) {
      await setItemOptionGroups(db, itemId, input.option_group_ids);
    }
    const optionGroupIds =
      input.option_group_ids !== undefined
        ? [...new Set(input.option_group_ids)]
        : ((await fetchOptionGroupIdsByItemId(db, [itemId])).get(itemId) ?? []);

    return c.json({ data: { ...result, option_group_ids: optionGroupIds } });
  })

  /**
   * DELETE /api/menu/items/:id
   * Deletes a menu item owned by the authenticated store.
   * Returns 409 if the item is referenced by an existing order_item (FK constraint).
   * Returns 404 if not found or owned by a different store.
   */
  .delete("/items/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const itemId = c.req.param("id");
    const db = createDb(c.env.DB);

    // Verify ownership first.
    const existing = await db
      .select({
        id: schema.menuItems.id,
        image_key: schema.menuItems.image_key,
      })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, itemId),
          eq(schema.menuItems.store_id, storeId),
        ),
      )
      .limit(1);
    const item = existing[0];
    if (!item) {
      return errorResponse("NOT_FOUND", "Menu item not found", 404);
    }

    // Check whether any order_items from this store reference this item.
    // Filter by store_id to prevent cross-tenant order_items (e.g. bad seed data)
    // from blocking a legitimate deletion.
    const refs = await db
      .select({ id: schema.orderItems.id })
      .from(schema.orderItems)
      .where(
        and(
          eq(schema.orderItems.menu_item_id, itemId),
          eq(schema.orderItems.store_id, storeId),
        ),
      )
      .limit(1);
    if (refs.length > 0) {
      return errorResponse(
        "CONFLICT",
        "この商品は過去の注文で使用されているため削除できません。提供停止にしてください。",
        409,
      );
    }

    await db.batch([
      db
        .delete(schema.menuItemOptionGroups)
        .where(eq(schema.menuItemOptionGroups.menu_item_id, itemId)),
      db
        .delete(schema.menuItems)
        .where(
          and(
            eq(schema.menuItems.id, itemId),
            eq(schema.menuItems.store_id, storeId),
          ),
        ),
    ]);
    if (item.image_key) {
      await background(c, deleteImageObject(c.env.IMAGES, item.image_key));
    }
    return c.json({ data: { id: itemId } });
  })

  // ──────────────────── Item images ────────────────────

  /**
   * PUT /api/menu/items/:id/image
   * Uploads/replaces the photo for a menu item owned by the authenticated store.
   * Body: raw binary. Content-Type must be image/jpeg, image/png, or image/webp.
   * Size cap 1 MB (413 otherwise). Deletes the previous image object, if any,
   * best-effort. Returns the updated item.
   */
  .put("/items/:id/image", async (c) => {
    const { id: storeId } = c.var.store;
    const itemId = c.req.param("id");
    const db = createDb(c.env.DB);

    const existing = await db
      .select({ image_key: schema.menuItems.image_key })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, itemId),
          eq(schema.menuItems.store_id, storeId),
        ),
      )
      .limit(1);
    const item = existing[0];
    if (!item) {
      return errorResponse("NOT_FOUND", "Menu item not found", 404);
    }

    const contentType = c.req.header("Content-Type") ?? "";
    const ext = IMAGE_CONTENT_TYPES[contentType];
    if (!ext) {
      return errorResponse(
        "VALIDATION_ERROR",
        "Content-Type must be image/jpeg, image/png, or image/webp",
        400,
      );
    }

    // Fast-path rejection from the declared length, before buffering the body.
    // Content-Length can be absent or wrong, so byteLength below is authoritative.
    const declaredLength = Number(c.req.header("Content-Length"));
    if (declaredLength > IMAGE_MAX_BYTES) {
      return errorResponse(
        "PAYLOAD_TOO_LARGE",
        "Image exceeds the 1 MB size limit",
        413,
      );
    }

    const body = await c.req.arrayBuffer();
    if (body.byteLength > IMAGE_MAX_BYTES) {
      return errorResponse(
        "PAYLOAD_TOO_LARGE",
        "Image exceeds the 1 MB size limit",
        413,
      );
    }

    const key = `menu/${storeId}/${itemId}/${newId()}.${ext}`;
    await c.env.IMAGES.put(key, body, {
      httpMetadata: { contentType },
    });

    const updated = await db
      .update(schema.menuItems)
      .set({ image_key: key })
      .where(
        and(
          eq(schema.menuItems.id, itemId),
          eq(schema.menuItems.store_id, storeId),
        ),
      )
      .returning();
    const result = updated[0];
    if (!result) {
      // Item was deleted concurrently between the ownership check above and
      // here — clean up the object we just wrote so it doesn't leak forever.
      await background(c, deleteImageObject(c.env.IMAGES, key));
      return errorResponse("NOT_FOUND", "Menu item not found", 404);
    }

    if (item.image_key) {
      await background(c, deleteImageObject(c.env.IMAGES, item.image_key));
    }
    return c.json({ data: result });
  })

  /**
   * DELETE /api/menu/items/:id/image
   * Clears the photo for a menu item owned by the authenticated store and
   * deletes the R2 object, best-effort. No-op (200) if the item has no image.
   * Returns 404 if not found or owned by a different store.
   */
  .delete("/items/:id/image", async (c) => {
    const { id: storeId } = c.var.store;
    const itemId = c.req.param("id");
    const db = createDb(c.env.DB);

    const existing = await db
      .select({ image_key: schema.menuItems.image_key })
      .from(schema.menuItems)
      .where(
        and(
          eq(schema.menuItems.id, itemId),
          eq(schema.menuItems.store_id, storeId),
        ),
      )
      .limit(1);
    const item = existing[0];
    if (!item) {
      return errorResponse("NOT_FOUND", "Menu item not found", 404);
    }

    const updated = await db
      .update(schema.menuItems)
      .set({ image_key: null })
      .where(
        and(
          eq(schema.menuItems.id, itemId),
          eq(schema.menuItems.store_id, storeId),
        ),
      )
      .returning();
    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Menu item not found", 404);
    }

    if (item.image_key) {
      await background(c, deleteImageObject(c.env.IMAGES, item.image_key));
    }
    return c.json({ data: result });
  });
