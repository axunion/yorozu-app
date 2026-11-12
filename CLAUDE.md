# yorozu-app

pnpm + Cloudflare Workers monorepo. SolidJS SPA frontends + a Hono API Worker
on D1, with shared logic in `packages/*`.

Bias toward caution over speed; on trivial tasks, use judgment.

## Tooling

- **Linting/formatting:** Biome only — no ESLint, no Prettier.
- **Pre-commit hooks:** lefthook runs `biome check --write` on staged files and,
  when TS/TSX files are staged, the full `pnpm test`. Do not bypass (`--no-verify`).
- **Dependencies:** shared library versions are pinned once in the
  `pnpm-workspace.yaml` catalog; workspace `package.json` files reference them
  as `"catalog:"`. Add new shared deps to the catalog, not per-workspace.
- **CI/deploy:** GitHub Actions (`.github/workflows/ci.yml`) runs
  `check`/`test`/`build` on pushes and PRs. Deployment is manual — see
  `docs/reference/deploy.md`.
- **TypeScript:** every workspace extends `tsconfig.base.json` (strict,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`). Import across packages
  by their `@yorozu/*` package names.
- **Testing runtime split:** `apps/api` tests run on the Workers runtime via
  `@cloudflare/vitest-plugin` (D1 migrations applied in setup). Frontend
  apps use vitest + `happy-dom`.

Run `pnpm check` before committing.

## Testing

- **Structural correctness** (state transitions, API responses, rendered DOM
  behavior) belongs in the automated suite and runs via `pnpm check` / `pnpm test`,
  plus `pnpm e2e` for golden-path browser flows (`docs/reference/browser-e2e.md`).
  **Visual/subjective judgment** ("does this look right", spacing, color) is not
  something a script can reliably judge — that's a human-in-the-loop check: use
  `docs/reference/manual-smoke-test.md` for the full cross-app walkthrough, or
  the `inspector` agent (see Subagents below) for an isolated change. Persist a new
  automated regression test only for a durable flow worth protecting, ideally one
  with evidence it can break — not for a one-off "let me verify this" check.

## Subagents

Three tiers of agent involvement, based on how risky and contained the change is.
**The main conversation always writes the code, at every tier** — no agent here
implements anything; each one checks or investigates work it didn't do, which is what
makes it safe to spawn without asking first.

- **Trivial** (typos, config tweaks, one-line fixes): implement directly, no agents.
- **Non-trivial but contained** (a self-contained change in one area): implement
  directly. Optionally run the built-in `Explore` agent first to confirm a convention,
  or `researcher` when the change leans on an unfamiliar external API (Hono/Cloudflare
  Workers, Drizzle/D1, SolidJS, Kobalte, Vitest's Workers pool, Zod 4, R2/Wrangler).
  Afterward, **without asking first**, run `reviewer` and `tester` in parallel, plus
  whichever of these apply to the surface touched:
  - `tenant-security-reviewer` — tenant-scoped queries or routes, a new table,
    auth/session/token handling, CORS, or D1 query construction.
  - `ui-reviewer` — SolidJS components, `packages/ui`, or CSS.
  - `doc-sync-auditor` — a feature, schema, or route change that `docs/` may now
    misdescribe; run it before committing so doc updates land in the same commit.

  `reviewer` always runs — it covers scope, simplicity, and general correctness that
  the surface-specific reviewers don't; they add a deeper pass on top when applicable.
  All of these agents are read-only or test-only, so running them costs little and they
  exist specifically to catch the blind spot of reviewing your own work.
- **Large, ambiguous, or high-risk** (spans many files, touches `packages/core`,
  `apps/api` auth/payment/tenant logic substantially, or the task itself is genuinely
  ambiguous): propose the built-in `/goal` command to the user rather than assuming
  it's wanted (a `/goal` run is a real chunk of time/tokens). Write its completion
  condition to explicitly name `reviewer` and `tester` — e.g. "implement X; done when
  `reviewer` reports no findings and `tester` reports check + test green" — since
  `/goal`'s evaluator only pattern-matches the condition text and has no built-in
  knowledge that these agents exist. Name the surface reviewers that apply as well.

There is deliberately no `implementer` agent: implementation needs the full context
of planning and iteration built up in this conversation, a write agent enforces no tool
restriction worth having, and each retry pass would re-spawn it with no memory of the
code it just wrote. What `reviewer`/`tester`/`researcher`/`inspector` provide — an
opinion from something that didn't write the code — depends on none of them writing it
either.

**Visual-verification gate** (separate axis from the tiers above — keyed to whether
the change touches rendered UI, not to how risky the change is): no rendered surface
touched → skip; a small, isolated, single-property UI tweak → a quick manual glance at
the running app is enough; layout that can vary by viewport, a change spanning
multiple components sharing styles, or chasing a reported visual bug → run the
`inspector` agent. This needs no confirmation to run, but isn't automatic for every UI
change either — it costs real time (dev servers + browser), so invoking it is a
judgment call each time. `inspector` is a per-change, throwaway check; it doesn't
overlap with `docs/reference/manual-smoke-test.md` (the full manual cross-app
walkthrough) or the `apps/e2e` Playwright suite (`pnpm e2e`, see
`docs/reference/browser-e2e.md` — a persistent regression suite that
explicitly excludes visual regression checking from its scope). `inspector` also
verifies known changes only; open-ended exploration of the UI for bugs, spec gaps and
improvements is the `/ui-sweep` skill, which drives `inspector` in explore mode.

## Layout

- `packages/ui` (`@yorozu/ui`) — design tokens (CSS variables) and minimal
  primitives (Button, Field, Select, …). **Not a shared component library.**
  Each app owns its domain components; move to `@yorozu/ui` only when 3+ apps
  need identical logic. See `§ Component Ownership Policy` in `apps/order/DESIGN.md`,
  `apps/admin/DESIGN.md` and `apps/shift/DESIGN.md`.
- `docs/` — developer docs, decided and current only (history is in git). See
  `docs/README.md` for the layout.
