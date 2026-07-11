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

export const templateLayoutSchema = z.object({
  sectors: z.array(mifareSectorSchema).optional(),
  pages: z.array(ntagPageSchema).optional(),
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
