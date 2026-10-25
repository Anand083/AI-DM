-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('QUEUED', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "DataExport" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "storageKey" TEXT,
    "bytes" INTEGER,
    "error" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DataExport_agencyId_createdAt_idx" ON "DataExport"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "DataExport_expiresAt_idx" ON "DataExport"("expiresAt");

-- AddForeignKey
ALTER TABLE "DataExport" ADD CONSTRAINT "DataExport_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

