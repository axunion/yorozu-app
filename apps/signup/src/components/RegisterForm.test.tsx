import { render } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSignupHandoff } from "../handoff";
import RegisterForm from "./RegisterForm";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RegisterForm", () => {
  it("renders a store name input", () => {
    const { getByLabelText } = render(() => <RegisterForm />);
    expect(getByLabelText(/店舗名/)).toBeTruthy();
  });

  it("renders an email input", () => {
    const { getByLabelText } = render(() => <RegisterForm />);
    expect(getByLabelText(/メールアドレス/)).toBeTruthy();
  });

  it("renders a submit button", () => {
    const { getByRole } = render(() => <RegisterForm />);
    expect(getByRole("button", { name: /申し込む/ })).toBeTruthy();
  });

  it("calls POST /api/stores with name and email on submit", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { id: "1", name: "My Cafe", slug: "my-cafe-abc12" },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { getByLabelText, getByRole } = render(() => <RegisterForm />);
    await user.type(getByLabelText(/店舗名/), "My Cafe");
    await user.type(getByLabelText(/メールアドレス/), "owner@example.com");
    await user.click(getByRole("button", { name: /申し込む/ }));

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/stores",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({ name: "My Cafe", email: "owner@example.com" }),
      }),
    );
  });

  it("shows an error message on API failure", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: "SERVER_ERROR", message: "server failed" },
        }),
      }),
    );

    const { getByLabelText, getByRole, findByText } = render(() => (
      <RegisterForm />
    ));
    await user.type(getByLabelText(/店舗名/), "Fail Shop");
    await user.type(getByLabelText(/メールアドレス/), "fail@example.com");
    await user.click(getByRole("button", { name: /申し込む/ }));

    expect(await findByText(/server failed/)).toBeTruthy();
  });
});

describe("RegisterForm — handing over to the code screen", () => {
  /**
   * A full page navigation separates the two screens, so happy-dom needs a
   * stand-in for location before the component assigns to it.
   */
  function captureNavigation() {
    const state = { href: "" };
    Object.defineProperty(window, "location", {
      configurable: true,
      value: state,
    });
    return state;
  }

  it("stores the address and moves to the code screen on success", async () => {
    sessionStorage.clear();
    const navigation = captureNavigation();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: { id: "1", name: "My Cafe", slug: "my-cafe-abc12" },
        }),
      }),
    );
    const user = userEvent.setup();

    const { getByLabelText, getByRole } = render(() => <RegisterForm />);
    await user.type(getByLabelText(/店舗名/), "My Cafe");
    await user.type(getByLabelText(/メールアドレス/), "owner@example.com");
    await user.click(getByRole("button", { name: /申し込む/ }));

    // Over sessionStorage, not the query string: an email address in the URL
    // would persist in history.
    expect(readSignupHandoff()?.email).toBe("owner@example.com");
    expect(navigation.href).toBe("/check-email");
  });

  it("passes the dev-only code along when the API echoes one", async () => {
    sessionStorage.clear();
    captureNavigation();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            id: "1",
            name: "My Cafe",
            slug: "my-cafe-abc12",
            code: "123456",
          },
        }),
      }),
    );
    const user = userEvent.setup();

    const { getByLabelText, getByRole } = render(() => <RegisterForm />);
    await user.type(getByLabelText(/店舗名/), "My Cafe");
    await user.type(getByLabelText(/メールアドレス/), "owner@example.com");
    await user.click(getByRole("button", { name: /申し込む/ }));

    expect(readSignupHandoff()?.code).toBe("123456");
  });

  it("stays on the form and hands nothing over when registration fails", async () => {
    sessionStorage.clear();
    const navigation = captureNavigation();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: {
            code: "VALIDATION_ERROR",
            message: "このメールアドレスはすでに登録されています",
          },
        }),
      }),
    );
    const user = userEvent.setup();

    const { getByLabelText, getByRole, findByText } = render(() => (
      <RegisterForm />
    ));
    await user.type(getByLabelText(/店舗名/), "My Cafe");
    await user.type(getByLabelText(/メールアドレス/), "taken@example.com");
    await user.click(getByRole("button", { name: /申し込む/ }));

    expect(
      await findByText("このメールアドレスはすでに登録されています"),
    ).toBeTruthy();
    expect(readSignupHandoff()).toBeUndefined();
    expect(navigation.href).toBe("");
  });
});
