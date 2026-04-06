import type { APIRoute } from "astro";
import { z } from "zod";
import { getUserFromRequest, notAuthedResponse } from "../../lib/auth";
import { jsonError, jsonResponse, validateRequestBody } from "../../lib/api-util";
import prisma from "../../lib/prisma";
import { SECONDS_PER_TILE } from "../../config";

const PlaceTileSchema = z.object({
    x: z.number().int("x must be an integer"),
    y: z.number().int("y must be an integer"),
    frameId: z.number().int("frameId must be an integer").positive("frameId must be positive")
});

export const POST: APIRoute = async ({ request }) => {
    const user = await getUserFromRequest(request);
    if (!user)
        return notAuthedResponse();

    const validation = await validateRequestBody(request, PlaceTileSchema);
    if (!validation.success)
        return validation.response;

    const { x, y, frameId } = validation.data;

    const frame = await prisma.frame.findUnique({
        where: { id: frameId }
    });

    if (!frame)
        return jsonError(404, "Frame not found");

    if (frame.isPending)
        return jsonError(400, "Cannot place tiles on pending frames");

    if (frame.ownerId !== user.id)
        return jsonError(403, "You can only place tiles on your own frames");

    const requiredTime = (frame.placedTiles + 1) * SECONDS_PER_TILE;
    if (!frame.approvedTime || frame.approvedTime - requiredTime < 0)
        return jsonError(400, "Insufficient approved time to place another tile");

    const existingFrameTiles = await prisma.tile.findMany({
        where: { frameId }
    });

    if (existingFrameTiles.length > 0) {
        // Subsequent tiles can "creep" into existing tiles, but can only be placed adjacent to existing
        // tiles of the same frame.
        const isAdjacent = existingFrameTiles.some(tile => {
            const dx = Math.abs(tile.x - x);
            const dy = Math.abs(tile.y - y);
            // Adjacent means exactly one step away in x OR y direction (not diagonal)
            return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
        });

        if (!isAdjacent) {
            return jsonError(400, "Tiles must be placed adjacent to existing tiles of the same frame");
        }
    }
    else {
        // Initial tiles cannot be placed on top of existing tiles.
        const existingTile = await prisma.tile.findUnique({
            where: { x_y: { x, y } }
        });

        if (existingTile) {
            return jsonError(409, "Position already occupied");
        }
    }

    console.log(`(/api/place-tile) placing tile @ (${x}, ${y}) for ${frame.url}`);
    const [tile, updatedFrame] = await prisma.$transaction([
        prisma.tile.create({
            data: {
                x,
                y,
                frameId
            }
        }),
        prisma.frame.update({
            where: { id: frameId },
            data: {
                placedTiles: frame.placedTiles + 1
            }
        })
    ]);

    return jsonResponse({
        success: true,
        tile: {
            x: tile.x,
            y: tile.y,
            frameId: tile.frameId,
            placedAt: tile.placedAt
        },
        frame: {
            placedTiles: updatedFrame.placedTiles,
            remainingTime: (updatedFrame.approvedTime || 0) - (updatedFrame.placedTiles * SECONDS_PER_TILE)
        }
    });
};
