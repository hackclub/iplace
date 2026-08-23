-- CreateEnum
CREATE TYPE "MigrationJobStatus" AS ENUM ('IDLE', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "SubmissionMigrationJob" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "status" "MigrationJobStatus" NOT NULL DEFAULT 'IDLE',
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "currentSubmissionId" INTEGER,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SubmissionMigrationJob_pkey" PRIMARY KEY ("id")
);
