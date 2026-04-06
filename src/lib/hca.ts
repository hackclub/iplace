const HCA_BASE_URL = "https://auth.hackclub.com";
const HCA_CLIENT_ID = import.meta.env.HCA_CLIENT_ID;
const HCA_CLIENT_SECRET = import.meta.env.HCA_CLIENT_SECRET;

const HCA_SCOPES = "openid profile email name slack_id address birthdate verification_status";

export interface HCATokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface HCAIdentity {
  id: string;
  first_name?: string;
  last_name?: string;
  primary_email?: string;
  slack_id: string;
  birthday?: string;
  verification_status?: string;
  ysws_eligible?: boolean;
  addresses?: Array<{
    first_name?: string;
    last_name?: string;
    line_1?: string;
    line_2?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
    primary?: boolean;
  }>;
}

export interface HCAResponse {
  identity: HCAIdentity;
}

export function getHCAAuthorizationUrl(redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: HCA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: HCA_SCOPES,
  });

  return `${HCA_BASE_URL}/oauth/authorize?${params.toString()}`;
}

export async function exchangeHCACode(code: string, redirectUri: string): Promise<HCATokenResponse> {
  const response = await fetch(`${HCA_BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: HCA_CLIENT_ID,
      client_secret: HCA_CLIENT_SECRET,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HCA token exchange failed (${response.status}): ${text}`);
  }

  return response.json();
}

export async function getHCAUser(accessToken: string): Promise<HCAIdentity> {
  const response = await fetch(`${HCA_BASE_URL}/api/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HCA user fetch failed (${response.status}): ${text}`);
  }

  const data: HCAResponse = await response.json();
  return data.identity;
}
