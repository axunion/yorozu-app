import { defineConfig, devices } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  API_ORIGIN,
  CROSS_ORIGIN,
  ORDER_ORIGIN,
  SHIFT_ORIGIN,
  SIGNUP_ORIGIN,
} from "./origins";

/**
 * Browser E2E config — see docs/reference/browser-e2e.md.
 *
 * Boots the five processes the specs need (API Worker + the four Vite dev
 * servers) and runs the specs against them. Requires apps/api/.dev.vars
 * with ENVIRONMENT=development so the passcode is returned in the
 * API response instead of being emailed.
 *
 * No database reset is needed: every spec registers its own store with a
 * unique email, and store-scoped isolation keeps runs from seeing each other's
 * menu, seats, orders or sales.
 */
// CROSS_ORIGIN (`pnpm e2e:cross-origin`) starts the SPAs with VITE_API_BASE
// set to the Worker's own origin, as production builds are, so every request
// is cross-origin and goes through the API's CORS middleware rather than the
// Vite /api proxy. Both modes need the same fixed ports (the API's *_ORIGIN
// allowlist), so they are separate runs, and this one never reuses SPA dev
// servers that may have been started for the other.
const spaEnv: Record<string, string> = CROSS_ORIGIN
  ? { VITE_API_BASE: API_ORIGIN }
  : {};
const spaServer = (filter: string, url: string) => ({
  command: `pnpm --filter ${filter} dev`,
  url,
  env: spaEnv,
  reuseExistingServer: !CROSS_ORIGIN,
  timeout: 120_000,
});

export default defineConfig({
  testDir: "./tests",
  // The golden path deliberately waits on the real cross-app polling intervals
  // (5s admin board / checkout, 10s customer order screen) rather than faking
  // them, so a passing run legitimately takes ~1 minute.
  timeout: 240_000,
  expect: { timeout: 30_000 },
  // One store per spec keeps them independent, but four dev servers plus a
  // Worker are the bottleneck, not the browser — parallelism buys nothing here.
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: CROSS_ORIGIN ? "chromium-cross-origin" : "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @yorozu/api dev",
      // /api/auth/me answers 401 unauthenticated; Playwright treats 401 as
      // "server is up", while the 404 on / would read as "not ready yet".
      url: `${API_ORIGIN}/api/auth/me`,
      // The Worker itself is the same in both modes.
      reuseExistingServer: true,
      timeout: 120_000,
    },
    spaServer("@yorozu/admin", ADMIN_ORIGIN),
    spaServer("@yorozu/order", ORDER_ORIGIN),
    spaServer("@yorozu/signup", SIGNUP_ORIGIN),
    spaServer("@yorozu/shift", SHIFT_ORIGIN),
  ],
});
