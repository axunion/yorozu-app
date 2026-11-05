import { Route, Router } from "@solidjs/router";
import AdminGuard from "./layouts/AdminGuard";
import CheckoutPage from "./pages/CheckoutPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";
import MenuPage from "./pages/MenuPage";
import OrderEntryPage from "./pages/OrderEntryPage";
import OrdersPage from "./pages/OrdersPage";
import ReportsPage from "./pages/ReportsPage";
import SalesPage from "./pages/SalesPage";
import SeatsPage from "./pages/SeatsPage";
import SettingsPage from "./pages/SettingsPage";
import StaffPage from "./pages/StaffPage";

export default function App() {
  return (
    <Router>
      <Route path="/login" component={LoginPage} />
      <Route path="/" component={AdminGuard}>
        <Route path="/" component={DashboardPage} />
        <Route path="/menu" component={MenuPage} />
        <Route path="/seats" component={SeatsPage} />
        <Route path="/orders" component={OrdersPage} />
        <Route path="/orders/new" component={OrderEntryPage} />
        <Route path="/checkout" component={CheckoutPage} />
        <Route path="/sales" component={SalesPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/staff" component={StaffPage} />
      </Route>
    </Router>
  );
}
