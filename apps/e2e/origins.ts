/**
 * Fixed local dev origins the E2E run drives.
 *
 * These ports are not configurable: each SPA pins its own port in its
 * vite.config.ts, and apps/api/wrangler.jsonc allowlists exactly these four
 * origins for CORS. Changing one here without changing both of those breaks
 * the run with a CORS failure rather than a useful test failure.
 */
export const API_ORIGIN = "http://localhost:8787";
export const ADMIN_ORIGIN = "http://localhost:5173";
export const ORDER_ORIGIN = "http://localhost:5174";
export const SIGNUP_ORIGIN = "http://localhost:5175";
export const SHIFT_ORIGIN = "http://localhost:5176";

// No @types/node in this workspace; the runner is Node all the same.
declare const process: { env: Record<string, string | undefined> };

/**
 * `pnpm e2e:cross-origin`: the SPAs call the API at API_ORIGIN, as production
 * builds do, instead of through their dev server's /api proxy.
 */
export const CROSS_ORIGIN = process.env.E2E_API === "cross-origin";
