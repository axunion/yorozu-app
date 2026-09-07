import {
  CreatePaymentInput,
  CreateVoidInput,
  errorResponse,
  newId,
  now,
  type PaymentMethod,
  sumOrderItems,
} from "@yorozu/core";
import { createDb, schema } from "@yorozu/db";
import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { Hono } from "hono";
import { type AuthEnv, requireStore } from "../middleware";
import {
  attachOrderItemOptions,
  mapOrderItem,
  type OrderItemPayload,
} from "../order-item";
import { bodyValidator } from "../validator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pending checkout order returned by GET /api/payments/pending. */
type PendingCheckPayload = {
  id: string;
  seat_name: string;
  status: string;
  items: OrderItemPayload[];
  total: number;
  created_at: number;
};

/** Completed payment returned by GET /api/payments. */
type PaymentHistoryPayload = {
  id: string;
  order_id: string;
  seat_name: string;
  total_amount: number;
  method: PaymentMethod;
  discount_amount: number;
  discount_reason: string | null;
  paid_at: number;
  voided_at: number | null;
  void_reason: string | null;
  items: OrderItemPayload[];
};

/** Sales-history date range is capped at 62 days (~2 months). */
const MAX_RANGE_MS = 62 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const paymentsRouter = new Hono<AuthEnv>()
  .use(requireStore)

  /**
   * GET /api/payments?from=<unix_ms>&to=<unix_ms>
   * Returns completed payments for the authenticated store with
   * `paid_at` in `[from, to)`, newest first, each joined with its
   * order's seat name and line items (cancelled lines are included and
   * flagged by status — they explain the bill, but their amounts are
   * already excluded from `total_amount`).
   *
   * Validation (400 VALIDATION_ERROR): both params required, integers,
   * from < to, and range <= 62 days.
   *
   * Response: 200 { data: PaymentHistoryPayload[] }
   */
  .get("/", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    const fromRaw = c.req.query("from");
    const toRaw = c.req.query("to");
    if (fromRaw === undefined || toRaw === undefined) {
      return errorResponse("VALIDATION_ERROR", "from と to は必須です。", 400);
    }

    const from = Number(fromRaw);
    const to = Number(toRaw);
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return errorResponse(
        "VALIDATION_ERROR",
        "from と to は整数のUnixミリ秒で指定してください。",
        400,
      );
    }
    if (from >= to) {
      return errorResponse(
        "VALIDATION_ERROR",
        "from は to より前の値である必要があります。",
        400,
      );
    }
    if (to - from > MAX_RANGE_MS) {
      return errorResponse(
        "VALIDATION_ERROR",
        "期間は62日以内で指定してください。",
        400,
      );
    }

    const paymentsRows = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.store_id, storeId),
          gte(schema.payments.paid_at, from),
          lt(schema.payments.paid_at, to),
        ),
      )
      .orderBy(desc(schema.payments.paid_at));

    if (paymentsRows.length === 0) {
      return c.json({ data: [] });
    }

    const orderIds = paymentsRows.map((p) => p.order_id);

    const [ordersRows, itemsRows] = await Promise.all([
      db
        .select({ id: schema.orders.id, seat_id: schema.orders.seat_id })
        .from(schema.orders)
        .where(
          and(
            eq(schema.orders.store_id, storeId),
            inArray(schema.orders.id, orderIds),
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

    const seatIds = ordersRows.map((o) => o.seat_id);
    const seatsRows = await db
      .select({ id: schema.seats.id, name: schema.seats.name })
      .from(schema.seats)
      .where(
        and(
          eq(schema.seats.store_id, storeId),
          inArray(schema.seats.id, seatIds),
        ),
      );
    const seatNameById = new Map(seatsRows.map((s) => [s.id, s.name]));
    const seatNameByOrderId = new Map(
      ordersRows.map((o) => [o.id, seatNameById.get(o.seat_id) ?? ""]),
    );

    const itemsWithOptions = await attachOrderItemOptions(
      db,
      storeId,
      itemsRows,
    );
    const itemsByOrderId = new Map<string, typeof itemsWithOptions>();
    for (const item of itemsWithOptions) {
      const list = itemsByOrderId.get(item.order_id) ?? [];
      list.push(item);
      itemsByOrderId.set(item.order_id, list);
    }

    const data: PaymentHistoryPayload[] = paymentsRows.map((payment) => ({
      id: payment.id,
      order_id: payment.order_id,
      seat_name: seatNameByOrderId.get(payment.order_id) ?? "",
      total_amount: payment.total_amount,
      method: payment.method,
      discount_amount: payment.discount_amount,
      discount_reason: payment.discount_reason,
      paid_at: payment.paid_at,
      voided_at: payment.voided_at,
      void_reason: payment.void_reason,
      items: (itemsByOrderId.get(payment.order_id) ?? []).map(mapOrderItem),
    }));

    return c.json({ data });
  })

  /**
   * GET /api/payments/pending
   * Returns all orders in 'payment_requested' status for the authenticated store,
   * including their line items and running total.
   *
   * Used by the checkout screen to display bills awaiting payment.
   *
   * Response: 200 { data: PendingCheckPayload[] }
   */
  .get("/pending", async (c) => {
    const { id: storeId } = c.var.store;
    const db = createDb(c.env.DB);

    // Fetch only payment_requested orders for this store
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
          eq(schema.orders.status, "payment_requested"),
        ),
      )
      .orderBy(asc(schema.orders.created_at));

    if (ordersRows.length === 0) {
      return c.json({ data: [] });
    }

    // Fetch seat names and order items in parallel
    // The partial UNIQUE index on seat_id (for active orders) guarantees one
    // payment_requested order per seat, so deduplication is unnecessary.
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
    const data: PendingCheckPayload[] = ordersRows.map((order) => {
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
   * POST /api/payments
   * Completes payment for a 'payment_requested' order. `method` records
   * which payment method the customer used at a staff-operated
   * terminal ('cash' | 'card' | 'qr'); defaults to 'cash' when omitted.
   * No processor integration — this is a record, not a charge.
   *
   * Steps:
   *  1. Fetch the order by order_id + store_id (404 if not found).
   *  2. Reject with 409 if order is not in 'payment_requested' status.
   *  3. Fetch order items; reject with 409 if there are none.
   *  4. INSERT payment + UPDATE order atomically via db.batch().
   *
   * Atomicity: db.batch() wraps both writes in an implicit D1 transaction.
   * If either statement fails the entire batch is rolled back, preventing
   * orphaned payment records when the order UPDATE would have failed.
   *
   * Duplicate payment detection: the UNIQUE constraint on payments.order_id
   * blocks concurrent payments for the same order. The error message is checked
   * to distinguish UNIQUE violations (409) from other DB failures (500).
   *
   * `discount_amount`/`discount_reason` apply a whole-check discount:
   * the client sends the discount, never the total — total_amount is
   * always server-computed as (items total − discount_amount), bounded
   * to [0, items total]. A discount > 0 requires a reason (400 if not).
   *
   * Response: 201 { data: { id, order_id, total_amount, method,
   * discount_amount, discount_reason, paid_at } }
   */
  .post("/", bodyValidator(CreatePaymentInput), async (c) => {
    const { id: storeId } = c.var.store;
    const {
      order_id: orderId,
      method,
      discount_amount: discountAmount,
      discount_reason: discountReason,
    } = c.req.valid("json");
    const db = createDb(c.env.DB);

    // --- Step 1: Fetch the order, verifying store ownership ---
    // Always filter by store_id to prevent cross-tenant access.
    // Return 404 (not 403) to avoid enumeration leaks.
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

    // --- Step 2: Validate status transition ---
    // Only 'payment_requested' orders can be checked out.
    if (order.status !== "payment_requested") {
      return errorResponse(
        "CONFLICT",
        order.status === "paid"
          ? "この注文は既に会計済みです。"
          : "会計要求がされていない注文です。",
        409,
      );
    }

    // --- Step 3: Fetch items and calculate total ---
    const items = await db
      .select()
      .from(schema.orderItems)
      .where(
        and(
          eq(schema.orderItems.order_id, orderId),
          eq(schema.orderItems.store_id, storeId),
        ),
      );

    // Guard: an order with no non-cancelled items should not be billed.
    if (items.every((item) => item.status === "cancelled")) {
      return errorResponse(
        "CONFLICT",
        "注文明細がありません。会計できません。",
        409,
      );
    }

    const itemsWithOptions = await attachOrderItemOptions(db, storeId, items);
    const itemsTotal = sumOrderItems(itemsWithOptions);

    // --- Step 3.5: Bound the discount to the server-computed items total ---
    // The client sends only the discount; it can never affect the total
    // via any other field, and the discount itself is rejected if it
    // would exceed what's actually on the bill.
    if (discountAmount > itemsTotal) {
      return errorResponse(
        "VALIDATION_ERROR",
        "割引額が明細合計を超えています。",
        400,
      );
    }
    const totalAmount = itemsTotal - discountAmount;
    const paidAt = now();
    const paymentId = newId();

    // --- Steps 4 & 5: Atomically INSERT payment and UPDATE order ---
    // db.batch() wraps both statements in an implicit D1 transaction: if either
    // fails the entire batch is rolled back, preventing an orphaned payment row
    // when the order UPDATE would have failed.
    //
    // UNIQUE constraint violation (concurrent duplicate payment) is identified
    // by the error message so we can return 409 instead of 500. Any other DB
    // failure (connection error, disk full, etc.) is surfaced as 500 so the
    // client can distinguish a real infrastructure problem from a duplicate.
    try {
      await db.batch([
        db.insert(schema.payments).values({
          id: paymentId,
          store_id: storeId,
          order_id: orderId,
          total_amount: totalAmount,
          method,
          discount_amount: discountAmount,
          discount_reason: discountReason,
          paid_at: paidAt,
        }),
        db
          .update(schema.orders)
          .set({ status: "paid", closed_at: paidAt })
          .where(
            and(
              eq(schema.orders.id, orderId),
              eq(schema.orders.store_id, storeId),
            ),
          ),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE constraint failed")) {
        return errorResponse("CONFLICT", "この注文は既に会計済みです。", 409);
      }
      return errorResponse(
        "INTERNAL_ERROR",
        "会計処理中にエラーが発生しました。再度お試しください。",
        500,
      );
    }

    return c.json(
      {
        data: {
          id: paymentId,
          order_id: orderId,
          total_amount: totalAmount,
          method,
          discount_amount: discountAmount,
          discount_reason: discountReason,
          paid_at: paidAt,
        },
      },
      201,
    );
  })

  /**
   * PATCH /api/payments/:id/void
   * Voids a completed payment — all-or-nothing, no partial refunds.
   * Reopens the order to 'payment_requested' (same batch) so it can be
   * corrected and re-settled, or cancelled via the existing order-cancel
   * flow.
   *
   * Idempotent: voiding an already-voided payment returns its existing
   * void state unchanged, without touching the order again.
   *
   * 409 if reopening would violate the one-active-order-per-seat
   * invariant — e.g. the seat already started a new order since this
   * one was paid (paying frees the seat, same as cancelling does).
   *
   * Response: 200 { data: { id, order_id, voided_at, void_reason } }
   */
  .patch("/:id/void", bodyValidator(CreateVoidInput), async (c) => {
    const { id: storeId } = c.var.store;
    const paymentId = c.req.param("id");
    const { void_reason: voidReason } = c.req.valid("json");
    const db = createDb(c.env.DB);

    const paymentRows = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.id, paymentId),
          eq(schema.payments.store_id, storeId),
        ),
      )
      .limit(1);
    const payment = paymentRows[0];
    if (!payment) {
      return errorResponse("NOT_FOUND", "支払いが見つかりません。", 404);
    }

    if (payment.voided_at !== null) {
      return c.json({
        data: {
          id: payment.id,
          order_id: payment.order_id,
          voided_at: payment.voided_at,
          void_reason: payment.void_reason,
        },
      });
    }

    const voidedAt = now();
    try {
      await db.batch([
        db
          .update(schema.payments)
          .set({ voided_at: voidedAt, void_reason: voidReason })
          .where(
            and(
              eq(schema.payments.id, paymentId),
              eq(schema.payments.store_id, storeId),
              isNull(schema.payments.voided_at),
            ),
          ),
        db
          .update(schema.orders)
          .set({ status: "payment_requested", closed_at: null })
          .where(
            and(
              eq(schema.orders.id, payment.order_id),
              eq(schema.orders.store_id, storeId),
              eq(schema.orders.status, "paid"),
            ),
          ),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("UNIQUE constraint failed")) {
        return errorResponse(
          "CONFLICT",
          "この席には既に新しい注文があるため、取消できません。",
          409,
        );
      }
      return errorResponse(
        "INTERNAL_ERROR",
        "取消処理中にエラーが発生しました。再度お試しください。",
        500,
      );
    }

    // Re-read rather than trust the locally-computed values: a concurrent
    // void of the same payment could have won the race (its UPDATE guarded
    // by `voided_at IS NULL` applies, this one's affects zero rows) — the
    // batch itself doesn't error in that case, so this is the only way to
    // return what was actually persisted instead of a caller-local guess.
    const voidedRows = await db
      .select()
      .from(schema.payments)
      .where(
        and(
          eq(schema.payments.id, paymentId),
          eq(schema.payments.store_id, storeId),
        ),
      )
      .limit(1);
    const voided = voidedRows[0];
    if (!voided) {
      return errorResponse(
        "INTERNAL_ERROR",
        "取消処理中にエラーが発生しました。再度お試しください。",
        500,
      );
    }

    return c.json({
      data: {
        id: voided.id,
        order_id: voided.order_id,
        voided_at: voided.voided_at,
        void_reason: voided.void_reason,
      },
    });
  });
