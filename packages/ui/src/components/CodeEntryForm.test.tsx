import { render } from "@solidjs/testing-library";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import CodeEntryForm from "./CodeEntryForm";

afterEach(() => {
  vi.useRealTimers();
});

const noop = () => {};
/** Stands in for a caller whose request went through. */
const resendOk = async () => true;

describe("CodeEntryForm", () => {
  it("hands the typed code to onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { getByLabelText, getByRole } = render(() => (
      <CodeEntryForm
        id="login-code"
        submitLabel="ログイン"
        onSubmit={onSubmit}
        onResend={resendOk}
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
        onResend={resendOk}
      />
    ));

    const input = getByLabelText("確認コード") as HTMLInputElement;
    expect(input.type).toBe("text");
    expect(input.inputMode).toBe("numeric");
    expect(input.autocomplete).toBe("one-time-code");
    // Room for the separators the API normalizes away, not just six digits.
    expect(input.maxLength).toBeGreaterThan(6);
  });

  it("lets a pasted code keep its separators, which the API strips", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { getByLabelText, getByRole } = render(() => (
      <CodeEntryForm
        id="sep-code"
        submitLabel="送信"
        onSubmit={onSubmit}
        onResend={resendOk}
      />
    ));

    await user.type(getByLabelText("確認コード"), "123-456");
    await user.click(getByRole("button", { name: "送信" }));

    expect(onSubmit).toHaveBeenCalledWith("123-456");
  });

  it("keeps a leading zero in what it submits", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { getByLabelText, getByRole } = render(() => (
      <CodeEntryForm
        id="zero-code"
        submitLabel="送信"
        onSubmit={onSubmit}
        onResend={resendOk}
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
        onResend={resendOk}
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
        onResend={resendOk}
      />
    ));

    expect(getByRole("alert").textContent).toContain(
      "コードが正しくありません。",
    );
  });

  it("locks the input and both buttons while submitting", () => {
    const { getByLabelText, getByRole } = render(() => (
      <CodeEntryForm
        id="busy-code"
        submitLabel="ログイン"
        submitting
        onSubmit={noop}
        onResend={resendOk}
      />
    ));

    expect((getByLabelText("確認コード") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (getByRole("button", { name: "確認中..." }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    // Held inert by aria-disabled rather than the attribute, so it keeps focus.
    expect(
      getByRole("button", { name: "コードを再送する" }).getAttribute(
        "aria-disabled",
      ),
    ).toBe("true");
  });

  it("moves focus to the code input on mount", () => {
    // This step replaces the previous one wholesale, so without it focus would
    // land on <body>.
    const { getByLabelText } = render(() => (
      <CodeEntryForm
        id="focus-code"
        submitLabel="ログイン"
        onSubmit={noop}
        onResend={resendOk}
      />
    ));

    expect(document.activeElement).toBe(getByLabelText("確認コード"));
  });

  it("calls onResend and then holds the button on a cooldown", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onResend = vi.fn(async () => true);
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
    const cooling = getByRole("button", { name: /あと\d+秒で再送できます/ });
    expect(cooling.getAttribute("aria-disabled")).toBe("true");
    // Still focusable — the button does not vanish from under the pointer.
    expect((cooling as HTMLButtonElement).disabled).toBe(false);

    // ...and clicking it again during the cooldown does nothing.
    await user.click(cooling);
    expect(onResend).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);

    const ready = getByRole("button", { name: "コードを再送する" });
    expect(ready.getAttribute("aria-disabled")).toBe("false");
  });

  it("announces the resend, since the label change alone is not spoken", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { getByRole } = render(() => (
      <CodeEntryForm
        id="announce-code"
        submitLabel="ログイン"
        onSubmit={noop}
        onResend={resendOk}
      />
    ));

    await user.click(getByRole("button", { name: "コードを再送する" }));

    expect(getByRole("status").textContent).toContain("再送しました");
  });

  it("neither announces a resend nor starts a cooldown when none went out", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onResend = vi.fn(async () => false);
    const { getByRole, queryByRole } = render(() => (
      <CodeEntryForm
        id="failed-resend-code"
        submitLabel="変更を確定する"
        onSubmit={noop}
        onResend={onResend}
      />
    ));

    await user.click(getByRole("button", { name: "コードを再送する" }));

    expect(onResend).toHaveBeenCalledTimes(1);
    expect(queryByRole("status")).toBeNull();
    const button = getByRole("button", { name: "コードを再送する" });
    expect(button.getAttribute("aria-disabled")).toBe("false");

    // And the visitor can try again immediately.
    await user.click(button);
    expect(onResend).toHaveBeenCalledTimes(2);
  });

  it("ignores a second tap while the first resend is still open", async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    const onResend = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    const { getByRole } = render(() => (
      <CodeEntryForm
        id="double-resend-code"
        submitLabel="ログイン"
        onSubmit={noop}
        onResend={onResend}
      />
    ));

    const button = getByRole("button", { name: "コードを再送する" });
    await user.click(button);
    await user.click(button);

    expect(onResend).toHaveBeenCalledTimes(1);
    // Held inert while the request is open, and saying so: the cooldown label
    // has not started yet, so without this the button would read as available
    // while greyed out and aria-disabled.
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.textContent).toContain("送信中");

    release?.();
  });
});
