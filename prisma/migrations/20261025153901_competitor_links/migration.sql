-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'COMPETITOR_MOVE';

-- AlterTable
ALTER TABLE "Competitor" ADD COLUMN     "alertCheckedOn" DATE,
ADD COLUMN     "backlinks" INTEGER,
ADD COLUMN     "domainRating" INTEGER,
ADD COLUMN     "linksFetchedAt" TIMESTAMP(3),
ADD COLUMN     "referringDomains" INTEGER;

-- CreateTable
CREATE TABLE "CompetitorLink" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,

    CONSTRAINT "CompetitorLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CompetitorLink_agencyId_projectId_sourceDomain_idx" ON "CompetitorLink"("agencyId", "projectId", "sourceDomain");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorLink_competitorId_sourceDomain_key" ON "CompetitorLink"("competitorId", "sourceDomain");

-- AddForeignKey
ALTER TABLE "CompetitorLink" ADD CONSTRAINT "CompetitorLink_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorLink" ADD CONSTRAINT "CompetitorLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorLink" ADD CONSTRAINT "CompetitorLink_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

