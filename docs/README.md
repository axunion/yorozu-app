# Developer Documentation

Developer docs — product specs, roadmap, auth design, deploy
runbooks, monorepo operations.

## Structure

- `roadmap.md` — what is not built yet: the demand-driven backlog and the
  engineering track. The entry point for "what's next".
- `specs/` — product specs: what the product does and why. Describes
  *current, shipped behavior* plus known limitations; treat as source of
  truth alongside the code. `specs/features/` holds one spec per feature
  area.
- `reference/` — technical specs: how the system is built and operated
  (auth architecture, deploy runbook, monorepo ops, browser E2E, manual
  smoke test). Treat as source of truth; keep in sync with the code (see
  `.claude/agents/doc-sync-auditor.md`).

The boundary between `specs/` and `reference/` is audience of the
decision: product behavior (visible to users) goes in `specs/`;
implementation and operations go in `reference/`.

## What belongs here

Only what is decided and current. There are no proposal or design-in-progress
docs: settle a design in conversation, then write the outcome into `specs/` or
`reference/` together with the code. What was built, when and why it changed
is git history (`git log`, `git blame`), not prose here — don't narrate
history in a spec ("used to", "since Phase N").

- `specs/` state gaps as **facts** ("no cancellation exists") under a
  *Known limitations* heading — never solution designs.
- `roadmap.md` owns **priority**, at one-to-three sentences per item —
  never schema/API detail.
