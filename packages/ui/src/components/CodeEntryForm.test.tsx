import { render } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CodeEntryForm from "./CodeEntryForm";

afterEach(() => {
  vi.useRealTimers();
});

const noop = () => {};

describe("CodeEntryForm", () => {
  it("hands the typed code to onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { getByLabelText, getByRole } = render(() => (
      <CodeEntryForm
        id="login-code"
        submitLabel="ログイン"
        onSubmit={onSubmit}
        onResend={noop}
      />
    ));

    await user.type(getByLabelText("確認コード"), "123456");
    await user.click(getByRole("button", { name: "ログイン" }));

    expect(onSubmit).toHaveBeenCalledWith("123456");
  });

  it("uses a text input with the numeric keypad and one-time-code hints", () => {
    // type="number" would strip a leading zero and open the wrong keyboard.
    const { getByLabelText } = render(() => (
      <CodeEntryForm
        id="code-hints"
        submitLabel="確認"
        onSubmit={noop}
        onResend={noop}
      />
    ));

    const input = getByLabelText("確認コード") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("numeric");
    expect(input.autocomplete).toBe("one-time-code");
    expect(input.maxLength).toBe(6);
  });

  it("keeps a leading zero in what it submits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { getByLabelText, getByRole } = render(() => (
      <CodeEntryForm
        id="zero-code"
        submitLabel="送信"
        onSubmit={onSubmit}
        onResend={noop}
      />
    ));

    await user.type(getByLabelText("確認コード"), "012345");
    await user.click(getByRole("button", { name: "送信" }));

    expect(onSubmit).toHaveBeenCalledWith("012345");
  });

  it("shows the address the code went to", () => {
    const { getByText } = render(() => (
      <CodeEntryForm
        id="sent-code"
        sentTo="owner@example.com"
        submitLabel="ログイン"
        onSubmit={noop}
        onResend={noop}
      />
    ));

    expect(getByText(/owner@example\.com/)).toBeTruthy();
  });

  it("shows the error it is given", () => {
    const { getByRole } = render(() => (
      <CodeEntryForm
        id="err-code"
        submitLabel="ログイン"
        error="コードが正しくありません。"
        onSubmit={noop}
        onResend={noop}
      />
    ));

    expect(getByRole("alert").textContent).toContain(
      "コードが正しくありません。",
    );
  });

  it("disables both buttons and the input while submitting", () => {
    const { getByLabelText, getByRole } = render(() => (
      <CodeEntryForm
        id="busy-code"
        submitLabel="ログイン"
        submitting
        onSubmit={noop}
        onResend={noop}
      />
    ));

    expect((getByLabelText("確認コード") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (getByRole("button", { name: "確認中..." }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (getByRole("button", { name: "コードを再送する" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("calls onResend and then holds the button on a cooldown", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onResend = vi.fn();
    const { getByRole } = render(() => (
      <CodeEntryForm
        id="resend-code"
        submitLabel="ログイン"
        onSubmit={noop}
        onResend={onResend}
      />
    ));

    await user.click(getByRole("button", { name: "コードを再送する" }));
    expect(onResend).toHaveBeenCalledTimes(1);

    // Resending is silently rate-limited server-side, so the cooldown is what
    // stops a user burning their remaining sends with no feedback.
    const cooling = getByRole("button", {
      name: /再送できます/,
    }) as HTMLButtonElement;
    expect(cooling.disabled).toBe(true);

    vi.advanceTimersByTime(60_000);

    const ready = getByRole("button", {
      name: "コードを再送する",
    }) as HTMLButtonElement;
    expect(ready.disabled).toBe(false);
  });
});
