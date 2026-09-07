import {
  AddOrderItemsInput,
  computeTaxBreakdown,
  errorResponse,
  newId,
  now,
  sumOrderItems,
} from "@yorozu/core";
import { createDb, type Database, schema } from "@yorozu/db";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import { Hono } from "hono";
import { requireSeat, type SeatEnv } from "../middleware";
import {
  attachOrderItemOptions,
  mapOrderItem,
  type OrderItemPayload,
} from "../order-item";
import { bodyValidator } from "../validator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full order response shape (embedded in data envelope). */
type OrderPayload = {
  id: string;
  status: string;
  items: OrderItemPayload[];
  total: number;
};

/** An option group with its options, embedded per-item in the bootstrap menu. */
type MenuItemOptionGroupPayload = {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  sort_order: number;
  options: {
    id: string;
    name: string;
    price_delta: number;
    sort_order: number;
  }[];
};

/**
 * Fetches the option groups (with their options) attached to each of the
 * given menu items, for embedding in the customer bootstrap response.
 * Only what's attached to at least one of these items is fetched, so the
 * payload stays small.
 */
async function fetchOptionGroupsForItems(
  db: Database,
  storeId: string,
  menuItemIds: string[],
): Promise<Map<string, MenuItemOptionGroupPayload[]>> {
  const result = new Map<string, MenuItemOptionGroupPayload[]>();
  if (menuItemIds.length === 0) return result;

  const attachedRows = await db
    .select({
      menu_item_id: schema.menuItemOptionGroups.menu_item_id,
      attach_sort_order: schema.menuItemOptionGroups.sort_order,
      group_id: schema.optionGroups.id,
      group_name: schema.optionGroups.name,
      min_select: schema.optionGroups.min_select,
      max_select: schema.optionGroups.max_select,
    })
    .from(schema.menuItemOptionGroups)
    .innerJoin(
      schema.optionGroups,
      eq(schema.menuItemOptionGroups.group_id, schema.optionGroups.id),
    )
    .where(
      and(
        inArray(schema.menuItemOptionGroups.menu_item_id, menuItemIds),
        eq(schema.optionGroups.store_id, storeId),
      ),
    )
    .orderBy(asc(schema.menuItemOptionGroups.sort_order));
  if (attachedRows.length === 0) return result;

  const groupIds = [...new Set(attachedRows.map((row) => row.group_id))];
  const optionRows = await db
    .select()
    .from(schema.options)
    .where(
      and(
        inArray(schema.options.group_id, groupIds),
        eq(schema.options.store_id, storeId),
      ),
    )
    .orderBy(asc(schema.options.sort_order));
  const optionsByGroupId = new Map<string, typeof optionRows>();
  for (const option of optionRows) {
    const list = optionsByGroupId.get(option.group_id) ?? [];
    list.push(option);
    optionsByGroupId.set(option.group_id, list);
  }

  for (const row of attachedRows) {
    const list = result.get(row.menu_item_id) ?? [];
    list.push({
      id: row.group_id,
      name: row.group_name,
      min_select: row.min_select,
      max_select: row.max_select,
      sort_order: row.attach_sort_order,
      options: (optionsByGroupId.get(row.group_id) ?? []).map((option) => ({
        id: option.id,
        name: option.name,
        price_delta: option.price_delta,
        sort_order: option.sort_order,
      })),
    });
    result.set(row.menu_item_id, list);
  }
  return result;
}

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

/**
 * Returns the single active order (status 'open' or 'payment_requested')
 * for a seat, or null if none exists.
 *
 * Extracted as a helper because the same WHERE clause is used in the GET
 * bootstrap, POST /items, and PATCH /request-payment handlers.
 */
