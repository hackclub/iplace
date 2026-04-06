import type { APIRoute } from "astro";
import { z } from "zod";
import { getAdminFromRequest, notAdminResponse } from "../../../../lib/admin";
import { validateRequestBody, jsonError, jsonResponse } from "../../../../lib/api-util";
import prisma from "../../../../lib/prisma";

const DeleteTileSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});

export const POST: APIRoute = async ({ request }) => {
  const admin = await getAdminFromRequest(request);
  if (!admin) return notAdminResponse();

  const validation = await validateRequestBody(request, DeleteTileSchema);
  if (!validation.success) return validation.response;

  const { x, y } = validation.data;

  const tile = await prisma.tile.findUnique({
    where: { x_y: { x, y } },
  });

  if (!tile) return jsonError(404, "Tile not found");

  await prisma.$transaction(async (tx) => {
    await tx.tile.delete({ where: { x_y: { x, y } } });
    await tx.frame.update({
      where: { id: tile.frameId },
      data: { placedTiles: { decrement: 1 } },
    });
  });

  return jsonResponse({ success: true });
};
