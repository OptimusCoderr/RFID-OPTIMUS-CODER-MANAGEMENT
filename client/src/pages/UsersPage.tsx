import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Ban, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { FullPageSpinner } from "@/components/ui/Spinner";
import { Badge } from "@/components/ui/Badge";
import type { Company, Role, User } from "@/types";
import { useAuth } from "@/context/AuthContext";

const ROLE_OPTIONS: Role[] = ["SUPER_ADMIN", "COMPANY_ADMIN", "MANAGER", "OPERATOR", "VIEWER"];

interface UserFormState {
  email: string;
  password: string;
  fullName: string;
  role: Role;
  companyId: string;
}

const EMPTY_FORM: UserFormState = { email: "", password: "", fullName: "", role: "OPERATOR", companyId: "" };

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<UserFormState>(EMPTY_FORM);

  const { data: users, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: async () => (await api.get<User[]>("/users")).data,
  });

  const { data: companies } = useQuery({
    queryKey: ["companies"],
    queryFn: async () => (await api.get<Company[]>("/companies")).data,
    enabled: currentUser?.role === "SUPER_ADMIN",
  });

  const createUser = useMutation({
    mutationFn: async (payload: UserFormState) =>
      (
        await api.post("/users", {
          ...payload,
          companyId: payload.role === "SUPER_ADMIN" ? undefined : payload.companyId || undefined,
        })
      ).data,
    onSuccess: () => {
      toast.success("User created");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setModalOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not create user")),
  });

  const toggleActive = useMutation({
    mutationFn: async (u: User) => (await api.patch(`/users/${u.id}`, { isActive: !u.isActive })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createUser.mutate(form);
  }

  if (isLoading) return <FullPageSpinner />;

  return (
    <div>
      <PageHeader
        title="Users"
        description="People who can sign in and operate the platform."
        actions={
          <button className="btn-primary" onClick={() => setModalOpen(true)}>
            <Plus size={16} /> New user
          </button>
        }
      />

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              {currentUser?.role === "SUPER_ADMIN" && <th className="px-4 py-3">Company</th>}
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {users?.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3">{u.role.replace("_", " ")}</td>
                {currentUser?.role === "SUPER_ADMIN" && <td className="px-4 py-3 text-slate-500">{u.company?.name ?? "—"}</td>}
                <td className="px-4 py-3">
                  <Badge tone={u.isActive ? "ACTIVE" : "BLOCKED"}>{u.isActive ? "Active" : "Disabled"}</Badge>
                </td>
                <td className="px-4 py-3 text-right">
                  {u.id !== currentUser?.id && (
                    <button
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={() => toggleActive.mutate(u)}
                      title={u.isActive ? "Disable user" : "Enable user"}
                    >
                      {u.isActive ? <Ban size={16} /> : <CheckCircle2 size={16} />}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New user">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" required value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} />
          </div>
          <div>
            <label className="label">Email</label>
            <input type="email" className="input" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
              {ROLE_OPTIONS.filter((r) => currentUser?.role === "SUPER_ADMIN" || r !== "SUPER_ADMIN").map((r) => (
                <option key={r} value={r}>
                  {r.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          {currentUser?.role === "SUPER_ADMIN" && form.role !== "SUPER_ADMIN" && (
            <div>
              <label className="label">Company</label>
              <select className="input" required value={form.companyId} onChange={(e) => setForm((f) => ({ ...f, companyId: e.target.value }))}>
                <option value="" disabled>
                  Select a company
                </option>
                {companies?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={createUser.isPending}>
            Create user
          </button>
        </form>
      </Modal>
    </div>
  );
}
