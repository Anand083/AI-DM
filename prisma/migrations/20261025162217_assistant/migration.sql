-- CreateTable
CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT,
    "replyToId" TEXT,
    "evidence" JSONB,
    "confidence" TEXT,
    "provider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantAction" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "resultNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantMessage_agencyId_projectId_userId_createdAt_idx" ON "AssistantMessage"("agencyId", "projectId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AssistantAction_agencyId_projectId_status_idx" ON "AssistantAction"("agencyId", "projectId", "status");

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAction" ADD CONSTRAINT "AssistantAction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "AssistantMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

