/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { app } from "../app";

const JSON_HEADERS = { "Content-Type": "application/json" };

function storeBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: "My Test Cafe",
    email: "owner@example.com",
    ...overrides,
  });
}

describe("POST /api/stores", () => {
  it("creates a store with status=pending and returns 201", async () => {
    const res = await app.request(
      "/api/stores",
      { method: "POST", headers: JSON_HEADERS, body: storeBody() },
      env,
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; name: string; slug: string };
    };
    expect(body.data.name).toBe("My Test Cafe");
    expect(body.data.id).toBeTruthy();
    expect(body.data.slug).toMatch(/^my-test-cafe-[a-z0-9]{5}$/);
  });

  it("does NOT set a session cookie (session is created on verify)", async () => {
    const res = await app.request(
      "/api/stores",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: storeBody({ email: "noauth@example.com" }),
      },
      env,
    );

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).not.toContain("session_token");
  });

  it("persists the store with status=pending to D1", async () => {
    const storeName = `Persist Test ${crypto.randomUUID()}`;
    const email = `persist-${crypto.randomUUID()}@example.com`;
    const res = await app.request(
      "/api/stores",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: storeBody({ name: storeName, email }),
      },
      env,
    );
    const body = (await res.json()) as { data: { id: string } };

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(schema.stores)
      .where(eq(schema.stores.id, body.data.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(storeName);
    expect(rows[0]?.status).toBe("pending");
    expect(rows[0]?.email).toBe(email);
  });

  it("creates a magic_link_token with purpose=signup", async () => {
    const email = `signup-${crypto.randomUUID()}@example.com`;
    const res = await app.request(
      "/api/stores",
      { method: "POST", headers: JSON_HEADERS, body: storeBody({ email }) },
      env,
    );
    const body = (await res.json()) as { data: { id: string } };

    const db = createDb(env.DB);
    const tokens = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.store_id, body.data.id));
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.purpose).toBe("signup");
    expect(tokens[0]?.used_at).toBeNull();
  });

  it("creates an owner member (role=owner, status=pending) alongside the store", async () => {
    const email = `owner-member-${crypto.randomUUID()}@example.com`;
    const res = await app.request(
      "/api/stores",
      { method: "POST", headers: JSON_HEADERS, body: storeBody({ email }) },
      env,
    );
    const body = (await res.json()) as { data: { id: string } };

    const db = createDb(env.DB);
    const members = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.store_id, body.data.id));
    expect(members).toHaveLength(1);
    expect(members[0]?.role).toBe("owner");
    expect(members[0]?.status).toBe("pending");
    expect(members[0]?.email).toBe(email);

    // The signup token targets the new member, not just the store.
    const tokens = await db
      .select()
      .from(schema.magicLinkTokens)
      .where(eq(schema.magicLinkTokens.store_id, body.data.id));
    expect(tokens[0]?.member_id).toBe(members[0]?.id);
  });

  it("subscribes the new store to the order product", async () => {
    const email = `subscription-${crypto.randomUUID()}@example.com`;
    const res = await app.request(
      "/api/stores",
      { method: "POST", headers: JSON_HEADERS, body: storeBody({ email }) },
      env,
    );
    const body = (await res.json()) as { data: { id: string } };

    const db = createDb(env.DB);
    const subscriptions = await db
      .select()
      .from(schema.subscriptions)
      .where(eq(schema.subscriptions.store_id, body.data.id));
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0]?.product).toBe("order");
    expect(subscriptions[0]?.status).toBe("active");
  });

  it("returns 400 when name is missing", async () => {
    const res = await app.request(
      "/api/stores",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ email: "a@b.com" }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when email is missing", async () => {
    const res = await app.request(
      "/api/stores",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: "Cafe" }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when email is invalid", async () => {
    const res = await app.request(
      "/api/stores",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: storeBody({ email: "not-an-email" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is empty string", async () => {
    const res = await app.request(
      "/api/stores",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: storeBody({ name: "   " }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("does NOT include the code when ENVIRONMENT=production", async () => {
    const email = `prod-env-${crypto.randomUUID()}@example.com`;
    const res = await app.request(
      "/api/stores",
      { method: "POST", headers: JSON_HEADERS, body: storeBody({ email }) },
      { ...env, ENVIRONMENT: "production" },
    );
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toBeUndefined();
  });

  it("includes the code when ENVIRONMENT=development", async () => {
    const email = `dev-env-${crypto.randomUUID()}@example.com`;
    const res = await app.request(
      "/api/stores",
      { method: "POST", headers: JSON_HEADERS, body: storeBody({ email }) },
      { ...env, ENVIRONMENT: "development" },
    );
    const body = (await res.json()) as { data: { code?: string } };
    expect(body.data.code).toMatch(/^\d{6}$/);
  });

  it("returns 400 when email is already registered", async () => {
    const email = `dup-${crypto.randomUUID()}@example.com`;
    await app.request(
      "/api/stores",
      { method: "POST", headers: JSON_HEADERS, body: storeBody({ email }) },
      env,
    );
    const res2 = await app.request(
      "/api/stores",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: storeBody({ name: "Other Cafe", email }),
      },
      env,
    );
    expect(res2.status).toBe(400);
    const body = (await res2.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
