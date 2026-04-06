import type { APIRoute } from "astro";
import { z } from "zod";
import { getUserFromRequest, notAuthedResponse } from "../../../lib/auth";
import { validateRequestBody, jsonError, jsonResponse } from "../../../lib/api-util";

const AutofillSchema = z.object({
  repoUrl: z.string().url(),
});

const README_FILENAMES = ["README.md", "readme.md", "Readme.md", "README.rst", "README.txt", "README"];

export const POST: APIRoute = async ({ request }) => {
  const user = await getUserFromRequest(request);
  if (!user) return notAuthedResponse();

  const validation = await validateRequestBody(request, AutofillSchema);
  if (!validation.success) return validation.response;

  const { repoUrl } = validation.data;

  // Parse GitHub URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) {
    return jsonError(400, "Not a GitHub URL");
  }

  const [, owner, repo] = match;
  const repoName = repo.replace(/\.git$/, "");

  // Try fetching raw README directly (avoids API rate limits)
  for (const filename of README_FILENAMES) {
    try {
      const response = await fetch(
        `https://raw.githubusercontent.com/${owner}/${repoName}/HEAD/${filename}`
      );

      if (response.ok) {
        const readme = await response.text();
        const truncated = readme.length > 2000 ? readme.substring(0, 2000) + "..." : readme;
        return jsonResponse({ readme: truncated });
      }
    } catch {
      continue;
    }
  }

  return jsonError(404, "README not found");
};
