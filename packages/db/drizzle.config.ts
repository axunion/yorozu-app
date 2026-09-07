import { defineConfig } from "drizzle-kit";

// Local schema workflow: edit src/schema.ts → pnpm db:generate → pnpm db:reset (via apps/api)
// Production migrations are applied manually with
// `wrangler d1 migrations apply yorozu-app --remote` — see docs/deploy.md.
//
// drizzle-kit studio connects to the local SQLite file directly (no wrangler needed here).
// If you need to connect studio to a remote D1 in the future, add:
//   dbCredentials: { accountId: "...", databaseId: "...", token: process.env.CLOUDFLARE_D1_TOKEN }
// and update pnpm db:studio accordingly.
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
