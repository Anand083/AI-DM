-- CreateTable
CREATE TABLE "LocalBusiness" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedOn" DATE,

    CONSTRAINT "LocalBusiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewSnapshot" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "ratingTenths" INTEGER NOT NULL,
    "reviewCount" INTEGER NOT NULL,
    "newReviews" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "publishedAt" DATE NOT NULL,
    "firstSeenOn" DATE NOT NULL,
    "suggestedReply" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocalBusiness_agencyId_idx" ON "LocalBusiness"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalBusiness_projectId_key" ON "LocalBusiness"("projectId");

-- CreateIndex
CREATE INDEX "ReviewSnapshot_agencyId_projectId_takenOn_idx" ON "ReviewSnapshot"("agencyId", "projectId", "takenOn");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewSnapshot_projectId_takenOn_key" ON "ReviewSnapshot"("projectId", "takenOn");

-- CreateIndex
CREATE INDEX "Review_agencyId_projectId_publishedAt_idx" ON "Review"("agencyId", "projectId", "publishedAt");

-- CreateIndex
CREATE INDEX "Review_agencyId_projectId_rating_publishedAt_idx" ON "Review"("agencyId", "projectId", "rating", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Review_projectId_key_key" ON "Review"("projectId", "key");

-- AddForeignKey
ALTER TABLE "LocalBusiness" ADD CONSTRAINT "LocalBusiness_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalBusiness" ADD CONSTRAINT "LocalBusiness_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSnapshot" ADD CONSTRAINT "ReviewSnapshot_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewSnapshot" ADD CONSTRAINT "ReviewSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

