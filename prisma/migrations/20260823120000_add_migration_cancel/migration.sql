-- AlterEnum
ALTER TYPE "MigrationJobStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "SubmissionMigrationJob" ADD COLUMN "cancelRequested" BOOLEAN NOT NULL DEFAULT false;
