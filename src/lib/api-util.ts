import { z } from "zod";

export function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

export function jsonError(status: number, message: string, details?: object) {
  return new Response(JSON.stringify({ error: message, details }), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

export async function validateRequestBody<T>(
  request: Request,
  schema: z.ZodSchema<T>
): Promise<{ success: true; data: T } | { success: false; response: Response }> {
  try {
    const body = await request.json();
    const data = schema.parse(body);
    return { success: true, data };
  }
  catch (error) {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        response: jsonError(400, "Validation failed", error.issues.map(err => ({
          path: err.path.join("."),
          message: err.message
        })))
      };
    }
    
    return {
      success: false,
      response: jsonError(400, "Invalid JSON body")
    };
  }
}
