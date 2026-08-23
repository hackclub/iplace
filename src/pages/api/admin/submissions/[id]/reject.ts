import type { APIRoute } from "astro";
import { z } from "zod";
import { getAdminFromRequest, notAdminResponse } from "../../../../../lib/admin";
import { validateRequestBody, jsonError, jsonResponse } from "../../../../../lib/api-util";
import { rejectSubmission, SubmissionDecisionError } from "../../../../../lib/submission-decisions";

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

  try {
    await rejectSubmission(id, { reviewedBy: admin.slackId, feedback: validation.data.feedback });
    return jsonResponse({ success: true });
  } catch (error) {
    if (error instanceof SubmissionDecisionError) {
      return jsonError(error.message === "Submission not found" ? 404 : 400, error.message);
    }
    throw error;
  }
};
