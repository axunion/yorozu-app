/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Schedule periods: the half-month cycle and its state machine,
 * collecting -> building -> published, with published terminal.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  grantProduct,
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

async function createPeriod(
  token: string,
  overrides: Partial<typeof period> = {},
): Promise<{ id: string; status: string }> {
  const res = await app.request(
    "/api/shift/periods",
    withAuth(token, jsonInit("POST", { ...period, ...overrides })),
    env,
  );
  const body = (await res.json()) as { data: { id: string; status: string } };
  return body.data;
}

async function advance(token: string, id: string, action: string) {
  return app.request(
    `/api/shift/periods/${id}/${action}`,
    withAuth(token, { method: "POST" }),
    env,
  );
}

describe("shift period access control", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request("/api/shift/periods", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a store without the shift product", async () => {
    const { session_token } = await seedStore(
      `Periods No Product ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/shift/periods",
      withAuth(session_token),
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when the shift subscription is suspended", async () => {
    const store = await seedStore(`Periods Suspended ${crypto.randomUUID()}`);
    await grantProduct(store.id, "shift", "suspended");

    const res = await app.request(
      "/api/shift/periods",
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(403);
  });

  it("lets a staff session read its store's periods but not create one", async () => {
    // Staff need the list to find the period they are submitting for. Using a
    // colleague in the owner's own store, so the read proves visibility rather
    // than just returning another store's empty list.
    const owner = await seedShiftStore(`Periods Owner ${crypto.randomUUID()}`);
    const staff = await seedMember(owner.id, "staff");
    const made = await createPeriod(owner.session_token);

    const read = await app.request(
      "/api/shift/periods",
      withAuth(staff.session_token),
      env,
    );
    expect(read.status).toBe(200);
    const body = (await read.json()) as { data: { id: string }[] };
    expect(body.data.map((p) => p.id)).toEqual([made.id]);

    const write = await app.request(
      "/api/shift/periods",
      withAuth(
        staff.session_token,
        jsonInit("POST", {
          ...period,
          start_date: "2026-09-16",
          end_date: "2026-09-30",
        }),
      ),
      env,
    );
    expect(write.status).toBe(403);
  });
});

describe("POST /api/shift/periods", () => {
  it("creates a period in the collecting state", async () => {
    const { session_token } = await seedShiftStore(
      `Create Period ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/shift/periods",
      withAuth(session_token, jsonInit("POST", period)),
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { status: string; published_at: number | null };
    };
    expect(body.data.status).toBe("collecting");
    expect(body.data.published_at).toBeNull();
  });

  it("returns 400 for a range that is not a whole half-month", async () => {
    const { session_token } = await seedShiftStore(
      `Period Range ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/shift/periods",
      withAuth(
        session_token,
        jsonInit("POST", { ...period, end_date: "2026-09-30" }),
      ),
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 409 for a second period with the same start date", async () => {
    const { session_token } = await seedShiftStore(
      `Period Duplicate ${crypto.randomUUID()}`,
    );
    await createPeriod(session_token);

    const res = await app.request(
      "/api/shift/periods",
      withAuth(session_token, jsonInit("POST", period)),
      env,
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("lets another store hold a period with the same start date", async () => {
    const storeA = await seedShiftStore(
      `Period Store A ${crypto.randomUUID()}`,
    );
    const storeB = await seedShiftStore(
      `Period Store B ${crypto.randomUUID()}`,
    );
    await createPeriod(storeA.session_token);

    const res = await app.request(
      "/api/shift/periods",
      withAuth(storeB.session_token, jsonInit("POST", period)),
      env,
    );

    expect(res.status).toBe(201);
  });
});

describe("GET /api/shift/periods", () => {
  it("lists the store's periods, newest first", async () => {
    const { session_token } = await seedShiftStore(
      `List Periods ${crypto.randomUUID()}`,
    );
    await createPeriod(session_token);
    await createPeriod(session_token, {
      start_date: "2026-09-16",
      end_date: "2026-09-30",
    });

    const res = await app.request(
      "/api/shift/periods",
      withAuth(session_token),
      env,
    );

    const body = (await res.json()) as { data: { start_date: string }[] };
    expect(body.data.map((p) => p.start_date)).toEqual([
      "2026-09-16",
      "2026-09-01",
    ]);
  });

  it("does not list another store's periods", async () => {
    const storeA = await seedShiftStore(`Period List A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Period List B ${crypto.randomUUID()}`);
    await createPeriod(storeA.session_token);

    const res = await app.request(
      "/api/shift/periods",
      withAuth(storeB.session_token),
      env,
    );

    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it("returns a single period by id", async () => {
    const { session_token } = await seedShiftStore(
      `Period By Id ${crypto.randomUUID()}`,
    );
    const made = await createPeriod(session_token);

    const res = await app.request(
      `/api/shift/periods/${made.id}`,
      withAuth(session_token),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; start_date: string; status: string };
    };
    expect(body.data.id).toBe(made.id);
    expect(body.data.start_date).toBe("2026-09-01");
    expect(body.data.status).toBe("collecting");
  });

  it("returns 404 for another store's period by id", async () => {
    const storeA = await seedShiftStore(`Period Get A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Period Get B ${crypto.randomUUID()}`);
    const made = await createPeriod(storeA.session_token);

    const res = await app.request(
      `/api/shift/periods/${made.id}`,
      withAuth(storeB.session_token),
      env,
    );

    expect(res.status).toBe(404);
  });
});

describe("period state machine", () => {
  it("runs collecting -> building -> published and stamps published_at", async () => {
    const { session_token } = await seedShiftStore(
      `Period Flow ${crypto.randomUUID()}`,
    );
    const made = await createPeriod(session_token);

    const closed = await advance(session_token, made.id, "close-submissions");
    expect(closed.status).toBe(200);
    const closedBody = (await closed.json()) as { data: { status: string } };
    expect(closedBody.data.status).toBe("building");

    const published = await advance(session_token, made.id, "publish");
    expect(published.status).toBe(200);
    const publishedBody = (await published.json()) as {
      data: { status: string; published_at: number | null };
    };
    expect(publishedBody.data.status).toBe("published");
    expect(publishedBody.data.published_at).toBeGreaterThan(0);
  });

  it("returns 409 when publishing a period that is still collecting", async () => {
    const { session_token } = await seedShiftStore(
      `Period Early Publish ${crypto.randomUUID()}`,
    );
    const made = await createPeriod(session_token);

    const res = await advance(session_token, made.id, "publish");

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
  });

  it("returns 409 when closing submissions twice", async () => {
    const { session_token } = await seedShiftStore(
      `Period Close Twice ${crypto.randomUUID()}`,
    );
    const made = await createPeriod(session_token);
    await advance(session_token, made.id, "close-submissions");

    const res = await advance(session_token, made.id, "close-submissions");

    expect(res.status).toBe(409);
  });

  it("returns 409 when publishing twice — published is terminal", async () => {
    const { session_token } = await seedShiftStore(
      `Period Publish Twice ${crypto.randomUUID()}`,
    );
    const made = await createPeriod(session_token);
    await advance(session_token, made.id, "close-submissions");
    await advance(session_token, made.id, "publish");

    const res = await advance(session_token, made.id, "publish");

    expect(res.status).toBe(409);
  });

  it("returns 403 when a staff session tries to advance a period", async () => {
    const owner = await seedShiftStore(
      `Period Staff Flow ${crypto.randomUUID()}`,
    );
    const staff = await seedShiftStore(
      `Period Staff Actor ${crypto.randomUUID()}`,
      "staff",
    );
    const made = await createPeriod(owner.session_token);

    const res = await advance(
      staff.session_token,
      made.id,
      "close-submissions",
    );

    expect(res.status).toBe(403);
  });

  it("returns 404 when advancing another store's period", async () => {
    const storeA = await seedShiftStore(`Period Adv A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Period Adv B ${crypto.randomUUID()}`);
    const made = await createPeriod(storeA.session_token);

    const res = await advance(
      storeB.session_token,
      made.id,
      "close-submissions",
    );

    expect(res.status).toBe(404);
  });
});
