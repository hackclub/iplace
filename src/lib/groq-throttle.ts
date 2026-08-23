// Groq's free/on-demand tier enforces a strict tokens-per-minute (TPM) budget shared
// across the whole org, not per-request -- e.g. openai/gpt-oss-120b is capped at 8000
// TPM. This module makes sure every Groq call in the app (live submissions, resubmits,
// and the legacy-migration job) goes through a single global queue: calls never run
// concurrently, and each one waits until there's likely enough budget left in the
// trailing 60s window before firing, based on the actual `usage.total_tokens` Groq
// reported for recent calls. A 429 is still handled defensively (parsed retry delay,
// bounded retries) in case our own estimate drifts from the server's real counter.

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TPM_LIMIT = 8000;
const SAFETY_MARGIN = 1000; // keep usage under (TPM_LIMIT - SAFETY_MARGIN) per 60s window
const WINDOW_MS = 60_000;
const MAX_RETRIES = 4;

export class GroqRateLimitError extends Error {}
export class GroqRequestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface UsageEntry {
  timestamp: number;
  tokens: number;
}

const usageLog: UsageEntry[] = [];

/** Serializes every call through this module -- only one Groq HTTP request is ever in flight. */
let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function pruneUsageLog(now: number) {
  while (usageLog.length && now - usageLog[0].timestamp >= WINDOW_MS) usageLog.shift();
}

function tokensUsedInWindow(now: number): number {
  pruneUsageLog(now);
  return usageLog.reduce((sum, entry) => sum + entry.tokens, 0);
}

function recordUsage(tokens: number) {
  if (tokens > 0) usageLog.push({ timestamp: Date.now(), tokens });
}

/** Blocks until there's probably enough TPM budget left for a call of this rough size. */
async function waitForBudget(estimatedTokens: number) {
  for (;;) {
    const now = Date.now();
    const used = tokensUsedInWindow(now);
    if (used + estimatedTokens <= TPM_LIMIT - SAFETY_MARGIN) return;

    const oldest = usageLog[0];
    const waitMs = oldest ? Math.max(500, WINDOW_MS - (now - oldest.timestamp) + 500) : 2000;
    await sleep(waitMs);
  }
}

/** Roughly estimates prompt tokens from a chat payload (~4 chars/token) to budget against ahead of time. */
function estimateRequestTokens(body: { messages: any[]; max_tokens?: number; max_completion_tokens?: number }): number {
  const promptChars = JSON.stringify(body.messages).length;
  const promptTokens = Math.ceil(promptChars / 4);
  const completionBudget = body.max_tokens ?? body.max_completion_tokens ?? 1024;
  return promptTokens + completionBudget;
}

function parseRetryDelayMs(errorText: string): number | null {
  const match = errorText.match(/try again in ([\d.]+)s/i);
  if (!match) return null;
  return Math.ceil(parseFloat(match[1]) * 1000);
}

/**
 * Sends one Groq chat completion request. Globally serialized across the whole process
 * and throttled to respect the model's tokens-per-minute limit. Retries on 429 using the
 * server's suggested delay when available.
 */
export function groqChatCompletion(apiKey: string, body: Record<string, unknown>): Promise<any> {
  const task = queue.then(() => runRequest(apiKey, body));
  // Chain continues regardless of outcome so one failed call doesn't wedge the queue.
  queue = task.catch(() => {});
  return task;
}

async function runRequest(apiKey: string, body: Record<string, unknown>): Promise<any> {
  const estimatedTokens = estimateRequestTokens(body as any);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await waitForBudget(estimatedTokens);

    let response: Response;
    try {
      response = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (error: any) {
      throw new GroqRequestError(0, `Failed to reach Groq: ${error.message}`);
    }

    if (response.status === 429) {
      const text = await response.text().catch(() => "");
      // Conservatively treat the whole budget as consumed right now -- our own tracking
      // clearly undercounted if the server is still rejecting us.
      recordUsage(TPM_LIMIT);

      if (attempt === MAX_RETRIES) {
        throw new GroqRateLimitError(`Groq rate limit exceeded after ${MAX_RETRIES} retries: ${text.slice(0, 300)}`);
      }

      const delayMs = parseRetryDelayMs(text) ?? 15_000;
      await sleep(delayMs + 500);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new GroqRequestError(response.status, `Groq API error (${response.status}): ${text.slice(0, 500)}`);
    }

    const data = await response.json();
    recordUsage(data?.usage?.total_tokens ?? estimatedTokens);
    return data;
  }

  // Unreachable, but keeps TypeScript happy.
  throw new GroqRateLimitError("Groq rate limit exceeded");
}
