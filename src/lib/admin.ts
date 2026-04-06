import type * as db from "../prisma/generated/client";
import { getUserFromRequest, notAuthedResponse } from "./auth";
import { jsonError } from "./api-util";

export function isAdmin(user: db.User): boolean {
  const adminIds = (import.meta.env.ADMIN_SLACK_IDS || "")
    .split(";")
    .map((s: string) => s.trim())
    .filter(Boolean);
  return adminIds.includes(user.slackId);
}

export async function getAdminFromRequest(request: Request): Promise<db.User | null> {
  const user = await getUserFromRequest(request);
  if (!user || !isAdmin(user)) return null;
  return user;
}

export function notAdminResponse() {
  return jsonError(403, "Admin access required");
}
