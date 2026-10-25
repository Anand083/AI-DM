-- CreateTable
CREATE TABLE "AiMarketSnapshot" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "topics" JSONB NOT NULL,
    "mentions" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiMarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiMarketSnapshot_agencyId_projectId_takenOn_idx" ON "AiMarketSnapshot"("agencyId", "projectId", "takenOn");

-- CreateIndex
CREATE UNIQUE INDEX "AiMarketSnapshot_projectId_takenOn_key" ON "AiMarketSnapshot"("projectId", "takenOn");

-- AddForeignKey
ALTER TABLE "AiMarketSnapshot" ADD CONSTRAINT "AiMarketSnapshot_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiMarketSnapshot" ADD CONSTRAINT "AiMarketSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

