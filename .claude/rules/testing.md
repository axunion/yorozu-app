---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

# Testing conventions

## Workers runtime tests (apps/api)

- Start every file with `/// <reference types="@cloudflare/vitest-plugin/types" />`
- Import env binding: `import { env } from "cloudflare:workers"`
- Always pass `env` as the third argument: `app.request(path, init, env)`
- Reuse helpers from `../test-helpers`: `seedStore`, `withAuth`, `jsonInit`, `extractSessionToken`
- Each test is fully self-contained; use `crypto.randomUUID()` for unique email/name seeds to avoid D1 UNIQUE conflicts across tests in the same pool run

## Frontend tests (apps/admin, apps/order, apps/shift, apps/signup, packages/ui)

- Do NOT add `afterEach(cleanup)` manually — it is registered globally in each workspace's `setupFiles` (e.g. `src/setup.ts`)
- Do not reuse the same accessible name across tests in the same file; happy-dom throws on duplicate accessible names

### Kobalte Presence in packages/ui tests

`packages/ui/test/setup.ts` patches `getComputedStyle` to return `"none"` for `animationName`, which prevents `solid-presence` from waiting forever for `animationend` in happy-dom. This means:
- Use `open={isOpen()}` directly on Kobalte dialogs — no `<Show>` wrapper needed
- The same patch does not exist in app-level setup files (`apps/*/src/setup.ts`), so avoid testing Kobalte portal open/close behaviour in app tests; test it in `packages/ui` instead
