import {
  CreateSchedulePeriodInput,
  errorResponse,
  newId,
  now,
  type SchedulePeriodResponse,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  type AuthEnv,
  requireEntitlement,
  requireOwner,
  requireStore,
} from "../middleware";
import { bodyValidator } from "../validator";

const columns = {
  id: schema.schedulePeriods.id,
  start_date: schema.schedulePeriods.start_date,
  end_date: schema.schedulePeriods.end_date,
  status: schema.schedulePeriods.status,
  submission_deadline: schema.schedulePeriods.submission_deadline,
  published_at: schema.schedulePeriods.published_at,
};

/**
 * Moves a period to `to`, but only from `from`. Returns null when the period
 * is another store's, does not exist, or is in some other state — the caller
 * turns those into 404 and 409 respectively, distinguished by a second read.
 */
async function transition(
  db: ReturnType<typeof createDb>,
  storeId: string,
  periodId: string,
  from: "collecting" | "building",
  to: "building" | "published",
  extra: { published_at?: number } = {},
) {
  const updated = await db
    .update(schema.schedulePeriods)
    .set({ status: to, ...extra })
    .where(
      and(
        eq(schema.schedulePeriods.id, periodId),
        eq(schema.schedulePeriods.store_id, storeId),
        eq(schema.schedulePeriods.status, from),
      ),
    )
    .returning(columns);
  return updated[0] ?? null;
}

async function findPeriod(
  db: ReturnType<typeof createDb>,
  storeId: string,
  periodId: string,
) {
  const rows = await db
    .select(columns)
    .from(schema.schedulePeriods)
    .where(
      and(
        eq(schema.schedulePeriods.id, periodId),
        eq(schema.schedulePeriods.store_id, storeId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export const shiftPeriodsRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireEntitlement("shift"))

  /**
   * GET /api/shift/periods
   * Newest first. Open to staff: they need it to find the period they are
   * submitting availability for.
   * Response: 200 { data: SchedulePeriodResponse[] }
   */
  .get("/", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    const rows = await db
      .select(columns)
      .from(schema.schedulePeriods)
      .where(eq(schema.schedulePeriods.store_id, storeId))
      .orderBy(desc(schema.schedulePeriods.start_date));

    return c.json({ data: rows satisfies SchedulePeriodResponse[] });
  })

  /**
   * GET /api/shift/periods/:id
   * Response: 200 { data: SchedulePeriodResponse }
   */
  .get("/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    const period = await findPeriod(db, storeId, c.req.param("id"));
    if (!period) {
      return errorResponse("NOT_FOUND", "Schedule period not found", 404);
    }
    return c.json({ data: period satisfies SchedulePeriodResponse });
  })

  /**
   * POST /api/shift/periods
   * The range must be a whole half-month (enforced by the schema); a second
   * period with the same start date is a 409.
   * Response: 201 { data: SchedulePeriodResponse }
   */
  .post(
    "/",
    requireOwner,
    bodyValidator(CreateSchedulePeriodInput),
    async (c) => {
      const { id: storeId } = c.var.store;
      const input = c.req.valid("json");
      const db = createDb(c.env.DB);

      const existing = await db
        .select({ id: schema.schedulePeriods.id })
        .from(schema.schedulePeriods)
        .where(
          and(
            eq(schema.schedulePeriods.store_id, storeId),
            eq(schema.schedulePeriods.start_date, input.start_date),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        return errorResponse(
          "CONFLICT",
          "この期間はすでに作成されています。",
          409,
        );
      }

      const id = newId();
      await db
        .insert(schema.schedulePeriods)
        .values({ id, ...input, store_id: storeId });

      return c.json(
        {
          data: {
            id,
            ...input,
            status: "collecting",
            published_at: null,
          } satisfies SchedulePeriodResponse,
        },
        201,
      );
    },
  )

  /**
   * POST /api/shift/periods/:id/close-submissions
   * collecting -> building. 409 from any other state.
   * Response: 200 { data: SchedulePeriodResponse }
   */
  .post("/:id/close-submissions", requireOwner, async (c) => {
    const { id: storeId } = c.var.store;
    const periodId = c.req.param("id");
    const db = createDb(c.env.DB);

    const moved = await transition(
      db,
      storeId,
      periodId,
      "collecting",
      "building",
    );
    if (moved) return c.json({ data: moved satisfies SchedulePeriodResponse });

    // The update matched nothing: either the period isn't ours, or it has
    // already moved on.
    const period = await findPeriod(db, storeId, periodId);
    if (!period) {
      return errorResponse("NOT_FOUND", "Schedule period not found", 404);
    }
    return errorResponse(
      "CONFLICT",
      "この期間の希望受付はすでに締め切られています。",
      409,
    );
  })

  /**
   * POST /api/shift/periods/:id/publish
   * building -> published, stamping published_at. Published is terminal, so
   * publishing again is a 409; later edits to its shifts take effect
   * immediately without a republish.
   * Response: 200 { data: SchedulePeriodResponse }
   */
  .post("/:id/publish", requireOwner, async (c) => {
    const { id: storeId } = c.var.store;
    const periodId = c.req.param("id");
    const db = createDb(c.env.DB);

    const moved = await transition(
      db,
      storeId,
      periodId,
      "building",
      "published",
      { published_at: now() },
    );
    if (moved) return c.json({ data: moved satisfies SchedulePeriodResponse });

    const period = await findPeriod(db, storeId, periodId);
    if (!period) {
      return errorResponse("NOT_FOUND", "Schedule period not found", 404);
    }
    return errorResponse(
      "CONFLICT",
      period.status === "published"
        ? "この期間はすでに公開されています。"
        : "公開する前に希望受付を締め切ってください。",
      409,
    );
  });
