import { FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuth } from "@/context/AuthContext";
import { formatEnum } from "@/lib/constants";

export default function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [fullName, setFullName] = useState(user?.fullName ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const updateProfile = useMutation({
    mutationFn: async (payload: { fullName?: string; currentPassword?: string; newPassword?: string }) =>
      (await api.patch("/auth/me", payload)).data,
    onSuccess: async () => {
      toast.success("Profile updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await refreshUser();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update profile")),
  });

  function handleNameSubmit(e: FormEvent) {
    e.preventDefault();
    updateProfile.mutate({ fullName });
  }

  function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords don't match");
      return;
    }
    updateProfile.mutate({ currentPassword, newPassword });
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
            <button type="submit" className="btn-primary" disabled={updateProfile.isPending}>
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
            <button type="submit" className="btn-primary" disabled={updateProfile.isPending}>
              Update password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
