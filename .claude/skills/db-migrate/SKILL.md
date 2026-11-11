---
name: db-migrate
description: Generate Drizzle migrations from schema changes and apply them to local D1. Use this whenever packages/db/src/schema.ts has been modified, when migrations need to be regenerated, or when pnpm db:generate or pnpm db:reset needs to run — don't run those commands directly, invoke this skill instead.
disable-model-invocation: true
---

## Tenant isolation checklist (before generating SQL)

This is the quick pass for schema changes; the full audit is
`.claude/agents/tenant-security-reviewer.md`, which owns the tenant-isolation rules.

If the schema change adds a tenant-scoped table, verify in `packages/db/src/schema.ts`:

- [ ] New table has `store_id text("store_id").notNull().references(() => stores.id)`
- [ ] An index on `store_id` is defined: `index("idx_<table>_store").on(table.store_id)`
- [ ] If the table can be queried without going through `orders` (like `order_items` does),
      `store_id` is **denormalized** onto it (not just inherited via FK)
- [ ] Enum / status columns have a `check()` constraint enforcing allowed values
- [ ] If a partial UNIQUE constraint is needed (e.g., one-active-per-seat), it uses
      a `sql` template literal in the `.where()` clause — see `idx_one_active_order_per_seat`
- [ ] No existing column removed without a migration plan for data already in production

Reference patterns (copy these, don't reinvent): table with `store_id` — `menuItems`,
`seats`, `orders`; denormalized `store_id` — `orderItems`, `payments`; CHECK constraint —
`orders.status`.

## Steps

1. Run `pnpm db:generate` to generate migration SQL from schema diff.
2. Show the user the generated SQL file(s) in `packages/db/drizzle/` and review them together: the correct columns are present, no unexpected `DROP` statements appear, and FKs reference the correct parent table. Ask for confirmation before applying.
3. Once confirmed, apply:
   - If the change only **added new** migration files, run `pnpm db:migrate` — non-destructive, applies pending migrations to local D1.
   - If existing migrations were regenerated or edited, run `pnpm db:reset` — warn explicitly first that it wipes **all local D1 data** regardless of SQL content, especially if the SQL contains `DROP TABLE`, `DROP COLUMN`, or `ALTER TABLE ... RENAME`.
4. Run `ls packages/db/drizzle/` and show the migration file list so the user can confirm the expected files are present.
5. If the change added a tenant-scoped table, remind the user to add a cross-tenant
   isolation test in `apps/api/src/routes/` (Store A's record must not be visible to
   Store B; mutation by ID without matching `store_id` returns 404).

If `pnpm db:generate` produces no new files, tell the user that the schema is already in sync with the migrations.
