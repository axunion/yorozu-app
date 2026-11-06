import { A } from "@solidjs/router";
import OrderBoard from "../components/OrderBoard";
import AdminLayout from "../layouts/AdminLayout";
import styles from "./PageActions.module.css";

export default function OrdersPage() {
  return (
    <AdminLayout title="注文確認">
      <div class={styles.actions}>
        <A href="/orders/new" class={styles.actionLink}>
          ＋ 注文を入力
        </A>
      </div>
      <OrderBoard />
    </AdminLayout>
  );
}
