-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AlertType" ADD VALUE 'GOOGLE_ANOMALY';
ALTER TYPE "AlertType" ADD VALUE 'GOOGLE_RECONNECT';

-- CreateTable
CREATE TABLE "SearchBreakdown" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "positionTenths" INTEGER NOT NULL,

    CONSTRAINT "SearchBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ga4Page" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL,
    "engagedSessions" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,

    CONSTRAINT "Ga4Page_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchBreakdown_agencyId_projectId_dimension_period_clicks_idx" ON "SearchBreakdown"("agencyId", "projectId", "dimension", "period", "clicks");

-- CreateIndex
CREATE UNIQUE INDEX "SearchBreakdown_projectId_dimension_period_key_key" ON "SearchBreakdown"("projectId", "dimension", "period", "key");

-- CreateIndex
CREATE INDEX "Ga4Page_agencyId_projectId_sessions_idx" ON "Ga4Page"("agencyId", "projectId", "sessions");

-- CreateIndex
CREATE UNIQUE INDEX "Ga4Page_projectId_path_key" ON "Ga4Page"("projectId", "path");

-- AddForeignKey
ALTER TABLE "SearchBreakdown" ADD CONSTRAINT "SearchBreakdown_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchBreakdown" ADD CONSTRAINT "SearchBreakdown_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ga4Page" ADD CONSTRAINT "Ga4Page_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ga4Page" ADD CONSTRAINT "Ga4Page_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

