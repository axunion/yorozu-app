/**
 * Request schemas and response shapes for shift management.
 *
 * Split out of types/index.ts (already the size of a file this project would
 * split) because this is a separate product; index.ts re-exports it, so
 * `@yorozu/core` and `@yorozu/core/types` are unchanged for callers.
 *
 * Times follow the schema's encoding: `start_minutes` is a time of day on
 * `work_date`, `end_minutes` may cross midnight but not run past the next one.
 * The DB carries the same rules as CHECK constraints — these give the caller a
 * 400 with a message instead of a 500 from a constraint failure.
 */

import { z } from "zod";
import { halfMonthPeriod } from "../domain/shift";
import { jstDayRange } from "../domain/time";
import { displayName, sortOrderValue } from "./primitives";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const MINUTES_PER_DAY = 1440;

/** JST business date, "YYYY-MM-DD", rejecting calendar-invalid days. */
const workDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((value) => {
    try {
      jstDayRange(value);
      return true;
    } catch {
      return false;
    }
  }, "Not a real calendar date");

/** A time of day, in minutes from 00:00 JST. */
const timeOfDay = z
  .number()
  .int()
  .min(0)
  .max(MINUTES_PER_DAY - 1);

/** An end time, which may cross midnight (25:00 -> 1500). */
const endOfBand = z
  .number()
  .int()
  .min(1)
  .max(MINUTES_PER_DAY * 2);

const headcount = z.number().int().min(0).max(999);
const weekday = z.number().int().min(0).max(6);

/** Rejects a band that runs backwards or spans more than 24 hours. */
function bandRefinement<
  T extends { start_minutes: number; end_minutes: number },
>(schema: z.ZodType<T>) {
  return schema
    .refine((v) => v.end_minutes > v.start_minutes, {
      message: "end_minutes must be after start_minutes",
      path: ["end_minutes"],
    })
    .refine((v) => v.end_minutes - v.start_minutes <= MINUTES_PER_DAY, {
      message: "A band cannot be longer than 24 hours",
      path: ["end_minutes"],
    });
}

// ---------------------------------------------------------------------------
// Positions and shift patterns
// ---------------------------------------------------------------------------

export const CreatePositionInput = z.object({
  name: displayName,
  sort_order: sortOrderValue.default(0),
});
export type CreatePositionInput = z.infer<typeof CreatePositionInput>;

export const UpdatePositionInput = z.object({
  name: displayName,
  sort_order: sortOrderValue,
  is_active: z.boolean(),
});
export type UpdatePositionInput = z.infer<typeof UpdatePositionInput>;

export const CreateShiftPatternInput = bandRefinement(
  z.object({
    name: displayName,
    start_minutes: timeOfDay,
    end_minutes: endOfBand,
    sort_order: sortOrderValue.default(0),
  }),
);
export type CreateShiftPatternInput = z.infer<typeof CreateShiftPatternInput>;

export const UpdateShiftPatternInput = bandRefinement(
  z.object({
    name: displayName,
    start_minutes: timeOfDay,
    end_minutes: endOfBand,
    sort_order: sortOrderValue,
    is_active: z.boolean(),
  }),
);
export type UpdateShiftPatternInput = z.infer<typeof UpdateShiftPatternInput>;

// ---------------------------------------------------------------------------
// Staffing requirements
// ---------------------------------------------------------------------------

export const CreateStaffingRequirementInput = bandRefinement(
  z.object({
    weekday,
    position_id: z.string().min(1),
    start_minutes: timeOfDay,
    end_minutes: endOfBand,
    /** 0 is meaningful: it closes a band that used to need staff. */
    required_headcount: headcount,
  }),
);
export type CreateStaffingRequirementInput = z.infer<
  typeof CreateStaffingRequirementInput
>;

export const UpdateStaffingRequirementInput = CreateStaffingRequirementInput;
export type UpdateStaffingRequirementInput = z.infer<
  typeof UpdateStaffingRequirementInput
>;

// ---------------------------------------------------------------------------
// Member roster
// ---------------------------------------------------------------------------

export const UpdateMemberPositionsInput = z
  .object({
    /** Replaces the member's assignments; an empty list clears them. */
    position_ids: z.array(z.string().min(1)).max(50),
  })
  .refine((v) => new Set(v.position_ids).size === v.position_ids.length, {
    message: "position_ids must not repeat",
    path: ["position_ids"],
  });
export type UpdateMemberPositionsInput = z.infer<
  typeof UpdateMemberPositionsInput
>;

export const UpdateMemberWorkProfileInput = z.object({
  /** JPY per hour; null means "not recorded", not "free". */
  hourly_wage: z.number().int().min(0).max(100_000).nullable(),
  /** Null means no cap; 0 would mean "can never work", which is a removal. */
  weekly_cap_minutes: z.number().int().positive().max(10_080).nullable(),
  is_minor: z.boolean(),
});
export type UpdateMemberWorkProfileInput = z.infer<
  typeof UpdateMemberWorkProfileInput
>;

// ---------------------------------------------------------------------------
// Schedule periods
// ---------------------------------------------------------------------------

