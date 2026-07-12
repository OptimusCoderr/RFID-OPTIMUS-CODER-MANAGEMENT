import { Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";

import LoginPage from "@/pages/LoginPage";
import RegisterCompanyPage from "@/pages/RegisterCompanyPage";
import ForgotPasswordPage from "@/pages/ForgotPasswordPage";
import ResetPasswordPage from "@/pages/ResetPasswordPage";
import DashboardPage from "@/pages/DashboardPage";
import CompaniesPage from "@/pages/CompaniesPage";
import UsersPage from "@/pages/UsersPage";
import HoldersPage from "@/pages/HoldersPage";
import HolderDetailPage from "@/pages/HolderDetailPage";
import CardsPage from "@/pages/CardsPage";
import CardDetailPage from "@/pages/CardDetailPage";
import TemplatesPage from "@/pages/TemplatesPage";
import EncodersPage from "@/pages/EncodersPage";
import EncoderDetailPage from "@/pages/EncoderDetailPage";
import LiveEncodePage from "@/pages/LiveEncodePage";
import ZonesPage from "@/pages/ZonesPage";
import LogsPage from "@/pages/LogsPage";
import ProfilePage from "@/pages/ProfilePage";
import CompanySettingsPage from "@/pages/CompanySettingsPage";
import NotFoundPage from "@/pages/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterCompanyPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route element={<ProtectedRoute allow={["SUPER_ADMIN"]} />}>
            <Route path="/companies" element={<CompaniesPage />} />
          </Route>
          <Route element={<ProtectedRoute allow={["SUPER_ADMIN", "COMPANY_ADMIN"]} />}>
            <Route path="/users" element={<UsersPage />} />
            <Route path="/company-settings" element={<CompanySettingsPage />} />
          </Route>
          <Route path="/holders" element={<HoldersPage />} />
          <Route path="/holders/:id" element={<HolderDetailPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/cards/:id" element={<CardDetailPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/encoders" element={<EncodersPage />} />
          <Route path="/encoders/:id" element={<EncoderDetailPage />} />
          <Route path="/live-encode" element={<LiveEncodePage />} />
          <Route path="/zones" element={<ZonesPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
        </Route>
      </Route>

      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
