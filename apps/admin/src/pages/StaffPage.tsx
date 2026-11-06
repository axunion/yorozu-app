import StaffManager from "../components/StaffManager";
import AdminLayout from "../layouts/AdminLayout";
import OwnerOnly from "../layouts/OwnerOnly";

export default function StaffPage() {
  return (
    <AdminLayout title="スタッフ管理">
      <OwnerOnly>
        <StaffManager />
      </OwnerOnly>
    </AdminLayout>
  );
}
