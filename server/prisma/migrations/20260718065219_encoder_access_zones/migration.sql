-- CreateTable
CREATE TABLE "encoder_access_zones" (
    "id" TEXT NOT NULL,
    "encoderId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encoder_access_zones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "encoder_access_zones_encoderId_zoneId_key" ON "encoder_access_zones"("encoderId", "zoneId");

-- AddForeignKey
ALTER TABLE "encoder_access_zones" ADD CONSTRAINT "encoder_access_zones_encoderId_fkey" FOREIGN KEY ("encoderId") REFERENCES "encoders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encoder_access_zones" ADD CONSTRAINT "encoder_access_zones_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "access_zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
