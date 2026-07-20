-- AlterTable
ALTER TABLE "attendance_records" ADD COLUMN     "occurrenceId" TEXT;

-- CreateTable
CREATE TABLE "session_occurrences" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "attendanceSessionId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "session_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "session_occurrences_companyId_idx" ON "session_occurrences"("companyId");

-- CreateIndex
CREATE INDEX "session_occurrences_attendanceSessionId_idx" ON "session_occurrences"("attendanceSessionId");

-- CreateIndex
CREATE INDEX "attendance_records_occurrenceId_idx" ON "attendance_records"("occurrenceId");

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "session_occurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrences" ADD CONSTRAINT "session_occurrences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_occurrences" ADD CONSTRAINT "session_occurrences_attendanceSessionId_fkey" FOREIGN KEY ("attendanceSessionId") REFERENCES "attendance_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
