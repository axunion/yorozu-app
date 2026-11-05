import { describe, expect, it } from "vitest";
import {
  addToCart,
  type CartEntry,
  cartCount,
  cartTotal,
  setLineQuantity,
  toAddItemsInput,
} from "./cart";

function entry(overrides: Partial<CartEntry> = {}): CartEntry {
  return {
    menu_item_id: "item1",
    name: "コーヒー",
    unit_price: 500,
    quantity: 1,
    option_ids: [],
    option_labels: [],
    note: null,
    ...overrides,
  };
}

describe("addToCart", () => {
  it("merges the same item with the same options and note into one line", () => {
    let lines = addToCart([], entry({ option_ids: ["a", "b"] }));
    lines = addToCart(lines, entry({ option_ids: ["b", "a"], quantity: 2 }));

    expect(lines).toHaveLength(1);
    expect(lines[0]?.quantity).toBe(3);
  });

  it("keeps separate lines when the options or the note differ", () => {
    let lines = addToCart([], entry());
    lines = addToCart(lines, entry({ option_ids: ["a"] }));
    lines = addToCart(lines, entry({ note: "氷少なめ" }));

    expect(lines).toHaveLength(3);
  });

  it("caps a merged line at the API's per-line maximum of 99", () => {
    let lines = addToCart([], entry({ quantity: 98 }));
    lines = addToCart(lines, entry({ quantity: 5 }));

    expect(lines[0]?.quantity).toBe(99);
  });
});

describe("setLineQuantity", () => {
  it("sets a quantity capped at 99, removing the line at 0", () => {
    const lines = addToCart([], entry());
    const key = lines[0]?.key ?? "";

    expect(setLineQuantity(lines, key, 0)).toEqual([]);
    expect(setLineQuantity(lines, key, 4)[0]?.quantity).toBe(4);
    expect(setLineQuantity(lines, key, 150)[0]?.quantity).toBe(99);
  });
});

describe("cart totals", () => {
  it("counts units and sums unit price × quantity across lines", () => {
    let lines = addToCart([], entry({ quantity: 2 }));
    lines = addToCart(
      lines,
      entry({ menu_item_id: "item2", unit_price: 650, option_ids: ["x"] }),
    );

    expect(cartCount(lines)).toBe(3);
    expect(cartTotal(lines)).toBe(500 * 2 + 650);
    expect(toAddItemsInput(lines)).toEqual([
      { menu_item_id: "item1", quantity: 2, option_ids: [], note: null },
      { menu_item_id: "item2", quantity: 1, option_ids: ["x"], note: null },
    ]);
  });
});
