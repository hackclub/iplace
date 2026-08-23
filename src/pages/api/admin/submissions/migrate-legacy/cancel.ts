import type { APIRoute } from "astro";
import { getAdminFromRequest, notAdminResponse } from "../../../../../lib/admin";
import { jsonResponse } from "../../../../../lib/api-util";
import { cancelMigrationJob } from "../../../../../lib/migration-job";

export const POST: APIRoute = async ({ request }) => {
  const admin = await getAdminFromRequest(request);
  if (!admin) return notAdminResponse();

  const { cancelled, job } = await cancelMigrationJob();
  return jsonResponse({ success: true, cancelled, job });
};
