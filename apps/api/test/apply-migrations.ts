/// <reference types="@cloudflare/vitest-plugin/types" />
import { applyD1Migrations, env } from "cloudflare:test";

// Apply all D1 migrations before each test so every test starts with a clean,
// fully-migrated schema. The TEST_MIGRATIONS binding is populated in
// vitest.config.ts via readD1Migrations() at config time.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
