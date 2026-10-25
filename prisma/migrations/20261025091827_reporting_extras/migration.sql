-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sections" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT,
    "on" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "startValue" INTEGER,
    "dueOn" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoalPoint" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "on" DATE NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "GoalPoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportTemplate_agencyId_name_key" ON "ReportTemplate"("agencyId", "name");

-- CreateIndex
CREATE INDEX "Annotation_agencyId_projectId_on_idx" ON "Annotation"("agencyId", "projectId", "on");

-- CreateIndex
CREATE INDEX "Goal_agencyId_projectId_idx" ON "Goal"("agencyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "Goal_projectId_kind_key" ON "Goal"("projectId", "kind");

-- CreateIndex
CREATE INDEX "GoalPoint_agencyId_goalId_on_idx" ON "GoalPoint"("agencyId", "goalId", "on");

-- CreateIndex
CREATE UNIQUE INDEX "GoalPoint_goalId_on_key" ON "GoalPoint"("goalId", "on");

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalPoint" ADD CONSTRAINT "GoalPoint_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GoalPoint" ADD CONSTRAINT "GoalPoint_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

