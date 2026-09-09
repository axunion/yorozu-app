import type { LoginResponse, VerifyCodeResponse } from "@yorozu/core";
import { jsonFetch } from "@yorozu/core/client";
import { Button, CodeEntryForm, Field } from "@yorozu/ui";
import { createSignal, Show } from "solid-js";
import styles from "./LoginForm.module.css";

interface LoginFormProps {
  /**
   * Address to start with. Invite emails link here with `?email=`, so the
   * invitee — who already has a code but never asked this screen for one —
   * lands straight on the code step.
   */
  initialEmail?: string;
}

export default function LoginForm(props: LoginFormProps) {
  const [email, setEmail] = createSignal(props.initialEmail ?? "");
  const [error, setError] = createSignal("");
  const [sent, setSent] = createSignal(Boolean(props.initialEmail));
  const [devCode, setDevCode] = createSignal<string | undefined>(undefined);
  const [submitting, setSubmitting] = createSignal(false);

  /** Returns whether a code was requested without an error. */
  const requestCode = async (): Promise<boolean> => {
    const result = await jsonFetch<LoginResponse>("/api/auth/login", "POST", {
      email: email(),
    });
    if (!result.ok) {
      setError(result.message ?? "エラーが発生しました");
      return false;
    }
    setDevCode(result.data?.code);
    return true;
  };

  const handleRequest = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (await requestCode()) setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = () => {
    setError("");
    void requestCode();
  };

  const handleVerify = async (code: string) => {
    setError("");
    setSubmitting(true);
    try {
      const result = await jsonFetch<VerifyCodeResponse>(
        "/api/auth/verify-code",
        "POST",
        { email: email(), code },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "エラーが発生しました");
        return;
      }
      // A full navigation rather than a router push: the session cookie was
      // just set, and the guard resolves it on a fresh load.
      window.location.href = result.data.redirect_to;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show
      when={!sent()}
      fallback={
        <>
          <CodeEntryForm
            id="login-code"
            sentTo={email()}
            submitLabel="ログイン"
            error={error()}
            submitting={submitting()}
            onSubmit={handleVerify}
            onResend={handleResend}
          />
          <Show when={devCode()}>
            {(code) => <p class={styles.devNote}>[DEV] 確認コード: {code()}</p>}
          </Show>
        </>
      }
    >
      <form onSubmit={handleRequest} class={styles.form}>
        <Field
          id="login-email"
          label="メールアドレス"
          type="email"
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
          placeholder="例：owner@example.com"
          required
          disabled={submitting()}
          error={error()}
        />
        <Button type="submit" fullWidth disabled={submitting()}>
          {submitting() ? "送信中..." : "確認コードを送信"}
        </Button>
      </form>
    </Show>
  );
}
