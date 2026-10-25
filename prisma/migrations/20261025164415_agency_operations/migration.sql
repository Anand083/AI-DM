-- AlterTable
ALTER TABLE "Agency" ADD COLUMN     "baseCurrency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "hourlyCostCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "retainerCents" INTEGER,
ADD COLUMN     "retainerCurrency" TEXT NOT NULL DEFAULT 'USD';

-- CreateTable
CREATE TABLE "CurrencyRate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "ratePerUnitMicros" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyAddOn" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "limitKey" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgencyAddOn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyRate_agencyId_currency_key" ON "CurrencyRate"("agencyId", "currency");

-- CreateIndex
CREATE INDEX "AgencyAddOn_agencyId_limitKey_idx" ON "AgencyAddOn"("agencyId", "limitKey");

-- AddForeignKey
ALTER TABLE "CurrencyRate" ADD CONSTRAINT "CurrencyRate_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyAddOn" ADD CONSTRAINT "AgencyAddOn_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

