// Subset of client/src/types/index.ts needed by this companion app's
// read-mostly screens. Kept as a hand-copied subset (not a shared package)
// since the mobile app and web client are otherwise fully independent
// builds — see mobile/README.md for why this isn't a shared workspace.

export type Role = "SUPER_ADMIN" | "COMPANY_ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";

export type CardStatus = "UNASSIGNED" | "ACTIVE" | "ASSIGNED" | "BLOCKED" | "LOST" | "EXPIRED" | "RETIRED";

export type EncoderStatus = "ONLINE" | "OFFLINE" | "BUSY" | "ERROR";

export type AttendanceType = "CHECK_IN" | "CHECK_OUT";

export type NotificationType =
  | "CARD_EXPIRING"
  | "CARD_EXPIRED"
  | "CARD_BLOCKED"
  | "CARD_LOST"
  | "ENCODER_OFFLINE"
  | "ENCODER_ONLINE"
  | "SYSTEM";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  companyId: string | null;
  isActive: boolean;
  createdAt: string;
  company?: { id: string; name: string; slug: string } | null;
}

export interface Card {
  id: string;
  companyId: string;
  uid: string;
  cardType: string;
  status: CardStatus;
  writeProtected: boolean;
  label?: string | null;
  notes?: string | null;
  holderId?: string | null;
  holder?: { id: string; fullName: string; department?: string | null; employeeId?: string | null } | null;
  template?: { id: string; name: string } | null;
  hasStoredKeys?: boolean;
  issuedAt?: string | null;
  expiresAt?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
}

export interface CardHolder {
  id: string;
  companyId: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  employeeId?: string | null;
  department?: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { cards: number };
}

export interface OperationLog {
  id: string;
  card?: { id: string; uid: string; label?: string | null } | null;
  encoder?: { id: string; name: string } | null;
  user?: { id: string; fullName: string } | null;
  operationType: string;
  status: "SUCCESS" | "FAILED" | "PENDING";
  errorMessage?: string | null;
  performedAt: string;
}

export interface AttendanceRecord {
  id: string;
  companyId: string;
  card?: { id: string; uid: string; label?: string | null } | null;
  holder?: { id: string; fullName: string; department?: string | null; employeeId?: string | null } | null;
  zone?: { id: string; name: string } | null;
  sessionLabel?: string | null;
  type: AttendanceType;
  manualEntry?: boolean;
  recordedAt: string;
}

export interface DashboardStats {
  totalCards: number;
  cardsByStatus: Record<string, number>;
  totalEncoders: number;
  encodersByStatus: Record<string, number>;
  totalHolders: number;
  totalCompanies: number;
  recentActivity: OperationLog[];
  activeVisitorPasses: number;
  openMaintenanceTickets: number;
  currentlyPresent: number;
}

export interface AppNotification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface AccessZone {
  id: string;
  companyId: string;
  name: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}
