-- DropForeignKey
ALTER TABLE "attendance_records" DROP CONSTRAINT "attendance_records_cardId_fkey";

-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "manualEntry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "recordedByUserId" TEXT,
ALTER COLUMN "cardId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "attendance_records_recordedByUserId_idx" ON "attendance_records"("recordedByUserId");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
