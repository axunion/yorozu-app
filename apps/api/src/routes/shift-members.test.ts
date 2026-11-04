/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * The shift roster: which positions each member can work, and the wage, cap
 * and minor flag the warnings and cost estimate read.
 *
 * Owner-only on purpose — hourly_wage and is_minor are the most sensitive
 * per-person fields in the database, and a staff session must not read a
 * colleague's.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedShiftStore, seedStore, withAuth } from "../test-helpers";

async function createPosition(token: string, name = "ホール"): Promise<string> {
  const res = await app.request(
    "/api/shift/positions",
    withAuth(token, jsonInit("POST", { name })),
    env,
  );
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/** Reads a member's assignments back through the roster endpoint. */
async function assignedPositions(
  token: string,
  memberId: string,
): Promise<string[]> {
  const res = await app.request("/api/shift/members", withAuth(token), env);
  const body = (await res.json()) as {
    data: { id: string; position_ids: string[] }[];
  };
  return body.data.find((m) => m.id === memberId)?.position_ids ?? [];
}

const profileBody = {
  hourly_wage: 1100,
  weekly_cap_minutes: 1200,
  is_minor: false,
};

describe("GET /api/shift/members", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request("/api/shift/members", {}, env);
    expect(res.status).toBe(401);
  });

  it("lists the store's members with their positions and profile", async () => {
    const store = await seedShiftStore(`Roster List ${crypto.randomUUID()}`);
    const position = await createPosition(store.session_token);
    await app.request(
      `/api/shift/members/${store.member_id}/positions`,
      withAuth(
        store.session_token,
        jsonInit("PUT", { position_ids: [position] }),
      ),
      env,
    );
    await app.request(
      `/api/shift/members/${store.member_id}/work-profile`,
      withAuth(store.session_token, jsonInit("PUT", profileBody)),
      env,
    );

    const res = await app.request(
      "/api/shift/members",
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        id: string;
        position_ids: string[];
        hourly_wage: number | null;
        is_minor: boolean;
      }[];
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(store.member_id);
    expect(body.data[0]?.position_ids).toEqual([position]);
    expect(body.data[0]?.hourly_wage).toBe(1100);
  });

  it("reports a member with no profile as unset rather than zero", async () => {
    const store = await seedShiftStore(`Roster Unset ${crypto.randomUUID()}`);

    const res = await app.request(
      "/api/shift/members",
      withAuth(store.session_token),
      env,
    );
    const body = (await res.json()) as {
      data: {
        hourly_wage: number | null;
        weekly_cap_minutes: number | null;
        is_minor: boolean;
        position_ids: string[];
      }[];
    };

    expect(body.data[0]?.hourly_wage).toBeNull();
    expect(body.data[0]?.weekly_cap_minutes).toBeNull();
    expect(body.data[0]?.is_minor).toBe(false);
    expect(body.data[0]?.position_ids).toEqual([]);
  });

  it("does not list another store's members", async () => {
    const storeA = await seedShiftStore(`Roster A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Roster B ${crypto.randomUUID()}`);

    const res = await app.request(
      "/api/shift/members",
      withAuth(storeB.session_token),
      env,
    );
    const body = (await res.json()) as { data: { id: string }[] };

    expect(body.data.map((m) => m.id)).not.toContain(storeA.member_id);
    expect(body.data).toHaveLength(1);
  });

  it("returns 403 for a staff session — wages are owner-only", async () => {
    const store = await seedShiftStore(
      `Roster Staff ${crypto.randomUUID()}`,
      "staff",
    );

    const res = await app.request(
      "/api/shift/members",
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain("Owner");
  });

  it("returns 403 for a store without the shift product", async () => {
    const store = await seedStore(`Roster No Product ${crypto.randomUUID()}`);

    const res = await app.request(
      "/api/shift/members",
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(403);
  });
});

