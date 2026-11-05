import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { StoreContext, type StoreInfo } from "./AdminGuard";
import OwnerOnly from "./OwnerOnly";

function renderAs(role: StoreInfo["role"]) {
  const store: StoreInfo = {
    id: "store-1",
    name: "テスト食堂",
    email: `${role}@test.internal`,
    role,
  };
  return render(() => (
    <StoreContext.Provider value={store}>
      <OwnerOnly>
        <p>メニューの編集フォーム</p>
      </OwnerOnly>
    </StoreContext.Provider>
  ));
}

describe("OwnerOnly", () => {
  it("renders the screen for an owner", () => {
    renderAs("owner");
    expect(screen.getByText("メニューの編集フォーム")).toBeTruthy();
  });

  it("shows a notice instead of the screen for staff", () => {
    renderAs("staff");
    expect(screen.queryByText("メニューの編集フォーム")).toBeNull();
    expect(
      screen.getByText("この画面はオーナーのみ利用できます。"),
    ).toBeTruthy();
  });
});
