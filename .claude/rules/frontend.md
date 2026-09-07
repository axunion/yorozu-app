---
paths:
  - "**/*.tsx"
---

# Frontend conventions (SolidJS + Kobalte + CSS Modules)

## SolidJS reactivity

- Read signals as functions: `count()` not `count`
- Never destructure props — `const { name } = props` breaks reactivity; use `props.name` directly
- Conditional rendering: use `<Show when={...}>` not `{condition && <JSX>}` or ternary with JSX
- List rendering: use `<For each={...}>` not `Array.prototype.map`
- Derived values that depend on signals: use `createMemo`, not a plain variable

## API fetch helpers

Import from `@yorozu/core/client`. Both return
`{ ok: boolean; data?: T; message?: string; status?: number }` — `status` is the HTTP
status when a response came back, for the rare caller that must tell one failure code
from another (a 403 product gate is a screen, not an error banner).

| Helper | Use for |
|---|---|
| `apiFetch<T>(path, init?)` | GET, DELETE, and any request without a JSON body |
| `jsonFetch<T>(path, method, body)` | POST, PATCH, PUT with a JSON body |

Always check `result.ok` before accessing `result.data`.

## Shared UI components

Check `@yorozu/ui` before writing raw HTML. Available: `Button`, `Card`, `ConfirmDialog`, `ErrorAlert`, `Field`, `Select`.

- Use `ConfirmDialog` for all destructive actions — never `window.confirm`
- Use `ErrorAlert` for API error messages

## Styling

- CSS Modules only: `import styles from "./Component.module.css"`
- Reference design tokens via `var(--token-name)` — no raw hex, px, or rem values in component CSS
- No inline styles (`style={{ ... }}`) except for dynamic values that cannot be expressed in CSS
