import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AddOrderItemsInput,
  CreateItemInput,
  CreateOptionGroupInput,
  CreateOptionInput,
  EmailChangeVerifyInput,
  UpdateItemInput,
  UpdateOptionGroupInput,
  UpdateOptionInput,
  VerifyCodeInput,
} from "./index";

const baseCreate = { name: "Coffee", price: 500 };
const baseUpdate = { name: "Coffee", price: 500, is_available: true };

describe("CreateItemInput description", () => {
  it("defaults to null when omitted", () => {
    const result = CreateItemInput.parse(baseCreate);
    expect(result.description).toBeNull();
  });

  it("accepts null explicitly", () => {
    const result = CreateItemInput.parse({ ...baseCreate, description: null });
    expect(result.description).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    const result = CreateItemInput.parse({
      ...baseCreate,
      description: "  Freshly roasted.  ",
    });
    expect(result.description).toBe("Freshly roasted.");
  });

  it("normalizes a whitespace-only string to null", () => {
    const result = CreateItemInput.parse({
      ...baseCreate,
      description: "   ",
    });
    expect(result.description).toBeNull();
  });

  it("accepts exactly 500 characters", () => {
    const description = "a".repeat(500);
    const result = CreateItemInput.parse({ ...baseCreate, description });
    expect(result.description).toBe(description);
  });

  it("rejects 501 characters", () => {
    expect(() =>
      CreateItemInput.parse({
        ...baseCreate,
        description: "a".repeat(501),
      }),
    ).toThrow(z.ZodError);
  });

  it("checks the length limit against the trimmed string, not the raw one", () => {
    // 502 raw chars that trim down to exactly 500 non-whitespace chars are
    // accepted: the trim transform runs before max(500).
    const description = ` ${"a".repeat(500)} `;
    const result = CreateItemInput.parse({ ...baseCreate, description });
    expect(result.description).toBe("a".repeat(500));
  });
});

describe("UpdateItemInput description", () => {
  it("is undefined when omitted, preserving the current DB value", () => {
    const result = UpdateItemInput.parse(baseUpdate);
    expect(result.description).toBeUndefined();
  });

  it("clears the description when explicitly null", () => {
    const result = UpdateItemInput.parse({
      ...baseUpdate,
      description: null,
    });
    expect(result.description).toBeNull();
  });

  it("rejects 501 characters", () => {
    expect(() =>
      UpdateItemInput.parse({
        ...baseUpdate,
        description: "a".repeat(501),
      }),
    ).toThrow(z.ZodError);
  });
});

describe("CreateOptionGroupInput", () => {
  it("defaults min_select to 0 and max_select to 1", () => {
    const result = CreateOptionGroupInput.parse({ name: "Size" });
    expect(result.min_select).toBe(0);
    expect(result.max_select).toBe(1);
  });

  it("accepts min_select equal to max_select (exactly-one-choice groups)", () => {
    const result = CreateOptionGroupInput.parse({
      name: "Size",
      min_select: 1,
      max_select: 1,
    });
    expect(result.min_select).toBe(1);
    expect(result.max_select).toBe(1);
  });

  it("rejects min_select greater than max_select", () => {
    expect(() =>
      CreateOptionGroupInput.parse({
        name: "Size",
        min_select: 2,
        max_select: 1,
      }),
    ).toThrow(z.ZodError);
  });

  it("rejects max_select of 0", () => {
    expect(() =>
      CreateOptionGroupInput.parse({ name: "Size", max_select: 0 }),
    ).toThrow(z.ZodError);
  });

  it("rejects a negative min_select", () => {
    expect(() =>
      CreateOptionGroupInput.parse({ name: "Size", min_select: -1 }),
    ).toThrow(z.ZodError);
  });
});

describe("UpdateOptionGroupInput", () => {
  it("accepts min_select equal to max_select", () => {
    const result = UpdateOptionGroupInput.parse({
      name: "Size",
      min_select: 1,
      max_select: 1,
    });
    expect(result.min_select).toBe(1);
    expect(result.max_select).toBe(1);
  });

  it("rejects min_select greater than max_select", () => {
    expect(() =>
      UpdateOptionGroupInput.parse({
        name: "Toppings",
        min_select: 3,
        max_select: 2,
      }),
    ).toThrow(z.ZodError);
  });
});

describe("CreateOptionInput / UpdateOptionInput price_delta", () => {
  it("accepts a negative price_delta (discount options)", () => {
    const created = CreateOptionInput.parse({
      name: "Small",
      price_delta: -100,
    });
    expect(created.price_delta).toBe(-100);

    const updated = UpdateOptionInput.parse({
      name: "Small",
      price_delta: -100,
    });
    expect(updated.price_delta).toBe(-100);
  });

  it("accepts a zero price_delta", () => {
    const result = CreateOptionInput.parse({ name: "Regular", price_delta: 0 });
    expect(result.price_delta).toBe(0);
  });

  it("rejects a non-integer price_delta", () => {
    expect(() =>
      CreateOptionInput.parse({ name: "Large", price_delta: 99.5 }),
    ).toThrow(z.ZodError);
    expect(() =>
      UpdateOptionInput.parse({ name: "Large", price_delta: 99.5 }),
    ).toThrow(z.ZodError);
  });
});

