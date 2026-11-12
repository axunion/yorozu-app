# Monorepo Operations

## Package naming convention

All workspace packages use the `@yorozu/` scope:

| Directory | Package name |
|---|---|
| `apps/admin` | `@yorozu/admin` |
| `apps/order` | `@yorozu/order` |
| `apps/signup` | `@yorozu/signup` |
| `apps/shift` | `@yorozu/shift` |
| `apps/api` | `@yorozu/api` |
| `packages/db` | `@yorozu/db` |
| `packages/core` | `@yorozu/core` |
| `packages/ui` | `@yorozu/ui` |

All packages are `"private": true` — nothing is published to npm.

---

## Toolchain versions

The root `package.json` pins the toolchain in `devEngines`: Node `^26` and
pnpm `^12`, both with `onFail: "download"`, so pnpm fetches the pinned
versions itself and any reasonably recent pnpm on the machine will do. CI
repeats the majors in `.github/workflows/ci.yml` (`pnpm/action-setup`
`version: 12`, `setup-node` `node-version: 26`) because `pnpm/action-setup`
does not read `devEngines`. Bump all three places together.

The pnpm pin is load-bearing, not hygiene. The lockfile carries a
`packageManagerDependencies` section that only recent pnpm (11 and later)
understands; an older pnpm drops it silently on `pnpm install`, reports the
lockfile as up to date, and CI then rejects the install with `Cannot update
packageManagerDependencies with "frozen-lockfile"`.

---

## Running commands

### Targeting a single package

```sh
pnpm --filter @yorozu/admin dev
pnpm --filter @yorozu/api test
pnpm --filter @yorozu/db db:generate
```

### Running across all packages

```sh
pnpm -r build     # build every app/package
pnpm -r test      # test everything
pnpm -r exec tsc --noEmit   # type-check everything
```

### Root convenience scripts

See the root `package.json` for shortcuts — `pnpm dev:admin`, `pnpm db:generate`, etc.

---

## Adding a dependency

Shared library versions (solid-js, vitest, vite, zod, drizzle-orm, …) are pinned
once in the `catalog:` section of `pnpm-workspace.yaml`; workspace `package.json`
files reference them as `"catalog:"`. When adding a dependency that another
workspace already uses — or is likely to — add its version to the catalog and
reference it with `"catalog:"` instead of duplicating the version string.

Always add dependencies to the specific package that uses them, not to the root:

```sh
# Add a runtime dep to the api app
pnpm --filter @yorozu/api add hono

# Add a dev dep to the admin app
pnpm --filter @yorozu/admin add -D @types/some-lib

# Add a shared tool to the root workspace
pnpm add -D -w some-tool
```

Root devDependencies (`-w`) are for tools that operate on the entire repo: `biome`, `lefthook`, `typescript`.

---

## Adding an internal workspace dependency

Use the `workspace:*` protocol so pnpm links the local package:

```json
{
  "dependencies": {
    "@yorozu/core": "workspace:*"
  }
}
```

Then run `pnpm install` to create the symlink.

---

## Adding a new app or package

1. Create the directory under `apps/` or `packages/`.
2. Add a `package.json` with `"name": "@yorozu/<name>"` and `"private": true`.
3. Run `pnpm install` — pnpm will discover it automatically from `pnpm-workspace.yaml`.
4. Add the package to each consumer's `dependencies` as `workspace:*`, add an `exports` map
   if other packages import subpaths, and give it a `tsconfig.json` extending `tsconfig.base.json`.

---

## Dependency boundary enforcement

Enforced by convention and code review only.

Forbidden imports to watch for:

- `import ... from "@yorozu/db"` inside any `apps/admin`, `apps/order`, `apps/signup`, or
  `apps/shift` file
- `import ... from "@yorozu/ui"` inside any `apps/api` file
- `import ... from "@yorozu/core/client"` inside any `apps/api` file

---

## Local D1 state

The local Cloudflare D1 database state is stored at `apps/api/.wrangler/state/v3/d1/`.
Reset it with:

```sh
pnpm db:reset   # wipes local D1 and re-applies all migrations
```

The `.wrangler/` directory is gitignored.
