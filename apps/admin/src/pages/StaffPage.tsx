import StaffManager from "../components/StaffManager";
import AdminLayout from "../layouts/AdminLayout";
import OwnerOnly from "../layouts/OwnerOnly";

export default function StaffPage() {
  return (
    <AdminLayout title="スタッフ管理" backHref="/" backLabel="← 管理トップ">
      <OwnerOnly>
        <StaffManager />
      </OwnerOnly>
    </AdminLayout>
  );
}
