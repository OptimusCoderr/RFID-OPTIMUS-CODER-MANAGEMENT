import { NavLink, Outlet } from "react-router-dom";
import { clsx } from "clsx";
import {
  LayoutDashboard,
  Building2,
  Users,
  UserRound,
  CreditCard,
  FileJson,
  Wifi,
  Radio,
  ShieldCheck,
  ScrollText,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import type { Role } from "@/types";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/companies", label: "Companies", icon: Building2, roles: ["SUPER_ADMIN"] },
  { to: "/users", label: "Users", icon: Users, roles: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
  { to: "/holders", label: "Card Holders", icon: UserRound },
  { to: "/cards", label: "Cards", icon: CreditCard },
  { to: "/templates", label: "Templates", icon: FileJson },
  { to: "/encoders", label: "Encoders", icon: Wifi },
  { to: "/live-encode", label: "Live Encode", icon: Radio },
  { to: "/zones", label: "Access Zones", icon: ShieldCheck },
  { to: "/logs", label: "Audit Logs", icon: ScrollText },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();

  const items = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white">
            <CreditCard size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">RFID Manager</div>
            <div className="text-xs text-slate-400">Multi-tenant encoding</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                )
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4 dark:border-slate-800">
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
            <span className={clsx("h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-slate-300")} />
            {connected ? "Live updates connected" : "Live updates offline"}
          </div>
          <div className="mb-3">
            <div className="truncate text-sm font-medium">{user?.fullName}</div>
            <div className="truncate text-xs text-slate-400">
              {user?.role.replace("_", " ")}
              {user?.company ? ` · ${user.company.name}` : ""}
            </div>
          </div>
          <button onClick={() => logout()} className="btn-secondary w-full">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
