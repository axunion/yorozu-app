import { useSearchParams } from "@solidjs/router";
import { MAGIC_LINK_VERIFY_PATH } from "@yorozu/core";
import { Card } from "@yorozu/ui";
import { createMemo, Show } from "solid-js";
import styles from "./CheckEmailPage.module.css";

// verify_url arrives via a client-controlled query string, so it must be
// validated as a genuine Magic Link URL before being rendered as a link —
// otherwise anyone could craft a link that displays an arbitrary href
// (including a javascript:, file:, or ftp: URI) under the trusted signup
// domain. The protocol check is required alongside the pathname check:
// file:/ftp:/ws: URLs can also resolve to pathname "/api/auth/verify".
function isSafeVerifyUrl(value: string): boolean {
  try {
    const parsed = new URL(value, window.location.origin);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.pathname === MAGIC_LINK_VERIFY_PATH &&
      parsed.searchParams.has("token")
    );
  } catch {
    return false;
  }
}

export default function CheckEmailPage() {
  const [searchParams] = useSearchParams();
  const verifyUrl = createMemo(() => {
    const v = searchParams.verify_url;
    const value = Array.isArray(v) ? v[0] : v;
    return value && isSafeVerifyUrl(value) ? value : undefined;
  });

  return (
    <main class={styles.page}>
      <Card class={styles.card}>
        <h1 class={styles.heading}>メールをご確認ください</h1>
        <p class={styles.body}>
          入力いただいたメールアドレス宛に確認メールを送信しました。
          <br />
          メール内のリンクをクリックすると登録が完了し、管理画面へ移動します。
        </p>
        <p class={styles.note}>
          メールが届かない場合は迷惑メールフォルダをご確認ください。
          <br />
          再送が必要な場合はメールアドレスを再度入力して申し込みください。
        </p>
        <Show when={verifyUrl()}>
          {(url) => (
            <p class={styles.devNote}>
              [DEV] メール送信をスキップ:{" "}
              <a href={url()} class={styles.devLink}>
                このリンクで直接確認する
              </a>
            </p>
          )}
        </Show>
      </Card>
    </main>
  );
}
