import type { APIRoute } from "astro";
import { getUserFromRequest, notAuthedResponse } from "../../lib/auth";
import { Hackatime } from "../../hackatime";
import { BEGIN_DATE } from "../../config";
import { jsonResponse } from "../../lib/api-util";
import prisma from "../../lib/prisma";

const hackatime = new Hackatime(import.meta.env.HACKATIME_ADMIN_KEY);

export interface ApiHackatimeProjectsResponse {
    projects: ApiHackatimeProject[];
}

interface ApiHackatimeProject {
    name: string;
    seconds: number;
}

export const POST: APIRoute = async ({ request }) => {
    const user = await getUserFromRequest(request);
    if (!user)
        return notAuthedResponse();

    // Optional: exclude a specific frame's projects from the "used" filter
    // (used when re-shipping an existing frame)
    let excludeFrameId: number | null = null;
    try {
        const body = await request.clone().json();
        if (body?.excludeFrameId) {
            excludeFrameId = parseInt(body.excludeFrameId, 10) || null;
        }
    } catch {
        // No body or invalid JSON is fine - just list all projects
    }

    const allProjects = await hackatime.getProjectsFor(user.slackId);

    const userFrames = await prisma.frame.findMany({
        where: { ownerId: user.id },
        select: { id: true, projectNames: true }
    });

    const usedProjectNames = new Set<string>(
        userFrames
            .filter(x => x.projectNames && x.id !== excludeFrameId)
            .map(x => x.projectNames.split(","))
            .flat()
    );

    const response: ApiHackatimeProjectsResponse = {
        projects: allProjects
            .filter(x => new Date(x.last_heartbeat) >= BEGIN_DATE)
            .filter(x => x.total_seconds > 60/*min*/ * 60/*sec*/)
            .filter(x => x.total_heartbeats > 0)
            .filter(x => !usedProjectNames.has(x.name))
            .map(x => (
                {
                    name: x.name,
                    seconds: x.total_seconds
                } satisfies ApiHackatimeProject
            ))
    };

    return jsonResponse(response);
};
