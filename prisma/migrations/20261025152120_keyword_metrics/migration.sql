-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "bingCheckedOn" DATE,
ADD COLUMN     "bingPosition" INTEGER,
ADD COLUMN     "cpcMicros" INTEGER,
ADD COLUMN     "difficulty" INTEGER,
ADD COLUMN     "metricsOn" DATE,
ADD COLUMN     "trend" INTEGER[],
ADD COLUMN     "volume" INTEGER;

