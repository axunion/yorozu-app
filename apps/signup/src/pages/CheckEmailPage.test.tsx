import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeSignupHandoff } from "../handoff";
import CheckEmailPage from "./CheckEmailPage";

/**
 * Verifying navigates to the admin origin, which happy-dom cannot follow.
 * Swap in a plain object so the page can assign href and the test can read it.
 */
let navigatedTo: string;

beforeEach(() => {
  navigatedTo = "";
  sessionStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      get href() {
        return navigatedTo;
      },
      set href(value: string) {
        navigatedTo = value;
      },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(response: unknown, ok = true) {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok, json: async () => response });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("CheckEmailPage", () => {
  it("verifies the code against the address registration handed over", async () => {
    writeSignupHandoff({ email: "owner@example.com" });
    const fetchMock = stubFetch({
      data: { redirect_to: "http://admin.localhost" },
    });
    const user = userEvent.setup();

    render(() => <CheckEmailPage />);
    await user.type(screen.getByLabelText("確認コード"), "123456");
    await user.click(screen.getByRole("button", { name: "登録を完了する" }));

    const call = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(String(call[0])).toContain("/api/auth/verify-code");
    expect(JSON.parse(String(call[1].body))).toEqual({
      email: "owner@example.com",
      code: "123456",
    });
  });

  it("crosses to the origin the API names, since signup does not know it", async () => {
    writeSignupHandoff({ email: "owner@example.com" });
    stubFetch({ data: { redirect_to: "http://admin.localhost" } });
    const user = userEvent.setup();

    render(() => <CheckEmailPage />);
    await user.type(screen.getByLabelText("確認コード"), "123456");
    await user.click(screen.getByRole("button", { name: "登録を完了する" }));

    expect(navigatedTo).toBe("http://admin.localhost");
  });

  it("stays put and explains when the code is wrong", async () => {
    writeSignupHandoff({ email: "owner@example.com" });
    stubFetch(
      {
        error: {
          code: "INVALID_CODE",
          message: "コードが正しくないか、有効期限が切れています。",
        },
      },
      false,
    );
    const user = userEvent.setup();

    render(() => <CheckEmailPage />);
    await user.type(screen.getByLabelText("確認コード"), "000000");
    await user.click(screen.getByRole("button", { name: "登録を完了する" }));

    expect(
      await screen.findByText("コードが正しくないか、有効期限が切れています。"),
    ).toBeTruthy();
    expect(navigatedTo).toBe("");
  });

  it("shows the address the code went to", () => {
    writeSignupHandoff({ email: "owner@example.com" });

    render(() => <CheckEmailPage />);

    expect(screen.getByText(/owner@example\.com/)).toBeTruthy();
  });

  it("shows the dev-only code when registration handed one over", () => {
    writeSignupHandoff({ email: "owner@example.com", code: "654321" });

    render(() => <CheckEmailPage />);

    expect(screen.getByText(/\[DEV\] 確認コード: 654321/)).toBeTruthy();
  });

  it("tells a direct visitor to start again when there is nothing handed over", () => {
    render(() => <CheckEmailPage />);

    expect(screen.queryByLabelText("確認コード")).toBeNull();
    expect(screen.getByText(/最初からやり直してください/)).toBeTruthy();
  });
});
