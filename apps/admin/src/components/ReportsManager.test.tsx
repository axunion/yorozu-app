import { render, screen, within } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { jstMonthRange, jstWeekRange, todayJst } from "@yorozu/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as download from "../lib/download";
import ReportsManager from "./ReportsManager";

afterEach(() => {
  vi.restoreAllMocks();
});

type MockRoute = {
  url: string | RegExp;
  method?: string;
  ok?: boolean;
  json: unknown;
};

function mockFetch(routes: MockRoute[]) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const route = routes.find((r) => {
      const urlMatch =
        typeof r.url === "string" ? url.includes(r.url) : r.url.test(url);
      const methodMatch = !r.method || r.method.toUpperCase() === method;
      return urlMatch && methodMatch;
    });
    if (!route) {
      return Promise.resolve({
        ok: false,
        json: async () => ({
          error: { code: "NOT_FOUND", message: "no route" },
        }),
      });
    }
    const ok = route.ok !== false;
    return Promise.resolve({ ok, json: async () => route.json });
  });
}

function payment(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    total_amount: 1000,
    paid_at: Date.now(),
    voided_at: null,
    items: [],
    ...overrides,
  };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    name_snapshot: "ラーメン",
    unit_price_snapshot: 800,
    quantity: 1,
    status: "served",
    options: [],
    ...overrides,
  };
}

describe("ReportsManager — fetch & range", () => {
  it("fetches this week's range on mount", async () => {
    const fetchMock = mockFetch([
      { url: "/api/payments", method: "GET", json: { data: [] } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <ReportsManager />);
    await screen.findByText(/この期間の売上はありません/);

    const { from, to } = jstWeekRange(todayJst());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/payments?from=${from}&to=${to}`),
      expect.anything(),
    );
  });

  it("refetches with a wider range when 今月 is selected", async () => {
    const fetchMock = mockFetch([
      { url: "/api/payments", method: "GET", json: { data: [] } },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(() => <ReportsManager />);
    await screen.findByText(/この期間の売上はありません/);
    fetchMock.mockClear();

    await user.click(screen.getByRole("button", { name: "今月" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { from, to } = jstMonthRange(todayJst());
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/payments?from=${from}&to=${to}`),
      expect.anything(),
    );
  });

  it("shows the API error message on a validation failure", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments",
          method: "GET",
          ok: false,
          json: {
            error: {
              code: "VALIDATION_ERROR",
              message: "期間は62日以内で指定してください。",
            },
          },
        },
      ]),
    );

    render(() => <ReportsManager />);
    await screen.findByText("期間は62日以内で指定してください。");
  });
});

describe("ReportsManager — item ranking", () => {
  it("aggregates quantity and revenue across payments, including option deltas", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments",
          method: "GET",
          json: {
            data: [
              payment({
                items: [
                  item({
                    name_snapshot: "ラーメン",
                    unit_price_snapshot: 800,
                    quantity: 2,
                    options: [{ price_delta_snapshot: 100 }],
                  }),
                ],
              }),
              payment({
                items: [
                  item({ name_snapshot: "ラーメン", quantity: 1 }),
                  item({ name_snapshot: "餃子", unit_price_snapshot: 500 }),
                ],
              }),
            ],
          },
        },
      ]),
    );

    render(() => <ReportsManager />);
    await screen.findByText("ラーメン");

    // (800+100)*2 + 800*1 = 1800 + 800 = 2600
    const row = screen.getByRole("row", { name: /ラーメン/ });
    expect(row.textContent).toContain("3"); // quantity: 2 + 1
    expect(row.textContent).toContain("2,600");
  });

  it("excludes voided payments and cancelled lines from the ranking", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments",
          method: "GET",
          json: {
            data: [
              payment({
                voided_at: Date.now(),
                items: [item({ name_snapshot: "取消済み会計商品" })],
              }),
              payment({
                items: [
                  item({ name_snapshot: "取消済み商品", status: "cancelled" }),
                  item({ name_snapshot: "提供済み商品" }),
                ],
              }),
            ],
          },
        },
      ]),
    );

    render(() => <ReportsManager />);
    await screen.findByText("提供済み商品");
    expect(screen.queryByText("取消済み会計商品")).toBeNull();
    expect(screen.queryByText("取消済み商品")).toBeNull();
  });

  it("sorts by quantity when the quantity header is clicked", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments",
          method: "GET",
          json: {
            data: [
              payment({
                items: [
                  item({
                    name_snapshot: "高額少数商品",
                    unit_price_snapshot: 5000,
                    quantity: 1,
                  }),
                  item({
                    name_snapshot: "安価多数商品",
                    unit_price_snapshot: 100,
                    quantity: 10,
                  }),
                ],
              }),
            ],
          },
        },
      ]),
    );

    render(() => <ReportsManager />);
    await screen.findByText("高額少数商品");

    // Default sort (revenue desc): 高額少数商品 (5000) before 安価多数商品 (1000)
    let rows = screen.getAllByRole("row").slice(1); // drop header row
    expect(rows[0]?.textContent).toContain("高額少数商品");

    await user.click(screen.getByRole("button", { name: /数量/ }));

    rows = screen.getAllByRole("row").slice(1);
    expect(rows[0]?.textContent).toContain("安価多数商品");
  });
});

