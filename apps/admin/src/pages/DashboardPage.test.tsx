import { MemoryRouter, Route } from "@solidjs/router";
import { render, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContext, type StoreInfo } from "../layouts/AdminGuard";
import DashboardPage from "./DashboardPage";

function renderAs(role: StoreInfo["role"]) {
  const store: StoreInfo = {
    id: "store-1",
    name: "テスト食堂",
    email: `${role}@test.internal`,
    display_name: null,
    role,
  };
  return render(() => (
    <StoreContext.Provider value={store}>
      <MemoryRouter>
        <Route path="/" component={DashboardPage} />
      </MemoryRouter>
    </StoreContext.Provider>
  ));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const OWNER_ONLY = ["メニュー管理", "座席管理・QR 発行", "スタッフ管理"];

describe("DashboardPage", () => {
  it("links an owner to every screen", async () => {
    renderAs("owner");
    for (const name of OWNER_ONLY) {
      expect(await screen.findByRole("link", { name })).toBeTruthy();
    }
  });

  it("offers staff only the screens they can use", async () => {
    renderAs("staff");
    expect(
      await screen.findByRole("link", { name: "注文確認・提供管理" }),
    ).toBeTruthy();
    for (const name of OWNER_ONLY) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
  });
});

describe("DashboardPage status", () => {
  it("shows today's sales and the open counts, and badges the nav", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            unserved_orders: 3,
            open_calls: 1,
            pending_bills: 2,
            today_sales: { total: 12_800, count: 5 },
          },
        }),
      }),
    );

    renderAs("staff");

    expect(await screen.findByText("¥12,800")).toBeTruthy();
    expect(screen.getByText("5件")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "管理メニュー" });
    expect(within(nav).getByRole("link", { name: /^注文/ }).textContent).toBe(
      "注文3件の未提供の注文呼出 1件の呼び出し",
    );
    expect(within(nav).getByRole("link", { name: /^会計/ }).textContent).toBe(
      "会計2件の会計待ち",
    );
    // Owner-only screens stay out of a staff member's nav.
    expect(within(nav).queryByRole("link", { name: "メニュー" })).toBeNull();
  });
});
