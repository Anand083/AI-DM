-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('RANK_CHECK', 'LIVE_CHECK', 'AUDIT_PAGE', 'KEYWORD_RESEARCH', 'BACKLINK_QUERY', 'COMPETITOR_QUERY', 'AI_CHECK', 'REVIEW_QUERY', 'LEAD_AUDIT');

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT,
    "metric" "UsageMetric" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "costMicros" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCache" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UsageRecord_agencyId_metric_createdAt_idx" ON "UsageRecord"("agencyId", "metric", "createdAt");

-- CreateIndex
CREATE INDEX "UsageRecord_createdAt_idx" ON "UsageRecord"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCache_requestHash_key" ON "ProviderCache"("requestHash");

-- CreateIndex
CREATE INDEX "ProviderCache_expiresAt_idx" ON "ProviderCache"("expiresAt");

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
