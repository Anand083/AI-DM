-- CreateTable
CREATE TABLE "Impersonation" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Impersonation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageBonus" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageBonus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Impersonation_adminUserId_createdAt_idx" ON "Impersonation"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Impersonation_agencyId_createdAt_idx" ON "Impersonation"("agencyId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageBonus_agencyId_metric_createdAt_idx" ON "UsageBonus"("agencyId", "metric", "createdAt");

-- AddForeignKey
ALTER TABLE "Impersonation" ADD CONSTRAINT "Impersonation_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageBonus" ADD CONSTRAINT "UsageBonus_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

