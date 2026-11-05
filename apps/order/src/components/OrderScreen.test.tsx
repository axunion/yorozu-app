import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrderScreen from "./OrderScreen";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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

const bootstrapEmpty = {
  data: {
    seat: { name: "テーブル1" },
    menu: { categories: [], items: [] },
    order: null,
    call: null,
  },
};

const bootstrapWithMenu = {
  data: {
    seat: { name: "テーブル2" },
    menu: {
      categories: [{ id: "cat1", name: "ドリンク", sort_order: 0 }],
      items: [
        {
          id: "item1",
          category_id: "cat1",
          name: "コーヒー",
          price: 500,
          sort_order: 0,
          option_groups: [],
        },
        {
          id: "item2",
          category_id: "cat1",
          name: "紅茶",
          price: 450,
          sort_order: 1,
          option_groups: [],
        },
      ],
    },
    order: null,
    call: null,
  },
};

const bootstrapWithOrder = {
  data: {
    seat: { name: "テーブル3" },
    menu: {
      categories: [],
      items: [
        {
          id: "item3",
          category_id: null,
          name: "ラーメン",
          price: 800,
          sort_order: 0,
          option_groups: [],
        },
      ],
    },
    order: {
      id: "order1",
      status: "open",
      items: [
        {
          id: "oi1",
          name_snapshot: "ラーメン",
          unit_price_snapshot: 800,
          quantity: 2,
          status: "ordered",
          created_at: 1000,
          options: [],
          note: null,
        },
      ],
      total: 1600,
    },
    call: null,
  },
};

