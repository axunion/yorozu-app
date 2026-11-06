/**
 * Lines a staff member has picked for a seat but not sent yet. Same item,
 * options and note → one line, so repeated taps add quantity.
 */
export type DraftLine = {
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

export type DraftEntry = Omit<DraftLine, "key">;

/** The add-items API's per-line maximum. */
export const MAX_LINE_QUANTITY = 99;

export function addDraftLine(lines: DraftLine[], entry: DraftEntry) {
  const key = JSON.stringify([
    entry.menu_item_id,
    [...entry.option_ids].sort(),
    entry.note ?? "",
  ]);
  const existing = lines.find((line) => line.key === key);
  if (!existing) return [...lines, { ...entry, key }];
  return setDraftQuantity(lines, key, existing.quantity + entry.quantity);
}

/** Sets a line's quantity, capped at 99; 0 or below removes the line. */
export function setDraftQuantity(
  lines: DraftLine[],
  key: string,
  quantity: number,
): DraftLine[] {
  if (quantity <= 0) return lines.filter((line) => line.key !== key);
  return lines.map((line) =>
    line.key === key
      ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, quantity) }
      : line,
  );
}

export function draftTotal(lines: DraftLine[]): number {
  return lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
}
