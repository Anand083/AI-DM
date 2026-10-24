-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "tags" TEXT[],
    "targetUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedOn" DATE,
    "currentPosition" INTEGER,
    "currentUrl" TEXT,
    "currentFeatures" TEXT[],
    "bestPosition" INTEGER,
    "changeDay" INTEGER,
    "changeWeek" INTEGER,
    "changeMonth" INTEGER,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankCheck" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "position" INTEGER,
    "rankingUrl" TEXT,
    "serpFeatures" JSONB,
    "topResults" JSONB,
    "provider" TEXT NOT NULL,

    CONSTRAINT "RankCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Keyword_agencyId_projectId_phrase_idx" ON "Keyword"("agencyId", "projectId", "phrase");

-- CreateIndex
CREATE INDEX "Keyword_agencyId_projectId_currentPosition_idx" ON "Keyword"("agencyId", "projectId", "currentPosition");

-- CreateIndex
CREATE INDEX "Keyword_agencyId_projectId_changeWeek_idx" ON "Keyword"("agencyId", "projectId", "changeWeek");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_projectId_phrase_key" ON "Keyword"("projectId", "phrase");

-- CreateIndex
CREATE INDEX "RankCheck_agencyId_date_idx" ON "RankCheck"("agencyId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "RankCheck_keywordId_date_key" ON "RankCheck"("keywordId", "date");

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankCheck" ADD CONSTRAINT "RankCheck_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankCheck" ADD CONSTRAINT "RankCheck_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;
