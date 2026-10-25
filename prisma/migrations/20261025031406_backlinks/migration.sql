-- CreateTable
CREATE TABLE "Backlink" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceDomain" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "dofollow" BOOLEAN NOT NULL,
    "sourceRating" INTEGER NOT NULL,
    "firstSeen" DATE NOT NULL,
    "lastSeen" DATE NOT NULL,
    "lostAt" DATE,
    "suspicious" BOOLEAN NOT NULL DEFAULT false,
    "suspiciousReasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Backlink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BacklinkSnapshot" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "totalBacklinks" INTEGER NOT NULL,
    "referringDomains" INTEGER NOT NULL,
    "dofollowPercent" INTEGER NOT NULL,
    "domainRating" INTEGER NOT NULL,
    "newLinks" INTEGER NOT NULL,
    "lostLinks" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BacklinkSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Backlink_agencyId_projectId_lostAt_firstSeen_idx" ON "Backlink"("agencyId", "projectId", "lostAt", "firstSeen");

-- CreateIndex
CREATE INDEX "Backlink_agencyId_projectId_suspicious_idx" ON "Backlink"("agencyId", "projectId", "suspicious");

-- CreateIndex
CREATE UNIQUE INDEX "Backlink_projectId_sourceUrl_targetUrl_key" ON "Backlink"("projectId", "sourceUrl", "targetUrl");

-- CreateIndex
CREATE INDEX "BacklinkSnapshot_agencyId_projectId_takenOn_idx" ON "BacklinkSnapshot"("agencyId", "projectId", "takenOn");

-- CreateIndex
CREATE UNIQUE INDEX "BacklinkSnapshot_projectId_takenOn_key" ON "BacklinkSnapshot"("projectId", "takenOn");

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklinkSnapshot" ADD CONSTRAINT "BacklinkSnapshot_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BacklinkSnapshot" ADD CONSTRAINT "BacklinkSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

