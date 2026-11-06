import { A } from "@solidjs/router";
import { Show } from "solid-js";
import { useStoreInfo } from "../layouts/AdminGuard";
import AdminLayout, { useAdminSummary } from "../layouts/AdminLayout";
import styles from "./DashboardPage.module.css";

/** Today at a glance, from the same counts the nav badges poll. */
function TodayStatus() {
  const summary = useAdminSummary();
  return (
    <Show when={summary()}>
      {(s) => (
        <dl class={styles.stats}>
          <div class={styles.stat}>
            <dt>本日の売上</dt>
            <dd>¥{s().today_sales.total.toLocaleString("ja-JP")}</dd>
            <dd class={styles.statSub}>{s().today_sales.count}件</dd>
          </div>
          <div class={styles.stat}>
            <dt>未提供の注文</dt>
            <dd>{s().unserved_orders}件</dd>
          </div>
          <div class={styles.stat}>
            <dt>呼び出し</dt>
            <dd>{s().open_calls}件</dd>
          </div>
          <div class={styles.stat}>
            <dt>会計待ち</dt>
            <dd>{s().pending_bills}件</dd>
          </div>
        </dl>
      )}
    </Show>
  );
}

export default function DashboardPage() {
  const store = useStoreInfo();

  return (
    <AdminLayout title="管理画面">
      <TodayStatus />
      <div class={styles.menu}>
        <Show when={store.role === "owner"}>
          <A href="/menu" class={styles.menuLink}>
            メニュー管理
          </A>
          <A href="/seats" class={styles.menuLink}>
            座席管理・QR 発行
          </A>
        </Show>
        <A href="/orders" class={styles.menuLink}>
          注文確認・提供管理
        </A>
        <A href="/checkout" class={styles.menuLink}>
          会計・レジ
        </A>
        <A href="/sales" class={styles.menuLink}>
          売上履歴
        </A>
        <A href="/reports" class={styles.menuLink}>
          レポート
        </A>
        <Show when={store.role === "owner"}>
          <A href="/staff" class={styles.menuLink}>
            スタッフ管理
          </A>
        </Show>
        <A href="/settings" class={styles.menuLink}>
          店舗設定
        </A>
      </div>
    </AdminLayout>
  );
}
