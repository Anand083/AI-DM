-- CreateTable
CREATE TABLE "UrlInspection" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" TEXT NOT NULL,
    "coverageState" TEXT NOT NULL,
    "indexingState" TEXT,
    "robotsTxtState" TEXT,
    "pageFetchState" TEXT,
    "lastCrawlTime" TIMESTAMP(3),
    "googleCanonical" TEXT,
    "userCanonical" TEXT,
    "mobileVerdict" TEXT,
    "richVerdict" TEXT,
    "richTypes" TEXT[],

    CONSTRAINT "UrlInspection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UrlInspection_agencyId_projectId_inspectedAt_idx" ON "UrlInspection"("agencyId", "projectId", "inspectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "UrlInspection_projectId_url_key" ON "UrlInspection"("projectId", "url");

-- AddForeignKey
ALTER TABLE "UrlInspection" ADD CONSTRAINT "UrlInspection_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UrlInspection" ADD CONSTRAINT "UrlInspection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

