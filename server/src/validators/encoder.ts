import { z } from "zod";
import { EncoderType, EncoderConnectionType } from "@prisma/client";

export const createEncoderBody = z.object({
  companyId: z.string().uuid().optional(),
  name: z.string().min(2).max(200),
  type: z.nativeEnum(EncoderType),
  connectionType: z.nativeEnum(EncoderConnectionType).default("USB"),
  serialNumber: z.string().max(100).optional(),
  location: z.string().max(200).optional(),
  firmwareVersion: z.string().max(50).optional(),
});

export const updateEncoderBody = createEncoderBody.partial().extend({
  isActive: z.boolean().optional(),
});
