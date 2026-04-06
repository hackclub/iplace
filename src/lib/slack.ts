const SLACK_BOT_TOKEN = import.meta.env.SLACK_BOT_TOKEN;

// Cache Slack display names for 10 minutes
const nameCache = new Map<string, { name: string; expiresAt: number }>();
const CACHE_TTL = 10 * 60 * 1000;

/** Fetches the Slack display name for a user ID. Returns the ID as fallback. */
export async function getSlackUsername(slackId: string): Promise<string> {
  const cached = nameCache.get(slackId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  try {
    const response = await fetch(`https://slack.com/api/users.info?user=${slackId}`, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const data = await response.json();
    if (data.ok) {
      const name = data.user.profile.display_name || data.user.real_name || data.user.name || slackId;
      nameCache.set(slackId, { name, expiresAt: Date.now() + CACHE_TTL });
      return name;
    }
  } catch {}
  return slackId;
}

/** Batch-fetches Slack display names for multiple user IDs. */
export async function getSlackUsernames(slackIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(slackIds)];
  const results = await Promise.all(unique.map(async id => [id, await getSlackUsername(id)] as const));
  return new Map(results);
}

export async function sendSlackDM(slackId: string, message: string): Promise<boolean> {
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: slackId,
        text: message,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error(`(slack) Failed to send DM to ${slackId}:`, data.error);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`(slack) Error sending DM to ${slackId}:`, error);
    return false;
  }
}
