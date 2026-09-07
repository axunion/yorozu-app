import {
  type AvailabilitySubmissionResponse,
  errorResponse,
  newId,
  now,
  periodDates,
  SaveAvailabilityInput,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  type AuthEnv,
  requireEntitlement,
  requireOwner,
  requireStore,
} from "../middleware";
import { entriesBySubmission } from "../shift-entries";
import { bodyValidator } from "../validator";

async function findPeriod(
  db: ReturnType<typeof createDb>,
  storeId: string,
  periodId: string,
) {
  const rows = await db
    .select({
      id: schema.schedulePeriods.id,
      start_date: schema.schedulePeriods.start_date,
      end_date: schema.schedulePeriods.end_date,
      status: schema.schedulePeriods.status,
    })
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

/**
 * The contradiction a single-entry schema cannot see: a day off and an offered
 * band on the same date, or two bands that overlap. The schedule builder would
 * otherwise read both and have no way to choose.
 *
 * Returns the offending date, or null when the set is coherent.
 */
function contradictoryDate(
  entries: {
    work_date: string;
    kind: string;
    start_minutes: number | null;
    end_minutes: number | null;
  }[],
): string | null {
  const byDate = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = byDate.get(entry.work_date);
    if (list) list.push(entry);
    else byDate.set(entry.work_date, [entry]);
  }

  for (const [work_date, dayEntries] of byDate) {
    const offDays = dayEntries.filter((e) => e.kind === "day_off");
    if (offDays.length > 0 && dayEntries.length > offDays.length) {
      return work_date;
    }
    if (offDays.length > 1) return work_date;

    const bands = dayEntries
      .filter((e) => e.kind === "available")
      .map((e) => [e.start_minutes ?? 0, e.end_minutes ?? 0] as const)
      .sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < bands.length; i++) {
      const previous = bands[i - 1];
      const current = bands[i];
      if (previous && current && current[0] < previous[1]) return work_date;
    }
  }

  return null;
}

/**
 * The caller's own submission as stored. A member who has saved nothing gets
 * an empty draft rather than a 404, so the form always has something to bind.
 */
async function readOwnSubmission(
  db: ReturnType<typeof createDb>,
  storeId: string,
  periodId: string,
  memberId: string,
): Promise<AvailabilitySubmissionResponse> {
  const rows = await db
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
        eq(schema.availabilitySubmissions.member_id, memberId),
      ),
    )
    .limit(1);

  const submission = rows[0];
  if (!submission) {
    return {
      id: "",
      member_id: memberId,
      status: "draft",
      submitted_at: null,
      note: null,
      entries: [],
    };
  }

  const entries = (await entriesBySubmission(db, storeId, [submission.id])).get(
    submission.id,
  );
  return { ...submission, entries: entries ?? [] };
}

