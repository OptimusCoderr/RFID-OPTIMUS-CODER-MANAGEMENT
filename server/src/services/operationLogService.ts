import { OperationStatus, OperationType, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

interface LogInput {
  companyId: string;
  cardId?: string | null;
  encoderId?: string | null;
  userId?: string | null;
  operationType: OperationType;
  status: OperationStatus;
  details?: Prisma.InputJsonValue;
  errorMessage?: string | null;
}

export async function logOperation(input: LogInput) {
  return prisma.operationLog.create({
    data: {
      companyId: input.companyId,
      cardId: input.cardId ?? undefined,
      encoderId: input.encoderId ?? undefined,
      userId: input.userId ?? undefined,
      operationType: input.operationType,
      status: input.status,
      details: input.details,
      errorMessage: input.errorMessage ?? undefined,
    },
  });
}
