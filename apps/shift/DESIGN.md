# apps/shift — Design

Design language for the shift-management SPA. Same 10-section shape as
[apps/admin/DESIGN.md](../admin/DESIGN.md) and
[apps/order/DESIGN.md](../order/DESIGN.md).

Tokens live in `src/styles/shift-tokens.css`, imported **only** from
`src/main.tsx`. Everything not overridden there comes from
`@yorozu/ui/styles/tokens.css`.

## 1. Visual Theme & Atmosphere

A back-of-house tool, not a customer surface. Two very different sittings share
it: a staff member tapping through a fortnight of days on a phone between
shifts, and a manager building a schedule on a laptop with a spreadsheet's worth
of information on screen.

The register is therefore admin's — calm, dense, businesslike — rather than
the order app's warm hospitality. What separates it from admin is hue: indigo
instead of admin's blue, so a person with both open in tabs never mistakes one
for the other.

Nothing here is decorative. A shift grid earns its screen by being scannable:
the eye should land on what is *missing* (an unstaffed band, an unsubmitted
member) before it reads anything else.

## 2. Color Palette & Roles

| Role | Token | Value | Use |
|---|---|---|---|
| Primary | `--color-primary` | `#4338ca` | Header bar, primary actions, selected choice |
| Primary hover / active | `--color-primary-hover` / `-active` | `#3730a3` / `#312e81` | Interaction states |
| Primary subtle | `--color-primary-subtle` | `#eef2ff` | Selected choice background |
| Background | `--color-background` | `#f8fafc` | Page ground |
| Surface | `--color-surface` | `#ffffff` | Cards, inputs |
| Foreground | `--color-foreground` | `#0f172a` | Primary text |
| Muted / subtle | `--color-muted-foreground` / `--color-subtle-foreground` | `#475569` / `#94a3b8` | Secondary text, placeholders |
| Border / input | `--color-border` / `--color-input` | `#e2e8f0` / `#cbd5e1` | Dividers, field outlines |

**Net-new roles** (not in the shared base), for the coverage grid:

| Role | Tokens | Meaning |
|---|---|---|
| Shortage | `--color-shortage-bg` / `-fg` / `-border` | Fewer people scheduled than required |
| Surplus | `--color-surplus-bg` / `-fg` / `-border` | More people than required |

Shortage borrows the danger family's red and surplus a cool blue rather than
green: a surplus is *information*, not success, and colouring it green would
tell a manager they had done something right by overstaffing.

Labour-law warnings use the shared warning role. They are advisory — never
render them as errors, and never let one block a save.

## 3. Typography Rules

Inherited from the base scale. Two rules specific to this app:

- **Times and dates are tabular.** Any element showing `09:00–17:00`, worked
  hours, a headcount, or a yen figure sets `font-variant-numeric: tabular-nums`,
  so columns of them line up down a grid. That includes the secondary line
  (`.shiftMeta`), not just the band itself.
- **A date is never bare.** Always render through `formatWorkDate` so the
  weekday is present: `9/1(火)`. Half the errors in scheduling are somebody
  reading the wrong day of the week.

## 4. Component Stylings

- **Choice buttons** (未定 / 勤務可 / 休み) — a `fieldset` of `aria-pressed`
  buttons, not a radiogroup: the same decision admin's CheckoutPanel reached,
  because a real ARIA radiogroup needs roving tabindex that adds nothing here.
  The cost is that every button is its own tab stop, so a keyboard user pays
  three stops per day rather than one — acceptable at three choices, and the
  reason not to grow the group. Selected state is a border and background
  change, never colour alone.
- **Time inputs** — native `<input type="time">`, min 44px tall. The platform
  picker beats anything hand-rolled on a phone.
- **Dropdowns** — native `<select>`, the same exception and for the same
  reason: a manager assigns shifts from a phone in the back of house, where
  the OS wheel picker beats a custom listbox. This is the only app in the
  monorepo that does not use `@yorozu/ui`'s Kobalte `Select`; use `Select`
  for anything that needs styling, grouping or a placeholder beyond what a
  native option list gives.
- **Copy from the previous period** — a `ghost` Button above the day list
  with a one-line hint beside it. It prefills the form by weekday and saves
  nothing; the hint has to say so, because a button that silently wrote a
  fortnight of availability would be the worst button in the app.
