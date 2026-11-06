/**
 * Response envelope helpers for the shared API contract.
 *
 * Success:  { "data": { ... } }
 * Error:    { "error": { "code": "...", "message": "..." } }
 */

/** Returns a JSON response wrapping the payload in `{ data }`. */
export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json({ data }, { status });
}

/** Returns a JSON response wrapping the error in `{ error: { code, message } }`. */
export function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Returns a 400 VALIDATION_ERROR response from a Zod issues array. Each
 * message is a whole Japanese sentence (see types/zod-ja.ts), so they are
 * joined as running text.
 */
export function validationError(issues: { message: string }[]): Response {
  return errorResponse(
    "VALIDATION_ERROR",
    issues.map((i) => i.message).join(""),
    400,
  );
}
