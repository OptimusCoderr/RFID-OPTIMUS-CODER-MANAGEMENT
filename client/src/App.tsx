import { Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";

import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import CompaniesPage from "@/pages/CompaniesPage";
import UsersPage from "@/pages/UsersPage";
import HoldersPage from "@/pages/HoldersPage";
import CardsPage from "@/pages/CardsPage";
import CardDetailPage from "@/pages/CardDetailPage";
import TemplatesPage from "@/pages/TemplatesPage";
import EncodersPage from "@/pages/EncodersPage";
import LiveEncodePage from "@/pages/LiveEncodePage";
import ZonesPage from "@/pages/ZonesPage";
import LogsPage from "@/pages/LogsPage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route element={<ProtectedRoute allow={["SUPER_ADMIN"]} />}>
            <Route path="/companies" element={<CompaniesPage />} />
          </Route>
          <Route element={<ProtectedRoute allow={["SUPER_ADMIN", "COMPANY_ADMIN"]} />}>
            <Route path="/users" element={<UsersPage />} />
          </Route>
          <Route path="/holders" element={<HoldersPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/cards/:id" element={<CardDetailPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/encoders" element={<EncodersPage />} />
          <Route path="/live-encode" element={<LiveEncodePage />} />
          <Route path="/zones" element={<ZonesPage />} />
          <Route path="/logs" element={<LogsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
