/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Availability collection: a member saves their own submission, and the
 * manager reads everyone's — including who has not submitted yet, which is
 * what v1 offers instead of reminder mail.
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

const entries = [
  {
    work_date: "2026-09-01",
    kind: "available" as const,
    start_minutes: 540,
    end_minutes: 1020,
  },
  { work_date: "2026-09-02", kind: "day_off" as const },
];

async function createPeriod(token: string): Promise<string> {
  const res = await app.request(
    "/api/shift/periods",
    withAuth(token, jsonInit("POST", period)),
    env,
  );
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/**
 * Invites a staff member into an existing store. The member stays `pending`
 * until they verify their passcode — which is deliberate here: a pending
 * invitee still counts as a non-submitter in the manager's list.
 */
async function addStaff(ownerToken: string): Promise<string> {
  const res = await app.request(
    "/api/staff",
    withAuth(
      ownerToken,
      jsonInit("POST", {
        email: `shift-staff-${crypto.randomUUID()}@test.internal`,
      }),
    ),
    env,
  );
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

function save(token: string, periodId: string, body: unknown) {
  return app.request(
    `/api/shift/availability/${periodId}/me`,
    withAuth(token, jsonInit("PUT", body)),
    env,
  );
}

describe("PUT /api/shift/availability/:periodId/me", () => {
  it("saves a draft the member can read back", async () => {
    const store = await seedShiftStore(
      `Availability Save ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);

    const res = await save(store.session_token, periodId, { entries });
    expect(res.status).toBe(200);

    const read = await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(store.session_token),
      env,
    );
    const body = (await read.json()) as {
      data: {
        status: string;
        submitted_at: number | null;
        entries: { work_date: string; kind: string }[];
      };
    };
    expect(body.data.status).toBe("draft");
    expect(body.data.submitted_at).toBeNull();
    expect(body.data.entries).toHaveLength(2);
    expect(body.data.entries).toEqual([
      expect.objectContaining({
        work_date: "2026-09-01",
        kind: "available",
        start_minutes: 540,
        end_minutes: 1020,
      }),
      expect.objectContaining({
        work_date: "2026-09-02",
        kind: "day_off",
        start_minutes: null,
        end_minutes: null,
      }),
    ]);
  });

  it("marks the submission submitted and stamps submitted_at", async () => {
    const store = await seedShiftStore(
      `Availability Submit ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);

    await save(store.session_token, periodId, { submit: true, entries });

    const read = await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(store.session_token),
      env,
    );
    const body = (await read.json()) as {
      data: { status: string; submitted_at: number | null };
    };
    expect(body.data.status).toBe("submitted");
    expect(body.data.submitted_at).toBeGreaterThan(0);
  });

  it("replaces the previous entries rather than appending", async () => {
    const store = await seedShiftStore(
      `Availability Replace ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);

    await save(store.session_token, periodId, { entries });
    await save(store.session_token, periodId, {
      entries: [{ work_date: "2026-09-05", kind: "day_off" }],
    });

    const read = await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(store.session_token),
      env,
    );
    const body = (await read.json()) as {
      data: { entries: { work_date: string }[] };
    };
    expect(body.data.entries.map((e) => e.work_date)).toEqual(["2026-09-05"]);
  });

  it("returns an empty submission before anything is saved", async () => {
    const store = await seedShiftStore(
      `Availability Empty ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);

    const read = await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(store.session_token),
      env,
    );

    expect(read.status).toBe(200);
    const body = (await read.json()) as {
      data: { status: string; entries: unknown[] };
    };
    expect(body.data.status).toBe("draft");
    expect(body.data.entries).toEqual([]);
  });

  it("returns 400 for an available entry with no times", async () => {
    const store = await seedShiftStore(
      `Availability Invalid ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);

    const res = await save(store.session_token, periodId, {
      entries: [{ work_date: "2026-09-01", kind: "available" }],
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 for a date outside the period", async () => {
    const store = await seedShiftStore(
      `Availability Outside ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);

    const res = await save(store.session_token, periodId, {
      entries: [{ work_date: "2026-09-20", kind: "day_off" }],
    });

    expect(res.status).toBe(400);
  });

  it("returns 409 once submissions are closed", async () => {
    const store = await seedShiftStore(
      `Availability Closed ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);
    await app.request(
      `/api/shift/periods/${periodId}/close-submissions`,
      withAuth(store.session_token, { method: "POST" }),
      env,
    );

    const res = await save(store.session_token, periodId, { entries });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("keeps one member's submission out of another's, in the same store", async () => {
    // The store_id filter alone cannot catch this: both members are in the
    // same store, so only the member_id filter separates them.
    const store = await seedShiftStore(
      `Availability Colleagues ${crypto.randomUUID()}`,
    );
    const colleague = await seedMember(store.id);
    const periodId = await createPeriod(store.session_token);

    await save(store.session_token, periodId, { submit: true, entries });

    const theirs = await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(colleague.session_token),
      env,
    );
    const theirBody = (await theirs.json()) as {
      data: { member_id: string; status: string; entries: unknown[] };
    };
    expect(theirBody.data.member_id).toBe(colleague.member_id);
    expect(theirBody.data.status).toBe("draft");
    expect(theirBody.data.entries).toEqual([]);
  });

  it("does not let a colleague's save overwrite another member's", async () => {
    const store = await seedShiftStore(
      `Availability No Overwrite ${crypto.randomUUID()}`,
    );
    const colleague = await seedMember(store.id);
    const periodId = await createPeriod(store.session_token);

    await save(store.session_token, periodId, { submit: true, entries });
    await save(colleague.session_token, periodId, {
      entries: [{ work_date: "2026-09-10", kind: "day_off" }],
    });

    const mine = await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(store.session_token),
      env,
    );
    const body = (await mine.json()) as {
      data: { status: string; entries: { work_date: string }[] };
    };
    expect(body.data.status).toBe("submitted");
    expect(body.data.entries.map((e) => e.work_date)).toEqual([
      "2026-09-01",
      "2026-09-02",
    ]);
  });

  it("rejects a day off and an offered band on the same date", async () => {
    const store = await seedShiftStore(
      `Availability Contradiction ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);

    const res = await save(store.session_token, periodId, {
      entries: [
        {
          work_date: "2026-09-03",
          kind: "available",
          start_minutes: 540,
          end_minutes: 1020,
        },
        { work_date: "2026-09-03", kind: "day_off" },
      ],
    });

    expect(res.status).toBe(400);
  });

  it("rejects two overlapping bands on one date but accepts adjacent ones", async () => {
    const store = await seedShiftStore(
      `Availability Overlap ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);

    const overlapping = await save(store.session_token, periodId, {
      entries: [
        {
          work_date: "2026-09-03",
          kind: "available",
          start_minutes: 540,
          end_minutes: 1020,
        },
        {
          work_date: "2026-09-03",
          kind: "available",
          start_minutes: 900,
          end_minutes: 1200,
        },
      ],
    });
    expect(overlapping.status).toBe(400);

    const adjacent = await save(store.session_token, periodId, {
      entries: [
        {
          work_date: "2026-09-03",
          kind: "available",
          start_minutes: 540,
          end_minutes: 1020,
        },
        {
          work_date: "2026-09-03",
          kind: "available",
          start_minutes: 1020,
          end_minutes: 1200,
        },
      ],
    });
    expect(adjacent.status).toBe(200);
  });

  it("saves a whole half-month of bands in one request", async () => {
    // 15 entries bind more parameters than D1 allows in a single query, so
    // this fails unless the insert is chunked.
    const store = await seedShiftStore(
      `Availability Full Month ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);
    const fullMonth = Array.from({ length: 15 }, (_, index) => ({
      work_date: `2026-09-${String(index + 1).padStart(2, "0")}`,
      kind: "available" as const,
      start_minutes: 540,
      end_minutes: 1020,
    }));

    const res = await save(store.session_token, periodId, {
      submit: true,
      entries: fullMonth,
    });
    expect(res.status).toBe(200);

    const read = await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(store.session_token),
      env,
    );
    const body = (await read.json()) as { data: { entries: unknown[] } };
    expect(body.data.entries).toHaveLength(15);
  });

  it("still accepts a save after the submission deadline has passed", async () => {
    // The deadline is advisory in v1: closing submissions is the enforcement.
    const store = await seedShiftStore(
      `Availability Late ${crypto.randomUUID()}`,
    );
    const res = await app.request(
      "/api/shift/periods",
      withAuth(
        store.session_token,
        jsonInit("POST", { ...period, submission_deadline: Date.now() - 1000 }),
      ),
      env,
    );
    const { data: made } = (await res.json()) as { data: { id: string } };

    const saved = await save(store.session_token, made.id, { entries });

    expect(saved.status).toBe(200);
  });

  it("returns 404 reading another store's period", async () => {
    const storeA = await seedShiftStore(
      `Availability Read A ${crypto.randomUUID()}`,
    );
    const storeB = await seedShiftStore(
      `Availability Read B ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(storeA.session_token);

    const res = await app.request(
      `/api/shift/availability/${periodId}/me`,
      withAuth(storeB.session_token),
      env,
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 for another store's period", async () => {
    const storeA = await seedShiftStore(
      `Availability A ${crypto.randomUUID()}`,
    );
    const storeB = await seedShiftStore(
      `Availability B ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(storeA.session_token);

    const res = await save(storeB.session_token, periodId, { entries });

    expect(res.status).toBe(404);
  });

  it("returns 403 for a store without the shift product", async () => {
    const store = await seedStore(
      `Availability No Product ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      `/api/shift/availability/${crypto.randomUUID()}/me`,
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    const res = await app.request(
      `/api/shift/availability/${crypto.randomUUID()}/me`,
      {},
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/shift/availability/:periodId", () => {
  it("returns every submission plus the members who have not submitted", async () => {
    const store = await seedShiftStore(
      `Availability Overview ${crypto.randomUUID()}`,
    );
    const staffId = await addStaff(store.session_token);
    const periodId = await createPeriod(store.session_token);
    await save(store.session_token, periodId, { submit: true, entries });

    const res = await app.request(
      `/api/shift/availability/${periodId}`,
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        submissions: { member_id: string; status: string }[];
        missing_member_ids: string[];
      };
    };
    expect(body.data.submissions).toHaveLength(1);
    expect(body.data.submissions[0]?.member_id).toBe(store.member_id);
    // The invited staff member has not submitted, so they are the gap the
    // manager chases instead of a reminder email.
    expect(body.data.missing_member_ids).toEqual([staffId]);
  });

  it("counts a draft as not submitted", async () => {
    const store = await seedShiftStore(
      `Availability Draft Gap ${crypto.randomUUID()}`,
    );
    const periodId = await createPeriod(store.session_token);
    await save(store.session_token, periodId, { entries });

    const res = await app.request(
      `/api/shift/availability/${periodId}`,
      withAuth(store.session_token),
      env,
    );

    const body = (await res.json()) as {
      data: { missing_member_ids: string[] };
    };
    expect(body.data.missing_member_ids).toEqual([store.member_id]);
  });

  it("returns 403 for a staff session in the same store — one member may not read another's", async () => {
    const store = await seedShiftStore(
      `Availability Staff ${crypto.randomUUID()}`,
    );
    const colleague = await seedMember(store.id, "staff");
    const periodId = await createPeriod(store.session_token);

    const res = await app.request(
      `/api/shift/availability/${periodId}`,
      withAuth(colleague.session_token),
      env,
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 for another store's period", async () => {
    const storeA = await seedShiftStore(`Overview A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Overview B ${crypto.randomUUID()}`);
    const periodId = await createPeriod(storeA.session_token);

    const res = await app.request(
      `/api/shift/availability/${periodId}`,
      withAuth(storeB.session_token),
      env,
    );

    expect(res.status).toBe(404);
  });
});
