-- CreateEnum
CREATE TYPE "CustomDomainStatus" AS ENUM ('NONE', 'PENDING', 'VERIFIED', 'FAILED');

-- CreateTable
CREATE TABLE "Branding" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoKey" TEXT,
    "logoContentType" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#18181b',
    "accentColor" TEXT NOT NULL DEFAULT '#2563eb',
    "supportEmail" TEXT,
    "website" TEXT,
    "customDomain" TEXT,
    "customDomainStatus" "CustomDomainStatus" NOT NULL DEFAULT 'NONE',
    "domainVerifyToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branding_agencyId_key" ON "Branding"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "Branding_customDomain_key" ON "Branding"("customDomain");

-- AddForeignKey
ALTER TABLE "Branding" ADD CONSTRAINT "Branding_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
