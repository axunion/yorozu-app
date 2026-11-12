# yorozu-app

Mobile ordering and point-of-sale SaaS for restaurants, plus a separately sold
shift-scheduling product. A pnpm monorepo on Cloudflare Workers: SolidJS SPAs
and a Hono API backed by D1.

## Structure

```
apps/
  admin/   Management console and login
  order/   Customer ordering screen, opened by QR code
  signup/  Merchant sign-up site
  shift/   Staff scheduling
  api/     Hono REST API (Cloudflare Worker + D1)
  e2e/     Playwright browser tests

packages/
  db/      Drizzle schema, migrations, DB client (server only)
  core/    Shared types, pure logic, browser fetch client
  ui/      Design tokens and minimal Solid primitives
```

## Getting started

Requires Node 26 and pnpm 12 (declared in `devEngines`; pnpm downloads them
if they are missing).

```sh
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # local config, gitignored
pnpm db:migrate                                    # create the local D1 schema
pnpm dev:api                                       # API on :8787
pnpm dev:admin                                     # or dev:order / dev:signup / dev:shift
```

## Commands

| Command | Description |
|---------|-------------|
| `pnpm check` | Biome lint + TypeScript type check |
| `pnpm fix` | Auto-fix lint and formatting |
| `pnpm test` | Unit and API tests |
| `pnpm e2e` | Browser tests (Playwright) |
| `pnpm build` | Build all workspaces |
| `pnpm db:generate` | Generate migrations from schema changes |
| `pnpm db:migrate` | Apply migrations to local D1 |
| `pnpm db:reset` | Wipe and re-apply local D1 |

## Documentation

See [docs/](./docs/README.md): product specs, technical references (auth,
deploy, monorepo operations, browser E2E) and the [roadmap](./docs/roadmap.md).
