-- AlterTable
ALTER TABLE "Audit" ADD COLUMN     "diagnostics" JSONB;

-- AlterTable
ALTER TABLE "AuditPage" ADD COLUMN     "cls" INTEGER,
ADD COLUMN     "inpMs" INTEGER,
ADD COLUMN     "lcpMs" INTEGER;

-- CreateTable
CREATE TABLE "AuditConfig" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "excludePaths" TEXT[],
    "respectRobots" BOOLEAN NOT NULL DEFAULT true,
    "mobile" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditIssueState" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditIssueState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuditConfig_projectId_key" ON "AuditConfig"("projectId");

-- CreateIndex
CREATE INDEX "AuditIssueState_agencyId_projectId_status_idx" ON "AuditIssueState"("agencyId", "projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AuditIssueState_projectId_code_url_key" ON "AuditIssueState"("projectId", "code", "url");

-- AddForeignKey
ALTER TABLE "AuditConfig" ADD CONSTRAINT "AuditConfig_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditConfig" ADD CONSTRAINT "AuditConfig_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditIssueState" ADD CONSTRAINT "AuditIssueState_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditIssueState" ADD CONSTRAINT "AuditIssueState_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

