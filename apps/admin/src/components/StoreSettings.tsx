import type {
  EmailChangeResponse,
  EmailChangeVerifyResponse,
  StoreResponse,
} from "@yorozu/core";
import { apiFetch, jsonFetch } from "@yorozu/core/client";
import {
  Button,
  CodeEntryForm,
  ConfirmDialog,
  ErrorAlert,
  Field,
} from "@yorozu/ui";
import { createSignal, Match, Show, Switch } from "solid-js";
import { useStoreInfo } from "../layouts/AdminGuard";
import { downloadJson } from "../lib/download";
import styles from "./StoreSettings.module.css";

export default function StoreSettings() {
  const store = useStoreInfo();

  const [name, setName] = createSignal(store.name);
  const [nameError, setNameError] = createSignal("");
  const [nameSaving, setNameSaving] = createSignal(false);
  const [nameSaved, setNameSaved] = createSignal(false);

  const handleNameSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setNameError("");
    setNameSaved(false);
    setNameSaving(true);
    try {
      const result = await jsonFetch<StoreResponse>("/api/stores/me", "PATCH", {
        name: name(),
      });
      if (!result.ok || !result.data) {
        setNameError(result.message ?? "保存に失敗しました。");
        return;
      }
      setName(result.data.name);
      setNameSaved(true);
    } finally {
      setNameSaving(false);
    }
  };

  const [loggingOutAll, setLoggingOutAll] = createSignal(false);

  const handleLogoutAll = async () => {
    setLoggingOutAll(true);
    try {
      await apiFetch("/api/auth/logout-all", { method: "POST" }).catch(
        () => {},
      );
      // Full reload (not solid-router navigate): the server just cleared
      // every session cookie for this member, so the app must re-bootstrap
      // from scratch rather than continue with stale in-memory state.
      window.location.href = "/login";
    } finally {
      setLoggingOutAll(false);
    }
  };

  const [suspending, setSuspending] = createSignal(false);
  const [suspendError, setSuspendError] = createSignal("");

  const handleSuspend = async () => {
    setSuspendError("");
    setSuspending(true);
    try {
      const result = await apiFetch("/api/stores/me/suspend", {
        method: "POST",
      });
      if (!result.ok) {
        setSuspendError(result.message ?? "一時停止に失敗しました。");
        return;
      }
      // Every session for the store (including this one) was just deleted
      // server-side — re-bootstrap from scratch, same reasoning as logout-all.
      window.location.href = "/login";
    } finally {
      setSuspending(false);
    }
  };

  const [deleteConfirmName, setDeleteConfirmName] = createSignal("");
  const [deleting, setDeleting] = createSignal(false);
  const [deleteError, setDeleteError] = createSignal("");

  const handleDelete = async () => {
    setDeleteError("");
    setDeleting(true);
    try {
      const result = await jsonFetch<{ export: unknown }>(
        "/api/stores/me",
        "DELETE",
        { confirm_name: deleteConfirmName() },
      );
      if (!result.ok || !result.data) {
        setDeleteError(result.message ?? "削除に失敗しました。");
        return;
      }
      downloadJson(
        result.data.export,
        `${store.name}-export-${Date.now()}.json`,
      );
      // Give the browser a moment to actually start the download before
      // navigating away — this export is the owner's only copy of their
      // data, so a same-tick redirect risks cancelling it mid-start.
      setTimeout(() => {
        window.location.href = "/login";
      }, 300);
    } finally {
      setDeleting(false);
    }
  };

  const [newEmail, setNewEmail] = createSignal("");
  const [emailError, setEmailError] = createSignal("");
  const [emailSubmitting, setEmailSubmitting] = createSignal(false);
  const [emailSent, setEmailSent] = createSignal(false);
  const [emailChanged, setEmailChanged] = createSignal("");
  const [devCode, setDevCode] = createSignal<string | undefined>(undefined);

  const handleEmailSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    setEmailError("");
    setEmailSubmitting(true);
    try {
      const result = await jsonFetch<EmailChangeResponse>(
        "/api/stores/me/email-change",
        "POST",
        { new_email: newEmail() },
      );
      if (!result.ok) {
        setEmailError(result.message ?? "変更のリクエストに失敗しました。");
        return;
      }
      setDevCode(result.data?.code);
      setEmailSent(true);
    } finally {
      setEmailSubmitting(false);
    }
  };

  const handleEmailResend = async (): Promise<boolean> => {
    setEmailError("");
    const result = await jsonFetch<EmailChangeResponse>(
      "/api/stores/me/email-change",
      "POST",
      { new_email: newEmail() },
    );
    // Unlike /api/auth/login, this endpoint answers with real failures —
    // RATE_LIMITED past EMAIL_CHANGE_HOURLY_CAP, or VALIDATION_ERROR if the
    // address was claimed meanwhile. Reporting false keeps the form from
    // announcing a resend and starting a cooldown for mail that never went.
    if (!result.ok) {
      setEmailError(result.message ?? "再送に失敗しました。");
      return false;
    }
    setDevCode(result.data?.code);
    return true;
  };

  const handleEmailVerify = async (code: string) => {
    setEmailError("");
    setEmailSubmitting(true);
    try {
      const result = await jsonFetch<EmailChangeVerifyResponse>(
        "/api/stores/me/email-change/verify",
        "POST",
        { code },
      );
      if (!result.ok || !result.data) {
        setEmailError(result.message ?? "変更の確定に失敗しました。");
        return;
      }
      // No redirect: the caller is already signed in, so the change lands here
      // rather than bouncing them through a fresh session.
      setEmailChanged(result.data.email);
    } finally {
      setEmailSubmitting(false);
    }
  };

  return (
    <div class={styles.storeSettings}>
      <section class={styles.section}>
        <h2 class={styles.heading}>店舗名</h2>
        <form onSubmit={handleNameSubmit} class={styles.form}>
          <Field
            id="settings-store-name"
            label="店舗名"
            value={name()}
            onInput={(e) => {
              setName(e.currentTarget.value);
              setNameSaved(false);
            }}
            required
            maxLength={100}
            disabled={nameSaving()}
            error={nameError()}
          />
          <Button type="submit" disabled={nameSaving()}>
            {nameSaving() ? "保存中..." : "保存"}
          </Button>
          <Show when={nameSaved()}>
            <p class={styles.savedNote}>保存しました。</p>
          </Show>
        </form>
      </section>

      <section class={styles.section}>
        <h2 class={styles.heading}>自分のメールアドレス</h2>
        <p class={styles.currentEmail}>
          {/* The store context is resolved once on load and never refetched,
              so after a confirmed change it still holds the old address —
              which is exactly what this line calls "現在の". */}
          現在のログイン用メールアドレス:{" "}
          <strong>{emailChanged() || store.email}</strong>
        </p>

        {/* Three states in the order they occur: request the change, enter
            the code, done. The fallback is the first of them. */}
        <Switch
          fallback={
            <form onSubmit={handleEmailSubmit} class={styles.form}>
              <Field
                id="settings-new-email"
                label="新しいメールアドレス"
                type="email"
                value={newEmail()}
                onInput={(e) => setNewEmail(e.currentTarget.value)}
                placeholder="例：new-owner@example.com"
                required
                disabled={emailSubmitting()}
                error={emailError()}
              />
              <Button type="submit" disabled={emailSubmitting()}>
                {emailSubmitting() ? "送信中..." : "変更をリクエスト"}
              </Button>
            </form>
          }
        >
          <Match when={emailChanged()}>
            {(changed) => (
              <p
                class={styles.sent}
              >{`メールアドレスを ${changed()} に変更しました。`}</p>
            )}
          </Match>
          <Match when={emailSent()}>
            <CodeEntryForm
              id="settings-email-code"
              sentTo={newEmail()}
              submitLabel="変更を確定する"
              error={emailError()}
              submitting={emailSubmitting()}
              onSubmit={handleEmailVerify}
              onResend={handleEmailResend}
            />
            <Show when={devCode()}>
              {(code) => (
                <p class={styles.devNote}>[DEV] 確認コード: {code()}</p>
              )}
            </Show>
          </Match>
        </Switch>
      </section>

      <section class={styles.section}>
        <h2 class={styles.heading}>セッション</h2>
        <p class={styles.currentEmail}>
          自分の全端末のログインセッションを終了します。
        </p>
        <Button
          variant="secondary"
          disabled={loggingOutAll()}
          onClick={handleLogoutAll}
        >
          {loggingOutAll() ? "処理中..." : "ログアウト（全端末）"}
        </Button>
      </section>

      <Show when={store.role === "owner"}>
        <section class={`${styles.section} ${styles.dangerZone}`}>
          <h2 class={styles.heading}>危険な操作</h2>

          <div class={styles.dangerAction}>
            <div>
              <h3 class={styles.dangerActionTitle}>店舗の一時停止</h3>
              <p class={styles.currentEmail}>
                店舗を一時停止します。全メンバーが直ちにログアウトされます。再開はオーナーのログインから行えます。
              </p>
            </div>
            <Show when={suspendError()}>
              <ErrorAlert>{suspendError()}</ErrorAlert>
            </Show>
            <ConfirmDialog
              triggerLabel="一時停止する"
              triggerVariant="secondary"
              triggerDisabled={suspending()}
              title="店舗の一時停止"
              description="店舗を一時停止しますか？全メンバーのログインセッションが終了し、オーナーが再ログインするまで店舗は利用できなくなります。"
              confirmLabel="一時停止を確定する"
              confirmVariant="secondary"
              onConfirm={handleSuspend}
            />
          </div>

          <div class={styles.dangerAction}>
            <div>
              <h3 class={styles.dangerActionTitle}>アカウントの削除</h3>
              <p class={styles.currentEmail}>
                店舗のすべてのデータ（メニュー、座席、注文、決済履歴を含む）を完全に削除します。この操作は元に戻せません。
              </p>
            </div>
            <Field
              id="settings-delete-confirm"
              label={`確認のため店舗名「${store.name}」を入力してください`}
              value={deleteConfirmName()}
              onInput={(e) => setDeleteConfirmName(e.currentTarget.value)}
              disabled={deleting()}
            />
            <Show when={deleteError()}>
              <ErrorAlert>{deleteError()}</ErrorAlert>
            </Show>
            <ConfirmDialog
              triggerLabel="アカウントを削除する"
              triggerVariant="danger"
              triggerDisabled={deleteConfirmName() !== store.name || deleting()}
              title="アカウントの削除"
              description="この操作は元に戻せません。店舗のすべてのデータが完全に削除されます。削除前のデータはJSONファイルとしてダウンロードされます。"
              confirmLabel="完全に削除する"
              onConfirm={handleDelete}
            />
          </div>
        </section>
      </Show>
    </div>
  );
}
