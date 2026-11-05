import {
  AddOrderItemsInput,
  computeTaxBreakdown,
  errorResponse,
  newId,
  now,
  sumOrderItems,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireSeat, type SeatEnv } from "../middleware";
import { attachOrderItemOptions, mapOrderItem } from "../order-item";
import {
  addItemsToSeatOrder,
  fetchOrderableMenu,
  findActiveOrder,
  getActiveOrderWithItems,
} from "../seat-order";
import { bodyValidator } from "../validator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the seat's open staff call, or null if none exists.
 *
 * Extracted as a helper because the same WHERE clause is used in the GET
 * bootstrap and POST /call handlers.
 */
async function findOpenCall(
  db: ReturnType<typeof createDb>,
  seatId: string,
  storeId: string,
) {
  const rows = await db
    .select()
    .from(schema.staffCalls)
    .where(
      and(
        eq(schema.staffCalls.seat_id, seatId),
        eq(schema.staffCalls.store_id, storeId),
        eq(schema.staffCalls.status, "open"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const orderRouter = new Hono<SeatEnv>()
  /**
   * GET /api/order/:seatToken
   * Bootstrap endpoint: returns seat info, available menu, and the active order
   * (if any) for the given seat.
   *
   * Used by the customer order screen on initial load.
   */
  .get("/:seatToken", requireSeat, async (c) => {
    const { id: seatId, store_id: storeId, name: seatName } = c.var.seat;
    const db = createDb(c.env.DB);

    const [menu, order, call] = await Promise.all([
      fetchOrderableMenu(db, storeId),
      getActiveOrderWithItems(db, seatId, storeId),
      findOpenCall(db, seatId, storeId),
    ]);

    return c.json({
      data: {
        seat: { name: seatName },
        menu,
        order,
        call,
      },
    });
  })

  /**
   * POST /api/order/:seatToken/call
   * Creates an open call-staff request for the seat.
   *
   * Idempotent per seat: if an open call already exists, returns it with
   * 200 instead of creating a duplicate — this also throttles repeated
   * taps to at most one outstanding call per table. The partial unique
   * index idx_one_open_call_per_seat makes concurrent first-taps safe.
   *
   * Response: 201 (new call) or 200 (existing open call), both with
   * { data: { id, status, created_at } }.
   */
  .post("/:seatToken/call", requireSeat, async (c) => {
    const { id: seatId, store_id: storeId } = c.var.seat;
    const db = createDb(c.env.DB);

    const existing = await findOpenCall(db, seatId, storeId);
    if (existing) {
      return c.json({
        data: {
          id: existing.id,
          status: existing.status,
          created_at: existing.created_at,
        },
      });
    }

    const id = newId();
    const created_at = now();
    try {
      await db.insert(schema.staffCalls).values({
        id,
        store_id: storeId,
        seat_id: seatId,
        status: "open",
        created_at,
      });
    } catch {
      // A concurrent request may have created the call first (unique
      // constraint on the partial index). Re-fetch to distinguish that
      // from a real error.
      const concurrent = await findOpenCall(db, seatId, storeId);
      if (!concurrent) {
        return errorResponse(
          "INTERNAL_ERROR",
          "呼び出しの処理中にエラーが発生しました。再度お試しください。",
          500,
        );
      }
      return c.json({
        data: {
          id: concurrent.id,
          status: concurrent.status,
          created_at: concurrent.created_at,
        },
      });
    }

    return c.json({ data: { id, status: "open" as const, created_at } }, 201);
  })

  /**
   * POST /api/order/:seatToken/items
   * Adds one or more items to the active order for the seat.
   * Creates a new order (status 'open') on the first call (lazy creation).
   *
   * Returns 409 if the order is already in 'payment_requested' state.
   * Returns 404 if any menu_item_id does not exist for the store.
   * Returns 409 if any menu item is not available (is_available = false).
   *
   * Response: 201 (new order created) or 200 (items added to existing order),
   * both with { data: { order } } containing the updated full order state.
   */
  .post(
    "/:seatToken/items",
    requireSeat,
    bodyValidator(AddOrderItemsInput),
    async (c) => {
      const { id: seatId, store_id: storeId } = c.var.seat;
      const { items: inputItems } = c.req.valid("json");
      const db = createDb(c.env.DB);

      const result = await addItemsToSeatOrder(db, storeId, seatId, inputItems);
      if (result instanceof Response) return result;
      // 201 when a new order record was created; 200 when items were appended to
      // an existing order, so clients can distinguish the two cases.
      return c.json(
        { data: { order: result.order } },
        result.created ? 201 : 200,
      );
    },
  )

  /**
   * PATCH /api/order/:seatToken/request-payment
   * Transitions the active order from 'open' to 'payment_requested'.
   *
   * Idempotent: returns 200 if the order is already 'payment_requested'.
   * Returns 409 if there is no active order to request payment for.
   */
  .patch("/:seatToken/request-payment", requireSeat, async (c) => {
    const { id: seatId, store_id: storeId } = c.var.seat;
    const db = createDb(c.env.DB);

    const order = await findActiveOrder(db, seatId, storeId);

    if (!order) {
      return errorResponse(
        "CONFLICT",
        "会計要求できるアクティブな注文がありません。",
        409,
      );
    }

    // Already payment_requested — idempotent 200
    if (order.status === "payment_requested") {
      return c.json({ data: { id: order.id, status: order.status } });
    }

    // Transition open → payment_requested
    await db
      .update(schema.orders)
      .set({ status: "payment_requested" })
      .where(
        and(
          eq(schema.orders.id, order.id),
          eq(schema.orders.store_id, storeId),
        ),
      );

    return c.json({ data: { id: order.id, status: "payment_requested" } });
  })

  /**
   * GET /api/order/:seatToken/receipt/:orderId
   * Returns the digital receipt for a paid order.
   *
   * Seat-scoped: the order must belong to the requesting seat (not just
   * the store), so the URL isn't guessable beyond what the QR code
   * already grants. 404 if the order doesn't exist, belongs to another
   * seat, or hasn't reached 'paid' status yet.
   */
  .get("/:seatToken/receipt/:orderId", requireSeat, async (c) => {
    const { id: seatId, store_id: storeId, name: seatName } = c.var.seat;
    const orderId = c.req.param("orderId");
    const db = createDb(c.env.DB);

    const orderRows = await db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, orderId),
          eq(schema.orders.seat_id, seatId),
          eq(schema.orders.store_id, storeId),
          eq(schema.orders.status, "paid"),
        ),
      )
      .limit(1);
    const order = orderRows[0];
    if (!order) {
      return errorResponse("NOT_FOUND", "レシートが見つかりません。", 404);
    }

    const [paymentRows, storeRows, items] = await Promise.all([
      db
        .select()
        .from(schema.payments)
        .where(
          and(
            eq(schema.payments.order_id, orderId),
            eq(schema.payments.store_id, storeId),
          ),
        )
        .limit(1),
      db
        .select({ name: schema.stores.name })
        .from(schema.stores)
        .where(eq(schema.stores.id, storeId))
        .limit(1),
      db
        .select()
        .from(schema.orderItems)
        .where(
          and(
            eq(schema.orderItems.order_id, orderId),
            eq(schema.orderItems.store_id, storeId),
          ),
        )
        .orderBy(asc(schema.orderItems.created_at)),
    ]);

    // A paid order always has a payment row (the transition is atomic with
    // the payment INSERT in POST /api/payments); guard defensively anyway.
    const payment = paymentRows[0];
    if (!payment) {
      return errorResponse("NOT_FOUND", "レシートが見つかりません。", 404);
    }

    const itemsWithOptions = await attachOrderItemOptions(db, storeId, items);
    const taxBreakdown = computeTaxBreakdown(itemsWithOptions);

    return c.json({
      data: {
        order_id: order.id,
        store_name: storeRows[0]?.name ?? "",
        seat_name: seatName,
        items: itemsWithOptions.map(mapOrderItem),
        items_total: sumOrderItems(itemsWithOptions),
        discount_amount: payment.discount_amount,
        discount_reason: payment.discount_reason,
        total_amount: payment.total_amount,
        tax_breakdown: taxBreakdown.map((bucket) => ({
          rate: bucket.rate,
          taxable_amount: bucket.taxableAmount,
          tax_amount: bucket.taxAmount,
        })),
        method: payment.method,
        paid_at: payment.paid_at,
      },
    });
  });
