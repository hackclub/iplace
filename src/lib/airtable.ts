import type * as db from "../prisma/generated/client";

const AIRTABLE_API_KEY = import.meta.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = import.meta.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_ID = import.meta.env.AIRTABLE_TABLE_ID;

function extractGitHubUsername(repoUrl: string): string {
  try {
    const url = new URL(repoUrl);
    if (url.hostname === "github.com") {
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length >= 1) return parts[0];
    }
  } catch {}
  return "";
}

export async function syncSubmissionToAirtable(
  submission: db.Submission,
  user: db.User,
  frame: db.Frame
): Promise<string> {
  const response = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AIRTABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        records: [
          {
            fields: {
              "Code URL": submission.repoUrl,
              "Playable URL": submission.iframeUrl,
              "First Name": user.legalFirstName ?? user.firstName ?? "",
              "Last Name": user.legalLastName ?? user.lastName ?? "",
              "Email": user.email ?? "",
              "Description": submission.description,
              "GitHub Username": extractGitHubUsername(submission.repoUrl),
              "Address (Line 1)": user.addressLine1 ?? "",
              "Address (Line 2)": user.addressLine2 ?? "",
              "City": user.city ?? "",
              "State / Province": user.stateProvince ?? "",
              "Country": user.country ?? "",
              "ZIP / Postal Code": user.zipPostalCode ?? "",
              "Birthday": user.birthday?.toISOString().split("T")[0] ?? "",
              "Optional - Override Hours Spent": Math.round((frame.approvedTime / 3600) * 10) / 10,
            },
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Airtable sync failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  return data.records[0].id;
}
