import { render } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import ReceiptScreen from "./ReceiptScreen";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(ok: boolean, json: unknown) {
  return vi
    .fn()
    .mockImplementation(() => Promise.resolve({ ok, json: async () => json }));
}

const receiptData = {
  data: {
    order_id: "order1",
    store_name: "麺屋テスト",
    seat_name: "テーブル1",
    items: [
      {
        id: "oi1",
        name_snapshot: "ラーメン",
        unit_price_snapshot: 800,
        quantity: 2,
        status: "ordered",
        options: [],
        note: null,
      },
      {
        id: "oi2",
        name_snapshot: "ビール",
        unit_price_snapshot: 600,
        quantity: 1,
        status: "cancelled",
        options: [],
        note: null,
      },
    ],
    items_total: 1600,
    discount_amount: 0,
    discount_reason: null,
    total_amount: 1600,
    tax_breakdown: [{ rate: 10, taxable_amount: 1455, tax_amount: 145 }],
    method: "cash",
    paid_at: 1_700_000_000_000,
  },
};

describe("ReceiptScreen", () => {
  it("shows a loading state before the fetch resolves", () => {
    vi.stubGlobal("fetch", mockFetch(true, receiptData));
    const { getByText } = render(() => (
      <ReceiptScreen seatToken="test-token" orderId="order1" />
    ));
    expect(getByText("読み込み中...")).toBeTruthy();
  });

  it("renders the store name, seat, items, and total once loaded", async () => {
    vi.stubGlobal("fetch", mockFetch(true, receiptData));
    const { findByText, findAllByText } = render(() => (
      <ReceiptScreen seatToken="test-token" orderId="order1" />
    ));
    await findByText("麺屋テスト");
    await findByText("テーブル1");
    await findByText("ラーメン");
    // ¥1,600 appears 4 times: the ラーメン line (800×2), 小計, 合計 (no
    // discount applied, so they coincide), and the tax-inclusive 10%対象.
    const totals = await findAllByText("¥1,600");
    expect(totals.length).toBe(4);
  });

  it("shows a cancelled item struck through", async () => {
    vi.stubGlobal("fetch", mockFetch(true, receiptData));
    const { findByText } = render(() => (
      <ReceiptScreen seatToken="test-token" orderId="order1" />
    ));
    const cancelledItem = await findByText("ビール");
    expect(cancelledItem.closest("li")?.className).toMatch(/itemCancelled/);
  });

  it("renders the tax breakdown per rate bucket", async () => {
    vi.stubGlobal("fetch", mockFetch(true, receiptData));
    const { findByText } = render(() => (
      <ReceiptScreen seatToken="test-token" orderId="order1" />
    ));
    const label = await findByText("10%対象");
    // The base is tax-inclusive (1,455 + 145), so it reconciles with the
    // 内消費税 amount beside it.
    expect(label.closest("li")?.textContent).toBe(
      "10%対象¥1,600(内消費税 ¥145)",
    );
  });

  it("shows the discount line and reason when a discount was applied", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(true, {
        data: {
          ...receiptData.data,
          discount_amount: 300,
          discount_reason: "常連割引",
          total_amount: 1300,
        },
      }),
    );
    const { findByText } = render(() => (
      <ReceiptScreen seatToken="test-token" orderId="order1" />
    ));
    await findByText("割引（常連割引）");
    await findByText("-¥300");
  });

  it("omits the discount line entirely when there is no discount", async () => {
    vi.stubGlobal("fetch", mockFetch(true, receiptData));
    const { findByText, queryByText } = render(() => (
      <ReceiptScreen seatToken="test-token" orderId="order1" />
    ));
    await findByText("麺屋テスト");
    expect(queryByText("割引", { exact: false })).toBeNull();
  });

  it("shows an error message when the receipt fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(false, {
        error: { code: "NOT_FOUND", message: "レシートが見つかりません。" },
      }),
    );
    const { findByRole } = render(() => (
      <ReceiptScreen seatToken="test-token" orderId="order1" />
    ));
    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("レシートが見つかりません。");
  });
});
