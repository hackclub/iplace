import type { APIRoute } from "astro";
import { z } from "zod";
import { getUserFromRequest, notAuthedResponse } from "../../../lib/auth";
import { isAdmin, getAdminSlackIds } from "../../../lib/admin";
import { validateRequestBody, jsonError, jsonResponse } from "../../../lib/api-util";
import prisma from "../../../lib/prisma";
import { autoReviewSubmission } from "../../../lib/submission-decisions";
import { sendSlackDM } from "../../../lib/slack";

export const GET: APIRoute = async ({ params, request }) => {
  const user = await getUserFromRequest(request);
  if (!user) return notAuthedResponse();

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) return jsonError(400, "Invalid submission ID");

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { frame: true, owner: true },
  });

  if (!submission) return jsonError(404, "Submission not found");
  if (submission.ownerId !== user.id && !isAdmin(user))
    return jsonError(403, "Not authorized");

  return jsonResponse(submission);
};

const EditSubmissionSchema = z.object({
  iframeUrl: z.string().url().optional(),
  repoUrl: z.string().url().optional(),
  description: z.string().min(1).max(5000).optional(),
  hackatimeProjectNames: z.array(z.string()).min(1).optional(),
});

export const PUT: APIRoute = async ({ params, request }) => {
  const user = await getUserFromRequest(request);
  if (!user) return notAuthedResponse();

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) return jsonError(400, "Invalid submission ID");

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { frame: true },
  });

  if (!submission) return jsonError(404, "Submission not found");
  if (submission.ownerId !== user.id) return jsonError(403, "Not authorized");
  if (submission.status !== "REJECTED")
    return jsonError(400, "Only rejected submissions can be edited and resubmitted");

  const validation = await validateRequestBody(request, EditSubmissionSchema);
  if (!validation.success) return validation.response;

  const data = validation.data;

  const updatedSubmission = await prisma.$transaction(async (tx) => {
    const updated = await tx.submission.update({
      where: { id },
      data: {
        ...(data.iframeUrl && { iframeUrl: data.iframeUrl }),
        ...(data.repoUrl && { repoUrl: data.repoUrl }),
        ...(data.description && { description: data.description }),
        ...(data.hackatimeProjectNames && {
          hackatimeProjectNames: data.hackatimeProjectNames.join(","),
        }),
        status: "PENDING",
        reviewerFeedback: null,
        reviewedAt: null,
        reviewedBy: null,
      },
    });

    // Update the linked frame too
    if (submission.frame) {
      await tx.frame.update({
        where: { id: submission.frame.id },
        data: {
          url: data.iframeUrl ?? submission.iframeUrl,
          projectNames: data.hackatimeProjectNames?.join(",") ?? submission.hackatimeProjectNames,
          isPending: true,
        },
      });
    }

    return updated;
  });

  try {
    await autoReviewSubmission(id);
  } catch (error) {
    console.error(`(submissions/[id]) Automated review failed for submission ${id}:`, error);
    const adminIds = getAdminSlackIds();
    const message = `📋 <@${user.slackId}> just resubmitted a project, but the automated review couldn't reach a verdict: ${updatedSubmission.iframeUrl}\nHead to https://iplace.hackclub.com/admin/submissions to review it manually!`;
    await Promise.all(adminIds.map(adminId => sendSlackDM(adminId, message)));
  }

  const finalSubmission = await prisma.submission.findUnique({ where: { id } });

  return jsonResponse({ success: true, submission: finalSubmission });
};
