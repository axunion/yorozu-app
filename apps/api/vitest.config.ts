import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Read migrations at config time so tests can inject them via the setup file.
// Add test/apply-migrations.ts to apply them to the Miniflare D1 binding before each test.
const migrations = await readD1Migrations(
  path.join(import.meta.dirname, "../../packages/db/drizzle"),
);

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.test.jsonc" },
            miniflare: {
              bindings: { TEST_MIGRATIONS: migrations },
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["src/**/*.test.ts"],
          setupFiles: ["./test/apply-migrations.ts"],
        },
      },
    ],
  },
});
