import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrderBoard from "./OrderBoard";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
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

const mockOrder = {
  id: "order-1",
  seat_name: "テーブル1",
  status: "open",
  items: [
    {
      id: "item-1",
      name_snapshot: "ラーメン",
      unit_price_snapshot: 800,
      quantity: 2,
      options: [],
      note: null,
      status: "ordered",
      created_at: 1_000_000,
    },
  ],
  total: 1600,
  created_at: 1_000_000,
};

describe("OrderBoard", () => {
  it("fetches orders on mount and renders them", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [mockOrder] },
        },
      ]),
    );

    const { findByText, findAllByText } = render(() => <OrderBoard />);
    await findByText("テーブル1");
    await findByText("ラーメン");
    const amounts = await findAllByText("¥1,600");
    expect(amounts.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the empty state when there are no active orders", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [] },
        },
      ]),
    );

    const { findByText } = render(() => <OrderBoard />);
    await findByText(/アクティブな注文はありません/);
  });

  it("shows an error message when the API call fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          ok: false,
          json: { error: { code: "UNAUTHORIZED", message: "要認証" } },
        },
      ]),
    );

    const { findByRole } = render(() => <OrderBoard />);
    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("要認証");
  });

  it("shows 会計要求中 badge for payment_requested orders", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: {
            data: [{ ...mockOrder, status: "payment_requested" }],
          },
        },
      ]),
    );

    const { findByText } = render(() => <OrderBoard />);
    await findByText(/会計要求中/);
  });

  it("sends an open order to the register via 会計へ", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/admin/orders/order-1/request-payment",
        method: "PATCH",
        json: { data: { id: "order-1", status: "payment_requested" } },
      },
      { url: "/api/admin/orders", method: "GET", json: { data: [mockOrder] } },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <OrderBoard />);
    await user.click(await findByRole("button", { name: "会計へ テーブル1" }));

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/orders/order-1/request-payment"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("offers 会計へ only for an open order with something left to charge", async () => {
    const requested = {
      ...mockOrder,
      id: "order-2",
      seat_name: "テーブル2",
      status: "payment_requested",
    };
    const allCancelled = {
      ...mockOrder,
      id: "order-3",
      seat_name: "テーブル3",
      items: [{ ...mockOrder.items[0], status: "cancelled" }],
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [requested, allCancelled] },
        },
      ]),
    );

    const { findByText, queryByRole } = render(() => <OrderBoard />);
    await findByText("テーブル3");
    expect(queryByRole("button", { name: /^会計へ/ })).toBeNull();
  });

  it("sends PATCH to serve endpoint when 提供済み button is clicked", async () => {
    const user = userEvent.setup();
    const servedOrder = {
      ...mockOrder,
      items: [{ ...mockOrder.items[0], status: "served" }],
    };
    const fetchMock = mockFetch([
      {
        url: "/api/admin/orders",
        method: "GET",
        json: { data: [mockOrder] },
      },
      {
        url: "/api/admin/orders/items/item-1/serve",
        method: "PATCH",
        json: { data: { id: "item-1", status: "served" } },
      },
      {
        url: "/api/admin/orders",
        method: "GET",
        json: { data: [servedOrder] },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <OrderBoard />);
    const serveBtn = await findByRole("button", { name: /提供済み/ });
    await user.click(serveBtn);

    const patchCalls = fetchMock.mock.calls.filter((args: unknown[]) => {
      const url = args[0] as string;
      const init = args[1] as RequestInit | undefined;
      return (
        url.includes("/api/admin/orders/items/item-1/serve") &&
        (init?.method ?? "").toUpperCase() === "PATCH"
      );
    });
    expect(patchCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("shows a 提供取消 button (not 提供済み) for items that are already served", async () => {
    const servedOrder = {
      ...mockOrder,
      items: [{ ...mockOrder.items[0], status: "served" }],
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [servedOrder] },
        },
      ]),
    );

    const { findByRole, queryByRole } = render(() => <OrderBoard />);
    await findByRole("button", { name: /提供取消/ });
    expect(queryByRole("button", { name: /提供済み/ })).toBeNull();
  });

  it("sends PATCH to unserve endpoint when 提供取消 button is clicked", async () => {
    const user = userEvent.setup();
    const servedOrder = {
      ...mockOrder,
      items: [{ ...mockOrder.items[0], status: "served" }],
    };
    const fetchMock = mockFetch([
      {
        url: "/api/admin/orders",
        method: "GET",
        json: { data: [servedOrder] },
      },
      {
        url: "/api/admin/orders/items/item-1/unserve",
        method: "PATCH",
        json: { data: { id: "item-1", status: "ordered" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <OrderBoard />);
    const unserveBtn = await findByRole("button", { name: /提供取消/ });
    await user.click(unserveBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/orders/items/item-1/unserve",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows a 取消済み badge and no action buttons for a cancelled item", async () => {
    const cancelledOrder = {
      ...mockOrder,
      items: [{ ...mockOrder.items[0], status: "cancelled" }],
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [cancelledOrder] },
        },
      ]),
    );

    const { findByText, queryByRole } = render(() => <OrderBoard />);
    await findByText("取消済み");
    expect(queryByRole("button", { name: /提供済み/ })).toBeNull();
    expect(queryByRole("button", { name: /提供取消/ })).toBeNull();
    expect(queryByRole("button", { name: /明細を取消/ })).toBeNull();
  });

  it("voids an item via the confirm dialog", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/admin/orders",
        method: "GET",
        json: { data: [mockOrder] },
      },
      {
        url: "/api/admin/orders/items/item-1/cancel",
        method: "PATCH",
        json: { data: { id: "item-1", status: "cancelled" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderBoard />);
    const voidBtn = await screen.findByRole("button", {
      name: "明細を取消 ラーメン (item-1)",
    });
    await user.click(voidBtn);

    const confirmBtn = await screen.findByRole("button", { name: "取消する" });
    await user.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/orders/items/item-1/cancel",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("cancels a whole order via the confirm dialog", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/admin/orders",
        method: "GET",
        json: { data: [mockOrder] },
      },
      {
        url: "/api/admin/orders/order-1/cancel",
        method: "PATCH",
        json: { data: { id: "order-1", status: "cancelled" } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderBoard />);
    const cancelBtn = await screen.findByRole("button", {
      name: "注文をキャンセル テーブル1",
    });
    await user.click(cancelBtn);

    const confirmBtn = await screen.findByRole("button", {
      name: "キャンセルする",
    });
    await user.click(confirmBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/orders/order-1/cancel",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows an error when the void PATCH fails (e.g. order already paid)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [mockOrder] },
        },
        {
          url: "/api/admin/orders/items/item-1/cancel",
          method: "PATCH",
          ok: false,
          json: {
            error: {
              code: "CONFLICT",
              message:
                "会計済みまたはキャンセル済みの注文の明細は取り消せません。",
            },
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    const voidBtn = await screen.findByRole("button", {
      name: "明細を取消 ラーメン (item-1)",
    });
    await user.click(voidBtn);

    const confirmBtn = await screen.findByRole("button", { name: "取消する" });
    await user.click(confirmBtn);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("取り消せません");
  });

  it("shows an error when the cancel-order PATCH fails (e.g. order already paid)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [mockOrder] },
        },
        {
          url: "/api/admin/orders/order-1/cancel",
          method: "PATCH",
          ok: false,
          json: {
            error: {
              code: "CONFLICT",
              message: "会計済みの注文はキャンセルできません。",
            },
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    const cancelBtn = await screen.findByRole("button", {
      name: "注文をキャンセル テーブル1",
    });
    await user.click(cancelBtn);

    const confirmBtn = await screen.findByRole("button", {
      name: "キャンセルする",
    });
    await user.click(confirmBtn);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("会計済みの注文はキャンセルできません");
  });

  it("polls every 5 seconds via setInterval", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch([
      {
        url: "/api/admin/orders",
        method: "GET",
        json: { data: [] },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderBoard />);

    await vi.advanceTimersByTimeAsync(0);
    const callsAfterMount = fetchMock.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("includes selected option price deltas in the line price", async () => {
    const orderWithOptions = {
      ...mockOrder,
      items: [
        {
          ...mockOrder.items[0],
          options: [
            {
              id: "opt-1",
              name_snapshot: "大盛り",
              group_name_snapshot: "麺の量",
              price_delta_snapshot: 100,
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [orderWithOptions] },
        },
      ]),
    );

    const { findByText } = render(() => <OrderBoard />);
    // (800 + 100) * 2 = 1800
    await findByText("¥1,800");
  });

  it("renders selected option names with signed deltas and the line note", async () => {
    const orderWithOptions = {
      ...mockOrder,
      items: [
        {
          ...mockOrder.items[0],
          options: [
            {
              id: "opt-1",
              name_snapshot: "大盛り",
              group_name_snapshot: "麺の量",
              price_delta_snapshot: 100,
            },
          ],
          note: "ネギ抜き",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [orderWithOptions] },
        },
      ]),
    );

    const { findByText } = render(() => <OrderBoard />);
    await findByText(/大盛り/);
    await findByText(/\+¥100/);
    await findByText("ネギ抜き");
  });

  it("renders a zero-delta option's name without a parenthesized amount", async () => {
    const orderWithZeroDeltaOption = {
      ...mockOrder,
      items: [
        {
          ...mockOrder.items[0],
          options: [
            {
              id: "opt-1",
              name_snapshot: "普通",
              group_name_snapshot: "麺の量",
              price_delta_snapshot: 0,
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: { data: [orderWithZeroDeltaOption] },
        },
      ]),
    );

    const { findByText, container } = render(() => <OrderBoard />);
    const optionLine = await findByText("普通");
    expect(optionLine.textContent).toBe("普通");
    expect(container.querySelector('[class*="orderItemOption"]')).toBeTruthy();
  });
});

describe("OrderBoard aging indicators", () => {
  const NOW = 1_700_000_000_000;

  function orderWithItems(
    items: { id: string; status: string; created_at: number }[],
  ) {
    return {
      id: "order-1",
      seat_name: "テーブル1",
      status: "open",
      items: items.map((item) => ({
        id: item.id,
        name_snapshot: "ラーメン",
        unit_price_snapshot: 800,
        quantity: 1,
        options: [],
        note: null,
        status: item.status,
        created_at: item.created_at,
      })),
      total: 800,
      created_at: NOW,
    };
  }

  it("shows no age badge when every item is served or cancelled", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: {
            data: [
              orderWithItems([
                { id: "i1", status: "served", created_at: NOW - 30 * 60_000 },
                {
                  id: "i2",
                  status: "cancelled",
                  created_at: NOW - 30 * 60_000,
                },
              ]),
            ],
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    expect(document.querySelector('[class*="orderAge"]')).toBeNull();
  });

  it("computes age from the oldest unserved item, ignoring a served item even if it's older", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: {
            data: [
              orderWithItems([
                // Served long ago — must be ignored.
                { id: "i1", status: "served", created_at: NOW - 60 * 60_000 },
                // Still ordered, only 5 minutes old — this is the one that counts.
                { id: "i2", status: "ordered", created_at: NOW - 5 * 60_000 },
              ]),
            ],
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText("5分")).toBeTruthy();
  });

  it("applies no warning styling just under the 10-minute threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: {
            data: [
              orderWithItems([
                {
                  id: "i1",
                  status: "ordered",
                  created_at: NOW - (10 * 60_000 - 1),
                },
              ]),
            ],
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    const badge = document.querySelector('[class*="orderAge"]');
    expect(badge?.className).not.toMatch(/orderAgeWarning/);
    expect(badge?.className).not.toMatch(/orderAgeAlert/);
  });

  it("applies warning styling at exactly the 10-minute threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: {
            data: [
              orderWithItems([
                { id: "i1", status: "ordered", created_at: NOW - 10 * 60_000 },
              ]),
            ],
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    const badge = document.querySelector('[class*="orderAge"]');
    expect(badge?.className).toMatch(/orderAgeWarning/);
    expect(badge?.className).not.toMatch(/orderAgeAlert/);
  });

  it("applies alert styling at exactly the 20-minute threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: {
            data: [
              orderWithItems([
                { id: "i1", status: "ordered", created_at: NOW - 20 * 60_000 },
              ]),
            ],
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    const badge = document.querySelector('[class*="orderAge"]');
    expect(badge?.className).toMatch(/orderAgeAlert/);
  });

  it("stays warning, not alert, just under the 20-minute threshold", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: {
            data: [
              orderWithItems([
                {
                  id: "i1",
                  status: "ordered",
                  created_at: NOW - (20 * 60_000 - 1),
                },
              ]),
            ],
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    const badge = document.querySelector('[class*="orderAge"]');
    expect(badge?.className).toMatch(/orderAgeWarning/);
    expect(badge?.className).not.toMatch(/orderAgeAlert/);
  });

  it("floors a non-round age to whole minutes rather than rounding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/admin/orders",
          method: "GET",
          json: {
            data: [
              orderWithItems([
                {
                  id: "i1",
                  status: "ordered",
                  // 5 minutes 40 seconds — floors to "5分", not "6分".
                  created_at: NOW - (5 * 60_000 + 40_000),
                },
              ]),
            ],
          },
        },
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.getByText("5分")).toBeTruthy();
    expect(screen.queryByText("6分")).toBeNull();
  });

  it("advances the age badge across a poll tick with unchanged order data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    // 4 minutes 55 seconds old: floors to "4分" now, and crosses into
    // "5分" after exactly one 5s poll tick — chosen so a single poll
    // interval is enough to observe the badge advance.
    const createdAt = NOW - (4 * 60_000 + 55_000);
    // A real fetch().json() always parses a fresh object per call, even
    // for byte-identical responses — unlike the shared mockFetch helper,
    // which returns the same captured object reference every time and
    // would let Solid's signal equality check skip the re-render this
    // test needs to exercise. Return a freshly-built object each call to
    // match real fetch semantics.
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({
          data: [
            orderWithItems([
              { id: "i1", status: "ordered", created_at: createdAt },
            ]),
          ],
        }),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("4分")).toBeTruthy();

    // Advance one 5s poll tick; loadOrders re-fetches the exact same
    // (unchanged) order data — the badge must still advance, proving age
    // is recomputed live from Date.now() rather than cached at first
    // render. vi.setSystemTime moves the mocked "now" that Date.now()
    // reads; the fake-timer clock used to schedule the interval callback
    // is advanced separately via advanceTimersByTimeAsync.
    vi.setSystemTime(NOW + 5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText("5分")).toBeTruthy();
    expect(screen.queryByText("4分")).toBeNull();
  });
});

