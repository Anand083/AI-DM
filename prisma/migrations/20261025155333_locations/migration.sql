-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "locationCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalRank" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "position" INTEGER,
    "url" TEXT,
    "provider" TEXT NOT NULL,

    CONSTRAINT "LocalRank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingCheck" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "found" BOOLEAN NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "url" TEXT,
    "checkedOn" DATE NOT NULL,
    "provider" TEXT NOT NULL,

    CONSTRAINT "ListingCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_agencyId_projectId_idx" ON "Location"("agencyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_projectId_name_key" ON "Location"("projectId", "name");

-- CreateIndex
CREATE INDEX "LocalRank_agencyId_projectId_locationId_date_idx" ON "LocalRank"("agencyId", "projectId", "locationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "LocalRank_locationId_keywordId_date_key" ON "LocalRank"("locationId", "keywordId", "date");

-- CreateIndex
CREATE INDEX "ListingCheck_agencyId_projectId_locationId_idx" ON "ListingCheck"("agencyId", "projectId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "ListingCheck_locationId_source_key" ON "ListingCheck"("locationId", "source");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalRank" ADD CONSTRAINT "LocalRank_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalRank" ADD CONSTRAINT "LocalRank_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalRank" ADD CONSTRAINT "LocalRank_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalRank" ADD CONSTRAINT "LocalRank_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingCheck" ADD CONSTRAINT "ListingCheck_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingCheck" ADD CONSTRAINT "ListingCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingCheck" ADD CONSTRAINT "ListingCheck_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