describe("AddOrderItemsInput note", () => {
  const baseItem = { menu_item_id: "item1", quantity: 1 };

  it("defaults note to null and option_ids to [] when omitted", () => {
    const result = AddOrderItemsInput.parse({ items: [baseItem] });
    expect(result.items[0]?.note).toBeNull();
    expect(result.items[0]?.option_ids).toEqual([]);
  });

  it("accepts an explicit null note", () => {
    // Distinct from the omitted case above: omitting short-circuits before
    // the transform runs at all (via .optional().default(null)), while an
    // explicit null must pass through the transform's own null check.
    const result = AddOrderItemsInput.parse({
      items: [{ ...baseItem, note: null }],
    });
    expect(result.items[0]?.note).toBeNull();
  });

  it("trims whitespace and normalizes an empty note to null", () => {
    const result = AddOrderItemsInput.parse({
      items: [{ ...baseItem, note: "  no onions  " }],
    });
    expect(result.items[0]?.note).toBe("no onions");

    const emptyResult = AddOrderItemsInput.parse({
      items: [{ ...baseItem, note: "   " }],
    });
    expect(emptyResult.items[0]?.note).toBeNull();
  });

  it("accepts exactly 200 characters and rejects 201", () => {
    const note = "a".repeat(200);
    const result = AddOrderItemsInput.parse({
      items: [{ ...baseItem, note }],
    });
    expect(result.items[0]?.note).toBe(note);

    expect(() =>
      AddOrderItemsInput.parse({
        items: [{ ...baseItem, note: "a".repeat(201) }],
      }),
    ).toThrow(z.ZodError);
  });

  it("passes option_ids through unchanged", () => {
    const result = AddOrderItemsInput.parse({
      items: [{ ...baseItem, option_ids: ["opt1", "opt2"] }],
    });
    expect(result.items[0]?.option_ids).toEqual(["opt1", "opt2"]);
  });
});

describe("VerifyCodeInput code", () => {
  const base = { email: "owner@example.com" };

  it("accepts six plain digits", () => {
    expect(VerifyCodeInput.parse({ ...base, code: "123456" }).code).toBe(
      "123456",
    );
  });

  it("keeps a leading zero", () => {
    expect(VerifyCodeInput.parse({ ...base, code: "012345" }).code).toBe(
      "012345",
    );
  });

  it("normalizes full-width digits from a Japanese IME", () => {
    expect(VerifyCodeInput.parse({ ...base, code: "１２３４５６" }).code).toBe(
      "123456",
    );
  });

  it("strips spaces the code was displayed with", () => {
    expect(VerifyCodeInput.parse({ ...base, code: " 123 456 " }).code).toBe(
      "123456",
    );
  });

  it("strips hyphens", () => {
    expect(VerifyCodeInput.parse({ ...base, code: "123-456" }).code).toBe(
      "123456",
    );
  });

  it("rejects a five-digit code", () => {
    expect(() => VerifyCodeInput.parse({ ...base, code: "12345" })).toThrow();
  });

  it("rejects a seven-digit code", () => {
    expect(() => VerifyCodeInput.parse({ ...base, code: "1234567" })).toThrow();
  });

  it("rejects non-numeric input", () => {
    expect(() => VerifyCodeInput.parse({ ...base, code: "12345a" })).toThrow();
  });

  it("rejects an invalid email", () => {
    expect(() =>
      VerifyCodeInput.parse({ email: "nope", code: "123456" }),
    ).toThrow();
  });
});

describe("VerifyCodeInput app", () => {
  const base = { email: "owner@example.com", code: "123456" };

  it("defaults to admin when omitted", () => {
    expect(VerifyCodeInput.parse(base).app).toBe("admin");
  });

  it("accepts shift", () => {
    expect(VerifyCodeInput.parse({ ...base, app: "shift" }).app).toBe("shift");
  });

  it("rejects an app outside the enum, so it can never name an origin", () => {
    expect(() =>
      VerifyCodeInput.parse({ ...base, app: "https://evil.example.com" }),
    ).toThrow();
  });
});

describe("EmailChangeVerifyInput", () => {
  it("normalizes the code the same way as VerifyCodeInput", () => {
    expect(EmailChangeVerifyInput.parse({ code: "１２３ ４５６" }).code).toBe(
      "123456",
    );
  });

  it("rejects a malformed code", () => {
    expect(() => EmailChangeVerifyInput.parse({ code: "abc" })).toThrow();
  });
});
