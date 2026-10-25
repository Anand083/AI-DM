-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "scheduleId" TEXT,
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "frequency" "ScheduleFrequency" NOT NULL,
    "dayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "hour" INTEGER NOT NULL DEFAULT 8,
    "recipients" TEXT[],
    "sections" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportSchedule_projectId_key" ON "ReportSchedule"("projectId");

-- CreateIndex
CREATE INDEX "ReportSchedule_enabled_nextRunAt_idx" ON "ReportSchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_agencyId_createdAt_idx" ON "ReportSchedule"("agencyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Report_scheduleId_scheduledFor_key" ON "Report"("scheduleId", "scheduledFor");

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

