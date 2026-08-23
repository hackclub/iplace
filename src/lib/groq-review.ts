import type * as db from "../prisma/generated/client";
import { parseGitHubRepo, listRepoFiles, readRepoFile, type RepoRef } from "./github-repo";
import { safeFetchText } from "./safe-fetch";

const GROQ_API_KEY = import.meta.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "openai/gpt-oss-120b";

const MAX_ROUNDS = 8;
const MAX_TOOL_CALLS = 10;
const MAX_TOOL_CALLS_PER_ROUND = 4;

export class ReviewUnavailableError extends Error {}

export interface ReviewVerdict {
  approved: boolean;
  reason: string;
}

const SUBMIT_REVIEW_TOOL = {
  type: "function",
  function: {
    name: "submit_review",
    description: "Submit your final verdict on this project submission. Calling this ends the review.",
    parameters: {
      type: "object",
      properties: {
        approved: {
          type: "boolean",
          description: "true to let the frame through, false to reject it",
        },
        reason: {
          type: "string",
          description:
            "A 1-3 sentence explanation of your verdict. If rejecting, this is sent directly to the " +
            "submitter as feedback, so make it specific, actionable, and courteous.",
        },
      },
      required: ["approved", "reason"],
      additionalProperties: false,
    },
  },
};

const LIST_REPO_FILES_TOOL = {
  type: "function",
  function: {
    name: "list_repo_files",
    description: "Lists every file (path + size) in the submitted repository's default branch.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

const READ_REPO_FILE_TOOL = {
  type: "function",
  function: {
    name: "read_repo_file",
    description: "Reads the text content of a single file from the submitted repository, by path.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path of the file within the repo, e.g. \"src/index.js\" or \"README.md\"" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

const FETCH_LIVE_SITE_TOOL = {
  type: "function",
  function: {
    name: "fetch_live_site",
    description: "Fetches the submitted iframe URL and returns its status code, headers, and page content.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
};

function buildTools(hasRepo: boolean) {
  const tools = [SUBMIT_REVIEW_TOOL, FETCH_LIVE_SITE_TOOL];
  if (hasRepo) tools.push(LIST_REPO_FILES_TOOL, READ_REPO_FILE_TOOL);
  return tools;
}

const SYSTEM_PROMPT = `You are the automated submission reviewer for <iplace>, Hack Club's public canvas where teenagers \
submit personal coding projects to be embedded as an <iframe> tile. You are given one project submission and a small \
set of read-only tools to inspect it.

Your job is a QUICK safety and validity check, not a code quality review. Approve by default; only reject for a \
clear, specific problem. Reject if, and only if, one or more of these apply:
- The live site is broken, unreachable, a blank/placeholder/parked page, or sends response headers that would \
  block it from being embedded in an <iframe> (e.g. "x-frame-options: DENY/SAMEORIGIN" or a CSP "frame-ancestors" \
  directive that excludes this site).
- The project is or contains something unsafe: malware, phishing, scams, cryptomining, exploit code aimed at \
  third parties, harassment, hateful or sexually explicit content, or anything illegal.
- The project is clearly unrelated to the submitted description or repository (e.g. spam, a copy-pasted template \
  with no real changes, or content that doesn't match what was claimed).
- The repository is empty, inaccessible, or shows no genuine relation to the live site.

Do NOT reject for subjective code quality, missing polish, small bugs, or because you personally wouldn't have \
built it that way. Minor visual roughness or an unfinished-looking but functional and safe hobby project should \
be approved. When genuinely uncertain after investigating, lean toward approving.

You may call list_repo_files and read_repo_file (if a GitHub repo was provided) and fetch_live_site to investigate. \
Use only a few tool calls -- this should be a quick check, not an exhaustive audit. When you have enough \
information, call submit_review exactly once with your verdict. If rejecting, the "reason" you give is sent \
directly to the submitter, so phrase it as friendly, specific, actionable feedback.`;

async function callGroq(messages: any[], tools: any[], toolChoice: any): Promise<any> {
  if (!GROQ_API_KEY) throw new ReviewUnavailableError("GROQ_API_KEY is not configured");

  let response: Response;
  try {
    response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        tools,
        tool_choice: toolChoice,
        temperature: 0.2,
        max_tokens: 1024,
      }),
    });
  } catch (error: any) {
    throw new ReviewUnavailableError(`Failed to reach Groq: ${error.message}`);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ReviewUnavailableError(`Groq API error (${response.status}): ${text.slice(0, 500)}`);
  }

  return response.json();
}

function safeParseJson(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface ToolContext {
  repoRef: RepoRef | null;
  submission: db.Submission;
}

async function executeTool(name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
  try {
    switch (name) {
      case "list_repo_files": {
        if (!ctx.repoRef) return "No GitHub repository is available for this submission.";
        return await listRepoFiles(ctx.repoRef);
      }
      case "read_repo_file": {
        if (!ctx.repoRef) return "No GitHub repository is available for this submission.";
        const args = safeParseJson(rawArgs);
        if (!args || typeof args.path !== "string") return "Invalid arguments: expected { path: string }.";
        return await readRepoFile(ctx.repoRef, args.path);
      }
      case "fetch_live_site": {
        const result = await safeFetchText(ctx.submission.iframeUrl, 20_000);
        const bodySnippet = result.body.slice(0, 6000);
        return [
          `HTTP status: ${result.status}`,
          `Headers: ${JSON.stringify(result.headers)}`,
          `Body (may be truncated):`,
          bodySnippet,
        ].join("\n");
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (error: any) {
    return `Tool error: ${error.message}`;
  }
}

/** Runs the agentic AI safety/validity review over a submission and returns its verdict. */
export async function reviewSubmission(submission: db.Submission): Promise<ReviewVerdict> {
  const repoRef = parseGitHubRepo(submission.repoUrl);
  const tools = buildTools(!!repoRef);

  const userPrompt = [
    `Iframe URL: ${submission.iframeUrl}`,
    `Repository URL: ${submission.repoUrl}${repoRef ? "" : " (not a GitHub URL -- repo tools are unavailable)"}`,
    `Hackatime projects claimed: ${submission.hackatimeProjectNames}`,
    ``,
    `Description provided by the submitter:`,
    submission.description,
  ].join("\n");

  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userPrompt },
  ];

  let toolCallCount = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const mustFinish = round === MAX_ROUNDS - 1 || toolCallCount >= MAX_TOOL_CALLS;
    const toolChoice = mustFinish ? { type: "function", function: { name: "submit_review" } } : "auto";

    const data = await callGroq(messages, tools, toolChoice);
    const message = data.choices?.[0]?.message;
    if (!message) throw new ReviewUnavailableError("Groq returned no message");

    messages.push(message);

    const toolCalls: any[] = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      messages.push({
        role: "user",
        content: "Please respond by calling a tool. When you're done investigating, call submit_review with your verdict.",
      });
      continue;
    }

    for (const call of toolCalls.slice(0, MAX_TOOL_CALLS_PER_ROUND)) {
      if (call.function.name === "submit_review") {
        const args = safeParseJson(call.function.arguments);
        if (args && typeof args.approved === "boolean" && typeof args.reason === "string" && args.reason.trim()) {
          return { approved: args.approved, reason: args.reason.trim() };
        }
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Invalid arguments: approved must be a boolean and reason must be a non-empty string. Please call submit_review again.",
        });
        continue;
      }

      toolCallCount++;
      const result = await executeTool(call.function.name, call.function.arguments, { repoRef, submission });
      messages.push({ role: "tool", tool_call_id: call.id, content: result });
    }
  }

  throw new ReviewUnavailableError("Reviewer did not reach a verdict within the allotted tool-call budget");
}
