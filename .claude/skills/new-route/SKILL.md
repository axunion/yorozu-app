---
name: new-route
description: Scaffold a new Hono API route with Zod validation and a corresponding vitest worker-runtime test. Use this whenever adding a new endpoint to apps/api — it ensures routes follow the project's response conventions, auth patterns, and test structure. Pass the route name and method as arguments (e.g., /new-route products GET).
---

## Project patterns to follow

**Route file** (`apps/api/src/routes/<name>.ts`): read `.claude/rules/api-routes.md`
first — it is path-scoped, so it isn't loaded until a matching file is open. It covers
router setup, validation, DB access, the response shape and the auth patterns. Beyond it:
- Use the established error codes: `VALIDATION_ERROR` (400), `INVALID_CODE` (400),
  `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409),
  `RATE_LIMITED` (429), `INTERNAL_ERROR` (500); don't invent new ones
- Pass `201` as the second argument to `c.json` for creates

**Test file** (`apps/api/src/routes/<name>.test.ts`):
- Follow the Workers runtime test conventions in `.claude/rules/testing.md` (reference
  import, `env` binding, `../test-helpers`, `crypto.randomUUID()` seeds)

## Security checklist (tenant isolation)

The rules live only in `.claude/agents/tenant-security-reviewer.md` (section 1: a
`store_id` filter on every tenant query, 404 never 403 on a cross-tenant id, auth
middleware on every router) — read it before writing the route. What this skill adds:

- Input strings use `.transform((s) => s.trim()).pipe(z.string().min(1).max(...))`
- Tests include a cross-tenant isolation case (Store A's record invisible to Store B)

## Steps

1. If route name and HTTP method were provided as arguments, use them. Otherwise ask the user for: route name, HTTP methods, and auth requirement (public / admin session cookie, owner-only or not / shift product / qr_token).
2. Create the test file first, covering: happy path, validation errors (missing/invalid fields), auth rejection if applicable, and cross-tenant isolation.
3. Create the route file following the patterns above and referencing existing routes for the auth type.
4. Mount the route in `apps/api/src/app.ts`.
5. Run `pnpm --filter @yorozu/api test` to verify the tests pass.
6. Run `pnpm check` to verify types and linting pass across all workspaces.
