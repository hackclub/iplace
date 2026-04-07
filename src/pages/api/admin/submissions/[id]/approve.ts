import type { APIRoute } from "astro";
import { z } from "zod";
import { getAdminFromRequest, notAdminResponse } from "../../../../../lib/admin";
import { validateRequestBody, jsonError, jsonResponse } from "../../../../../lib/api-util";
import prisma from "../../../../../lib/prisma";
import { SECONDS_PER_TILE, BEGIN_DATE } from "../../../../../config";
import { Hackatime } from "../../../../../hackatime";
import { syncSubmissionToAirtable } from "../../../../../lib/airtable";
import { sendSlackDM } from "../../../../../lib/slack";

const ApproveSchema = z.object({
  syncWithAirtable: z.boolean(),
  overrideSeconds: z.number().int().min(0).optional(),
});

const hackatime = new Hackatime(import.meta.env.HACKATIME_ADMIN_KEY);

export const POST: APIRoute = async ({ params, request }) => {
  const admin = await getAdminFromRequest(request);
  if (!admin) return notAdminResponse();

  const id = parseInt(params.id!, 10);
  if (isNaN(id)) return jsonError(400, "Invalid submission ID");

  const validation = await validateRequestBody(request, ApproveSchema);
  if (!validation.success) return validation.response;

  const { syncWithAirtable, overrideSeconds } = validation.data;

  const submission = await prisma.submission.findUnique({
    where: { id },
    include: { owner: true, frame: true },
  });

  if (!submission) return jsonError(404, "Submission not found");
  if (submission.status !== "PENDING")
    return jsonError(400, "Submission is not pending");
  if (!submission.frame)
    return jsonError(400, "Submission has no associated frame");

  // Calculate approved time from Hackatime
  const projectNamesList = submission.hackatimeProjectNames.split(",").map(n => n.trim());
  const allProjects = await hackatime.getProjectsFor(submission.owner.slackId, BEGIN_DATE);

  let approvedTime = 0;
  for (const projectName of projectNamesList) {
    const project = allProjects.find(p => p.name === projectName);
    if (project) {
      approvedTime += project.total_seconds;
    }
  }

  // Apply override if specified
  if (overrideSeconds !== undefined) {
    approvedTime = overrideSeconds;
  }

  // Update submission and frame
  await prisma.$transaction(async (tx) => {
    await tx.submission.update({
      where: { id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedBy: admin.slackId,
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

  // Sync to Airtable if requested and user wants prize
  let airtableRecordId: string | null = null;
  if (syncWithAirtable && submission.wantsPrize) {
    try {
      const frame = await prisma.frame.findUnique({ where: { id: submission.frame.id } });
      airtableRecordId = await syncSubmissionToAirtable(
        submission,
        submission.owner,
        frame!
      );
      await prisma.submission.update({
        where: { id },
        data: {
          airtableSynced: true,
          airtableRecordId,
        },
      });
    } catch (error) {
      console.error(`(admin/approve) Airtable sync failed for submission ${id}:`, error);
      // Don't fail the approval if Airtable sync fails
    }
  }

  // DM the user on Slack
  if (submission.owner.slackId) {
    const tiles = Math.floor(approvedTime / SECONDS_PER_TILE);
    const message = [
      `Your iplace submission for *${submission.iframeUrl}* has been approved! :tada:`,
      ``,
      `You have *${tiles} tile${tiles !== 1 ? "s" : ""}* available to place. Head to https://iplace.hackclub.com to start placing!`,
    ].join("\n");

    await sendSlackDM(submission.owner.slackId, message);
  }

  return jsonResponse({
    success: true,
    approvedTime,
    airtableSynced: !!airtableRecordId,
  });
};
