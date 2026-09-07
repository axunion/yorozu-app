import {
  CreateOptionGroupInput,
  CreateOptionInput,
  errorResponse,
  newId,
  UpdateOptionGroupInput,
  UpdateOptionInput,
} from "@yorozu/core";
import { createDb, type Database, schema } from "@yorozu/db";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthEnv, requireOwner, requireStore } from "../middleware";
import { bodyValidator } from "../validator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function optionGroupExists(
  db: Database,
  groupId: string,
  storeId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.optionGroups.id })
    .from(schema.optionGroups)
    .where(
      and(
        eq(schema.optionGroups.id, groupId),
        eq(schema.optionGroups.store_id, storeId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const menuOptionsRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireOwner)

  // ──────────────────── Option groups ────────────────────

  /**
   * GET /api/menu/option-groups
   * Returns all option groups for the authenticated store, ordered by sort_order.
   */
  .get("/", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);
    const rows = await db
      .select()
      .from(schema.optionGroups)
      .where(eq(schema.optionGroups.store_id, storeId))
      .orderBy(asc(schema.optionGroups.sort_order));
    return c.json({ data: rows });
  })

  /**
   * POST /api/menu/option-groups
   * Creates a new option group for the authenticated store.
   * Response: 201 { data: { id, store_id, name, min_select, max_select, sort_order } }
   */
  .post("/", bodyValidator(CreateOptionGroupInput), async (c) => {
    const { id: storeId } = c.var.store;
    const { name, min_select, max_select, sort_order } = c.req.valid("json");
    const id = newId();
    const db = createDb(c.env.DB);
    await db.insert(schema.optionGroups).values({
      id,
      store_id: storeId,
      name,
      min_select,
      max_select,
      sort_order,
    });
    return c.json(
      {
        data: {
          id,
          store_id: storeId,
          name,
          min_select,
          max_select,
          sort_order,
        },
      },
      201,
    );
  })

  /**
   * PATCH /api/menu/option-groups/:id
   * Full-replace update of an option group owned by the authenticated store.
   * Returns 404 if not found or owned by a different store.
   */
  .patch("/:id", bodyValidator(UpdateOptionGroupInput), async (c) => {
    const { id: storeId } = c.var.store;
    const groupId = c.req.param("id");
    const { name, min_select, max_select, sort_order } = c.req.valid("json");
    const db = createDb(c.env.DB);
    const updated = await db
      .update(schema.optionGroups)
      .set({ name, min_select, max_select, sort_order })
      .where(
        and(
          eq(schema.optionGroups.id, groupId),
          eq(schema.optionGroups.store_id, storeId),
        ),
      )
      .returning();
    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Option group not found", 404);
    }
    return c.json({ data: result });
  })

  /**
   * DELETE /api/menu/option-groups/:id
   * Deletes an option group owned by the authenticated store, along with its
   * options and its attachments to menu items. Historical orders are
   * unaffected — order_item_options stores name/price snapshots with no FK
   * back to options/option_groups.
   * Returns 404 if not found or owned by a different store.
   */
  .delete("/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const groupId = c.req.param("id");
    const db = createDb(c.env.DB);

    if (!(await optionGroupExists(db, groupId, storeId))) {
      return errorResponse("NOT_FOUND", "Option group not found", 404);
    }

    await db.batch([
      db
        .delete(schema.options)
        .where(
          and(
            eq(schema.options.group_id, groupId),
            eq(schema.options.store_id, storeId),
          ),
        ),
      db
        .delete(schema.menuItemOptionGroups)
        .where(eq(schema.menuItemOptionGroups.group_id, groupId)),
      db
        .delete(schema.optionGroups)
        .where(
          and(
            eq(schema.optionGroups.id, groupId),
            eq(schema.optionGroups.store_id, storeId),
          ),
        ),
    ]);

    return c.json({ data: { id: groupId } });
  })

  // ──────────────────── Options (nested under a group) ────────────────────

  /**
   * GET /api/menu/option-groups/:groupId/options
   * Returns all options in a group owned by the authenticated store, ordered
   * by sort_order.
   */
  .get("/:groupId/options", async (c) => {
    const { id: storeId } = c.var.store;
    const groupId = c.req.param("groupId");
    const db = createDb(c.env.DB);

    if (!(await optionGroupExists(db, groupId, storeId))) {
      return errorResponse("NOT_FOUND", "Option group not found", 404);
    }

    const rows = await db
      .select()
      .from(schema.options)
      .where(eq(schema.options.group_id, groupId))
      .orderBy(asc(schema.options.sort_order));
    return c.json({ data: rows });
  })

  /**
   * POST /api/menu/option-groups/:groupId/options
   * Creates a new option within a group owned by the authenticated store.
   * Response: 201 { data: { id, store_id, group_id, name, price_delta, sort_order } }
   */
  .post("/:groupId/options", bodyValidator(CreateOptionInput), async (c) => {
    const { id: storeId } = c.var.store;
    const groupId = c.req.param("groupId");
    const db = createDb(c.env.DB);

    if (!(await optionGroupExists(db, groupId, storeId))) {
      return errorResponse("NOT_FOUND", "Option group not found", 404);
    }

    const { name, price_delta, sort_order } = c.req.valid("json");
    const id = newId();
    await db.insert(schema.options).values({
      id,
      store_id: storeId,
      group_id: groupId,
      name,
      price_delta,
      sort_order,
    });
    return c.json(
      {
        data: {
          id,
          store_id: storeId,
          group_id: groupId,
          name,
          price_delta,
          sort_order,
        },
      },
      201,
    );
  })

  /**
   * PATCH /api/menu/option-groups/:groupId/options/:optionId
   * Updates an option owned by the authenticated store within the given group.
   * Returns 404 if not found, wrong group, or owned by a different store.
   */
  .patch(
    "/:groupId/options/:optionId",
    bodyValidator(UpdateOptionInput),
    async (c) => {
      const { id: storeId } = c.var.store;
      const groupId = c.req.param("groupId");
      const optionId = c.req.param("optionId");
      const { name, price_delta, sort_order } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const updated = await db
        .update(schema.options)
        .set({ name, price_delta, sort_order })
        .where(
          and(
            eq(schema.options.id, optionId),
            eq(schema.options.group_id, groupId),
            eq(schema.options.store_id, storeId),
          ),
        )
        .returning();
      const result = updated[0];
      if (!result) {
        return errorResponse("NOT_FOUND", "Option not found", 404);
      }
      return c.json({ data: result });
    },
  )

  /**
   * DELETE /api/menu/option-groups/:groupId/options/:optionId
   * Deletes an option owned by the authenticated store within the given group.
   * Returns 404 if not found, wrong group, or owned by a different store.
   */
  .delete("/:groupId/options/:optionId", async (c) => {
    const { id: storeId } = c.var.store;
    const groupId = c.req.param("groupId");
    const optionId = c.req.param("optionId");
    const db = createDb(c.env.DB);

    const existing = await db
      .select({ id: schema.options.id })
      .from(schema.options)
      .where(
        and(
          eq(schema.options.id, optionId),
          eq(schema.options.group_id, groupId),
          eq(schema.options.store_id, storeId),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      return errorResponse("NOT_FOUND", "Option not found", 404);
    }

    await db
      .delete(schema.options)
      .where(
        and(
          eq(schema.options.id, optionId),
          eq(schema.options.store_id, storeId),
        ),
      );
    return c.json({ data: { id: optionId } });
  });
