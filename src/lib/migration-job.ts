import prisma from "./prisma";
import { autoReviewSubmission } from "./submission-decisions";

/** Singleton row id for the migration job -- there is only ever one. */
const JOB_ID = 1;

export type MigrationJobSnapshot = Awaited<ReturnType<typeof getMigrationJobStatus>>;

export async function getMigrationJobStatus() {
  const job = await prisma.submissionMigrationJob.findUnique({ where: { id: JOB_ID } });
  return job ?? {
    id: JOB_ID,
    status: "IDLE" as const,
    totalCount: 0,
    processedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    errorCount: 0,
    currentSubmissionId: null,
    lastError: null,
    startedAt: null,
    finishedAt: null,
  };
}

/**
 * Starts migrating legacy PENDING submissions (created before automated review existed)
 * onto the AI reviewer, one at a time. Idempotent: if a migration is already running, this
 * just returns its current status instead of starting a second one. The compare-and-swap
 * on `status` happens in a single UPDATE, so this is safe under concurrent requests even
 * across multiple server instances.
 */
export async function startMigrationJob(): Promise<{ started: boolean; job: NonNullable<MigrationJobSnapshot> }> {
  const legacySubmissions = await prisma.submission.findMany({
    where: { status: "PENDING" },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });

  const claim = await prisma.$transaction(async (tx) => {
    await tx.submissionMigrationJob.upsert({
      where: { id: JOB_ID },
      create: { id: JOB_ID },
      update: {},
    });

    return tx.submissionMigrationJob.updateMany({
      where: { id: JOB_ID, status: { not: "RUNNING" } },
      data: {
        status: "RUNNING",
        totalCount: legacySubmissions.length,
        processedCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
        errorCount: 0,
        currentSubmissionId: null,
        lastError: null,
        startedAt: new Date(),
        finishedAt: null,
      },
    });
  });

  const won = claim.count === 1;
  if (won) {
    // Fire and forget -- the caller doesn't wait for the whole migration to finish.
    runMigrationJob(legacySubmissions.map(s => s.id)).catch(async (error) => {
      console.error("(migration-job) Unrecoverable error while running migration job:", error);
      await prisma.submissionMigrationJob.update({
        where: { id: JOB_ID },
        data: { status: "FAILED", lastError: String(error?.message ?? error), finishedAt: new Date() },
      }).catch(() => {});
    });
  }

  const job = await getMigrationJobStatus();
  return { started: won, job: job! };
}

async function runMigrationJob(submissionIds: number[]) {
  for (const submissionId of submissionIds) {
    await prisma.submissionMigrationJob.update({
      where: { id: JOB_ID },
      data: { currentSubmissionId: submissionId },
    });

    try {
      // A submission may have been manually reviewed since the job started -- skip it.
      const current = await prisma.submission.findUnique({ where: { id: submissionId }, select: { status: true } });
      if (current?.status !== "PENDING") {
        await prisma.submissionMigrationJob.update({
          where: { id: JOB_ID },
          data: { processedCount: { increment: 1 } },
        });
        continue;
      }

      const { approved } = await autoReviewSubmission(submissionId);
      await prisma.submissionMigrationJob.update({
        where: { id: JOB_ID },
        data: {
          processedCount: { increment: 1 },
          approvedCount: approved ? { increment: 1 } : undefined,
          rejectedCount: !approved ? { increment: 1 } : undefined,
        },
      });
    } catch (error: any) {
      console.error(`(migration-job) Failed to review legacy submission ${submissionId}:`, error);
      await prisma.submissionMigrationJob.update({
        where: { id: JOB_ID },
        data: {
          processedCount: { increment: 1 },
          errorCount: { increment: 1 },
          lastError: String(error?.message ?? error),
        },
      });
    }
  }

  await prisma.submissionMigrationJob.update({
    where: { id: JOB_ID },
    data: { status: "DONE", currentSubmissionId: null, finishedAt: new Date() },
  });
}
