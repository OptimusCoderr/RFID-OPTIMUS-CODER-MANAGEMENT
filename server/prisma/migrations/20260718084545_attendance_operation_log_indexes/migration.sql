-- CreateIndex
CREATE INDEX "attendance_records_encoderId_idx" ON "attendance_records"("encoderId");

-- CreateIndex
CREATE INDEX "operation_logs_companyId_performedAt_idx" ON "operation_logs"("companyId", "performedAt");

-- CreateIndex
CREATE INDEX "operation_logs_encoderId_idx" ON "operation_logs"("encoderId");

-- CreateIndex
CREATE INDEX "operation_logs_userId_idx" ON "operation_logs"("userId");
