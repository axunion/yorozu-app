import StaffOrderEntry from "../components/StaffOrderEntry";
import AdminLayout from "../layouts/AdminLayout";

export default function OrderEntryPage() {
  return (
    <AdminLayout title="注文入力" backHref="/orders" backLabel="← 注文確認">
      <StaffOrderEntry />
    </AdminLayout>
  );
}
