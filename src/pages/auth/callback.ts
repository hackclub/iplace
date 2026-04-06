import type { APIRoute } from "astro";
import { exchangeHCACode, getHCAUser } from "../../lib/hca";
import { createSession } from "../../lib/auth";
import prisma from "../../lib/prisma";

export const GET: APIRoute = async ({ url, redirect }) => {
  const code = url.searchParams.get("code");
  if (!code) {
    return new Response("Missing authorization code", { status: 400 });
  }

  const base = import.meta.env.PUBLIC_BASE_URL || url.origin;
  const redirectUri = new URL("/auth/callback", base).toString();

  try {
    const tokenResponse = await exchangeHCACode(code, redirectUri);
    const hcaUser = await getHCAUser(tokenResponse.access_token);
    // Try to find existing user by HCA ID, then fall back to Slack ID (migration path)
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { hcaId: hcaUser.id },
          ...(hcaUser.slack_id ? [{ slackId: hcaUser.slack_id }] : []),
        ],
      },
    });

    // Prefer the primary address, fall back to first
    const address = hcaUser.addresses?.find(a => a.primary) ?? hcaUser.addresses?.[0];

    const userData = {
      name: `${hcaUser.first_name ?? ""} ${hcaUser.last_name ?? ""}`.trim() || "Unknown",
      profilePicture: "",
      hcaId: hcaUser.id,
      slackId: hcaUser.slack_id || "",
      email: hcaUser.primary_email || null,
      firstName: hcaUser.first_name || null,
      lastName: hcaUser.last_name || null,
      legalFirstName: address?.first_name || hcaUser.first_name || null,
      legalLastName: address?.last_name || hcaUser.last_name || null,
      birthday: hcaUser.birthday ? new Date(hcaUser.birthday) : null,
      addressLine1: address?.line_1 || null,
      addressLine2: address?.line_2 || null,
      city: address?.city || null,
      stateProvince: address?.state || null,
      country: address?.country || null,
      zipPostalCode: address?.postal_code || null,
      verificationStatus: hcaUser.verification_status || null,
    };

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: userData,
      });
    } else {
      if (!userData.slackId) {
        return new Response("Your Hack Club Auth account must have a linked Slack ID", { status: 400 });
      }
      user = await prisma.user.create({
        data: userData as typeof userData & { slackId: string },
      });
    }

    const sessionId = await createSession(user.id);

    const headers = new Headers();
    headers.set("Location", "/");
    headers.set(
      "Set-Cookie",
      `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
    );

    return new Response(null, { status: 302, headers });
  } catch (error) {
    console.error("(auth/callback) Error during HCA authentication:", error);
    return new Response("Authentication failed", { status: 500 });
  }
};
