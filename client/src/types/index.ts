export type Role = "SUPER_ADMIN" | "COMPANY_ADMIN" | "MANAGER" | "OPERATOR" | "VIEWER";

export type CompanyIndustry = "UNIVERSITY" | "HOTEL" | "BUSINESS" | "GOVERNMENT_ID" | "INVENTORY" | "HEALTHCARE";

export type CompanyModule =
  | "CARDS"
  | "ENCODERS"
  | "TEMPLATES"
  | "HOLDERS"
  | "ZONES"
  | "ATTENDANCE"
  | "LOGS"
  | "CITIZEN_DATA"
  | "VISITORS"
  | "MAINTENANCE";

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
  industry?: CompanyIndustry | null;
  // Empty/absent means unrestricted — every module is available. See
  // lib/modules.ts for the shared helper that interprets this.
  enabledModules?: CompanyModule[];
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
  company?: { id: string; name: string; slug: string; industry?: CompanyIndustry | null; enabledModules?: CompanyModule[] } | null;
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

export type DesfireFileType = "STANDARD_DATA" | "BACKUP_DATA" | "VALUE" | "LINEAR_RECORD" | "CYCLIC_RECORD";

export interface DesfireAccessRights {
  // Each is a DESFire key index (0-13), 0xE (14) = free access (no key needed),
  // 0xF (15) = never. Left undefined defaults to "same key that authenticated the app".
  read?: number;
  write?: number;
  readWrite?: number;
  change?: number;
}

export interface DesfireFileLayout {
  fileId: number; // 0-31
  type: DesfireFileType;
  purpose: string;
  // Standard/backup data files: size in bytes.
  size?: number;
  // Value files.
  minValue?: number;
  maxValue?: number;
  initialValue?: number;
  // Linear/cyclic record files.
  recordSize?: number;
  maxRecords?: number;
  accessRights?: DesfireAccessRights;
}

export interface DesfireApplicationLayout {
  aid: string; // 3 bytes of hex, e.g. "F00001"
  name?: string;
  keyCount: number; // 1-14
  // Only AES authentication is implemented by this platform's encode flow.
  keyType: "AES";
  files: DesfireFileLayout[];
}

// A named set of MIFARE Classic blocks (any sectors, in write order) that
// together hold one AES-256-GCM encrypted record — e.g. a national ID
// card's name/ID number/date of birth. Distinct from `sectors[].blocks[]`
// (plain, independently readable text per block): these bytes are opaque
// ciphertext on the card, decrypted only via the server (the encryption
// key never reaches the browser) — see CitizenDataPanel.
export interface CitizenRecordLayout {
  fields: string[];
  blocks: { sector: number; block: number }[];
}

export interface CardTemplateLayout {
  sectors?: MifareSectorLayout[];
  pages?: NtagPageLayout[];
  // MIFARE DESFire application/file partitioning. Reads/writes against these
  // files use DESFire's Plain communication mode after AES authentication —
  // MAC/Encrypted communication modes and legacy DES/3DES keys aren't
  // supported by this platform's live-encode flow.
  applications?: DesfireApplicationLayout[];
  citizenRecord?: CitizenRecordLayout;
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
  encoderAllocations?: { encoder: { id: string; name: string }; expiresAt?: string | null }[];
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

export type AttendanceType = "CHECK_IN" | "CHECK_OUT";

export interface AttendanceRecord {
  id: string;
  companyId: string;
  cardId: string;
  card?: { id: string; uid: string; label?: string | null } | null;
  holderId?: string | null;
  holder?: { id: string; fullName: string; department?: string | null; employeeId?: string | null } | null;
  zoneId?: string | null;
  zone?: { id: string; name: string } | null;
  encoderId?: string | null;
  encoder?: { id: string; name: string } | null;
  type: AttendanceType;
  recordedAt: string;
}

export type MaintenanceStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED";

export interface MaintenanceRecord {
  id: string;
  companyId: string;
  cardId: string;
  card?: { id: string; uid: string; label?: string | null } | null;
  description: string;
  status: MaintenanceStatus;
  notes?: string | null;
  openedAt: string;
  resolvedAt?: string | null;
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
  activeVisitorPasses: number;
  openMaintenanceTickets: number;
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
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  expiresAt: string;
}
