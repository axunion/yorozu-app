import { render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiError, data, mockFetch } from "../test-helpers";
import ShiftGuard from "./ShiftGuard";

const navigate = vi.fn();

vi.mock("@solidjs/router", () => ({
  useNavigate: () => navigate,
}));

const me = {
  id: "store-1",
  name: "テスト店舗",
  email: "owner@test.internal",
  role: "owner" as const,
};

afterEach(() => {
  vi.restoreAllMocks();
  navigate.mockReset();
});

describe("ShiftGuard", () => {
  it("renders the page for a signed-in store that has the product", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/auth/me", json: data(me) },
        { url: "/api/shift/periods", json: data([]) },
      ]),
    );

    render(() => (
      <ShiftGuard>
        <p>シフト画面</p>
      </ShiftGuard>
    ));

    expect(await screen.findByText("シフト画面")).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("redirects to login when there is no session", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/auth/me",
          ok: false,
          status: 401,
          json: apiError(
            "UNAUTHORIZED",
            "ログインが必要です。もう一度ログインしてください。",
          ),
        },
      ]),
    );

    render(() => (
      <ShiftGuard>
        <p>シフト画面</p>
      </ShiftGuard>
    ));

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/login", { replace: true }),
    );
    expect(screen.queryByText("シフト画面")).toBeNull();
  });

  it("shows the not-enabled screen when the store lacks the product", async () => {
    // Signed in, but the API gates shift routes with 403. That is not
    // something logging in again would fix, so it must not redirect.
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/auth/me", json: data(me) },
        {
          url: "/api/shift/periods",
          ok: false,
          status: 403,
          json: apiError(
            "FORBIDDEN",
            "この店舗ではシフト管理をご契約いただいていません。",
          ),
        },
      ]),
    );

    render(() => (
      <ShiftGuard>
        <p>シフト画面</p>
      </ShiftGuard>
    ));

    expect(await screen.findByText(/未契約/)).toBeTruthy();
    expect(screen.queryByText("シフト画面")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("still renders the page when a shift request fails for another reason", async () => {
    // A 500 is a transient failure, not a product gate: the screen loads and
    // reports its own error rather than claiming the store is unsubscribed.
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/auth/me", json: data(me) },
        {
          url: "/api/shift/periods",
          ok: false,
          status: 500,
          json: apiError("INTERNAL_ERROR", "boom"),
        },
      ]),
    );

    render(() => (
      <ShiftGuard>
        <p>シフト画面</p>
      </ShiftGuard>
    ));

    expect(await screen.findByText("シフト画面")).toBeTruthy();
  });
});
