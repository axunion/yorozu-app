import {
  CreatePositionInput,
  errorResponse,
  newId,
  type PositionResponse,
  UpdatePositionInput,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  type AuthEnv,
  requireEntitlement,
  requireOwner,
  requireStore,
} from "../middleware";
import { bodyValidator } from "../validator";

const columns = {
  id: schema.positions.id,
  name: schema.positions.name,
  sort_order: schema.positions.sort_order,
  is_active: schema.positions.is_active,
};

export const shiftPositionsRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireEntitlement("shift"))
  .use(requireOwner)

  /**
   * GET /api/shift/positions
   * Lists the store's positions in sort order. Retired positions are excluded
   * unless ?include_inactive=true — they stay on file for the shifts that
   * still reference them.
   * Response: 200 { data: PositionResponse[] }
   */
  .get("/", async (c) => {
    const { id: storeId } = c.var.store;
    const includeInactive = c.req.query("include_inactive") === "true";
    const db = createDb(c.env.DB);

    const rows = await db
      .select(columns)
      .from(schema.positions)
      .where(
        includeInactive
          ? eq(schema.positions.store_id, storeId)
          : and(
              eq(schema.positions.store_id, storeId),
              eq(schema.positions.is_active, true),
            ),
      )
      .orderBy(asc(schema.positions.sort_order), asc(schema.positions.name));

    return c.json({ data: rows satisfies PositionResponse[] });
  })

  /**
   * POST /api/shift/positions
   * Response: 201 { data: PositionResponse }
   */
  .post("/", bodyValidator(CreatePositionInput), async (c) => {
    const { id: storeId } = c.var.store;
    const { name, sort_order } = c.req.valid("json");
    const db = createDb(c.env.DB);

    const id = newId();
    await db
      .insert(schema.positions)
      .values({ id, store_id: storeId, name, sort_order });

    return c.json(
      {
        data: {
          id,
          name,
          sort_order,
          is_active: true,
        } satisfies PositionResponse,
      },
      201,
    );
  })

  /**
   * PATCH /api/shift/positions/:id
   * Response: 200 { data: PositionResponse }
   */
  .patch("/:id", bodyValidator(UpdatePositionInput), async (c) => {
    const { id: storeId } = c.var.store;
    const positionId = c.req.param("id");
    const { name, sort_order, is_active } = c.req.valid("json");
    const db = createDb(c.env.DB);

    const updated = await db
      .update(schema.positions)
      .set({ name, sort_order, is_active })
      .where(
        and(
          eq(schema.positions.id, positionId),
          eq(schema.positions.store_id, storeId),
        ),
      )
      .returning(columns);

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Position not found", 404);
    }
    return c.json({ data: result satisfies PositionResponse });
  })

  /**
   * DELETE /api/shift/positions/:id
   * Retires the position (is_active = false) rather than deleting it: shifts
   * and staffing requirements reference it. Idempotent.
   * Response: 200 { data: PositionResponse }
   */
  .delete("/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const positionId = c.req.param("id");
    const db = createDb(c.env.DB);

    const updated = await db
      .update(schema.positions)
      .set({ is_active: false })
      .where(
        and(
          eq(schema.positions.id, positionId),
          eq(schema.positions.store_id, storeId),
        ),
      )
      .returning(columns);

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Position not found", 404);
    }
    return c.json({ data: result satisfies PositionResponse });
  });
