-- CreateEnum
CREATE TYPE "AttendanceType" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "holderId" TEXT,
    "zoneId" TEXT,
    "encoderId" TEXT,
    "type" "AttendanceType" NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_records_companyId_idx" ON "attendance_records"("companyId");

-- CreateIndex
CREATE INDEX "attendance_records_holderId_idx" ON "attendance_records"("holderId");

-- CreateIndex
CREATE INDEX "attendance_records_cardId_idx" ON "attendance_records"("cardId");

-- CreateIndex
CREATE INDEX "attendance_records_zoneId_idx" ON "attendance_records"("zoneId");

-- CreateIndex
CREATE INDEX "attendance_records_recordedAt_idx" ON "attendance_records"("recordedAt");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "card_holders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "access_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_encoderId_fkey" FOREIGN KEY ("encoderId") REFERENCES "encoders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
