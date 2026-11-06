import SeatPrintSheet from "../components/SeatPrintSheet";
import AdminLayout from "../layouts/AdminLayout";
import OwnerOnly from "../layouts/OwnerOnly";

export default function SeatPrintPage() {
  return (
    <AdminLayout title="QR 印刷" backHref="/seats" backLabel="← 座席管理">
      <OwnerOnly>
        <SeatPrintSheet />
      </OwnerOnly>
    </AdminLayout>
  );
}
