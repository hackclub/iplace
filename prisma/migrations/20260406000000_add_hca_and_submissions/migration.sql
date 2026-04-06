-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable: User - add HCA fields
ALTER TABLE "User" ADD COLUMN "hcaId" TEXT,
ADD COLUMN "email" TEXT,
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "legalFirstName" TEXT,
ADD COLUMN "legalLastName" TEXT,
ADD COLUMN "birthday" TIMESTAMP(3),
ADD COLUMN "addressLine1" TEXT,
ADD COLUMN "addressLine2" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "stateProvince" TEXT,
ADD COLUMN "country" TEXT,
ADD COLUMN "zipPostalCode" TEXT,
ADD COLUMN "verificationStatus" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_hcaId_key" ON "User"("hcaId");

-- AlterTable: Frame - make airtableId optional, add submissionId
ALTER TABLE "Frame" ALTER COLUMN "airtableId" DROP NOT NULL;
ALTER TABLE "Frame" ADD COLUMN "submissionId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Frame_submissionId_key" ON "Frame"("submissionId");

-- CreateTable
CREATE TABLE "Submission" (
    "id" SERIAL NOT NULL,
    "iframeUrl" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "hackatimeProjectNames" TEXT NOT NULL,
    "wantsPrize" BOOLEAN NOT NULL DEFAULT false,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewerFeedback" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "airtableSynced" BOOLEAN NOT NULL DEFAULT false,
    "airtableRecordId" TEXT,
    "ownerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Submission_ownerId_idx" ON "Submission"("ownerId");

-- CreateIndex
CREATE INDEX "Submission_status_idx" ON "Submission"("status");

-- AddForeignKey
ALTER TABLE "Frame" ADD CONSTRAINT "Frame_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
