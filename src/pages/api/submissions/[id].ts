import type { APIRoute } from "astro";
import { z } from "zod";
import { getUserFromRequest, notAuthedResponse } from "../../../lib/auth";
import { isAdmin } from "../../../lib/admin";
import { validateRequestBody, jsonError, jsonResponse } from "../../../lib/api-util";
import prisma from "../../../lib/prisma";

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
  wantsPrize: z.boolean().optional(),
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

  // Verify YSWS eligibility if user wants the prize
  if (data.wantsPrize && user.verificationStatus !== "verified") {
    return jsonError(403, "You are not YSWS-eligible to claim a prize");
  }

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
        ...(data.wantsPrize !== undefined && { wantsPrize: data.wantsPrize }),
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

  return jsonResponse({ success: true, submission: updatedSubmission });
};
