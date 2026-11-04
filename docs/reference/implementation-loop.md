# Implementation Loop

How to take one roadmap item from proposal to shipped, as a repeatable
loop an AI session can run end to end: tests → implementation → review →
checks → commit, sliced so progress survives interruption. Invoke it via
the `/implement-item <proposal>` skill or by following this doc directly.

## Preconditions

- The item's proposal in `docs/proposals/` has
  **Status: ready for implementation**. Design sketches (Phase 4–5) must
  have their open decisions resolved with the user and be promoted to
  "ready" first — never auto-promote; those decisions are the user's.
- The working tree is clean and `pnpm check` + `pnpm test` are green
  before starting.
- Check the roadmap item for a dependency note (e.g. "after item 1
  ships"). Dependencies don't block starting — they scope what to build:
  skip the parts of the proposal (and its tests) that reference an
  unshipped feature, and leave the proposal in place with a note listing
  what was deferred.

## Slicing

Split the item into vertical slices in dependency order, skipping layers
the item doesn't touch:

1. **Schema** — `packages/db` schema change + migration (use the
   `/db-migrate` skill; its tenant-isolation checklist applies).
2. **Core** — `packages/core` domain logic and shared types.
3. **API** — `apps/api` routes/middleware (use the `/new-route` skill
   for new endpoints; follow `.claude/rules/api-routes.md`).
4. **Frontend** — the affected SPA(s).

One slice = one commit. A slice must leave the repo green and deployable
on its own (e.g. an API slice ships with its schema already migrated;
unused-by-UI endpoints are fine).

Scale slice count to item size: when adjacent slices are individually
small (e.g. a one-column schema change feeding a single endpoint), merge
them into one slice/commit — every commit pays a full pre-commit test
run, so don't split further than the item warrants. Keep the dependency
order either way.

## Per-slice loop

1. **Tests first.** Take the slice's bullets from the proposal's
   Testing section and write them as failing tests. Run them and
   confirm they fail for the expected reason.
2. **Implement** the minimum that makes them pass.
3. **Verify:** `pnpm check` green, plus the tests of the workspace(s)
   the slice touched (`pnpm --filter <workspace> test`). Don't run the
   full `pnpm test` here — lefthook's pre-commit hook runs it at commit
   time, which is the item's full-suite gate.
4. **Review gates** — run every matching reviewer and resolve its
   findings before committing:
   - New or changed tests (i.e. every slice) → `test-quality-reviewer`
     agent, passing the proposal path and the slice's test files. This
     is the loop's safeguard against tests that pass trivially or skip
     the proposal's Testing section.
   - Touched tenant-scoped queries/routes, added a table, or touched
     auth/session/token handling, CORS, or D1 query construction →
     `tenant-security-reviewer` agent (the deep security + isolation
     audit; the checklist in `/db-migrate` is only the quick pass for
     schema slices).
   - Touched SolidJS components, `packages/ui`, or CSS →
     `ui-reviewer` agent.
   Triggers are per-surface, so a typical slice runs one or two
   reviewers, not all three. When more than one reviewer matches, launch
   them in parallel — they are read-only and independent.
5. **Commit** using the usual commit message conventions. Never bypass
   lefthook (it re-runs Biome and the full test suite). Committing at
   each green slice is part of this loop — no separate approval is
   needed once the loop has been invoked for the item.

If a slice reveals the proposal's design doesn't work (wrong assumption
about existing code, missing constraint), stop and surface it to the
user before patching around it — the proposal is the design of record
and must be corrected first.

## Definition of Done (per item)

An item is shipped only when all of these hold:

1. Every bullet in the proposal's Testing section is covered by a
   passing test (or explicitly deferred with a dependency note).
2. `pnpm check` and `pnpm test` are green.
3. Docs are folded per `docs/README.md`:
   - Merge the proposal's shipped behavior into the relevant
     `specs/features/*.md` (remove the resolved line from Known
     limitations) and `specs/domain-model.md` (state machines,
     invariants) and/or `reference/` docs.
   - Delete the proposal file.
   - In `roadmap.md`, mark the item ✅ Shipped and repoint its proposal
     link to the spec that absorbed it.
4. Run the `doc-sync-auditor` agent and resolve any drift it reports.

Write the doc updates alongside the final slice and include them in that
slice's commit — no separate docs-only commit (one less full pre-commit
test run). Run `doc-sync-auditor` before that commit.

## Interrupt & resume

The loop is resumable at any commit boundary. To find the current
position: `roadmap.md` ✅ marks show which items shipped; for an item in
progress, `git log` shows which slices are committed, and the proposal's
Testing section vs. existing tests shows what remains.
