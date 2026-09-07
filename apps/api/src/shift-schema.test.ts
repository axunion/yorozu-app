/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Shift-domain schema invariants (roadmap "Next product", slice 2).
 *
 * The tables land before any route that writes them, so what this slice
 * delivers is the set of rows D1 refuses. These tests insert through Drizzle
 * directly — there is no endpoint yet — and assert each CHECK constraint,
 * unique index and foreign key rejects the shape it is there to stop. Because
 * the constraints live in the applied migration, what they verify is
 * `packages/db/drizzle/0018_*.sql`, not the TypeScript in schema.ts.
 *
 * Each rejection is matched on the constraint's own name (or SQLite's wording
 * for unique/FK failures) so a test can't stay green on some unrelated error.
 *
 * The three enum CHECKs (`schedule_periods_status_chk`,
 * `availability_submissions_status_chk`, `availability_entries_kind_chk`) are
 * unreachable through Drizzle's typed enums, so they are deliberately not
 * covered here — the TypeScript types are the guard a caller actually meets.
 */
import { env } from "cloudflare:workers";
import { newId } from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seedStore } from "./test-helpers";

const db = () => createDb(env.DB);

const UNIQUE = /UNIQUE constraint failed/;
const FOREIGN_KEY = /FOREIGN KEY constraint failed/;

/**
 * Asserts the insert is rejected AND says which constraint rejected it.
 * Drizzle's own error only says "Failed query: insert into …"; D1 names the
 * constraint in the cause chain, so walk it rather than matching the wrapper.
 */
async function expectRejection(
  promise: Promise<unknown>,
  constraint: RegExp,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, "expected the insert to be rejected").toBeInstanceOf(Error);

  const messages: string[] = [];
  for (let error = caught; error instanceof Error; error = error.cause) {
    messages.push(error.message);
  }
  expect(messages.join(" | ")).toMatch(constraint);
}

async function createPosition(
  store_id: string,
  name = "ホール",
): Promise<string> {
  const id = newId();
  await db().insert(schema.positions).values({ id, store_id, name });
  return id;
}

async function createPeriod(
  store_id: string,
  start_date = "2026-09-01",
  end_date = "2026-09-15",
): Promise<string> {
  const id = newId();
  await db().insert(schema.schedulePeriods).values({
    id,
    store_id,
    start_date,
    end_date,
    submission_deadline: Date.now(),
  });
  return id;
}

async function createSubmission(
  store_id: string,
  period_id: string,
  member_id: string,
): Promise<string> {
  const id = newId();
  await db()
    .insert(schema.availabilitySubmissions)
    .values({ id, store_id, period_id, member_id });
  return id;
}

// ---------------------------------------------------------------------------
// shifts
// ---------------------------------------------------------------------------

