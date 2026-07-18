-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('FREE', 'CHECK_IN_ONLY', 'CHECK_OUT_ONLY', 'ONCE');

-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN     "mode" "AttendanceMode" NOT NULL DEFAULT 'FREE';
