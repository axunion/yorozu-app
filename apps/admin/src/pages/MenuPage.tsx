import MenuManager from "../components/MenuManager";
import OptionGroupManager from "../components/OptionGroupManager";
import AdminLayout from "../layouts/AdminLayout";
import OwnerOnly from "../layouts/OwnerOnly";

export default function MenuPage() {
  return (
    <AdminLayout title="メニュー管理" backHref="/" backLabel="← 管理トップ">
      <OwnerOnly>
        <MenuManager />
        <OptionGroupManager />
      </OwnerOnly>
    </AdminLayout>
  );
}
