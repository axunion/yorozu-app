import { errorResponse, now, sumOrderItems } from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, asc, eq, gt, inArray, ne } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthEnv, requireStore } from "../middleware";
import {
  attachOrderItemOptions,
  mapOrderItem,
  type OrderItemPayload,
} from "../order-item";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AdminOrderPayload = {
  id: string;
  seat_name: string;
  status: string;
  items: OrderItemPayload[];
  total: number;
  created_at: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps an order_items row to the item-mutation response shape (includes
 * order_id, unlike mapOrderItem which is embedded in a parent order payload).
 */
async function mapAdminOrderItem(
  db: ReturnType<typeof createDb>,
  storeId: string,
  item: {
    id: string;
    order_id: string;
    name_snapshot: string;
    unit_price_snapshot: number;
    quantity: number;
    status: string;
    note: string | null;
    created_at: number;
  },
) {
  const [withOptions] = await attachOrderItemOptions(db, storeId, [item]);
  return {
    id: item.id,
    order_id: item.order_id,
    name_snapshot: item.name_snapshot,
    unit_price_snapshot: item.unit_price_snapshot,
    quantity: item.quantity,
    status: item.status,
    created_at: item.created_at,
    note: item.note,
    options: withOptions?.options ?? [],
  };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const adminOrdersRouter = new Hono<AuthEnv>()
  .use(requireStore)

  /**
   * GET /api/admin/orders
   * Returns all active orders (status 'open' or 'payment_requested') for the
   * authenticated store, including their line items and running total.
   *
   * Optional query parameter:
   *   ?since=<unix_ms>  — when provided, returns only orders whose created_at
   *                       is strictly greater than the given timestamp.
   *
   * Response: 200 { data: AdminOrderPayload[] }
   */
  .get("/", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    // Parse optional ?since= query parameter
    const sinceRaw = c.req.query("since");
    const sinceMs = sinceRaw !== undefined ? Number(sinceRaw) : undefined;

    // Fetch active orders for the store, optionally filtered by created_at
    const ordersRows = await db
      .select({
        id: schema.orders.id,
        seat_id: schema.orders.seat_id,
        status: schema.orders.status,
        created_at: schema.orders.created_at,
      })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.store_id, storeId),
          inArray(schema.orders.status, ["open", "payment_requested"]),
          sinceMs !== undefined
            ? gt(schema.orders.created_at, sinceMs)
            : undefined,
        ),
      )
      .orderBy(asc(schema.orders.created_at));

    if (ordersRows.length === 0) {
      return c.json({ data: [] });
    }

    // Fetch seat names and order items in parallel — both depend only on ordersRows
    const seatIds = ordersRows.map((o) => o.seat_id);
    const orderIds = ordersRows.map((o) => o.id);

    const [seatsRows, itemsRows] = await Promise.all([
      db
        .select({ id: schema.seats.id, name: schema.seats.name })
        .from(schema.seats)
        .where(
          and(
            eq(schema.seats.store_id, storeId),
            inArray(schema.seats.id, seatIds),
          ),
        ),
      db
        .select()
        .from(schema.orderItems)
        .where(
          and(
            eq(schema.orderItems.store_id, storeId),
            inArray(schema.orderItems.order_id, orderIds),
          ),
        )
        .orderBy(asc(schema.orderItems.created_at)),
    ]);
    const seatNameById = new Map(seatsRows.map((s) => [s.id, s.name]));
    const itemsWithOptions = await attachOrderItemOptions(
      db,
      storeId,
      itemsRows,
    );

    // Group items by order_id
    const itemsByOrderId = new Map<string, typeof itemsWithOptions>();
    for (const item of itemsWithOptions) {
      const list = itemsByOrderId.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrderId.set(item.order_id, list);
    }

    // Assemble the response payload
    const data: AdminOrderPayload[] = ordersRows.map((order) => {
      const items = itemsByOrderId.get(order.id) ?? [];
      return {
        id: order.id,
        seat_name: seatNameById.get(order.seat_id) ?? "",
        status: order.status,
        items: items.map(mapOrderItem),
        total: sumOrderItems(items),
        created_at: order.created_at,
      };
    });

    return c.json({ data });
  })

  /**
   * PATCH /api/admin/orders/items/:id/serve
   * Marks a single order item as 'served'.
   *
   * Idempotent: if the item is already 'served', returns 200 with the current
   * state without re-updating the DB.
   *
   * Multi-tenant safe: the store_id filter prevents cross-tenant access.
   * Returns 404 (not 403) for items that don't belong to the store to avoid
   * enumeration leaks, consistent with the NOT_FOUND convention.
   *
   * Response: 200 { data: { id, status, ... } }
   */
  .patch("/items/:id/serve", async (c) => {
    const { id: storeId } = c.var.store;
    const itemId = c.req.param("id");
    const db = createDb(c.env.DB);

    // Single UPDATE + RETURNING handles 404, idempotency, and transition in one round-trip.
    // Returns 0 rows when item not found or belongs to another store → 404.
    // Returns the row regardless of prior status, so already-served items return 200 idempotently.
    const updated = await db
      .update(schema.orderItems)
      .set({ status: "served" })
      .where(
        and(
          eq(schema.orderItems.id, itemId),
          eq(schema.orderItems.store_id, storeId),
        ),
      )
      .returning();

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "注文明細が見つかりません。", 404);
    }

    return c.json({ data: await mapAdminOrderItem(db, storeId, result) });
  })

  /**
   * PATCH /api/admin/orders/items/:id/cancel
   * Voids a single order item: 'ordered' | 'served' → 'cancelled'.
   *
   * Idempotent: if the item is already 'cancelled', returns 200 unchanged.
   * Returns 409 if the parent order is 'paid' or 'cancelled' — once an
   * order is settled or void, its items are frozen.
   *
   * Multi-tenant safe: store_id filters throughout; 404 (not 403) on miss.
   *
   * Response: 200 { data: { id, status, ... } }
   */
  .patch("/items/:id/cancel", async (c) => {
    const { id: storeId } = c.var.store;
    const itemId = c.req.param("id");
    const db = createDb(c.env.DB);

    const itemRows = await db
      .select()
      .from(schema.orderItems)
      .where(
        and(
          eq(schema.orderItems.id, itemId),
          eq(schema.orderItems.store_id, storeId),
        ),
      )
      .limit(1);
    const item = itemRows[0];
    if (!item) {
      return errorResponse("NOT_FOUND", "注文明細が見つかりません。", 404);
    }

    if (item.status === "cancelled") {
      return c.json({ data: await mapAdminOrderItem(db, storeId, item) });
    }

    const orderRows = await db
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, item.order_id),
          eq(schema.orders.store_id, storeId),
        ),
      )
      .limit(1);
    const order = orderRows[0];
    if (!order || order.status === "paid" || order.status === "cancelled") {
      return errorResponse(
        "CONFLICT",
        "会計済みまたはキャンセル済みの注文の明細は取り消せません。",
        409,
      );
    }

    const updated = await db
      .update(schema.orderItems)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(schema.orderItems.id, itemId),
          eq(schema.orderItems.store_id, storeId),
        ),
      )
      .returning();

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "注文明細が見つかりません。", 404);
    }

    return c.json({ data: await mapAdminOrderItem(db, storeId, result) });
  })

  /**
   * PATCH /api/admin/orders/items/:id/unserve
   * Reverts a single order item: 'served' → 'ordered'.
   *
   * Idempotent: if the item is already 'ordered', returns 200 unchanged.
   * Returns 409 if the item is 'cancelled', or if the parent order is not
   * active (i.e. not 'open' or 'payment_requested').
   *
   * Multi-tenant safe: store_id filters throughout; 404 (not 403) on miss.
   *
   * Response: 200 { data: { id, status, ... } }
   */
  .patch("/items/:id/unserve", async (c) => {
    const { id: storeId } = c.var.store;
    const itemId = c.req.param("id");
    const db = createDb(c.env.DB);

    const itemRows = await db
      .select()
      .from(schema.orderItems)
      .where(
        and(
          eq(schema.orderItems.id, itemId),
          eq(schema.orderItems.store_id, storeId),
        ),
      )
      .limit(1);
    const item = itemRows[0];
    if (!item) {
      return errorResponse("NOT_FOUND", "注文明細が見つかりません。", 404);
    }

    if (item.status === "cancelled") {
      return errorResponse(
        "CONFLICT",
        "キャンセル済みの明細は元に戻せません。",
        409,
      );
    }

    const orderRows = await db
      .select({ status: schema.orders.status })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.id, item.order_id),
          eq(schema.orders.store_id, storeId),
        ),
      )
      .limit(1);
    const order = orderRows[0];
    if (
      !order ||
      (order.status !== "open" && order.status !== "payment_requested")
    ) {
      return errorResponse("CONFLICT", "この注文は操作できない状態です。", 409);
    }

    if (item.status === "ordered") {
      return c.json({ data: await mapAdminOrderItem(db, storeId, item) });
    }

    const updated = await db
      .update(schema.orderItems)
      .set({ status: "ordered" })
      .where(
        and(
          eq(schema.orderItems.id, itemId),
          eq(schema.orderItems.store_id, storeId),
        ),
      )
      .returning();

    const result = updated[0];
    if (!result) {
      return errorResponse("NOT_FOUND", "注文明細が見つかりません。", 404);
    }

    return c.json({ data: await mapAdminOrderItem(db, storeId, result) });
  })

  /**
   * PATCH /api/admin/orders/:id/reopen
   * Sends a pending bill back to the table: 'payment_requested' → 'open'.
   *
   * Idempotent: if the order is already 'open', returns 200 unchanged.
   * Returns 409 if the order is 'paid' or 'cancelled' (terminal states).
   *
   * Multi-tenant safe: store_id filter; 404 (not 403) on miss.
   *
   * Response: 200 { data: { id, status } }
   */
  .patch("/:id/reopen", async (c) => {
    const { id: storeId } = c.var.store;
    const orderId = c.req.param("id");
    const db = createDb(c.env.DB);

    const orderRows = await db
      .select()
      .from(schema.orders)
      .where(
        and(eq(schema.orders.id, orderId), eq(schema.orders.store_id, storeId)),
      )
      .limit(1);
    const order = orderRows[0];
    if (!order) {
      return errorResponse("NOT_FOUND", "注文が見つかりません。", 404);
    }

    if (order.status === "open") {
      return c.json({ data: { id: order.id, status: "open" } });
    }

    if (order.status === "paid" || order.status === "cancelled") {
      return errorResponse(
        "CONFLICT",
        "会計済みまたはキャンセル済みの注文は席に戻せません。",
        409,
      );
    }

    await db
      .update(schema.orders)
      .set({ status: "open" })
      .where(
        and(eq(schema.orders.id, orderId), eq(schema.orders.store_id, storeId)),
      );

    return c.json({ data: { id: order.id, status: "open" } });
  })

  /**
   * PATCH /api/admin/orders/:id/cancel
   * Cancels a whole order (walkout, mistaken table): 'open' |
   * 'payment_requested' → 'cancelled'. Also cancels every non-cancelled
   * item on the order in the same atomic batch.
   *
   * Idempotent: if the order is already 'cancelled', returns 200 unchanged.
   * Returns 409 if the order is 'paid'.
   *
   * Multi-tenant safe: store_id filter; 404 (not 403) on miss.
   *
   * Response: 200 { data: { id, status } }
   */
  .patch("/:id/cancel", async (c) => {
    const { id: storeId } = c.var.store;
    const orderId = c.req.param("id");
    const db = createDb(c.env.DB);

    const orderRows = await db
      .select()
      .from(schema.orders)
      .where(
        and(eq(schema.orders.id, orderId), eq(schema.orders.store_id, storeId)),
      )
      .limit(1);
    const order = orderRows[0];
    if (!order) {
      return errorResponse("NOT_FOUND", "注文が見つかりません。", 404);
    }

    if (order.status === "cancelled") {
      return c.json({ data: { id: order.id, status: "cancelled" } });
    }

    if (order.status === "paid") {
      return errorResponse(
        "CONFLICT",
        "会計済みの注文はキャンセルできません。",
        409,
      );
    }

    const closedAt = now();
    await db.batch([
      db
        .update(schema.orders)
        .set({ status: "cancelled", closed_at: closedAt })
        .where(
          and(
            eq(schema.orders.id, orderId),
            eq(schema.orders.store_id, storeId),
          ),
        ),
      db
        .update(schema.orderItems)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(schema.orderItems.order_id, orderId),
            eq(schema.orderItems.store_id, storeId),
            ne(schema.orderItems.status, "cancelled"),
          ),
        ),
    ]);

    return c.json({ data: { id: order.id, status: "cancelled" } });
  });
