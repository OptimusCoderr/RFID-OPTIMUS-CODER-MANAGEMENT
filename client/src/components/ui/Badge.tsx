import { clsx } from "clsx";

const COLOR_MAP: Record<string, string> = {
  // card status
  ACTIVE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  ASSIGNED: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  UNASSIGNED: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  BLOCKED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  LOST: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
  EXPIRED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  RETIRED: "bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  WRITE_PROTECTED: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  // encoder / general status
  ONLINE: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  OFFLINE: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  BUSY: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  ERROR: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  // operation status
  SUCCESS: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  FAILED: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
};

export function Badge({ children, tone }: { children: React.ReactNode; tone?: string }) {
  const classes = (tone && COLOR_MAP[tone]) ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return <span className={clsx("badge", classes)}>{children}</span>;
}
