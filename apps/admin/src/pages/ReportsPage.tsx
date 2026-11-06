import ReportsManager from "../components/ReportsManager";
import AdminLayout from "../layouts/AdminLayout";

export default function ReportsPage() {
  return (
    <AdminLayout title="レポート">
      <ReportsManager />
    </AdminLayout>
  );
}
