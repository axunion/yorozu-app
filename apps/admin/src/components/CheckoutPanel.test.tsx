import { render } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CheckoutPanel from "./CheckoutPanel";

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

const mockPendingOrder = {
  id: "order-checkout-1",
  seat_name: "テーブル2",
  status: "payment_requested",
  items: [
    {
      id: "item-checkout-1",
      name_snapshot: "ビール",
      unit_price_snapshot: 600,
      quantity: 2,
      options: [],
      note: null,
      status: "ordered",
      created_at: 2_000_000,
    },
  ],
  total: 1200,
  created_at: 1_500_000,
};

describe("CheckoutPanel", () => {
  it("fetches pending orders on mount and renders them", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [mockPendingOrder] },
        },
      ]),
    );

    const { findByText, findAllByText } = render(() => <CheckoutPanel />);
    await findByText("テーブル2");
    await findByText("ビール");
    const amounts = await findAllByText("¥1,200");
    expect(amounts.length).toBeGreaterThanOrEqual(1);
  });

  it("shows the empty state when there are no pending orders", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [] },
        },
      ]),
    );

    const { findByText } = render(() => <CheckoutPanel />);
    await findByText(/会計待ちの伝票はありません/);
  });

  it("shows an error message when the API call fails", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          ok: false,
          json: { error: { code: "UNAUTHORIZED", message: "要認証" } },
        },
      ]),
    );

    const { findByRole } = render(() => <CheckoutPanel />);
    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("要認証");
  });

  it("sends POST to /api/payments when 会計完了 button is clicked", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
      {
        url: "/api/payments",
        method: "POST",
        json: {
          data: {
            id: "payment-1",
            order_id: "order-checkout-1",
            total_amount: 1200,
            method: "cash",
            paid_at: Date.now(),
          },
        },
      },
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [] },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <CheckoutPanel />);
    const checkoutBtn = await findByRole("button", { name: /会計完了/ });
    await user.click(checkoutBtn);

    const postCalls = fetchMock.mock.calls.filter((args: unknown[]) => {
      const url = args[0] as string;
      const init = args[1] as RequestInit | undefined;
      return (
        url.includes("/api/payments") &&
        !url.includes("/pending") &&
        (init?.method ?? "").toUpperCase() === "POST"
      );
    });
    expect(postCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("defaults to 現金 selected and sends method 'cash' when unchanged", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
      {
        url: "/api/payments",
        method: "POST",
        json: {
          data: {
            id: "payment-1",
            order_id: "order-checkout-1",
            total_amount: 1200,
            method: "cash",
            paid_at: Date.now(),
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <CheckoutPanel />);
    const cashBtn = await findByRole("button", { name: "現金" });
    expect(cashBtn.getAttribute("aria-pressed")).toBe("true");

    const checkoutBtn = await findByRole("button", { name: /会計完了/ });
    await user.click(checkoutBtn);

    const postCall = fetchMock.mock.calls.find((args: unknown[]) => {
      const url = args[0] as string;
      const init = args[1] as RequestInit | undefined;
      return (
        url.includes("/api/payments") &&
        !url.includes("/pending") &&
        (init?.method ?? "").toUpperCase() === "POST"
      );
    });
    const body = JSON.parse(
      (postCall?.[1] as RequestInit | undefined)?.body as string,
    );
    expect(body.method).toBe("cash");
  });

  it.each([
    { label: "カード", method: "card" },
    { label: "QR決済", method: "qr" },
  ])(
    "sends the selected payment method when $label is chosen",
    async ({ label, method }) => {
      const user = userEvent.setup();
      const fetchMock = mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [mockPendingOrder] },
        },
        {
          url: "/api/payments",
          method: "POST",
          json: {
            data: {
              id: "payment-1",
              order_id: "order-checkout-1",
              total_amount: 1200,
              method,
              paid_at: Date.now(),
            },
          },
        },
      ]);
      vi.stubGlobal("fetch", fetchMock);

      const { findByRole } = render(() => <CheckoutPanel />);
      const methodBtn = await findByRole("button", { name: label });
      await user.click(methodBtn);
      expect(methodBtn.getAttribute("aria-pressed")).toBe("true");

      const checkoutBtn = await findByRole("button", { name: /会計完了/ });
      await user.click(checkoutBtn);

      const postCall = fetchMock.mock.calls.find((args: unknown[]) => {
        const url = args[0] as string;
        const init = args[1] as RequestInit | undefined;
        return (
          url.includes("/api/payments") &&
          !url.includes("/pending") &&
          (init?.method ?? "").toUpperCase() === "POST"
        );
      });
      const body = JSON.parse(
        (postCall?.[1] as RequestInit | undefined)?.body as string,
      );
      expect(body.method).toBe(method);
    },
  );

  it("does not show the discount fields until 割引を追加 is tapped", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [mockPendingOrder] },
        },
      ]),
    );

    const { findByRole, queryByLabelText } = render(() => <CheckoutPanel />);
    await findByRole("button", { name: "割引を追加" });
    expect(queryByLabelText("割引額 (円)")).toBeNull();
  });

  it("does not send discount fields when no discount is entered", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
      {
        url: "/api/payments",
        method: "POST",
        json: {
          data: {
            id: "payment-1",
            order_id: "order-checkout-1",
            total_amount: 1200,
            method: "cash",
            paid_at: Date.now(),
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <CheckoutPanel />);
    const checkoutBtn = await findByRole("button", { name: /会計完了/ });
    await user.click(checkoutBtn);

    const postCall = fetchMock.mock.calls.find((args: unknown[]) => {
      const url = args[0] as string;
      const init = args[1] as RequestInit | undefined;
      return (
        url.includes("/api/payments") &&
        !url.includes("/pending") &&
        (init?.method ?? "").toUpperCase() === "POST"
      );
    });
    const body = JSON.parse(
      (postCall?.[1] as RequestInit | undefined)?.body as string,
    );
    expect(body.discount_amount).toBeUndefined();
    expect(body.discount_reason).toBeUndefined();
  });

  it("blocks checkout instead of silently capping a discount larger than the bill", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole, findByLabelText, findByText } = render(() => (
      <CheckoutPanel />
    ));
    await user.click(await findByRole("button", { name: "割引を追加" }));

    const amountInput = await findByLabelText("割引額 (円)");
    await user.type(amountInput, "99999");
    await user.type(await findByLabelText("理由"), "常連割引");

    // The typo stays visible so staff can see what they entered.
    expect((amountInput as HTMLInputElement).value).toBe("99999");
    await findByText("割引額が請求額（¥1,200）を超えています");
    const checkoutBtn = await findByRole("button", { name: /会計完了/ });
    expect(checkoutBtn).toHaveProperty("disabled", true);

    await user.click(checkoutBtn);
    const posted = fetchMock.mock.calls.some(
      (args: unknown[]) =>
        ((args[1] as RequestInit | undefined)?.method ?? "").toUpperCase() ===
        "POST",
    );
    expect(posted).toBe(false);
  });

  it("allows a discount of exactly the bill amount", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [mockPendingOrder] },
        },
      ]),
    );

    const { findByRole, findByLabelText, queryByText } = render(() => (
      <CheckoutPanel />
    ));
    await user.click(await findByRole("button", { name: "割引を追加" }));
    await user.type(await findByLabelText("割引額 (円)"), "1200");
    await user.type(await findByLabelText("理由"), "招待");

    expect(queryByText(/を超えています/)).toBeNull();
    const checkoutBtn = await findByRole("button", { name: /会計完了/ });
    expect(checkoutBtn).toHaveProperty("disabled", false);
  });

  it("enters a discount, previews the discounted total, and sends it on checkout", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
      {
        url: "/api/payments",
        method: "POST",
        json: {
          data: {
            id: "payment-1",
            order_id: "order-checkout-1",
            total_amount: 1000,
            method: "cash",
            paid_at: Date.now(),
          },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole, findByLabelText, findByText } = render(() => (
      <CheckoutPanel />
    ));
    const toggleBtn = await findByRole("button", { name: "割引を追加" });
    await user.click(toggleBtn);

    const amountInput = await findByLabelText("割引額 (円)");
    await user.type(amountInput, "200");
    const reasonInput = await findByLabelText("理由");
    await user.type(reasonInput, "常連割引");

    await findByText("¥1,000"); // discounted preview: 1200 - 200

    const checkoutBtn = await findByRole("button", { name: /会計完了/ });
    await user.click(checkoutBtn);

    const postCall = fetchMock.mock.calls.find((args: unknown[]) => {
      const url = args[0] as string;
      const init = args[1] as RequestInit | undefined;
      return (
        url.includes("/api/payments") &&
        !url.includes("/pending") &&
        (init?.method ?? "").toUpperCase() === "POST"
      );
    });
    const body = JSON.parse(
      (postCall?.[1] as RequestInit | undefined)?.body as string,
    );
    expect(body.discount_amount).toBe(200);
    expect(body.discount_reason).toBe("常連割引");
    // The client sends only the discount, never a total — the server
    // always recomputes it from items total minus discount.
    expect(body.total_amount).toBeUndefined();
  });

  it("clears the entered discount when 割引を取り消す is tapped", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [mockPendingOrder] },
        },
      ]),
    );

    const { findByRole, findByLabelText, findAllByText, queryByLabelText } =
      render(() => <CheckoutPanel />);
    const toggleBtn = await findByRole("button", { name: "割引を追加" });
    await user.click(toggleBtn);

    const amountInput = await findByLabelText("割引額 (円)");
    await user.type(amountInput, "200");

    const cancelBtn = await findByRole("button", { name: "割引を取り消す" });
    await user.click(cancelBtn);

    expect(queryByLabelText("割引額 (円)")).toBeNull();
    // Reverts to the undiscounted total (collides with the item's own line
    // price, which is also ¥1,200 for this fixture).
    const totals = await findAllByText("¥1,200");
    expect(totals.length).toBeGreaterThanOrEqual(1);
  });

  it("shows an error when payment POST fails", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
      {
        url: "/api/payments",
        method: "POST",
        ok: false,
        json: {
          error: { code: "CONFLICT", message: "この注文は既に会計済みです。" },
        },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <CheckoutPanel />);
    const checkoutBtn = await findByRole("button", { name: /会計完了/ });
    await user.click(checkoutBtn);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("会計済み");
  });

  it("action error persists through the next successful poll", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
      {
        url: "/api/payments",
        method: "POST",
        ok: false,
        json: {
          error: { code: "CONFLICT", message: "この注文は既に会計済みです。" },
        },
      },
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <CheckoutPanel />);
    await vi.advanceTimersByTimeAsync(0);

    const checkoutBtn = await findByRole("button", { name: /会計完了/ });
    await user.click(checkoutBtn);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("会計済み");

    await vi.advanceTimersByTimeAsync(5000);
    expect(alert.textContent).toContain("会計済み");
  });

  it("disables 会計完了 button while processing to prevent double payment", async () => {
    vi.useFakeTimers();
    let resolvePost!: () => void;
    const postPromise = new Promise<void>((res) => {
      resolvePost = res;
    });

    const baseMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
    ]);
    const fetchMock = vi
      .fn()
      .mockImplementation(async (url: string, init?: RequestInit) => {
        if (
          (init?.method ?? "GET").toUpperCase() === "POST" &&
          url.includes("/api/payments")
        ) {
          await postPromise;
          return {
            ok: true,
            json: async () => ({
              data: {
                id: "payment-1",
                order_id: "order-checkout-1",
                total_amount: 1200,
                method: "cash",
                paid_at: Date.now(),
              },
            }),
          };
        }
        return baseMock(url, init);
      });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { findByRole } = render(() => <CheckoutPanel />);

    await vi.advanceTimersByTimeAsync(0);
    const checkoutBtn = await findByRole("button", { name: /会計完了/ });

    const clickPromise = user.click(checkoutBtn);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(0);

    expect((checkoutBtn as HTMLButtonElement).disabled).toBe(true);

    resolvePost();
    await clickPromise;
  });

  it("sends PATCH to reopen endpoint when 席に戻す button is clicked", async () => {
    const user = userEvent.setup();
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [mockPendingOrder] },
      },
      {
        url: "/api/admin/orders/order-checkout-1/reopen",
        method: "PATCH",
        json: { data: { id: "order-checkout-1", status: "open" } },
      },
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [] },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const { findByRole } = render(() => <CheckoutPanel />);
    const reopenBtn = await findByRole("button", { name: /席に戻す/ });
    await user.click(reopenBtn);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/orders/order-checkout-1/reopen",
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("shows an error when the reopen PATCH fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [mockPendingOrder] },
        },
        {
          url: "/api/admin/orders/order-checkout-1/reopen",
          method: "PATCH",
          ok: false,
          json: {
            error: { code: "CONFLICT", message: "この注文は操作できません。" },
          },
        },
      ]),
    );

    const { findByRole } = render(() => <CheckoutPanel />);
    const reopenBtn = await findByRole("button", { name: /席に戻す/ });
    await user.click(reopenBtn);

    const alert = await findByRole("alert");
    expect(alert.textContent).toContain("操作できません");
  });

  it("polls every 5 seconds via setInterval", async () => {
    vi.useFakeTimers();
    const fetchMock = mockFetch([
      {
        url: "/api/payments/pending",
        method: "GET",
        json: { data: [] },
      },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    render(() => <CheckoutPanel />);

    await vi.advanceTimersByTimeAsync(0);
    const callsAfterMount = fetchMock.mock.calls.length;
    expect(callsAfterMount).toBeGreaterThanOrEqual(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterMount);
  });

  it("includes selected option price deltas in the line price", async () => {
    const orderWithOptions = {
      ...mockPendingOrder,
      items: [
        {
          ...mockPendingOrder.items[0],
          options: [
            {
              id: "opt-1",
              name_snapshot: "氷なし",
              group_name_snapshot: "氷の量",
              price_delta_snapshot: -50,
            },
          ],
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [orderWithOptions] },
        },
      ]),
    );

    const { findByText } = render(() => <CheckoutPanel />);
    // (600 - 50) * 2 = 1100
    await findByText("¥1,100");
  });

  it("renders selected option names with signed deltas and the line note", async () => {
    const orderWithOptions = {
      ...mockPendingOrder,
      items: [
        {
          ...mockPendingOrder.items[0],
          options: [
            {
              id: "opt-1",
              name_snapshot: "氷なし",
              group_name_snapshot: "氷の量",
              price_delta_snapshot: -50,
            },
          ],
          note: "コップ2つ",
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [orderWithOptions] },
        },
      ]),
    );

    const { findByText } = render(() => <CheckoutPanel />);
    await findByText(/氷なし/);
    await findByText(/-¥50/);
    await findByText("コップ2つ");
  });

  it("renders a zero-delta option's name without a parenthesized amount", async () => {
    const orderWithZeroDeltaOption = {
      ...mockPendingOrder,
      items: [
        {
          ...mockPendingOrder.items[0],
          options: [
            {
              id: "opt-1",
              name_snapshot: "普通",
              group_name_snapshot: "氷の量",
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
          url: "/api/payments/pending",
          method: "GET",
          json: { data: [orderWithZeroDeltaOption] },
        },
      ]),
    );

    const { findByText } = render(() => <CheckoutPanel />);
    const optionLine = await findByText("普通");
    expect(optionLine.textContent).toBe("普通");
  });
});
