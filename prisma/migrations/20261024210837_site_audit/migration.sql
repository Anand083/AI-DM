-- CreateEnum
CREATE TYPE "AuditStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "IssueSeverity" AS ENUM ('CRITICAL', 'WARNING', 'NOTICE');

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "autoAudit" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Audit" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "AuditStatus" NOT NULL DEFAULT 'QUEUED',
    "providerTaskId" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "maxPages" INTEGER NOT NULL,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "healthScore" INTEGER,
    "counts" JSONB,
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Audit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditPage" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "title" TEXT,
    "loadTimeMs" INTEGER NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "issueCount" INTEGER NOT NULL,

    CONSTRAINT "AuditPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditIssue" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "severity" "IssueSeverity" NOT NULL,
    "url" TEXT NOT NULL,
    "details" JSONB,

    CONSTRAINT "AuditIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Audit_agencyId_projectId_createdAt_idx" ON "Audit"("agencyId", "projectId", "createdAt");

-- CreateIndex
CREATE INDEX "Audit_status_createdAt_idx" ON "Audit"("status", "createdAt");

-- CreateIndex
CREATE INDEX "AuditPage_agencyId_auditId_issueCount_idx" ON "AuditPage"("agencyId", "auditId", "issueCount");

-- CreateIndex
CREATE INDEX "AuditIssue_agencyId_auditId_code_idx" ON "AuditIssue"("agencyId", "auditId", "code");

-- CreateIndex
CREATE INDEX "AuditIssue_agencyId_auditId_severity_idx" ON "AuditIssue"("agencyId", "auditId", "severity");

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Audit" ADD CONSTRAINT "Audit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPage" ADD CONSTRAINT "AuditPage_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditPage" ADD CONSTRAINT "AuditPage_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditIssue" ADD CONSTRAINT "AuditIssue_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "Audit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
