import type { LoginResponse } from "@yorozu/core";
import { jsonFetch } from "@yorozu/core/client";
import { Button, Field } from "@yorozu/ui";
import { createSignal, Show } from "solid-js";
import styles from "./LoginForm.module.css";

export default function LoginForm() {
  const [email, setEmail] = createSignal("");
  const [error, setError] = createSignal("");
  const [sent, setSent] = createSignal(false);
  const [verifyUrl, setVerifyUrl] = createSignal<string | undefined>(undefined);
  const [submitting, setSubmitting] = createSignal(false);

  const handleSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setError("");
    setVerifyUrl(undefined);
    setSubmitting(true);
    try {
      // `app` is an enum the API maps to an origin from its own env, so the
      // Magic Link lands back here instead of in admin.
      const result = await jsonFetch<LoginResponse>("/api/auth/login", "POST", {
        email: email(),
        app: "shift",
      });
      if (!result.ok) {
        setError(result.message ?? "エラーが発生しました");
        return;
      }
      setVerifyUrl(result.data?.verify_url);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Show
      when={!sent()}
      fallback={
        <>
          <p class={styles.sent}>
            メールを送信しました。受信箱のリンクをクリックしてログインしてください。
          </p>
          <Show when={verifyUrl()}>
            {(url) => (
              <p class={styles.devNote}>
                [DEV] メール送信をスキップ:{" "}
                <a href={url()} class={styles.devLink}>
                  このリンクで直接ログインする
                </a>
              </p>
            )}
          </Show>
        </>
      }
    >
      <form onSubmit={handleSubmit} class={styles.form}>
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
          {submitting() ? "送信中..." : "ログインリンクを送信"}
        </Button>
      </form>
    </Show>
  );
}
