/**
 * Browser-side API fetch helpers for SolidJS SPAs.
 * Wraps fetch with the project's { data } / { error } response envelope.
 * No server-side imports — safe to use in any client component.
 *
 * Usage:
 *   import { apiFetch, jsonFetch } from "@yorozu/core/client";
 *
 * The API base URL is injected via the VITE_API_BASE environment variable,
 * which each SPA app sets in its .env / wrangler.jsonc (e.g. "https://api.example.com").
 * When unset, requests are relative to the current origin — convenient for
 * local dev when a proxy forwards /api/* to the Wrangler dev server.
 */

// Vite replaces import.meta.env at build time.
// In Vitest and plain Node, import.meta.env may be absent — fall back to "".
// The type assertion avoids pulling in vite/client as a dependency on core.
const API_BASE: string =
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_BASE ?? "";

/**
 * Fetches a path and unwraps the { data } / { error } response envelope.
 * Returns { ok: true, data } on success or { ok: false, message } on failure.
 * `status` carries the HTTP status when there was a response, so a caller can
 * tell apart failures that mean different things — a 403 from a product gate
 * is a screen, not an error banner. It is undefined when the request never
 * reached the server.
 *
 * Automatically prepends the API base URL and adds credentials: "include"
 * so the session_token cookie is sent across origins (admin.example.com →
 * api.example.com). The CORS headers on the API side allow this.
 */
export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; data?: T; message?: string; status?: number }> {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      credentials: "include",
      ...init,
    });
    const body = (await res.json()) as
      | { data: T }
      | { error: { code: string; message: string } };
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message:
          (body as { error: { code: string; message: string } }).error
            ?.message ?? "エラーが発生しました",
      };
    }
    return { ok: true, status: res.status, data: (body as { data: T }).data };
  } catch {
    return {
      ok: false,
      message: "通信エラーが発生しました。再度お試しください。",
    };
  }
}

/** Convenience wrapper for JSON-body requests (POST, PATCH, PUT). */
export function jsonFetch<T>(
  path: string,
  method: string,
  body: unknown,
): Promise<{ ok: boolean; data?: T; message?: string; status?: number }> {
  return apiFetch<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Builds the public URL for a menu item image from its R2 key. */
export function menuImageUrl(key: string): string {
  return `${API_BASE}/api/menu/images/${key}`;
}