describe("ReportsManager — weekday breakdown", () => {
  it("sums total_amount per JST weekday, excluding voided payments", async () => {
    // 2026-07-16 is a Thursday; noon JST = 03:00 UTC.
    const thursday = new Date("2026-07-16T03:00:00.000Z").getTime();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments",
          method: "GET",
          json: {
            data: [
              payment({ total_amount: 1000, paid_at: thursday }),
              payment({ total_amount: 2000, paid_at: thursday }),
              payment({
                total_amount: 9999,
                paid_at: thursday,
                voided_at: thursday,
              }),
            ],
          },
        },
      ]),
    );

    render(() => <ReportsManager />);
    const thursdayRow = await screen.findByRole("row", { name: /木/ });
    expect(thursdayRow.textContent).toContain("3,000");
  });
});

describe("ReportsManager — hourly breakdown", () => {
  it("sums total_amount per JST hour, excluding voided payments", async () => {
    // 2026-07-16T06:00:00Z = 15:00 JST
    const afternoon = new Date("2026-07-16T06:00:00.000Z").getTime();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments",
          method: "GET",
          json: {
            data: [
              payment({ total_amount: 1000, paid_at: afternoon }),
              payment({ total_amount: 2000, paid_at: afternoon }),
              payment({
                total_amount: 9999,
                paid_at: afternoon,
                voided_at: afternoon,
              }),
            ],
          },
        },
      ]),
    );

    render(() => <ReportsManager />);
    const list = await screen.findByRole("list", { name: "時間帯別売上" });
    const hourItem = within(list).getByText("15時").closest("li");
    expect(hourItem?.textContent).toContain("3,000");
    expect(hourItem?.textContent).not.toContain("9,999");
  });
});

describe("ReportsManager — CSV export", () => {
  it("calls downloadCsv with the exact item ranking rows and headers", async () => {
    const spy = vi.spyOn(download, "downloadCsv").mockImplementation(() => {});
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments",
          method: "GET",
          json: {
            data: [
              payment({
                items: [
                  item({
                    name_snapshot: "ラーメン",
                    unit_price_snapshot: 800,
                    quantity: 1,
                  }),
                ],
              }),
            ],
          },
        },
      ]),
    );

    render(() => <ReportsManager />);
    await screen.findByText("ラーメン");
    await user.click(
      screen.getByRole("button", { name: "商品ランキングをCSVダウンロード" }),
    );

    expect(spy).toHaveBeenCalledWith(
      ["商品名", "数量", "売上金額"],
      [["ラーメン", 1, 800]],
      expect.stringContaining(".csv"),
    );
  });

  it("calls downloadCsv with the exact weekday breakdown rows and headers", async () => {
    const spy = vi.spyOn(download, "downloadCsv").mockImplementation(() => {});
    const user = userEvent.setup();
    // 2026-07-16T03:00:00Z = 12:00 JST on a Thursday.
    const thursday = new Date("2026-07-16T03:00:00.000Z").getTime();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments",
          method: "GET",
          json: { data: [payment({ total_amount: 1000, paid_at: thursday })] },
        },
      ]),
    );

    render(() => <ReportsManager />);
    await screen.findByRole("row", { name: /木/ });
    await user.click(
      screen.getByRole("button", { name: "曜日別売上をCSVダウンロード" }),
    );

    expect(spy).toHaveBeenCalledWith(
      ["曜日", "件数", "売上金額"],
      expect.arrayContaining([["木", 1, 1000]]),
      expect.stringContaining(".csv"),
    );
  });
});
