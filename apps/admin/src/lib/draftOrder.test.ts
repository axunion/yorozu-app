import { describe, expect, it } from "vitest";
import {
  addDraftLine,
  type DraftEntry,
  draftTotal,
  setDraftQuantity,
} from "./draftOrder";

function entry(overrides: Partial<DraftEntry> = {}): DraftEntry {
  return {
    menu_item_id: "item1",
    name: "唐揚げ",
    unit_price: 500,
    quantity: 1,
    option_ids: [],
    option_labels: [],
    note: null,
    ...overrides,
  };
}

describe("draft order lines", () => {
  it("merges identical picks and keeps different options or notes apart", () => {
    let lines = addDraftLine([], entry({ option_ids: ["a", "b"] }));
    lines = addDraftLine(lines, entry({ option_ids: ["b", "a"] }));
    lines = addDraftLine(lines, entry({ note: "辛め" }));

    expect(lines.map((l) => l.quantity)).toEqual([2, 1]);
  });

  it("caps quantity at 99 and removes a line at 0", () => {
    let lines = addDraftLine([], entry({ quantity: 98 }));
    lines = addDraftLine(lines, entry({ quantity: 3 }));
    expect(lines[0]?.quantity).toBe(99);

    expect(setDraftQuantity(lines, lines[0]?.key ?? "", 0)).toEqual([]);
  });

  it("totals unit price × quantity", () => {
    let lines = addDraftLine([], entry({ quantity: 2 }));
    lines = addDraftLine(
      lines,
      entry({ menu_item_id: "item2", unit_price: 650 }),
    );
    expect(draftTotal(lines)).toBe(1650);
  });
});