describe("OrderBoard call banner", () => {
  const mockCall = {
    id: "call-1",
    seat_name: "テーブル9",
    status: "open",
    created_at: Date.now() - 30_000,
    resolved_at: null,
  };

  it("renders an open call with the seat name and elapsed time", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/admin/orders", method: "GET", json: { data: [] } },
        {
          url: "/api/admin/calls",
          method: "GET",
          json: { data: [{ ...mockCall, created_at: now - 30_000 }] },
        },
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("テーブル9")).toBeTruthy();
    expect(screen.getByText("30秒前")).toBeTruthy();
  });

  it("does not render the call banner when there are no open calls", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/admin/orders", method: "GET", json: { data: [] } },
        { url: "/api/admin/calls", method: "GET", json: { data: [] } },
      ]),
    );

    const { findByText, queryByText, container } = render(() => <OrderBoard />);
    await findByText(/アクティブな注文はありません/);
    expect(queryByText("テーブル9")).toBeNull();
    expect(container.querySelector('[class*="callBanner"]')).toBeNull();
  });

  it("resolves a call via the 対応済み button", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      { url: "/api/admin/orders", method: "GET", json: { data: [] } },
      { url: "/api/admin/calls", method: "GET", json: { data: [mockCall] } },
      {
        url: "/api/admin/calls/call-1/resolve",
        method: "PATCH",
        json: {
          data: { id: "call-1", status: "resolved", resolved_at: Date.now() },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <OrderBoard />);
    const resolveBtn = await findByRole("button", { name: "対応済み" });
    await user.click(resolveBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/calls/call-1/resolve",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows an error when resolving a call fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/admin/orders", method: "GET", json: { data: [] } },
        {
          url: "/api/admin/calls",
          method: "GET",
          json: { data: [mockCall] },
        },
        {
          url: "/api/admin/calls/call-1/resolve",
          method: "PATCH",
          ok: false,
          json: {
            error: { code: "NOT_FOUND", message: "呼び出しが見つかりません。" },
          },
        },
      ]),
    );

    const { findByRole } = render(() => <OrderBoard />);
    const resolveBtn = await findByRole("button", { name: "対応済み" });
    await user.click(resolveBtn);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("呼び出しが見つかりません");
  });
});

