-- CreateEnum
CREATE TYPE "ManualOverride" AS ENUM ('NONE', 'FORCE_OPEN', 'FORCE_CLOSED');

-- CreateTable
CREATE TABLE "attendance_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "encoderId" TEXT NOT NULL,
    "zoneId" TEXT,
    "label" TEXT,
    "daysOfWeek" INTEGER[],
    "startTime" TEXT,
    "endTime" TEXT,
    "manualOverride" "ManualOverride" NOT NULL DEFAULT 'NONE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_sessions_encoderId_key" ON "attendance_sessions"("encoderId");

-- CreateIndex
CREATE INDEX "attendance_sessions_companyId_idx" ON "attendance_sessions"("companyId");

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_encoderId_fkey" FOREIGN KEY ("encoderId") REFERENCES "encoders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "access_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;
