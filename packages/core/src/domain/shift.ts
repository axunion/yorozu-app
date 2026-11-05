/**
 * Shift scheduling arithmetic: periods, durations, labour-law warnings,
 * staffing coverage and estimated labour cost.
 *
 * A shift is a JST business date (`work_date`) plus minute offsets from that
 * date's 00:00 JST. `start_minutes` is a time of day (0–1439); `end_minutes`
 * may run past 1440 for an overnight shift (25:00 -> 1500), so it stays
 * attached to the business day it belongs to.
 *
 * Nothing here is persisted: the API returns rows, and the SPA calls these to
 * render shortages, warnings and cost. Warnings never block a write — they are
 * advisory, matching every scheduling product a Japanese restaurant already
 * uses.
 */

import {
  jstDayRange,
  jstWeekRange,
  toJstDateString,
  toJstWeekday,
} from "./time";

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;

/** Labour-law thresholds (労働基準法 32条・34条・35条・61条). */
const DAILY_LIMIT_MINUTES = 8 * 60;
const WEEKLY_LIMIT_MINUTES = 40 * 60;
const BREAK_TIER_1_AFTER = 6 * 60;
const BREAK_TIER_1_MINUTES = 45;
const BREAK_TIER_2_AFTER = 8 * 60;
const BREAK_TIER_2_MINUTES = 60;
const DAYS_PER_WEEK = 7;

/** 22:00–05:00, expressed in each business day's minute space. */
const LATE_NIGHT_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0, 5 * 60],
  [22 * 60, 29 * 60],
  [MINUTES_PER_DAY + 22 * 60, MINUTES_PER_DAY + 29 * 60],
];

/** The shape every function here needs; rows carry more columns than this. */
export type ShiftLike = {
  member_id: string;
  position_id?: string | null;
  work_date: string;
  start_minutes: number;
  end_minutes: number;
  break_minutes: number;
};

export type WorkProfileLike = {
  member_id: string;
  hourly_wage: number | null;
  weekly_cap_minutes: number | null;
  is_minor: boolean;
};

export type StaffingRequirementLike = {
  weekday: number;
  position_id: string;
  start_minutes: number;
  end_minutes: number;
  required_headcount: number;
};

export type LaborWarningCode =
  | "DAILY_OVER_8H"
  | "WEEKLY_OVER_40H"
  | "BREAK_REQUIRED_45"
  | "BREAK_REQUIRED_60"
  | "NO_REST_DAY"
  | "OVER_WEEKLY_CAP"
  | "MINOR_LATE_NIGHT";

export type LaborWarning = {
  code: LaborWarningCode;
  member_id: string;
  /** The day at fault; absent for warnings that span a whole week. */
  work_date?: string;
};

export type CoverageRow = {
  work_date: string;
  position_id: string;
  start_minutes: number;
  end_minutes: number;
  required: number;
  assigned: number;
};

export type LaborCost = {
  total: number;
  per_date: Record<string, number>;
  per_member: Record<string, number>;
  /** Members whose shifts are excluded because no hourly wage is recorded. */
  unpriced_member_ids: string[];
};

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/**
 * Minutes since the Unix epoch at 00:00 JST on a "YYYY-MM-DD" business date.
 * Throws on a malformed or calendar-invalid date, so every function below
 * inherits that validation.
 */
function jstMidnightMinutes(dateStr: string): number {
  return jstDayRange(dateStr).from / MS_PER_MINUTE;
}

/**
 * Returns the half-month period containing `dateStr`: the 1st–15th, or the
 * 16th–end of month. Throws on a malformed or calendar-invalid date.
 */
