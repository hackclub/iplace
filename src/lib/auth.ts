import prisma from "./prisma";
import type * as db from "../prisma/generated/client";
import { jsonError } from "./api-util";

export async function createSession(userId: number): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
    }
  });

  return session.id;
}


export async function getUserBySession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: {
      id: sessionId,
    },
    include: {
      user: true,
    }
  });

  if (!session || session.expiresAt < new Date())
    return null;

  return session.user;
}

export async function cleanExpiredSessions() {
  await prisma.session.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      }
    }
  });
}

export function notAuthedResponse() {
  return jsonError(401, "Not authenticated");
}

export async function getUserFromRequest(request: Request): Promise<db.User | null> {
  const sessionCookie = request.headers.get("cookie")
    ?.split(";")
    .find(c => c.trim().startsWith("session="))
    ?.split("=")[1];

  if (!sessionCookie)
    return null;

  try {
    return await getUserBySession(sessionCookie);
  }
  catch (error) {
    console.warn("(warn) An error occured while verifying a user session!", error);
    return null;
  }
}
