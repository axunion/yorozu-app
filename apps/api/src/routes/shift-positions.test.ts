/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * Positions — the first shift route, so it also carries slice 1's obligation:
 * the entitlement gate asserted through a real endpoint, not a router built
 * in a test file.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import {
  grantProduct,
  jsonInit,
  seedShiftStore,
  seedStore,
  withAuth,
} from "../test-helpers";

async function createPosition(
  token: string,
  name: string,
  sort_order?: number,
): Promise<{ id: string; name: string; sort_order: number }> {
  const res = await app.request(
    "/api/shift/positions",
    withAuth(
      token,
      jsonInit(
        "POST",
        sort_order === undefined ? { name } : { name, sort_order },
      ),
    ),
    env,
  );
  const body = (await res.json()) as {
    data: { id: string; name: string; sort_order: number };
  };
  return body.data;
}

// ---------------------------------------------------------------------------
// Access control
// ---------------------------------------------------------------------------

describe("shift route access control", () => {
  it("returns 401 without a session", async () => {
    const res = await app.request("/api/shift/positions", {}, env);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a store that does not subscribe to shift", async () => {
    const { session_token } = await seedStore(
      `No Shift Product ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/shift/positions",
      withAuth(session_token),
      env,
    );

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when the shift subscription is suspended", async () => {
    const store = await seedStore(`Suspended Shift ${crypto.randomUUID()}`);
    await grantProduct(store.id, "shift", "suspended");

    const res = await app.request(
      "/api/shift/positions",
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(403);
  });

  it("returns 403 for a staff-role session (owner-only)", async () => {
    const store = await seedShiftStore(
      `Staff Positions ${crypto.randomUUID()}`,
      "staff",
    );

    const res = await app.request(
      "/api/shift/positions",
      withAuth(store.session_token),
      env,
    );

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe("POST /api/shift/positions", () => {
  it("creates a position and returns 201", async () => {
    const { session_token } = await seedShiftStore(
      `Create Position ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/shift/positions",
      withAuth(session_token, jsonInit("POST", { name: "ホール" })),
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        id: string;
        name: string;
        sort_order: number;
        is_active: boolean;
      };
    };
    expect(body.data.name).toBe("ホール");
    expect(body.data.sort_order).toBe(0);
    expect(body.data.is_active).toBe(true);
  });

  it("returns 400 for an empty name", async () => {
    const { session_token } = await seedShiftStore(
      `Position Validation ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      "/api/shift/positions",
      withAuth(session_token, jsonInit("POST", { name: "   " })),
      env,
    );

    expect(res.status).toBe(400);
  });
});

describe("GET /api/shift/positions", () => {
  it("lists the store's positions in sort order", async () => {
    const { session_token } = await seedShiftStore(
      `List Positions ${crypto.randomUUID()}`,
    );
    await createPosition(session_token, "キッチン", 2);
    await createPosition(session_token, "ホール", 1);

    const res = await app.request(
      "/api/shift/positions",
      withAuth(session_token),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string }[] };
    expect(body.data.map((p) => p.name)).toEqual(["ホール", "キッチン"]);
  });

  it("excludes retired positions by default and includes them on request", async () => {
    const { session_token } = await seedShiftStore(
      `Retired Positions ${crypto.randomUUID()}`,
    );
    const retired = await createPosition(session_token, "廃止");
    await createPosition(session_token, "現役");
    await app.request(
      `/api/shift/positions/${retired.id}`,
      withAuth(session_token, { method: "DELETE" }),
      env,
    );

    const defaultRes = await app.request(
      "/api/shift/positions",
      withAuth(session_token),
      env,
    );
    const defaultBody = (await defaultRes.json()) as {
      data: { name: string }[];
    };
    expect(defaultBody.data.map((p) => p.name)).toEqual(["現役"]);

    const allRes = await app.request(
      "/api/shift/positions?include_inactive=true",
      withAuth(session_token),
      env,
    );
    const allBody = (await allRes.json()) as { data: { name: string }[] };
    expect(allBody.data).toHaveLength(2);
  });

  it("does not list another store's positions", async () => {
    const storeA = await seedShiftStore(`Positions A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Positions B ${crypto.randomUUID()}`);
    await createPosition(storeA.session_token, "A のホール");

    const res = await app.request(
      "/api/shift/positions",
      withAuth(storeB.session_token),
      env,
    );

    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe("PATCH /api/shift/positions/:id", () => {
  it("renames a position", async () => {
    const { session_token } = await seedShiftStore(
      `Rename Position ${crypto.randomUUID()}`,
    );
    const position = await createPosition(session_token, "ホール");

    const res = await app.request(
      `/api/shift/positions/${position.id}`,
      withAuth(
        session_token,
        jsonInit("PATCH", {
          name: "フロア",
          sort_order: 3,
          is_active: true,
        }),
      ),
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { name: string; sort_order: number };
    };
    expect(body.data.name).toBe("フロア");
    expect(body.data.sort_order).toBe(3);
  });

  it("returns 400 for an empty name", async () => {
    const { session_token } = await seedShiftStore(
      `Patch Validation ${crypto.randomUUID()}`,
    );
    const position = await createPosition(session_token, "ホール");

    const res = await app.request(
      `/api/shift/positions/${position.id}`,
      withAuth(
        session_token,
        jsonInit("PATCH", { name: "  ", sort_order: 0, is_active: true }),
      ),
      env,
    );

    expect(res.status).toBe(400);
  });

  it("returns 404 for another store's position", async () => {
    const storeA = await seedShiftStore(`Patch A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Patch B ${crypto.randomUUID()}`);
    const position = await createPosition(storeA.session_token, "ホール");

    const res = await app.request(
      `/api/shift/positions/${position.id}`,
      withAuth(
        storeB.session_token,
        jsonInit("PATCH", { name: "乗っ取り", sort_order: 0, is_active: true }),
      ),
      env,
    );

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/shift/positions/:id", () => {
  it("retires the position without deleting the row", async () => {
    const { session_token } = await seedShiftStore(
      `Retire Position ${crypto.randomUUID()}`,
    );
    const position = await createPosition(session_token, "ホール");

    const res = await app.request(
      `/api/shift/positions/${position.id}`,
      withAuth(session_token, { method: "DELETE" }),
      env,
    );

    expect(res.status).toBe(200);
    const rows = await createDb(env.DB)
      .select()
      .from(schema.positions)
      .where(eq(schema.positions.id, position.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.is_active).toBe(false);
  });

  it("is idempotent on an already retired position", async () => {
    const { session_token } = await seedShiftStore(
      `Idempotent Retire ${crypto.randomUUID()}`,
    );
    const position = await createPosition(session_token, "ホール");

    await app.request(
      `/api/shift/positions/${position.id}`,
      withAuth(session_token, { method: "DELETE" }),
      env,
    );
    const second = await app.request(
      `/api/shift/positions/${position.id}`,
      withAuth(session_token, { method: "DELETE" }),
      env,
    );

    expect(second.status).toBe(200);
  });

  it("returns 404 for another store's position", async () => {
    const storeA = await seedShiftStore(`Delete A ${crypto.randomUUID()}`);
    const storeB = await seedShiftStore(`Delete B ${crypto.randomUUID()}`);
    const position = await createPosition(storeA.session_token, "ホール");

    const res = await app.request(
      `/api/shift/positions/${position.id}`,
      withAuth(storeB.session_token, { method: "DELETE" }),
      env,
    );

    expect(res.status).toBe(404);
  });
});
