-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "additionalInfo" TEXT,
    "refinedBrief" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "filePath" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrdSection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sectionType" TEXT NOT NULL,
    "draft" TEXT NOT NULL,
    "finalText" TEXT NOT NULL,
    "revised" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrdSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" TEXT NOT NULL,
    "prdSectionId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" TEXT NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsistencyCheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "consistent" BOOLEAN NOT NULL,
    "issues" TEXT[],
    "reconciledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsistencyCheck_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "PrdSection" ADD CONSTRAINT "PrdSection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_prdSectionId_fkey" FOREIGN KEY ("prdSectionId") REFERENCES "PrdSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsistencyCheck" ADD CONSTRAINT "ConsistencyCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
