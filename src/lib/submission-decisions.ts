import type * as db from "../prisma/generated/client";
import prisma from "./prisma";
import { hackatime } from "./hackatime-client";
import { sendSlackDM } from "./slack";
import { SECONDS_PER_TILE, BEGIN_DATE } from "../config";
import { reviewSubmission } from "./groq-review";

/** Sentinel `reviewedBy` value stamped on submissions decided by the AI reviewer. */
export const AI_REVIEWER_ID = "ai:openai/gpt-oss-120b";

export class SubmissionDecisionError extends Error {}

async function computeApprovedTime(submission: db.Submission, ownerSlackId: string, overrideSeconds?: number): Promise<number> {
  if (overrideSeconds !== undefined) return overrideSeconds;

  const projectNamesList = submission.hackatimeProjectNames.split(",").map(n => n.trim());
  const allProjects = await hackatime.getProjectsFor(ownerSlackId, BEGIN_DATE);

  let approvedTime = 0;
  for (const projectName of projectNamesList) {
    const project = allProjects.find(p => p.name === projectName);
    if (project) approvedTime += project.total_seconds;
  }

  return approvedTime;
}

export interface ApproveResult {
  approvedTime: number;
}

/** Approves a PENDING submission: grants tiles for the linked frame and DMs the owner. */
export async function approveSubmission(
  submissionId: number,
  opts: { reviewedBy: string; overrideSeconds?: number }
): Promise<ApproveResult> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { owner: true, frame: true },
  });

  if (!submission) throw new SubmissionDecisionError("Submission not found");
  if (submission.status !== "PENDING") throw new SubmissionDecisionError("Submission is not pending");
  if (!submission.frame) throw new SubmissionDecisionError("Submission has no associated frame");

  const approvedTime = await computeApprovedTime(submission, submission.owner.slackId, opts.overrideSeconds);

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedBy: opts.reviewedBy,
      },
    });

    await tx.frame.update({
      where: { id: submission.frame!.id },
      data: {
        isPending: false,
        approvedTime,
      },
    });
  });

  if (submission.owner.slackId) {
    const tiles = Math.floor(approvedTime / SECONDS_PER_TILE);
    const message = [
      `Your iplace submission for *${submission.iframeUrl}* has been approved! :tada:`,
      ``,
      `You have *${tiles} tile${tiles !== 1 ? "s" : ""}* available to place. Head to https://iplace.hackclub.com to start placing!`,
    ].join("\n");

    await sendSlackDM(submission.owner.slackId, message);
  }

  return { approvedTime };
}

/** Rejects a PENDING submission: restores/deletes the linked frame and DMs the owner with feedback. */
export async function rejectSubmission(
  submissionId: number,
  opts: { reviewedBy: string; feedback: string }
): Promise<void> {
  const submission = await prisma.submission.findUnique({
    where: { id: submissionId },
    include: { owner: true, frame: true },
  });

  if (!submission) throw new SubmissionDecisionError("Submission not found");
  if (submission.status !== "PENDING") throw new SubmissionDecisionError("Submission is not pending");

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id: submissionId },
      data: {
        status: "REJECTED",
        reviewerFeedback: opts.feedback,
        reviewedAt: new Date(),
        reviewedBy: opts.reviewedBy,
      },
    });

    if (submission.frame) {
      if (submission.frame.placedTiles === 0 && submission.frame.approvedTime === 0) {
        // Brand new frame with no history -- safe to delete
        // Unlink first, then delete
        await tx.frame.update({ where: { id: submission.frame.id }, data: { submissionId: null } });
        await tx.frame.delete({ where: { id: submission.frame.id } });
      } else {
        // Frame has tiles or was previously approved (re-ship rejection)
        // Just unlink and restore to non-pending so existing tiles remain
        await tx.frame.update({
          where: { id: submission.frame.id },
          data: { isPending: false, submissionId: null },
        });
      }
    }
  });

  if (submission.owner.slackId) {
    const message = [
      `Your iplace submission for *${submission.iframeUrl}* was not approved.`,
      ``,
      `*Feedback from reviewer:*`,
      opts.feedback,
      ``,
      `You can edit and resubmit your project at https://iplace.hackclub.com`,
    ].join("\n");

    await sendSlackDM(submission.owner.slackId, message);
  }
}

export interface AutoReviewResult {
  approved: boolean;
}

/**
 * Runs the AI safety/validity review over a PENDING submission and immediately
 * approves or rejects it based on the verdict. Propagates `ReviewUnavailableError`
 * (from groq-review) if the reviewer itself couldn't reach a verdict -- callers should
 * leave the submission PENDING and fall back to manual review in that case.
 */
export async function autoReviewSubmission(submissionId: number): Promise<AutoReviewResult> {
  const submission = await prisma.submission.findUnique({ where: { id: submissionId } });
  if (!submission) throw new SubmissionDecisionError("Submission not found");

  const verdict = await reviewSubmission(submission);

  if (verdict.approved) {
    await approveSubmission(submissionId, { reviewedBy: AI_REVIEWER_ID });
  } else {
    await rejectSubmission(submissionId, { reviewedBy: AI_REVIEWER_ID, feedback: verdict.reason });
  }

  return { approved: verdict.approved };
}
