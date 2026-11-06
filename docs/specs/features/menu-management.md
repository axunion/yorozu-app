# Feature: Menu Management

Owner-managed catalog of categories and items, edited in `apps/admin`
(MenuPage), consumed read-only by the customer order screen.

## Current behavior

All endpoints require the `session_token` cookie (`requireStore`).

### Categories (`/api/menu/categories`)

- `GET` — list, ordered by `sort_order`.
- `POST` / `PATCH /:id` — name (1–100 chars) and `sort_order` (int ≥ 0).
  The admin list edits both inline (「編集」 → name + 表示順), matching the
  item rows.
- `DELETE /:id` — items in the category are **not** deleted; their
  `category_id` becomes null (uncategorized, shown as 「その他」). The
  confirm dialog says so.

### Items (`/api/menu/items`)

- `GET` — list, ordered by `sort_order`. Admin sees all items including
  unavailable ones.
- `POST` / `PATCH /:id` — fields: name (1–100 chars), price (positive
  integer, tax-inclusive JPY), optional `category_id`, `sort_order`,
  `is_available` (default true), `description` (nullable, ≤ 500 chars,
  trimmed; empty after trimming normalizes to null — `POST` omits to
  null, `PATCH` omits to preserve the current value, explicit `null`
  clears it).
- `DELETE /:id` — permanent. Historical order items are unaffected
  because they carry name/price snapshots. Also best-effort-deletes the
  item's R2 image object, if any.

### Availability toggle

`is_available = false` (sold out / hidden) removes the item from the
customer menu and blocks ordering it (409 with the item name), but keeps
it visible in admin for re-enabling.

### Item photos (`/api/menu/items/:id/image`, `/api/menu/images/:key`)

- `PUT /api/menu/items/:id/image` (`requireStore`) — raw binary body,
  `Content-Type` must be `image/jpeg | image/png | image/webp`, size
  cap 1 MB (413 otherwise). Writes to the `IMAGES` R2 bucket under key
  `menu/{store_id}/{item_id}/{random}.{ext}` (the random segment makes
  each upload a new immutable URL, avoiding stale caches on
  replacement), updates `menu_items.image_key`, and best-effort-deletes
  the previous object. Returns the updated item.
- `DELETE /api/menu/items/:id/image` — clears `image_key` and deletes
  the object, best-effort. No-op success if the item has no image.
- `GET /api/menu/images/:key` — public, no auth (menu photos are public
  by nature; the key acts as an unguessable capability). Streams the R2
  object with `Cache-Control: public, max-age=31536000, immutable` and
  `X-Content-Type-Options: nosniff`. Rejects keys outside the `menu/`
  prefix as defense-in-depth.
- Resizing happens client-side (`apps/admin/src/lib/downscaleImage.ts`):
  canvas downscale to max 1200 px long edge, re-encoded as JPEG at
  ~0.8 quality, before upload. Workers cannot resize images natively
  and Cloudflare Images is a paid product.

### Item options / modifiers (`/api/menu/option-groups`)

Option groups are **store-level and reusable across items** (a "Size"
group attaches to every drink; per-item groups would force
duplication). See
[domain-model](../domain-model.md#entity-overview) for the schema.

- `GET` / `POST /api/menu/option-groups` — list / create. Fields: name
  (1–100 chars), `min_select` (int ≥ 0, default 0), `max_select` (int
  ≥ 1, default 1), `sort_order`. `min_select ≤ max_select` enforced.
- `PATCH` / `DELETE /api/menu/option-groups/:id` — full-replace update
  (like categories, not omit-preserves like items); delete cascades to
  the group's options and its attachments to items in one `db.batch`.
- `GET` / `POST /api/menu/option-groups/:groupId/options` — nested
  option list / create. Fields: name (1–100 chars), `price_delta` (int
  JPY, **may be negative**, no bound — the resulting unit price must
  stay positive, enforced at order-submission time not here),
  `sort_order`.
- `PATCH` / `DELETE /api/menu/option-groups/:groupId/options/:optionId`
  — full-replace update / delete.
- Attach/detach on the item form: `PATCH /api/menu/items/:id` accepts
  `option_group_ids: string[]` (omit preserves the current attachment
  set, matching the rest of that endpoint's omit-preserves semantics;
  `[]` detaches all). `GET`/`POST`/`PATCH` item responses embed
  `option_group_ids`.

## Known limitations (→ roadmap)

- **No allergen / dietary info.** (Phase 3, alongside descriptions)
- **No tax-rate metadata** — needed for 8%/10% receipt breakdown.
  (Phase 4)
- **No menu scheduling** — no lunch/dinner menus or time-limited items.
  (Backlog)
- Deleting an item that sits in an *active* order is allowed; the order
  keeps its snapshot but the kitchen may be surprised. Acceptable for
  now; revisit with cancellation work. (Phase 2, note only)
- **No optimistic-concurrency guard on image upload** — two concurrent
  uploads to the *same* item (e.g. two admin tabs) can leak the losing
  request's R2 object (it's written before the DB update, and only the
  request that read the "old" key deletes it). Same-tenant only,
  storage-cost impact, not a cross-tenant exposure. Revisit if it comes
  up in practice.
- Photo content is not verified to match its declared `Content-Type`
  (no magic-byte check) — `X-Content-Type-Options: nosniff` on the
  serving endpoint is the mitigation, not a substitute for validation.
  Acceptable v1 trade-off given uploads require an authenticated store
  session.
- Allergen/dietary labels and category images / multiple photos per
  item are deferred, not designed here.