export const CreateSchedulePeriodInput = z
  .object({
    start_date: workDate,
    end_date: workDate,
    /** Unix ms. Advisory in v1: closing submissions is the enforcement. */
    submission_deadline: z.number().int().positive(),
  })
  .refine(
    (v) => {
      // halfMonthPeriod throws on a calendar-invalid date, and this object
      // refinement still runs when start_date failed its own check — letting
      // it throw would surface as a 500 instead of a validation error.
      try {
        const half = halfMonthPeriod(v.start_date);
        return half.start_date === v.start_date && half.end_date === v.end_date;
      } catch {
        return false;
      }
    },
    {
      message:
        "A period must cover a whole half-month (1st-15th or 16th-end of month)",
      path: ["end_date"],
    },
  );
export type CreateSchedulePeriodInput = z.infer<
  typeof CreateSchedulePeriodInput
>;

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

const AvailabilityEntryInput = z
  .object({
    work_date: workDate,
    kind: z.enum(["available", "day_off"]),
    start_minutes: timeOfDay.nullable().default(null),
    end_minutes: endOfBand.nullable().default(null),
  })
  .refine(
    (v) =>
      v.kind !== "available" ||
      (v.start_minutes !== null &&
        v.end_minutes !== null &&
        v.end_minutes > v.start_minutes &&
        v.end_minutes - v.start_minutes <= MINUTES_PER_DAY),
    {
      message: "An available entry needs a band that runs forwards",
      path: ["end_minutes"],
    },
  )
  .refine(
    (v) =>
      v.kind !== "day_off" ||
      (v.start_minutes === null && v.end_minutes === null),
    {
      message: "A day_off entry covers the whole day and carries no times",
      path: ["start_minutes"],
    },
  );
export type AvailabilityEntryInput = z.infer<typeof AvailabilityEntryInput>;

export const SaveAvailabilityInput = z.object({
  /** False saves a draft the member can still edit. */
  submit: z.boolean().default(false),
  note: z.string().max(500).nullable().default(null),
  /** Replaces every entry for the period. A half-month of bands fits easily. */
  entries: z.array(AvailabilityEntryInput).max(500),
});
export type SaveAvailabilityInput = z.infer<typeof SaveAvailabilityInput>;

// ---------------------------------------------------------------------------
// Shifts
// ---------------------------------------------------------------------------

const shiftShape = z.object({
  period_id: z.string().min(1),
  member_id: z.string().min(1),
  position_id: z.string().min(1).nullable().default(null),
  work_date: workDate,
  start_minutes: timeOfDay,
  end_minutes: endOfBand,
  break_minutes: z.number().int().min(0).max(MINUTES_PER_DAY).default(0),
  note: z.string().max(500).nullable().default(null),
});

const withShiftRules = <T extends z.ZodType<z.infer<typeof shiftShape>>>(
  schema: T,
) =>
  bandRefinement(schema).refine(
    (v) => v.break_minutes < v.end_minutes - v.start_minutes,
    {
      message: "The break cannot be as long as the shift",
      path: ["break_minutes"],
    },
  );

export const CreateShiftInput = withShiftRules(shiftShape);
export type CreateShiftInput = z.infer<typeof CreateShiftInput>;

export const UpdateShiftInput = CreateShiftInput;
export type UpdateShiftInput = z.infer<typeof UpdateShiftInput>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface PositionResponse {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
}

export interface ShiftPatternResponse {
  id: string;
  name: string;
  start_minutes: number;
  end_minutes: number;
  sort_order: number;
  is_active: boolean;
}

export interface StaffingRequirementResponse {
  id: string;
  weekday: number;
  position_id: string;
  start_minutes: number;
  end_minutes: number;
  required_headcount: number;
}

export interface ShiftMemberResponse {
  id: string;
  email: string;
  role: "owner" | "staff";
  position_ids: string[];
  hourly_wage: number | null;
  weekly_cap_minutes: number | null;
  is_minor: boolean;
}

export interface SchedulePeriodResponse {
  id: string;
  start_date: string;
  end_date: string;
  status: "collecting" | "building" | "published";
  submission_deadline: number;
  published_at: number | null;
}

export interface AvailabilityEntryResponse {
  id: string;
  work_date: string;
  kind: "available" | "day_off";
  start_minutes: number | null;
  end_minutes: number | null;
}

export interface AvailabilitySubmissionResponse {
  id: string;
  member_id: string;
  status: "draft" | "submitted";
  submitted_at: number | null;
  note: string | null;
  entries: AvailabilityEntryResponse[];
}

export interface ShiftResponse {
  id: string;
  period_id: string;
  member_id: string;
  position_id: string | null;
  work_date: string;
  start_minutes: number;
  end_minutes: number;
  break_minutes: number;
  note: string | null;
}

/**
 * What the schedule screen needs in one request. `submissions` and
 * `requirements` are the owner's grid inputs and are absent from a staff
 * response, which carries only that member's own shifts.
 */
export interface ScheduleResponse {
  period: SchedulePeriodResponse;
  published: boolean;
  shifts: ShiftResponse[];
  submissions?: AvailabilitySubmissionResponse[];
  requirements?: StaffingRequirementResponse[];
}
