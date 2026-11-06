import { describe, expect, it } from "vitest";
import { validationError } from "../domain/http";
import {
  AddOrderItemsInput,
  CreateItemInput,
  CreateOptionGroupInput,
  CreateStoreInput,
} from "./index";

function messagesOf(result: {
  success: boolean;
  error?: { issues: { message: string }[] };
}): string[] {
  return result.error?.issues.map((i) => i.message) ?? [];
}

describe("Japanese validation messages", () => {
  it("names the field for a blank store name and a malformed email", () => {
    expect(
      messagesOf(CreateStoreInput.safeParse({ name: "   ", email: "x" })),
    ).toEqual([
      "店舗名を入力してください。",
      "メールアドレスの形式が正しくありません。",
    ]);
  });

  it("states string and number bounds in Japanese", () => {
    expect(
      messagesOf(
        CreateItemInput.safeParse({ name: "あ".repeat(101), price: 0 }),
      ),
    ).toEqual([
      "名前は100文字以内で入力してください。",
      "価格は0より大きくしてください。",
    ]);
  });

  it("labels a nested field by its own name, and a missing one as required", () => {
    expect(
      messagesOf(
        AddOrderItemsInput.safeParse({ items: [{ menu_item_id: "m1" }] }),
      ),
    ).toEqual(["数量を入力してください。"]);
    expect(messagesOf(AddOrderItemsInput.safeParse({ items: [] }))).toEqual([
      "商品を1件以上指定してください。",
    ]);
  });

  it("keeps a refinement's own message", () => {
    expect(
      messagesOf(
        CreateOptionGroupInput.safeParse({
          name: "サイズ",
          min_select: 2,
          max_select: 1,
        }),
      ),
    ).toEqual(["最小選択数は最大選択数以下にしてください。"]);
  });

  it("joins several messages as running text in the 400 response", async () => {
    const res = validationError([
      { message: "店舗名を入力してください。" },
      { message: "メールアドレスの形式が正しくありません。" },
    ]);
    expect(await res.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message:
          "店舗名を入力してください。メールアドレスの形式が正しくありません。",
      },
    });
  });
});

describe("Japanese validation messages without a field", () => {
  it("reports a missing body as a malformed request", () => {
    expect(messagesOf(CreateStoreInput.safeParse(undefined))).toEqual([
      "リクエストの内容が正しくありません。",
    ]);
  });
});
