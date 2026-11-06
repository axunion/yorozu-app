import CheckoutPanel from "../components/CheckoutPanel";
import AdminLayout from "../layouts/AdminLayout";

export default function CheckoutPage() {
  return (
    <AdminLayout title="会計・レジ">
      <CheckoutPanel />
    </AdminLayout>
  );
}
