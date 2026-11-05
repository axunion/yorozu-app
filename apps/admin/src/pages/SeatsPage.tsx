import SeatManager from "../components/SeatManager";
import AdminLayout from "../layouts/AdminLayout";
import OwnerOnly from "../layouts/OwnerOnly";

export default function SeatsPage() {
  return (
    <AdminLayout title="座席管理" backHref="/" backLabel="← 管理トップ">
      <OwnerOnly>
        <SeatManager />
      </OwnerOnly>
    </AdminLayout>
  );
}
