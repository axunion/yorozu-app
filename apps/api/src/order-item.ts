import { type createDb, schema } from "@yorozu/db";
import { and, eq, inArray } from "drizzle-orm";

export type OrderItemOptionPayload = {
  id: string;
  name_snapshot: string;
  group_name_snapshot: string;
  price_delta_snapshot: number;
};

export type OrderItemPayload = {
  id: string;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  status: string;
  created_at: number;
  note: string | null;
  options: OrderItemOptionPayload[];
  tax_rate_snapshot: number;
};

export function mapOrderItem(item: {
  id: string;
  name_snapshot: string;
  unit_price_snapshot: number;
  quantity: number;
  status: string;
  created_at: number;
  note: string | null;
  options: OrderItemOptionPayload[];
  tax_rate_snapshot: number;
}): OrderItemPayload {
  return {
    id: item.id,
    name_snapshot: item.name_snapshot,
    unit_price_snapshot: item.unit_price_snapshot,
    quantity: item.quantity,
    status: item.status,
    created_at: item.created_at,
    note: item.note,
    options: item.options,
    tax_rate_snapshot: item.tax_rate_snapshot,
  };
}

/**
 * Fetches order_item_options for the given order_item ids, grouped by
 * order_item_id. Shared across order.ts, admin-orders.ts, and payments.ts
 * so every order-item payload (customer, board, pending, sales) carries
 * the same option snapshots.
 */
async function fetchOptionsByOrderItemId(
  db: ReturnType<typeof createDb>,
  storeId: string,
  orderItemIds: string[],
): Promise<Map<string, OrderItemOptionPayload[]>> {
  const map = new Map<string, OrderItemOptionPayload[]>();
  if (orderItemIds.length === 0) return map;
  const rows = await db
    .select()
    .from(schema.orderItemOptions)
    .where(
      and(
        eq(schema.orderItemOptions.store_id, storeId),
        inArray(schema.orderItemOptions.order_item_id, orderItemIds),
      ),
    );
  for (const row of rows) {
    const list = map.get(row.order_item_id) ?? [];
    list.push({
      id: row.id,
      name_snapshot: row.name_snapshot,
      group_name_snapshot: row.group_name_snapshot,
      price_delta_snapshot: row.price_delta_snapshot,
    });
    map.set(row.order_item_id, list);
  }
  return map;
}

/**
 * Attaches each order_items row's selected options, ready for mapOrderItem
 * and sumOrderItems (which both need the same enriched shape).
 */
export async function attachOrderItemOptions<
  T extends { id: string; note: string | null },
>(
  db: ReturnType<typeof createDb>,
  storeId: string,
  items: T[],
): Promise<(T & { options: OrderItemOptionPayload[] })[]> {
  const optionsByItemId = await fetchOptionsByOrderItemId(
    db,
    storeId,
    items.map((item) => item.id),
  );
  return items.map((item) => ({
    ...item,
    options: optionsByItemId.get(item.id) ?? [],
  }));
}
