-- DropIndex
DROP INDEX "attendance_sessions_encoderId_key";

-- CreateIndex
CREATE INDEX "attendance_sessions_encoderId_idx" ON "attendance_sessions"("encoderId");
