-- CreateTable
CREATE TABLE "AiPrompt" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiSetting" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "brandName" TEXT NOT NULL,
    "engines" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiVisibilityCheck" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "checkedOn" DATE NOT NULL,
    "brandMentioned" BOOLEAN NOT NULL,
    "domainCited" BOOLEAN NOT NULL,
    "mentionPosition" INTEGER,
    "sentiment" TEXT,
    "snippet" TEXT NOT NULL,
    "citedUrls" TEXT[],
    "competitorsMentioned" TEXT[],
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiVisibilityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiPrompt_agencyId_projectId_idx" ON "AiPrompt"("agencyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "AiPrompt_projectId_text_key" ON "AiPrompt"("projectId", "text");

-- CreateIndex
CREATE INDEX "AiSetting_agencyId_idx" ON "AiSetting"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AiSetting_projectId_key" ON "AiSetting"("projectId");

-- CreateIndex
CREATE INDEX "AiVisibilityCheck_agencyId_projectId_checkedOn_idx" ON "AiVisibilityCheck"("agencyId", "projectId", "checkedOn");

-- CreateIndex
CREATE UNIQUE INDEX "AiVisibilityCheck_promptId_engine_checkedOn_key" ON "AiVisibilityCheck"("promptId", "engine", "checkedOn");

-- AddForeignKey
ALTER TABLE "AiPrompt" ADD CONSTRAINT "AiPrompt_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiPrompt" ADD CONSTRAINT "AiPrompt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSetting" ADD CONSTRAINT "AiSetting_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSetting" ADD CONSTRAINT "AiSetting_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiVisibilityCheck" ADD CONSTRAINT "AiVisibilityCheck_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiVisibilityCheck" ADD CONSTRAINT "AiVisibilityCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiVisibilityCheck" ADD CONSTRAINT "AiVisibilityCheck_promptId_fkey" FOREIGN KEY ("promptId") REFERENCES "AiPrompt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

