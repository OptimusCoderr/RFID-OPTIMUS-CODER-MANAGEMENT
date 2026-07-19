import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Download } from "lucide-react";
import toast from "react-hot-toast";
import { api, downloadCsv } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { FullPageSpinner, Spinner } from "@/components/ui/Spinner";
import { formatEnum } from "@/lib/constants";
import type { OperationLog, PaginatedResponse } from "@/types";

const OPERATION_TYPES = [
  "READ",
  "WRITE",
  "FORMAT",
  "LOCK",
  "KEY_CHANGE",
  "ASSIGN",
  "UNASSIGN",
  "BLOCK",
  "UNBLOCK",
  "CLONE",
  "REGISTER",
  "CREATE",
  "UPDATE",
  "DELETE",
];

export default function LogsPage() {
  const [page, setPage] = useState(1);
  const [operationType, setOperationType] = useState("");
  const [status, setStatus] = useState("");
  const [exporting, setExporting] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["logs", { page, operationType, status }],
    queryFn: async () =>
      (
        await api.get<PaginatedResponse<OperationLog>>("/logs", {
          params: { page, pageSize: 25, operationType: operationType || undefined, status: status || undefined },
        })
      ).data,
    placeholderData: (prev) => prev,
  });

  async function handleExport() {
    setExporting(true);
    try {
      await downloadCsv(
        "/logs/export",
        { operationType: operationType || undefined, status: status || undefined },
        `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
      );
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Audit Logs"
        description="Every register, encode, assignment, and lifecycle change is recorded here."
        actions={
          <button className="btn-secondary" onClick={handleExport} disabled={exporting}>
            {exporting ? <Spinner className="h-4 w-4" /> : <Download size={16} />} Export CSV
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          className="input w-52"
          value={operationType}
          onChange={(e) => {
            setOperationType(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All operations</option>
          {OPERATION_TYPES.map((t) => (
            <option key={t} value={t}>
              {formatEnum(t)}
            </option>
          ))}
        </select>
        <select
          className="input w-40"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          <option value="SUCCESS">Success</option>
          <option value="FAILED">Failed</option>
          <option value="PENDING">Pending</option>
        </select>
      </div>

      {isLoading ? (
        <FullPageSpinner />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-ink-800/60">
              <tr>
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Operation</th>
                <th className="px-4 py-3">Card</th>
                <th className="px-4 py-3">Encoder</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data?.data.map((log) => (
                <tr key={log.id}>
                  <td className="px-4 py-3 text-slate-500">{format(new Date(log.performedAt), "MMM d, HH:mm:ss")}</td>
                  <td className="px-4 py-3 font-medium">{formatEnum(log.operationType)}</td>
                  <td className="px-4 py-3 text-slate-500">{log.card?.label ?? log.card?.uid ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{log.encoder?.name ?? "—"}</td>
                  <td className="px-4 py-3 text-slate-500">{log.user?.fullName ?? "—"}</td>
                  <td className="px-4 py-3">
                    <Badge tone={log.status}>{log.status}</Badge>
                  </td>
                </tr>
              ))}
              {data?.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
                    No log entries match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {data && data.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
              <span className="text-slate-400">
                Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} entries)
              </span>
              <div className="flex gap-2">
                <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <button className="btn-secondary" disabled={page >= data.pagination.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
