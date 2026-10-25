-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gapFetchedAt" TIMESTAMP(3),

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorKeyword" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "volume" INTEGER NOT NULL,
    "url" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Competitor_agencyId_projectId_idx" ON "Competitor"("agencyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_projectId_domain_key" ON "Competitor"("projectId", "domain");

-- CreateIndex
CREATE INDEX "CompetitorKeyword_agencyId_projectId_volume_idx" ON "CompetitorKeyword"("agencyId", "projectId", "volume");

-- CreateIndex
CREATE INDEX "CompetitorKeyword_agencyId_competitorId_volume_idx" ON "CompetitorKeyword"("agencyId", "competitorId", "volume");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorKeyword_competitorId_keyword_key" ON "CompetitorKeyword"("competitorId", "keyword");

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorKeyword" ADD CONSTRAINT "CompetitorKeyword_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorKeyword" ADD CONSTRAINT "CompetitorKeyword_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorKeyword" ADD CONSTRAINT "CompetitorKeyword_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

