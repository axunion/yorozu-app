import { render, screen } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { data, mockFetch } from "../test-helpers";
import LoginForm from "./LoginForm";

afterEach(() => vi.restoreAllMocks());

/**
 * Verifying navigates on success, which happy-dom cannot follow. Swap in a
 * plain object so the component can assign href and the test can read it.
 */
let navigatedTo: string;
beforeEach(() => {
  navigatedTo = "";
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

async function requestCode(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByLabelText("メールアドレス"),
    "staff@test.internal",
  );
  await user.click(screen.getByRole("button", { name: "確認コードを送信" }));
}

describe("LoginForm", () => {
  it("asks the API for a code and then shows the code step", async () => {
    const fetchStub = mockFetch([
      {
        url: "/api/auth/login",
        method: "POST",
        json: data({ sent: true }),
      },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    render(() => <LoginForm />);
    await requestCode(user);

    const call = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(String(call[0])).toContain("/api/auth/login");
    expect(JSON.parse(String(call[1].body))).toEqual({
      email: "staff@test.internal",
    });
    expect(await screen.findByLabelText("確認コード")).toBeTruthy();
  });

  it("tells the API the code belongs to the shift app", async () => {
    // Without this field the API resolves the landing origin to ADMIN_ORIGIN,
    // so every staff member would be sent to the wrong SPA after a correct
    // code — and nothing else in this app would notice.
    const fetchStub = mockFetch([
      { url: "/api/auth/login", method: "POST", json: data({ sent: true }) },
      {
        url: "/api/auth/verify-code",
        method: "POST",
        json: data({ redirect_to: "http://shift.localhost" }),
      },
    ]);
    vi.stubGlobal("fetch", fetchStub);
    const user = userEvent.setup();

    render(() => <LoginForm />);
    await requestCode(user);
    await user.type(await screen.findByLabelText("確認コード"), "123456");
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    const call = fetchStub.mock.calls.at(-1) as [string, RequestInit];
    expect(String(call[0])).toContain("/api/auth/verify-code");
    expect(JSON.parse(String(call[1].body))).toEqual({
      email: "staff@test.internal",
      code: "123456",
      app: "shift",
    });
  });

  it("sends the browser to the origin the API names", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/auth/login", method: "POST", json: data({ sent: true }) },
        {
          url: "/api/auth/verify-code",
          method: "POST",
          json: data({ redirect_to: "http://shift.localhost" }),
        },
      ]),
    );
    const user = userEvent.setup();

    render(() => <LoginForm />);
    await requestCode(user);
    await user.type(await screen.findByLabelText("確認コード"), "123456");
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    expect(navigatedTo).toBe("http://shift.localhost");
  });

  it("keeps the email form up and shows the reason when the API rejects it", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        {
          url: "/api/auth/login",
          method: "POST",
          ok: false,
          json: {
            error: { code: "NOT_FOUND", message: "登録されていません" },
          },
        },
      ]),
    );
    const user = userEvent.setup();

    render(() => <LoginForm />);
    await user.type(
      screen.getByLabelText("メールアドレス"),
      "nobody@test.internal",
    );
    await user.click(screen.getByRole("button", { name: "確認コードを送信" }));

    expect(await screen.findByText("登録されていません")).toBeTruthy();
    expect(screen.queryByLabelText("確認コード")).toBeNull();
  });

  it("stays on the code step and explains when the code is wrong", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch([
        { url: "/api/auth/login", method: "POST", json: data({ sent: true }) },
        {
          url: "/api/auth/verify-code",
          method: "POST",
          ok: false,
          json: {
            error: {
              code: "INVALID_CODE",
              message: "コードが正しくないか、有効期限が切れています。",
            },
          },
        },
      ]),
    );
    const user = userEvent.setup();

    render(() => <LoginForm />);
    await requestCode(user);
    await user.type(await screen.findByLabelText("確認コード"), "000000");
    await user.click(screen.getByRole("button", { name: "ログイン" }));

    expect(
      await screen.findByText("コードが正しくないか、有効期限が切れています。"),
    ).toBeTruthy();
    expect(screen.getByLabelText("確認コード")).toBeTruthy();
    expect(navigatedTo).toBe("");
  });
});