async function findActiveOrder(
  db: ReturnType<typeof createDb>,
  seatId: string,
  storeId: string,
) {
  const rows = await db
    .select()
    .from(schema.orders)
    .where(
      and(
        eq(schema.orders.seat_id, seatId),
        eq(schema.orders.store_id, storeId),
        or(
          eq(schema.orders.status, "open"),
          eq(schema.orders.status, "payment_requested"),
        ),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetches the active order with its items, or returns null if none exists.
 * Uses findActiveOrder internally so the query is not duplicated.
 */
async function getActiveOrderWithItems(
  db: ReturnType<typeof createDb>,
  seatId: string,
  storeId: string,
): Promise<OrderPayload | null> {
  const order = await findActiveOrder(db, seatId, storeId);
  if (!order) return null;

  const items = await db
    .select()
    .from(schema.orderItems)
    .where(
      and(
        eq(schema.orderItems.order_id, order.id),
        eq(schema.orderItems.store_id, storeId),
      ),
    )
    .orderBy(asc(schema.orderItems.created_at));
  const itemsWithOptions = await attachOrderItemOptions(db, storeId, items);

  return {
    id: order.id,
    status: order.status,
    items: itemsWithOptions.map(mapOrderItem),
    total: sumOrderItems(itemsWithOptions),
  };
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

    // Fetch menu categories and available items in parallel with active order
    const [categories, items, order, call] = await Promise.all([
      db
        .select({
          id: schema.menuCategories.id,
          name: schema.menuCategories.name,
          sort_order: schema.menuCategories.sort_order,
        })
        .from(schema.menuCategories)
        .where(eq(schema.menuCategories.store_id, storeId))
        .orderBy(asc(schema.menuCategories.sort_order)),
      db
        .select({
          id: schema.menuItems.id,
          category_id: schema.menuItems.category_id,
          name: schema.menuItems.name,
          price: schema.menuItems.price,
          sort_order: schema.menuItems.sort_order,
          description: schema.menuItems.description,
          image_key: schema.menuItems.image_key,
        })
        .from(schema.menuItems)
        .where(
          and(
            eq(schema.menuItems.store_id, storeId),
            eq(schema.menuItems.is_available, true),
          ),
        )
        .orderBy(asc(schema.menuItems.sort_order)),
      getActiveOrderWithItems(db, seatId, storeId),
      findOpenCall(db, seatId, storeId),
    ]);

    const optionGroupsByItemId = await fetchOptionGroupsForItems(
      db,
      storeId,
      items.map((item) => item.id),
    );

    return c.json({
      data: {
        seat: { name: seatName },
        menu: {
          categories,
          items: items.map((item) => ({
            ...item,
            option_groups: optionGroupsByItemId.get(item.id) ?? [],
          })),
        },
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

      // --- Step 1: Check for existing active order ---
      const activeOrder = await findActiveOrder(db, seatId, storeId);
      if (activeOrder?.status === "payment_requested") {
        return errorResponse(
          "CONFLICT",
          "会計要求中のため新たな注文を追加できません。",
          409,
        );
      }

      // --- Step 2: Validate ALL items up-front (single WHERE IN query) ---
      // This prevents orphaned orders: if any item is invalid the whole request
      // is rejected before touching the orders table.
      const menuItemIds = [...new Set(inputItems.map((i) => i.menu_item_id))];
      const menuItemRows = await db
        .select({
          id: schema.menuItems.id,
          name: schema.menuItems.name,
          price: schema.menuItems.price,
          is_available: schema.menuItems.is_available,
          tax_rate: schema.menuItems.tax_rate,
        })
        .from(schema.menuItems)
        .where(
          and(
            inArray(schema.menuItems.id, menuItemIds),
            eq(schema.menuItems.store_id, storeId),
          ),
        );
      const menuItemMap = new Map(menuItemRows.map((r) => [r.id, r]));

      // Attached option groups (+ min/max/name) for these items, and every
      // option within those groups — enough to validate and snapshot every
      // possible selection without an N+1 query per item.
      const attachedGroupRows = await db
        .select({
          menu_item_id: schema.menuItemOptionGroups.menu_item_id,
          group_id: schema.optionGroups.id,
          group_name: schema.optionGroups.name,
          min_select: schema.optionGroups.min_select,
          max_select: schema.optionGroups.max_select,
        })
        .from(schema.menuItemOptionGroups)
        .innerJoin(
          schema.optionGroups,
          eq(schema.menuItemOptionGroups.group_id, schema.optionGroups.id),
        )
        .where(
          and(
            inArray(schema.menuItemOptionGroups.menu_item_id, menuItemIds),
            eq(schema.optionGroups.store_id, storeId),
          ),
        );
      const groupsByMenuItemId = new Map<string, typeof attachedGroupRows>();
      for (const row of attachedGroupRows) {
        const list = groupsByMenuItemId.get(row.menu_item_id) ?? [];
        list.push(row);
        groupsByMenuItemId.set(row.menu_item_id, list);
      }

      const attachedGroupIds = [
        ...new Set(attachedGroupRows.map((row) => row.group_id)),
      ];
      const optionRows =
        attachedGroupIds.length === 0
          ? []
          : await db
              .select()
              .from(schema.options)
              .where(
                and(
                  inArray(schema.options.group_id, attachedGroupIds),
                  eq(schema.options.store_id, storeId),
                ),
              );
      const optionById = new Map(optionRows.map((o) => [o.id, o]));

      type ResolvedOption = {
        name: string;
        group_name: string;
        price_delta: number;
      };
      const resolvedItems: {
        id: string;
        menu_item_id: string;
        name: string;
        price: number;
        tax_rate: number;
        quantity: number;
        note: string | null;
        options: ResolvedOption[];
      }[] = [];

      for (const input of inputItems) {
        const menuItem = menuItemMap.get(input.menu_item_id);
        if (!menuItem) {
          return errorResponse(
            "NOT_FOUND",
            `メニュー商品が見つかりません。`,
            404,
          );
        }
        if (!menuItem.is_available) {
          return errorResponse(
            "CONFLICT",
            `${menuItem.name} は現在ご注文いただけません。`,
            409,
          );
        }

        // Every selected option must belong to a group attached to this
        // item; every attached group's selection count must fall within
        // its min/max.
        const groups = groupsByMenuItemId.get(input.menu_item_id) ?? [];
        const attachedGroupIdSet = new Set(groups.map((g) => g.group_id));
        const selections: ResolvedOption[] = [];
        const countByGroupId = new Map<string, number>();

        for (const optionId of input.option_ids) {
          const option = optionById.get(optionId);
          if (!option || !attachedGroupIdSet.has(option.group_id)) {
            return errorResponse(
              "VALIDATION_ERROR",
              `${menuItem.name}に選択されたオプションが無効です。`,
              400,
            );
          }
          const group = groups.find((g) => g.group_id === option.group_id);
          if (!group) {
            return errorResponse(
              "VALIDATION_ERROR",
              `${menuItem.name}に選択されたオプションが無効です。`,
              400,
            );
          }
          selections.push({
            name: option.name,
            group_name: group.group_name,
            price_delta: option.price_delta,
          });
          countByGroupId.set(
            option.group_id,
            (countByGroupId.get(option.group_id) ?? 0) + 1,
          );
        }

        for (const group of groups) {
          const count = countByGroupId.get(group.group_id) ?? 0;
          if (count < group.min_select || count > group.max_select) {
            return errorResponse(
              "VALIDATION_ERROR",
              `${menuItem.name}の「${group.group_name}」は${group.min_select}〜${group.max_select}個選択してください。`,
              400,
            );
          }
        }

        const optionDeltaSum = selections.reduce(
          (sum, s) => sum + s.price_delta,
          0,
        );
        if (menuItem.price + optionDeltaSum <= 0) {
          return errorResponse(
            "VALIDATION_ERROR",
            `${menuItem.name}はオプションの組み合わせにより価格が0円以下になるため注文できません。`,
            400,
          );
        }

        resolvedItems.push({
          id: newId(),
          menu_item_id: input.menu_item_id,
          name: menuItem.name,
          price: menuItem.price,
          tax_rate: menuItem.tax_rate,
          quantity: input.quantity,
          note: input.note,
          options: selections,
        });
      }

      // --- Step 3: Create order (if needed) AFTER validation passes ---
      // The partial unique index idx_one_active_order_per_seat on (seat_id)
      // WHERE status IN ('open','payment_requested') prevents two concurrent
      // Workers from creating duplicate active orders for the same seat.
      // A constraint violation means a concurrent request already created the
      // order; re-fetch and use that one.
      let orderCreated = false;
      let orderId: string;

      if (!activeOrder) {
        orderId = newId();
        try {
          await db.insert(schema.orders).values({
            id: orderId,
            store_id: storeId,
            seat_id: seatId,
            status: "open",
          });
          orderCreated = true;
        } catch {
          // A concurrent request may have created the order first (unique
          // constraint on the partial index). Re-fetch to distinguish that from
          // a real error.
          const concurrent = await findActiveOrder(db, seatId, storeId);
          if (!concurrent) {
            // No concurrent order either — a genuine DB error occurred.
            return errorResponse(
              "INTERNAL_ERROR",
              "注文の処理中にエラーが発生しました。再度お試しください。",
              500,
            );
          }
          if (concurrent.status === "payment_requested") {
            return errorResponse(
              "CONFLICT",
              "会計要求中のため新たな注文を追加できません。",
              409,
            );
          }
          orderId = concurrent.id;
        }
      } else {
        orderId = activeOrder.id;
      }

      // --- Step 4: Insert order items + their selected option snapshots ---
      // Per-item timestamp offset ensures ORDER BY created_at gives a stable,
      // submission-order sequence even when all items share the same base time.
      // order_item ids are generated up front (Step 2) so option snapshots can
      // reference them without a round-trip. Both inserts run in one batch —
      // an item with no selected options never touches order_item_options.
      const ts = now();
      const orderItemValues = resolvedItems.map((item, i) => ({
        id: item.id,
        store_id: storeId,
        order_id: orderId,
        menu_item_id: item.menu_item_id,
        name_snapshot: item.name,
        unit_price_snapshot: item.price,
        tax_rate_snapshot: item.tax_rate,
        quantity: item.quantity,
        status: "ordered" as const,
        note: item.note,
        created_at: ts + i,
      }));
      const orderItemOptionValues = resolvedItems.flatMap((item) =>
        item.options.map((option) => ({
          id: newId(),
          store_id: storeId,
          order_item_id: item.id,
          name_snapshot: option.name,
          group_name_snapshot: option.group_name,
          price_delta_snapshot: option.price_delta,
        })),
      );
      if (orderItemOptionValues.length > 0) {
        await db.batch([
          db.insert(schema.orderItems).values(orderItemValues),
          db.insert(schema.orderItemOptions).values(orderItemOptionValues),
        ]);
      } else {
        await db.insert(schema.orderItems).values(orderItemValues);
      }

      // --- Step 5: Return the updated order ---
      // Guard against the unlikely concurrent close between inserts and re-fetch.
      const order = await getActiveOrderWithItems(db, seatId, storeId);
      if (!order) {
        return errorResponse(
          "INTERNAL_ERROR",
          "注文の処理中にエラーが発生しました。再度お試しください。",
          500,
        );
      }

      // 201 when a new order record was created; 200 when items were appended to
      // an existing order, so clients can distinguish the two cases.
      return c.json({ data: { order } }, orderCreated ? 201 : 200);
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
