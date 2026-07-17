import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { hasModule } from "@/lib/modules";
import type { Role, CompanyModule } from "@/types";

export function ProtectedRoute({ allow, module }: { allow?: Role[]; module?: CompanyModule }) {
  const { user, loading } = useAuth();

  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (allow && !allow.includes(user.role)) return <Navigate to="/" replace />;
  // Not just hidden from the nav — direct navigation to a disabled module's
  // route (typed URL, bookmark, stale link) is blocked too.
  if (module && !hasModule(user, module)) return <Navigate to="/" replace />;

  return <Outlet />;
}
