/*
  Warnings:

  - Made the column `label` on table `attendance_sessions` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "attendance_sessions" ADD COLUMN     "description" TEXT,
ALTER COLUMN "label" SET NOT NULL;
