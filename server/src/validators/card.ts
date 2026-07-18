import { z } from "zod";
import { CardType, CardStatus } from "@prisma/client";

export const registerCardBody = z.object({
  companyId: z.string().uuid().optional(),
  uid: z.string().regex(/^[0-9a-fA-F]{8,20}$/, "uid must be hex"),
  cardType: z.nativeEnum(CardType),
  label: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  templateId: z.string().uuid().optional(),
  registeredByEncoderId: z.string().uuid().optional(),
  keys: z.record(z.string()).optional(), // raw sector/page keys, encrypted before storage
  // Lets a visitor/guest pass be issued and set to auto-expire in one call
  // instead of a separate PATCH — see VisitorsPage.
  expiresAt: z.coerce.date().optional(),
});

export const updateCardBody = z.object({
  label: z.string().max(200).nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
  status: z.nativeEnum(CardStatus).optional(),
  templateId: z.string().uuid().nullable().optional(),
  expiresAt: z.coerce.date().optional(),
  keys: z.record(z.string()).optional(),
  lastReadData: z.any().optional(),
});

export const assignCardBody = z.object({
  holderId: z.string().uuid(),
});

export const cardEncodersBody = z.object({
  encoderIds: z.array(z.string().uuid()).min(1),
  // e.g. a hotel room key granted only until guest checkout. Applies to
  // every encoder in this same grant call; omit for a grant that never
  // expires.
  expiresAt: z.coerce.date().optional(),
});

export const prepareCitizenWriteBody = z.object({
  fields: z.record(z.string().max(500)),
});

export const decodeCitizenReadBody = z.object({
  blocks: z.array(z.object({ block: z.number().int().min(0), dataHex: z.string().regex(/^[0-9a-fA-F]{32}$/) })).min(1),
});

// Only validates the batch's outer shape (rows is a non-empty array of
// plain row objects, capped at 500) — cardController.bulkImportCards
// deliberately reports bad UIDs, missing cardType, and duplicates as
// per-row errors in its 200 response rather than rejecting the whole
// import, so individual field values are intentionally left loose here
// (a stricter schema would 400 the entire batch instead of surfacing a
// per-row error for the one bad row, which is the whole point of a CSV
// import's error report).
export const bulkImportCardsBody = z.object({
  companyId: z.string().uuid().optional(),
  rows: z
    .array(
      z.object({
        uid: z.string().optional(),
        cardType: z.string().optional(),
        label: z.string().max(200).optional(),
        templateId: z.string().optional(),
      })
    )
    .min(1, "rows must be a non-empty array")
    .max(500, "A single import is limited to 500 rows"),
});

export const cardListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: z.string().uuid().optional(),
  status: z.nativeEnum(CardStatus).optional(),
  cardType: z.nativeEnum(CardType).optional(),
  holderId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  // Not z.coerce.boolean() — that coerces via JS's Boolean(str), so the
  // literal query string "false" (a non-empty string) would coerce to
  // true.
  hasExpiry: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});
