const GITHUB_TOKEN = import.meta.env.GITHUB_TOKEN;

export interface RepoRef {
  owner: string;
  repo: string;
}

/** Parses an `owner/repo` reference out of a GitHub repo URL, or returns null if it isn't one. */
export function parseGitHubRepo(repoUrl: string): RepoRef | null {
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return null;

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;

    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Accept": "application/vnd.github+json",
    "User-Agent": "iplace-submission-reviewer/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (GITHUB_TOKEN) headers["Authorization"] = `Bearer ${GITHUB_TOKEN}`;
  return headers;
}

const MAX_LISTED_FILES = 120;

/** Returns a plain-text listing of every file in the repo's default branch, for the reviewer to read. */
export async function listRepoFiles(ref: RepoRef): Promise<string> {
  const repoRes = await fetch(`https://api.github.com/repos/${ref.owner}/${ref.repo}`, { headers: githubHeaders() });
  if (!repoRes.ok) return `Could not access repository ${ref.owner}/${ref.repo} (HTTP ${repoRes.status}). It may not exist or may be private.`;

  const repoData: any = await repoRes.json();
  const branch = repoData.default_branch;

  const treeRes = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    { headers: githubHeaders() }
  );
  if (!treeRes.ok) return `Could not list files for ${ref.owner}/${ref.repo} (HTTP ${treeRes.status}).`;

  const treeData: any = await treeRes.json();
  const files: any[] = (treeData.tree ?? []).filter((entry: any) => entry.type === "blob");

  const listed = files
    .slice(0, MAX_LISTED_FILES)
    .map((entry: any) => `${entry.path} (${entry.size ?? "?"} bytes)`)
    .join("\n");
  const overflowNote = files.length > MAX_LISTED_FILES
    ? `\n... and ${files.length - MAX_LISTED_FILES} more files not shown`
    : "";
  const truncatedNote = treeData.truncated
    ? "\n(Note: GitHub truncated this listing because the repo is very large.)"
    : "";

  return `Default branch: ${branch}\n${listed}${overflowNote}${truncatedNote}`;
}

const MAX_FILE_BYTES = 100_000;
const MAX_FILE_CHARS = 3000;

/** Reads a single file's text content from the repo's default branch. */
export async function readRepoFile(ref: RepoRef, path: string): Promise<string> {
  const cleanPath = path.replace(/^\/+/, "");
  if (!cleanPath || cleanPath.includes("..")) return `Invalid path: "${path}"`;

  const encodedPath = cleanPath.split("/").map(encodeURIComponent).join("/");
  const res = await fetch(
    `https://api.github.com/repos/${ref.owner}/${ref.repo}/contents/${encodedPath}`,
    { headers: githubHeaders() }
  );
  if (!res.ok) return `Could not read file "${cleanPath}" (HTTP ${res.status}).`;

  const data: any = await res.json();
  if (Array.isArray(data)) return `"${cleanPath}" is a directory, not a file.`;
  if (data.type !== "file") return `"${cleanPath}" is not a regular file.`;
  if (data.size > MAX_FILE_BYTES) return `File "${cleanPath}" is too large to read (${data.size} bytes).`;
  if (typeof data.content !== "string" || data.encoding !== "base64") return `Could not decode file "${cleanPath}".`;

  const decoded = Buffer.from(data.content, "base64").toString("utf-8");
  if (decoded.length > MAX_FILE_CHARS) {
    return `${decoded.slice(0, MAX_FILE_CHARS)}\n... [truncated, ${decoded.length - MAX_FILE_CHARS} more characters]`;
  }
  return decoded;
}
