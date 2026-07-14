import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Monitor, LogOut } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import toast from "react-hot-toast";
import { api, apiErrorMessage, getSessionToken } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { formatEnum } from "@/lib/constants";
import { describeUserAgent } from "@/lib/userAgent";
import type { Session } from "@/types";

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // These better-auth endpoints authenticate with the session token, not
  // this app's usual short-lived JWT — the interceptor in lib/api.ts leaves
  // an explicitly-set Authorization header alone for exactly this reason.
  function sessionAuthHeader() {
    return { Authorization: `Bearer ${getSessionToken()}` };
  }

  const { data: sessions, isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => (await api.get<Session[]>("/auth/list-sessions", { headers: sessionAuthHeader() })).data,
  });

  const revokeSession = useMutation({
    mutationFn: async (token: string) => api.post("/auth/revoke-session", { token }, { headers: sessionAuthHeader() }),
    onSuccess: () => {
      toast.success("Session signed out");
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not revoke session")),
  });

  const updateName = useMutation({
    mutationFn: async (name: string) => (await api.post("/auth/update-user", { name }, { headers: sessionAuthHeader() })).data,
    onSuccess: async () => {
      toast.success("Profile updated");
      await refreshUser();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update profile")),
  });

  const changePassword = useMutation({
    mutationFn: async (payload: { currentPassword: string; newPassword: string }) =>
      (await api.post("/auth/change-password", payload, { headers: sessionAuthHeader() })).data,
    onSuccess: () => {
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update password")),
  });

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    updateName.mutate(fullName);
  }

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords don't match");
      return;
    }
    changePassword.mutate({ currentPassword, newPassword });
  }

  if (!user) return null;

  return (
    <div>
      <PageHeader title="Your Profile" description="Manage your account details and password." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-600 dark:text-slate-300">Account</h3>
          <div className="mb-4 space-y-1 text-sm">
            <div className="flex justify-between border-b border-slate-50 py-1.5 dark:border-slate-800/60">
              <span className="text-slate-400">Email</span>
              <span>{user.email}</span>
            </div>
            <div className="flex justify-between border-b border-slate-50 py-1.5 dark:border-slate-800/60">
              <span className="text-slate-400">Role</span>
              <span>{formatEnum(user.role)}</span>
            </div>
            {user.company && (
              <div className="flex justify-between py-1.5">
                <span className="text-slate-400">Company</span>
                <span>{user.company.name}</span>
              </div>
            )}
          </div>

          <form onSubmit={handleNameSubmit} className="space-y-4">
            <div>
              <label className="label">Full name</label>
              <input className="input" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary" disabled={updateName.isPending}>
              Save name
            </button>
          </form>
        </div>

        <div className="card p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-600 dark:text-slate-300">Change password</h3>
          <form onSubmit={handlePasswordSubmit} className="space-y-4">
            <div>
              <label className="label">Current password</label>
              <input
                type="password"
                className="input"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">New password</label>
              <input
                type="password"
                className="input"
                required
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Confirm new password</label>
              <input
                type="password"
                className="input"
                required
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            <button type="submit" className="btn-primary" disabled={changePassword.isPending}>
              Update password
            </button>
          </form>
        </div>
      </div>

      <div className="card mt-6 p-5">
        <h3 className="mb-1 text-sm font-semibold text-slate-600 dark:text-slate-300">Active sessions</h3>
        <p className="mb-4 text-xs text-slate-400">Every device currently signed in to your account.</p>

        {sessionsLoading && <p className="text-sm text-slate-400">Loading...</p>}
        {!sessionsLoading && sessions?.length === 0 && <p className="text-sm text-slate-400">No active sessions.</p>}

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {sessions?.map((session) => (
            <div key={session.id} className="flex items-center justify-between gap-4 py-3 text-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                  <Monitor size={16} />
                </div>
                <div>
                  <div className="font-medium">{describeUserAgent(session.userAgent)}</div>
                  <div className="text-xs text-slate-400">
                    {session.ipAddress ?? "Unknown IP"} · signed in {formatDistanceToNow(new Date(session.createdAt), { addSuffix: true })}
                  </div>
                </div>
              </div>
              <button
                className="btn-secondary"
                onClick={() => revokeSession.mutate(session.token)}
                disabled={revokeSession.isPending}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
