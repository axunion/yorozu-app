import { A } from "@solidjs/router";
import { Show } from "solid-js";
import { useStoreInfo } from "../layouts/AdminGuard";
import AdminLayout from "../layouts/AdminLayout";
import styles from "./DashboardPage.module.css";

export default function DashboardPage() {
  const store = useStoreInfo();

  return (
    <AdminLayout title="管理画面">
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
