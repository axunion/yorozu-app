import { errorResponse } from "@yorozu/core";
import { Hono } from "hono";

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * Public, unauthenticated image serving. Menu photos are public by nature —
 * the R2 object key acts as an unguessable capability. Keys embed slashes
 * (menu/{store_id}/{item_id}/{random}.{ext}), so the `key` param uses a
 * regex constraint to match the full remaining path, not just one segment.
 */
export const menuImagesRouter = new Hono<{ Bindings: Env }>()

  /**
   * GET /api/menu/images/:key
   * Streams the R2 object at :key. Cache-Control is immutable since keys
   * are content-unique (a new random segment per upload).
   */
  .get("/:key{.+}", async (c) => {
    const key = c.req.param("key");
    // This bucket is only ever used for menu photos (see key format above);
    // reject anything outside that shape as defense-in-depth against future
    // reuse of the IMAGES binding for other, non-public object types.
    if (!key.startsWith("menu/")) {
      return errorResponse("NOT_FOUND", "Image not found", 404);
    }

    const object = await c.env.IMAGES.get(key);
    if (!object) {
      return errorResponse("NOT_FOUND", "Image not found", 404);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", object.httpEtag);
    // The upload endpoint validates Content-Type against an allowlist but
    // doesn't verify the bytes match it — this stops browsers from sniffing
    // and rendering mislabeled content as something other than an image.
    headers.set("X-Content-Type-Options", "nosniff");

    return new Response(object.body, { headers });
  });
