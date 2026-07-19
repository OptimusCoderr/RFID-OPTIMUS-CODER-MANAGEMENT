import { NavLink, Outlet, Link } from "react-router-dom";
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
  ClipboardCheck,
  LogOut,
  Sun,
  Moon,
  Search,
  UserCircle,
  Settings,
  UserPlus,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocket } from "@/context/SocketContext";
import { useTheme } from "@/context/ThemeContext";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { CommandPalette } from "@/components/CommandPalette";
import { useCommandPalette } from "@/context/CommandPaletteContext";
import { hasModule } from "@/lib/modules";
import type { Role, CompanyModule } from "@/types";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles?: Role[];
  module?: CompanyModule;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/companies", label: "Companies", icon: Building2, roles: ["SUPER_ADMIN"] },
  { to: "/users", label: "Users", icon: Users, roles: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
  { to: "/holders", label: "Card Holders", icon: UserRound, module: "HOLDERS" },
  { to: "/cards", label: "Cards", icon: CreditCard, module: "CARDS" },
  { to: "/templates", label: "Templates", icon: FileJson, module: "TEMPLATES" },
  { to: "/encoders", label: "Encoders", icon: Wifi, module: "ENCODERS" },
  { to: "/live-encode", label: "Live Encode", icon: Radio, module: "ENCODERS" },
  { to: "/zones", label: "Access Zones", icon: ShieldCheck, module: "ZONES" },
  { to: "/attendance", label: "Attendance", icon: ClipboardCheck, module: "ATTENDANCE" },
  { to: "/visitors", label: "Visitors", icon: UserPlus, module: "VISITORS" },
  { to: "/maintenance", label: "Maintenance", icon: Wrench, module: "MAINTENANCE" },
  { to: "/logs", label: "Audit Logs", icon: ScrollText, module: "LOGS" },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { connected } = useSocket();
  const { theme, toggleTheme } = useTheme();
  const { open: openSearch } = useCommandPalette();

  const items = NAV_ITEMS.filter(
    (item) =>
      (!item.roles || (user && item.roles.includes(user.role))) && (!item.module || hasModule(user, item.module))
  );

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-brand-900/40 dark:bg-ink-950">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white shadow-[0_0_16px_-2px_rgba(34,197,94,0.7)]">
            <CreditCard size={18} />
          </div>
          <div>
            <div className="font-mono text-sm font-semibold uppercase leading-tight tracking-wide text-slate-900 dark:text-brand-400">
              RFID Manager
            </div>
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
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800"
                )
              }
            >
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-slate-200 p-4 dark:border-brand-900/40">
          <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
            <span className={clsx("h-2 w-2 rounded-full", connected ? "animate-pulse bg-brand-500" : "bg-slate-300")} />
            {connected ? "Live updates connected" : "Live updates offline"}
          </div>
          <Link to="/profile" className="mb-3 block rounded-lg -mx-1 px-1 py-1 hover:bg-slate-50 dark:hover:bg-ink-800">
            <div className="truncate text-sm font-medium">{user?.fullName}</div>
            <div className="truncate text-xs text-slate-400">
              {user?.role.replace("_", " ")}
              {user?.company ? ` · ${user.company.name}` : ""}
            </div>
          </Link>
          <button onClick={() => logout()} className="btn-secondary w-full">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3 dark:border-brand-900/40 dark:bg-ink-950">
          <button
            onClick={openSearch}
            className="flex w-72 items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-400 hover:border-brand-400 dark:border-slate-700 dark:hover:border-brand-700"
          >
            <Search size={15} />
            Search cards, holders...
            <kbd className="ml-auto rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-400 dark:border-slate-700">
              ⌘K
            </kbd>
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={toggleTheme}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800"
              title="Toggle theme"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <NotificationBell />
            {user?.companyId && (user.role === "SUPER_ADMIN" || user.role === "COMPANY_ADMIN") && (
              <Link
                to="/company-settings"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800"
                title="Company settings"
              >
                <Settings size={18} />
              </Link>
            )}
            <Link
              to="/profile"
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-ink-800"
              title="Your profile"
            >
              <UserCircle size={18} />
            </Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-8">
          <Outlet />
        </main>
      </div>

      <CommandPalette />
    </div>
  );
}