- **Cards** — `@yorozu/ui`'s `Card`, one per logical group.
- **Buttons** — `@yorozu/ui`'s `Button`. Draft saves are `secondary`, the
  submit action is the default primary.
- **Errors** — `@yorozu/ui`'s `ErrorAlert`, wrapped in `<Show>`.

## 5. Layout Principles

- One column at phone width; the manager's grid is the only screen that goes
  wide, and it scrolls horizontally inside its own container rather than making
  the page scroll.
- Content is capped at `--container-content` (60rem) and centred. A schedule read edge-to-edge on a
  wide monitor is unreadable.
- Rows are separated by a 1px border, not by cards: a fortnight of cards is
  visual noise.
- Every interactive element clears `--touch-target-min` (44px).

## 6. Depth & Elevation

Flat. The sticky header sits on the primary colour and needs no shadow to read
as a layer; cards use a border rather than elevation. The only shadow in the
app is whatever `@yorozu/ui`'s Card ships with.

## 7. Do's and Don'ts

**Do**

- Show an overnight end time as `25:00`, never `01:00` (`formatMinutes`). A
  band ending at or past midnight therefore has no `<input type="time">`
  representation: show it read-only with a way to re-enter it, rather than
  silently wrapping it to the small hours.
- Say *why* a screen is empty — "not published yet" and "no shifts assigned"
  are different states and read differently.
- Keep warnings advisory in wording as well as behaviour: "確認してください",
  not "エラー".

**Don't**

- Don't put a wage or a minor flag on any screen a staff session can reach.
  The API keeps those owner-only; the UI must not imply otherwise.
- Don't block a save on a labour warning.
- Don't add a colour outside the tokens above; add a token instead.
- Don't reach for `@yorozu/ui` for a shift-specific component — see § 10.

## 8. Responsive Behavior

There are **no `@media` rules** in this app, and adding one should be a
deliberate decision rather than a reflex. The staff screens adapt by flow
instead: day and shift rows are `flex-wrap` containers, so as width shrinks the
choice buttons and time inputs drop under the date on their own, and content is
capped by `--container-content` (60rem) and centred so it never runs
edge-to-edge on a wide monitor.

| Width | Behaviour |
|---|---|
| < 480px | Rows wrap: choices and times sit under the date |
| 480–900px | Rows fit on one line: date, choices, times |
| > 900px | Content capped at `--container-content`, centred |

The staff screens are phone-first: that is where availability actually gets
entered. The manager's grid is laptop-first, scrolls horizontally inside its own
container, and is allowed to be cramped on a phone rather than compromising the
wide layout.

## 9. Agent Prompt Guide

When adding a screen here, state:

1. Which role sees it (owner or staff) — the API enforces this, but the UI
   should not offer what will 403.
2. Which existing `@yorozu/ui` primitives it uses.
3. Which tokens it needs, and whether any are net-new.
4. What its empty, loading and error states say.

Example: "Add an owner-only settings page for shift patterns. Use Card, Field
and Button from @yorozu/ui, existing tokens only. Empty state: 'パターンが未登録です'.
Errors through ErrorAlert."

## 10. Component Ownership Policy

`apps/shift` owns its domain components. Promote something to `@yorozu/ui` only
when **three** apps need the identical thing — the same rule admin and order
follow.

Concretely: the choice-button group, the day row and the coverage grid are this
app's, even though admin has visually similar controls. They encode shift
semantics, and merging them would make `@yorozu/ui` a component library, which
it deliberately is not.

Token overrides belong in `src/styles/shift-tokens.css`, imported only from
`src/main.tsx`:

```css
/* apps/shift/src/styles/shift-tokens.css
   Import ONLY from apps/shift/src/main.tsx — never from shared packages. */
:root {
  --color-primary: #4338ca;
}
```

## 11. Screens

| Route | Role | What it is |
|---|---|---|
| `/login` | — | Magic Link request, posting `app: "shift"` |
| `/` | owner | Period list and the create form |
| `/` | staff | Own published shifts, plus a link to submit |
| `/periods/:id` | owner | The builder: coverage, warnings, cost, CSV |
| `/periods/:id/availability` | staff | The submission form |
| `/settings` | owner | Positions, patterns, requirements, staff |

The owner and staff `/` are one component that branches on role. The API is
the guard — every builder endpoint is owner-only — so this split is UX, not
security, and must never be the only thing standing between a staff session
and a wage.
