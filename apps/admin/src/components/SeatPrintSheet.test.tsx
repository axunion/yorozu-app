import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StoreContext, type StoreInfo } from "../layouts/AdminGuard";
import SeatPrintSheet from "./SeatPrintSheet";

vi.mock("qrcode", () => ({
  default: {
    toDataURL: vi.fn(
      async (url: string) => `data:image/png;base64,${btoa(url)}`,
    ),
  },
}));

afterEach(() => {
  vi.restoreAllMocks();
});

const store: StoreInfo = {
  id: "store-1",
  name: "テスト食堂",
  email: "owner@test.internal",
  display_name: null,
  role: "owner",
};

function renderSheet() {
  return render(() => (
    <StoreContext.Provider value={store}>
      <SeatPrintSheet />
    </StoreContext.Provider>
  ));
}

describe("SeatPrintSheet", () => {
  it("lays out one card per active seat with the seat and store name, then prints", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { id: "s1", name: "テーブル1", qr_token: "tok-1" },
            { id: "s2", name: "カウンター", qr_token: "tok-2" },
          ],
        }),
      }),
    );
    // happy-dom has no window.print.
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const user = userEvent.setup();

    renderSheet();

    const qr = await screen.findByRole("img", { name: "QR テーブル1" });
    expect(atob((qr.getAttribute("src") ?? "").split(",")[1] ?? "")).toContain(
      "/tok-1",
    );
    expect(screen.getByRole("img", { name: "QR カウンター" })).toBeTruthy();
    expect(screen.getAllByText("テスト食堂")).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "印刷する" }));
    expect(print).toHaveBeenCalledOnce();
  });

  it("shows the API error and keeps printing disabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: "FORBIDDEN", message: "オーナー権限が必要です。" },
        }),
      }),
    );

    renderSheet();

    expect((await screen.findByRole("alert")).textContent).toContain(
      "オーナー権限が必要です。",
    );
    expect(
      (screen.getByRole("button", { name: "印刷する" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
