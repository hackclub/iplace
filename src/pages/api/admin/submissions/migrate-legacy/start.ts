import type { APIRoute } from "astro";
import { getAdminFromRequest, notAdminResponse } from "../../../../../lib/admin";
import { jsonResponse } from "../../../../../lib/api-util";
import { startMigrationJob } from "../../../../../lib/migration-job";

export const POST: APIRoute = async ({ request }) => {
  const admin = await getAdminFromRequest(request);
  if (!admin) return notAdminResponse();

  const { started, job } = await startMigrationJob();
  return jsonResponse({ success: true, started, job });
};
