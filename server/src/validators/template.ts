import { z } from "zod";
import { CardType } from "@prisma/client";

// MIFARE Classic sector key layout
const mifareSectorSchema = z.object({
  sector: z.number().int().min(0),
  keyA: z.string().regex(/^[0-9a-fA-F]{12}$/, "keyA must be 6 bytes of hex").optional(),
  keyB: z.string().regex(/^[0-9a-fA-F]{12}$/, "keyB must be 6 bytes of hex").optional(),
  accessBits: z.string().regex(/^[0-9a-fA-F]{6,8}$/).optional(),
  blocks: z
    .array(z.object({ block: z.number().int().min(0), purpose: z.string().max(100) }))
    .optional(),
});

// NTAG / Ultralight page layout
const ntagPageSchema = z.object({
  startPage: z.number().int().min(0),
  endPage: z.number().int().min(0),
  purpose: z.string().max(100),
});

// MIFARE DESFire application/file (partitioning) layout. Access rights are
// DESFire key indices (0-13), 0xE = free access, 0xF = never.
const desfireAccessRightsSchema = z.object({
  read: z.number().int().min(0).max(15).optional(),
  write: z.number().int().min(0).max(15).optional(),
  readWrite: z.number().int().min(0).max(15).optional(),
  change: z.number().int().min(0).max(15).optional(),
});

const desfireFileSchema = z.object({
  fileId: z.number().int().min(0).max(31),
  type: z.enum(["STANDARD_DATA", "BACKUP_DATA", "VALUE", "LINEAR_RECORD", "CYCLIC_RECORD"]),
  purpose: z.string().max(100),
  size: z.number().int().min(1).max(8192).optional(),
  minValue: z.number().int().optional(),
  maxValue: z.number().int().optional(),
  initialValue: z.number().int().optional(),
  recordSize: z.number().int().min(1).max(8192).optional(),
  maxRecords: z.number().int().min(1).max(65535).optional(),
  accessRights: desfireAccessRightsSchema.optional(),
});

const desfireApplicationSchema = z.object({
  aid: z.string().regex(/^[0-9a-fA-F]{6}$/, "aid must be 3 bytes of hex"),
  name: z.string().max(100).optional(),
  keyCount: z.number().int().min(1).max(14).default(1),
  // Only AES authentication is implemented by this platform's encode flow.
  keyType: z.literal("AES").default("AES"),
  files: z.array(desfireFileSchema).max(32).default([]),
});

// A named set of MIFARE Classic blocks (any sectors, in write order) that
// together hold one AES-256-GCM encrypted record — e.g. a national ID
// card's name/ID number/date of birth. Unlike `sectors[].blocks[].purpose`
// (plain, independently readable per block), these bytes are opaque
// ciphertext on the card; only this app can decrypt them (see
// cardController.ts's prepareCitizenWrite/decodeCitizenRead), using a
// per-card key that never leaves the server.
const citizenRecordSchema = z.object({
  fields: z.array(z.string().min(1).max(60)).min(1).max(12),
  blocks: z.array(z.object({ sector: z.number().int().min(0), block: z.number().int().min(0) })).min(1).max(16),
});

export const templateLayoutSchema = z.object({
  sectors: z.array(mifareSectorSchema).optional(),
  pages: z.array(ntagPageSchema).optional(),
  applications: z.array(desfireApplicationSchema).optional(),
  citizenRecord: citizenRecordSchema.optional(),
  ndef: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

export const createTemplateBody = z.object({
  companyId: z.string().uuid().optional(),
  name: z.string().min(2).max(200),
  cardType: z.nativeEnum(CardType),
  description: z.string().max(500).optional(),
  layout: templateLayoutSchema,
  isDefault: z.boolean().optional(),
});

export const updateTemplateBody = createTemplateBody.partial();
