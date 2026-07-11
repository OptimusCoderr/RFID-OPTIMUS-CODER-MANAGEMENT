export type Role = "SUPER_ADMIN" | "COMPANY_ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";

export type CardType =
  | "MIFARE_CLASSIC_1K"
  | "MIFARE_CLASSIC_4K"
  | "MIFARE_CLASSIC_MINI"
  | "MIFARE_ULTRALIGHT"
  | "MIFARE_ULTRALIGHT_C"
  | "MIFARE_DESFIRE_EV1"
  | "MIFARE_DESFIRE_EV2"
  | "MIFARE_DESFIRE_EV3"
  | "MIFARE_PLUS"
  | "NTAG213"
  | "NTAG215"
  | "NTAG216"
  | "EM4100_125KHZ"
  | "HID_PROX_125KHZ"
  | "T5577_125KHZ"
  | "GENERIC_ISO14443A"
  | "GENERIC_ISO15693"
  | "OTHER";

export type CardStatus = "UNASSIGNED" | "ACTIVE" | "ASSIGNED" | "BLOCKED" | "LOST" | "EXPIRED" | "RETIRED";

export type EncoderType =
  | "ACR122U"
  | "ACR1252U"
  | "ACR1281U"
  | "PN532"
  | "OMNIKEY_5022"
  | "OMNIKEY_5427"
  | "GENERIC_PCSC"
  | "SERIAL_125KHZ"
  | "OTHER";

export type EncoderConnectionType = "USB" | "SERIAL" | "NETWORK" | "BLUETOOTH";
export type EncoderStatus = "ONLINE" | "OFFLINE" | "BUSY" | "ERROR";

export type OperationType =
  | "READ"
  | "WRITE"
  | "FORMAT"
  | "LOCK"
  | "KEY_CHANGE"
  | "ASSIGN"
  | "UNASSIGN"
  | "BLOCK"
  | "UNBLOCK"
  | "CLONE"
  | "REGISTER"
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "LOGIN"
  | "LOGOUT";

export type OperationStatus = "SUCCESS" | "FAILED" | "PENDING";

export interface Company {
  id: string;
  name: string;
  slug: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  logoUrl?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { users: number; cards: number; encoders: number; holders: number };
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  companyId: string | null;
  isActive: boolean;
  lastLoginAt?: string | null;
  createdAt: string;
  company?: { id: string; name: string; slug: string } | null;
}

export interface CardHolder {
  id: string;
  companyId: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  employeeId?: string | null;
  department?: string | null;
  photoUrl?: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { cards: number };
  cards?: Card[];
}

export interface Encoder {
  id: string;
  companyId: string;
  name: string;
  type: EncoderType;
  connectionType: EncoderConnectionType;
  serialNumber?: string | null;
  location?: string | null;
  firmwareVersion?: string | null;
  status: EncoderStatus;
  lastSeenAt?: string | null;
  isActive: boolean;
  createdAt: string;
  agentKey?: string;
}

export interface MifareSectorLayout {
  sector: number;
  keyA?: string;
  keyB?: string;
  accessBits?: string;
  blocks?: { block: number; purpose: string }[];
}

export interface NtagPageLayout {
  startPage: number;
  endPage: number;
  purpose: string;
}

export interface CardTemplateLayout {
  sectors?: MifareSectorLayout[];
  pages?: NtagPageLayout[];
  ndef?: boolean;
  notes?: string;
}

export interface CardTemplate {
  id: string;
  companyId: string;
  name: string;
  cardType: CardType;
  description?: string | null;
  layout: CardTemplateLayout;
  isDefault: boolean;
  createdAt: string;
}

export interface AccessZone {
  id: string;
  companyId: string;
  name: string;
  description?: string | null;
  createdAt: string;
  _count?: { cards: number };
}

export interface Card {
  id: string;
  companyId: string;
  uid: string;
  cardType: CardType;
  status: CardStatus;
  label?: string | null;
  notes?: string | null;
  templateId?: string | null;
  template?: { id: string; name: string } | null;
  holderId?: string | null;
  holder?: { id: string; fullName: string; department?: string | null; employeeId?: string | null } | null;
  registeredByEncoder?: { id: string; name: string } | null;
  hasStoredKeys?: boolean;
  lastReadData?: unknown;
  accessZones?: { zone: { id: string; name: string } }[];
  issuedAt?: string | null;
  expiresAt?: string | null;
  lastSeenAt?: string | null;
  createdAt: string;
}

export interface OperationLog {
  id: string;
  companyId: string;
  cardId?: string | null;
  card?: { id: string; uid: string; label?: string | null } | null;
  encoderId?: string | null;
  encoder?: { id: string; name: string } | null;
  userId?: string | null;
  user?: { id: string; fullName: string } | null;
  company?: { id: string; name: string };
  operationType: OperationType;
  status: OperationStatus;
  details?: unknown;
  errorMessage?: string | null;
  performedAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface DashboardStats {
  totalCards: number;
  cardsByStatus: Record<string, number>;
  cardsByType: Record<string, number>;
  totalEncoders: number;
  encodersByStatus: Record<string, number>;
  totalHolders: number;
  totalCompanies: number;
  recentActivity: OperationLog[];
}

export type NotificationType =
  | "CARD_EXPIRING"
  | "CARD_EXPIRED"
  | "CARD_BLOCKED"
  | "CARD_LOST"
  | "ENCODER_OFFLINE"
  | "ENCODER_ONLINE"
  | "SYSTEM";

export interface AppNotification {
  id: string;
  companyId: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
  readAt?: string | null;
  createdAt: string;
}

export interface Session {
  id: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  expiresAt: string;
}
