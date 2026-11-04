/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * The schedule read and the shifts that make it up.
 *
 * The read is role-dependent: the owner gets the whole grid, a staff member
 * only their own shifts and only once the period is published.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  jsonInit,
  seedMember,
  seedShiftStore,
  seedStore,
  withAuth,
} from "../test-helpers";

const period = {
  start_date: "2026-09-01",
  end_date: "2026-09-15",
  submission_deadline: Date.UTC(2026, 7, 25),
};

const dayShift = {
  work_date: "2026-09-01",
  start_minutes: 540,
  end_minutes: 1020,
  break_minutes: 60,
};

async function createPeriod(token: string): Promise<string> {
  const res = await app.request(
    "/api/shift/periods",
    withAuth(token, jsonInit("POST", period)),
    env,
  );
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

async function publish(token: string, periodId: string): Promise<void> {
  await app.request(
    `/api/shift/periods/${periodId}/close-submissions`,
    withAuth(token, { method: "POST" }),
    env,
  );
  await app.request(
    `/api/shift/periods/${periodId}/publish`,
    withAuth(token, { method: "POST" }),
    env,
  );
}

function createShift(token: string, body: Record<string, unknown>) {
  return app.request(
    "/api/shift/shifts",
    withAuth(token, jsonInit("POST", body)),
    env,
  );
}

async function createShiftId(
  token: string,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await createShift(token, body);
  const parsed = (await res.json()) as { data: { id: string } };
  return parsed.data.id;
}

// ---------------------------------------------------------------------------
// POST /api/shift/shifts
// ---------------------------------------------------------------------------

describe("POST /api/shift/shifts", () => {
  it("creates a shift", async () => {
    const store = await seedShiftStore(`Shift Create ${crypto.randomUUID()}`);
    const periodId = await createPeriod(store.session_token);

    const res = await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
      note: "遅れて入る",
    });

    expect(res.status).toBe(201);

    // The response echoes the request, so read it back: this is what proves
    // the columns were actually stored rather than defaulted.
    const schedule = await app.request(
      `/api/shift/schedule/${periodId}`,
      withAuth(store.session_token),
      env,
    );
    const body = (await schedule.json()) as {
      data: {
        shifts: {
          work_date: string;
          break_minutes: number;
          note: string | null;
        }[];
      };
    };
    expect(body.data.shifts).toHaveLength(1);
    expect(body.data.shifts[0]).toMatchObject({
      work_date: "2026-09-01",
      start_minutes: 540,
      end_minutes: 1020,
      break_minutes: 60,
      note: "遅れて入る",
    });
  });

  it("returns 400 for a date outside the period", async () => {
    const store = await seedShiftStore(`Shift Outside ${crypto.randomUUID()}`);
    const periodId = await createPeriod(store.session_token);

    const res = await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
      work_date: "2026-09-20",
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for a break as long as the shift", async () => {
    const store = await seedShiftStore(`Shift Break ${crypto.randomUUID()}`);
    const periodId = await createPeriod(store.session_token);

    const res = await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
      break_minutes: 480,
    });

    expect(res.status).toBe(400);
  });

  it("returns 409 when the member is already working then", async () => {
    const store = await seedShiftStore(`Shift Overlap ${crypto.randomUUID()}`);
    const periodId = await createPeriod(store.session_token);
    await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
    });

    const res = await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
      start_minutes: 960, // 16:00, inside the 09:00-17:00 shift
      end_minutes: 1260,
      break_minutes: 0,
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("allows a back-to-back shift and a colleague at the same time", async () => {
    const store = await seedShiftStore(`Shift Adjacent ${crypto.randomUUID()}`);
    const colleague = await seedMember(store.id);
    const periodId = await createPeriod(store.session_token);
    await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
    });

    const adjacent = await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
      start_minutes: 1020, // starts exactly when the first ends
      end_minutes: 1200,
      break_minutes: 0,
    });
    expect(adjacent.status).toBe(201);

    const sameTime = await createShift(store.session_token, {
      period_id: periodId,
      member_id: colleague.member_id,
      ...dayShift,
    });
    expect(sameTime.status).toBe(201);
  });

  it("catches an overnight shift running into the next morning", async () => {
    const store = await seedShiftStore(
      `Shift Overnight ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);
    await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      work_date: "2026-09-01",
      start_minutes: 1320, // 22:00
      end_minutes: 1560, // 02:00 next day
      break_minutes: 0,
    });

    const res = await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      work_date: "2026-09-02",
      start_minutes: 60, // 01:00 — still inside the overnight shift
      end_minutes: 540,
      break_minutes: 0,
    });

    expect(res.status).toBe(409);
  });

  it("returns 404 for another store's period, member or position", async () => {
    const storeA = await seedShiftStore(`Shift Refs A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Shift Refs B ${crypto.randomUUID()}`);
    const periodA = await createPeriod(storeA.session_token);
    const periodB = await createPeriod(storeB.session_token);
    const positionRes = await app.request(
      "/api/shift/positions",
      withAuth(storeA.session_token, jsonInit("POST", { name: "ホール" })),
      env,
    );
    const { data: positionA } = (await positionRes.json()) as {
      data: { id: string };
    };

    const foreignPeriod = await createShift(storeB.session_token, {
      period_id: periodA,
      member_id: storeB.member_id,
      ...dayShift,
    });
    expect(foreignPeriod.status).toBe(404);

    const foreignMember = await createShift(storeB.session_token, {
      period_id: periodB,
      member_id: storeA.member_id,
      ...dayShift,
    });
    expect(foreignMember.status).toBe(404);

    const foreignPosition = await createShift(storeB.session_token, {
      period_id: periodB,
      member_id: storeB.member_id,
      position_id: positionA.id,
      ...dayShift,
    });
    expect(foreignPosition.status).toBe(404);
  });

  it("returns 403 for a staff session in the same store", async () => {
    const store = await seedShiftStore(`Shift Staff ${crypto.randomUUID()}`);
    const colleague = await seedMember(store.id, "staff");
    const periodId = await createPeriod(store.session_token);

    const res = await createShift(colleague.session_token, {
      period_id: periodId,
      member_id: colleague.member_id,
      ...dayShift,
    });

    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    const res = await app.request(
      "/api/shift/shifts",
      jsonInit("POST", { period_id: crypto.randomUUID() }),
      env,
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for a store without the shift product", async () => {
    const store = await seedStore(`Shift No Product ${crypto.randomUUID()}`);

    const res = await createShift(store.session_token, {
      period_id: crypto.randomUUID(),
      member_id: store.member_id,
      ...dayShift,
    });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH / DELETE
// ---------------------------------------------------------------------------

describe("PATCH and DELETE /api/shift/shifts/:id", () => {
  it("updates a shift without conflicting with itself", async () => {
    const store = await seedShiftStore(`Shift Update ${crypto.randomUUID()}`);
    const periodId = await createPeriod(store.session_token);
    const shiftId = await createShiftId(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
    });

    const res = await app.request(
      `/api/shift/shifts/${shiftId}`,
      withAuth(
        store.session_token,
        jsonInit("PATCH", {
          period_id: periodId,
          member_id: store.member_id,
          ...dayShift,
          end_minutes: 1080,
        }),
      ),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { end_minutes: number } };
    expect(body.data.end_minutes).toBe(1080);
  });

  it("returns 409 when an update collides with another shift", async () => {
    const store = await seedShiftStore(
      `Shift Update Clash ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);
    await createShiftId(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
    });
    const evening = await createShiftId(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
      start_minutes: 1080,
      end_minutes: 1320,
      break_minutes: 0,
    });

    const res = await app.request(
      `/api/shift/shifts/${evening}`,
      withAuth(
        store.session_token,
        jsonInit("PATCH", {
          period_id: periodId,
          member_id: store.member_id,
          ...dayShift,
          start_minutes: 900, // backs into the 09:00-17:00 shift
          end_minutes: 1320,
          break_minutes: 0,
        }),
      ),
      env,
    );

    expect(res.status).toBe(409);
  });

  it("returns 404 updating another store's shift, and leaves it untouched", async () => {
    // Store B sends its own period and member, so the only guard left is the
    // store_id clause on the update itself.
    const storeA = await seedShiftStore(`Shift Patch A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Shift Patch B ${crypto.randomUUID()}`);
    const periodA = await createPeriod(storeA.session_token);
    const periodB = await createPeriod(storeB.session_token);
    const victim = await createShiftId(storeA.session_token, {
      period_id: periodA,
      member_id: storeA.member_id,
      ...dayShift,
    });

    const res = await app.request(
      `/api/shift/shifts/${victim}`,
      withAuth(
        storeB.session_token,
        jsonInit("PATCH", {
          period_id: periodB,
          member_id: storeB.member_id,
          ...dayShift,
          end_minutes: 1200,
        }),
      ),
      env,
    );
    expect(res.status).toBe(404);

    const schedule = await app.request(
      `/api/shift/schedule/${periodA}`,
      withAuth(storeA.session_token),
      env,
    );
    const body = (await schedule.json()) as {
      data: { shifts: { member_id: string; end_minutes: number }[] };
    };
    expect(body.data.shifts).toHaveLength(1);
    expect(body.data.shifts[0]?.member_id).toBe(storeA.member_id);
    expect(body.data.shifts[0]?.end_minutes).toBe(1020);
  });

  it("returns 404 updating a shift that does not exist", async () => {
    const store = await seedShiftStore(
      `Shift Patch Ghost ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);
    await createShiftId(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
    });

    // A body that would collide with the caller's own shift: the answer is
    // still "no such shift", not a conflict report about a different one.
    const res = await app.request(
      `/api/shift/shifts/${crypto.randomUUID()}`,
      withAuth(
        store.session_token,
        jsonInit("PATCH", {
          period_id: periodId,
          member_id: store.member_id,
          ...dayShift,
        }),
      ),
      env,
    );

    expect(res.status).toBe(404);
  });

  it("deletes a shift and 404s on another store's", async () => {
    const storeA = await seedShiftStore(
      `Shift Delete A ${crypto.randomUUID()}`,
    );
    const storeB = await seedShiftStore(
      `Shift Delete B ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(storeA.session_token);
    const shiftId = await createShiftId(storeA.session_token, {
      period_id: periodId,
      member_id: storeA.member_id,
      ...dayShift,
    });

    const foreign = await app.request(
      `/api/shift/shifts/${shiftId}`,
      withAuth(storeB.session_token, { method: "DELETE" }),
      env,
    );
    expect(foreign.status).toBe(404);

    const own = await app.request(
      `/api/shift/shifts/${shiftId}`,
      withAuth(storeA.session_token, { method: "DELETE" }),
      env,
    );
    expect(own.status).toBe(200);

    const again = await app.request(
      `/api/shift/shifts/${shiftId}`,
      withAuth(storeA.session_token, { method: "DELETE" }),
      env,
    );
    expect(again.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/shift/schedule/:periodId
// ---------------------------------------------------------------------------

describe("GET /api/shift/schedule/:periodId", () => {
  it("gives the owner every shift plus the grid's inputs", async () => {
    const store = await seedShiftStore(`Schedule Owner ${crypto.randomUUID()}`);
    const colleague = await seedMember(store.id);
    const periodId = await createPeriod(store.session_token);
    await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
    });
    await createShift(store.session_token, {
      period_id: periodId,
      member_id: colleague.member_id,
      ...dayShift,
    });
    await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(
        store.session_token,
        jsonInit("PUT", {
          submit: true,
          entries: [{ work_date: "2026-09-02", kind: "day_off" }],
        }),
      ),
      env,
    );

    const res = await app.request(
      `/api/shift/schedule/${periodId}`,
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        published: boolean;
        shifts: { member_id: string }[];
        submissions: { member_id: string; entries: unknown[] }[];
        requirements: unknown[];
      };
    };
    expect(body.data.published).toBe(false);
    expect(body.data.shifts).toHaveLength(2);
    expect(body.data.submissions).toHaveLength(1);
    expect(body.data.submissions[0]?.entries).toHaveLength(1);
    expect(body.data.requirements).toEqual([]);
  });

  it("scopes requirements and shifts to this store and this period", async () => {
    const storeA = await seedShiftStore(
      `Schedule Scope A ${crypto.randomUUID()}`,
    );
    const storeB = await seedShiftStore(
      `Schedule Scope B ${crypto.randomUUID()}`,
    );
    const firstPeriod = await createPeriod(storeA.session_token);

    const secondRes = await app.request(
      "/api/shift/periods",
      withAuth(
        storeA.session_token,
        jsonInit("POST", {
          ...period,
          start_date: "2026-09-16",
          end_date: "2026-09-30",
        }),
      ),
      env,
    );
    const { data: second } = (await secondRes.json()) as {
      data: { id: string };
    };

    await createShift(storeA.session_token, {
      period_id: firstPeriod,
      member_id: storeA.member_id,
      ...dayShift,
    });
    await createShift(storeA.session_token, {
      period_id: second.id,
      member_id: storeA.member_id,
      ...dayShift,
      work_date: "2026-09-16",
    });

    for (const store of [storeA, storeB]) {
      const positionRes = await app.request(
        "/api/shift/positions",
        withAuth(store.session_token, jsonInit("POST", { name: "ホール" })),
        env,
      );
      const { data: position } = (await positionRes.json()) as {
        data: { id: string };
      };
      await app.request(
        "/api/shift/templates/requirements",
        withAuth(
          store.session_token,
          jsonInit("POST", {
            weekday: 2,
            position_id: position.id,
            start_minutes: 1020,
            end_minutes: 1320,
            required_headcount: store === storeA ? 2 : 9,
          }),
        ),
        env,
      );
    }

    const res = await app.request(
      `/api/shift/schedule/${firstPeriod}`,
      withAuth(storeA.session_token),
      env,
    );
    const body = (await res.json()) as {
      data: {
        shifts: { work_date: string }[];
        requirements: { required_headcount: number }[];
      };
    };
    // Only the first period's shift, and only this store's requirement.
    expect(body.data.shifts.map((s) => s.work_date)).toEqual(["2026-09-01"]);
    expect(body.data.requirements).toHaveLength(1);
    expect(body.data.requirements[0]?.required_headcount).toBe(2);
  });

  it("returns 403 for a store without the shift product", async () => {
    // The schedule router carries its own entitlement gate.
    const store = await seedStore(`Schedule No Product ${crypto.randomUUID()}`);

    const res = await app.request(
      `/api/shift/schedule/${crypto.randomUUID()}`,
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("hides an unpublished schedule from staff without erroring", async () => {
    const store = await seedShiftStore(`Schedule Draft ${crypto.randomUUID()}`);
    const colleague = await seedMember(store.id);
    const periodId = await createPeriod(store.session_token);
    await createShift(store.session_token, {
      period_id: periodId,
      member_id: colleague.member_id,
      ...dayShift,
    });

    const res = await app.request(
      `/api/shift/schedule/${periodId}`,
      withAuth(colleague.session_token),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { published: boolean; shifts: unknown[] };
    };
    expect(body.data.published).toBe(false);
    expect(body.data.shifts).toEqual([]);
  });

  it("shows a staff member only their own shifts once published", async () => {
    const store = await seedShiftStore(
      `Schedule Published ${crypto.randomUUID()}`,
    );
    const colleague = await seedMember(store.id);
    const periodId = await createPeriod(store.session_token);
    await createShift(store.session_token, {
      period_id: periodId,
      member_id: store.member_id,
      ...dayShift,
    });
    await createShift(store.session_token, {
      period_id: periodId,
      member_id: colleague.member_id,
      ...dayShift,
      work_date: "2026-09-02",
    });
    await publish(store.session_token, periodId);

    const res = await app.request(
      `/api/shift/schedule/${periodId}`,
      withAuth(colleague.session_token),
      env,
    );

    const body = (await res.json()) as {
      data: {
        published: boolean;
        shifts: { member_id: string; work_date: string }[];
        submissions?: unknown[];
      };
    };
    expect(body.data.published).toBe(true);
    expect(body.data.shifts).toHaveLength(1);
    expect(body.data.shifts[0]?.member_id).toBe(colleague.member_id);
    // Availability is the owner's view; a staff response must not carry it.
    expect(body.data.submissions).toBeUndefined();
  });

  it("returns 404 for another store's period", async () => {
    const storeA = await seedShiftStore(`Schedule A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Schedule B ${crypto.randomUUID()}`);
    const periodId = await createPeriod(storeA.session_token);

    const res = await app.request(
      `/api/shift/schedule/${periodId}`,
      withAuth(storeB.session_token),
      env,
    );

    expect(res.status).toBe(404);
  });

  it("returns 401 without a session", async () => {
    const res = await app.request(
      `/api/shift/schedule/${crypto.randomUUID()}`,
      {},
      env,
    );
    expect(res.status).toBe(401);
  });
});
