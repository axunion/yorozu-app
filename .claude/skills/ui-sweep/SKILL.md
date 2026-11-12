---
name: ui-sweep
description: Checks this project's rendered UI with Playwright (via the `inspector` agent in explore mode), fixes the problems it finds, and re-checks until clean. Whole project by default, or the screen/feature given as the argument. Explicit invocation only — use when the user asks to "sweep the UI", "inspect the UI and fix what you find", or invokes /ui-sweep.
disable-model-invocation: true
argument-hint: [screen or feature — default is the whole project]
---

# UI sweep

Sweep the rendered UI, fix what is wrong, check again. Nothing is kept between runs.
You write every fix in this conversation; `inspector` only looks.

## Steps

1. **Scope.** The argument if given, otherwise every screen and flow of the project —
   find them from the routes, README, and docs. If the scope is unclear, ask.
2. **Explore.** Run `inspector` in explore mode. It has no memory of this conversation,
   so brief it with the scope, where expected behavior is written down (or "judge by
   common sense and consistency within the app"), the viewports, themes, and states to
   cover, and the findings already seen this run so it doesn't repeat them.
3. **Fix** each clear bug. Ask the user, in this conversation, before deciding anything
   the code and docs don't settle: a behavior the spec doesn't cover, a design choice,
   a change that adds UI or touches more than the finding needs.
4. **Re-explore** the areas you changed plus their neighbors. A finding is fixed only
   when `inspector` no longer reproduces it.
5. Repeat 3–4 until nothing fixable remains. Stop and report if a round fixes nothing
   new or the same finding keeps coming back.

## Report

What was fixed (one line each), what was left and why, and any area `inspector` couldn't
explore. If Playwright or its browser can't launch, say so and stop. Follow the
project's `CLAUDE.md` for commits; don't commit on your own.
