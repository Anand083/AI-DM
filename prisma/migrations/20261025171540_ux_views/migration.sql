-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardPref" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "hidden" TEXT[],

    CONSTRAINT "DashboardPref_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedView_agencyId_userId_scope_idx" ON "SavedView"("agencyId", "userId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardPref_agencyId_userId_key" ON "DashboardPref"("agencyId", "userId");

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardPref" ADD CONSTRAINT "DashboardPref_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

