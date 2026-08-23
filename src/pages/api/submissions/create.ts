import type { APIRoute } from "astro";
import { z } from "zod";
import { getUserFromRequest, notAuthedResponse } from "../../../lib/auth";
import { validateRequestBody, jsonError, jsonResponse } from "../../../lib/api-util";
import { getAdminSlackIds } from "../../../lib/admin";
import { sendSlackDM } from "../../../lib/slack";
import prisma from "../../../lib/prisma";
import { hackatime } from "../../../lib/hackatime-client";
import { BEGIN_DATE } from "../../../config";
import { autoReviewSubmission } from "../../../lib/submission-decisions";

const CreateSubmissionSchema = z.object({
  iframeUrl: z.string().url("iframeUrl must be a valid URL"),
  repoUrl: z.string().url("repoUrl must be a valid URL"),
  description: z.string().min(1, "Description is required").max(5000),
  hackatimeProjectNames: z.array(z.string()).min(1, "At least one Hackatime project is required"),
});

/**
 * Runs the AI safety/validity review for a freshly-created submission. If the reviewer
 * itself is unavailable (e.g. Groq is down), the submission is left PENDING and admins
 * are notified to review it manually as a fallback.
 */
async function reviewAndNotifyOnFailure(submissionId: number, iframeUrl: string, userSlackId: string, isUpdate: boolean) {
  try {
    await autoReviewSubmission(submissionId);
  } catch (error) {
    console.error(`(submissions/create) Automated review failed for submission ${submissionId}:`, error);

    const adminIds = getAdminSlackIds();
    const action = isUpdate ? "resubmitted" : "submitted";
    const message = `📋 <@${userSlackId}> just ${action} a project, but the automated review couldn't reach a verdict: ${iframeUrl}\nHead to https://iplace.hackclub.com/admin/submissions to review it manually!`;
    await Promise.all(adminIds.map(id => sendSlackDM(id, message)));
  }
}

/** Strips trailing slashes, query params, and hash from a URL for comparison. */
function normalizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\/+$/, "");
  }
}

export const POST: APIRoute = async ({ request }) => {
  const user = await getUserFromRequest(request);
  if (!user) return notAuthedResponse();

  const validation = await validateRequestBody(request, CreateSubmissionSchema);
  if (!validation.success) return validation.response;

  const { iframeUrl, repoUrl, description, hackatimeProjectNames } = validation.data;

  // Verify Hackatime projects exist and have sufficient time
  const allProjects = await hackatime.getProjectsFor(user.slackId, BEGIN_DATE);

  for (const projectName of hackatimeProjectNames) {
    const project = allProjects.find(p => p.name === projectName);
    if (!project) {
      return jsonError(400, `Hackatime project "${projectName}" not found`);
    }
    if (project.total_seconds < 60) {
      return jsonError(400, `Hackatime project "${projectName}" has less than 1 minute of time`);
    }
    if (new Date(project.last_heartbeat) < BEGIN_DATE) {
      return jsonError(400, `Hackatime project "${projectName}" has no activity after the program start date`);
    }
  }

  // Check if user already has a frame with the same normalized URL
  const normalizedIframeUrl = normalizeUrl(iframeUrl);
  const existingFrames = await prisma.frame.findMany({
    where: { ownerId: user.id },
    include: { submission: true },
  });

  const matchingFrame = existingFrames.find(f => normalizeUrl(f.url) === normalizedIframeUrl);

  if (matchingFrame) {
    if (matchingFrame.isPending) {
      return jsonError(400, "This project already has a pending submission");
    }

    // Update the existing frame: create a new submission and send it back for review
    const result = await prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({
        data: {
          iframeUrl,
          repoUrl,
          description,
          hackatimeProjectNames: hackatimeProjectNames.join(","),
          ownerId: user.id,
        },
      });

      const frame = await tx.frame.update({
        where: { id: matchingFrame.id },
        data: {
          url: iframeUrl,
          isPending: true,
          projectNames: hackatimeProjectNames.join(","),
          submissionId: submission.id,
        },
      });

      return { submission, frame };
    });

    await reviewAndNotifyOnFailure(result.submission.id, iframeUrl, user.slackId, true);
    const finalSubmission = await prisma.submission.findUnique({ where: { id: result.submission.id } });

    return jsonResponse({
      success: true,
      updated: true,
      submission: finalSubmission,
      frame: { id: result.frame.id, url: result.frame.url },
    });
  }

  // Check that projects aren't already used by another frame
  const usedProjects = new Set(
    existingFrames.flatMap(f => f.projectNames.split(",").map(n => n.trim()))
  );

  for (const projectName of hackatimeProjectNames) {
    if (usedProjects.has(projectName)) {
      return jsonError(400, `Hackatime project "${projectName}" is already used by another frame`);
    }
  }

  // Create new submission and frame
  const result = await prisma.$transaction(async (tx) => {
    const submission = await tx.submission.create({
      data: {
        iframeUrl,
        repoUrl,
        description,
        hackatimeProjectNames: hackatimeProjectNames.join(","),
        ownerId: user.id,
      },
    });

    const frame = await tx.frame.create({
      data: {
        url: iframeUrl,
        ownerId: user.id,
        isPending: true,
        projectNames: hackatimeProjectNames.join(","),
        submissionId: submission.id,
      },
    });

    return { submission, frame };
  });

  await reviewAndNotifyOnFailure(result.submission.id, iframeUrl, user.slackId, false);
  const finalSubmission = await prisma.submission.findUnique({ where: { id: result.submission.id } });

  return jsonResponse({
    success: true,
    submission: finalSubmission,
    frame: { id: result.frame.id, url: result.frame.url },
  });
};
