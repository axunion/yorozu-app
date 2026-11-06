import { describe, expect, it } from "vitest";
import {
  absoluteRange,
  availabilityWarnings,
  coverage,
  dayAvailability,
  estimatedLaborCost,
  halfMonthPeriod,
  laborWarnings,
  lateNightMinutes,
  overlaps,
  periodDates,
  workedMinutes,
} from "./shift";

const shift = (
  overrides: Partial<Parameters<typeof workedMinutes>[0]> = {},
) => ({
  member_id: "m1",
  position_id: null,
  work_date: "2026-09-01",
  start_minutes: 540, // 09:00
  end_minutes: 1020, // 17:00
  break_minutes: 60,
  ...overrides,
});

const profile = (
  overrides: Partial<{
    member_id: string;
    hourly_wage: number | null;
    weekly_cap_minutes: number | null;
    is_minor: boolean;
  }> = {},
) => ({
  member_id: "m1",
  hourly_wage: 1000,
  weekly_cap_minutes: null,
  is_minor: false,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

describe("halfMonthPeriod", () => {
  it("returns the first half for the 1st and the 15th", () => {
    expect(halfMonthPeriod("2026-09-01")).toEqual({
      start_date: "2026-09-01",
      end_date: "2026-09-15",
    });
    expect(halfMonthPeriod("2026-09-15")).toEqual({
      start_date: "2026-09-01",
      end_date: "2026-09-15",
    });
  });

  it("returns the second half for the 16th and the month's last day", () => {
    expect(halfMonthPeriod("2026-09-16")).toEqual({
      start_date: "2026-09-16",
      end_date: "2026-09-30",
    });
    expect(halfMonthPeriod("2026-09-30")).toEqual({
      start_date: "2026-09-16",
      end_date: "2026-09-30",
    });
  });

  it("ends the second half on the 28th or 29th in February", () => {
    expect(halfMonthPeriod("2026-02-20").end_date).toBe("2026-02-28");
    expect(halfMonthPeriod("2028-02-20").end_date).toBe("2028-02-29");
  });

  it("rejects a calendar-invalid date", () => {
    expect(() => halfMonthPeriod("2026-02-30")).toThrow();
  });
});

describe("periodDates", () => {
  it("lists every day of a half-month, inclusive", () => {
    const first = periodDates("2026-09-01", "2026-09-15");
    expect(first).toHaveLength(15);
    expect(first[0]).toBe("2026-09-01");
    expect(first[14]).toBe("2026-09-15");

    expect(periodDates("2026-09-16", "2026-09-30")).toHaveLength(15);
    expect(periodDates("2026-08-16", "2026-08-31")).toHaveLength(16);
  });

  it("crosses a month boundary and a leap day", () => {
    expect(periodDates("2028-02-27", "2028-03-01")).toEqual([
      "2028-02-27",
      "2028-02-28",
      "2028-02-29",
      "2028-03-01",
    ]);
  });

  it("returns a single day when start and end are the same", () => {
    expect(periodDates("2026-09-05", "2026-09-05")).toEqual(["2026-09-05"]);
  });

  it("throws when the end precedes the start", () => {
    expect(() => periodDates("2026-09-15", "2026-09-01")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Single-shift arithmetic
// ---------------------------------------------------------------------------

describe("workedMinutes", () => {
  it("subtracts the break", () => {
    expect(workedMinutes(shift())).toBe(420);
  });

  it("counts the full span of an overnight shift", () => {
    expect(
      workedMinutes(
        shift({ start_minutes: 1260, end_minutes: 1500, break_minutes: 0 }),
      ),
    ).toBe(240);
  });
});

describe("absoluteRange and overlaps", () => {
  it("places an overnight shift ahead of the next morning, not across it", () => {
    const night = shift({
      work_date: "2026-09-01",
      start_minutes: 1260, // 21:00
      end_minutes: 1500, // 01:00 next day
    });
    const morning = shift({
      work_date: "2026-09-02",
      start_minutes: 60, // 01:00
      end_minutes: 540,
    });

    // The night shift ends exactly when the morning one starts: adjacent.
    expect(absoluteRange(night).to).toBe(absoluteRange(morning).from);
    expect(overlaps(night, morning)).toBe(false);
  });

  it("detects an overnight shift running into the next morning", () => {
    const night = shift({
      work_date: "2026-09-01",
      start_minutes: 1320,
      end_minutes: 1560, // 02:00 next day
    });
    const morning = shift({
      work_date: "2026-09-02",
      start_minutes: 60, // 01:00 — inside the night shift
      end_minutes: 540,
    });

    expect(overlaps(night, morning)).toBe(true);
  });

  it("treats touching shifts on one day as adjacent, not overlapping", () => {
    const early = shift({ start_minutes: 540, end_minutes: 780 });
    const late = shift({ start_minutes: 780, end_minutes: 1020 });

    expect(overlaps(early, late)).toBe(false);
    expect(
      overlaps(early, shift({ start_minutes: 779, end_minutes: 1020 })),
    ).toBe(true);
  });

  it("is independent of argument order", () => {
    const a = shift({ start_minutes: 540, end_minutes: 900 });
    const b = shift({ start_minutes: 780, end_minutes: 1020 });

    expect(overlaps(a, b)).toBe(overlaps(b, a));
    expect(overlaps(a, b)).toBe(true);
  });
});

describe("lateNightMinutes", () => {
  it("returns 0 for a shift wholly outside 22:00-05:00", () => {
    expect(lateNightMinutes(shift())).toBe(0);
  });

  it("counts the part after 22:00", () => {
    // 20:00 -> 23:30 = 90 minutes in the band.
    expect(
      lateNightMinutes(shift({ start_minutes: 1200, end_minutes: 1410 })),
    ).toBe(90);
  });

  it("counts the part before 05:00", () => {
    // 04:00 -> 09:00 = 60 minutes in the band.
    expect(
      lateNightMinutes(shift({ start_minutes: 240, end_minutes: 540 })),
    ).toBe(60);
  });

  it("counts both bands for an overnight shift", () => {
    // 21:00 -> 06:00 next day: 22:00-05:00 is fully inside = 420 minutes.
    expect(
      lateNightMinutes(shift({ start_minutes: 1260, end_minutes: 1800 })),
    ).toBe(420);
  });

  it("counts both ends of the day for a shift spanning them", () => {
    // 04:00 -> 23:00 touches the early band (60) and the late one (60).
    expect(
      lateNightMinutes(shift({ start_minutes: 240, end_minutes: 1380 })),
    ).toBe(120);
  });

  it("counts the second night of a shift that runs a full 24 hours", () => {
    // 23:00 -> 23:00 the next day: 23:00-05:00 (360) plus 22:00-23:00 (60).
    expect(
      lateNightMinutes(shift({ start_minutes: 1380, end_minutes: 2820 })),
    ).toBe(420);
  });

  it("counts nothing for a shift ending exactly at 22:00", () => {
    expect(
      lateNightMinutes(shift({ start_minutes: 1080, end_minutes: 1320 })),
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Labour-law warnings
// ---------------------------------------------------------------------------

describe("laborWarnings", () => {
  const codes = (
    shifts: Parameters<typeof laborWarnings>[0],
    profiles: Parameters<typeof laborWarnings>[1] = [profile()],
  ) => laborWarnings(shifts, profiles).map((w) => w.code);

  it("returns nothing for an ordinary 8-hour day", () => {
    // 09:00-18:00 with a 60-minute break is exactly 8 hours worked.
    expect(codes([shift({ start_minutes: 540, end_minutes: 1080 })])).toEqual(
      [],
    );
  });

  it("warns past 8 hours in a day, not at exactly 8", () => {
    const exactly = shift({
      start_minutes: 540,
      end_minutes: 1080,
      break_minutes: 60,
    });
    const oneMinuteMore = shift({
      start_minutes: 540,
      end_minutes: 1081,
      break_minutes: 60,
    });

    expect(codes([exactly])).not.toContain("DAILY_OVER_8H");
    expect(codes([oneMinuteMore])).toContain("DAILY_OVER_8H");
  });

  it("sums two shifts on the same day before judging the daily limit", () => {
    const morning = shift({
      start_minutes: 300,
      end_minutes: 600,
      break_minutes: 0,
    }); // 5h
    const evening = shift({
      start_minutes: 720,
      end_minutes: 990,
      break_minutes: 0,
    }); // 4h30

    expect(codes([morning, evening])).toContain("DAILY_OVER_8H");
  });

  it("requires a 45-minute break past 6 hours", () => {
    const sixHours = shift({
      start_minutes: 540,
      end_minutes: 900,
      break_minutes: 0,
    }); // exactly 6h
    const justOver = shift({
      start_minutes: 540,
      end_minutes: 945,
      break_minutes: 44,
    }); // 361 minutes worked, one minute past the threshold

    expect(codes([sixHours])).not.toContain("BREAK_REQUIRED_45");
    expect(codes([justOver])).toContain("BREAK_REQUIRED_45");
  });

  it("stays silent when the required break is exactly met", () => {
    const sixPlus = shift({
      start_minutes: 540,
      end_minutes: 946,
      break_minutes: 45,
    }); // 361 worked
    const eightPlus = shift({
      start_minutes: 540,
      end_minutes: 1141,
      break_minutes: 60,
    }); // 541 worked

    expect(codes([sixPlus])).not.toContain("BREAK_REQUIRED_45");
    expect(codes([eightPlus])).not.toContain("BREAK_REQUIRED_60");
  });

  it("does not require the 60-minute break at exactly 8 hours worked", () => {
    const exactly = shift({
      start_minutes: 540,
      end_minutes: 1079,
      break_minutes: 59,
    }); // 480 worked, the proposal's 8h00-with-59-minutes case

    expect(codes([exactly])).not.toContain("BREAK_REQUIRED_60");
  });

  it("requires a 60-minute break past 8 hours", () => {
    const justOver = shift({
      start_minutes: 540,
      end_minutes: 1081,
      break_minutes: 59,
    });

    const result = codes([justOver]);
    expect(result).toContain("BREAK_REQUIRED_60");
    // The 45-minute rule is subsumed; only the binding one is reported.
    expect(result).not.toContain("BREAK_REQUIRED_45");
  });

  it("warns past 40 hours in a Monday-Sunday week", () => {
    // 2026-08-31 is a Monday. Six 7-hour days = 42 hours.
    const week = [
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ].map((work_date) =>
      shift({
        work_date,
        start_minutes: 540,
        end_minutes: 1020,
        break_minutes: 60,
      }),
    );

    expect(codes(week)).toContain("WEEKLY_OVER_40H");
  });

  it("warns past 40 hours in a week, not at exactly 40", () => {
    // Five days of exactly 8 hours = 2400 minutes, then one minute more.
    const week = (extra: number) =>
      [
        "2026-08-31",
        "2026-09-01",
        "2026-09-02",
        "2026-09-03",
        "2026-09-04",
      ].map((work_date, index) =>
        shift({
          work_date,
          start_minutes: 540,
          end_minutes: 1020 + (index === 0 ? extra : 0),
          break_minutes: 0,
        }),
      );

    expect(codes(week(0))).not.toContain("WEEKLY_OVER_40H");
    expect(codes(week(1))).toContain("WEEKLY_OVER_40H");
  });

  it("splits weeks at Monday, so the same days across a boundary do not add up", () => {
    // Sunday 2026-08-30 and Monday 2026-08-31 fall in different weeks.
    const longDay = (work_date: string) =>
      shift({
        work_date,
        start_minutes: 300,
        end_minutes: 1740,
        break_minutes: 60,
      }); // 23h — enough that two in one week would trip the weekly rule

    expect(codes([longDay("2026-08-30"), longDay("2026-08-31")])).not.toContain(
      "WEEKLY_OVER_40H",
    );
  });

  it("warns when a member works all seven days of a week", () => {
    const week = [
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ].map((work_date) =>
      shift({ work_date, start_minutes: 540, end_minutes: 780 }),
    );

    expect(codes(week)).toContain("NO_REST_DAY");
    expect(codes(week.slice(0, 6))).not.toContain("NO_REST_DAY");
  });

  it("warns over, but not at, a member's weekly cap", () => {
    const capped = [profile({ weekly_cap_minutes: 600 })];
    const minutes = (work_date: string, worked: number) =>
      shift({
        work_date,
        start_minutes: 540,
        end_minutes: 540 + worked,
        break_minutes: 0,
      });

    expect(codes([minutes("2026-08-31", 360)], capped)).not.toContain(
      "OVER_WEEKLY_CAP",
    );
    // Exactly at the cap is allowed; one minute past it is not.
    expect(codes([minutes("2026-08-31", 600)], capped)).not.toContain(
      "OVER_WEEKLY_CAP",
    );
    expect(codes([minutes("2026-08-31", 601)], capped)).toContain(
      "OVER_WEEKLY_CAP",
    );
  });

  it("warns when a minor is scheduled into the late-night band", () => {
    const minors = [profile({ is_minor: true })];
    const night = shift({ start_minutes: 1200, end_minutes: 1400 });

    expect(codes([night], minors)).toContain("MINOR_LATE_NIGHT");
    expect(codes([night])).not.toContain("MINOR_LATE_NIGHT");
    expect(codes([shift()], minors)).not.toContain("MINOR_LATE_NIGHT");
  });

  it("names the member and the day a warning belongs to", () => {
    const warnings = laborWarnings(
      [shift({ work_date: "2026-09-02", end_minutes: 1081 })],
      [profile()],
    );
    const daily = warnings.find((w) => w.code === "DAILY_OVER_8H");

    expect(daily?.member_id).toBe("m1");
    expect(daily?.work_date).toBe("2026-09-02");
  });

  it("judges each member separately", () => {
    const long = { start_minutes: 540, end_minutes: 1081, break_minutes: 60 };
    const warnings = laborWarnings(
      [shift({ member_id: "m1", ...long }), shift({ member_id: "m2" })],
      [profile({ member_id: "m1" }), profile({ member_id: "m2" })],
    );

    expect(warnings.map((w) => w.member_id)).toEqual(["m1"]);
  });

  it("still judges a member who has no work profile", () => {
    // A profile carries the wage, cap and minor flag; its absence must not
    // silence the limits that apply to everyone.
    const long = shift({
      member_id: "unknown",
      start_minutes: 540,
      end_minutes: 1200,
      break_minutes: 60,
    }); // 600 worked, in the late-night band from 22:00

    const result = laborWarnings([long], []);

    expect(result.map((w) => w.code)).toContain("DAILY_OVER_8H");
    expect(result.map((w) => w.code)).not.toContain("MINOR_LATE_NIGHT");
  });

  it("omits work_date on warnings that span a whole week", () => {
    const week = [
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ].map((work_date) =>
      shift({ work_date, start_minutes: 540, end_minutes: 780 }),
    );

    for (const warning of laborWarnings(week, [profile()])) {
      if (warning.code === "NO_REST_DAY") {
        expect(warning.work_date).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

describe("coverage", () => {
  // 2026-09-01 is a Tuesday (weekday 2).
  const requirement = {
    weekday: 2,
    position_id: "hall",
    start_minutes: 1020, // 17:00
    end_minutes: 1320, // 22:00
    required_headcount: 2,
  };

  it("reports a shortage when fewer people are scheduled than required", () => {
    const rows = coverage(
      [shift({ position_id: "hall", start_minutes: 1020, end_minutes: 1320 })],
      [requirement],
      ["2026-09-01"],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      work_date: "2026-09-01",
      position_id: "hall",
      required: 2,
      assigned: 1,
    });
  });

  it("reports an exact match and a surplus", () => {
    const staffed = (member_id: string) =>
      shift({
        member_id,
        position_id: "hall",
        start_minutes: 1020,
        end_minutes: 1320,
      });

    expect(
      coverage([staffed("m1"), staffed("m2")], [requirement], ["2026-09-01"])[0]
        ?.assigned,
    ).toBe(2);
    expect(
      coverage(
        [staffed("m1"), staffed("m2"), staffed("m3")],
        [requirement],
        ["2026-09-01"],
      )[0]?.assigned,
    ).toBe(3);
  });

  it("counts only shifts of the matching position", () => {
    const rows = coverage(
      [
        shift({
          position_id: "kitchen",
          start_minutes: 1020,
          end_minutes: 1320,
        }),
      ],
      [requirement],
      ["2026-09-01"],
    );

    expect(rows[0]?.assigned).toBe(0);
  });

  it("counts only shifts that overlap the band", () => {
    const before = shift({
      position_id: "hall",
      start_minutes: 540,
      end_minutes: 1020, // ends exactly when the band opens
    });

    expect(coverage([before], [requirement], ["2026-09-01"])[0]?.assigned).toBe(
      0,
    );
  });

  it("counts a shift that only partly covers the band", () => {
    const partial = shift({
      position_id: "hall",
      start_minutes: 960, // 16:00, before the band opens
      end_minutes: 1080, // 18:00, one hour into it
    });

    const rows = coverage([partial], [requirement], ["2026-09-01"]);
    expect(rows[0]?.assigned).toBe(1);
    // The row describes the requirement's band, not the shift's.
    expect(rows[0]?.start_minutes).toBe(1020);
    expect(rows[0]?.end_minutes).toBe(1320);
  });

  it("applies a requirement only to its own weekday", () => {
    const rows = coverage(
      [
        shift({
          work_date: "2026-09-02", // Wednesday
          position_id: "hall",
          start_minutes: 1020,
          end_minutes: 1320,
        }),
      ],
      [requirement],
      ["2026-09-02"],
    );

    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Labour cost
// ---------------------------------------------------------------------------

describe("estimatedLaborCost", () => {
  it("totals wage times worked hours, per day and per member", () => {
    const result = estimatedLaborCost(
      [
        shift({ member_id: "m1", work_date: "2026-09-01" }), // 7h @1000
        shift({ member_id: "m2", work_date: "2026-09-01" }), // 7h @1500
      ],
      [
        profile({ member_id: "m1", hourly_wage: 1000 }),
        profile({ member_id: "m2", hourly_wage: 1500 }),
      ],
    );

    expect(result.total).toBe(7000 + 10500);
    expect(result.per_date["2026-09-01"]).toBe(17500);
    expect(result.per_member.m1).toBe(7000);
    expect(result.per_member.m2).toBe(10500);
  });

  it("excludes a member with no wage rather than counting them as free", () => {
    const result = estimatedLaborCost(
      [shift({ member_id: "m1" }), shift({ member_id: "m2" })],
      [
        profile({ member_id: "m1", hourly_wage: 1000 }),
        profile({ member_id: "m2", hourly_wage: null }),
      ],
    );

    expect(result.total).toBe(7000);
    expect(result.per_member.m2).toBeUndefined();
    expect(result.unpriced_member_ids).toEqual(["m2"]);
  });

  it("treats a member with no profile as unpriced", () => {
    const result = estimatedLaborCost([shift({ member_id: "ghost" })], []);

    expect(result.total).toBe(0);
    expect(result.unpriced_member_ids).toEqual(["ghost"]);
  });

  it("rounds to whole yen", () => {
    // 1000 JPY/h over 90 minutes = 1500 JPY exactly; 1001 over 50 minutes
    // is 834.166… which must not leak a fraction into a JPY total.
    const result = estimatedLaborCost(
      [
        shift({
          start_minutes: 540,
          end_minutes: 590,
          break_minutes: 0,
        }),
      ],
      [profile({ hourly_wage: 1001 })],
    );

    expect(result.total).toBe(834); // 1001 x 50 / 60 = 834.166…, rounded
  });

  it("accumulates per_date across days and lists an unpriced member once", () => {
    const result = estimatedLaborCost(
      [
        shift({ member_id: "m1", work_date: "2026-09-01" }),
        shift({ member_id: "m1", work_date: "2026-09-02" }),
        shift({ member_id: "m2", work_date: "2026-09-01" }),
        shift({ member_id: "m2", work_date: "2026-09-02" }),
      ],
      [
        profile({ member_id: "m1", hourly_wage: 1200 }),
        profile({ member_id: "m2", hourly_wage: null }),
      ],
    );

    expect(result.per_date["2026-09-01"]).toBe(8400);
    expect(result.per_date["2026-09-02"]).toBe(8400);
    expect(result.per_member.m1).toBe(16800);
    expect(result.unpriced_member_ids).toEqual(["m2"]);
  });
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

const submitted = (
  entries: {
    work_date: string;
    kind: "available" | "day_off";
    start_minutes: number | null;
    end_minutes: number | null;
  }[],
  overrides: Partial<{ member_id: string; status: "draft" | "submitted" }> = {},
) => ({ member_id: "m1", status: "submitted" as const, entries, ...overrides });

const band = (work_date: string, start: number, end: number) => ({
  work_date,
  kind: "available" as const,
  start_minutes: start,
  end_minutes: end,
});

const dayOff = (work_date: string) => ({
  work_date,
  kind: "day_off" as const,
  start_minutes: null,
  end_minutes: null,
});

describe("dayAvailability", () => {
  it("reads a submitted band, a day off, and a blank date as undecided", () => {
    const subs = [
      submitted([band("2026-09-01", 600, 900), dayOff("2026-09-02")]),
    ];
    expect(dayAvailability(subs, "m1", "2026-09-01")).toEqual({
      kind: "available",
      bands: [{ start_minutes: 600, end_minutes: 900 }],
    });
    expect(dayAvailability(subs, "m1", "2026-09-02")).toEqual({
      kind: "day_off",
    });
    expect(dayAvailability(subs, "m1", "2026-09-03")).toEqual({
      kind: "undecided",
    });
  });

  it("treats a draft, or no submission at all, as not submitted", () => {
    const subs = [submitted([dayOff("2026-09-01")], { status: "draft" })];
    expect(dayAvailability(subs, "m1", "2026-09-01").kind).toBe(
      "not_submitted",
    );
    expect(dayAvailability(subs, "m2", "2026-09-01").kind).toBe(
      "not_submitted",
    );
  });
});

describe("availabilityWarnings", () => {
  it("warns about a shift on a requested day off", () => {
    expect(
      availabilityWarnings([shift()], [submitted([dayOff("2026-09-01")])]),
    ).toEqual([
      {
        code: "ON_REQUESTED_DAY_OFF",
        member_id: "m1",
        work_date: "2026-09-01",
      },
    ]);
  });

  it("warns when a shift is not inside any submitted band, and not when it is", () => {
    // 09:00–17:00 against 10:00–22:00: starts an hour early.
    expect(
      availabilityWarnings(
        [shift()],
        [submitted([band("2026-09-01", 600, 1320)])],
      ),
    ).toEqual([
      {
        code: "OUTSIDE_AVAILABLE_BAND",
        member_id: "m1",
        work_date: "2026-09-01",
      },
    ]);
    // Exactly the band's edges, with a second band that doesn't fit.
    expect(
      availabilityWarnings(
        [shift()],
        [
          submitted([
            band("2026-09-01", 1080, 1320),
            band("2026-09-01", 540, 1020),
          ]),
        ],
      ),
    ).toEqual([]);
  });

  it("reports a split shift on a day off once, not per shift", () => {
    const split = [
      shift({ start_minutes: 600, end_minutes: 840, break_minutes: 0 }),
      shift({ start_minutes: 1020, end_minutes: 1260, break_minutes: 0 }),
    ];
    expect(
      availabilityWarnings(split, [submitted([dayOff("2026-09-01")])]),
    ).toHaveLength(1);
  });

  it("treats touching bands as one continuous band", () => {
    const subs = [
      submitted([band("2026-09-01", 840, 1080), band("2026-09-01", 600, 840)]),
    ];
    expect(dayAvailability(subs, "m1", "2026-09-01")).toEqual({
      kind: "available",
      bands: [{ start_minutes: 600, end_minutes: 1080 }],
    });
    expect(
      availabilityWarnings(
        [shift({ start_minutes: 720, end_minutes: 960, break_minutes: 0 })],
        subs,
      ),
    ).toEqual([]);
  });

  it("raises nothing for an undecided or unsubmitted day", () => {
    expect(
      availabilityWarnings([shift()], [submitted([dayOff("2026-09-02")])]),
    ).toEqual([]);
    expect(availabilityWarnings([shift()], [])).toEqual([]);
  });
});
