import {
  type AvailabilitySubmissionResponse,
  CreateShiftInput,
  errorResponse,
  jstDayRange,
  newId,
  overlaps,
  periodDates,
  type SchedulePeriodResponse,
  type ScheduleResponse,
  type ShiftResponse,
  type StaffingRequirementResponse,
  toJstDateString,
  UpdateShiftInput,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import {
  type AuthEnv,
  requireEntitlement,
  requireOwner,
  requireStore,
} from "../middleware";
import { entriesBySubmission } from "../shift-entries";
import { bodyValidator } from "../validator";

const shiftColumns = {
  id: schema.shifts.id,
  period_id: schema.shifts.period_id,
  member_id: schema.shifts.member_id,
  position_id: schema.shifts.position_id,
  work_date: schema.shifts.work_date,
  start_minutes: schema.shifts.start_minutes,
  end_minutes: schema.shifts.end_minutes,
  break_minutes: schema.shifts.break_minutes,
  note: schema.shifts.note,
};

const periodColumns = {
  id: schema.schedulePeriods.id,
  start_date: schema.schedulePeriods.start_date,
  end_date: schema.schedulePeriods.end_date,
  status: schema.schedulePeriods.status,
  submission_deadline: schema.schedulePeriods.submission_deadline,
  published_at: schema.schedulePeriods.published_at,
};

async function findPeriod(
  db: ReturnType<typeof createDb>,
  storeId: string,
  periodId: string,
): Promise<SchedulePeriodResponse | null> {
  const rows = await db
    .select(periodColumns)
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

/** Every id in a shift body must belong to the caller's store. */
async function resolveShiftRefs(
  db: ReturnType<typeof createDb>,
  storeId: string,
  input: { period_id: string; member_id: string; position_id: string | null },
): Promise<{ period: SchedulePeriodResponse } | null> {
  const period = await findPeriod(db, storeId, input.period_id);
  if (!period) return null;

  const [member, position] = await Promise.all([
    db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(
        and(
          eq(schema.members.id, input.member_id),
          eq(schema.members.store_id, storeId),
        ),
      )
      .limit(1),
    input.position_id
      ? db
          .select({ id: schema.positions.id })
          .from(schema.positions)
          .where(
            and(
              eq(schema.positions.id, input.position_id),
              eq(schema.positions.store_id, storeId),
            ),
          )
          .limit(1)
      : Promise.resolve(null),
  ]);
  if (member.length === 0) return null;
  if (position !== null && position.length === 0) return null;

  return { period };
}

/** The day before and the day after a business date, as "YYYY-MM-DD". */
function neighbouringDates(work_date: string): [string, string] {
  const day = 24 * 60 * 60 * 1000;
  const midnight = jstDayRange(work_date).from;
  return [
    toJstDateString(midnight - day + 1),
    toJstDateString(midnight + day + 1),
  ];
}

/**
 * True when the member already has a shift sharing any minute with this one.
 * Compared on the absolute range so an overnight shift is checked against the
 * next morning correctly. SQLite cannot express range non-overlap in an index,
 * so this is a check-then-act guard — documented as such in the domain model.
 */
async function hasOverlap(
  db: ReturnType<typeof createDb>,
  storeId: string,
  candidate: {
    member_id: string;
    work_date: string;
    start_minutes: number;
    end_minutes: number;
  },
  excludeShiftId?: string,
): Promise<boolean> {
  // Only three dates can possibly overlap: a shift starting on D can run into
  // D+1, and one starting on D-1 can reach into D. Bounding the read this way
  // lets idx_shifts_member_date do the work instead of scanning the member's
  // whole history on every write, without changing the overnight semantics.
  const [before = "", after = ""] = neighbouringDates(candidate.work_date);
  const existing = await db
    .select({
      member_id: schema.shifts.member_id,
      work_date: schema.shifts.work_date,
      start_minutes: schema.shifts.start_minutes,
      end_minutes: schema.shifts.end_minutes,
    })
    .from(schema.shifts)
    .where(
      and(
        eq(schema.shifts.store_id, storeId),
        eq(schema.shifts.member_id, candidate.member_id),
        inArray(schema.shifts.work_date, [before, candidate.work_date, after]),
        excludeShiftId ? ne(schema.shifts.id, excludeShiftId) : undefined,
      ),
    );

  // overlaps() compares on the absolute range, so an overnight shift and the
  // next morning are judged correctly rather than per calendar date.
  return existing.some((other) =>
    overlaps(
      { ...candidate, break_minutes: 0 },
      { ...other, break_minutes: 0 },
    ),
  );
}

/**
 * The checks a shift write must pass, shared by POST and PATCH: the period,
 * member and position must belong to the caller's store; the date must fall
 * inside the period; and the member must not already be working that time.
 * Returns an error Response, or null when the write may proceed.
 */
async function validateShiftPlacement(
  db: ReturnType<typeof createDb>,
  storeId: string,
  input: {
    period_id: string;
    member_id: string;
    position_id: string | null;
    work_date: string;
    start_minutes: number;
    end_minutes: number;
  },
  excludeShiftId?: string,
): Promise<Response | null> {
  const refs = await resolveShiftRefs(db, storeId, input);
  if (!refs) {
    return errorResponse("NOT_FOUND", "Shift target not found", 404);
  }

  const dates = periodDates(refs.period.start_date, refs.period.end_date);
  if (!dates.includes(input.work_date)) {
    return errorResponse(
      "VALIDATION_ERROR",
      `${input.work_date} はこの期間に含まれていません。`,
      400,
    );
  }

  if (await hasOverlap(db, storeId, input, excludeShiftId)) {
    return errorResponse(
      "CONFLICT",
      "このスタッフはこの時間帯にすでにシフトが入っています。",
      409,
    );
  }

  return null;
}

export const shiftScheduleRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireEntitlement("shift"))

  /**
   * GET /api/shift/schedule/:periodId
   *
   * The owner gets the whole schedule plus the availability and requirements
   * the grid measures against. A staff member gets only their own shifts, and
   * only once the period is published — before that they get an empty list
   * with published: false rather than an error, since the period's existence
   * is no secret from its own store's staff.
   *
   * Response: 200 { data: ScheduleResponse }
   */
  .get("/:periodId", async (c) => {
    const { id: storeId, member_id: memberId, role } = c.var.store;
    const periodId = c.req.param("periodId");
    const db = createDb(c.env.DB);

    const period = await findPeriod(db, storeId, periodId);
    if (!period) {
      return errorResponse("NOT_FOUND", "Schedule period not found", 404);
    }

    const published = period.status === "published";
    if (role !== "owner" && !published) {
      return c.json({
        data: { period, published, shifts: [] } satisfies ScheduleResponse,
      });
    }

    // Started before the role branch so the owner path (below) can await it
    // alongside the submissions/requirements queries instead of after them.
    const shiftsQuery = db
      .select(shiftColumns)
      .from(schema.shifts)
      .where(
        role === "owner"
          ? and(
              eq(schema.shifts.store_id, storeId),
              eq(schema.shifts.period_id, periodId),
            )
          : and(
              eq(schema.shifts.store_id, storeId),
              eq(schema.shifts.period_id, periodId),
              eq(schema.shifts.member_id, memberId),
            ),
      )
      .orderBy(asc(schema.shifts.work_date), asc(schema.shifts.start_minutes));

    if (role !== "owner") {
      return c.json({
        data: {
          period,
          published,
          shifts: await shiftsQuery,
        } satisfies ScheduleResponse,
      });
    }

    const [shifts, submissionRows, requirements] = await Promise.all([
      shiftsQuery,
      db
        .select({
          id: schema.availabilitySubmissions.id,
          member_id: schema.availabilitySubmissions.member_id,
          status: schema.availabilitySubmissions.status,
          submitted_at: schema.availabilitySubmissions.submitted_at,
          note: schema.availabilitySubmissions.note,
        })
        .from(schema.availabilitySubmissions)
        .where(
          and(
            eq(schema.availabilitySubmissions.store_id, storeId),
            eq(schema.availabilitySubmissions.period_id, periodId),
          ),
        ),
      db
        .select({
          id: schema.staffingRequirements.id,
          weekday: schema.staffingRequirements.weekday,
          position_id: schema.staffingRequirements.position_id,
          start_minutes: schema.staffingRequirements.start_minutes,
          end_minutes: schema.staffingRequirements.end_minutes,
          required_headcount: schema.staffingRequirements.required_headcount,
        })
        .from(schema.staffingRequirements)
        .where(eq(schema.staffingRequirements.store_id, storeId)),
    ]);

    const entriesBySub = await entriesBySubmission(
      db,
      storeId,
      submissionRows.map((r) => r.id),
    );
    const submissions: AvailabilitySubmissionResponse[] = submissionRows.map(
      (row) => ({
        ...row,
        entries: entriesBySub.get(row.id) ?? [],
      }),
    );

    return c.json({
      data: {
        period,
        published,
        shifts,
        submissions,
        requirements: requirements satisfies StaffingRequirementResponse[],
      } satisfies ScheduleResponse,
    });
  });

export const shiftsRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireEntitlement("shift"))
  .use(requireOwner)

  /**
   * POST /api/shift/shifts
   * 404 when the period, member or position is another store's; 400 when the
   * date falls outside the period; 409 when the member is already working.
   * Response: 201 { data: ShiftResponse }
   */
  .post("/", bodyValidator(CreateShiftInput), async (c) => {
    const { id: storeId } = c.var.store;
    const input = c.req.valid("json");
    const db = createDb(c.env.DB);

    const placementError = await validateShiftPlacement(db, storeId, input);
    if (placementError) return placementError;

    const id = newId();
    await db.insert(schema.shifts).values({ id, ...input, store_id: storeId });

    return c.json({ data: { id, ...input } satisfies ShiftResponse }, 201);
  })

  /**
   * PATCH /api/shift/shifts/:id
   * Response: 200 { data: ShiftResponse }
   */
  .patch("/:id", bodyValidator(UpdateShiftInput), async (c) => {
    const { id: storeId } = c.var.store;
    const shiftId = c.req.param("id");
    const input = c.req.valid("json");
    const db = createDb(c.env.DB);

    // Both queries are independent of each other, but if the target doesn't
    // exist its "Shift not found" must win over a placement error — an
    // unknown or foreign id whose body happens to collide with the caller's
    // own schedule should not answer 409, which says nothing true about the
    // shift they asked to change.
    const [target, placementError] = await Promise.all([
      db
        .select({ id: schema.shifts.id })
        .from(schema.shifts)
        .where(
          and(
            eq(schema.shifts.id, shiftId),
            eq(schema.shifts.store_id, storeId),
          ),
        )
        .limit(1),
      validateShiftPlacement(db, storeId, input, shiftId),
    ]);
    if (target.length === 0) {
      return errorResponse("NOT_FOUND", "Shift not found", 404);
    }
    if (placementError) return placementError;

    const updated = await db
      .update(schema.shifts)
      .set(input)
      .where(
        and(eq(schema.shifts.id, shiftId), eq(schema.shifts.store_id, storeId)),
      )
      .returning(shiftColumns);

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Shift not found", 404);
    }
    return c.json({ data: result satisfies ShiftResponse });
  })

  /**
   * DELETE /api/shift/shifts/:id
   * A hard delete: a removed shift has no history worth keeping in v1, and a
   * retired row would still count towards coverage.
   * Response: 200 { data: { id } }
   */
  .delete("/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    const deleted = await db
      .delete(schema.shifts)
      .where(
        and(
          eq(schema.shifts.id, c.req.param("id")),
          eq(schema.shifts.store_id, storeId),
        ),
      )
      .returning({ id: schema.shifts.id });

    const result = deleted[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Shift not found", 404);
    }
    return c.json({ data: result });
  });
