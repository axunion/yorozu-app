import { MemoryRouter, Route } from "@solidjs/router";
import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { StoreContext, type StoreInfo } from "../layouts/AdminGuard";
import DashboardPage from "./DashboardPage";

function renderAs(role: StoreInfo["role"]) {
  const store: StoreInfo = {
    id: "store-1",
    name: "テスト食堂",
    email: `${role}@test.internal`,
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
