import type { APIRoute } from "astro";
import { getAdminFromRequest, notAdminResponse } from "../../../../../lib/admin";
import { jsonResponse } from "../../../../../lib/api-util";
import { getMigrationJobStatus } from "../../../../../lib/migration-job";

export const GET: APIRoute = async ({ request }) => {
  const admin = await getAdminFromRequest(request);
  if (!admin) return notAdminResponse();

  const job = await getMigrationJobStatus();
  return jsonResponse({ success: true, job });
};
