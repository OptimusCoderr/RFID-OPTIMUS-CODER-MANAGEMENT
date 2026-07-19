import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { CreditCard, Wifi, UserRound, Building2, UserPlus, Wrench, DoorOpen, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { hasModule } from "@/lib/modules";
import type { DashboardStats } from "@/types";
import { useAuth } from "@/context/AuthContext";

function StatTile({ label, value, icon: Icon }: { label: string; value: number; icon: LucideIcon }) {
  return (
    <div className="card flex items-center gap-4 p-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300">
        <Icon size={20} />
      </div>
      <div>
        <div className="text-2xl font-semibold leading-tight">{value.toLocaleString()}</div>
        <div className="text-sm text-slate-500 dark:text-slate-400">{label}</div>
      </div>
    </div>
  );
}

function BreakdownBar({ title, counts }: { title: string; counts: Record<string, number> }) {
  const entries = Object.entries(counts).filter(([, v]) => v > 0);
  const total = entries.reduce((sum, [, v]) => sum + v, 0) || 1;
  return (
    <div className="card p-5">
      <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">{title}</h3>
      {entries.length === 0 && <p className="text-sm text-slate-400">No data yet</p>}
      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <div key={key}>
            <div className="mb-1 flex justify-between text-xs text-slate-500">
              <span>{key.replace(/_/g, " ")}</span>
              <span>{value}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div className="h-full rounded-full bg-brand-500" style={{ width: `${(value / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => (await api.get<DashboardStats>("/dashboard/stats")).data,
  });

  if (isLoading || !data) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader title={`Welcome back, ${user?.fullName?.split(" ")[0] ?? ""}`} description="Live overview of your RFID/NFC estate" />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total cards" value={data.totalCards} icon={CreditCard} />
        <StatTile label="Encoders" value={data.totalEncoders} icon={Wifi} />
        <StatTile label="Card holders" value={data.totalHolders} icon={UserRound} />
        <StatTile label="Currently present" value={data.currentlyPresent} icon={DoorOpen} />
        {user?.role === "SUPER_ADMIN" && <StatTile label="Companies" value={data.totalCompanies} icon={Building2} />}
        {hasModule(user, "VISITORS") && (
          <StatTile label="Active visitor passes" value={data.activeVisitorPasses} icon={UserPlus} />
        )}
        {hasModule(user, "MAINTENANCE") && (
          <StatTile label="Open maintenance tickets" value={data.openMaintenanceTickets} icon={Wrench} />
        )}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BreakdownBar title="Cards by status" counts={data.cardsByStatus} />
        <BreakdownBar title="Cards by type" counts={data.cardsByType} />
        <BreakdownBar title="Encoders by status" counts={data.encodersByStatus} />
      </div>

      <div className="card p-5">
        <h3 className="mb-3 text-sm font-semibold text-slate-600 dark:text-slate-300">Recent activity</h3>
        {data.recentActivity.length === 0 && <p className="text-sm text-slate-400">No activity recorded yet</p>}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.recentActivity.map((log) => (
            <div key={log.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div>
                <span className="font-medium">{log.operationType.replace(/_/g, " ")}</span>
                {log.card && <span className="text-slate-500"> · card {log.card.label ?? log.card.uid}</span>}
                {log.encoder && <span className="text-slate-500"> · {log.encoder.name}</span>}
                {log.user && <span className="text-slate-500"> · by {log.user.fullName}</span>}
              </div>
              <div className="flex items-center gap-3 whitespace-nowrap">
                <Badge tone={log.status}>{log.status}</Badge>
                <span className="text-xs text-slate-400">{formatDistanceToNow(new Date(log.performedAt), { addSuffix: true })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
