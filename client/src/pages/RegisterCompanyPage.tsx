import { FormEvent, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { CreditCard } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "@/context/AuthContext";
import { apiErrorMessage } from "@/lib/api";
import { Spinner } from "@/components/ui/Spinner";
import { INDUSTRY_OPTIONS } from "@/lib/constants";
import type { CompanyIndustry } from "@/types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export default function RegisterCompanyPage() {
  const { user, loading, registerCompany } = useAuth();
  const [companyName, setCompanyName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [contactEmail, setContactEmail] = useState("");
  const [industry, setIndustry] = useState<CompanyIndustry | "">("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to="/" replace />;

  function handleCompanyNameChange(value: string) {
    setCompanyName(value);
    if (!slugTouched) setSlug(slugify(value));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await registerCompany({
        companyName,
        slug,
        contactEmail: contactEmail || undefined,
        fullName,
        email,
        password,
        industry: industry || undefined,
      });
      toast.success("Company registered — welcome aboard!");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not register your company"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="card w-full max-w-md p-8">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
            <CreditCard size={22} />
          </div>
          <h1 className="text-xl font-semibold">Register your business</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            For hotels, offices, universities, or any business issuing its own RFID/NFC cards.
            You'll get your own login and card inventory, fully separate from every other company.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label" htmlFor="companyName">
              Company / organization name
            </label>
            <input
              id="companyName"
              required
              className="input"
              placeholder="Acme Grand Hotel"
              value={companyName}
              onChange={(e) => handleCompanyNameChange(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="slug">
              URL slug
            </label>
            <input
              id="slug"
              required
              className="input font-mono"
              placeholder="acme-grand-hotel"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
            />
          </div>
          <div>
            <label className="label" htmlFor="contactEmail">
              Company contact email (optional)
            </label>
            <input
              id="contactEmail"
              type="email"
              className="input"
              placeholder="frontdesk@acmehotel.example"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="industry">
              What kind of organization is this?
            </label>
            <select
              id="industry"
              className="input"
              value={industry}
              onChange={(e) => setIndustry(e.target.value as CompanyIndustry | "")}
            >
              {INDUSTRY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-400">
              Sets which features you start with — a SUPER_ADMIN can adjust this for you later.
            </p>
          </div>

          <hr className="border-slate-100 dark:border-slate-800" />

          <div>
            <label className="label" htmlFor="fullName">
              Your full name
            </label>
            <input id="fullName" required className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="email">
              Your email
            </label>
            <input
              id="email"
              type="email"
              required
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting ? <Spinner className="h-4 w-4 text-white" /> : "Create company account"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Already have an account?{" "}
          <Link to="/login" className="text-brand-600 hover:underline dark:text-brand-400">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
