-- CreateTable
CREATE TABLE "GoogleConnection" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "accountEmail" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT[],
    "availableSites" JSONB NOT NULL,
    "availableProperties" JSONB NOT NULL,
    "gscSite" TEXT,
    "ga4PropertyId" TEXT,
    "ga4PropertyName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "lastSyncedOn" DATE,
    "connectedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchConsoleDay" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL,
    "impressions" INTEGER NOT NULL,
    "positionTenths" INTEGER NOT NULL,

    CONSTRAINT "SearchConsoleDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ga4Day" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "sessions" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,

    CONSTRAINT "Ga4Day_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GoogleConnection_agencyId_idx" ON "GoogleConnection"("agencyId");

-- CreateIndex
CREATE UNIQUE INDEX "GoogleConnection_projectId_key" ON "GoogleConnection"("projectId");

-- CreateIndex
CREATE INDEX "SearchConsoleDay_agencyId_projectId_date_idx" ON "SearchConsoleDay"("agencyId", "projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SearchConsoleDay_projectId_date_key" ON "SearchConsoleDay"("projectId", "date");

-- CreateIndex
CREATE INDEX "Ga4Day_agencyId_projectId_date_idx" ON "Ga4Day"("agencyId", "projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Ga4Day_projectId_date_key" ON "Ga4Day"("projectId", "date");

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoogleConnection" ADD CONSTRAINT "GoogleConnection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchConsoleDay" ADD CONSTRAINT "SearchConsoleDay_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchConsoleDay" ADD CONSTRAINT "SearchConsoleDay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ga4Day" ADD CONSTRAINT "Ga4Day_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ga4Day" ADD CONSTRAINT "Ga4Day_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