export const shiftAvailabilityRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireEntitlement("shift"))

  /**
   * GET /api/shift/availability/:periodId/me
   * The caller's own submission. A member who has saved nothing gets an empty
   * draft rather than a 404, so the form has something to render.
   * Response: 200 { data: AvailabilitySubmissionResponse }
   */
  .get("/:periodId/me", async (c) => {
    const { id: storeId, member_id: memberId } = c.var.store;
    const periodId = c.req.param("periodId");
    const db = createDb(c.env.DB);

    if (!(await findPeriod(db, storeId, periodId))) {
      return errorResponse("NOT_FOUND", "Schedule period not found", 404);
    }

    return c.json({
      data: await readOwnSubmission(db, storeId, periodId, memberId),
    });
  })

  /**
   * PUT /api/shift/availability/:periodId/me
   * Replaces the caller's entries for the period. Allowed only while the
   * period is collecting: submission_deadline is advisory in v1, the manager
   * closing submissions is the enforcement.
   * Response: 200 { data: AvailabilitySubmissionResponse }
   */
  .put("/:periodId/me", bodyValidator(SaveAvailabilityInput), async (c) => {
    const { id: storeId, member_id: memberId } = c.var.store;
    const periodId = c.req.param("periodId");
    const { submit, note, entries } = c.req.valid("json");
    const db = createDb(c.env.DB);

    const period = await findPeriod(db, storeId, periodId);
    if (!period) {
      return errorResponse("NOT_FOUND", "Schedule period not found", 404);
    }
    if (period.status !== "collecting") {
      return errorResponse(
        "CONFLICT",
        "この期間の希望受付は締め切られています。",
        409,
      );
    }

    const withinPeriod = new Set(
      periodDates(period.start_date, period.end_date),
    );
    const stray = entries.find((entry) => !withinPeriod.has(entry.work_date));
    if (stray) {
      return errorResponse(
        "VALIDATION_ERROR",
        `${stray.work_date} はこの期間に含まれていません。`,
        400,
      );
    }

    const contradiction = contradictoryDate(entries);
    if (contradiction) {
      return errorResponse(
        "VALIDATION_ERROR",
        `${contradiction} の希望が重複しています。`,
        400,
      );
    }

    const existing = await db
      .select({ id: schema.availabilitySubmissions.id })
      .from(schema.availabilitySubmissions)
      .where(
        and(
          eq(schema.availabilitySubmissions.store_id, storeId),
          eq(schema.availabilitySubmissions.period_id, periodId),
          eq(schema.availabilitySubmissions.member_id, memberId),
        ),
      )
      .limit(1);

    const submissionId = existing[0]?.id ?? newId();
    const status = submit ? ("submitted" as const) : ("draft" as const);
    const submitted_at = submit ? now() : null;

    const rows = entries.map((entry) => ({
      id: newId(),
      ...entry,
      store_id: storeId,
      submission_id: submissionId,
    }));

    // One transaction: without it a failed insert leaves the member's previous
    // availability deleted and the submission reading "submitted" with nothing
    // in it, which the manager would build a schedule on.
    //
    // Chunked because D1 caps a query at 100 bound parameters and each entry
    // binds 8 (its seven columns plus the generated created_at) — a routine
    // half-month of one band per day is already over the limit.
    const ENTRIES_PER_INSERT = 12;
    const inserts = [];
    for (let i = 0; i < rows.length; i += ENTRIES_PER_INSERT) {
      inserts.push(
        db
          .insert(schema.availabilityEntries)
          .values(rows.slice(i, i + ENTRIES_PER_INSERT)),
      );
    }

    await db.batch([
      db
        .insert(schema.availabilitySubmissions)
        .values({
          id: submissionId,
          store_id: storeId,
          period_id: periodId,
          member_id: memberId,
          status,
          submitted_at,
          note,
        })
        // Upsert rather than update-then-insert: two concurrent saves would
        // otherwise race into the (period_id, member_id) unique index.
        .onConflictDoUpdate({
          target: [
            schema.availabilitySubmissions.period_id,
            schema.availabilitySubmissions.member_id,
          ],
          set: { status, submitted_at, note },
        }),
      db
        .delete(schema.availabilityEntries)
        .where(
          and(
            eq(schema.availabilityEntries.store_id, storeId),
            eq(schema.availabilityEntries.submission_id, submissionId),
          ),
        ),
      ...inserts,
    ]);

    // Read back rather than echoing the request: the response then carries
    // the stored entry ids, and a client can trust it as the new state.
    return c.json({
      data: await readOwnSubmission(db, storeId, periodId, memberId),
    });
  })

  /**
   * GET /api/shift/availability/:periodId
   * Every submission for the period, plus the members with none — v1 offers
   * that list instead of chasing non-submitters by email.
   *
   * Owner-only: one member must not read another's availability.
   * Response: 200 { data: { submissions, missing_member_ids } }
   */
  .get("/:periodId", requireOwner, async (c) => {
    const { id: storeId } = c.var.store;
    const periodId = c.req.param("periodId");
    const db = createDb(c.env.DB);

    if (!(await findPeriod(db, storeId, periodId))) {
      return errorResponse("NOT_FOUND", "Schedule period not found", 404);
    }

    const [rows, members] = await Promise.all([
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
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(eq(schema.members.store_id, storeId)),
    ]);

    const entriesByRow = await entriesBySubmission(
      db,
      storeId,
      rows.map((r) => r.id),
    );
    const submissions: AvailabilitySubmissionResponse[] = rows.map((row) => ({
      ...row,
      entries: entriesByRow.get(row.id) ?? [],
    }));

    // A draft counts as missing: the manager needs to know who is still
    // deciding, not just who has touched the form.
    const submittedBy = new Set(
      rows.filter((r) => r.status === "submitted").map((r) => r.member_id),
    );
    const missing_member_ids = members
      .map((m) => m.id)
      .filter((id) => !submittedBy.has(id));

    return c.json({ data: { submissions, missing_member_ids } });
  });
