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
});

export const updateCardBody = z.object({
  label: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  status: z.nativeEnum(CardStatus).optional(),
  templateId: z.string().uuid().nullable().optional(),
  expiresAt: z.coerce.date().optional(),
  keys: z.record(z.string()).optional(),
  lastReadData: z.any().optional(),
});

export const assignCardBody = z.object({
  holderId: z.string().uuid(),
});

export const cardListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  companyId: z.string().uuid().optional(),
  status: z.nativeEnum(CardStatus).optional(),
  cardType: z.nativeEnum(CardType).optional(),
  holderId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
});
