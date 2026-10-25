-- AlterTable
ALTER TABLE "AuditPage" ADD COLUMN     "inlinks" INTEGER,
ADD COLUMN     "lastModified" DATE;

-- CreateTable
CREATE TABLE "ContentUpdate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "updatedOn" DATE NOT NULL,
    "note" TEXT,
    "baselineClicks" INTEGER NOT NULL,
    "baselineImpressions" INTEGER NOT NULL,
    "baselinePositionTenths" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContentUpdate_agencyId_projectId_updatedOn_idx" ON "ContentUpdate"("agencyId", "projectId", "updatedOn");

-- AddForeignKey
ALTER TABLE "ContentUpdate" ADD CONSTRAINT "ContentUpdate_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentUpdate" ADD CONSTRAINT "ContentUpdate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

