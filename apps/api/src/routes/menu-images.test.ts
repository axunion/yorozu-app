/// <reference types="@cloudflare/vitest-plugin/types" />
/**
 * Menu item photos: R2-backed upload, serving, and
 * deletion of menu item images.
 */
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { app } from "../app";
import { jsonInit, seedStore, withAuth } from "../test-helpers";

/** Returns RequestInit for a raw-binary request with an explicit Content-Type. */
function binaryInit(
  method: string,
  body: BodyInit,
  contentType: string,
  extra: RequestInit = {},
): RequestInit {
  return {
    ...extra,
    method,
    headers: {
      "Content-Type": contentType,
      ...(extra.headers as Record<string, string> | undefined),
    },
    body,
  };
}

async function createItem(token: string, name: string): Promise<string> {
  const res = await app.request(
    "/api/menu/items",
    withAuth(token, jsonInit("POST", { name, price: 500 })),
    env,
  );
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

/** Fetches the current image_key for an item via the list endpoint. */
async function getImageKey(
  token: string,
  itemId: string,
): Promise<string | null> {
  const res = await app.request("/api/menu/items", withAuth(token), env);
  const body = (await res.json()) as {
    data: { id: string; image_key: string | null }[];
  };
  const item = body.data.find((i) => i.id === itemId);
  if (!item) throw new Error(`Item ${itemId} not found`);
  return item.image_key;
}

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

// ---------------------------------------------------------------------------
// PUT /api/menu/items/:id/image
// ---------------------------------------------------------------------------

describe("PUT /api/menu/items/:id/image", () => {
  it("uploads an image and the item's image_key can be fetched back byte-for-byte", async () => {
    const { session_token: token } = await seedStore(
      `Image Upload ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");

    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", jpegBytes, "image/jpeg")),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; image_key: string };
    };
    expect(body.data.id).toBe(itemId);
    expect(body.data.image_key).toMatch(
      new RegExp(`^menu/.+/${itemId}/.+\\.jpg$`),
    );

    const imageRes = await app.request(
      `/api/menu/images/${body.data.image_key}`,
      {},
      env,
    );
    expect(imageRes.status).toBe(200);
    expect(imageRes.headers.get("Content-Type")).toBe("image/jpeg");
    expect(imageRes.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    const bytes = new Uint8Array(await imageRes.arrayBuffer());
    expect(bytes).toEqual(jpegBytes);
  });

  it("rejects an unsupported Content-Type", async () => {
    const { session_token: token } = await seedStore(
      `Content Type Reject ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");

    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", jpegBytes, "application/pdf")),
      env,
    );
    expect(res.status).toBe(400);
    expect(await getImageKey(token, itemId)).toBeNull();
  });

  it("rejects a body over the 1 MB size cap", async () => {
    const { session_token: token } = await seedStore(
      `Size Reject ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");

    const oversized = new Uint8Array(1024 * 1024 + 1);
    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", oversized, "image/jpeg")),
      env,
    );
    expect(res.status).toBe(413);
    expect(await getImageKey(token, itemId)).toBeNull();
  });

  it("accepts a body at exactly the 1 MB size cap", async () => {
    const { session_token: token } = await seedStore(
      `Size Boundary ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");

    const atLimit = new Uint8Array(1024 * 1024);
    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", atLimit, "image/jpeg")),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("replacing an image deletes the previous R2 object", async () => {
    const { session_token: token } = await seedStore(
      `Replace Image ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");

    const first = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", jpegBytes, "image/jpeg")),
      env,
    );
    const firstBody = (await first.json()) as { data: { image_key: string } };
    const firstKey = firstBody.data.image_key;

    const second = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", jpegBytes, "image/png")),
      env,
    );
    const secondBody = (await second.json()) as {
      data: { image_key: string };
    };
    expect(secondBody.data.image_key).not.toBe(firstKey);
    expect(secondBody.data.image_key).toMatch(/\.png$/);

    // The old object is deleted best-effort (awaited inline in this test
    // environment, since executionCtx.waitUntil is unavailable here — see
    // the `background` helper in routes/menu.ts).
    expect(await env.IMAGES.get(firstKey)).toBeNull();
    const secondObject = await env.IMAGES.get(secondBody.data.image_key);
    expect(secondObject).not.toBeNull();
    expect(secondObject?.httpMetadata?.contentType).toBe("image/png");
  });

  it("accepts image/webp and serves it back with the right content type", async () => {
    const { session_token: token } = await seedStore(
      `Webp Upload ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");
    const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 5, 6, 7, 8]);

    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", webpBytes, "image/webp")),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { image_key: string } };
    expect(body.data.image_key).toMatch(/\.webp$/);

    const imageRes = await app.request(
      `/api/menu/images/${body.data.image_key}`,
      {},
      env,
    );
    expect(imageRes.status).toBe(200);
    expect(imageRes.headers.get("Content-Type")).toBe("image/webp");
  });

  it("returns 404 for another store's item and writes no orphaned R2 object (tenant isolation)", async () => {
    const { id: ownerStoreId, session_token: ownerToken } = await seedStore(
      `Owner Store ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(ownerToken, "唐揚げ");
    const { session_token: otherToken } = await seedStore(
      `Other Store ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(otherToken, binaryInit("PUT", jpegBytes, "image/jpeg")),
      env,
    );
    expect(res.status).toBe(404);
    expect(await getImageKey(ownerToken, itemId)).toBeNull();
    const listed = await env.IMAGES.list({
      prefix: `menu/${ownerStoreId}/${itemId}/`,
    });
    expect(listed.objects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/menu/items/:id/image
// ---------------------------------------------------------------------------

describe("DELETE /api/menu/items/:id/image", () => {
  it("clears image_key and deletes the R2 object", async () => {
    const { session_token: token } = await seedStore(
      `Delete Image ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");
    const uploadRes = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", jpegBytes, "image/jpeg")),
      env,
    );
    const uploadBody = (await uploadRes.json()) as {
      data: { image_key: string };
    };
    const key = uploadBody.data.image_key;

    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { image_key: string | null } };
    expect(body.data.image_key).toBeNull();
    expect(await env.IMAGES.get(key)).toBeNull();
  });

  it("is a no-op success when the item has no image", async () => {
    const { session_token: token } = await seedStore(
      `Delete No Image ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");

    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 for another store's item and leaves its image untouched (tenant isolation)", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Owner Store 2 ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(ownerToken, "唐揚げ");
    const uploadRes = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(ownerToken, binaryInit("PUT", jpegBytes, "image/jpeg")),
      env,
    );
    const uploadBody = (await uploadRes.json()) as {
      data: { image_key: string };
    };
    const { session_token: otherToken } = await seedStore(
      `Other Store 2 ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(otherToken, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(404);
    expect(await getImageKey(ownerToken, itemId)).toBe(
      uploadBody.data.image_key,
    );
    expect(await env.IMAGES.get(uploadBody.data.image_key)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/menu/items/:id — cascade cleanup
// ---------------------------------------------------------------------------

describe("DELETE /api/menu/items/:id image cascade", () => {
  it("deletes the item's R2 object when the item itself is deleted", async () => {
    const { session_token: token } = await seedStore(
      `Item Delete Cascade ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");
    const uploadRes = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", jpegBytes, "image/jpeg")),
      env,
    );
    const uploadBody = (await uploadRes.json()) as {
      data: { image_key: string };
    };
    const key = uploadBody.data.image_key;

    const res = await app.request(
      `/api/menu/items/${itemId}`,
      withAuth(token, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await env.IMAGES.get(key)).toBeNull();
  });

  it("returns 404 for another store's item and leaves it and its image intact (tenant isolation)", async () => {
    const { session_token: ownerToken } = await seedStore(
      `Item Delete Isolation ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(ownerToken, "唐揚げ");
    const uploadRes = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(ownerToken, binaryInit("PUT", jpegBytes, "image/jpeg")),
      env,
    );
    const uploadBody = (await uploadRes.json()) as {
      data: { image_key: string };
    };
    const { session_token: otherToken } = await seedStore(
      `Item Delete Isolation Other ${crypto.randomUUID()}`,
    );

    const res = await app.request(
      `/api/menu/items/${itemId}`,
      withAuth(otherToken, { method: "DELETE" }),
      env,
    );
    expect(res.status).toBe(404);
    expect(await getImageKey(ownerToken, itemId)).toBe(
      uploadBody.data.image_key,
    );
    expect(await env.IMAGES.get(uploadBody.data.image_key)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/menu/images/:key
// ---------------------------------------------------------------------------

describe("GET /api/menu/images/:key", () => {
  it("returns 404 for an unknown key", async () => {
    const res = await app.request(
      "/api/menu/images/menu/no-such-store/no-such-item/no-such-file.jpg",
      {},
      env,
    );
    expect(res.status).toBe(404);
  });

  it("requires no authentication", async () => {
    const { session_token: token } = await seedStore(
      `Public Image ${crypto.randomUUID()}`,
    );
    const itemId = await createItem(token, "唐揚げ");
    const uploadRes = await app.request(
      `/api/menu/items/${itemId}/image`,
      withAuth(token, binaryInit("PUT", jpegBytes, "image/jpeg")),
      env,
    );
    const uploadBody = (await uploadRes.json()) as {
      data: { image_key: string };
    };

    // No session cookie attached.
    const res = await app.request(
      `/api/menu/images/${uploadBody.data.image_key}`,
      {},
      env,
    );
    expect(res.status).toBe(200);
  });
});
