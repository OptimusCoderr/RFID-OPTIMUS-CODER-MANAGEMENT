-- CreateTable
CREATE TABLE "card_encoder_allocations" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "encoderId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_encoder_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "card_encoder_allocations_cardId_encoderId_key" ON "card_encoder_allocations"("cardId", "encoderId");

-- AddForeignKey
ALTER TABLE "card_encoder_allocations" ADD CONSTRAINT "card_encoder_allocations_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_encoder_allocations" ADD CONSTRAINT "card_encoder_allocations_encoderId_fkey" FOREIGN KEY ("encoderId") REFERENCES "encoders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
