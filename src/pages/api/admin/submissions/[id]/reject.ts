import type { APIRoute } from "astro";
import { z } from "zod";
import { getAdminFromRequest, notAdminResponse } from "../../../../../lib/admin";
import { validateRequestBody, jsonError, jsonResponse } from "../../../../../lib/api-util";
import prisma from "../../../../../lib/prisma";
import { sendSlackDM } from "../../../../../lib/slack";

const RejectSchema = z.object({
  feedback: z.string().min(1, "Feedback is required"),
});

export const POST: APIRoute = async ({ params, request }) => {
  const admin = await getAdminFromRequest(request);
  if (!admin) return notAdminResponse();

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) return jsonError(400, "Invalid submission ID");

  const validation = await validateRequestBody(request, RejectSchema);
  if (!validation.success) return validation.response;

  const { feedback } = validation.data;

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { owner: true, frame: true },
  });

  if (!submission) return jsonError(404, "Submission not found");
  if (submission.status !== "PENDING")
    return jsonError(400, "Submission is not pending");

  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewerFeedback: feedback,
        reviewedAt: new Date(),
        reviewedBy: admin.slackId,
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

  // Send Slack DM to the user
  if (submission.owner.slackId) {
    const message = [
      `Your iplace submission for *${submission.iframeUrl}* was not approved.`,
      ``,
      `*Feedback from reviewer:*`,
      feedback,
      ``,
      `You can edit and resubmit your project at https://iplace.hackclub.com`,
    ].join("\n");

    await sendSlackDM(submission.owner.slackId, message);
  }

  return jsonResponse({ success: true });
};
