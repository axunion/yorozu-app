import { A } from "@solidjs/router";
import OrderBoard from "../components/OrderBoard";
import AdminLayout from "../layouts/AdminLayout";
import styles from "./OrdersPage.module.css";

export default function OrdersPage() {
  return (
    <AdminLayout title="注文確認" backHref="/" backLabel="← 管理トップ">
      <div class={styles.actions}>
        <A href="/orders/new" class={styles.entryLink}>
          ＋ 注文を入力
        </A>
      </div>
      <OrderBoard />
    </AdminLayout>
  );
}
