import type { APIRoute } from "astro";
import { z } from "zod";
import { getAdminFromRequest, notAdminResponse } from "../../../../../lib/admin";
import { validateRequestBody, jsonError, jsonResponse } from "../../../../../lib/api-util";
import { approveSubmission, SubmissionDecisionError } from "../../../../../lib/submission-decisions";

const ApproveSchema = z.object({
  overrideSeconds: z.number().int().min(0).optional(),
});

export const POST: APIRoute = async ({ params, request }) => {
  const admin = await getAdminFromRequest(request);
  if (!admin) return notAdminResponse();

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) return jsonError(400, "Invalid submission ID");

  const validation = await validateRequestBody(request, ApproveSchema);
  if (!validation.success) return validation.response;

  try {
    const { approvedTime } = await approveSubmission(id, {
      reviewedBy: admin.slackId,
      overrideSeconds: validation.data.overrideSeconds,
    });

    return jsonResponse({ success: true, approvedTime });
  } catch (error) {
    if (error instanceof SubmissionDecisionError) {
      return jsonError(error.message === "Submission not found" ? 404 : 400, error.message);
    }
    throw error;
  }
};
