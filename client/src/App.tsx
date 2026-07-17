import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/layout/ProtectedRoute";
import { FullPageSpinner } from "@/components/ui/Spinner";

// Login and Dashboard are on the critical path for every session (the first
// screen an unauthenticated user sees, and the first screen after signing
// in) — kept in the main bundle. Everything else loads on demand: a
// dashboard app like this is mostly single-page visits per session, so
// shipping e.g. the DESFire-heavy Live Encode/Templates editors to someone
// who only ever checks the Dashboard is pure waste.
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";

const RegisterCompanyPage = lazy(() => import("@/pages/RegisterCompanyPage"));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPasswordPage"));
const CompaniesPage = lazy(() => import("@/pages/CompaniesPage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const HoldersPage = lazy(() => import("@/pages/HoldersPage"));
const HolderDetailPage = lazy(() => import("@/pages/HolderDetailPage"));
const CardsPage = lazy(() => import("@/pages/CardsPage"));
const CardDetailPage = lazy(() => import("@/pages/CardDetailPage"));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage"));
const EncodersPage = lazy(() => import("@/pages/EncodersPage"));
const EncoderDetailPage = lazy(() => import("@/pages/EncoderDetailPage"));
const LiveEncodePage = lazy(() => import("@/pages/LiveEncodePage"));
const ZonesPage = lazy(() => import("@/pages/ZonesPage"));
const AttendancePage = lazy(() => import("@/pages/AttendancePage"));
const VisitorsPage = lazy(() => import("@/pages/VisitorsPage"));
const MaintenancePage = lazy(() => import("@/pages/MaintenancePage"));
const LogsPage = lazy(() => import("@/pages/LogsPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const CompanySettingsPage = lazy(() => import("@/pages/CompanySettingsPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

export default function App() {
  return (
    <Suspense fallback={<FullPageSpinner />}>
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
            <Route element={<ProtectedRoute module="HOLDERS" />}>
              <Route path="/holders" element={<HoldersPage />} />
              <Route path="/holders/:id" element={<HolderDetailPage />} />
            </Route>
            <Route element={<ProtectedRoute module="CARDS" />}>
              <Route path="/cards" element={<CardsPage />} />
              <Route path="/cards/:id" element={<CardDetailPage />} />
            </Route>
            <Route element={<ProtectedRoute module="TEMPLATES" />}>
              <Route path="/templates" element={<TemplatesPage />} />
            </Route>
            <Route element={<ProtectedRoute module="ENCODERS" />}>
              <Route path="/encoders" element={<EncodersPage />} />
              <Route path="/encoders/:id" element={<EncoderDetailPage />} />
              <Route path="/live-encode" element={<LiveEncodePage />} />
            </Route>
            <Route element={<ProtectedRoute module="ZONES" />}>
              <Route path="/zones" element={<ZonesPage />} />
            </Route>
            <Route element={<ProtectedRoute module="ATTENDANCE" />}>
              <Route path="/attendance" element={<AttendancePage />} />
            </Route>
            <Route element={<ProtectedRoute module="VISITORS" />}>
              <Route path="/visitors" element={<VisitorsPage />} />
            </Route>
            <Route element={<ProtectedRoute module="MAINTENANCE" />}>
              <Route path="/maintenance" element={<MaintenancePage />} />
            </Route>
            <Route element={<ProtectedRoute module="LOGS" />}>
              <Route path="/logs" element={<LogsPage />} />
            </Route>
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
