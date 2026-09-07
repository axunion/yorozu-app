import { defineConfig, devices } from "@playwright/test";
import {
  ADMIN_ORIGIN,
  API_ORIGIN,
  ORDER_ORIGIN,
  SIGNUP_ORIGIN,
} from "./origins";

/**
 * Browser E2E config — see docs/reference/browser-e2e.md.
 *
 * Boots the four processes the golden path needs (API Worker + the three Vite
 * dev servers) and runs the specs against them. Requires apps/api/.dev.vars
 * with ENVIRONMENT=development so the Magic Link verify_url is returned in the
 * API response instead of being emailed.
 *
 * No database reset is needed: every spec registers its own store with a
 * unique email, and store-scoped isolation keeps runs from seeing each other's
 * menu, seats, orders or sales.
 */
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @yorozu/api dev",
      // /api/auth/me answers 401 unauthenticated; Playwright treats 401 as
      // "server is up", while the 404 on / would read as "not ready yet".
      url: `${API_ORIGIN}/api/auth/me`,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @yorozu/admin dev",
      url: ADMIN_ORIGIN,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @yorozu/order dev",
      url: ORDER_ORIGIN,
      reuseExistingServer: true,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @yorozu/signup dev",
      url: SIGNUP_ORIGIN,
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
});
