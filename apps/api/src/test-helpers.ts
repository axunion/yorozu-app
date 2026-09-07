/**
 * Shared request helpers for workers-project integration tests.
 * Import from this file instead of defining local copies in each test file.
 */

// The env binding is only available inside vitest-pool-workers.
// Import from cloudflare:workers is safe here because this file is only
// executed in the workers test project.
import { env } from "cloudflare:workers";
import { hashToken, newId, now, SESSION_TTL_MS } from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";

// ---------------------------------------------------------------------------
// Store + session seed helper
// ---------------------------------------------------------------------------

export type SeedStore = {
  id: string;
  member_id: string;
  session_token: string;
};

/**
 * Inserts an active store, an active member (default role: owner), and a
 * valid session directly into D1. Returns the store id, member id, and a
 * session_token that can be used with withAuth().
 *
 * Each call generates a unique email to prevent UNIQUE constraint conflicts
 * between tests in the same worker pool run.
 */
export async function seedStore(
  name: string,
  role: "owner" | "staff" = "owner",
): Promise<SeedStore> {
  const db = createDb(env.DB);
  const id = newId();
  const member_id = newId();
  const session_token = newId();
  const email = `${id}@test.internal`;
  const ts = now();

  await db.insert(schema.stores).values({
    id,
    name,
    slug: newId(),
    email,
    status: "active",
    activated_at: ts,
  });

  await db.insert(schema.members).values({
    id: member_id,
    store_id: id,
    email: `${member_id}@test.internal`,
    role,
    status: "active",
    activated_at: ts,
  });

  await db.insert(schema.sessions).values({
    id: newId(),
    store_id: id,
    member_id,
    session_token: await hashToken(session_token),
    expires_at: now() + SESSION_TTL_MS,
  });

  // Mirror registration: every store subscribes to the order product.
  // Tests that need another product insert their own row.
  await db.insert(schema.subscriptions).values({
    id: newId(),
    store_id: id,
    product: "order",
  });

  return { id, member_id, session_token };
}

/**
 * Adds a second active member, with their own session, to an existing store.
 * seedStore/seedShiftStore create one member each in a store of their own, so
 * this is what a test needs to prove one colleague cannot read or overwrite
 * another's data.
 */
export async function seedMember(
  store_id: string,
  role: "owner" | "staff" = "staff",
): Promise<{ member_id: string; session_token: string }> {
  const db = createDb(env.DB);
  const member_id = newId();
  const session_token = newId();

  await db.insert(schema.members).values({
    id: member_id,
    store_id,
    email: `${member_id}@test.internal`,
    role,
    status: "active",
    activated_at: now(),
  });
  await db.insert(schema.sessions).values({
    id: newId(),
    store_id,
    member_id,
    session_token: await hashToken(session_token),
    expires_at: now() + SESSION_TTL_MS,
  });

  return { member_id, session_token };
}

/**
 * Subscribes a store to a product. seedStore grants "order" only, mirroring
 * registration, so a test that exercises a shift route grants "shift" itself.
 */
export async function grantProduct(
  store_id: string,
  product: "order" | "shift",
  status: "active" | "suspended" = "active",
): Promise<void> {
  await createDb(env.DB)
    .insert(schema.subscriptions)
    .values({ id: newId(), store_id, product, status });
}

/** Seeds a store that already subscribes to shift management. */
export async function seedShiftStore(
  name: string,
  role: "owner" | "staff" = "owner",
): Promise<SeedStore> {
  const store = await seedStore(name, role);
  await grantProduct(store.id, "shift");
  return store;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/** Extracts the session_token value from a Set-Cookie response header. */
export function extractSessionToken(res: Response): string {
  const setCookie = res.headers.get("Set-Cookie") ?? "";
  const m = setCookie.match(/session_token=([^;]+)/);
  if (!m)
    throw new Error("session_token cookie not found in Set-Cookie header");
  return m[1] ?? "";
}

/** Returns RequestInit with the admin session_token Cookie appended. */
export function withAuth(
  session_token: string,
  extra: RequestInit = {},
): RequestInit {
  return {
    ...extra,
    headers: {
      ...(extra.headers as Record<string, string> | undefined),
      Cookie: `session_token=${session_token}`,
    },
  };
}

/** Returns RequestInit for a JSON request (method + Content-Type + body). */
export function jsonInit(
  method: string,
  body: unknown,
  extra: RequestInit = {},
): RequestInit {
  return {
    ...extra,
    method,
    headers: {
      "Content-Type": "application/json",
      ...(extra.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(body),
  };
}
