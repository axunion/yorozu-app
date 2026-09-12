---
name: new-route
description: Scaffold a new Hono API route with Zod validation and a corresponding vitest worker-runtime test. Use this whenever adding a new endpoint to apps/api — it ensures routes follow the project's response conventions, auth patterns, and test structure. Pass the route name and method as arguments (e.g., /new-route products GET).
---

## Project patterns to follow

**Route file** (`apps/api/src/routes/<name>.ts`):
- `new Hono<{ Bindings: Env }>()`
- Use `bodyValidator` from `../validator` for POST/PATCH body parsing
- Access validated body via `c.req.valid("json")`
- Access D1 via `createDb(c.env.DB)` from `@yorozu/db`
- Return errors with `errorResponse(code, message, status)` from `@yorozu/core` —
  use the established codes: `VALIDATION_ERROR` (400), `INVALID_CODE` (400),
  `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409),
  `RATE_LIMITED` (429); don't invent new ones
- Return success as `c.json({ data: ... })` — pass `201` as the second argument for creates
- Mount the router in `apps/api/src/app.ts`

**Test file** (`apps/api/src/routes/<name>.test.ts`):
- Follow the Workers runtime test conventions in `.claude/rules/testing.md` (reference
  import, `env` binding, `../test-helpers`, `crypto.randomUUID()` seeds)

## Security checklist (tenant isolation)

Canonical rules live in `.claude/agents/tenant-security-reviewer.md` — if the rules
change, update that file first and keep this condensed copy in sync.

- `store_id` filter on **every** SELECT / UPDATE / DELETE against tenant-scoped tables
- For mutations by `:id`, verify ownership first with
  `and(eq(table.id, id), eq(table.store_id, storeId))` — return 404 on miss,
  **never 403** (403 leaks resource existence)
- Input strings use `.transform((s) => s.trim()).pipe(z.string().min(1).max(...))`
- Tests include a cross-tenant isolation case (Store A's record invisible to Store B)

## Steps

1. If route name and HTTP method were provided as arguments, use them. Otherwise ask the user for: route name, HTTP methods, and auth requirement (public / admin session cookie / qr_token).
2. Create the test file first, covering: happy path, validation errors (missing/invalid fields), auth rejection if applicable, and cross-tenant isolation.
3. Create the route file following the patterns above and referencing existing routes for the auth type.
4. Mount the route in `apps/api/src/app.ts`.
5. Run `pnpm --filter @yorozu/api test` to verify the tests pass.
6. Run `pnpm check` to verify types and linting pass across all workspaces.

Note: `pnpm test` and `pnpm check` need `dangerouslyDisableSandbox: true` in the tool
call — Vitest and Wrangler require filesystem and network access beyond the default
sandbox limits.
