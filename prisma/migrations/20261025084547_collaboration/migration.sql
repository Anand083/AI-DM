-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'CLIENT_RESPONSE';

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "approvalAt" TIMESTAMP(3),
ADD COLUMN     "approvalById" TEXT,
ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvalStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "milestoneId" TEXT;

-- AlterTable
ALTER TABLE "TaskComment" ADD COLUMN     "clientVisible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fromClient" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Milestone" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueOn" DATE,
    "completedAt" TIMESTAMP(3),
    "clientVisible" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Milestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportComment" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "authorId" TEXT,
    "fromClient" BOOLEAN NOT NULL DEFAULT false,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Milestone_agencyId_projectId_dueOn_idx" ON "Milestone"("agencyId", "projectId", "dueOn");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTemplate_agencyId_name_key" ON "TaskTemplate"("agencyId", "name");

-- CreateIndex
CREATE INDEX "ReportComment_agencyId_reportId_createdAt_idx" ON "ReportComment"("agencyId", "reportId", "createdAt");

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Milestone" ADD CONSTRAINT "Milestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportComment" ADD CONSTRAINT "ReportComment_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportComment" ADD CONSTRAINT "ReportComment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

