import type { LoginResponse, VerifyCodeResponse } from "@yorozu/core";
import { jsonFetch } from "@yorozu/core/client";
import { Card, CodeEntryForm } from "@yorozu/ui";
import { createSignal, Show } from "solid-js";
import { readSignupHandoff } from "../handoff";
import styles from "./CheckEmailPage.module.css";

export default function CheckEmailPage() {
  const handoff = readSignupHandoff();
  const [error, setError] = createSignal("");
  const [devCode, setDevCode] = createSignal(handoff?.code);
  const [submitting, setSubmitting] = createSignal(false);

  const handleVerify = async (code: string) => {
    if (!handoff) return;
    setError("");
    setSubmitting(true);
    try {
      const result = await jsonFetch<VerifyCodeResponse>(
        "/api/auth/verify-code",
        "POST",
        { email: handoff.email, code },
      );
      if (!result.ok || !result.data) {
        setError(result.message ?? "エラーが発生しました");
        return;
      }
      // Crossing to the admin origin, which this app does not carry in its own
      // env — the API resolves it from the same fixed map it has always used.
      // The session cookie is shared across the subdomains under COOKIE_DOMAIN.
      window.location.href = result.data.redirect_to;
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = () => {
    if (!handoff) return;
    setError("");
    // The owner is still pending here, so a login request reissues the signup
    // code rather than a login one.
    void jsonFetch<LoginResponse>("/api/auth/login", "POST", {
      email: handoff.email,
    }).then((result) => {
      if (result.ok) setDevCode(result.data?.code);
    });
  };

  return (
    <main class={styles.page}>
      <Card class={styles.card}>
        <h1 class={styles.heading}>確認コードを入力してください</h1>
        <Show
          when={handoff}
          fallback={
            <p class={styles.body}>
              お申し込みの情報が見つかりませんでした。
              <br />
              お手数ですが<a href="/">最初からやり直してください</a>。
            </p>
          }
        >
          {(info) => (
            <>
              <p class={styles.note}>
                メールが届かない場合は迷惑メールフォルダをご確認ください。
              </p>
              <CodeEntryForm
                id="signup-code"
                sentTo={info().email}
                submitLabel="登録を完了する"
                error={error()}
                submitting={submitting()}
                onSubmit={handleVerify}
                onResend={handleResend}
              />
              <Show when={devCode()}>
                {(code) => (
                  <p class={styles.devNote}>[DEV] 確認コード: {code()}</p>
                )}
              </Show>
            </>
          )}
        </Show>
      </Card>
    </main>
  );
}
