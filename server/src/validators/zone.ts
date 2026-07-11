import { z } from "zod";

export const createZoneBody = z.object({
  companyId: z.string().uuid().optional(),
  name: z.string().min(2).max(200),
  description: z.string().max(500).optional(),
});

export const updateZoneBody = createZoneBody.partial();

export const zoneCardsBody = z.object({
  cardIds: z.array(z.string().uuid()).min(1),
});
