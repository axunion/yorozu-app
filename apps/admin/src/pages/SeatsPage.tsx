import { A } from "@solidjs/router";
import SeatManager from "../components/SeatManager";
import AdminLayout from "../layouts/AdminLayout";
import OwnerOnly from "../layouts/OwnerOnly";
import styles from "./PageActions.module.css";

export default function SeatsPage() {
  return (
    <AdminLayout title="座席管理">
      <OwnerOnly>
        <div class={styles.actions}>
          <A href="/seats/print" class={styles.actionLink}>
            QR コードを印刷
          </A>
        </div>
        <SeatManager />
      </OwnerOnly>
    </AdminLayout>
  );
}
