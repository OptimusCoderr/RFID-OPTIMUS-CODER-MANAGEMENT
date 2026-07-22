// Dark-slate palette matching the web client's default theme so the two
// apps feel like the same product.
export const colors = {
  bg: "#0f172a",
  card: "#1e293b",
  border: "#334155",
  text: "#f1f5f9",
  textMuted: "#94a3b8",
  textFaint: "#64748b",
  accent: "#38bdf8",
  danger: "#f87171",
  success: "#4ade80",
  warning: "#fbbf24",
};

const STATUS_TONES: Record<string, string> = {
  ACTIVE: colors.success,
  ASSIGNED: colors.success,
  ONLINE: colors.success,
  CHECK_IN: colors.success,
  UNASSIGNED: colors.textFaint,
  OFFLINE: colors.textFaint,
  BLOCKED: colors.danger,
  LOST: colors.danger,
  ERROR: colors.danger,
  CHECK_OUT: colors.warning,
  EXPIRED: colors.warning,
  BUSY: colors.warning,
  RETIRED: colors.textFaint,
};

export function statusColor(status: string): string {
  return STATUS_TONES[status] ?? colors.textMuted;
}
