import type { AddOrderItemsInput } from "@yorozu/core";

/**
 * One line in the customer's local cart: what the add-items API needs plus
 * enough display data (name, option labels, unit price) to review it without
 * looking the menu up again.
 */
export type CartLine = {
  key: string;
  menu_item_id: string;
  name: string;
  /** Item price plus the selected options' deltas, per unit. */
  unit_price: number;
  quantity: number;
  option_ids: string[];
  option_labels: string[];
  note: string | null;
};

export type CartEntry = Omit<CartLine, "key">;

export const MAX_LINE_QUANTITY = 99;

export function addToCart(lines: CartLine[], entry: CartEntry): CartLine[] {
  // Same item, options and note → same line, so repeated taps add quantity.
  const key = JSON.stringify([
    entry.menu_item_id,
    [...entry.option_ids].sort(),
    entry.note ?? "",
  ]);
  const existing = lines.find((line) => line.key === key);
  if (!existing) return [...lines, { ...entry, key }];
  return setLineQuantity(lines, key, existing.quantity + entry.quantity);
}

/** Sets a line's quantity; 0 or below removes the line. */
export function setLineQuantity(
  lines: CartLine[],
  key: string,
  quantity: number,
): CartLine[] {
  if (quantity <= 0) return lines.filter((line) => line.key !== key);
  return lines.map((line) =>
    line.key === key
      ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, quantity) }
      : line,
  );
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function cartTotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
}

export function toAddItemsInput(
  lines: CartLine[],
): AddOrderItemsInput["items"] {
  return lines.map((line) => ({
    menu_item_id: line.menu_item_id,
    quantity: line.quantity,
    option_ids: line.option_ids,
    note: line.note,
  }));
}