describe("shifts constraints", () => {
  async function insertShift(
    store_id: string,
    period_id: string,
    member_id: string,
    overrides: Partial<{
      work_date: string;
      start_minutes: number;
      end_minutes: number;
      break_minutes: number;
    }> = {},
  ) {
    return db()
      .insert(schema.shifts)
      .values({
        id: newId(),
        store_id,
        period_id,
        member_id,
        work_date: "2026-09-01",
        start_minutes: 540, // 09:00
        end_minutes: 1020, // 17:00
        break_minutes: 60,
        ...overrides,
      });
  }

  it("rejects a shift that ends before it starts", async () => {
    const store = await seedStore(`Shift End Before ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);

    await expectRejection(
      insertShift(store.id, period, store.member_id, {
        start_minutes: 1020,
        end_minutes: 540,
        break_minutes: 0,
      }),
      /shifts_times_chk/,
    );
  });

  it("rejects a zero-length shift", async () => {
    const store = await seedStore(`Shift Zero Length ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);

    await expectRejection(
      insertShift(store.id, period, store.member_id, {
        start_minutes: 540,
        end_minutes: 540,
        break_minutes: 0,
      }),
      /shifts_times_chk/,
    );
  });

  it("rejects a negative start time", async () => {
    const store = await seedStore(
      `Shift Negative Start ${crypto.randomUUID()}`,
    );
    const period = await createPeriod(store.id);

    await expectRejection(
      insertShift(store.id, period, store.member_id, {
        start_minutes: -60,
        end_minutes: 540,
        break_minutes: 0,
      }),
      /shifts_times_chk/,
    );
  });

  it("rejects a start time that is not a time of day", async () => {
    // 1440 would encode "the next day at 00:00", giving one wall-clock band two
    // legal rows and defeating every work_date-keyed read.
    const store = await seedStore(
      `Shift Start Canonical ${crypto.randomUUID()}`,
    );
    const period = await createPeriod(store.id);

    await expectRejection(
      insertShift(store.id, period, store.member_id, {
        start_minutes: 1440,
        end_minutes: 1500,
        break_minutes: 0,
      }),
      /shifts_times_chk/,
    );
  });

  it("rejects a shift longer than 24 hours", async () => {
    const store = await seedStore(`Shift Too Long ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);

    await expectRejection(
      insertShift(store.id, period, store.member_id, {
        start_minutes: 540,
        end_minutes: 540 + 1441,
        break_minutes: 0,
      }),
      /shifts_times_chk/,
    );
  });

  it("rejects a work_date that is not YYYY-MM-DD", async () => {
    const store = await seedStore(`Shift Date Format ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);

    await expectRejection(
      insertShift(store.id, period, store.member_id, {
        work_date: "2026-9-1",
      }),
      /shifts_work_date_chk/,
    );
  });

  it("rejects a break as long as the shift", async () => {
    const store = await seedStore(
      `Shift Break Too Long ${crypto.randomUUID()}`,
    );
    const period = await createPeriod(store.id);

    await expectRejection(
      insertShift(store.id, period, store.member_id, {
        start_minutes: 540,
        end_minutes: 1020,
        break_minutes: 480,
      }),
      /shifts_break_chk/,
    );
  });

  it("rejects a negative break", async () => {
    const store = await seedStore(
      `Shift Negative Break ${crypto.randomUUID()}`,
    );
    const period = await createPeriod(store.id);

    await expectRejection(
      insertShift(store.id, period, store.member_id, { break_minutes: -1 }),
      /shifts_break_chk/,
    );
  });

  it("accepts an overnight shift ending past midnight, and defaults the break to 0", async () => {
    const store = await seedStore(`Shift Overnight ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);

    // 21:00 -> 01:00 the next calendar day, still the same business date.
    await db().insert(schema.shifts).values({
      id: newId(),
      store_id: store.id,
      period_id: period,
      member_id: store.member_id,
      work_date: "2026-09-01",
      start_minutes: 1260,
      end_minutes: 1500,
    });

    const rows = await db()
      .select({
        end_minutes: schema.shifts.end_minutes,
        break_minutes: schema.shifts.break_minutes,
      })
      .from(schema.shifts)
      .where(eq(schema.shifts.store_id, store.id));
    expect(rows[0]?.end_minutes).toBe(1500);
    expect(rows[0]?.break_minutes).toBe(0);
  });

  it("rejects a shift whose period belongs to no store at all", async () => {
    // The file's one FK case. It also pins the premise the account hard-delete
    // ordering test rests on: foreign keys really are enforced here.
    const store = await seedStore(`Shift Orphan Period ${crypto.randomUUID()}`);

    await expectRejection(
      insertShift(store.id, newId(), store.member_id),
      FOREIGN_KEY,
    );
  });
});

// ---------------------------------------------------------------------------
// schedule_periods
// ---------------------------------------------------------------------------

describe("schedule_periods constraints", () => {
  it("rejects a second period starting on the same date in one store", async () => {
    const store = await seedStore(`Period Duplicate ${crypto.randomUUID()}`);
    await createPeriod(store.id, "2026-09-01");

    await expectRejection(createPeriod(store.id, "2026-09-01"), UNIQUE);
  });

  it("lets one store hold several periods with different start dates", async () => {
    // Guards against an over-broad unique index on store_id alone.
    const store = await seedStore(`Period Multiple ${crypto.randomUUID()}`);

    await createPeriod(store.id, "2026-09-01", "2026-09-15");
    await createPeriod(store.id, "2026-09-16", "2026-09-30");

    const rows = await db()
      .select({ id: schema.schedulePeriods.id })
      .from(schema.schedulePeriods)
      .where(eq(schema.schedulePeriods.store_id, store.id));
    expect(rows).toHaveLength(2);
  });

  it("lets two stores hold a period with the same start date", async () => {
    const storeA = await seedStore(`Period Store A ${crypto.randomUUID()}`);
    const storeB = await seedStore(`Period Store B ${crypto.randomUUID()}`);

    await createPeriod(storeA.id, "2026-09-16", "2026-09-30");
    await createPeriod(storeB.id, "2026-09-16", "2026-09-30");

    const rows = await db()
      .select({ id: schema.schedulePeriods.id })
      .from(schema.schedulePeriods)
      .where(eq(schema.schedulePeriods.store_id, storeB.id));
    expect(rows).toHaveLength(1);
  });

  it("rejects a period whose end date precedes its start date", async () => {
    const store = await seedStore(`Period Backwards ${crypto.randomUUID()}`);

    await expectRejection(
      createPeriod(store.id, "2026-09-16", "2026-09-01"),
      /schedule_periods_dates_chk/,
    );
  });

  it("rejects a start date that is not YYYY-MM-DD", async () => {
    // "2026-9-1" sorts before "2026-09-16", so without the format check it
    // would slip past both the date ordering check and the unique index.
    const store = await seedStore(`Period Date Format ${crypto.randomUUID()}`);

    await expectRejection(
      createPeriod(store.id, "2026-9-1", "2026-09-15"),
      /schedule_periods_date_format_chk/,
    );
  });

  it("rejects a published period with no published_at", async () => {
    const store = await seedStore(`Period Published ${crypto.randomUUID()}`);

    await expectRejection(
      db().insert(schema.schedulePeriods).values({
        id: newId(),
        store_id: store.id,
        start_date: "2026-10-01",
        end_date: "2026-10-15",
        status: "published",
        submission_deadline: Date.now(),
      }),
      /schedule_periods_published_chk/,
    );
  });

  it("accepts a published period carrying published_at, and defaults new periods to collecting", async () => {
    const store = await seedStore(`Period Published OK ${crypto.randomUUID()}`);
    const ts = Date.now();

    const draftId = await createPeriod(store.id, "2026-10-01", "2026-10-15");
    await db().insert(schema.schedulePeriods).values({
      id: newId(),
      store_id: store.id,
      start_date: "2026-10-16",
      end_date: "2026-10-31",
      status: "published",
      submission_deadline: ts,
      published_at: ts,
    });

    const rows = await db()
      .select({
        id: schema.schedulePeriods.id,
        status: schema.schedulePeriods.status,
      })
      .from(schema.schedulePeriods)
      .where(eq(schema.schedulePeriods.store_id, store.id));
    expect(rows.find((r) => r.id === draftId)?.status).toBe("collecting");
    expect(rows.filter((r) => r.status === "published")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// availability_submissions / availability_entries
// ---------------------------------------------------------------------------

describe("availability constraints", () => {
  it("rejects a second submission by the same member for one period", async () => {
    const store = await seedStore(`Submission Dup ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);
    await createSubmission(store.id, period, store.member_id);

    await expectRejection(
      createSubmission(store.id, period, store.member_id),
      UNIQUE,
    );
  });

  it("lets one member submit for two different periods", async () => {
    // Guards against an over-broad unique index on member_id alone.
    const store = await seedStore(
      `Submission Two Periods ${crypto.randomUUID()}`,
    );
    const first = await createPeriod(store.id, "2026-09-01", "2026-09-15");
    const second = await createPeriod(store.id, "2026-09-16", "2026-09-30");

    await createSubmission(store.id, first, store.member_id);
    await createSubmission(store.id, second, store.member_id);

    const rows = await db()
      .select({ id: schema.availabilitySubmissions.id })
      .from(schema.availabilitySubmissions)
      .where(eq(schema.availabilitySubmissions.member_id, store.member_id));
    expect(rows).toHaveLength(2);
  });

  it("rejects a submitted submission with no submitted_at", async () => {
    const store = await seedStore(`Submission Status ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);

    await expectRejection(
      db().insert(schema.availabilitySubmissions).values({
        id: newId(),
        store_id: store.id,
        period_id: period,
        member_id: store.member_id,
        status: "submitted",
      }),
      /availability_submissions_submitted_chk/,
    );
  });

  it("rejects an available entry with no times", async () => {
    const store = await seedStore(`Entry No Times ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);
    const submission = await createSubmission(
      store.id,
      period,
      store.member_id,
    );

    await expectRejection(
      db().insert(schema.availabilityEntries).values({
        id: newId(),
        store_id: store.id,
        submission_id: submission,
        work_date: "2026-09-02",
        kind: "available",
      }),
      /availability_entries_available_times_chk/,
    );
  });

  it("rejects an available entry whose band runs backwards", async () => {
    const store = await seedStore(`Entry Backwards ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);
    const submission = await createSubmission(
      store.id,
      period,
      store.member_id,
    );

    await expectRejection(
      db().insert(schema.availabilityEntries).values({
        id: newId(),
        store_id: store.id,
        submission_id: submission,
        work_date: "2026-09-02",
        kind: "available",
        start_minutes: 1020,
        end_minutes: 540,
      }),
      /availability_entries_available_times_chk/,
    );
  });

  it("rejects a day_off entry that carries times", async () => {
    const store = await seedStore(`Entry Day Off ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);
    const submission = await createSubmission(
      store.id,
      period,
      store.member_id,
    );

    await expectRejection(
      db().insert(schema.availabilityEntries).values({
        id: newId(),
        store_id: store.id,
        submission_id: submission,
        work_date: "2026-09-02",
        kind: "day_off",
        start_minutes: 540,
        end_minutes: 1020,
      }),
      /availability_entries_day_off_times_chk/,
    );
  });

  it("rejects an entry whose work_date is not YYYY-MM-DD", async () => {
    const store = await seedStore(`Entry Date Format ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);
    const submission = await createSubmission(
      store.id,
      period,
      store.member_id,
    );

    await expectRejection(
      db().insert(schema.availabilityEntries).values({
        id: newId(),
        store_id: store.id,
        submission_id: submission,
        work_date: "2026-9-2",
        kind: "day_off",
      }),
      /availability_entries_work_date_chk/,
    );
  });

  it("accepts two available bands on the same day", async () => {
    const store = await seedStore(`Entry Two Bands ${crypto.randomUUID()}`);
    const period = await createPeriod(store.id);
    const submission = await createSubmission(
      store.id,
      period,
      store.member_id,
    );

    await db()
      .insert(schema.availabilityEntries)
      .values([
        {
          id: newId(),
          store_id: store.id,
          submission_id: submission,
          work_date: "2026-09-03",
          kind: "available",
          start_minutes: 540,
          end_minutes: 720,
        },
        {
          id: newId(),
          store_id: store.id,
          submission_id: submission,
          work_date: "2026-09-03",
          kind: "available",
          start_minutes: 1020,
          end_minutes: 1320,
        },
      ]);

    const rows = await db()
      .select({ id: schema.availabilityEntries.id })
      .from(schema.availabilityEntries)
      .where(eq(schema.availabilityEntries.submission_id, submission));
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// staffing_requirements
// ---------------------------------------------------------------------------

describe("staffing_requirements constraints", () => {
  async function insertRequirement(
    store_id: string,
    position_id: string,
    overrides: Partial<{
      weekday: number;
      start_minutes: number;
      end_minutes: number;
      required_headcount: number;
    }> = {},
  ) {
    return db()
      .insert(schema.staffingRequirements)
      .values({
        id: newId(),
        store_id,
        position_id,
        weekday: 5,
        start_minutes: 1020,
        end_minutes: 1320,
        required_headcount: 2,
        ...overrides,
      });
  }

  it("rejects a weekday above 6", async () => {
    const store = await seedStore(`Requirement Weekday ${crypto.randomUUID()}`);
    const position = await createPosition(store.id);

    await expectRejection(
      insertRequirement(store.id, position, { weekday: 7 }),
      /staffing_requirements_weekday_chk/,
    );
  });

  it("rejects a negative weekday", async () => {
    const store = await seedStore(
      `Requirement Weekday Low ${crypto.randomUUID()}`,
    );
    const position = await createPosition(store.id);

    await expectRejection(
      insertRequirement(store.id, position, { weekday: -1 }),
      /staffing_requirements_weekday_chk/,
    );
  });

  it("rejects a band that runs backwards", async () => {
    const store = await seedStore(`Requirement Band ${crypto.randomUUID()}`);
    const position = await createPosition(store.id);

    await expectRejection(
      insertRequirement(store.id, position, {
        start_minutes: 1320,
        end_minutes: 1020,
      }),
      /staffing_requirements_times_chk/,
    );
  });

  it("rejects a negative required headcount", async () => {
    const store = await seedStore(`Requirement Count ${crypto.randomUUID()}`);
    const position = await createPosition(store.id);

    await expectRejection(
      insertRequirement(store.id, position, { required_headcount: -1 }),
      /staffing_requirements_headcount_nonneg_chk/,
    );
  });

  it("accepts a zero headcount, which closes a band", async () => {
    const store = await seedStore(`Requirement Zero ${crypto.randomUUID()}`);
    const position = await createPosition(store.id);

    await insertRequirement(store.id, position, { required_headcount: 0 });

    const rows = await db()
      .select({
        required_headcount: schema.staffingRequirements.required_headcount,
      })
      .from(schema.staffingRequirements)
      .where(eq(schema.staffingRequirements.store_id, store.id));
    expect(rows[0]?.required_headcount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// roster tables
// ---------------------------------------------------------------------------

describe("roster constraints", () => {
  it("rejects assigning a member to the same position twice", async () => {
    const store = await seedStore(`Member Position ${crypto.randomUUID()}`);
    const position = await createPosition(store.id);
    const values = {
      store_id: store.id,
      member_id: store.member_id,
      position_id: position,
    };

    await db()
      .insert(schema.memberPositions)
      .values({ id: newId(), ...values });

    await expectRejection(
      db()
        .insert(schema.memberPositions)
        .values({ id: newId(), ...values }),
      UNIQUE,
    );
  });

  it("lets one member hold two different positions", async () => {
    // Guards against an over-broad unique index on member_id alone.
    const store = await seedStore(
      `Member Two Positions ${crypto.randomUUID()}`,
    );
    const hall = await createPosition(store.id, "ホール");
    const kitchen = await createPosition(store.id, "キッチン");

    await db()
      .insert(schema.memberPositions)
      .values([
        {
          id: newId(),
          store_id: store.id,
          member_id: store.member_id,
          position_id: hall,
        },
        {
          id: newId(),
          store_id: store.id,
          member_id: store.member_id,
          position_id: kitchen,
        },
      ]);

    const rows = await db()
      .select({ id: schema.memberPositions.id })
      .from(schema.memberPositions)
      .where(eq(schema.memberPositions.member_id, store.member_id));
    expect(rows).toHaveLength(2);
  });

  it("rejects a second work profile for one member", async () => {
    const store = await seedStore(`Work Profile ${crypto.randomUUID()}`);
    const values = { store_id: store.id, member_id: store.member_id };

    await db()
      .insert(schema.memberWorkProfiles)
      .values({ id: newId(), ...values, hourly_wage: 1100 });

    await expectRejection(
      db()
        .insert(schema.memberWorkProfiles)
        .values({ id: newId(), ...values }),
      UNIQUE,
    );
  });

  it("rejects a negative hourly wage", async () => {
    const store = await seedStore(`Work Profile Wage ${crypto.randomUUID()}`);

    await expectRejection(
      db().insert(schema.memberWorkProfiles).values({
        id: newId(),
        store_id: store.id,
        member_id: store.member_id,
        hourly_wage: -1,
      }),
      /member_work_profiles_wage_nonneg_chk/,
    );
  });

  it("rejects a weekly cap of zero minutes", async () => {
    // A cap of 0 would mean "can never work", which is a removal, not a cap.
    const store = await seedStore(`Work Profile Cap ${crypto.randomUUID()}`);

    await expectRejection(
      db().insert(schema.memberWorkProfiles).values({
        id: newId(),
        store_id: store.id,
        member_id: store.member_id,
        weekly_cap_minutes: 0,
      }),
      /member_work_profiles_cap_positive_chk/,
    );
  });

  it("rejects a position pointing at a store that does not exist", async () => {
    await expectRejection(createPosition(newId()), FOREIGN_KEY);
  });

  it("defaults a new position to active with sort order 0", async () => {
    const store = await seedStore(`Position Defaults ${crypto.randomUUID()}`);
    const position = await createPosition(store.id);

    const rows = await db()
      .select({
        is_active: schema.positions.is_active,
        sort_order: schema.positions.sort_order,
      })
      .from(schema.positions)
      .where(eq(schema.positions.id, position));
    expect(rows[0]?.is_active).toBe(true);
    expect(rows[0]?.sort_order).toBe(0);
  });

  it("rejects a shift pattern that ends before it starts", async () => {
    const store = await seedStore(`Pattern Times ${crypto.randomUUID()}`);

    await expectRejection(
      db().insert(schema.shiftPatterns).values({
        id: newId(),
        store_id: store.id,
        name: "遅番",
        start_minutes: 1320,
        end_minutes: 1020,
      }),
      /shift_patterns_times_chk/,
    );
  });

  it("rejects a zero-length shift pattern", async () => {
    const store = await seedStore(`Pattern Zero ${crypto.randomUUID()}`);

    await expectRejection(
      db().insert(schema.shiftPatterns).values({
        id: newId(),
        store_id: store.id,
        name: "空",
        start_minutes: 540,
        end_minutes: 540,
      }),
      /shift_patterns_times_chk/,
    );
  });
});
