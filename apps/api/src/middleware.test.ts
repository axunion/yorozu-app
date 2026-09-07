/// <reference types="@cloudflare/vitest-pool-workers/types" />
/**
 * requireEntitlement — the per-product gate the shift routes will sit behind.
 *
 * This slice lands the subscriptions table and the middleware; no shift route
 * exists yet, so the gate is mounted on a router built here rather than on the
 * real `app` as every other suite does. That leaves one thing this file cannot
 * catch — a real shift router that forgets to apply the gate — so the first
 * shift route slice owes at least one 403 asserted through a real endpoint.
 */
import { env } from "cloudflare:workers";
import { createDb, schema } from "@yorozu/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { type AuthEnv, requireEntitlement, requireStore } from "./middleware";
import { grantProduct, seedStore, withAuth } from "./test-helpers";

const gatedApp = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireEntitlement("shift"))
  .get("/", (c) => c.json({ data: { ok: true } }));

async function subscribedProducts(store_id: string): Promise<string[]> {
  const rows = await createDb(env.DB)
    .select({ product: schema.subscriptions.product })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.store_id, store_id));
  return rows.map((r) => r.product);
}

describe("requireEntitlement", () => {
  it("passes a store with an active subscription to the product", async () => {
    const { id, session_token } = await seedStore(
      `Entitled ${crypto.randomUUID()}`,
    );
    await grantProduct(id, "shift");

    const res = await gatedApp.request("/", withAuth(session_token), env);

    expect(res.status).toBe(200);
    // Proves the request reached the handler, not just that some 200 came back.
    const body = (await res.json()) as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
  });

  it("returns 403 FORBIDDEN when the store has no subscription", async () => {
    const { session_token } = await seedStore(
      `Unentitled ${crypto.randomUUID()}`,
    );

    const res = await gatedApp.request("/", withAuth(session_token), env);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 when the subscription exists but is suspended", async () => {
    const { id, session_token } = await seedStore(
      `Suspended Product ${crypto.randomUUID()}`,
    );
    await grantProduct(id, "shift", "suspended");

    const res = await gatedApp.request("/", withAuth(session_token), env);

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("does not let one store ride on another store's subscription", async () => {
    const entitled = await seedStore(`Store A ${crypto.randomUUID()}`);
    const other = await seedStore(`Store B ${crypto.randomUUID()}`);
    await grantProduct(entitled.id, "shift");

    const res = await gatedApp.request("/", withAuth(other.session_token), env);

    expect(res.status).toBe(403);
  });

  it("ignores an active subscription to a different product", async () => {
    const { id, session_token } = await seedStore(
      `Order Only ${crypto.randomUUID()}`,
    );
    // The precondition this test turns on: an active subscription exists, it
    // is simply the wrong product. Asserted rather than assumed, so the test
    // cannot quietly decay into a duplicate of the no-subscription case.
    expect(await subscribedProducts(id)).toEqual(["order"]);

    const res = await gatedApp.request("/", withAuth(session_token), env);

    expect(res.status).toBe(403);
  });

  it("rejects an unauthenticated request with 401, before the product check", async () => {
    const res = await gatedApp.request("/", {}, env);

    expect(res.status).toBe(401);
  });

  it("still rejects a suspended store that holds the product (401, not 403)", async () => {
    // The two switches are independent: stores.status disables the account,
    // subscriptions.status disables one product. requireStore runs first.
    const { id, session_token } = await seedStore(
      `Suspended Store ${crypto.randomUUID()}`,
    );
    await grantProduct(id, "shift");
    await createDb(env.DB)
      .update(schema.stores)
      .set({ status: "suspended" })
      .where(eq(schema.stores.id, id));

    const res = await gatedApp.request("/", withAuth(session_token), env);

    expect(res.status).toBe(401);
  });
});
