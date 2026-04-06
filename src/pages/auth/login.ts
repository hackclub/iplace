import type { APIRoute } from "astro";
import { getHCAAuthorizationUrl } from "../../lib/hca";

export const GET: APIRoute = async ({ url }) => {
  const redirectUri = new URL("/auth/callback", url.origin).toString();
  const authUrl = getHCAAuthorizationUrl(redirectUri);
  return Response.redirect(authUrl, 302);
};
