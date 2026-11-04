/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Role enforcement (roadmap Phase 5 item 1): requireOwner gates
 * settings/menu/seat management to owner-role members; board/checkout
 * routes stay open to both roles.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

describe("requireOwner-gated routes", () => {
  it("403s a staff-role session on GET /api/menu/categories", async () => {
    const { session_token: token } = await seedStore(
      `Staff Menu Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request("/api/menu/categories", withAuth(token), env);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("200s an owner-role session on GET /api/menu/categories", async () => {
    const { session_token: token } = await seedStore(
      `Owner Menu Test ${crypto.randomUUID()}`,
      "owner",
    );
    const res = await app.request("/api/menu/categories", withAuth(token), env);
    expect(res.status).toBe(200);
  });

  it("403s a staff-role session on GET /api/menu/option-groups", async () => {
    const { session_token: token } = await seedStore(
      `Staff Options Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request(
      "/api/menu/option-groups",
      withAuth(token),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("403s a staff-role session on GET /api/seats", async () => {
    const { session_token: token } = await seedStore(
      `Staff Seats Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request("/api/seats", withAuth(token), env);
    expect(res.status).toBe(403);
  });

  it("403s a staff-role session on PATCH /api/stores/me (rename)", async () => {
    const { session_token: token } = await seedStore(
      `Staff Rename Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("PATCH", { name: "新しい名前" })),
      env,
    );
    expect(res.status).toBe(403);
  });

  it("200s an owner-role session on PATCH /api/stores/me (rename)", async () => {
    const { session_token: token } = await seedStore(
      `Owner Rename Test ${crypto.randomUUID()}`,
      "owner",
    );
    const res = await app.request(
      "/api/stores/me",
      withAuth(token, jsonInit("PATCH", { name: "新しい名前" })),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe("board/checkout routes stay open to both roles", () => {
  it("200s a staff-role session on GET /api/admin/orders", async () => {
    const { session_token: token } = await seedStore(
      `Staff Orders Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request("/api/admin/orders", withAuth(token), env);
    expect(res.status).toBe(200);
  });

  it("200s a staff-role session on GET /api/admin/calls", async () => {
    const { session_token: token } = await seedStore(
      `Staff Calls Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request("/api/admin/calls", withAuth(token), env);
    expect(res.status).toBe(200);
  });

  it("200s a staff-role session on GET /api/payments", async () => {
    const { session_token: token } = await seedStore(
      `Staff Payments Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request(
      `/api/payments?from=${Date.now() - 1000}&to=${Date.now()}`,
      withAuth(token),
      env,
    );
    expect(res.status).toBe(200);
  });

  // Grouped here as another requireOwner-exempt route, not because it's
  // board/checkout — email-change is gated by "is this your own account?",
  // not by role.
  it("200s a staff-role session on POST /api/stores/me/email-change (own account)", async () => {
    const { session_token: token } = await seedStore(
      `Staff Email Change Test ${crypto.randomUUID()}`,
      "staff",
    );
    const res = await app.request(
      "/api/stores/me/email-change",
      withAuth(
        token,
        jsonInit("POST", {
          new_email: `new-${crypto.randomUUID()}@test.internal`,
        }),
      ),
      env,
    );
    expect(res.status).toBe(200);
  });
});