describe("PUT /api/shift/members/:memberId/positions", () => {
  it("replaces the member's assignments rather than adding to them", async () => {
    const store = await seedShiftStore(`Assign Replace ${crypto.randomUUID()}`);
    const hall = await createPosition(store.session_token, "ホール");
    const kitchen = await createPosition(store.session_token, "キッチン");

    await app.request(
      `/api/shift/members/${store.member_id}/positions`,
      withAuth(
        store.session_token,
        jsonInit("PUT", { position_ids: [hall, kitchen] }),
      ),
      env,
    );
    const res = await app.request(
      `/api/shift/members/${store.member_id}/positions`,
      withAuth(store.session_token, jsonInit("PUT", { position_ids: [hall] })),
      env,
    );
    expect(res.status).toBe(200);

    // Read it back: the response echoes the request, so only a fresh read
    // proves the kitchen assignment is gone rather than added to.
    expect(
      await assignedPositions(store.session_token, store.member_id),
    ).toEqual([hall]);
  });

  it("accepts an empty list, which clears the assignments", async () => {
    const store = await seedShiftStore(`Assign Clear ${crypto.randomUUID()}`);
    const hall = await createPosition(store.session_token);
    await app.request(
      `/api/shift/members/${store.member_id}/positions`,
      withAuth(store.session_token, jsonInit("PUT", { position_ids: [hall] })),
      env,
    );

    const res = await app.request(
      `/api/shift/members/${store.member_id}/positions`,
      withAuth(store.session_token, jsonInit("PUT", { position_ids: [] })),
      env,
    );
    expect(res.status).toBe(200);

    expect(
      await assignedPositions(store.session_token, store.member_id),
    ).toEqual([]);
  });

  it("returns 400 for a repeated position", async () => {
    const store = await seedShiftStore(`Assign Dup ${crypto.randomUUID()}`);
    const hall = await createPosition(store.session_token);

    const res = await app.request(
      `/api/shift/members/${store.member_id}/positions`,
      withAuth(
        store.session_token,
        jsonInit("PUT", { position_ids: [hall, hall] }),
      ),
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for another store's member", async () => {
    const storeA = await seedShiftStore(
      `Assign Member A ${crypto.randomUUID()}`,
    );
    const storeB = await seedShiftStore(
      `Assign Member B ${crypto.randomUUID()}`,
    );
    const position = await createPosition(storeB.session_token);

    const res = await app.request(
      `/api/shift/members/${storeA.member_id}/positions`,
      withAuth(
        storeB.session_token,
        jsonInit("PUT", { position_ids: [position] }),
      ),
      env,
    );

    expect(res.status).toBe(404);
  });

  it("returns 404 when a position belongs to another store", async () => {
    const storeA = await seedShiftStore(`Assign Pos A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Assign Pos B ${crypto.randomUUID()}`);
    const foreign = await createPosition(storeA.session_token);

    const res = await app.request(
      `/api/shift/members/${storeB.member_id}/positions`,
      withAuth(
        storeB.session_token,
        jsonInit("PUT", { position_ids: [foreign] }),
      ),
      env,
    );

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/shift/members/:memberId/work-profile", () => {
  it("creates the profile and then updates it in place", async () => {
    const store = await seedShiftStore(`Profile Upsert ${crypto.randomUUID()}`);

    const created = await app.request(
      `/api/shift/members/${store.member_id}/work-profile`,
      withAuth(store.session_token, jsonInit("PUT", profileBody)),
      env,
    );
    expect(created.status).toBe(200);

    const updated = await app.request(
      `/api/shift/members/${store.member_id}/work-profile`,
      withAuth(
        store.session_token,
        jsonInit("PUT", {
          hourly_wage: 1300,
          weekly_cap_minutes: null,
          is_minor: true,
        }),
      ),
      env,
    );
    expect(updated.status).toBe(200);

    const res = await app.request(
      "/api/shift/members",
      withAuth(store.session_token),
      env,
    );
    const body = (await res.json()) as {
      data: {
        hourly_wage: number | null;
        weekly_cap_minutes: number | null;
        is_minor: boolean;
      }[];
    };
    expect(body.data[0]?.hourly_wage).toBe(1300);
    expect(body.data[0]?.weekly_cap_minutes).toBeNull();
    expect(body.data[0]?.is_minor).toBe(true);
  });

  it("returns 400 for a negative wage", async () => {
    const store = await seedShiftStore(`Profile Wage ${crypto.randomUUID()}`);

    const res = await app.request(
      `/api/shift/members/${store.member_id}/work-profile`,
      withAuth(
        store.session_token,
        jsonInit("PUT", { ...profileBody, hourly_wage: -1 }),
      ),
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for another store's member", async () => {
    const storeA = await seedShiftStore(`Profile A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Profile B ${crypto.randomUUID()}`);

    const res = await app.request(
      `/api/shift/members/${storeA.member_id}/work-profile`,
      withAuth(storeB.session_token, jsonInit("PUT", profileBody)),
      env,
    );

    expect(res.status).toBe(404);
  });
});
