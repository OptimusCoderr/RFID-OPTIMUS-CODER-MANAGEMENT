import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { CreditCard, ArrowLeft } from "lucide-react";
import toast from "react-hot-toast";
import { api, apiErrorMessage } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Something went wrong"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="card w-full max-w-sm p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <CreditCard size={22} />
          </div>
          <h1 className="text-xl font-semibold">Reset your password</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {sent ? "Check your email for a reset link." : "Enter your account email and we'll send you a reset link."}
          </p>
        </div>

        {!sent ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input id="email" type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? <Spinner className="h-4 w-4 text-white" /> : "Send reset link"}
            </button>
          </form>
        ) : (
          <p className="rounded-lg bg-emerald-50 p-3 text-center text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
            If an account exists for {email}, a reset link is on its way.
          </p>
        )}

        <Link to="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
          <ArrowLeft size={14} /> Back to sign in
        </Link>
      </div>
    </div>
  );
}
