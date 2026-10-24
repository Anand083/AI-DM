-- CreateEnum
CREATE TYPE "ProviderTaskStatus" AS ENUM ('PENDING', 'READY', 'PROCESSED', 'FAILED');

-- CreateTable
CREATE TABLE "PendingProviderTask" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "providerTaskId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "requestHash" TEXT,
    "status" "ProviderTaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readyAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PendingProviderTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PendingProviderTask_providerTaskId_key" ON "PendingProviderTask"("providerTaskId");

-- CreateIndex
CREATE INDEX "PendingProviderTask_status_createdAt_idx" ON "PendingProviderTask"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PendingProviderTask_agencyId_idx" ON "PendingProviderTask"("agencyId");

-- AddForeignKey
ALTER TABLE "PendingProviderTask" ADD CONSTRAINT "PendingProviderTask_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