export function halfMonthPeriod(dateStr: string): {
  start_date: string;
  end_date: string;
} {
  jstDayRange(dateStr); // validates the date
  const [year = "", month = "", day = ""] = dateStr.split("-");

  if (Number(day) <= 15) {
    return {
      start_date: `${year}-${month}-01`,
      end_date: `${year}-${month}-15`,
    };
  }

  // Day 0 of the next month is the last day of this one.
  const lastDay = new Date(
    Date.UTC(Number(year), Number(month), 0),
  ).getUTCDate();
  return {
    start_date: `${year}-${month}-16`,
    end_date: `${year}-${month}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** Every business date from `start_date` to `end_date`, inclusive. */
export function periodDates(start_date: string, end_date: string): string[] {
  const from = jstMidnightMinutes(start_date);
  const to = jstMidnightMinutes(end_date);
  if (to < from) {
    throw new Error(`Period ends before it starts: ${start_date}..${end_date}`);
  }

  const dates: string[] = [];
  for (let minutes = from; minutes <= to; minutes += MINUTES_PER_DAY) {
    dates.push(toJstDateString(minutes * MS_PER_MINUTE));
  }
  return dates;
}

// ---------------------------------------------------------------------------
// Single-shift arithmetic
// ---------------------------------------------------------------------------

/** Paid minutes: the span minus the unpaid break. */
export function workedMinutes(shift: ShiftLike): number {
  return shift.end_minutes - shift.start_minutes - shift.break_minutes;
}

/**
 * The shift's span in minutes since the Unix epoch, so shifts on different
 * business dates — an overnight one and the next morning — compare directly.
 */
export function absoluteRange(shift: ShiftLike): { from: number; to: number } {
  const midnight = jstMidnightMinutes(shift.work_date);
  return {
    from: midnight + shift.start_minutes,
    to: midnight + shift.end_minutes,
  };
}

/** True when two shifts share any minute. Touching ends do not overlap. */
export function overlaps(a: ShiftLike, b: ShiftLike): boolean {
  const first = absoluteRange(a);
  const second = absoluteRange(b);
  return first.from < second.to && second.from < first.to;
}

/** Minutes of the shift falling in the 22:00–05:00 late-night band. */
export function lateNightMinutes(shift: ShiftLike): number {
  let total = 0;
  for (const [bandStart, bandEnd] of LATE_NIGHT_BANDS) {
    const from = Math.max(shift.start_minutes, bandStart);
    const to = Math.min(shift.end_minutes, bandEnd);
    if (to > from) total += to - from;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Labour-law warnings
// ---------------------------------------------------------------------------

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

function sumWorked(shifts: ShiftLike[]): number {
  return shifts.reduce((total, shift) => total + workedMinutes(shift), 0);
}

/**
 * Advisory warnings for a set of shifts. Every warning is a "check this",
 * never a rejection — the schedule still saves, matching how Japanese
 * scheduling products treat these limits.
 */
export function laborWarnings(
  shifts: ShiftLike[],
  profiles: WorkProfileLike[],
): LaborWarning[] {
  const profileByMember = new Map(profiles.map((p) => [p.member_id, p]));
  const warnings: LaborWarning[] = [];

  for (const shift of shifts) {
    const worked = workedMinutes(shift);
    // Only the binding tier is reported: over 8 hours, the 45-minute rule is
    // subsumed by the 60-minute one and repeating it is noise.
    if (
      worked > BREAK_TIER_2_AFTER &&
      shift.break_minutes < BREAK_TIER_2_MINUTES
    ) {
      warnings.push({
        code: "BREAK_REQUIRED_60",
        member_id: shift.member_id,
        work_date: shift.work_date,
      });
    } else if (
      worked > BREAK_TIER_1_AFTER &&
      shift.break_minutes < BREAK_TIER_1_MINUTES
    ) {
      warnings.push({
        code: "BREAK_REQUIRED_45",
        member_id: shift.member_id,
        work_date: shift.work_date,
      });
    }

    if (
      profileByMember.get(shift.member_id)?.is_minor &&
      lateNightMinutes(shift) > 0
    ) {
      warnings.push({
        code: "MINOR_LATE_NIGHT",
        member_id: shift.member_id,
        work_date: shift.work_date,
      });
    }
  }

  for (const [member_id, memberShifts] of groupBy(shifts, (s) => s.member_id)) {
    for (const [work_date, dayShifts] of groupBy(
      memberShifts,
      (s) => s.work_date,
    )) {
      if (sumWorked(dayShifts) > DAILY_LIMIT_MINUTES) {
        warnings.push({ code: "DAILY_OVER_8H", member_id, work_date });
      }
    }

    const cap = profileByMember.get(member_id)?.weekly_cap_minutes ?? null;
    for (const [, weekShifts] of groupBy(memberShifts, (s) =>
      String(jstWeekRange(s.work_date).from),
    )) {
      const weekly = sumWorked(weekShifts);
      if (weekly > WEEKLY_LIMIT_MINUTES) {
        warnings.push({ code: "WEEKLY_OVER_40H", member_id });
      }
      if (cap !== null && weekly > cap) {
        warnings.push({ code: "OVER_WEEKLY_CAP", member_id });
      }
      const days = new Set(weekShifts.map((s) => s.work_date));
      if (days.size >= DAYS_PER_WEEK) {
        warnings.push({ code: "NO_REST_DAY", member_id });
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * Required vs. assigned headcount per date, position and band. A shift counts
 * towards a band when it overlaps it at all: a manager reading the grid wants
 * "who is here during this band", not "who is here for all of it".
 */
export function coverage(
  shifts: ShiftLike[],
  requirements: StaffingRequirementLike[],
  dates: string[],
): CoverageRow[] {
  const rows: CoverageRow[] = [];
  const shiftsByDate = groupBy(shifts, (s) => s.work_date);

  for (const work_date of dates) {
    const weekday = toJstWeekday(jstDayRange(work_date).from);
    const dayShifts = shiftsByDate.get(work_date) ?? [];

    for (const requirement of requirements) {
      if (requirement.weekday !== weekday) continue;

      const assigned = dayShifts.filter(
        (shift) =>
          shift.position_id === requirement.position_id &&
          shift.start_minutes < requirement.end_minutes &&
          requirement.start_minutes < shift.end_minutes,
      ).length;

      rows.push({
        work_date,
        position_id: requirement.position_id,
        start_minutes: requirement.start_minutes,
        end_minutes: requirement.end_minutes,
        required: requirement.required_headcount,
        assigned,
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Labour cost
// ---------------------------------------------------------------------------

/**
 * Rough labour cost: hourly wage × worked minutes, rounded to whole yen.
 * A member with no recorded wage is reported in `unpriced_member_ids` rather
 * than counted as free, so a total is never quietly too low.
 */
export function estimatedLaborCost(
  shifts: ShiftLike[],
  profiles: WorkProfileLike[],
): LaborCost {
  const wageByMember = new Map(
    profiles.map((p) => [p.member_id, p.hourly_wage]),
  );
  const per_date: Record<string, number> = {};
  const per_member: Record<string, number> = {};
  const unpriced = new Set<string>();
  let total = 0;

  for (const shift of shifts) {
    const wage = wageByMember.get(shift.member_id) ?? null;
    if (wage === null) {
      unpriced.add(shift.member_id);
      continue;
    }

    const cost = Math.round((wage * workedMinutes(shift)) / 60);
    total += cost;
    per_date[shift.work_date] = (per_date[shift.work_date] ?? 0) + cost;
    per_member[shift.member_id] = (per_member[shift.member_id] ?? 0) + cost;
  }

  return { total, per_date, per_member, unpriced_member_ids: [...unpriced] };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type AvailabilityEntryLike = {
  work_date: string;
  kind: "available" | "day_off";
  start_minutes: number | null;
  end_minutes: number | null;
};

export type AvailabilitySubmissionLike = {
  member_id: string;
  status: "draft" | "submitted";
  entries: AvailabilityEntryLike[];
};

/**
 * What one member asked for on one date. Only a submitted submission
 * counts: a draft is still being edited, so it reads as `not_submitted`.
 * A submitted form that leaves the date blank is `undecided` (未定).
 */
export type DayAvailability =
  | {
      kind: "available";
      bands: { start_minutes: number; end_minutes: number }[];
    }
  | { kind: "day_off" }
  | { kind: "undecided" }
  | { kind: "not_submitted" };

export function dayAvailability(
  submissions: AvailabilitySubmissionLike[],
  member_id: string,
  work_date: string,
): DayAvailability {
  const submission = submissions.find(
    (s) => s.member_id === member_id && s.status === "submitted",
  );
  if (!submission) return { kind: "not_submitted" };
  const entries = submission.entries.filter((e) => e.work_date === work_date);
  if (entries.some((e) => e.kind === "day_off")) return { kind: "day_off" };
  // Bands that touch or overlap read as one: a shift across 10:00–14:00 and
  // 14:00–18:00 is inside what the member offered.
  const sorted = entries
    .flatMap((e) =>
      e.start_minutes !== null && e.end_minutes !== null
        ? [{ start_minutes: e.start_minutes, end_minutes: e.end_minutes }]
        : [],
    )
    .sort((a, b) => a.start_minutes - b.start_minutes);
  const bands: { start_minutes: number; end_minutes: number }[] = [];
  for (const next of sorted) {
    const last = bands.at(-1);
    if (last && next.start_minutes <= last.end_minutes) {
      last.end_minutes = Math.max(last.end_minutes, next.end_minutes);
    } else {
      bands.push(next);
    }
  }
  return bands.length > 0
    ? { kind: "available", bands }
    : { kind: "undecided" };
}

export type AvailabilityWarningCode =
  | "ON_REQUESTED_DAY_OFF"
  | "OUTSIDE_AVAILABLE_BAND";

export type AvailabilityWarning = {
  code: AvailabilityWarningCode;
  member_id: string;
  work_date: string;
};

/**
 * Shifts that go against what the member submitted: assigned on a day they
 * asked off, or not inside any band they said they could work. Advisory like
 * laborWarnings — a manager may have agreed the change with the member.
 * Undecided and unsubmitted days raise nothing; there is nothing to go
 * against.
 */
export function availabilityWarnings(
  shifts: ShiftLike[],
  submissions: AvailabilitySubmissionLike[],
): AvailabilityWarning[] {
  const warnings: AvailabilityWarning[] = [];
  // One row per member, date and code, however many shifts (a split shift)
  // break the same request.
  const seen = new Set<string>();
  const push = (warning: AvailabilityWarning) => {
    const key = `${warning.code}|${warning.member_id}|${warning.work_date}`;
    if (seen.has(key)) return;
    seen.add(key);
    warnings.push(warning);
  };
  for (const shift of shifts) {
    const day = dayAvailability(submissions, shift.member_id, shift.work_date);
    const base = { member_id: shift.member_id, work_date: shift.work_date };
    if (day.kind === "day_off") {
      push({ code: "ON_REQUESTED_DAY_OFF", ...base });
    } else if (
      day.kind === "available" &&
      !day.bands.some(
        (band) =>
          band.start_minutes <= shift.start_minutes &&
          shift.end_minutes <= band.end_minutes,
      )
    ) {
      push({ code: "OUTSIDE_AVAILABLE_BAND", ...base });
    }
  }
  return warnings;
}
