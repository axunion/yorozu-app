import SalesHistory from "../components/SalesHistory";
import AdminLayout from "../layouts/AdminLayout";

export default function SalesPage() {
  return (
    <AdminLayout title="売上履歴">
      <SalesHistory />
    </AdminLayout>
  );
}
