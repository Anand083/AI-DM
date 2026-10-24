-- CreateTable
CREATE TABLE "KeywordList" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordListItem" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "phrase" TEXT NOT NULL,
    "volume" INTEGER NOT NULL,
    "cpcMicros" INTEGER NOT NULL,
    "difficulty" INTEGER NOT NULL,
    "intent" TEXT NOT NULL,
    "locationCode" INTEGER NOT NULL,
    "languageCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordListItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KeywordList_agencyId_name_key" ON "KeywordList"("agencyId", "name");

-- CreateIndex
CREATE INDEX "KeywordListItem_agencyId_listId_createdAt_idx" ON "KeywordListItem"("agencyId", "listId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordListItem_listId_phrase_key" ON "KeywordListItem"("listId", "phrase");

-- AddForeignKey
ALTER TABLE "KeywordList" ADD CONSTRAINT "KeywordList_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordListItem" ADD CONSTRAINT "KeywordListItem_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordListItem" ADD CONSTRAINT "KeywordListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "KeywordList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