describe("OrderBoard new-call alerts", () => {
  function sequentialCallFetch(callResponses: unknown[][]) {
    let callIndex = 0;
    return vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/admin/calls")) {
        const data =
          callResponses[Math.min(callIndex, callResponses.length - 1)];
        callIndex += 1;
        return Promise.resolve({ ok: true, json: async () => ({ data }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    });
  }

  const initialCall = {
    id: "call-1",
    seat_name: "テーブル1",
    status: "open",
    created_at: 1000,
    resolved_at: null,
  };
  const newCall = {
    id: "call-2",
    seat_name: "テーブル2",
    status: "open",
    created_at: 2000,
    resolved_at: null,
  };

  it("sets the call watermark on first load without highlighting", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", sequentialCallFetch([[initialCall]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    const item = screen.getByText("テーブル1").closest("li");
    expect(item?.className).not.toMatch(/callBannerItemNewAlert/);
  });

  it("highlights and beeps when a new call arrives on a later poll", async () => {
    vi.useFakeTimers();
    localStorage.setItem("order-alert-sound", "true");
    const audioCtor = vi.fn().mockImplementation(() => new MockAudioContext());
    vi.stubGlobal("AudioContext", audioCtor);
    vi.stubGlobal(
      "fetch",
      sequentialCallFetch([[initialCall], [initialCall, newCall]]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);
    audioCtor.mockClear(); // ignore any unlock-gesture call from init
    await vi.advanceTimersByTimeAsync(5000);

    const newItem = screen.getByText("テーブル2").closest("li");
    const oldItem = screen.getByText("テーブル1").closest("li");
    expect(newItem?.className).toMatch(/callBannerItemNewAlert/);
    expect(oldItem?.className).not.toMatch(/callBannerItemNewAlert/);
    expect(audioCtor).toHaveBeenCalled();
  });

  it("does not re-highlight or beep when a later poll returns no calls newer than the watermark", async () => {
    vi.useFakeTimers();
    const audioCtor = vi.fn().mockImplementation(() => new MockAudioContext());
    vi.stubGlobal("AudioContext", audioCtor);
    vi.stubGlobal("fetch", sequentialCallFetch([[initialCall], [initialCall]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);
    audioCtor.mockClear();
    await vi.advanceTimersByTimeAsync(5000);

    const item = screen.getByText("テーブル1").closest("li");
    expect(item?.className).not.toMatch(/callBannerItemNewAlert/);
    expect(audioCtor).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// New-order alerts
// ---------------------------------------------------------------------------

class MockAudioContext {
  currentTime = 0;
  createOscillator() {
    return {
      type: "",
      frequency: { value: 0 },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  createGain() {
    return { gain: { value: 0 }, connect: vi.fn() };
  }
}

function sequentialFetch(responses: unknown[][]) {
  let call = 0;
  return vi.fn().mockImplementation((url: string) => {
    // OrderBoard also polls /api/admin/calls independently of the order
    // sequence under test here; these tests aren't exercising call-banner
    // behavior, so give it an empty, unrelated response rather than
    // advancing (and desyncing) the shared `call` counter.
    if (typeof url === "string" && url.includes("/api/admin/calls")) {
      return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
    }
    const data = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, json: async () => ({ data }) });
  });
}

const initialOrder = {
  id: "order-1",
  seat_name: "テーブル1",
  status: "open",
  items: [
    {
      id: "item-1",
      name_snapshot: "唐揚げ",
      unit_price_snapshot: 500,
      quantity: 1,
      options: [],
      note: null,
      status: "ordered",
      created_at: 1000,
    },
  ],
  total: 500,
  created_at: 1000,
};

const withNewOrder = [
  initialOrder,
  {
    id: "order-2",
    seat_name: "テーブル2",
    status: "open",
    items: [
      {
        id: "item-2",
        name_snapshot: "ビール",
        unit_price_snapshot: 600,
        quantity: 1,
        options: [],
        note: null,
        status: "ordered",
        created_at: 2000,
      },
    ],
    total: 600,
    created_at: 2000,
  },
];

describe("OrderBoard new-order alerts", () => {
  it("sets the watermark on first load without highlighting any card", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", sequentialFetch([[initialOrder]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    const card = screen.getByText("テーブル1").closest("article");
    expect(card?.className).not.toMatch(/orderCardNewAlert/);
  });

  it("highlights a newly arrived order on a later poll", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", sequentialFetch([[initialOrder], withNewOrder]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0); // initial load: watermark = 1000
    await vi.advanceTimersByTimeAsync(5000); // poll: order-2's item (2000) is newer

    const newCard = screen.getByText("テーブル2").closest("article");
    const oldCard = screen.getByText("テーブル1").closest("article");
    expect(newCard?.className).toMatch(/orderCardNewAlert/);
    expect(oldCard?.className).not.toMatch(/orderCardNewAlert/);
  });

  it("restarts the highlight window on a second alert for the same order", async () => {
    vi.useFakeTimers();
    const orderTwoAgain = {
      ...withNewOrder[1],
      items: [
        {
          ...withNewOrder[1]?.items[0],
          id: "item-3",
          created_at: 3000,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      sequentialFetch([
        [initialOrder], // t=0: watermark = 1000
        withNewOrder, // t=5000: order-2 item (2000) — highlight starts, expires at t=15000
        [initialOrder, orderTwoAgain], // t=10000: order-2 item (3000) — highlight restarts, expires at t=20000
      ]),
    );

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000); // t=5000
    await vi.advanceTimersByTimeAsync(5000); // t=10000, second alert

    await vi.advanceTimersByTimeAsync(6000); // t=16000: past the original 15000 expiry
    const cardAt16s = screen.getByText("テーブル2").closest("article");
    expect(cardAt16s?.className).toMatch(/orderCardNewAlert/);

    await vi.advanceTimersByTimeAsync(5000); // t=21000: past the restarted 20000 expiry
    const cardAt21s = screen.getByText("テーブル2").closest("article");
    expect(cardAt21s?.className).not.toMatch(/orderCardNewAlert/);
  });

  it("does not highlight when a later poll returns no items newer than the watermark", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", sequentialFetch([[initialOrder], [initialOrder]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    const card = screen.getByText("テーブル1").closest("article");
    expect(card?.className).not.toMatch(/orderCardNewAlert/);
  });

  it("invokes the Web Audio API when sound is enabled and a new order arrives", async () => {
    vi.useFakeTimers();
    localStorage.setItem("order-alert-sound", "true");
    const audioCtor = vi.fn().mockImplementation(() => new MockAudioContext());
    vi.stubGlobal("AudioContext", audioCtor);
    vi.stubGlobal("fetch", sequentialFetch([[initialOrder], withNewOrder]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);
    audioCtor.mockClear(); // ignore any unlock-gesture call from init
    await vi.advanceTimersByTimeAsync(5000);

    expect(audioCtor).toHaveBeenCalled();
  });

  it("does not invoke the Web Audio API when sound is disabled", async () => {
    vi.useFakeTimers();
    const audioCtor = vi.fn().mockImplementation(() => new MockAudioContext());
    vi.stubGlobal("AudioContext", audioCtor);
    vi.stubGlobal("fetch", sequentialFetch([[initialOrder], withNewOrder]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);

    expect(audioCtor).not.toHaveBeenCalled();
  });

  it("persists the sound toggle to localStorage and unlocks audio on enable", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const audioCtor = vi.fn().mockImplementation(() => new MockAudioContext());
    vi.stubGlobal("AudioContext", audioCtor);
    vi.stubGlobal("fetch", sequentialFetch([[]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    const toggleBtn = screen.getByRole("button", { name: /通知音/ });
    expect(toggleBtn.getAttribute("aria-pressed")).toBe("false");

    await user.click(toggleBtn);

    expect(localStorage.getItem("order-alert-sound")).toBe("true");
    expect(toggleBtn.getAttribute("aria-pressed")).toBe("true");
    expect(audioCtor).toHaveBeenCalledTimes(1);

    await user.click(toggleBtn);
    expect(localStorage.getItem("order-alert-sound")).toBe("false");
  });

  it("loads the sound preference from localStorage on mount", async () => {
    vi.useFakeTimers();
    localStorage.setItem("order-alert-sound", "true");
    vi.stubGlobal("fetch", sequentialFetch([[]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    const toggleBtn = screen.getByRole("button", { name: /通知音/ });
    expect(toggleBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("sets document.title to the unserved item count", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", sequentialFetch([[initialOrder]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    expect(document.title).toBe("(1) Order Manager — Admin");
  });

  it("counts only 'ordered' items, excluding served and cancelled", async () => {
    vi.useFakeTimers();
    const mixedOrder = {
      id: "order-mixed",
      seat_name: "テーブル3",
      status: "open",
      items: [
        { ...initialOrder.items[0], id: "a", status: "ordered" },
        { ...initialOrder.items[0], id: "b", status: "ordered" },
        { ...initialOrder.items[0], id: "c", status: "served" },
        { ...initialOrder.items[0], id: "d", status: "cancelled" },
      ],
      total: 1000,
      created_at: 1000,
    };
    vi.stubGlobal("fetch", sequentialFetch([[mixedOrder]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    expect(document.title).toBe("(2) Order Manager — Admin");
  });

  it("resets document.title when there are no unserved items", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", sequentialFetch([[]]));

    render(() => <OrderBoard />);
    await vi.advanceTimersByTimeAsync(0);

    expect(document.title).toBe("Order Manager — Admin");
  });
});