describe("OrderScreen", () => {
  it("shows loading state before bootstrap completes", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );
    const { getByText } = render(() => <OrderScreen seatToken="test-token" />);
    expect(getByText(/読み込み中/)).toBeTruthy();
  });

  it("shows the not-found page, without a call button, for an unknown seat", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: "NOT_FOUND", message: "Seat not found" },
        }),
      }),
    );

    render(() => <OrderScreen seatToken="bad-token" />);
    await screen.findByText("ページが見つかりません");
    expect(screen.queryByText("Seat not found")).toBeNull();
    expect(screen.queryByRole("button", { name: "スタッフを呼ぶ" })).toBeNull();
  });

  it("stops polling once the seat turns out not to exist", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({
        error: { code: "NOT_FOUND", message: "Seat not found" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="gone-token" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("ページが見つかりません")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("offers a reload when the menu fails to load, and recovers on retry", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => bootstrapWithMenu,
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(() => <OrderScreen seatToken="flaky-token" />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("通信エラー");
    expect(screen.queryByRole("button", { name: "スタッフを呼ぶ" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await screen.findByText("コーヒー");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("switches to the not-found page when a poll finds the seat gone", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => bootstrapWithMenu,
      })
      .mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: { code: "NOT_FOUND", message: "Seat not found" },
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="rotated-token" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("コーヒー")).toBeTruthy();

    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.getByText("ページが見つかりません")).toBeTruthy();
  });

  it("offers a reload when a later bootstrap fails after the seat loaded", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => bootstrapWithMenu,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({
          error: { code: "INTERNAL", message: "呼び出しに失敗しました。" },
        }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => bootstrapWithMenu,
      });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(() => <OrderScreen seatToken="seat-token" />);
    await user.click(
      await screen.findByRole("button", { name: "スタッフを呼ぶ" }),
    );
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: "再読み込み" }));
    await screen.findByText("コーヒー");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders the menu after successful bootstrap", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/order/", method: "GET", json: bootstrapWithMenu },
      ]),
    );

    const { findByText } = render(() => <OrderScreen seatToken="test-token" />);
    await findByText("コーヒー");
    await findByText("紅茶");
  });

  it("renders an item's description and photo when present", async () => {
    const bootstrap = {
      data: {
        ...bootstrapWithMenu.data,
        menu: {
          categories: bootstrapWithMenu.data.menu.categories,
          items: [
            {
              id: "item1",
              category_id: "cat1",
              name: "コーヒー",
              price: 500,
              sort_order: 0,
              description: "深煎り豆を使用した自家製ブレンド",
              image_key: "menu/store1/item1/abc.jpg",
              option_groups: [],
            },
          ],
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([{ url: "/api/order/", method: "GET", json: bootstrap }]),
    );

    const { findByText, findByAltText } = render(() => (
      <OrderScreen seatToken="test-token" />
    ));
    await findByText("深煎り豆を使用した自家製ブレンド");
    const img = (await findByAltText("コーヒー")) as HTMLImageElement;
    expect(img.src).toContain("/api/menu/images/menu/store1/item1/abc.jpg");
  });

  it("renders a compact item card with no photo or description text when absent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/order/", method: "GET", json: bootstrapWithMenu },
      ]),
    );

    const { findByText, queryByRole, container } = render(() => (
      <OrderScreen seatToken="test-token" />
    ));
    await findByText("コーヒー");
    expect(queryByRole("img")).toBeNull();
    // Guards the proposal's "compact layout" requirement: no reserved
    // thumbnail space, not just no <img> tag.
    expect(container.querySelector('[class*="itemThumb"]')).toBeNull();
  });

  it("renders a photo without a description, and a description without a photo, independently", async () => {
    const bootstrap = {
      data: {
        ...bootstrapWithMenu.data,
        menu: {
          categories: bootstrapWithMenu.data.menu.categories,
          items: [
            {
              id: "item1",
              category_id: "cat1",
              name: "コーヒー",
              price: 500,
              sort_order: 0,
              description: null,
              image_key: "menu/store1/item1/abc.jpg",
              option_groups: [],
            },
            {
              id: "item2",
              category_id: "cat1",
              name: "紅茶",
              price: 450,
              sort_order: 1,
              description: "香り高い茶葉を使用",
              image_key: null,
              option_groups: [],
            },
          ],
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([{ url: "/api/order/", method: "GET", json: bootstrap }]),
    );

    const { findByAltText, findByText, queryByAltText } = render(() => (
      <OrderScreen seatToken="test-token" />
    ));
    // コーヒー: photo present, no description text rendered for it.
    await findByAltText("コーヒー");
    // 紅茶: description present, no photo rendered for it.
    await findByText("香り高い茶葉を使用");
    expect(queryByAltText("紅茶")).toBeNull();
  });

  it("shows empty state when menu has no items", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ url: "/api/order/", method: "GET", json: bootstrapEmpty }]),
    );

    const { findByText } = render(() => <OrderScreen seatToken="test-token" />);
    await findByText(/メニューがまだ登録されていません/);
  });

  it("shows 'no order yet' when order is null", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([{ url: "/api/order/", method: "GET", json: bootstrapEmpty }]),
    );

    const { findByText } = render(() => <OrderScreen seatToken="test-token" />);
    await findByText(/注文がまだありません/);
  });

  it("shows order items and total when order exists", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/order/",
          method: "GET",
          json: bootstrapWithOrder,
        },
      ]),
    );

    const { findByText } = render(() => <OrderScreen seatToken="test-token" />);
    await findByText("合計");
    await findByText("会計をお願いする");
  });

  it("clicking '注文する' calls POST /items and updates order", async () => {
    const fetchMock = mockFetch([
      { url: "/api/order/", method: "GET", json: bootstrapWithMenu },
      {
        url: /items/,
        method: "POST",
        json: {
          data: {
            order: {
              id: "order1",
              status: "open",
              items: [
                {
                  id: "oi1",
                  name_snapshot: "コーヒー",
                  unit_price_snapshot: 500,
                  quantity: 1,
                  status: "ordered",
                  created_at: 1000,
                  options: [],
                  note: null,
                },
              ],
              total: 500,
            },
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const { findByRole } = render(() => <OrderScreen seatToken="test-token" />);
    const orderBtn = await findByRole("button", { name: /コーヒーを注文する/ });
    await user.click(orderBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/items"),
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"menu_item_id":"item1"'),
      }),
    );
    await findByRole("button", { name: /会計をお願いする/ });
  });

  it("shows error when POST /items fails", async () => {
    const fetchMock = mockFetch([
      { url: "/api/order/", method: "GET", json: bootstrapWithMenu },
      {
        url: /items/,
        method: "POST",
        ok: false,
        json: {
          error: {
            code: "CONFLICT",
            message: "会計要求中のため注文できません。",
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const { findByRole } = render(() => <OrderScreen seatToken="test-token" />);
    const orderBtn = await findByRole("button", { name: /コーヒーを注文する/ });
    await user.click(orderBtn);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("会計要求中");
  });

  it("shows 会計待ち message when order status is payment_requested", async () => {
    const bootstrap = {
      data: {
        ...bootstrapWithOrder.data,
        order: {
          ...bootstrapWithOrder.data.order,
          status: "payment_requested",
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([{ url: "/api/order/", method: "GET", json: bootstrap }]),
    );

    const { findByText } = render(() => <OrderScreen seatToken="test-token" />);
    await findByText(/会計をお待ちください/);
  });

  it("shows a cancelled item with a 取消済み label and excludes it from the total", async () => {
    const bootstrap = {
      data: {
        ...bootstrapWithOrder.data,
        order: {
          id: "order1",
          status: "open",
          items: [
            {
              id: "oi1",
              name_snapshot: "ラーメン",
              unit_price_snapshot: 800,
              quantity: 1,
              status: "ordered",
              created_at: 1000,
              options: [],
              note: null,
            },
            {
              id: "oi2",
              name_snapshot: "ビール",
              unit_price_snapshot: 600,
              quantity: 1,
              status: "cancelled",
              created_at: 1001,
              options: [],
              note: null,
            },
          ],
          total: 800,
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([{ url: "/api/order/", method: "GET", json: bootstrap }]),
    );

    const { findByText, queryByText } = render(() => (
      <OrderScreen seatToken="test-token" />
    ));
    await findByText("ビール");
    await findByText("取消済み");
    // Total (800) excludes the cancelled ビール line; 1,400 would be the
    // (wrong) sum if it were still counted.
    expect(queryByText("1,400")).toBeNull();
  });

  it("'会計をお願いする' button calls PATCH request-payment", async () => {
    const fetchMock = mockFetch([
      { url: "/api/order/", method: "GET", json: bootstrapWithOrder },
      {
        url: /request-payment/,
        method: "PATCH",
        json: { data: { id: "order1", status: "payment_requested" } },
      },
      {
        url: "/api/order/",
        method: "GET",
        json: {
          data: {
            ...bootstrapWithOrder.data,
            order: {
              ...bootstrapWithOrder.data.order,
              status: "payment_requested",
            },
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const { findByRole } = render(() => <OrderScreen seatToken="test-token" />);
    const payBtn = await findByRole("button", { name: /会計をお願いする/ });
    await user.click(payBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/request-payment"),
      expect.objectContaining({ method: "PATCH" }),
    );
  });
});

describe("OrderScreen call staff", () => {
  it("shows the waiting status from bootstrap immediately, without tapping the button", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/order/",
          method: "GET",
          json: {
            data: {
              ...bootstrapEmpty.data,
              call: { id: "call1", status: "open", created_at: 1000 },
            },
          },
        },
      ]),
    );

    const { findByText, findByRole } = render(() => (
      <OrderScreen seatToken="test-token" />
    ));
    await findByText("呼んでいます");
    // The button stays enabled: the API is idempotent, so re-tapping is
    // harmless, and a disabled control risks reading as broken mid-wait.
    const button = await findByRole("button", { name: "スタッフを呼ぶ" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it("tapping 呼ぶ posts to /call and shows the waiting status", async () => {
    const fetchMock = mockFetch([
      { url: "/api/order/", method: "GET", json: bootstrapEmpty },
      {
        url: /\/call$/,
        method: "POST",
        json: { data: { id: "call1", status: "open", created_at: 2000 } },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const { findByRole, findByText } = render(() => (
      <OrderScreen seatToken="test-token" />
    ));
    const button = await findByRole("button", { name: "スタッフを呼ぶ" });
    await user.click(button);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/call"),
      expect.objectContaining({ method: "POST" }),
    );
    await findByText("呼んでいます");
  });

  it("shows an error when the POST /call fails", async () => {
    const fetchMock = mockFetch([
      { url: "/api/order/", method: "GET", json: bootstrapEmpty },
      {
        url: /\/call$/,
        method: "POST",
        ok: false,
        json: {
          error: { code: "NOT_FOUND", message: "座席が見つかりません。" },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    const { findByRole } = render(() => <OrderScreen seatToken="test-token" />);
    const button = await findByRole("button", { name: "スタッフを呼ぶ" });
    await user.click(button);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("座席が見つかりません");
  });

  it("clears the waiting status once a background poll sees the call resolved, without disturbing menu state", async () => {
    vi.useFakeTimers();
    let resolved = false;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/order/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              ...bootstrapWithMenu.data,
              call: resolved
                ? null
                : { id: "call1", status: "open", created_at: 1000 },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: { code: "NOT_FOUND", message: "" } }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="test-token" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("呼んでいます")).toBeTruthy();
    const menuItemBefore = screen.getByText("コーヒー");

    resolved = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText("呼んでいます")).toBeNull();
    // A full loadBootstrap() would call setMenuItems() with fresh objects,
    // which <For> renders as a full remove-and-recreate (a new DOM node),
    // even though the mock data is unchanged; pollCall must not do that.
    // An identity check is the only way to actually distinguish the two —
    // queryByText("コーヒー") alone would pass for both, since the *text*
    // reappears either way.
    expect(screen.getByText("コーヒー")).toBe(menuItemBefore);
  });
});

describe("OrderScreen order progress polling", () => {
  it("polls order status every 10s while an active order exists, picking up a 提供済み update", async () => {
    vi.useFakeTimers();
    let served = false;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/api/order/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              ...bootstrapWithOrder.data,
              order: {
                ...bootstrapWithOrder.data.order,
                items: [
                  {
                    ...bootstrapWithOrder.data.order.items[0],
                    status: served ? "served" : "ordered",
                  },
                ],
              },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: { code: "NOT_FOUND", message: "" } }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="test-token" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText("注文済み")).toBeTruthy();

    served = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(screen.getByText("提供済み")).toBeTruthy();
  });

  it("does not poll while there is no active order", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch([
      { url: "/api/order/", method: "GET", json: bootstrapEmpty },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="test-token" />);
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterInitialLoad = fetchMock.mock.calls.length;

    await vi.advanceTimersByTimeAsync(10_000);
    // Only the 5s call-poll should have fired again (at t=5000 and
    // t=10000); the 10s order-poll must not add any request while order
    // is null.
    expect(fetchMock.mock.calls.length).toBe(callsAfterInitialLoad + 2);
  });

  it("does not let a slow order-status poll response overwrite a fresher request-payment result", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    // Both the 5s call-poll and the 10s order-poll hit this same GET
    // endpoint, so this test doesn't try to distinguish them by call
    // count — instead, every GET made while `hangGets` is true is held
    // open (never resolved) until the test explicitly releases it, all
    // still carrying the stale "open" status. Since none of them can
    // affect the outcome unless released, this reproduces "a slow poll
    // response lands after a mutation" regardless of which poller it
    // came from.
    let hangGets = false;
    let paymentRequested = false;
    const hungResolvers: (() => void)[] = [];
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        const method = (init?.method ?? "GET").toUpperCase();
        if (typeof url === "string" && url.includes("/request-payment")) {
          paymentRequested = true;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: { id: "order1", status: "payment_requested" },
            }),
          });
        }
        if (
          typeof url === "string" &&
          url.includes("/api/order/") &&
          method === "GET"
        ) {
          if (hangGets) {
            return new Promise((resolve) => {
              hungResolvers.push(() =>
                resolve({
                  ok: true,
                  json: async () => ({ data: bootstrapWithOrder.data }), // still "open"
                }),
              );
            });
          }
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                ...bootstrapWithOrder.data,
                order: {
                  ...bootstrapWithOrder.data.order,
                  status: paymentRequested ? "payment_requested" : "open",
                },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: { code: "NOT_FOUND", message: "" } }),
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="test-token" />);
    await vi.advanceTimersByTimeAsync(0); // initial bootstrap: order "open"

    hangGets = true;
    await vi.advanceTimersByTimeAsync(10_000); // fires poll GETs, all hung
    hangGets = false;

    const payBtn = screen.getByRole("button", { name: /会計をお願いする/ });
    await user.click(payBtn);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/会計をお待ちください/)).toBeTruthy();

    // Now let every stale hung response (still carrying "open") land.
    for (const release of hungResolvers) release();
    await vi.advanceTimersByTimeAsync(0);

    // None of them must have reverted the UI back to the pre-request state.
    expect(
      screen.queryByRole("button", { name: /会計をお願いする/ }),
    ).toBeNull();
    expect(screen.getByText(/会計をお待ちください/)).toBeTruthy();
  });
});

describe("OrderScreen receipt banner", () => {
  it("shows a レシートを表示 link once the paid order disappears and the receipt endpoint confirms it", async () => {
    vi.useFakeTimers();
    let orderPaid = false;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/receipt/order1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ data: { order_id: "order1" } }),
        });
      }
      if (u.includes("/api/order/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              ...bootstrapWithOrder.data,
              order: orderPaid
                ? null
                : {
                    ...bootstrapWithOrder.data.order,
                    status: "payment_requested",
                  },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: { code: "NOT_FOUND", message: "" } }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="test-token" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/会計をお待ちください/)).toBeTruthy();

    orderPaid = true;
    await vi.advanceTimersByTimeAsync(10_000); // triggers pollOrder -> order becomes null
    await vi.advanceTimersByTimeAsync(0); // let the follow-up receipt check resolve

    const link = await screen.findByRole("link", { name: "レシートを表示" });
    expect(link.getAttribute("href")).toBe("/test-token/receipt/order1");
  });

  // apiFetch collapses a real 404 (order cancelled, not paid) and a
  // transient network failure into the same { ok: false } shape, so this
  // test — and the component's actual behavior — can't distinguish them:
  // any receipt-check failure suppresses the banner. checkForReceipt has
  // no retry, so a one-off network blip on a genuinely paid order would
  // also permanently hide the link for that session; accepted as a low-
  // probability edge case rather than adding retry logic.
  it("does not show a receipt link when the receipt check fails, for any reason (cancelled order or a transient failure)", async () => {
    vi.useFakeTimers();
    let orderGone = false;
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const u = String(url);
      if (u.includes("/receipt/order1")) {
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: { code: "NOT_FOUND", message: "" } }),
        });
      }
      if (u.includes("/api/order/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              ...bootstrapWithOrder.data,
              order: orderGone
                ? null
                : {
                    ...bootstrapWithOrder.data.order,
                    status: "payment_requested",
                  },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: false,
        json: async () => ({ error: { code: "NOT_FOUND", message: "" } }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="test-token" />);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/会計をお待ちください/)).toBeTruthy();

    orderGone = true;
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByRole("link", { name: "レシートを表示" })).toBeNull();
  });

  it("clears the receipt banner once a new order is started", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let orderPaid = false;
    let newOrderStarted = false;
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        const method = (init?.method ?? "GET").toUpperCase();
        if (u.includes("/receipt/order1")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ data: { order_id: "order1" } }),
          });
        }
        if (u.includes("/items") && method === "POST") {
          newOrderStarted = true;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                order: {
                  id: "order2",
                  status: "open",
                  items: [],
                  total: 0,
                },
              },
            }),
          });
        }
        if (u.includes("/api/order/")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                ...bootstrapWithMenu.data,
                order: newOrderStarted
                  ? { id: "order2", status: "open", items: [], total: 0 }
                  : orderPaid
                    ? null
                    : {
                        id: "order1",
                        status: "payment_requested",
                        items: [],
                        total: 500,
                      },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: { code: "NOT_FOUND", message: "" } }),
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="test-token" />);
    await vi.advanceTimersByTimeAsync(0);
    orderPaid = true;
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.advanceTimersByTimeAsync(0);
    await screen.findByRole("link", { name: "レシートを表示" });

    const orderBtn = screen.getByRole("button", { name: /コーヒーを注文する/ });
    await user.click(orderBtn);
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByRole("link", { name: "レシートを表示" })).toBeNull();
  });

  it("does not resurrect the banner from a stale receipt check after a newer order has already started", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    let orderPaid = false;
    let newOrderStarted = false;
    let releaseReceiptCheck!: () => void;
    const receiptCheckHeld = new Promise<void>((res) => {
      releaseReceiptCheck = res;
    });
    const fetchMock = vi
      .fn()
      .mockImplementation((url: string, init?: RequestInit) => {
        const u = String(url);
        const method = (init?.method ?? "GET").toUpperCase();
        if (u.includes("/receipt/order1")) {
          return receiptCheckHeld.then(() => ({
            ok: true,
            json: async () => ({ data: { order_id: "order1" } }),
          }));
        }
        if (u.includes("/items") && method === "POST") {
          newOrderStarted = true;
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                order: { id: "order2", status: "open", items: [], total: 0 },
              },
            }),
          });
        }
        if (u.includes("/api/order/")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              data: {
                ...bootstrapWithMenu.data,
                order: newOrderStarted
                  ? { id: "order2", status: "open", items: [], total: 0 }
                  : orderPaid
                    ? null
                    : {
                        id: "order1",
                        status: "payment_requested",
                        items: [],
                        total: 500,
                      },
              },
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          json: async () => ({ error: { code: "NOT_FOUND", message: "" } }),
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    render(() => <OrderScreen seatToken="test-token" />);
    await vi.advanceTimersByTimeAsync(0);

    // order1 is paid; pollOrder fires the (held) receipt check.
    orderPaid = true;
    await vi.advanceTimersByTimeAsync(10_000);

    // Before the receipt check resolves, the customer starts a fresh order.
    const orderBtn = screen.getByRole("button", { name: /コーヒーを注文する/ });
    await user.click(orderBtn);
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole("link", { name: "レシートを表示" })).toBeNull();

    // Now the stale receipt check for order1 finally resolves ok:true.
    releaseReceiptCheck();
    await vi.advanceTimersByTimeAsync(0);

    // It must not resurrect a banner for the old, already-superseded order.
    expect(screen.queryByRole("link", { name: "レシートを表示" })).toBeNull();
  });
});
