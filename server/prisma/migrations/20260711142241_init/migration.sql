-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'MANAGER', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('MIFARE_CLASSIC_1K', 'MIFARE_CLASSIC_4K', 'MIFARE_CLASSIC_MINI', 'MIFARE_ULTRALIGHT', 'MIFARE_ULTRALIGHT_C', 'MIFARE_DESFIRE_EV1', 'MIFARE_DESFIRE_EV2', 'MIFARE_DESFIRE_EV3', 'MIFARE_PLUS', 'NTAG213', 'NTAG215', 'NTAG216', 'EM4100_125KHZ', 'HID_PROX_125KHZ', 'T5577_125KHZ', 'GENERIC_ISO14443A', 'GENERIC_ISO15693', 'OTHER');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('UNASSIGNED', 'ACTIVE', 'ASSIGNED', 'BLOCKED', 'LOST', 'EXPIRED', 'RETIRED');

-- CreateEnum
CREATE TYPE "EncoderType" AS ENUM ('ACR122U', 'ACR1252U', 'ACR1281U', 'PN532', 'OMNIKEY_5022', 'OMNIKEY_5427', 'GENERIC_PCSC', 'SERIAL_125KHZ', 'OTHER');

-- CreateEnum
CREATE TYPE "EncoderConnectionType" AS ENUM ('USB', 'SERIAL', 'NETWORK', 'BLUETOOTH');

-- CreateEnum
CREATE TYPE "EncoderStatus" AS ENUM ('ONLINE', 'OFFLINE', 'BUSY', 'ERROR');

-- CreateEnum
CREATE TYPE "OperationType" AS ENUM ('READ', 'WRITE', 'FORMAT', 'LOCK', 'KEY_CHANGE', 'ASSIGN', 'UNASSIGN', 'BLOCK', 'UNBLOCK', 'CLONE', 'REGISTER', 'CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('SUCCESS', 'FAILED', 'PENDING');

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "address" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "companyId" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_holders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "employeeId" TEXT,
    "department" TEXT,
    "photoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_holders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encoders" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "EncoderType" NOT NULL,
    "connectionType" "EncoderConnectionType" NOT NULL DEFAULT 'USB',
    "serialNumber" TEXT,
    "location" TEXT,
    "firmwareVersion" TEXT,
    "agentKey" TEXT NOT NULL,
    "status" "EncoderStatus" NOT NULL DEFAULT 'OFFLINE',
    "lastSeenAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encoders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cardType" "CardType" NOT NULL,
    "description" TEXT,
    "layout" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cards" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "cardType" "CardType" NOT NULL,
    "status" "CardStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "label" TEXT,
    "notes" TEXT,
    "templateId" TEXT,
    "holderId" TEXT,
    "registeredByEncoderId" TEXT,
    "keysEncrypted" TEXT,
    "lastReadData" JSONB,
    "issuedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_zones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "access_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_access_zones" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_access_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operation_logs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cardId" TEXT,
    "encoderId" TEXT,
    "userId" TEXT,
    "operationType" "OperationType" NOT NULL,
    "status" "OperationStatus" NOT NULL,
    "details" JSONB,
    "errorMessage" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "operation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_companyId_idx" ON "users"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "card_holders_companyId_idx" ON "card_holders"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "encoders_agentKey_key" ON "encoders"("agentKey");

-- CreateIndex
CREATE INDEX "encoders_companyId_idx" ON "encoders"("companyId");

-- CreateIndex
CREATE INDEX "card_templates_companyId_idx" ON "card_templates"("companyId");

-- CreateIndex
CREATE INDEX "cards_companyId_idx" ON "cards"("companyId");

-- CreateIndex
CREATE INDEX "cards_holderId_idx" ON "cards"("holderId");

-- CreateIndex
CREATE UNIQUE INDEX "cards_companyId_uid_key" ON "cards"("companyId", "uid");

-- CreateIndex
CREATE INDEX "access_zones_companyId_idx" ON "access_zones"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "card_access_zones_cardId_zoneId_key" ON "card_access_zones"("cardId", "zoneId");

-- CreateIndex
CREATE INDEX "operation_logs_companyId_idx" ON "operation_logs"("companyId");

-- CreateIndex
CREATE INDEX "operation_logs_cardId_idx" ON "operation_logs"("cardId");

-- CreateIndex
CREATE INDEX "operation_logs_performedAt_idx" ON "operation_logs"("performedAt");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_holders" ADD CONSTRAINT "card_holders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encoders" ADD CONSTRAINT "encoders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_templates" ADD CONSTRAINT "card_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "card_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "card_holders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_registeredByEncoderId_fkey" FOREIGN KEY ("registeredByEncoderId") REFERENCES "encoders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_zones" ADD CONSTRAINT "access_zones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_access_zones" ADD CONSTRAINT "card_access_zones_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_access_zones" ADD CONSTRAINT "card_access_zones_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "access_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_encoderId_fkey" FOREIGN KEY ("encoderId") REFERENCES "encoders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operation_logs" ADD CONSTRAINT "operation_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
