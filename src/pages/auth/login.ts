import type { APIRoute } from "astro";
import { getHCAAuthorizationUrl } from "../../lib/hca";

export const GET: APIRoute = async ({ url }) => {
  const base = import.meta.env.PUBLIC_BASE_URL || url.origin;
  const redirectUri = new URL("/auth/callback", base).toString();
  const authUrl = getHCAAuthorizationUrl(redirectUri);
  return Response.redirect(authUrl, 302);
};
