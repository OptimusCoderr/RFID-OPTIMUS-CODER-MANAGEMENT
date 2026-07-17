-- CreateEnum
CREATE TYPE "CompanyIndustry" AS ENUM ('UNIVERSITY', 'HOTEL', 'BUSINESS', 'GOVERNMENT_ID');

-- CreateEnum
CREATE TYPE "CompanyModule" AS ENUM ('CARDS', 'ENCODERS', 'TEMPLATES', 'HOLDERS', 'ZONES', 'ATTENDANCE', 'LOGS', 'CITIZEN_DATA');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "enabledModules" "CompanyModule"[] DEFAULT ARRAY[]::"CompanyModule"[],
ADD COLUMN     "industry" "CompanyIndustry";
