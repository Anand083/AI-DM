-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('RANK_DROP', 'RANK_GAIN', 'AUDIT_CRITICAL', 'BACKLINKS_LOST', 'AI_MENTION_LOST', 'NEW_REVIEW');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "alertDropPositions" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "alertDropWithin" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "alertOnCriticalAudit" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alertTopPosition" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "dailyDigest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastDigestOn" DATE;

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT,
    "type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Alert_agencyId_readAt_createdAt_idx" ON "Alert"("agencyId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Alert_agencyId_projectId_readAt_idx" ON "Alert"("agencyId", "projectId", "readAt");

-- CreateIndex
CREATE INDEX "Alert_agencyId_emailedAt_createdAt_idx" ON "Alert"("agencyId", "emailedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_agencyId_dedupeKey_key" ON "Alert"("agencyId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
