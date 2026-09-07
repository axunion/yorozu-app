import {
  CreateShiftPatternInput,
  CreateStaffingRequirementInput,
  errorResponse,
  newId,
  type ShiftPatternResponse,
  type StaffingRequirementResponse,
  UpdateShiftPatternInput,
  UpdateStaffingRequirementInput,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const patternColumns = {
  id: schema.shiftPatterns.id,
  name: schema.shiftPatterns.name,
  start_minutes: schema.shiftPatterns.start_minutes,
  end_minutes: schema.shiftPatterns.end_minutes,
  sort_order: schema.shiftPatterns.sort_order,
  is_active: schema.shiftPatterns.is_active,
};

const requirementColumns = {
  id: schema.staffingRequirements.id,
  weekday: schema.staffingRequirements.weekday,
  position_id: schema.staffingRequirements.position_id,
  start_minutes: schema.staffingRequirements.start_minutes,
  end_minutes: schema.staffingRequirements.end_minutes,
  required_headcount: schema.staffingRequirements.required_headcount,
};

/**
 * True when the position belongs to this store. A requirement carries the
 * position id in its body, so it is verified rather than trusted: an id from
 * another store would otherwise be stored under this one, invisible to every
 * store_id-filtered read.
 */
async function ownsPosition(
  db: ReturnType<typeof createDb>,
  storeId: string,
  positionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.positions.id })
    .from(schema.positions)
    .where(
      and(
        eq(schema.positions.id, positionId),
        eq(schema.positions.store_id, storeId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const shiftTemplatesRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireEntitlement("shift"))
  .use(requireOwner)

  /**
   * GET /api/shift/templates/patterns
   * Named entry templates (early/mid/late). Retired ones are excluded unless
   * ?include_inactive=true.
   * Response: 200 { data: ShiftPatternResponse[] }
   */
  .get("/patterns", async (c) => {
    const { id: storeId } = c.var.store;
    const includeInactive = c.req.query("include_inactive") === "true";
    const db = createDb(c.env.DB);

    const rows = await db
      .select(patternColumns)
      .from(schema.shiftPatterns)
      .where(
        includeInactive
          ? eq(schema.shiftPatterns.store_id, storeId)
          : and(
              eq(schema.shiftPatterns.store_id, storeId),
              eq(schema.shiftPatterns.is_active, true),
            ),
      )
      .orderBy(
        asc(schema.shiftPatterns.sort_order),
        asc(schema.shiftPatterns.start_minutes),
      );

    return c.json({ data: rows satisfies ShiftPatternResponse[] });
  })

  /**
   * POST /api/shift/templates/patterns
   * Response: 201 { data: ShiftPatternResponse }
   */
  .post("/patterns", bodyValidator(CreateShiftPatternInput), async (c) => {
    const { id: storeId } = c.var.store;
    const input = c.req.valid("json");
    const db = createDb(c.env.DB);

    const id = newId();
    await db
      .insert(schema.shiftPatterns)
      .values({ id, ...input, store_id: storeId });

    return c.json(
      {
        data: { id, ...input, is_active: true } satisfies ShiftPatternResponse,
      },
      201,
    );
  })

  /**
   * PATCH /api/shift/templates/patterns/:id
   * Response: 200 { data: ShiftPatternResponse }
   */
  .patch("/patterns/:id", bodyValidator(UpdateShiftPatternInput), async (c) => {
    const { id: storeId } = c.var.store;
    const patternId = c.req.param("id");
    const input = c.req.valid("json");
    const db = createDb(c.env.DB);

    const updated = await db
      .update(schema.shiftPatterns)
      .set(input)
      .where(
        and(
          eq(schema.shiftPatterns.id, patternId),
          eq(schema.shiftPatterns.store_id, storeId),
        ),
      )
      .returning(patternColumns);

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Shift pattern not found", 404);
    }
    return c.json({ data: result satisfies ShiftPatternResponse });
  })

  /**
   * DELETE /api/shift/templates/patterns/:id
   * Retires the pattern (is_active = false); shifts copy its times rather
   * than referencing it, so retiring never rewrites a built schedule.
   * Response: 200 { data: ShiftPatternResponse }
   */
  .delete("/patterns/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const patternId = c.req.param("id");
    const db = createDb(c.env.DB);

    const updated = await db
      .update(schema.shiftPatterns)
      .set({ is_active: false })
      .where(
        and(
          eq(schema.shiftPatterns.id, patternId),
          eq(schema.shiftPatterns.store_id, storeId),
        ),
      )
      .returning(patternColumns);

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Shift pattern not found", 404);
    }
    return c.json({ data: result satisfies ShiftPatternResponse });
  })

  /**
   * GET /api/shift/templates/requirements
   * The store's weekday staffing template.
   * Response: 200 { data: StaffingRequirementResponse[] }
   */
  .get("/requirements", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    const rows = await db
      .select(requirementColumns)
      .from(schema.staffingRequirements)
      .where(eq(schema.staffingRequirements.store_id, storeId))
      .orderBy(
        asc(schema.staffingRequirements.weekday),
        asc(schema.staffingRequirements.start_minutes),
      );

    return c.json({ data: rows satisfies StaffingRequirementResponse[] });
  })

  /**
   * POST /api/shift/templates/requirements
   * 404 when position_id belongs to another store.
   * Response: 201 { data: StaffingRequirementResponse }
   */
  .post(
    "/requirements",
    bodyValidator(CreateStaffingRequirementInput),
    async (c) => {
      const { id: storeId } = c.var.store;
      const input = c.req.valid("json");
      const db = createDb(c.env.DB);

      if (!(await ownsPosition(db, storeId, input.position_id))) {
        return errorResponse("NOT_FOUND", "Position not found", 404);
      }

      const id = newId();
      await db
        .insert(schema.staffingRequirements)
        .values({ id, ...input, store_id: storeId });

      return c.json(
        { data: { id, ...input } satisfies StaffingRequirementResponse },
        201,
      );
    },
  )

  /**
   * PATCH /api/shift/templates/requirements/:id
   * Response: 200 { data: StaffingRequirementResponse }
   */
  .patch(
    "/requirements/:id",
    bodyValidator(UpdateStaffingRequirementInput),
    async (c) => {
      const { id: storeId } = c.var.store;
      const requirementId = c.req.param("id");
      const input = c.req.valid("json");
      const db = createDb(c.env.DB);

      if (!(await ownsPosition(db, storeId, input.position_id))) {
        return errorResponse("NOT_FOUND", "Position not found", 404);
      }

      const updated = await db
        .update(schema.staffingRequirements)
        .set(input)
        .where(
          and(
            eq(schema.staffingRequirements.id, requirementId),
            eq(schema.staffingRequirements.store_id, storeId),
          ),
        )
        .returning(requirementColumns);

      const result = updated[0];
      if (!result) {
        return errorResponse(
          "NOT_FOUND",
          "Staffing requirement not found",
          404,
        );
      }
      return c.json({ data: result satisfies StaffingRequirementResponse });
    },
  )

  /**
   * DELETE /api/shift/templates/requirements/:id
   * A hard delete: nothing references a requirement, and a stale one would
   * keep reporting a shortage that no longer exists.
   * Response: 200 { data: { id } }
   */
  .delete("/requirements/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const requirementId = c.req.param("id");
    const db = createDb(c.env.DB);

    const deleted = await db
      .delete(schema.staffingRequirements)
      .where(
        and(
          eq(schema.staffingRequirements.id, requirementId),
          eq(schema.staffingRequirements.store_id, storeId),
        ),
      )
      .returning({ id: schema.staffingRequirements.id });

    const result = deleted[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Staffing requirement not found", 404);
    }
    return c.json({ data: result });
  });
