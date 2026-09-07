import {
  CreateSeatInput,
  errorResponse,
  newId,
  UpdateSeatInput,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthEnv, requireOwner, requireStore } from "../middleware";
import { bodyValidator } from "../validator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True if the seat has an order in an active (not yet closed) status. */
async function hasActiveOrder(
  db: ReturnType<typeof createDb>,
  seatId: string,
  storeId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.orders.id })
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.seat_id, seatId),
        eq(schema.orders.store_id, storeId),
        inArray(schema.orders.status, ["open", "payment_requested"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const seatsRouter = new Hono<AuthEnv>()
  .use(requireStore)
  .use(requireOwner)

  /**
   * GET /api/seats
   * Returns active seats for the authenticated store, ordered by created_at.
   * ?include_inactive=true also returns retired seats (admin history views).
   */
  .get("/", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);
    const includeInactive = c.req.query("include_inactive") === "true";
    const rows = await db
      .select()
      .from(schema.seats)
      .where(
        includeInactive
          ? eq(schema.seats.store_id, storeId)
          : and(
              eq(schema.seats.store_id, storeId),
              eq(schema.seats.is_active, true),
            ),
      )
      .orderBy(asc(schema.seats.created_at));
    return c.json({ data: rows });
  })

  /**
   * POST /api/seats
   * Creates a new seat for the authenticated store.
   * Generates a unique qr_token (UUID v4) embedded in /order/:qr_token URLs.
   * Response: 201 { data: { id, store_id, name, qr_token, is_active, created_at } }
   */
  .post("/", bodyValidator(CreateSeatInput), async (c) => {
    const { id: storeId } = c.var.store;
    const { name } = c.req.valid("json");
    const id = newId();
    const qr_token = newId();
    const db = createDb(c.env.DB);
    let returning: (typeof schema.seats.$inferSelect)[];
    try {
      returning = await db
        .insert(schema.seats)
        .values({ id, store_id: storeId, name, qr_token })
        .returning();
    } catch {
      return errorResponse(
        "INTERNAL_ERROR",
        "座席の作成に失敗しました。再度お試しください。",
        500,
      );
    }
    return c.json({ data: returning[0] }, 201);
  })

  /**
   * PATCH /api/seats/:id
   * Renames a seat owned by the authenticated store.
   * Response: 200 { data: <seat> }
   */
  .patch("/:id", bodyValidator(UpdateSeatInput), async (c) => {
    const { id: storeId } = c.var.store;
    const seatId = c.req.param("id");
    const { name } = c.req.valid("json");
    const db = createDb(c.env.DB);

    const updated = await db
      .update(schema.seats)
      .set({ name })
      .where(
        and(eq(schema.seats.id, seatId), eq(schema.seats.store_id, storeId)),
      )
      .returning();

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "Seat not found", 404);
    }
    return c.json({ data: result });
  })

  /**
   * DELETE /api/seats/:id
   * Soft-deletes (retires) a seat: sets is_active = false. The row — and its
   * name — survives forever so historical orders/sales keep working.
   *
   * Idempotent: already-inactive seats return 200 unchanged.
   * Returns 409 if the seat has an active (open/payment_requested) order.
   * Returns 404 if not found or owned by a different store.
   */
  .delete("/:id", async (c) => {
    const { id: storeId } = c.var.store;
    const seatId = c.req.param("id");
    const db = createDb(c.env.DB);

    const existing = await db
      .select({ id: schema.seats.id, is_active: schema.seats.is_active })
      .from(schema.seats)
      .where(
        and(eq(schema.seats.id, seatId), eq(schema.seats.store_id, storeId)),
      )
      .limit(1);
    const seat = existing[0];
    if (!seat) {
      return errorResponse("NOT_FOUND", "Seat not found", 404);
    }

    if (!seat.is_active) {
      return c.json({ data: { id: seatId, is_active: false } });
    }

    if (await hasActiveOrder(db, seatId, storeId)) {
      return errorResponse(
        "CONFLICT",
        "進行中の注文があるため座席を無効化できません。",
        409,
      );
    }

    await db
      .update(schema.seats)
      .set({ is_active: false })
      .where(
        and(eq(schema.seats.id, seatId), eq(schema.seats.store_id, storeId)),
      );

    return c.json({ data: { id: seatId, is_active: false } });
  })

  /**
   * POST /api/seats/:id/rotate-qr
   * Generates a fresh qr_token for a seat owned by the authenticated store.
   * The old printed QR code 404s immediately afterward.
   *
   * Returns 409 while the seat has an active order (rotating mid-meal would
   * strand the customer's in-progress order).
   * Returns 404 if not found or owned by a different store.
   * Response: 200 { data: <seat> }
   */
  .post("/:id/rotate-qr", async (c) => {
    const { id: storeId } = c.var.store;
    const seatId = c.req.param("id");
    const db = createDb(c.env.DB);

    const existing = await db
      .select({ id: schema.seats.id })
      .from(schema.seats)
      .where(
        and(eq(schema.seats.id, seatId), eq(schema.seats.store_id, storeId)),
      )
      .limit(1);
    if (existing.length === 0) {
      return errorResponse("NOT_FOUND", "Seat not found", 404);
    }

    if (await hasActiveOrder(db, seatId, storeId)) {
      return errorResponse(
        "CONFLICT",
        "進行中の注文があるためQRコードを再発行できません。",
        409,
      );
    }

    const updated = await db
      .update(schema.seats)
      .set({ qr_token: newId() })
      .where(
        and(eq(schema.seats.id, seatId), eq(schema.seats.store_id, storeId)),
      )
      .returning();

    return c.json({ data: updated[0] });
  });
